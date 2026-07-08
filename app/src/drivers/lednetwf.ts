/**
 * Zengge LEDnetWF — the BLE side of the Zengge / Magic Home app family.
 * Protocol: docs/research/02-protocol-compendium.md § LEDnetWF
 * Graph: family.lednetwf / protocol.lednetwf / identification.lednetwf
 *
 * Native color model is HSV — we expose hue/saturation/value as the real
 * knobs rather than faking RGB: hue is stored as hue/2 (180 steps),
 * saturation and value are 0-100 (101 steps each).
 *
 * Packet = 8-byte transport wrapper + payload + checksum(sum of payload):
 *   00 SEQ 80 00 LEN_HI LEN_LO LEN+1 CMDID  |  payload…  chk
 * CMDID 0x0b = command, 0x0a = query expecting a notification.
 * Verified against captures in 8none1/zengge_lednetwf (e.g. power-on
 * checksum 0x90 = 0x3b+0x23+0x32) and the lednetwf_ble HA integration.
 */
import type { ChannelState, DeviceCapability } from "../core/types";
import { toRange } from "../core/value";
import { rgbToHsv } from "../core/color";
import type { Driver, IdentityEvidence, ProbeIO } from "./driver";

const SVC_FFFF = "0000ffff-0000-1000-8000-00805f9b34fb";
const SVC_FF00 = "0000ff00-0000-1000-8000-00805f9b34fb"; // variant placement
const CHR_FF01 = "0000ff01-0000-1000-8000-00805f9b34fb"; // write
const CHR_FF02 = "0000ff02-0000-1000-8000-00805f9b34fb"; // notify

let seq = 0;

function wrap(payload: number[], cmdId: number): Uint8Array {
  const checksum = payload.reduce((a, b) => a + b, 0) & 0xff;
  const body = [...payload, checksum];
  seq = (seq + 1) & 0xff;
  return Uint8Array.from([
    0x00, seq, 0x80, 0x00,
    (body.length >> 8) & 0xff, body.length & 0xff,
    (body.length + 1) & 0xff, cmdId,
    ...body,
  ]);
}

function powerFrame(on: boolean): Uint8Array {
  return wrap([0x3b, on ? 0x23 : 0x24, 0, 0, 0, 0, 0, 0, 0, 0x32, 0, 0], 0x0b);
}

function hsvFrame(state: ChannelState): Uint8Array {
  return wrap(
    [
      0x3b, 0xa1,
      toRange(state["hue"] ?? 0, 179),      // hue/2: 0-179 covers 0-358°
      toRange(state["saturation"] ?? 1, 100),
      toRange(state["value"] ?? 0, 100),
      0, 0, 0, 0, 0, 0, 0,
    ],
    0x0b,
  );
}

/**
 * White mode (dedicated white LED). Brightness byte verified on hardware
 * 2026-07-08 (F8). The temperature byte did NOT change tint on the test
 * lamp — it only dimmed (observation.lednetwf_white_temp_dims_only);
 * likely a single-temperature emitter there, so it stays exposed for CCT
 * models but labeled honestly. Brightness is the SHARED `value` channel
 * (F18 AC2): one brightness for both modes, preserved across toggles.
 */
function whiteFrame(state: ChannelState): Uint8Array {
  return wrap(
    [
      0x3b, 0xb1, 0, 0, 0,
      toRange(state["whiteTemp"] ?? 0, 100),
      toRange(state["value"] ?? 0, 100),
      0, 0, 0, 0, 0,
    ],
    0x0b,
  );
}

/** LED-settings query `81 8a 8b` (chk 0x96) — read-only, answered on ff02. */
function settingsQuery(): Uint8Array {
  return wrap([0x81, 0x8a, 0x8b], 0x0a);
}

export const lednetwfDriver: Driver = {
  family: "family.lednetwf",
  label: "Zengge LEDnetWF (Magic Home BLE)",

  chooserFilters: [{ namePrefix: "LEDnetWF" }],
  services: [SVC_FFFF, SVC_FF00],
  writeChar: { [SVC_FFFF]: CHR_FF01, [SVC_FF00]: CHR_FF01 },
  notifyChar: { [SVC_FFFF]: CHR_FF02, [SVC_FF00]: CHR_FF02 },

  identify(e: IdentityEvidence): number {
    let score = 0;
    if (e.name.startsWith("LEDnetWF")) score += 0.7;
    if (e.serviceUuids.includes(SVC_FFFF) || e.serviceUuids.includes(SVC_FF00)) {
      score += 0.25;
    }
    return Math.min(score, 0.95);
  },

  // Stage 3: settings query expects a notification back — a response frame
  // is near-proof the device speaks LEDnetWF.
  async probe(io: ProbeIO): Promise<number | null> {
    await io.write(settingsQuery());
    const resp = await io.nextNotification(1500);
    if (!resp) return null;
    return resp.length >= 4 ? 1.0 : 0.2;
  },

  describe(): DeviceCapability {
    return {
      family: "family.lednetwf",
      label: this.label,
      channels: [
        { id: "power", label: "Power", kind: "power", steps: 2,
          info: "Master switch: cuts or restores drive current to every diode in the lamp." },
        { id: "whiteMode", label: "White light", kind: "mode", steps: 2,
          info: "Chooses which emitters run: OFF = the red/green/blue color diodes, ON = the dedicated white diode. The firmware forbids both at once. Brightness below is shared — it drives whichever side is active and is remembered across toggles. Bindable: learn a controller button and it toggles." },
        { id: "hue", label: "Hue", kind: "hue", steps: 180, cyclic: true, exclusiveGroup: "color",
          info: "Angle on the color circle — which blend of the red, green and blue diodes is driven. The controller mixes their PWM duty cycles to fake in-between colors. 180 real positions (2° each); wraps around, both ends are red." },
        { id: "saturation", label: "Saturation", kind: "sat", steps: 101, exclusiveGroup: "color",
          info: "Color purity: 100 = only the diodes for the chosen hue conduct; lower values blend all three diodes toward white. 101 real steps." },
        { id: "value", label: "Brightness", kind: "val", steps: 101,
          info: "Duty cycle of the active diodes — the fraction of time they conduct each PWM period. Shared between color and white modes. 101 real hardware levels; there is nothing between two adjacent steps to send, and perceived brightness is nonlinear (low-end steps look bigger)." },
        { id: "whiteTemp", label: "White warmth", kind: "cw", steps: 101, exclusiveGroup: "white",
          info: "Meant to tint the white LED warm→cool on lamps with two white emitters. On the lamp we verified it does NOT change tint — it only dims while white mode is on (single-temperature white hardware). Leave it at 0 unless yours responds." },
      ],
      notes: [
        "Native HSV device: hue has 180 real steps (stored as hue/2), saturation and brightness 101 each — shown honestly instead of a fake 8-bit RGB.",
        "White light is a mode toggle (F18): color diodes and the white diode are firmware-exclusive; one shared Brightness drives whichever is active.",
        "White warmth verified ineffective (dims only) on a single-white sunset lamp — kept for dual-white models.",
        "Effects and per-pixel smear exist on some firmware — not exposed yet; see the protocol compendium.",
      ],
    };
  },

  encode(state: ChannelState): Uint8Array[] {
    const on = (state["power"] ?? 1) >= 0.5;
    const frames: Uint8Array[] = [powerFrame(on)];
    if (on) {
      // Color and white are exclusive firmware modes; the explicit mode
      // toggle picks the frame, shared `value` sets brightness for both.
      frames.push((state["whiteMode"] ?? 0) >= 0.5 ? whiteFrame(state) : hsvFrame(state));
    }
    return frames;
  },

  /**
   * F20: adopt current device state. Layout is HYPOTHESIZED flux_led-style
   * (graph: protocol.lednetwf state_query_response, `reported`): the
   * settings query is the Magic Home Wi-Fi state query verbatim, whose
   * answer is 81 DT PW MD .. .. RR GG BB WW …. Ring-firmware units answer
   * differently — parse defensively, always return raw hex so a hardware
   * session can verify/correct the graph entry.
   */
  async readState(io: ProbeIO): Promise<{ state: Partial<ChannelState>; raw?: string } | null> {
    await io.write(settingsQuery());
    const resp = await io.nextNotification(1500);
    if (!resp) return null;
    const raw = [...resp].map((b) => b.toString(16).padStart(2, "0")).join(" ");
    const state: Partial<ChannelState> = {};
    // Locate an 0x81 header whose power byte is a known magic — the frame
    // may or may not arrive inside the 8-byte transport wrapper.
    for (let i = 0; i + 9 < resp.length; i++) {
      if (resp[i] !== 0x81) continue;
      const pw = resp[i + 2];
      if (pw !== 0x23 && pw !== 0x24) continue;
      state["power"] = pw === 0x23 ? 1 : 0;
      const r = (resp[i + 6] ?? 0) / 255;
      const g = (resp[i + 7] ?? 0) / 255;
      const b = (resp[i + 8] ?? 0) / 255;
      const w = (resp[i + 9] ?? 0) / 255;
      if (w > 0) {
        state["whiteMode"] = 1;
        state["value"] = w;
      } else if (r + g + b > 0) {
        const hsv = rgbToHsv(r, g, b);
        state["whiteMode"] = 0;
        state["hue"] = hsv.h;
        state["saturation"] = hsv.s;
        state["value"] = hsv.v;
      }
      break;
    }
    return { state, raw };
  },

  blinkTest(state: ChannelState): [Uint8Array[], Uint8Array[]] {
    return [[powerFrame(false)], this.encode(state)];
  },
};
