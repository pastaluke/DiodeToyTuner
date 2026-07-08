/**
 * Palettes (roadmap F28): named lists of saved color swatches.
 *
 * A swatch stores hue/saturation/brightness in unit intervals — pure data,
 * family-agnostic (P1): HSV families use it directly, RGB families through
 * conversion. Persisted in localStorage; shared by copying JSON to the
 * clipboard and importing it back (same threat model as profiles, M4a:
 * palettes are pure data, schema-validated on import, never bytes/UUIDs).
 */

export interface Swatch {
  h: number;
  s: number;
  v: number;
}

export interface Palette {
  id: string;
  name: string;
  swatches: Swatch[];
}

const STORE_KEY = "dtt.palettes";
const ACTIVE_KEY = "dtt.palette.active";

function unit(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

function parseSwatch(raw: unknown): Swatch | null {
  const o = raw as Record<string, unknown>;
  const h = unit(o?.["h"]);
  const s = unit(o?.["s"]);
  const v = unit(o?.["v"]);
  return h !== null && s !== null && v !== null ? { h, s, v } : null;
}

export function loadPalettes(): Palette[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    const out: Palette[] = [];
    for (const p of raw as unknown[]) {
      const o = p as Record<string, unknown>;
      if (typeof o?.["id"] !== "string" || typeof o?.["name"] !== "string" || !Array.isArray(o?.["swatches"])) continue;
      out.push({
        id: o["id"],
        name: o["name"],
        swatches: (o["swatches"] as unknown[]).map(parseSwatch).filter((s): s is Swatch => s !== null),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function savePalettes(palettes: Palette[]): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(palettes));
}

export function getActivePaletteId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}
export function setActivePaletteId(id: string): void {
  localStorage.setItem(ACTIVE_KEY, id);
}

export function newPalette(name: string): Palette {
  return { id: `pal-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`, name, swatches: [] };
}

/** Shareable form: what goes on the clipboard. */
export function exportPalette(p: Palette): string {
  return JSON.stringify({ kind: "dtt-palette", name: p.name, swatches: p.swatches }, null, 2);
}

/** Parse clipboard text into a fresh palette; throws with a readable message. */
export function importPalette(text: string): Palette {
  const raw: unknown = JSON.parse(text);
  const o = raw as Record<string, unknown>;
  if (o?.["kind"] !== "dtt-palette" || typeof o?.["name"] !== "string" || !Array.isArray(o?.["swatches"])) {
    throw new Error("clipboard is not a DiodeToyTuner palette");
  }
  const swatches = (o["swatches"] as unknown[]).map(parseSwatch).filter((s): s is Swatch => s !== null);
  const p = newPalette(o["name"]);
  p.swatches = swatches;
  return p;
}

/** CSS color for a swatch chip / list preview. */
export function swatchCss(s: Swatch): string {
  return `hsl(${Math.round(s.h * 360)}deg ${Math.round(s.s * 100)}% ${Math.round(20 + s.v * 35)}%)`;
}

/** Row-background gradient previewing every swatch (F28 AC3). */
export function paletteGradient(p: Palette): string {
  if (p.swatches.length === 0) return "";
  if (p.swatches.length === 1) return swatchCss(p.swatches[0]!);
  const stops = p.swatches.map((s, i) => `${swatchCss(s)} ${(i / (p.swatches.length - 1)) * 100}%`);
  return `linear-gradient(to right, ${stops.join(", ")})`;
}
