/** Unit-interval value math. Pure functions, unit-testable. */

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Nearest hardware step index for a unit value on an n-step channel. */
export function toStep(value: number, steps: number): number {
  return Math.round(clamp01(value) * (steps - 1));
}

/** Unit value exactly representable by the hardware (what will really happen). */
export function quantize(value: number, steps: number): number {
  return toStep(value, steps) / (steps - 1);
}

/** Move by whole hardware steps — the "fine nudge" primitive. */
export function nudge(value: number, steps: number, deltaSteps: number): number {
  const idx = Math.min(steps - 1, Math.max(0, toStep(value, steps) + deltaSteps));
  return idx / (steps - 1);
}

/** Scale a unit value onto an integer byte range [0, max]. */
export function toRange(value: number, max: number): number {
  return Math.round(clamp01(value) * max);
}
