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
        { id: "power", label: "Power", kind: "power", steps: 2 },
        { id: "hue", label: "Hue", kind: "hue", steps: 180 },
        { id: "saturation", label: "Saturation", kind: "sat", steps: 101 },
        { id: "value", label: "Value (brightness)", kind: "val", steps: 101 },
      ],
      notes: [
        "Native HSV device: hue has 180 real steps (stored as hue/2), saturation and value 101 each — shown honestly instead of a fake 8-bit RGB.",
        "Effects, white-temperature and per-pixel smear exist on some firmware — not exposed yet; see the protocol compendium.",
      ],
    };
  },

  encode(state: ChannelState): Uint8Array[] {
    const on = (state["power"] ?? 1) >= 0.5;
    const frames: Uint8Array[] = [powerFrame(on)];
    if (on) frames.push(hsvFrame(state));
    return frames;
  },

  blinkTest(state: ChannelState): [Uint8Array[], Uint8Array[]] {
    return [[powerFrame(false)], this.encode(state)];
  },
};
