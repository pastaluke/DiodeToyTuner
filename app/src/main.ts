/**
 * UI shell (roadmap F17): Control / Controller / Animations sections over
 * shared state. Everything is capability-driven (P1) — no channel ids or
 * families hardcoded in the UI.
 */
import { nudge, quantize, toStep } from "./core/value";
import { hsvToRgb } from "./core/color";
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
import { AnimationEngine, animations } from "./animations";
import { runDiagnosis } from "./diagnostics";

const app = document.getElementById("app")!;

let ble: BleDevice | null = null;
let capability: DeviceCapability | null = null;
let state: ChannelState = {};
let diagnosisReport: string | null = null;
let tab: string = localStorage.getItem("dtt.tab") ?? "control";
let pin: string = localStorage.getItem("dtt.pin") ?? "off"; // off | top | bottom
const infoOpen = new Set<string>();
/** Last hue/sat set via the combined wheel (needed on RGB-native families). */
let combined = { h: 0, s: 1 };

let learn: { channelId: string; direction: 1 | -1 } | { modifierFor: Binding } | null = null;

function channelById(id: string): Channel | undefined {
  return capability?.channels.find((c) => c.id === id);
}

const mapping = new MappingEngine(
  (channelId, value) => setChannel(channelId, value),
  (channelId) => state[channelId] ?? 0,
  (channelId) => {
    const ch = channelById(channelId);
    return { steps: ch?.steps ?? 256, cyclic: ch?.cyclic ?? false };
  },
  () => saveProfile(),
);

/* Animations (F16): output goes through setChannel like everything else;
   manual input on any channel stops the running animation (AC3). */
let animApplying = false;
const anim = new AnimationEngine(() => {
  if (!capability) return null;
  return {
    channels: capability.channels,
    get: (id: string) => state[id] ?? 0,
    set: (id: string, v: number) => {
      animApplying = true;
      setChannel(id, v);
      animApplying = false;
    },
  };
});

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
  const isButton = !ev.relative && !key.includes("axis");
  const target = channelById(channelId);
  if (isButton && (target?.steps ?? 0) === 2 && !/\.button[67]$/.test(key)) {
    // Binary channel + plain button → toggle (F10): Start flips power.
    return { channelId, kind: "toggle", controlKey: key, direction, sensitivity: 1, curve: "linear", deadzone: 0, modifiers: [] };
  }
  if (ev.relative) {
    return { channelId, kind: "rate", controlKey: key, direction, sensitivity: 1 / 255, curve: "linear", deadzone: 0, modifiers: [] };
  }
  if (axisMatch && Number(axisMatch[2]) < 4) {
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
    return { channelId, kind: "rate", controlKey: key, direction, sensitivity: 0.5, curve: "linear", deadzone: 0.05, modifiers: [] };
  }
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
  const channel = channelById(id);
  if (!channel) return;
  if (!animApplying && anim.running) anim.stop(); // F16 AC3: user input wins
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
      setStatus("No driver recognizes this device name. Try 🔍 Diagnose.");
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
  anim.stop();
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
      /* corrupted store — fresh profile below */
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
    .catch((err: unknown) => setStatus(`Import rejected: ${err instanceof Error ? err.message : String(err)}`));
}

/* ── derived color state (F14/F15, family-agnostic) ────────────────── */

function findKind(kind: string): Channel | undefined {
  return capability?.channels.find((c) => c.kind === kind);
}

function hasColorWheel(): boolean {
  return !!(findKind("hue") || (findKind("r") && findKind("g") && findKind("b")));
}

/** What the physical diodes are doing right now, as unit drive levels. */
function diodeDrive(): { r: number; g: number; b: number; w: number | null } {
  const hueCh = findKind("hue");
  let r = 0, g = 0, b = 0;
  if (hueCh) {
    const s = findKind("sat");
    const v = findKind("val");
    const rgb = hsvToRgb(state[hueCh.id] ?? 0, s ? state[s.id] ?? 1 : 1, v ? state[v.id] ?? 0 : 1);
    r = rgb.r; g = rgb.g; b = rgb.b;
  } else {
    const mult = state["brightness"] ?? 1;
    r = (state["r"] ?? 0) * mult;
    g = (state["g"] ?? 0) * mult;
    b = (state["b"] ?? 0) * mult;
  }
  // Dedicated white diode, if the family has one (not the brightness multiplier).
  const wCh = capability?.channels.find(
    (c) => (c.kind === "w" || c.kind === "ww") && c.id !== "brightness",
  );
  const w = wCh ? state[wCh.id === "whiteTemp" ? "whiteBright" : wCh.id] ?? 0 : null;
  // Exclusive white mode shuts off RGB (Triones, LEDnetWF).
  const whiteExclusive = capability?.channels.some((c) => c.exclusiveGroup === "white");
  if (whiteExclusive && (w ?? 0) > 0) { r = 0; g = 0; b = 0; }
  const powered = (state["power"] ?? 1) >= 0.5;
  if (!powered) return { r: 0, g: 0, b: 0, w: w === null ? null : 0 };
  return { r, g, b, w };
}

function applyCombined(h: number, s: number): void {
  combined = { h, s };
  const hueCh = findKind("hue");
  if (hueCh) {
    setChannel(hueCh.id, h);
    const satCh = findKind("sat");
    if (satCh) setChannel(satCh.id, s);
    return;
  }
  const rgb = hsvToRgb(h, s, 1); // brightness multiplier channel scales overall
  const r = findKind("r"), g = findKind("g"), b = findKind("b");
  if (r && g && b) {
    setChannel(r.id, rgb.r);
    setChannel(g.id, rgb.g);
    setChannel(b.id, rgb.b);
  }
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
function pref(key: string): string | undefined {
  return mapping.getProfile().views?.[key];
}
function setPref(key: string, v: string): void {
  const p = mapping.getProfile();
  p.views = { ...(p.views ?? {}), [key]: v };
  mapping.touch();
  render();
}

function fallbackInfo(ch: Channel): string {
  switch (ch.kind) {
    case "power": return "Master switch: cuts or restores drive current to the diodes.";
    case "hue": return "Which blend of the color diodes is driven — an angle on the color circle.";
    case "sat": return "Color purity: lower values blend the diodes toward white.";
    case "val": return "Duty cycle of the color diodes — how long they conduct each PWM period.";
    case "w": case "cw": case "ww": return "Drive level of a white diode or overall intensity path.";
    default: return "Drive level (duty cycle) of this diode rail.";
  }
}

function renderValues(): void {
  if (!capability) return;
  for (const ch of capability.channels) {
    const v = state[ch.id] ?? 0;
    const slider = document.getElementById(`sl-${ch.id}`) as HTMLInputElement | null;
    if (slider && document.activeElement !== slider) slider.value = String(v);
    const stepsInput = document.getElementById(`st-${ch.id}`) as HTMLInputElement | null;
    if (stepsInput && document.activeElement !== stepsInput) stepsInput.value = String(toStep(v, ch.steps));
    const dot = document.getElementById(`dot-${ch.id}`);
    if (dot) dot.style.transform = `rotate(${v * 360}deg) translate(0, -64px)`;
    const readout = document.getElementById(`ro-${ch.id}`);
    if (readout) readout.textContent = `${v.toFixed(6)} — step ${toStep(v, ch.steps)}/${ch.steps - 1}`;
  }
  // combined wheel marker
  const cwDot = document.getElementById("cw-dot");
  if (cwDot) {
    const hueCh = findKind("hue");
    const satCh = findKind("sat");
    const h = hueCh ? state[hueCh.id] ?? 0 : combined.h;
    const s = satCh ? state[satCh.id] ?? 1 : combined.s;
    cwDot.style.transform = `rotate(${h * 360}deg) translate(0, ${-s * 80}px)`;
  }
  // diode banks (inline + pinned copies share ids via class lookup)
  const d = diodeDrive();
  for (const bank of document.querySelectorAll<HTMLElement>(".diode-bank")) {
    const set = (name: string, drive: number | null, rr: number, gg: number, bb: number) => {
      const dotEl = bank.querySelector<HTMLElement>(`.d-${name}`);
      if (!dotEl) return;
      if (drive === null) {
        dotEl.style.opacity = "0.15";
        dotEl.style.boxShadow = "none";
        return;
      }
      const a = drive;
      dotEl.style.background = `rgba(${rr},${gg},${bb},${Math.max(0.08, a)})`;
      dotEl.style.boxShadow = a > 0.02 ? `0 0 ${8 + a * 26}px rgba(${rr},${gg},${bb},${a})` : "none";
    };
    set("r", d.r, 255, 60, 60);
    set("g", d.g, 80, 255, 110);
    set("b", d.b, 90, 140, 255);
    set("w", d.w, 244, 244, 232);
  }
}

function diodeBank(cls: string): HTMLElement {
  const bank = el("div", `diode-bank ${cls}`);
  bank.append(el("span", "bank-label", "diodes:"));
  for (const [name, label] of [["r", "R"], ["g", "G"], ["b", "B"], ["w", "W"]] as const) {
    const wrapEl = el("span", "diode-wrap");
    wrapEl.append(el("span", `diode d-${name}`), el("span", "diode-name", label));
    bank.append(wrapEl);
  }
  const pinBtns = el("span", "pin-btns");
  for (const [label, mode] of [["📌↑", "top"], ["📌↓", "bottom"], ["✕", "off"]] as const) {
    if (pin === mode) continue;
    const btn = el("button", "tiny", label) as HTMLButtonElement;
    btn.title = mode === "off" ? "unpin" : `pin to ${mode}`;
    btn.onclick = () => {
      pin = mode;
      localStorage.setItem("dtt.pin", pin);
      render();
    };
    pinBtns.append(btn);
  }
  bank.append(pinBtns);
  return bank;
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
  if (ch.kind === "hue") slider.className = "hue-track"; // spectrum track (F12)
  slider.id = `sl-${ch.id}`;
  slider.min = "0";
  slider.max = "1";
  slider.step = String(1 / (ch.steps - 1));
  slider.value = String(state[ch.id] ?? 0);
  slider.oninput = () => setChannel(ch.id, Number(slider.value));
  return slider;
}

function combinedWheel(): HTMLElement {
  const box = el("div", "combined");
  const head = el("div", "strip-head");
  head.append(el("label", "", "Combined color (hue + saturation)"));
  const hide = el("button", "tiny", "hide") as HTMLButtonElement;
  hide.onclick = () => setPref("__combined", "off");
  head.append(hide);
  box.append(head);
  const wheel = el("div", "wheel wheel-2d");
  const dot = el("div", "wheel-dot");
  dot.id = "cw-dot";
  wheel.append(dot);
  const setFromPointer = (e: PointerEvent) => {
    const rect = wheel.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    const radius = Math.min(1, Math.hypot(dx, dy) / (rect.width / 2));
    applyCombined(((deg + 360) % 360) / 360, radius);
  };
  wheel.addEventListener("pointerdown", (e) => {
    wheel.setPointerCapture(e.pointerId);
    setFromPointer(e);
  });
  wheel.addEventListener("pointermove", (e) => {
    if (e.buttons > 0) setFromPointer(e);
  });
  box.append(wheel);
  return box;
}

function renderControlTab(root: HTMLElement): void {
  if (!capability) return;
  if (hasColorWheel()) {
    if (pref("__combined") !== "off") {
      root.append(combinedWheel());
    } else {
      const show = el("button", "", "🎨 show combined color wheel") as HTMLButtonElement;
      show.onclick = () => setPref("__combined", "on");
      root.append(show);
    }
  }

  const strips = el("div", "strips");
  for (const ch of capability.channels) {
    const strip = el("div", `strip kind-${ch.kind}`);
    const head = el("div", "strip-head");
    const labelWrap = el("span", "label-wrap");
    labelWrap.append(el("label", "", ch.label + (ch.wavelengthNm ? ` (~${ch.wavelengthNm} nm)` : "")));
    const infoBtn = el("button", "tiny info-btn", "ⓘ") as HTMLButtonElement;
    infoBtn.title = ch.info ?? fallbackInfo(ch);
    infoBtn.onclick = () => {
      if (infoOpen.has(ch.id)) infoOpen.delete(ch.id);
      else infoOpen.add(ch.id);
      render();
    };
    labelWrap.append(infoBtn);
    head.append(labelWrap);
    const viewSel = el("select", "view-select") as HTMLSelectElement;
    for (const v of ["slider", ...(ch.kind === "hue" ? ["wheel"] : []), "steps"]) {
      const o = el("option", "", v) as HTMLOptionElement;
      o.value = v;
      if (v === viewFor(ch)) o.selected = true;
      viewSel.append(o);
    }
    viewSel.onchange = () => setView(ch, viewSel.value);
    head.append(viewSel);
    strip.append(head);
    if (infoOpen.has(ch.id)) strip.append(el("p", "info-pop", ch.info ?? fallbackInfo(ch)));

    strip.append(widgetFor(ch));

    const fine = el("div", "fine");
    const minus = el("button", "", "−1 step") as HTMLButtonElement;
    minus.onclick = () => setChannel(ch.id, nudge(state[ch.id] ?? 0, ch.steps, -1, ch.cyclic));
    const plus = el("button", "", "+1 step") as HTMLButtonElement;
    plus.onclick = () => setChannel(ch.id, nudge(state[ch.id] ?? 0, ch.steps, +1, ch.cyclic));
    const mkLearn = (direction: 1 | -1): HTMLButtonElement => {
      const active = learn && "channelId" in learn && learn.channelId === ch.id && learn.direction === direction;
      const btn = el("button", active ? "learning" : "", active ? "move a control…" : `🎮 learn ${direction === 1 ? "+" : "−"}`) as HTMLButtonElement;
      btn.onclick = () => {
        learn = active ? null : { channelId: ch.id, direction };
        render();
      };
      return btn;
    };
    // F11: − left of +, matching slider direction.
    fine.append(minus, plus, mkLearn(-1), mkLearn(1));
    strip.append(fine);

    strip.append(el("div", "readout", ""));
    (strip.lastElementChild as HTMLElement).id = `ro-${ch.id}`;
    strips.append(strip);
  }
  root.append(strips);

  if (pin === "off") root.append(diodeBank("inline"));

  if (capability.notes?.length) {
    const notes = el("ul", "notes");
    for (const n of capability.notes) notes.append(el("li", "", n));
    root.append(notes);
  }
}

function bindingRow(b: Binding): HTMLElement {
  const row = el("div", "binding");
  row.append(
    el("span", "b-control", b.controlKey + (b.controlKey2 ? `+${b.controlKey2.split(".")[1]}` : "")),
    el("span", "b-arrow", `→ ${b.channelId}`),
  );

  const kind = el("select") as HTMLSelectElement;
  for (const k of ["rotary", "rate", "step", "toggle", "absolute"] as BindingKind[]) {
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
    : b.kind === "toggle" ? "unused for toggle"
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
  const addModActive = learn && "modifierFor" in learn && learn.modifierFor === b;
  const addMod = el("button", "tiny", addModActive ? "press a control…" : "+mod") as HTMLButtonElement;
  addMod.onclick = () => {
    learn = addModActive ? null : { modifierFor: b };
    render();
  };
  mods.append(addMod);

  const del = el("button", "tiny", "✕") as HTMLButtonElement;
  del.onclick = () => {
    mapping.removeBinding(b);
    render();
  };

  row.append(kind, dir, sens, curve, mods, del);
  return row;
}

function renderControllerTab(root: HTMLElement): void {
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
  root.append(prof);

  const bindings = mapping.getProfile().bindings;
  const list = el("div", "bindings");
  list.append(el("h2", "", "Bindings"));
  if (bindings.length) {
    for (const b of bindings) list.append(bindingRow(b));
  } else {
    list.append(el("p", "small", "No bindings yet — use 🎮 learn buttons on the Control tab."));
  }
  root.append(list);
}

function renderAnimationsTab(root: HTMLElement): void {
  root.append(
    el("p", "small",
      "Client-driven animations: values stream through the same paced, flash-limited transport as your sliders — works on every supported family, including write-only ones. Touching any control stops the animation."),
  );
  const list = el("div", "anims");
  for (const a of animations) {
    const row = el("div", "anim-row");
    row.append(el("span", "", a.name));
    const btn = el("button", anim.running?.id === a.id ? "warn" : "primary", anim.running?.id === a.id ? "Stop" : "Start") as HTMLButtonElement;
    btn.onclick = () => {
      if (anim.running?.id === a.id) anim.stop();
      else anim.start(a);
      render();
    };
    row.append(btn);
    list.append(row);
  }
  const speedRow = el("div", "anim-row");
  speedRow.append(el("span", "", "Speed"));
  const speed = el("input") as HTMLInputElement;
  speed.type = "range";
  speed.min = "0";
  speed.max = "1";
  speed.step = "0.01";
  speed.value = String(anim.speed);
  speed.oninput = () => {
    anim.speed = Number(speed.value);
  };
  speedRow.append(speed);
  list.append(speedRow);
  root.append(list);
  root.append(
    el("p", "small",
      "Coming: device-native effect engines (e.g. LEDnetWF's built-in effects) exposed per family, and a WLED-inspired effect library."),
  );
}

function render(): void {
  app.textContent = "";
  document.querySelectorAll(".diode-bank.pinned").forEach((n) => n.remove());

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
  const diagBtn = el("button", "", "🔍 Diagnose") as HTMLButtonElement;
  diagBtn.onclick = () => {
    setStatus("Diagnosing… pick ANY device (read-only).");
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
    const hidBtn = el("button", "", "＋ knob") as HTMLButtonElement;
    hidBtn.onclick = () =>
      void hid.requestDevice().catch((err: unknown) => setStatus(`HID: ${err instanceof Error ? err.message : String(err)}`));
    bar.append(hidBtn);
  }
  bar.append(el("span", "status", ""));
  bar.lastElementChild!.id = "status";
  app.append(bar);

  if (capability) {
    // F17: section tabs over shared state.
    const nav = el("nav", "tabs");
    for (const [id, label] of [["control", "Control"], ["controller", "Controller"], ["animations", "Animations"]] as const) {
      const t = el("button", tab === id ? "tab active" : "tab", label) as HTMLButtonElement;
      t.onclick = () => {
        tab = id;
        localStorage.setItem("dtt.tab", tab);
        render();
      };
      nav.append(t);
    }
    app.append(nav);

    const section = el("div", "section");
    if (tab === "controller") renderControllerTab(section);
    else if (tab === "animations") renderAnimationsTab(section);
    else renderControlTab(section);
    app.append(section);

    if (pin !== "off") {
      const banner = diodeBank(`pinned pin-${pin}`);
      document.body.append(banner);
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
