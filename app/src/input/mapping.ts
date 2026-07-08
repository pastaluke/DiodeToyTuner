/**
 * Input mapping engine: physical control events → device parameters.
 * Steam-Controller-style: profiles are pure data (threat model M4a) —
 * they name parameters, never raw bytes or UUIDs.
 *
 * Binding kinds (docs/roadmap-mapping-and-views.md F2–F4):
 *  - absolute: control position maps directly onto [0,1]
 *  - rate:     held analog input changes the value continuously
 *  - step:     button press nudges by exact hardware steps
 *  - rotary:   stick pushed to its rim acts as an endless encoder —
 *              engaging the rim never jumps the value; only angular
 *              travel (CW/CCW) changes it
 * Modifiers (F3): held controls multiply a binding's speed.
 */

export interface InputEvent {
  /** e.g. "gamepad0.axis1", "gamepad0.button7", "hid0.dial0" */
  controlKey: string;
  /** Axes: [-1,1]. Buttons/triggers: [0,1]. Relative encoders: delta in detents. */
  value: number;
  relative?: boolean;
}

export type Curve = "linear" | "squared" | "cubed";
export type BindingKind = "absolute" | "rate" | "step" | "rotary" | "toggle";

export interface Modifier {
  controlKey: string;
  /** Speed multiplier while held (>1 coarser/faster, <1 finer/slower). */
  scale: number;
}

export interface Binding {
  channelId: string;
  kind: BindingKind;
  controlKey: string;
  /** Rotary only: the paired Y axis (controlKey is X). */
  controlKey2?: string;
  direction: 1 | -1;
  /**
   * Meaning depends on kind:
   *  absolute — unused
   *  rate     — full-range units per second at full deflection
   *  step     — hardware steps per press
   *  rotary   — revolutions per full 0→1 sweep (fractional allowed)
   */
  sensitivity: number;
  curve: Curve;
  deadzone: number;
  modifiers: Modifier[];
}

export interface MappingProfile {
  name: string;
  family?: string;
  bindings: Binding[];
  /** channelId → view widget name (F7); owned by the UI, carried here so
   *  profiles round-trip the whole configuration. */
  views?: Record<string, string>;
}

const ROTARY_ENGAGE_RADIUS = 0.55;
const PRESS = 0.5;
const RELEASE = 0.3;

function wrap01(v: number): number {
  const w = v % 1;
  return w < 0 ? w + 1 : w;
}

function applyCurve(v: number, curve: Curve): number {
  const s = Math.sign(v);
  const a = Math.abs(v);
  switch (curve) {
    case "squared": return s * a * a;
    case "cubed": return s * a * a * a;
    default: return v;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export class MappingEngine {
  private profile: MappingProfile = { name: "default", bindings: [] };
  /** Latest raw value of every control we've ever seen (for rotary pairs
   *  and modifier holds). */
  private raw = new Map<string, number>();
  private rotary = new Map<Binding, { engaged: boolean; angle: number }>();
  private pressed = new Map<Binding, boolean>();

  constructor(
    private readonly setChannel: (channelId: string, value: number) => void,
    private readonly getChannel: (channelId: string) => number,
    /** Hardware step count + cyclic flag for a channel (F9). */
    private readonly getChannelMeta: (channelId: string) => { steps: number; cyclic: boolean },
    private readonly onProfileChanged?: () => void,
  ) {}

  /** Cyclic channels wrap at the seam; others clamp (F9 AC1). */
  private apply(channelId: string, next: number): void {
    const meta = this.getChannelMeta(channelId);
    this.setChannel(channelId, meta.cyclic ? wrap01(next) : clamp01(next));
  }

  getProfile(): MappingProfile {
    return this.profile;
  }
  setProfile(profile: MappingProfile): void {
    this.profile = profile;
    this.rotary.clear();
    this.pressed.clear();
    this.onProfileChanged?.();
  }
  addBinding(binding: Binding): void {
    this.profile.bindings.push(binding);
    this.onProfileChanged?.();
  }
  removeBinding(binding: Binding): void {
    this.profile.bindings = this.profile.bindings.filter((b) => b !== binding);
    this.onProfileChanged?.();
  }
  /** Call after editing a binding's fields in place. */
  touch(): void {
    this.onProfileChanged?.();
  }

  private modifierScale(b: Binding): number {
    let s = 1;
    for (const m of b.modifiers) {
      if ((this.raw.get(m.controlKey) ?? 0) > PRESS) s *= m.scale;
    }
    return s;
  }

  handle(ev: InputEvent, dtSeconds: number): void {
    if (!ev.relative) this.raw.set(ev.controlKey, ev.value);

    for (const b of this.profile.bindings) {
      const isPrimary = b.controlKey === ev.controlKey;
      const isPair = b.kind === "rotary" && b.controlKey2 === ev.controlKey;
      if (!isPrimary && !isPair) continue;

      switch (b.kind) {
        case "absolute": {
          if (ev.relative) break;
          // Axes arrive in [-1,1]; buttons/triggers in [0,1].
          const unit = ev.controlKey.includes("axis") ? (ev.value + 1) / 2 : ev.value;
          this.setChannel(b.channelId, clamp01(b.direction === 1 ? unit : 1 - unit));
          break;
        }
        case "rate": {
          const scale = this.modifierScale(b);
          if (ev.relative) {
            // Encoder detents: sensitivity = full-range units per detent.
            const delta = ev.value * b.direction * b.sensitivity * scale;
            if (delta !== 0) this.apply(b.channelId, this.getChannel(b.channelId) + delta);
            break;
          }
          let v = ev.value;
          if (Math.abs(v) < b.deadzone) break;
          v = applyCurve(v, b.curve);
          const delta = v * b.direction * b.sensitivity * scale * dtSeconds;
          if (delta !== 0) this.apply(b.channelId, this.getChannel(b.channelId) + delta);
          break;
        }
        case "step": {
          const was = this.pressed.get(b) ?? false;
          if (!was && ev.value > PRESS) {
            this.pressed.set(b, true);
            const steps = Math.max(2, this.getChannelMeta(b.channelId).steps);
            const scale = this.modifierScale(b);
            const delta = (b.direction * b.sensitivity * scale) / (steps - 1);
            this.apply(b.channelId, this.getChannel(b.channelId) + delta);
          } else if (was && ev.value < RELEASE) {
            this.pressed.set(b, false);
          }
          break;
        }
        case "toggle": {
          // One press flips a binary channel (F10) — power on Start, etc.
          const was = this.pressed.get(b) ?? false;
          if (!was && ev.value > PRESS) {
            this.pressed.set(b, true);
            this.setChannel(b.channelId, this.getChannel(b.channelId) >= 0.5 ? 0 : 1);
          } else if (was && ev.value < RELEASE) {
            this.pressed.set(b, false);
          }
          break;
        }
        case "rotary": {
          const x = this.raw.get(b.controlKey) ?? 0;
          const y = this.raw.get(b.controlKey2 ?? "") ?? 0;
          const r = Math.hypot(x, y);
          const st = this.rotary.get(b) ?? { engaged: false, angle: 0 };
          if (r < ROTARY_ENGAGE_RADIUS) {
            st.engaged = false; // release: value stays where it is (F2 AC1)
          } else {
            const angle = Math.atan2(y, x);
            if (st.engaged) {
              let d = angle - st.angle;
              if (d > Math.PI) d -= 2 * Math.PI;
              if (d < -Math.PI) d += 2 * Math.PI;
              const revolutions = Math.max(0.05, b.sensitivity);
              const delta =
                (d / (2 * Math.PI)) * (b.direction / revolutions) * this.modifierScale(b);
              if (delta !== 0) this.apply(b.channelId, this.getChannel(b.channelId) + delta);
            }
            st.engaged = true;
            st.angle = angle;
          }
          this.rotary.set(b, st);
          break;
        }
      }
    }
  }

  /** Profiles are shareable JSON; validate structurally on import (M4a). */
  static parseProfile(json: string): MappingProfile {
    const raw: unknown = JSON.parse(json);
    if (typeof raw !== "object" || raw === null) throw new Error("profile: not an object");
    const p = raw as Record<string, unknown>;
    if (typeof p["name"] !== "string" || !Array.isArray(p["bindings"])) {
      throw new Error("profile: missing name/bindings");
    }
    const bindings = (p["bindings"] as unknown[]).map(parseBinding);
    const profile: MappingProfile = { name: p["name"], bindings };
    if (typeof p["family"] === "string") profile.family = p["family"];
    if (typeof p["views"] === "object" && p["views"] !== null) {
      const views: Record<string, string> = {};
      for (const [k, v] of Object.entries(p["views"] as Record<string, unknown>)) {
        if (typeof v === "string") views[k] = v;
      }
      profile.views = views;
    }
    return profile;
  }
}

function parseBinding(b: unknown): Binding {
  const o = b as Record<string, unknown>;
  const kind = o["kind"];
  const curve = o["curve"];
  const direction = o["direction"];
  if (
    typeof o["controlKey"] !== "string" ||
    typeof o["channelId"] !== "string" ||
    (kind !== "absolute" && kind !== "rate" && kind !== "step" && kind !== "rotary" && kind !== "toggle") ||
    (curve !== "linear" && curve !== "squared" && curve !== "cubed") ||
    (direction !== 1 && direction !== -1) ||
    typeof o["sensitivity"] !== "number" ||
    !Number.isFinite(o["sensitivity"]) ||
    typeof o["deadzone"] !== "number"
  ) {
    throw new Error("profile: malformed binding");
  }
  const modifiers: Modifier[] = [];
  if (Array.isArray(o["modifiers"])) {
    for (const m of o["modifiers"] as unknown[]) {
      const mo = m as Record<string, unknown>;
      if (typeof mo["controlKey"] === "string" && typeof mo["scale"] === "number") {
        modifiers.push({ controlKey: mo["controlKey"], scale: mo["scale"] });
      }
    }
  }
  const binding: Binding = {
    channelId: o["channelId"],
    kind,
    controlKey: o["controlKey"],
    direction,
    sensitivity: o["sensitivity"],
    curve,
    deadzone: o["deadzone"],
    modifiers,
  };
  if (typeof o["controlKey2"] === "string") binding.controlKey2 = o["controlKey2"];
  return binding;
}
