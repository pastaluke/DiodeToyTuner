/**
 * Triones / HappyLighting RGBW bulbs & strips.
 * Protocol: docs/research/02-protocol-compendium.md § Triones
 * Graph: family.triones / protocol.triones / identification.triones
 */
import type { ChannelState, DeviceCapability } from "../core/types";
import { toRange } from "../core/value";
import { hex, type Driver, type IdentityEvidence, type ProbeIO } from "./driver";

const SVC_FFD5 = "0000ffd5-0000-1000-8000-00805f9b34fb";
const CHR_FFD9 = "0000ffd9-0000-1000-8000-00805f9b34fb";
const SVC_FFD0 = "0000ffd0-0000-1000-8000-00805f9b34fb";
const CHR_FFD4 = "0000ffd4-0000-1000-8000-00805f9b34fb";

const NAME_PREFIXES = ["Triones", "LEDBLE-"]; // LEDBLE- collides with ELK — GATT decides.

function powerFrame(on: boolean): Uint8Array {
  return on ? hex(0xcc, 0x23, 0x33) : hex(0xcc, 0x24, 0x33);
}

export const trionesDriver: Driver = {
  family: "family.triones",
  label: "Triones / HappyLighting RGBW",

  chooserFilters: NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
  services: [SVC_FFD5, SVC_FFD0],
  writeChar: { [SVC_FFD5]: CHR_FFD9 },
  notifyChar: { [SVC_FFD0]: CHR_FFD4 },

  identify(e: IdentityEvidence): number {
    let score = 0;
    if (NAME_PREFIXES.some((p) => e.name.startsWith(p))) score += 0.7;
    if (e.serviceUuids.includes(SVC_FFD5)) score += 0.25;
    return Math.min(score, 0.95);
  },

  // Stage 3: read-only status query. A well-formed 66 .. 99 frame is
  // near-proof this device speaks Triones (docs/research/04).
  async probe(io: ProbeIO): Promise<number | null> {
    await io.write(hex(0xef, 0x01, 0x77));
    const resp = await io.nextNotification(1500);
    if (!resp) return null;
    if (resp.length === 12 && resp[0] === 0x66 && resp[11] === 0x99) return 1.0;
    return 0.2; // answered wrongly — actively suspicious
  },

  /** F20: adopt current device state from the documented status frame
   *  `66 ?? PW MD ?? ?? RR GG BB WW ?? 99` (community-verified). */
  async readState(io: ProbeIO): Promise<{ state: Partial<ChannelState>; raw?: string } | null> {
    await io.write(hex(0xef, 0x01, 0x77));
    const resp = await io.nextNotification(1500);
    if (!resp) return null;
    const raw = [...resp].map((b) => b.toString(16).padStart(2, "0")).join(" ");
    if (resp.length !== 12 || resp[0] !== 0x66 || resp[11] !== 0x99) return { state: {}, raw };
    return {
      raw,
      state: {
        power: resp[2] === 0x23 ? 1 : 0,
        r: (resp[6] ?? 0) / 255,
        g: (resp[7] ?? 0) / 255,
        b: (resp[8] ?? 0) / 255,
        w: (resp[9] ?? 0) / 255,
      },
    };
  },

  describe(): DeviceCapability {
    return {
      family: "family.triones",
      label: this.label,
      channels: [
        { id: "power", label: "Power", kind: "power", steps: 2,
          info: "Master switch: cuts or restores drive current to every diode." },
        { id: "r", label: "Red", kind: "r", steps: 256, exclusiveGroup: "rgb", wavelengthNm: 625,
          info: "PWM duty cycle of the red diodes (~625 nm). 256 levels. Firmware disables RGB while the white diode is active." },
        { id: "g", label: "Green", kind: "g", steps: 256, exclusiveGroup: "rgb", wavelengthNm: 525,
          info: "PWM duty cycle of the green diodes (~525 nm). 256 levels." },
        { id: "b", label: "Blue", kind: "b", steps: 256, exclusiveGroup: "rgb", wavelengthNm: 470,
          info: "PWM duty cycle of the blue diodes (~470 nm). 256 levels." },
        { id: "w", label: "White diode", kind: "w", steps: 256, exclusiveGroup: "white",
          info: "Duty cycle of the dedicated white diode — a real fourth emitter, not an RGB mix. Anything above 0 switches to white mode and shuts off RGB." },
      ],
      notes: [
        "Firmware forbids RGB and White simultaneously — pick a group.",
        "One of the few families with real state read-back.",
      ],
    };
  },

  encode(state: ChannelState): Uint8Array[] {
    const frames: Uint8Array[] = [];
    const on = (state["power"] ?? 1) >= 0.5;
    frames.push(powerFrame(on));
    if (!on) return frames;
    const w = state["w"] ?? 0;
    if (w > 0) {
      frames.push(hex(0x56, 0x00, 0x00, 0x00, toRange(w, 255), 0x0f, 0xaa));
    } else {
      frames.push(
        hex(
          0x56,
          toRange(state["r"] ?? 0, 255),
          toRange(state["g"] ?? 0, 255),
          toRange(state["b"] ?? 0, 255),
          0x00, 0xf0, 0xaa,
        ),
      );
    }
    return frames;
  },

  blinkTest(state: ChannelState): [Uint8Array[], Uint8Array[]] {
    return [[powerFrame(false)], this.encode(state)];
  },
};
