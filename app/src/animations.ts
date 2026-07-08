/**
 * Client-driven animations (roadmap F16, extended F27/F29).
 *
 * Animations emit unit-interval channel values, targeting channels BY KIND
 * (P1: family-agnostic): hue drives a native hue channel where one exists,
 * or synthesizes r/g/b via HSV→RGB on RGB families. All output flows
 * through the normal paced, flash-limited transport — write-only devices
 * animate fine, and safety limits cannot be bypassed. Device-native
 * effects (e.g. LEDnetWF `38 EE SS BB`) are a separate future lane.
 *
 * Speed is log-scale (F27): the slider covers seconds-fast to
 * an-hour-per-cycle slow. Animations integrate their own phase so moving
 * the speed slider mid-run never jumps the output.
 */
import type { Channel } from "./core/types";
import { hsvToRgb } from "./core/color";
import type { Swatch } from "./palettes";

export interface AnimOptions {
  /** Active palette's swatches (F29). */
  swatches: Swatch[];
  /** F29 AC2: fade brightness to 0 and back up on each color change. */
  dipToBlack: boolean;
  /** F29 AC3: uniform brightness override; null = use stored swatch brightness. */
  overrideBrightness: number | null;
}

export interface AnimationCtx {
  channels: Channel[];
  opts: AnimOptions;
  get(id: string): number;
  set(id: string, value: number): void;
}

export interface Animation {
  id: string;
  name: string;
  /** dt = seconds since last tick, speed = user setting in [0,1]. */
  tick(dt: number, speed: number, ctx: AnimationCtx): void;
  /** Called by the engine on start. */
  reset(): void;
  /** Human-readable cycle length at a given speed (for the UI). */
  cycle(speed: number): string;
}

/** Log-scale period: speed 1 → fastest, 0 → slowest (F27). */
function periodSeconds(speed: number, fastestS: number, slowestS: number): number {
  return slowestS * Math.pow(fastestS / slowestS, speed);
}

function fmtSeconds(s: number): string {
  if (s < 90) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  if (s < 5400) return `${(s / 60).toFixed(1)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

function byKind(channels: Channel[], ...kinds: string[]): Channel | undefined {
  for (const k of kinds) {
    const c = channels.find((c) => c.kind === k);
    if (c) return c;
  }
  return undefined;
}

/** Apply a full h/s/v color on whatever the family offers. Forces color
 *  mode on white↔color toggle families (a color animation with the white
 *  diode lit would be invisible). */
function setColorEverywhere(h: number, s: number, v: number, ctx: AnimationCtx): void {
  const mode = byKind(ctx.channels, "mode");
  if (mode && ctx.get(mode.id) >= 0.5) ctx.set(mode.id, 0);
  const hueCh = byKind(ctx.channels, "hue");
  if (hueCh) {
    ctx.set(hueCh.id, ((h % 1) + 1) % 1);
    const satCh = byKind(ctx.channels, "sat");
    if (satCh) ctx.set(satCh.id, s);
    const valCh = byKind(ctx.channels, "val");
    if (valCh) ctx.set(valCh.id, v);
    return;
  }
  const r = byKind(ctx.channels, "r");
  const g = byKind(ctx.channels, "g");
  const b = byKind(ctx.channels, "b");
  if (r && g && b) {
    const rgb = hsvToRgb(((h % 1) + 1) % 1, s, v);
    ctx.set(r.id, rgb.r);
    ctx.set(g.id, rgb.g);
    ctx.set(b.id, rgb.b);
  }
}

/** Hue-only variant: leaves brightness/saturation where the user set them. */
function setHueEverywhere(hue: number, ctx: AnimationCtx): void {
  const h = ((hue % 1) + 1) % 1;
  const hueCh = byKind(ctx.channels, "hue");
  if (hueCh) {
    const mode = byKind(ctx.channels, "mode");
    if (mode && ctx.get(mode.id) >= 0.5) ctx.set(mode.id, 0);
    ctx.set(hueCh.id, h);
    return;
  }
  const r = byKind(ctx.channels, "r");
  const g = byKind(ctx.channels, "g");
  const b = byKind(ctx.channels, "b");
  if (r && g && b) {
    const rgb = hsvToRgb(h, 1, 1);
    ctx.set(r.id, rgb.r);
    ctx.set(g.id, rgb.g);
    ctx.set(b.id, rgb.b);
  }
}

/** Shortest-way-around hue interpolation (F29 AC1). */
function lerpHue(a: number, b: number, p: number): number {
  let d = (b - a) % 1;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return ((a + d * p) % 1 + 1) % 1;
}

function lerp(a: number, b: number, p: number): number {
  return a + (b - a) * p;
}

// Sweep: one full revolution per period. F27: 2 s fast end (unchanged
// top speed), a full hour at the slow end.
let sweepPhase = 0;
// Breathe: cosine ramp preserved; same slow floor treatment.
let breathePhase = 0;
// Palette lerp: phase is the fraction of a full trip around the palette.
let palettePhase = 0;

export const animations: Animation[] = [
  {
    id: "hue-sweep",
    name: "Hue sweep",
    reset() { sweepPhase = 0; },
    cycle(speed) { return `one revolution ≈ ${fmtSeconds(periodSeconds(speed, 2, 3600))}`; },
    tick(dt, speed, ctx) {
      sweepPhase += dt / periodSeconds(speed, 2, 3600);
      setHueEverywhere(sweepPhase, ctx);
    },
  },
  {
    id: "breathe",
    name: "Breathe",
    reset() { breathePhase = 0; },
    cycle(speed) { return `one breath ≈ ${fmtSeconds(periodSeconds(speed, 2.5, 1800))}`; },
    tick(dt, speed, ctx) {
      const target =
        byKind(ctx.channels, "val") ??
        ctx.channels.find((c) => c.id === "brightness") ??
        byKind(ctx.channels, "w");
      if (!target) return;
      breathePhase += dt / periodSeconds(speed, 2.5, 1800);
      ctx.set(target.id, 0.5 - 0.5 * Math.cos(2 * Math.PI * breathePhase));
    },
  },
  {
    id: "palette-lerp",
    name: "Palette lerp",
    reset() { palettePhase = 0; },
    cycle(speed) { return `full palette loop ≈ ${fmtSeconds(periodSeconds(speed, 4, 3600))}`; },
    tick(dt, speed, ctx) {
      const sw = ctx.opts.swatches;
      if (sw.length === 0) return;
      const vOf = (s: Swatch) => ctx.opts.overrideBrightness ?? s.v;
      if (sw.length === 1) {
        const only = sw[0]!;
        setColorEverywhere(only.h, only.s, vOf(only), ctx);
        return;
      }
      palettePhase = (palettePhase + dt / periodSeconds(speed, 4, 3600)) % 1;
      const pos = palettePhase * sw.length;
      const i = Math.floor(pos) % sw.length;
      const p = pos - Math.floor(pos);
      const a = sw[i]!;
      const b = sw[(i + 1) % sw.length]!;
      if (ctx.opts.dipToBlack) {
        // F29 AC2: hold color A fading out, swap at black, fade B back in.
        if (p < 0.5) setColorEverywhere(a.h, a.s, vOf(a) * (1 - p * 2), ctx);
        else setColorEverywhere(b.h, b.s, vOf(b) * (p * 2 - 1), ctx);
      } else {
        setColorEverywhere(lerpHue(a.h, b.h, p), lerp(a.s, b.s, p), lerp(vOf(a), vOf(b), p), ctx);
      }
    },
  },
];

export class AnimationEngine {
  private rafId = 0;
  private lastT = 0;
  running: Animation | null = null;
  speed = 0.3;

  constructor(private readonly ctx: () => AnimationCtx | null) {}

  start(anim: Animation): void {
    this.stop();
    this.running = anim;
    anim.reset();
    this.lastT = performance.now();
    const loop = () => {
      const ctx = this.ctx();
      const now = performance.now();
      const dt = Math.min(0.25, (now - this.lastT) / 1000);
      this.lastT = now;
      if (ctx && this.running) {
        this.running.tick(dt, this.speed, ctx);
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
