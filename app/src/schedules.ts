/**
 * Schedules groundwork (roadmap F30).
 *
 * A schedule is a list of time-of-day nodes; each node either applies a
 * captured light setting (pure channel values — family-agnostic, P1) or
 * starts a palette animation. A client-side runner applies the most recent
 * due node while the app is connected.
 *
 * HONESTY (F30 AC4): device-side timers — schedules that keep running with
 * the app closed — need the vendor RTC/timer commands, which are not yet
 * reverse-engineered for any supported family
 * (observation.device_side_timers_not_distilled). Until a capture session
 * distills them, schedules only run while connected; the UI says so.
 */
import type { ChannelState } from "./core/types";

export interface ScheduleNode {
  /** Local time of day, "HH:MM". */
  time: string;
  label: string;
  kind: "setting" | "palette";
  /** kind=setting: captured channel values (unit intervals). */
  setting?: Partial<ChannelState>;
  /** kind=palette: palette to start the lerp animation with. */
  paletteId?: string;
}

export interface Schedule {
  id: string;
  name: string;
  enabled: boolean;
  nodes: ScheduleNode[];
}

const STORE_KEY = "dtt.schedules";

export function loadSchedules(): Schedule[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    const out: Schedule[] = [];
    for (const s of raw as unknown[]) {
      const o = s as Record<string, unknown>;
      if (typeof o?.["id"] !== "string" || typeof o?.["name"] !== "string" || !Array.isArray(o?.["nodes"])) continue;
      const nodes: ScheduleNode[] = [];
      for (const n of o["nodes"] as unknown[]) {
        const no = n as Record<string, unknown>;
        if (typeof no?.["time"] !== "string" || !/^\d{2}:\d{2}$/.test(no["time"])) continue;
        const kind = no["kind"] === "palette" ? "palette" : "setting";
        const node: ScheduleNode = {
          time: no["time"],
          label: typeof no["label"] === "string" ? no["label"] : "",
          kind,
        };
        if (kind === "palette" && typeof no["paletteId"] === "string") node.paletteId = no["paletteId"];
        if (kind === "setting" && typeof no["setting"] === "object" && no["setting"] !== null) {
          const setting: Partial<ChannelState> = {};
          for (const [k, v] of Object.entries(no["setting"] as Record<string, unknown>)) {
            if (typeof v === "number" && Number.isFinite(v)) setting[k] = Math.min(1, Math.max(0, v));
          }
          node.setting = setting;
        }
        nodes.push(node);
      }
      out.push({ id: o["id"], name: o["name"], enabled: o["enabled"] === true, nodes });
    }
    return out;
  } catch {
    return [];
  }
}

export function saveSchedules(schedules: Schedule[]): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(schedules));
}

export function newSchedule(name: string): Schedule {
  return {
    id: `sch-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    name,
    enabled: false,
    nodes: [],
  };
}

/**
 * Built-in template (F30 AC2): bright white through the day, warm dim color
 * in the evening, lights out late — all in the user's local time zone
 * (times are plain local HH:MM). Warm evening uses the COLOR diodes at a
 * warm hue rather than white temperature, because the verified lamp's
 * temperature byte doesn't tint (observation.lednetwf_white_temp_dims_only).
 */
export function daylightTemplate(): Schedule {
  const s = newSchedule("Day white / evening warm");
  s.nodes = [
    { time: "08:00", label: "Morning: bright white", kind: "setting",
      setting: { power: 1, whiteMode: 1, value: 0.9 } },
    { time: "17:30", label: "Evening: warm amber glow", kind: "setting",
      setting: { power: 1, whiteMode: 0, hue: 30 / 360, saturation: 0.75, value: 0.5 } },
    { time: "21:30", label: "Late evening: dimmer", kind: "setting",
      setting: { power: 1, whiteMode: 0, hue: 25 / 360, saturation: 0.85, value: 0.22 } },
    { time: "23:30", label: "Night: off", kind: "setting",
      setting: { power: 0 } },
  ];
  return s;
}

function minutesOf(time: string): number {
  const h = Number(time.slice(0, 2));
  const m = Number(time.slice(3, 5));
  return h * 60 + m;
}

/** The node that should currently be in effect (latest one due today). */
export function dueNode(s: Schedule, now: Date): ScheduleNode | null {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  let best: ScheduleNode | null = null;
  let bestMin = -1;
  for (const n of s.nodes) {
    const m = minutesOf(n.time);
    if (m <= nowMin && m > bestMin) {
      best = n;
      bestMin = m;
    }
  }
  return best;
}

/**
 * Client-side runner (F30 AC3): every 30 s, for each enabled schedule,
 * apply the latest due node once. Re-applies after reconnect (an enabled
 * schedule should win over whatever state the lamp was left in).
 */
export class ScheduleRunner {
  private timer = 0;
  private applied = new Map<string, string>(); // schedule id → "date time" applied

  constructor(
    private readonly getSchedules: () => Schedule[],
    private readonly ready: () => boolean,
    private readonly apply: (node: ScheduleNode, schedule: Schedule) => void,
  ) {}

  start(): void {
    this.stop();
    this.timer = window.setInterval(() => this.check(), 30_000);
    this.check();
  }
  stop(): void {
    clearInterval(this.timer);
  }

  check(): void {
    if (!this.ready()) return;
    const now = new Date();
    const day = now.toDateString();
    for (const s of this.getSchedules()) {
      if (!s.enabled) continue;
      const node = dueNode(s, now);
      if (!node) continue;
      const key = `${day} ${node.time}`;
      if (this.applied.get(s.id) === key) continue;
      this.applied.set(s.id, key);
      this.apply(node, s);
    }
  }
}
