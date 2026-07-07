/**
 * WebHID input source — rotary encoders, jog wheels, DIY knobs.
 * Chromium desktop only (docs/research/03-web-platform-capabilities.md).
 *
 * Two parsing strategies:
 *  1. Reference knob (hardware/encoder-knob): vendor usage page 0xFF60,
 *     2-byte report [int8 encoderDelta, uint8 buttonBits] → clean relative
 *     detent events, the ideal input for fine channel nudging.
 *  2. Generic fallback: any other HID device is exposed byte-by-byte as
 *     absolute controls (value/255). Crude but lets people experiment with
 *     whatever gadget they have; a proper report-descriptor parser is a
 *     welcome contribution.
 */
import type { InputEvent } from "./mapping";

const REF_KNOB_USAGE_PAGE = 0xff60;

export class HidSource {
  private devices: HIDDevice[] = [];

  constructor(
    private readonly onEvent: (ev: InputEvent, dtSeconds: number) => void,
    private readonly onDevicesChanged?: (labels: string[]) => void,
  ) {}

  get supported(): boolean {
    return "hid" in navigator;
  }

  /** Must be called from a user gesture (browser requirement). */
  async requestDevice(): Promise<void> {
    if (!this.supported) throw new Error("WebHID not available (Chromium desktop only)");
    const granted = await navigator.hid.requestDevice({ filters: [] });
    for (const device of granted) {
      if (this.devices.includes(device)) continue;
      if (!device.opened) await device.open();
      const isRefKnob = device.collections.some((c) => c.usagePage === REF_KNOB_USAGE_PAGE);
      const key = `hid${this.devices.length}`;
      const prev = new Map<number, number>();
      device.addEventListener("inputreport", (ev: HIDInputReportEvent) => {
        if (isRefKnob) {
          this.parseRefKnob(key, ev.data);
        } else {
          this.parseGenericBytes(key, ev.data, prev);
        }
      });
      this.devices.push(device);
    }
    this.announce();
  }

  private parseRefKnob(key: string, data: DataView): void {
    if (data.byteLength < 2) return;
    const delta = data.getInt8(0); // signed detent count since last report
    if (delta !== 0) {
      this.onEvent({ controlKey: `${key}.dial0`, value: delta, relative: true }, 0);
    }
    const buttons = data.getUint8(1);
    for (let b = 0; b < 8; b++) {
      const pressed = (buttons >> b) & 1;
      this.onEvent({ controlKey: `${key}.button${b}`, value: pressed }, 0);
    }
  }

  private parseGenericBytes(key: string, data: DataView, prev: Map<number, number>): void {
    for (let i = 0; i < Math.min(data.byteLength, 16); i++) {
      const v = data.getUint8(i);
      if (prev.get(i) !== v) {
        prev.set(i, v);
        this.onEvent({ controlKey: `${key}.byte${i}`, value: v / 255 }, 0);
      }
    }
  }

  private announce(): void {
    this.onDevicesChanged?.(
      this.devices.map((d, i) => `hid${i}: ${d.productName || "(unnamed HID device)"}`),
    );
  }
}
