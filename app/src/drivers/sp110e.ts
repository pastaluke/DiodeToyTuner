/**
 * SP110E (BanlanX) BLE controller for addressable strips.
 * Protocol: docs/research/02-protocol-compendium.md § SP110E
 * Graph: family.sp110e / protocol.sp110e / identification.sp110e
 *
 * Honesty note: despite driving individually-addressable strips, the BLE
 * protocol only exposes WHOLE-STRIP color/brightness/white — no per-pixel
 * streaming (knowledge graph fact, corrected 2026-07-07). What it adds over
 * ELK-BLEDOM is a true 256-step brightness path and a real white channel
 * on RGBW ICs.
 *
 * WARNING (threat model M5a): SET_IC_MODEL (0x1c), SET_RGB_SEQ (0x3c) and
 * SET_LED_NUM (0x2d) mutate device configuration and can wedge a strip
 * into displaying garbage. They are deliberately NOT exposed as channels;
 * a future config tier will gate them behind double confirmation.
 */
import type { ChannelState, DeviceCapability } from "../core/types";
import { toRange } from "../core/value";
import { hex, type Driver, type IdentityEvidence, type ProbeIO } from "./driver";

const SVC_FFE0 = "0000ffe0-0000-1000-8000-00805f9b34fb";
const CHR_FFE1 = "0000ffe1-0000-1000-8000-00805f9b34fb"; // write + notify
const CHR_FFE2 = "0000ffe2-0000-1000-8000-00805f9b34fb"; // init handshake only

// Commands are 4 bytes: [d0 d1 d2 CMD].
const CMD_GET_INFO = 0x10;
const CMD_LED_ON = 0xaa;
const CMD_LED_OFF = 0xab;
const CMD_SET_COLOR = 0x1e;
const CMD_SET_BRIGHT = 0x2a;
const CMD_SET_WHITE = 0x69;
const CMD_SET_MODE = 0x2c;
const MODE_STATIC = 121;

function cmd(d0: number, d1: number, d2: number, c: number): Uint8Array {
  return hex(d0, d1, d2, c);
}

export const sp110eDriver: Driver = {
  family: "family.sp110e",
  label: "SP110E addressable-strip controller",

  chooserFilters: [{ namePrefix: "SP110E" }],
  services: [SVC_FFE0],
  writeChar: { [SVC_FFE0]: CHR_FFE1 },
  notifyChar: { [SVC_FFE0]: CHR_FFE1 },
  auxChars: { [SVC_FFE0]: [CHR_FFE2] },

  identify(e: IdentityEvidence): number {
    let score = 0;
    // SP105E/SP107E/SP611E advertise similarly but speak DIFFERENT
    // protocols — exact-model prefix only, never a looser "SP" match.
    if (e.name.startsWith("SP110E")) score += 0.7;
    // ffe0 collides with ELK variants and HM-10 UART modules; weak evidence.
    if (e.serviceUuids.includes(SVC_FFE0)) score += 0.25;
    return Math.min(score, 0.95);
  },

  // Init handshake — device drops the link without it (protocol.sp110e
  // quirk). ffe2 first, then a CHECK_DEVICE-style frame on ffe1.
  async postConnect(io: ProbeIO): Promise<void> {
    try {
      await io.writeTo(CHR_FFE2, hex(0x01, 0x00));
    } catch {
      // some clones lack ffe2; the ffe1 frame alone often suffices
    }
    await io.write(hex(0x01, 0xb7, 0xe3, 0xd5));
  },

  // Stage 3 probe: GET_INFO returns a 12-byte state frame on ffe1.
  async probe(io: ProbeIO): Promise<number | null> {
    await io.write(cmd(0, 0, 0, CMD_GET_INFO));
    const resp = await io.nextNotification(1500);
    if (!resp) return null;
    return resp.length === 12 ? 1.0 : 0.2;
  },

  /** F20: adopt current device state from GET_INFO. Layout `reported`
   *  (graph: protocol.sp110e get_info_response, from roslovets/SP110E):
   *  [1]=power [4]=brightness [9..11]=r,g,b. Parsed defensively; raw hex
   *  returned for field verification. */
  async readState(io: ProbeIO): Promise<{ state: Partial<ChannelState>; raw?: string } | null> {
    await io.write(cmd(0, 0, 0, CMD_GET_INFO));
    const resp = await io.nextNotification(1500);
    if (!resp) return null;
    const raw = [...resp].map((b) => b.toString(16).padStart(2, "0")).join(" ");
    if (resp.length !== 12) return { state: {}, raw };
    return {
      raw,
      state: {
        power: (resp[1] ?? 0) > 0 ? 1 : 0,
        brightness: (resp[4] ?? 0) / 255,
        r: (resp[9] ?? 0) / 255,
        g: (resp[10] ?? 0) / 255,
        b: (resp[11] ?? 0) / 255,
      },
    };
  },

  describe(): DeviceCapability {
    return {
      family: "family.sp110e",
      label: this.label,
      channels: [
        { id: "power", label: "Power", kind: "power", steps: 2,
          info: "Master switch for the whole strip." },
        { id: "r", label: "Red", kind: "r", steps: 256, wavelengthNm: 625,
          info: "Red subpixel level (~625 nm) sent to every pixel on the strip — whole-strip control, 256 levels." },
        { id: "g", label: "Green", kind: "g", steps: 256, wavelengthNm: 525,
          info: "Green subpixel level (~525 nm), whole strip, 256 levels." },
        { id: "b", label: "Blue", kind: "b", steps: 256, wavelengthNm: 470,
          info: "Blue subpixel level (~470 nm), whole strip, 256 levels." },
        { id: "brightness", label: "Brightness", kind: "w", steps: 256,
          info: "Global scaler the controller applies to every pixel's data — a real 256-step path, finer than most cheap gear." },
        { id: "w", label: "White diode (RGBW ICs only)", kind: "w", steps: 256,
          info: "Drives the dedicated white diode inside each pixel — only lights on RGBW ICs like SK6812 RGBW." },
      ],
      notes: [
        "Whole-strip control only: the BLE protocol has no per-pixel streaming.",
        "White channel only lights on RGBW ICs (e.g. SK6812 RGBW) with a 4-channel IC model configured.",
        "Pixel count / IC model / color order setters exist but are config-tier: not exposed here yet (see threat model M5a).",
      ],
    };
  },

  encode(state: ChannelState): Uint8Array[] {
    const on = (state["power"] ?? 1) >= 0.5;
    if (!on) return [cmd(0, 0, 0, CMD_LED_OFF)];
    return [
      cmd(0, 0, 0, CMD_LED_ON),
      cmd(MODE_STATIC, 0, 0, CMD_SET_MODE),
      cmd(
        toRange(state["r"] ?? 0, 255),
        toRange(state["g"] ?? 0, 255),
        toRange(state["b"] ?? 0, 255),
        CMD_SET_COLOR,
      ),
      cmd(toRange(state["brightness"] ?? 1, 255), 0, 0, CMD_SET_BRIGHT),
      cmd(toRange(state["w"] ?? 0, 255), 0, 0, CMD_SET_WHITE),
    ];
  },

  blinkTest(state: ChannelState): [Uint8Array[], Uint8Array[]] {
    return [[cmd(0, 0, 0, CMD_LED_OFF)], this.encode(state)];
  },
};
