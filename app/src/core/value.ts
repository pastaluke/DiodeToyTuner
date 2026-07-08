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

/** Move by whole hardware steps — the "fine nudge" primitive.
 *  Cyclic channels (hue) wrap: one step past max lands on 0 (F9). */
export function nudge(value: number, steps: number, deltaSteps: number, cyclic = false): number {
  let idx = toStep(value, steps) + deltaSteps;
  if (cyclic) {
    idx = ((idx % steps) + steps) % steps;
  } else {
    idx = Math.min(steps - 1, Math.max(0, idx));
  }
  return idx / (steps - 1);
}

/** Wrap a unit value into [0,1) for cyclic channels. */
export function wrap01(v: number): number {
  const w = v % 1;
  return w < 0 ? w + 1 : w;
}

/** Scale a unit value onto an integer byte range [0, max]. */
export function toRange(value: number, max: number): number {
  return Math.round(clamp01(value) * max);
}
