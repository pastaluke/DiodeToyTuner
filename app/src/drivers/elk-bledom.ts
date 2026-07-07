/**
 * ELK-BLEDOM family — the "Lotus Lantern" strips.
 * Protocol: docs/research/02-protocol-compendium.md § ELK-BLEDOM
 * Graph: family.elk_bledom / protocol.elk_bledom / identification.elk_bledom
 */
import type { ChannelState, DeviceCapability } from "../core/types";
import { toRange } from "../core/value";
import { hex, type Driver, type IdentityEvidence } from "./driver";

const SVC_FFF0 = "0000fff0-0000-1000-8000-00805f9b34fb";
const CHR_FFF3 = "0000fff3-0000-1000-8000-00805f9b34fb";
const CHR_FFF4 = "0000fff4-0000-1000-8000-00805f9b34fb";
// Variant units expose ffe0/ffe1/ffe2 instead.
const SVC_FFE0 = "0000ffe0-0000-1000-8000-00805f9b34fb";
const CHR_FFE1 = "0000ffe1-0000-1000-8000-00805f9b34fb";
const CHR_FFE2 = "0000ffe2-0000-1000-8000-00805f9b34fb";

// Name table from dave-code-ruiz/elkbledom (19+ observed models), plus
// ELK-LAMPL (lamp-form devices incl. sunset lamps; b1scoito/elk-led-controller).
const NAME_PREFIXES = [
  "ELK-BLE", "ELK-BT", "ELK-BULB", "ELK-LAMP", "MELK", "LEDBLE", "LED-",
  "XROCKER", "JACKYLED", "DMRRBA",
];

function rgbFrame(state: ChannelState): Uint8Array {
  return hex(
    0x7e, 0x07, 0x05, 0x03,
    toRange(state["r"] ?? 0, 255),
    toRange(state["g"] ?? 0, 255),
    toRange(state["b"] ?? 0, 255),
    0x10, 0xef,
  );
}

function brightnessFrame(state: ChannelState): Uint8Array {
  // NB: 0–100 decimal — only 101 real steps. Honesty enforced via steps: 101.
  return hex(0x7e, 0x04, 0x01, toRange(state["brightness"] ?? 1, 100), 0x01, 0xff, 0x02, 0x01, 0xef);
}

function powerFrame(on: boolean): Uint8Array {
  return on
    ? hex(0x7e, 0x07, 0x04, 0xff, 0x00, 0x01, 0x02, 0x01, 0xef)
    : hex(0x7e, 0x07, 0x04, 0x00, 0x00, 0x00, 0x02, 0x01, 0xef);
}

export const elkBledomDriver: Driver = {
  family: "family.elk_bledom",
  label: "ELK-BLEDOM (Lotus Lantern) strip controller",

  chooserFilters: NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
  services: [SVC_FFF0, SVC_FFE0],
  writeChar: { [SVC_FFF0]: CHR_FFF3, [SVC_FFE0]: CHR_FFE1 },
  notifyChar: { [SVC_FFF0]: CHR_FFF4, [SVC_FFE0]: CHR_FFE2 },

  identify(e: IdentityEvidence): number {
    let score = 0;
    if (NAME_PREFIXES.some((p) => e.name.startsWith(p))) score += 0.7;
    const hasShape =
      e.serviceUuids.includes(SVC_FFF0) || e.serviceUuids.includes(SVC_FFE0);
    if (hasShape) score += 0.25;
    // Write-only family: no active probe exists; blink test carries the
    // rest when name evidence is missing (docs/research/04, table row 1).
    return Math.min(score, 0.95);
  },

  describe(): DeviceCapability {
    return {
      family: "family.elk_bledom",
      label: this.label,
      channels: [
        { id: "power", label: "Power", kind: "power", steps: 2 },
        { id: "r", label: "Red", kind: "r", steps: 256, wavelengthNm: 625 },
        { id: "g", label: "Green", kind: "g", steps: 256, wavelengthNm: 525 },
        { id: "b", label: "Blue", kind: "b", steps: 256, wavelengthNm: 470 },
        { id: "brightness", label: "Brightness (coarse!)", kind: "w", steps: 101 },
      ],
      notes: [
        "Brightness is a separate 101-step multiplier — for max precision keep it at 1.0 and drive RGB directly.",
        "Write-only device: displayed state is our shadow copy.",
      ],
    };
  },

  encode(state: ChannelState): Uint8Array[] {
    const frames: Uint8Array[] = [];
    const on = (state["power"] ?? 1) >= 0.5;
    frames.push(powerFrame(on));
    if (on) {
      frames.push(brightnessFrame(state));
      frames.push(rgbFrame(state));
    }
    return frames;
  },

  blinkTest(state: ChannelState): [Uint8Array[], Uint8Array[]] {
    return [[powerFrame(false)], this.encode(state)];
  },
};
