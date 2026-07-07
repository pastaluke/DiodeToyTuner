/**
 * Minimal, honest UI. One connected device at a time (for now), channel
 * strips with true-step display, and gamepad "learn" binding per channel.
 */
import { nudge, quantize, toStep } from "./core/value";
import type { ChannelState, DeviceCapability } from "./core/types";
import { chooserRequest, identifyAll } from "./drivers/registry";
import { CONFIDENCE_WRITE_THRESHOLD } from "./drivers/driver";
import { BleDevice } from "./transport/ble";
import { GamepadSource } from "./input/gamepad";
import { HidSource } from "./input/hid";
import { MappingEngine, type InputEvent } from "./input/mapping";

const app = document.getElementById("app")!;

let ble: BleDevice | null = null;
let capability: DeviceCapability | null = null;
let state: ChannelState = {};
let learnTarget: string | null = null;

const mapping = new MappingEngine(
  (channelId, value) => setChannel(channelId, value),
  (channelId) => state[channelId] ?? 0,
);

let padLabels: string[] = [];
let hidLabels: string[] = [];

const gamepads = new GamepadSource(onInput, (labels) => {
  padLabels = labels;
  renderPads();
});
gamepads.start();

const hid = new HidSource(onInput, (labels) => {
  hidLabels = labels;
  renderPads();
});

function onInput(ev: InputEvent, dt: number): void {
  if (learnTarget && Math.abs(ev.value) > 0.6) {
    const isAxis = ev.controlKey.includes("axis");
    const isEncoder = ev.relative === true;
    mapping.addBinding({
      controlKey: ev.controlKey,
      channelId: learnTarget,
      mode: isAxis ? "absolute" : "relative",
      // Encoder detents nudge finely; held buttons/triggers sweep at 0.5/s.
      gain: isAxis ? 1 : isEncoder ? 0.01 : 0.5,
      curve: "linear",
      deadzone: 0.1,
    });
    learnTarget = null;
    render();
    return;
  }
  mapping.handle(ev, dt);
}

function setChannel(id: string, value: number): void {
  if (!capability || !ble) return;
  const channel = capability.channels.find((c) => c.id === id);
  if (!channel) return;
  const q = quantize(value, channel.steps);
  if (state[id] === q) return;
  state = { ...state, [id]: q };
  ble.setState(state);
  renderValues();
}

async function connect(): Promise<void> {
  try {
    const device = await navigator.bluetooth.requestDevice(chooserRequest());
    setStatus(`Connecting to “${device.name ?? "(unnamed)"}”…`);

    // We need service UUIDs for stage 2, so connect with the top candidate's
    // allowlist; identifyAll re-scores with real GATT evidence afterwards.
    const byName = identifyAll({ name: device.name ?? "", serviceUuids: [] });
    const candidate = byName[0];
    if (!candidate) {
      setStatus("No driver recognizes this device name. Refusing to guess (see docs/research/04).");
      return;
    }
    const dev = new BleDevice(device, candidate.driver);
    const foundServices = await dev.connect();

    const scored = identifyAll({ name: device.name ?? "", serviceUuids: foundServices });
    const best = scored.find((s) => s.driver === candidate.driver) ?? scored[0];
    if (!best) {
      setStatus("GATT layout does not match any driver. Refusing to write.");
      dev.disconnect();
      return;
    }

    // Init handshake first — SP110E-class hardware drops the link without
    // it, and probes depend on a live, initialized connection.
    await best.driver.postConnect?.(dev.probeIO());
    let confidence = best.confidence;
    if (best.driver.probe) {
      const probed = await best.driver.probe(dev.probeIO());
      if (probed !== null) confidence = probed;
    }

    ble = dev;
    capability = best.driver.describe();
    state = Object.fromEntries(capability.channels.map((c) => [c.id, c.kind === "power" ? 1 : 0]));

    if (confidence >= CONFIDENCE_WRITE_THRESHOLD) {
      dev.writeUnlocked = true;
      setStatus(`Connected: ${capability.label} — confidence ${confidence.toFixed(2)} ✓`);
    } else {
      setStatus(
        `Probable ${capability.label} (confidence ${confidence.toFixed(2)}). Run the blink test to unlock control.`,
      );
    }
    render();
  } catch (err) {
    setStatus(`Connect failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function blinkTest(): Promise<void> {
  if (!ble) return;
  ble.writeUnlocked = true; // temporarily, for the test frames only
  await ble.runBlinkTest(state);
  const confirmed = window.confirm(
    "Did the light you intend to control just blink?\n\nOK = yes, unlock control.\nCancel = no — stay locked (this may be the wrong device… possibly not even yours).",
  );
  ble.writeUnlocked = confirmed;
  setStatus(confirmed ? "Blink confirmed — control unlocked." : "Not confirmed — writes stay locked.");
  render();
}

function disconnect(): void {
  ble?.disconnect();
  ble = null;
  capability = null;
  state = {};
  setStatus("Disconnected.");
  render();
}

/* ── rendering ─────────────────────────────────────────────────────── */

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setStatus(text: string): void {
  const s = document.getElementById("status");
  if (s) s.textContent = text;
}

function renderPads(): void {
  const padsEl = document.getElementById("pads");
  if (padsEl) {
    const all = [...padLabels, ...hidLabels];
    padsEl.textContent = all.length
      ? all.join(" · ")
      : "No input devices. Connect a gamepad and press any button, or add a HID knob.";
  }
}

function renderValues(): void {
  if (!capability) return;
  for (const ch of capability.channels) {
    const v = state[ch.id] ?? 0;
    const slider = document.getElementById(`sl-${ch.id}`) as HTMLInputElement | null;
    const readout = document.getElementById(`ro-${ch.id}`);
    if (slider && document.activeElement !== slider) slider.value = String(v);
    if (readout) {
      readout.textContent = `${v.toFixed(6)} — step ${toStep(v, ch.steps)}/${ch.steps - 1}`;
    }
  }
}

function render(): void {
  app.textContent = "";

  const header = el("header");
  header.append(el("h1", "", "DiodeToyTuner"));
  header.append(el("p", "tagline", "Every knob the hardware has. Nothing it doesn't. [0…1]"));
  app.append(header);

  const bar = el("div", "bar");
  const connectBtn = el("button", "primary", ble ? "Disconnect" : "Connect a device") as HTMLButtonElement;
  connectBtn.onclick = () => (ble ? disconnect() : void connect());
  bar.append(connectBtn);
  if (ble && !ble.writeUnlocked) {
    const blinkBtn = el("button", "warn", "Run blink test") as HTMLButtonElement;
    blinkBtn.onclick = () => void blinkTest();
    bar.append(blinkBtn);
  }
  if (hid.supported) {
    const hidBtn = el("button", "", "＋ knob / HID device") as HTMLButtonElement;
    hidBtn.onclick = () =>
      void hid.requestDevice().catch((err: unknown) => {
        setStatus(`HID: ${err instanceof Error ? err.message : String(err)}`);
      });
    bar.append(hidBtn);
  }
  bar.append(el("span", "status", ""));
  bar.lastElementChild!.id = "status";
  app.append(bar);

  if (capability) {
    const strips = el("div", "strips");
    for (const ch of capability.channels) {
      const strip = el("div", `strip kind-${ch.kind}`);
      strip.append(el("label", "", ch.label + (ch.wavelengthNm ? ` (~${ch.wavelengthNm} nm)` : "")));

      const slider = el("input") as HTMLInputElement;
      slider.type = "range";
      slider.id = `sl-${ch.id}`;
      slider.min = "0";
      slider.max = "1";
      // Slider step = one true hardware step: arrow keys nudge exactly one.
      slider.step = String(1 / (ch.steps - 1));
      slider.value = String(state[ch.id] ?? 0);
      slider.oninput = () => setChannel(ch.id, Number(slider.value));
      strip.append(slider);

      const fine = el("div", "fine");
      const minus = el("button", "", "−1 step") as HTMLButtonElement;
      minus.onclick = () => setChannel(ch.id, nudge(state[ch.id] ?? 0, ch.steps, -1));
      const plus = el("button", "", "+1 step") as HTMLButtonElement;
      plus.onclick = () => setChannel(ch.id, nudge(state[ch.id] ?? 0, ch.steps, +1));
      const learn = el(
        "button",
        learnTarget === ch.id ? "learning" : "",
        learnTarget === ch.id ? "move a control…" : "🎮 learn",
      ) as HTMLButtonElement;
      learn.onclick = () => {
        learnTarget = learnTarget === ch.id ? null : ch.id;
        render();
      };
      fine.append(minus, plus, learn);
      strip.append(fine);

      strip.append(el("div", "readout", ""));
      (strip.lastElementChild as HTMLElement).id = `ro-${ch.id}`;
      strips.append(strip);
    }
    app.append(strips);

    if (capability.notes?.length) {
      const notes = el("ul", "notes");
      for (const n of capability.notes) notes.append(el("li", "", n));
      app.append(notes);
    }

    const bindings = mapping.getProfile().bindings;
    if (bindings.length) {
      const list = el("div", "bindings");
      list.append(el("h2", "", "Bindings"));
      for (const b of bindings) {
        const row = el("div", "binding", `${b.controlKey} → ${b.channelId} (${b.mode}, gain ${b.gain})`);
        const rm = el("button", "", "✕") as HTMLButtonElement;
        rm.onclick = () => {
          mapping.removeBinding(b.controlKey, b.channelId);
          render();
        };
        row.append(rm);
        list.append(row);
      }
      app.append(list);
    }
  } else {
    const empty = el("div", "empty");
    empty.append(
      el("p", "", "Connect a cheap BLE LED controller (ELK-BLEDOM / Lotus Lantern strips, Triones / HappyLighting bulbs) and tune every channel it exposes at its true hardware resolution."),
      el("p", "small", "Chromium-based browser required (Web Bluetooth). HTTPS or localhost only."),
    );
    app.append(empty);
  }

  const pads = el("div", "pads");
  pads.id = "pads";
  app.append(pads);
  renderPads();
  renderValues();
}

render();
