/**
 * Input mapping engine: physical control events → device parameters.
 * Steam-Controller-style: profiles are pure data (threat model M4a) —
 * they name parameters, never raw bytes or UUIDs.
 */

export interface InputEvent {
  /** e.g. "gamepad0.axis1", "gamepad0.button7", "hid.dial0" */
  controlKey: string;
  /** Axes: [-1,1]. Buttons/triggers: [0,1]. Relative encoders: delta in steps. */
  value: number;
  relative?: boolean;
}

export type Curve = "linear" | "squared" | "cubed";

export interface Binding {
  controlKey: string;
  /** Target channel id on the connected device. */
  channelId: string;
  mode: "absolute" | "relative";
  /** Multiplier applied after the curve. For relative mode: units per full
   *  deflection per second (analog) or per detent (encoder). */
  gain: number;
  curve: Curve;
  /** Ignore |value| below this (analog stick noise). Default 0.1. */
  deadzone: number;
}

export interface MappingProfile {
  name: string;
  bindings: Binding[];
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

export class MappingEngine {
  private profile: MappingProfile = { name: "default", bindings: [] };

  constructor(
    /** Called with (channelId, newUnitValue). Owner clamps/quantizes. */
    private readonly setChannel: (channelId: string, value: number) => void,
    /** Read current value so relative bindings can integrate. */
    private readonly getChannel: (channelId: string) => number,
  ) {}

  setProfile(profile: MappingProfile): void {
    this.profile = profile;
  }
  getProfile(): MappingProfile {
    return this.profile;
  }
  addBinding(binding: Binding): void {
    // one binding per control per channel; replace on re-bind
    this.profile.bindings = this.profile.bindings.filter(
      (b) => !(b.controlKey === binding.controlKey && b.channelId === binding.channelId),
    );
    this.profile.bindings.push(binding);
  }
  removeBinding(controlKey: string, channelId: string): void {
    this.profile.bindings = this.profile.bindings.filter(
      (b) => !(b.controlKey === controlKey && b.channelId === channelId),
    );
  }

  /** dtSeconds: elapsed time for rate-based relative integration. */
  handle(ev: InputEvent, dtSeconds: number): void {
    for (const b of this.profile.bindings) {
      if (b.controlKey !== ev.controlKey) continue;
      let v = ev.value;
      if (!ev.relative && Math.abs(v) < b.deadzone) v = 0;
      v = applyCurve(v, b.curve);

      if (b.mode === "absolute" && !ev.relative) {
        // Map [-1,1] axes and [0,1] buttons alike onto [0,1].
        const unit = v < 0 || ev.controlKey.includes("axis") ? (v + 1) / 2 : v;
        this.setChannel(b.channelId, clamp01(unit * b.gain + (1 - b.gain) * 0.0));
      } else {
        // relative: integrate (encoder detents, or held-axis rate control)
        const delta = ev.relative ? v * b.gain : v * b.gain * dtSeconds;
        if (delta !== 0) {
          this.setChannel(b.channelId, clamp01(this.getChannel(b.channelId) + delta));
        }
      }
    }
  }

  /** Profiles are shareable JSON. Validate structurally on import (M4a). */
  static parseProfile(json: string): MappingProfile {
    const raw: unknown = JSON.parse(json);
    if (typeof raw !== "object" || raw === null) throw new Error("profile: not an object");
    const p = raw as Record<string, unknown>;
    if (typeof p["name"] !== "string" || !Array.isArray(p["bindings"])) {
      throw new Error("profile: missing name/bindings");
    }
    const bindings = (p["bindings"] as unknown[]).map((b): Binding => {
      const o = b as Record<string, unknown>;
      const mode = o["mode"];
      const curve = o["curve"];
      if (
        typeof o["controlKey"] !== "string" ||
        typeof o["channelId"] !== "string" ||
        (mode !== "absolute" && mode !== "relative") ||
        (curve !== "linear" && curve !== "squared" && curve !== "cubed") ||
        typeof o["gain"] !== "number" ||
        typeof o["deadzone"] !== "number"
      ) {
        throw new Error("profile: malformed binding");
      }
      return {
        controlKey: o["controlKey"],
        channelId: o["channelId"],
        mode,
        gain: o["gain"],
        curve,
        deadzone: o["deadzone"],
      };
    });
    return { name: p["name"], bindings };
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
