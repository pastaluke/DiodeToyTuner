/**
 * UI: channel strips with switchable value views (slider / hue wheel /
 * exact-step entry), a full binding editor (learn +/−, kinds, modifiers),
 * and shareable configuration profiles. Roadmap F1–F8.
 */
import { nudge, quantize, toStep } from "./core/value";
import type { Channel, ChannelState, DeviceCapability } from "./core/types";
import { chooserRequest, identifyAll } from "./drivers/registry";
import { CONFIDENCE_WRITE_THRESHOLD } from "./drivers/driver";
import { BleDevice } from "./transport/ble";
import { GamepadSource } from "./input/gamepad";
import { HidSource } from "./input/hid";
import {
  MappingEngine,
  type Binding,
  type BindingKind,
  type Curve,
  type InputEvent,
} from "./input/mapping";
import { runDiagnosis } from "./diagnostics";

const app = document.getElementById("app")!;

let ble: BleDevice | null = null;
let capability: DeviceCapability | null = null;
let state: ChannelState = {};
let diagnosisReport: string | null = null;

/** Learn capture in progress: which channel, which direction, or which
 *  existing binding we're adding a modifier to. */
let learn: { channelId: string; direction: 1 | -1 } | { modifierFor: Binding } | null = null;

const mapping = new MappingEngine(
  (channelId, value) => setChannel(channelId, value),
  (channelId) => state[channelId] ?? 0,
  (channelId) => capability?.channels.find((c) => c.id === channelId)?.steps ?? 256,
  () => saveProfile(),
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

/* ── learn & input ─────────────────────────────────────────────────── */

function defaultBindingFor(ev: InputEvent, channelId: string, direction: 1 | -1): Binding {
  const key = ev.controlKey;
  const axisMatch = /^(gamepad\d+)\.axis(\d+)$/.exec(key);
  if (ev.relative) {
    // Encoder detents → fine rate control, one detent ≈ 1/255 of range.
    return { channelId, kind: "rate", controlKey: key, direction, sensitivity: 1 / 255, curve: "linear", deadzone: 0, modifiers: [] };
  }
  if (axisMatch && Number(axisMatch[2]) < 4) {
    // Stick axis → rotary endless-encoder gesture with its sibling axis.
    const n = Number(axisMatch[2]);
    const pair = n % 2 === 0 ? n + 1 : n - 1;
    const x = n % 2 === 0 ? key : `${axisMatch[1]}.axis${pair}`;
    const y = n % 2 === 0 ? `${axisMatch[1]}.axis${pair}` : key;
    return { channelId, kind: "rotary", controlKey: x, controlKey2: y, direction, sensitivity: 2, curve: "linear", deadzone: 0.1, modifiers: [] };
  }
  if (key.includes("axis")) {
    return { channelId, kind: "absolute", controlKey: key, direction, sensitivity: 1, curve: "linear", deadzone: 0.1, modifiers: [] };
  }
  if (/\.button[67]$/.test(key)) {
    // Analog triggers → held-rate control.
    return { channelId, kind: "rate", controlKey: key, direction, sensitivity: 0.5, curve: "linear", deadzone: 0.05, modifiers: [] };
  }
  // Plain button (d-pad etc.) → exact hardware-step nudge.
  return { channelId, kind: "step", controlKey: key, direction, sensitivity: 1, curve: "linear", deadzone: 0, modifiers: [] };
}

function onInput(ev: InputEvent, dt: number): void {
  if (learn && Math.abs(ev.value) > 0.6) {
    if ("modifierFor" in learn) {
      if (!ev.relative) {
        learn.modifierFor.modifiers.push({ controlKey: ev.controlKey, scale: 4 });
        mapping.touch();
      }
    } else {
      mapping.addBinding(defaultBindingFor(ev, learn.channelId, learn.direction));
    }
    learn = null;
    render();
    return;
  }
  mapping.handle(ev, dt);
}

/* ── device state ──────────────────────────────────────────────────── */

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
    const byName = identifyAll({ name: device.name ?? "", serviceUuids: [] });
    const candidate = byName[0];
    if (!candidate) {
      setStatus("No driver recognizes this device name. Try 🔍 Diagnose (see docs/research/04).");
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
    await best.driver.postConnect?.(dev.probeIO());
    let confidence = best.confidence;
    if (best.driver.probe) {
      const probed = await best.driver.probe(dev.probeIO());
      if (probed !== null) confidence = probed;
    }
    ble = dev;
    capability = best.driver.describe();
    state = Object.fromEntries(capability.channels.map((c) => [c.id, c.kind === "power" ? 1 : 0]));
    loadProfile(capability.family);
    if (confidence >= CONFIDENCE_WRITE_THRESHOLD) {
      dev.writeUnlocked = true;
      setStatus(`Connected: ${capability.label} — confidence ${confidence.toFixed(2)} ✓`);
    } else {
      setStatus(`Probable ${capability.label} (confidence ${confidence.toFixed(2)}). Run the blink test to unlock control.`);
    }
    render();
  } catch (err) {
    setStatus(`Connect failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function blinkTest(): Promise<void> {
  if (!ble) return;
  ble.writeUnlocked = true;
  await ble.runBlinkTest(state);
  const confirmed = window.confirm(
    "Did the light you intend to control just blink?\n\nOK = yes, unlock control.\nCancel = no — stay locked.",
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

/* ── profiles (F1) ─────────────────────────────────────────────────── */

function profileKey(family: string): string {
  return `dtt.profile.${family}`;
}

function saveProfile(): void {
  const p = mapping.getProfile();
  if (p.family) localStorage.setItem(profileKey(p.family), JSON.stringify(p));
}

function loadProfile(family: string): void {
  const stored = localStorage.getItem(profileKey(family));
  if (stored) {
    try {
      const p = MappingEngine.parseProfile(stored);
      p.family = family;
      mapping.setProfile(p);
      return;
    } catch {
      // corrupted store — fall through to fresh profile
    }
  }
  mapping.setProfile({ name: `${family} setup`, family, bindings: [], views: {} });
}

function exportProfile(): void {
  const p = mapping.getProfile();
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${p.name.replaceAll(/[^\w-]+/g, "_") || "profile"}.dtt-profile.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importProfile(file: File): void {
  file
    .text()
    .then((text) => {
      const p = MappingEngine.parseProfile(text);
      if (capability && p.family && p.family !== capability.family) {
        if (!window.confirm(`Profile targets ${p.family}, but you're connected to ${capability.family}. Apply anyway?`)) return;
      }
      p.family = capability?.family ?? p.family;
      mapping.setProfile(p);
      setStatus(`Imported profile “${p.name}”.`);
      render();
    })
    .catch((err: unknown) => {
      setStatus(`Import rejected: ${err instanceof Error ? err.message : String(err)}`);
    });
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

function viewFor(ch: Channel): string {
  return mapping.getProfile().views?.[ch.id] ?? "slider";
}

function setView(ch: Channel, view: string): void {
  const p = mapping.getProfile();
  p.views = { ...(p.views ?? {}), [ch.id]: view };
  mapping.touch();
  render();
}

function renderValues(): void {
  if (!capability) return;
  for (const ch of capability.channels) {
    const v = state[ch.id] ?? 0;
    const slider = document.getElementById(`sl-${ch.id}`) as HTMLInputElement | null;
    if (slider && document.activeElement !== slider) slider.value = String(v);
    const stepsInput = document.getElementById(`st-${ch.id}`) as HTMLInputElement | null;
    if (stepsInput && document.activeElement !== stepsInput) {
      stepsInput.value = String(toStep(v, ch.steps));
    }
    const dot = document.getElementById(`dot-${ch.id}`);
    if (dot) {
      const deg = v * 360;
      dot.style.transform = `rotate(${deg}deg) translate(0, -64px)`;
    }
    const readout = document.getElementById(`ro-${ch.id}`);
    if (readout) readout.textContent = `${v.toFixed(6)} — step ${toStep(v, ch.steps)}/${ch.steps - 1}`;
  }
}

function widgetFor(ch: Channel): HTMLElement {
  const view = viewFor(ch);
  if (view === "wheel" && ch.kind === "hue") {
    const wheel = el("div", "wheel");
    const dot = el("div", "wheel-dot");
    dot.id = `dot-${ch.id}`;
    wheel.append(dot);
    const setFromPointer = (e: PointerEvent) => {
      const rect = wheel.getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      // 0° at top, clockwise — matches the dot transform.
      const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
      setChannel(ch.id, ((deg + 360) % 360) / 360);
    };
    wheel.addEventListener("pointerdown", (e) => {
      wheel.setPointerCapture(e.pointerId);
      setFromPointer(e);
    });
    wheel.addEventListener("pointermove", (e) => {
      if (e.buttons > 0) setFromPointer(e);
    });
    return wheel;
  }
  if (view === "steps") {
    const input = el("input", "steps-input") as HTMLInputElement;
    input.type = "number";
    input.id = `st-${ch.id}`;
    input.min = "0";
    input.max = String(ch.steps - 1);
    input.value = String(toStep(state[ch.id] ?? 0, ch.steps));
    input.oninput = () => {
      const idx = Math.max(0, Math.min(ch.steps - 1, Number(input.value) || 0));
      setChannel(ch.id, idx / (ch.steps - 1));
    };
    return input;
  }
  const slider = el("input") as HTMLInputElement;
  slider.type = "range";
  slider.id = `sl-${ch.id}`;
  slider.min = "0";
  slider.max = "1";
  slider.step = String(1 / (ch.steps - 1));
  slider.value = String(state[ch.id] ?? 0);
  slider.oninput = () => setChannel(ch.id, Number(slider.value));
  return slider;
}

function bindingRow(b: Binding): HTMLElement {
  const row = el("div", "binding");

  const desc = el("span", "b-control", b.controlKey + (b.controlKey2 ? `+${b.controlKey2.split(".")[1]}` : ""));
  const arrow = el("span", "b-arrow", `→ ${b.channelId}`);

  const kind = el("select") as HTMLSelectElement;
  for (const k of ["rotary", "rate", "step", "absolute"] as BindingKind[]) {
    const o = el("option", "", k) as HTMLOptionElement;
    o.value = k;
    if (k === b.kind) o.selected = true;
    kind.append(o);
  }
  kind.onchange = () => {
    b.kind = kind.value as BindingKind;
    if (b.kind === "rotary" && !b.controlKey2) {
      const m = /^(gamepad\d+)\.axis(\d+)$/.exec(b.controlKey);
      if (m) {
        const n = Number(m[2]);
        b.controlKey2 = `${m[1]}.axis${n % 2 === 0 ? n + 1 : n - 1}`;
      }
    }
    mapping.touch();
    render();
  };

  const dir = el("select") as HTMLSelectElement;
  for (const [label, val] of [["+", 1], ["−", -1]] as const) {
    const o = el("option", "", label) as HTMLOptionElement;
    o.value = String(val);
    if (val === b.direction) o.selected = true;
    dir.append(o);
  }
  dir.onchange = () => {
    b.direction = Number(dir.value) as 1 | -1;
    mapping.touch();
  };

  const sens = el("input") as HTMLInputElement;
  sens.type = "number";
  sens.step = "any";
  sens.value = String(b.sensitivity);
  sens.title =
    b.kind === "rotary" ? "revolutions per full sweep"
    : b.kind === "step" ? "hardware steps per press"
    : b.kind === "rate" ? "full range per second (or per detent)"
    : "unused for absolute";
  sens.className = "b-sens";
  sens.onchange = () => {
    const v = Number(sens.value);
    if (Number.isFinite(v) && v > 0) {
      b.sensitivity = v;
      mapping.touch();
    }
  };

  const curve = el("select") as HTMLSelectElement;
  for (const c of ["linear", "squared", "cubed"] as Curve[]) {
    const o = el("option", "", c) as HTMLOptionElement;
    o.value = c;
    if (c === b.curve) o.selected = true;
    curve.append(o);
  }
  curve.onchange = () => {
    b.curve = curve.value as Curve;
    mapping.touch();
  };

  const mods = el("span", "b-mods");
  for (const m of b.modifiers) {
    const chip = el("span", "mod-chip");
    chip.append(el("span", "", `⇧${m.controlKey.split(".")[1] ?? m.controlKey} ×`));
    const scale = el("input") as HTMLInputElement;
    scale.type = "number";
    scale.step = "any";
    scale.value = String(m.scale);
    scale.className = "mod-scale";
    scale.title = ">1 = faster/coarser while held, <1 = finer";
    scale.onchange = () => {
      const v = Number(scale.value);
      if (Number.isFinite(v) && v > 0) {
        m.scale = v;
        mapping.touch();
      }
    };
    const rm = el("button", "tiny", "✕") as HTMLButtonElement;
    rm.onclick = () => {
      b.modifiers = b.modifiers.filter((x) => x !== m);
      mapping.touch();
      render();
    };
    chip.append(scale, rm);
    mods.append(chip);
  }
  const addMod = el("button", "tiny", learn && "modifierFor" in learn && learn.modifierFor === b ? "press a control…" : "+mod") as HTMLButtonElement;
  addMod.onclick = () => {
    learn = learn && "modifierFor" in learn && learn.modifierFor === b ? null : { modifierFor: b };
    render();
  };
  mods.append(addMod);

  const del = el("button", "tiny", "✕") as HTMLButtonElement;
  del.onclick = () => {
    mapping.removeBinding(b);
    render();
  };

  row.append(desc, arrow, kind, dir, sens, curve, mods, del);
  return row;
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
  const diagBtn = el("button", "", "🔍 Diagnose a device") as HTMLButtonElement;
  diagBtn.onclick = () => {
    setStatus("Diagnosing… pick ANY device (read-only, no commands sent).");
    void runDiagnosis()
      .then((report) => {
        diagnosisReport = report;
        setStatus("Diagnosis complete — report below.");
        render();
      })
      .catch((err: unknown) => setStatus(`Diagnosis failed: ${err instanceof Error ? err.message : String(err)}`));
  };
  bar.append(diagBtn);
  if (hid.supported) {
    const hidBtn = el("button", "", "＋ knob / HID device") as HTMLButtonElement;
    hidBtn.onclick = () =>
      void hid.requestDevice().catch((err: unknown) => setStatus(`HID: ${err instanceof Error ? err.message : String(err)}`));
    bar.append(hidBtn);
  }
  bar.append(el("span", "status", ""));
  bar.lastElementChild!.id = "status";
  app.append(bar);

  if (capability) {
    const strips = el("div", "strips");
    for (const ch of capability.channels) {
      const strip = el("div", `strip kind-${ch.kind}`);
      const head = el("div", "strip-head");
      head.append(el("label", "", ch.label + (ch.wavelengthNm ? ` (~${ch.wavelengthNm} nm)` : "")));
      const viewSel = el("select", "view-select") as HTMLSelectElement;
      const options = ["slider", ...(ch.kind === "hue" ? ["wheel"] : []), "steps"];
      for (const v of options) {
        const o = el("option", "", v) as HTMLOptionElement;
        o.value = v;
        if (v === viewFor(ch)) o.selected = true;
        viewSel.append(o);
      }
      viewSel.onchange = () => setView(ch, viewSel.value);
      head.append(viewSel);
      strip.append(head);

      strip.append(widgetFor(ch));

      const fine = el("div", "fine");
      const minus = el("button", "", "−1 step") as HTMLButtonElement;
      minus.onclick = () => setChannel(ch.id, nudge(state[ch.id] ?? 0, ch.steps, -1));
      const plus = el("button", "", "+1 step") as HTMLButtonElement;
      plus.onclick = () => setChannel(ch.id, nudge(state[ch.id] ?? 0, ch.steps, +1));
      const learnPlus = el(
        "button",
        learn && "channelId" in learn && learn.channelId === ch.id && learn.direction === 1 ? "learning" : "",
        learn && "channelId" in learn && learn.channelId === ch.id && learn.direction === 1 ? "move a control…" : "🎮 learn +",
      ) as HTMLButtonElement;
      learnPlus.onclick = () => {
        learn = learn && "channelId" in learn && learn.channelId === ch.id && learn.direction === 1 ? null : { channelId: ch.id, direction: 1 };
        render();
      };
      const learnMinus = el(
        "button",
        learn && "channelId" in learn && learn.channelId === ch.id && learn.direction === -1 ? "learning" : "",
        learn && "channelId" in learn && learn.channelId === ch.id && learn.direction === -1 ? "move a control…" : "🎮 learn −",
      ) as HTMLButtonElement;
      learnMinus.onclick = () => {
        learn = learn && "channelId" in learn && learn.channelId === ch.id && learn.direction === -1 ? null : { channelId: ch.id, direction: -1 };
        render();
      };
      fine.append(minus, plus, learnPlus, learnMinus);
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

    // Profile section (F1)
    const prof = el("div", "profile");
    prof.append(el("h2", "", "Profile"));
    const nameInput = el("input", "profile-name") as HTMLInputElement;
    nameInput.value = mapping.getProfile().name;
    nameInput.onchange = () => {
      mapping.getProfile().name = nameInput.value;
      mapping.touch();
    };
    const exportBtn = el("button", "", "Export") as HTMLButtonElement;
    exportBtn.onclick = exportProfile;
    const importInput = el("input") as HTMLInputElement;
    importInput.type = "file";
    importInput.accept = ".json,application/json";
    importInput.style.display = "none";
    importInput.onchange = () => {
      const f = importInput.files?.[0];
      if (f) importProfile(f);
      importInput.value = "";
    };
    const importBtn = el("button", "", "Import") as HTMLButtonElement;
    importBtn.onclick = () => importInput.click();
    prof.append(nameInput, exportBtn, importBtn, importInput);
    app.append(prof);

    const bindings = mapping.getProfile().bindings;
    if (bindings.length) {
      const list = el("div", "bindings");
      list.append(el("h2", "", "Bindings"));
      for (const b of bindings) list.append(bindingRow(b));
      app.append(list);
    }
  } else {
    const empty = el("div", "empty");
    empty.append(
      el("p", "", "Connect a cheap BLE LED controller (Lotus Lantern / ELK-BLEDOM strips, Triones / HappyLighting bulbs, Zengge LEDnetWF lamps, SP110E) and tune every channel it exposes at its true hardware resolution."),
      el("p", "small", "Chromium-based browser required (Web Bluetooth). HTTPS or localhost only."),
    );
    app.append(empty);
  }

  if (diagnosisReport) {
    const diag = el("div", "diagnosis");
    diag.append(el("h2", "", "Device diagnosis"));
    const pre = el("pre", "", diagnosisReport);
    const copy = el("button", "", "Copy report") as HTMLButtonElement;
    copy.onclick = () => void navigator.clipboard.writeText(diagnosisReport ?? "");
    const close = el("button", "", "Dismiss") as HTMLButtonElement;
    close.onclick = () => {
      diagnosisReport = null;
      render();
    };
    diag.append(pre, copy, close);
    app.append(diag);
  }

  const pads = el("div", "pads");
  pads.id = "pads";
  app.append(pads);
  renderPads();
  renderValues();
}

render();
