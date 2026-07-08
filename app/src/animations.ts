/**
 * Client-driven animation groundwork (roadmap F16).
 *
 * Animations are pure functions of time that emit unit-interval channel
 * values. They target channels BY KIND (P1: family-agnostic): a hue sweep
 * drives a native hue channel where one exists, or synthesizes r/g/b via
 * HSV→RGB on RGB families. All output flows through the normal paced,
 * flash-limited transport — write-only devices animate fine, and safety
 * limits cannot be bypassed. Device-native effects (e.g. LEDnetWF
 * `38 EE SS BB`) are a separate future lane.
 */
import type { Channel } from "./core/types";
import { hsvToRgb } from "./core/color";

export interface AnimationCtx {
  channels: Channel[];
  get(id: string): number;
  set(id: string, value: number): void;
}

export interface Animation {
  id: string;
  name: string;
  /** t = seconds since start, speed = user setting in [0,1]. */
  tick(t: number, speed: number, ctx: AnimationCtx): void;
}

function byKind(channels: Channel[], ...kinds: string[]): Channel | undefined {
  for (const k of kinds) {
    const c = channels.find((c) => c.kind === k);
    if (c) return c;
  }
  return undefined;
}

/** Set a full color by hue on whatever the family offers. */
function setHueEverywhere(hue: number, ctx: AnimationCtx): void {
  const hueCh = byKind(ctx.channels, "hue");
  if (hueCh) {
    ctx.set(hueCh.id, hue % 1);
    return;
  }
  const r = byKind(ctx.channels, "r");
  const g = byKind(ctx.channels, "g");
  const b = byKind(ctx.channels, "b");
  if (r && g && b) {
    const rgb = hsvToRgb(hue % 1, 1, 1);
    ctx.set(r.id, rgb.r);
    ctx.set(g.id, rgb.g);
    ctx.set(b.id, rgb.b);
  }
}

export const animations: Animation[] = [
  {
    id: "hue-sweep",
    name: "Hue sweep",
    tick(t, speed, ctx) {
      // 0.02–0.5 revolutions per second — smooth ramps, never a flash.
      setHueEverywhere(t * (0.02 + speed * 0.48), ctx);
    },
  },
  {
    id: "breathe",
    name: "Breathe",
    tick(t, speed, ctx) {
      const target =
        byKind(ctx.channels, "val") ??
        ctx.channels.find((c) => c.id === "brightness") ??
        byKind(ctx.channels, "w");
      if (!target) return;
      const hz = 0.05 + speed * 0.4;
      ctx.set(target.id, 0.5 - 0.5 * Math.cos(2 * Math.PI * hz * t));
    },
  },
];

export class AnimationEngine {
  private rafId = 0;
  private startedAt = 0;
  running: Animation | null = null;
  speed = 0.3;

  constructor(private readonly ctx: () => AnimationCtx | null) {}

  start(anim: Animation): void {
    this.stop();
    this.running = anim;
    this.startedAt = performance.now();
    const loop = () => {
      const ctx = this.ctx();
      if (ctx && this.running) {
        this.running.tick((performance.now() - this.startedAt) / 1000, this.speed, ctx);
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  /** F16 AC3: manual input on animated channels should call this — user wins. */
  stop(): void {
    cancelAnimationFrame(this.rafId);
    this.running = null;
  }
}
