/** HSV↔RGB conversion for family-agnostic controls (roadmap F14/F15/F16):
 *  the same wheel/animation drives HSV-native and RGB-native hardware. */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** h, s, v all in [0,1] → r/g/b in [0,1]. */
export function hsvToRgb(h: number, s: number, v: number): Rgb {
  const i = Math.floor(h * 6) % 6;
  const f = h * 6 - Math.floor(h * 6);
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i) {
    case 0: return { r: v, g: t, b: p };
    case 1: return { r: q, g: v, b: p };
    case 2: return { r: p, g: v, b: t };
    case 3: return { r: p, g: q, b: v };
    case 4: return { r: t, g: p, b: v };
    default: return { r: v, g: p, b: q };
  }
}
