/**
 * Gamepad input source. Poll-based (the API has no motion events).
 * Standard mapping: 4 axes in [-1,1]; 17 buttons with analog .value in
 * [0,1] (triggers are buttons 6/7). A Stadia controller in Bluetooth mode
 * shows up here as a standard gamepad — no special casing needed.
 * See docs/research/03-web-platform-capabilities.md.
 */
import type { InputEvent } from "./mapping";

const AXIS_EPSILON = 0.005;
const BUTTON_EPSILON = 0.005;

export class GamepadSource {
  private prev = new Map<string, number>();
  private rafId = 0;
  private lastTime = 0;

  constructor(
    private readonly onEvent: (ev: InputEvent, dtSeconds: number) => void,
    private readonly onPadsChanged?: (labels: string[]) => void,
  ) {}

  start(): void {
    addEventListener("gamepadconnected", this.announce);
    addEventListener("gamepaddisconnected", this.announce);
    this.lastTime = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(0.1, (t - this.lastTime) / 1000);
      this.lastTime = t;
      this.poll(dt);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
    removeEventListener("gamepadconnected", this.announce);
    removeEventListener("gamepaddisconnected", this.announce);
  }

  private announce = (): void => {
    const labels = [...navigator.getGamepads()]
      .filter((p): p is Gamepad => p !== null)
      .map((p) => `gamepad${p.index}: ${p.id}`);
    this.onPadsChanged?.(labels);
  };

  private poll(dtSeconds: number): void {
    for (const pad of navigator.getGamepads()) {
      if (!pad) continue;
      pad.axes.forEach((value, i) => {
        this.emitIfChanged(`gamepad${pad.index}.axis${i}`, value, AXIS_EPSILON, dtSeconds);
      });
      pad.buttons.forEach((btn, i) => {
        this.emitIfChanged(`gamepad${pad.index}.button${i}`, btn.value, BUTTON_EPSILON, dtSeconds);
      });
    }
  }

  private emitIfChanged(key: string, value: number, eps: number, dt: number): void {
    const prev = this.prev.get(key) ?? 0;
    // Held analog controls must keep emitting for rate-based relative
    // bindings, so also emit when value is non-trivially deflected.
    if (Math.abs(value - prev) > eps || Math.abs(value) > 0.15) {
      this.prev.set(key, value);
      this.onEvent({ controlKey: key, value }, dt);
    } else if (prev !== 0 && value === 0) {
      this.prev.set(key, 0);
      this.onEvent({ controlKey: key, value: 0 }, dt);
    }
  }
}
