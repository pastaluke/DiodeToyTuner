/**
 * UI shell (roadmap F17): Control / Palettes / Animations / Schedules /
 * Controller sections over shared state. Everything is capability-driven
 * (P1) — no channel ids or families hardcoded in the UI.
 */
import { nudge, quantize, toStep } from "./core/value";
import { hsvToRgb, rgbToHsv } from "./core/color";
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
import { gamepadDiagram } from "./input/diagram";
import { AnimationEngine, animations } from "./animations";
import {
  exportPalette,
  getActivePaletteId,
  importPalette,
  loadPalettes,
  newPalette,
  paletteGradient,
  savePalettes,
  setActivePaletteId,
  swatchCss,
  type Palette,
  type Swatch,
} from "./palettes";
import {
  daylightTemplate,
  loadSchedules,
  newSchedule,
  saveSchedules,
  ScheduleRunner,
  type Schedule,
  type ScheduleNode,
} from "./schedules";
import { runDiagnosis } from "./diagnostics";

const app = document.getElementById("app")!;

let ble: BleDevice | null = null;
let capability: DeviceCapability | null = null;
let state: ChannelState = {};
let diagnosisReport: string | null = null;
/** F20: raw read-back hex from connect, surfaced for layout verification. */
let adoptRaw: string | null = null;
let tab: string = localStorage.getItem("dtt.tab") ?? "control";
let pin: string = localStorage.getItem("dtt.pin") ?? "off"; // off | top | bottom
let palettePin: string = localStorage.getItem("dtt.palettePin") ?? "off";
const infoOpen = new Set<string>();
let bindKindInfoOpen = false;
/** Last hue/sat set via the combined wheel (needed on RGB-native families). */
let combined = { h: 0, s: 1 };

let palettes: Palette[] = loadPalettes();
let activePaletteId: string | null = getActivePaletteId();
let schedules: Schedule[] = loadSchedules();

/** F29: palette-animation prefs (persisted app-wide, not per profile). */
let animPrefs: { dip: boolean; override: boolean; overrideV: number } = { dip: false, override: false, overrideV: 0.8 };
try {
  const raw: unknown = JSON.parse(localStorage.getItem("dtt.animPrefs") ?? "{}");
  const o = raw as Record<string, unknown>;
  animPrefs = {
    dip: o["dip"] === true,
    override: o["override"] === true,
    overrideV: typeof o["overrideV"] === "number" ? Math.min(1, Math.max(0, o["overrideV"])) : 0.8,
  };
} catch { /* defaults */ }
function saveAnimPrefs(): void {
  localStorage.setItem("dtt.animPrefs", JSON.stringify(animPrefs));
}

let learn:
  | { channelId: string; direction: 1 | -1 }
  | { modifierFor: Binding }
  | { actionId: string }
  | null = null;

function channelById(id: string): Channel | undefined {
  return capability?.channels.find((c) => c.id === id);
}

/* ── app actions (F28): bindable non-channel operations ───────────────── */

const appActions: { id: string; label: string; run: () => void }[] = [
  { id: "action.saveSwatch", label: "Save current color as swatch", run: () => saveCurrentSwatch() },
];

function actionLabel(id: string): string | undefined {
  return appActions.find((a) => a.id === id)?.label;
}

const mapping = new MappingEngine(
  (channelId, value) => setChannel(channelId, value),
  (channelId) => state[channelId] ?? 0,
  (channelId) => {
    const ch = channelById(channelId);
    return { steps: ch?.steps ?? 256, cyclic: ch?.cyclic ?? false };
  },
  () => saveProfile(),
  (actionId) => appActions.find((a) => a.id === actionId)?.run(),
);

/* Animations (F16): output goes through setChannel like everything else;
   manual input on any channel stops the running animation (AC3). */
let animApplying = false;
const anim = new AnimationEngine(() => {
  if (!capability) return null;
  return {
    channels: capability.channels,
    opts: {
      swatches: activePalette()?.swatches ?? [],
      dipToBlack: animPrefs.dip,
      overrideBrightness: animPrefs.override ? animPrefs.overrideV : null,
    },
    get: (id: string) => state[id] ?? 0,
    set: (id: string, v: number) => {
      animApplying = true;
      setChannel(id, v);
      animApplying = false;
    },
  };
});

/* Schedules (F30): client-side runner; applies through the same transport. */
const scheduleRunner = new ScheduleRunner(
  () => schedules,
  () => !!(ble && capability && ble.writeUnlocked),
  (node, sched) => {
    applyScheduleNode(node);
    setStatus(`Schedule “${sched.name}”: ${node.label || node.time}`);
  },
);
scheduleRunner.start();

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
    // Binary channel + plain button → toggle (F10): Start flips power,
    // any button flips White light (F18 AC3).
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
    } else if ("actionId" in learn) {
      // Actions fire on button presses only — an axis wiggle mid-learn is
      // ignored rather than captured (keep learning).
      if (ev.relative || ev.controlKey.includes("axis")) return;
      mapping.addBinding({
        channelId: learn.actionId,
        kind: "action",
        controlKey: ev.controlKey,
        direction: 1,
        sensitivity: 1,
        curve: "linear",
        deadzone: 0,
        modifiers: [],
      });
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
    // Sane starting shadow state: power on, full saturation, brightness
    // multipliers at 1, dimmers at half. Zeros here were the old "first
    // slider touch stomps the lamp dark" bug; read-back below overrides
    // these with the real values where the family supports it (F20).
    state = Object.fromEntries(
      capability.channels.map((c) => {
        let v = 0;
        if (c.kind === "power") v = 1;
        else if (c.kind === "sat") v = 1;
        else if (c.id === "brightness") v = 1; // whole-output multiplier
        else if (c.kind === "val") v = 0.5;
        return [c.id, v];
      }),
    );
    adoptRaw = null;
    let adopted = false;
    // F20: adopt the device's CURRENT state (read-only) so the first
    // slider touch doesn't stomp everything to zero.
    if (best.driver.readState) {
      try {
        const rs = await best.driver.readState(dev.probeIO());
        if (rs) {
          adoptRaw = rs.raw ?? null;
          for (const [id, v] of Object.entries(rs.state)) {
            const ch = channelById(id);
            if (ch && typeof v === "number") {
              state[id] = quantize(v, ch.steps);
              adopted = true;
            }
          }
          const hueCh = findKind("hue");
          const satCh = findKind("sat");
          combined = {
            h: hueCh ? state[hueCh.id] ?? 0 : 0,
            s: satCh ? state[satCh.id] ?? 1 : 1,
          };
        }
      } catch {
        /* read-back is best-effort; defaults stand */
      }
    }
    loadProfile(capability.family);
    const adoptedNote = adopted ? " — adopted the lamp's current state" : "";
    if (confidence >= CONFIDENCE_WRITE_THRESHOLD) {
      dev.writeUnlocked = true;
      setStatus(`Connected: ${capability.label} — confidence ${confidence.toFixed(2)} ✓${adoptedNote}`);
    } else {
      setStatus(`Probable ${capability.label} (confidence ${confidence.toFixed(2)}). Run the blink test to unlock control.`);
    }
    scheduleRunner.check();
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
  adoptRaw = null;
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
  let w: number | null;
  const modeCh = findKind("mode");
  if (modeCh) {
    // Mode-toggle families (F18): white diode runs at the shared
    // brightness while white mode is on; color diodes are off, and
    // vice versa.
    const whiteOn = (state[modeCh.id] ?? 0) >= 0.5;
    const valCh = findKind("val");
    w = whiteOn ? (valCh ? state[valCh.id] ?? 0 : 1) : 0;
    if (whiteOn) { r = 0; g = 0; b = 0; }
  } else {
    // Dedicated white diode, if the family has one (not the brightness multiplier).
    const wCh = capability?.channels.find(
      (c) => (c.kind === "w" || c.kind === "ww") && c.id !== "brightness",
    );
    w = wCh ? state[wCh.id] ?? 0 : null;
    // Exclusive white mode shuts off RGB (Triones).
    const whiteExclusive = capability?.channels.some((c) => c.exclusiveGroup === "white");
    if (whiteExclusive && (w ?? 0) > 0) { r = 0; g = 0; b = 0; }
  }
  const powered = (state["power"] ?? 1) >= 0.5;
  if (!powered) return { r: 0, g: 0, b: 0, w: w === null ? null : 0 };
  return { r, g, b, w };
}

/** Current color as h/s/v regardless of family (swatch capture, F28). */
function currentHsv(): { h: number; s: number; v: number } {
  const hueCh = findKind("hue");
  if (hueCh) {
    const s = findKind("sat");
    const v = findKind("val");
    return {
      h: state[hueCh.id] ?? 0,
      s: s ? state[s.id] ?? 1 : 1,
      v: v ? state[v.id] ?? 0 : 1,
    };
  }
  const mult = state["brightness"] ?? 1;
  const hsv = rgbToHsv(state["r"] ?? 0, state["g"] ?? 0, state["b"] ?? 0);
  return { h: hsv.h, s: hsv.s, v: hsv.v * mult };
}

/** Apply a full h/s/v color on whatever the family offers (forces color
 *  mode on white↔color toggle families). */
function applyHsv(h: number, s: number, v: number): void {
  const modeCh = findKind("mode");
  if (modeCh && (state[modeCh.id] ?? 0) >= 0.5) setChannel(modeCh.id, 0);
  const hueCh = findKind("hue");
  if (hueCh) {
    setChannel(hueCh.id, h);
    const satCh = findKind("sat");
    if (satCh) setChannel(satCh.id, s);
    const valCh = findKind("val");
    if (valCh) setChannel(valCh.id, v);
    return;
  }
  const rgb = hsvToRgb(h, s, v);
  const r = findKind("r"), g = findKind("g"), b = findKind("b");
  if (r && g && b) {
    setChannel(r.id, rgb.r);
    setChannel(g.id, rgb.g);
    setChannel(b.id, rgb.b);
  }
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

/* ── palettes (F28) ────────────────────────────────────────────────── */

function activePalette(): Palette | undefined {
  return palettes.find((p) => p.id === activePaletteId) ?? palettes[0];
}

function saveCurrentSwatch(): void {
  if (!capability) {
    setStatus("Connect a device first — a swatch captures its current color.");
    return;
  }
  let pal = activePalette();
  if (!pal) {
    pal = newPalette("My palette");
    palettes.push(pal);
    activePaletteId = pal.id;
    setActivePaletteId(pal.id);
  }
  const { h, s, v } = currentHsv();
  pal.swatches.push({ h, s, v });
  savePalettes(palettes);
  setStatus(`Saved swatch ${pal.swatches.length} to “${pal.name}”.`);
  render();
}

function applySwatch(s: Swatch): void {
  applyHsv(s.h, s.s, s.v);
}

/* ── schedules (F30) ───────────────────────────────────────────────── */

function applyScheduleNode(node: ScheduleNode): void {
  if (!capability) return;
  if (node.kind === "palette") {
    if (node.paletteId && palettes.some((p) => p.id === node.paletteId)) {
      activePaletteId = node.paletteId;
      setActivePaletteId(node.paletteId);
    }
    const lerp = animations.find((a) => a.id === "palette-lerp");
    if (lerp) anim.start(lerp);
    return;
  }
  for (const [id, v] of Object.entries(node.setting ?? {})) {
    if (typeof v === "number" && channelById(id)) setChannel(id, v);
  }
}

/* ── rendering ─────────────────────────────────────────────────────── */

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

let statusText = "";
function setStatus(text: string): void {
  statusText = text; // survives re-renders (render rebuilds the bar)
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
/** F23: pure-diode hash marks on hue controls; per-profile, default on. */
function hueMarksOn(): boolean {
  return pref("__hueMarks") !== "off";
}

function fallbackInfo(ch: Channel): string {
  switch (ch.kind) {
    case "power": return "Master switch: cuts or restores drive current to the diodes.";
    case "mode": return "Chooses which of the lamp's diode groups is active — the firmware only allows one at a time.";
    case "hue": return "Which blend of the color diodes is driven — an angle on the color circle.";
    case "sat": return "Color purity: lower values blend the diodes toward white.";
    case "val": return "Duty cycle of the active diodes — how long they conduct each PWM period.";
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
    const toggle = document.getElementById(`tg-${ch.id}`);
    if (toggle) {
      for (const btn of toggle.querySelectorAll<HTMLButtonElement>("button")) {
        btn.classList.toggle("active", Number(btn.dataset["val"]) === (v >= 0.5 ? 1 : 0));
      }
    }
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
      const valEl = bank.querySelector<HTMLElement>(`.dv-${name}`);
      if (!dotEl) return;
      if (drive === null) {
        dotEl.style.opacity = "0.15";
        dotEl.style.background = "";
        dotEl.style.boxShadow = "none";
        if (valEl) valEl.textContent = "–";
        return;
      }
      dotEl.style.opacity = "1";
      const a = drive;
      if (a <= 0) {
        // F22 AC2: an unlit diode is a black circle, unambiguously OFF.
        dotEl.style.background = "#000";
        dotEl.style.boxShadow = "none";
      } else {
        dotEl.style.background = `rgba(${rr},${gg},${bb},${Math.max(0.08, a)})`;
        dotEl.style.boxShadow = a > 0.02 ? `0 0 ${8 + a * 26}px rgba(${rr},${gg},${bb},${a})` : "none";
      }
      // F22 AC1: numeric power level per diode.
      if (valEl) valEl.textContent = `${Math.round(a * 100)}%`;
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
    wrapEl.append(
      el("span", `diode d-${name}`),
      el("span", "diode-name", label),
      el("span", `diode-val dv-${name}`, "0%"),
    );
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

/** F23: R/G/B markers where exactly one diode conducts (hue 0°/120°/240°). */
function wheelMarks(radiusPx: number): HTMLElement[] {
  if (!hueMarksOn()) return [];
  return ([["r", 0], ["g", 120], ["b", 240]] as const).map(([name, deg]) => {
    const m = el("span", `wheel-mark wm-${name}`);
    m.style.transform = `rotate(${deg}deg) translate(0, ${-radiusPx}px)`;
    return m;
  });
}

function widgetFor(ch: Channel): HTMLElement {
  // 2-step channels (Power, White light) are toggles, not sliders (F18 AC4).
  if (ch.steps === 2) {
    const wrap = el("div", "toggle2");
    wrap.id = `tg-${ch.id}`;
    const labels: [string, string] = ch.kind === "mode" ? ["🌈 Color", "⚪ White"] : ["Off", "On"];
    for (const [label, val] of [[labels[0], 0], [labels[1], 1]] as const) {
      const btn = el("button", "seg", label) as HTMLButtonElement;
      btn.dataset["val"] = String(val);
      btn.onclick = () => setChannel(ch.id, val);
      wrap.append(btn);
    }
    return wrap;
  }
  const view = viewFor(ch);
  if (view === "wheel" && ch.kind === "hue") {
    const wheel = el("div", "wheel");
    const dot = el("div", "wheel-dot");
    dot.id = `dot-${ch.id}`;
    wheel.append(...wheelMarks(70), dot);
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
  if (ch.kind === "hue" && hueMarksOn()) {
    // F23: R/G/B ticks over the spectrum track.
    const wrap = el("div", "slider-wrap");
    wrap.append(slider);
    for (const [name, at] of [["r", 0], ["g", 1 / 3], ["b", 2 / 3], ["r", 1]] as const) {
      const tick = el("span", `hue-tick ht-${name}`, name.toUpperCase());
      tick.style.left = `${at * 100}%`;
      wrap.append(tick);
    }
    return wrap;
  }
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
  wheel.append(...wheelMarks(74), dot);
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
  if (!capability) {
    const empty = el("div", "empty");
    empty.append(
      el("p", "", "Connect a cheap BLE LED controller (Lotus Lantern / ELK-BLEDOM strips, Triones / HappyLighting bulbs, Zengge LEDnetWF lamps, SP110E) and tune every channel it exposes at its true hardware resolution."),
      el("p", "small", "Chromium-based browser required (Web Bluetooth). HTTPS or localhost only."),
    );
    root.append(empty);
    return;
  }
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
    const isBinary = ch.steps === 2;
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
    if (ch.kind === "hue") {
      // F23 toggle: show/hide the pure-diode marks.
      const marksBtn = el("button", hueMarksOn() ? "tiny active" : "tiny", "R·G·B marks") as HTMLButtonElement;
      marksBtn.title = "Mark the hues where only one diode conducts";
      marksBtn.onclick = () => setPref("__hueMarks", hueMarksOn() ? "off" : "on");
      head.append(marksBtn);
    }
    if (!isBinary) {
      const viewSel = el("select", "view-select") as HTMLSelectElement;
      for (const v of ["slider", ...(ch.kind === "hue" ? ["wheel"] : []), "steps"]) {
        const o = el("option", "", v) as HTMLOptionElement;
        o.value = v;
        if (v === viewFor(ch)) o.selected = true;
        viewSel.append(o);
      }
      viewSel.onchange = () => setView(ch, viewSel.value);
      head.append(viewSel);
    }
    strip.append(head);
    if (infoOpen.has(ch.id)) strip.append(el("p", "info-pop", ch.info ?? fallbackInfo(ch)));

    strip.append(widgetFor(ch));

    const fine = el("div", "fine");
    if (!isBinary) {
      const minus = el("button", "", "−1 step") as HTMLButtonElement;
      minus.onclick = () => setChannel(ch.id, nudge(state[ch.id] ?? 0, ch.steps, -1, ch.cyclic));
      const plus = el("button", "", "+1 step") as HTMLButtonElement;
      plus.onclick = () => setChannel(ch.id, nudge(state[ch.id] ?? 0, ch.steps, +1, ch.cyclic));
      fine.append(minus, plus);
    }
    const mkLearn = (direction: 1 | -1, label?: string): HTMLButtonElement => {
      const active = learn && "channelId" in learn && learn.channelId === ch.id && learn.direction === direction;
      const btn = el("button", active ? "learning" : "", active ? "move a control…" : label ?? `🎮 learn ${direction === 1 ? "+" : "−"}`) as HTMLButtonElement;
      btn.onclick = () => {
        learn = active ? null : { channelId: ch.id, direction };
        render();
      };
      return btn;
    };
    // F11: − left of +, matching slider direction. Binary channels take a
    // single button — the binding becomes a toggle either way (F10/F18).
    if (isBinary) fine.append(mkLearn(1, "🎮 learn button"));
    else fine.append(mkLearn(-1), mkLearn(1));
    strip.append(fine);

    if (!isBinary) {
      strip.append(el("div", "readout", ""));
      (strip.lastElementChild as HTMLElement).id = `ro-${ch.id}`;
    }
    strips.append(strip);
  }
  root.append(strips);

  if (pin === "off") root.append(diodeBank("inline"));
  // Palette creation row lives here too (F28) so "save current color" is
  // at hand while tuning; pinning it moves it to a screen edge instead.
  if (palettePin === "off") root.append(paletteRow("inline"));

  if (capability.notes?.length) {
    const notes = el("ul", "notes");
    for (const n of capability.notes) notes.append(el("li", "", n));
    root.append(notes);
  }

  if (adoptRaw) {
    const raw = el("p", "small mono", `state read-back raw: ${adoptRaw}`);
    raw.title = "The device's answer to our state query — useful for verifying the layout hypothesis in the knowledge graph.";
    root.append(raw);
  }
}

/* ── palettes UI (F28) ─────────────────────────────────────────────── */

function paletteRow(cls: string): HTMLElement {
  const row = el("div", `palette-row ${cls}`);
  row.append(el("span", "bank-label", "palette:"));

  if (palettes.length) {
    const sel = el("select", "palette-select") as HTMLSelectElement;
    for (const p of palettes) {
      const o = el("option", "", p.name) as HTMLOptionElement;
      o.value = p.id;
      if (p.id === activePalette()?.id) o.selected = true;
      sel.append(o);
    }
    sel.onchange = () => {
      activePaletteId = sel.value;
      setActivePaletteId(sel.value);
      render();
    };
    row.append(sel);
  }

  const chips = el("span", "swatch-chips");
  const pal = activePalette();
  for (const s of pal?.swatches ?? []) {
    const chip = el("button", "swatch-chip") as HTMLButtonElement;
    chip.style.background = swatchCss(s);
    chip.title = `hue ${(s.h * 360).toFixed(0)}° · sat ${(s.s * 100).toFixed(0)} · bright ${(s.v * 100).toFixed(0)} — click to apply`;
    chip.onclick = () => applySwatch(s);
    chips.append(chip);
  }
  row.append(chips);

  const save = el("button", "tiny", "＋ save current color") as HTMLButtonElement;
  save.title = "Append the current hue/saturation/brightness as a swatch (F28) — bindable below";
  save.onclick = saveCurrentSwatch;
  row.append(save);

  const learning = learn !== null && "actionId" in learn;
  const learnBtn = el("button", learning ? "tiny learning" : "tiny", learning ? "press a button…" : "🎮") as HTMLButtonElement;
  learnBtn.title = "Bind 'save current color' to a controller button";
  learnBtn.onclick = () => {
    learn = learning ? null : { actionId: "action.saveSwatch" };
    render();
  };
  row.append(learnBtn);

  const pinBtns = el("span", "pin-btns");
  for (const [label, mode] of [["📌↑", "top"], ["📌↓", "bottom"], ["✕", "off"]] as const) {
    if (palettePin === mode) continue;
    const btn = el("button", "tiny", label) as HTMLButtonElement;
    btn.title = mode === "off" ? "unpin" : `pin palette row to ${mode} (stays across tabs)`;
    btn.onclick = () => {
      palettePin = mode;
      localStorage.setItem("dtt.palettePin", palettePin);
      render();
    };
    pinBtns.append(btn);
  }
  row.append(pinBtns);
  return row;
}

function renderPalettesTab(root: HTMLElement): void {
  root.append(
    el("p", "small",
      "A palette is a list of saved color swatches (hue + saturation + brightness). Build one from live colors with “save current color”, then run it as an animation or use it in schedules. Palettes live in this browser; share them with Copy / Import (clipboard JSON)."),
  );

  if (palettePin === "off") root.append(paletteRow("inline"));
  else root.append(el("p", "small", `Palette row is pinned to the ${palettePin} of the screen.`));

  const bar = el("div", "bar");
  const add = el("button", "", "＋ New palette") as HTMLButtonElement;
  add.onclick = () => {
    const name = window.prompt("Palette name:", `Palette ${palettes.length + 1}`);
    if (!name) return;
    const p = newPalette(name);
    palettes.push(p);
    activePaletteId = p.id;
    setActivePaletteId(p.id);
    savePalettes(palettes);
    render();
  };
  const importBtn = el("button", "", "📋 Import from clipboard") as HTMLButtonElement;
  importBtn.onclick = () => {
    void navigator.clipboard
      .readText()
      .then((text) => {
        const p = importPalette(text);
        palettes.push(p);
        activePaletteId = p.id;
        setActivePaletteId(p.id);
        savePalettes(palettes);
        setStatus(`Imported palette “${p.name}” (${p.swatches.length} swatches).`);
        render();
      })
      .catch((err: unknown) => setStatus(`Import failed: ${err instanceof Error ? err.message : String(err)}`));
  };
  bar.append(add, importBtn);
  root.append(bar);

  const list = el("div", "palette-list");
  for (const p of palettes) {
    const item = el("div", p.id === activePalette()?.id ? "palette-item active" : "palette-item");
    // F28 AC3: swatches as the row background, text readable in front.
    const grad = paletteGradient(p);
    if (grad) item.style.background = grad;
    const inner = el("div", "palette-item-inner");
    const label = el("span", "palette-item-label", `${p.name} — ${p.swatches.length} swatch${p.swatches.length === 1 ? "" : "es"}`);
    inner.append(label);
    const btns = el("span", "palette-item-btns");

    const use = el("button", "tiny", p.id === activePalette()?.id ? "active" : "use") as HTMLButtonElement;
    use.onclick = () => {
      activePaletteId = p.id;
      setActivePaletteId(p.id);
      render();
    };
    const rename = el("button", "tiny", "rename") as HTMLButtonElement;
    rename.onclick = () => {
      const name = window.prompt("New name:", p.name);
      if (!name) return;
      p.name = name;
      savePalettes(palettes);
      render();
    };
    const copy = el("button", "tiny", "copy") as HTMLButtonElement;
    copy.title = "Copy shareable JSON to the clipboard";
    copy.onclick = () => {
      void navigator.clipboard
        .writeText(exportPalette(p))
        .then(() => setStatus(`Palette “${p.name}” copied — paste it anywhere to share.`));
    };
    const dup = el("button", "tiny", "duplicate") as HTMLButtonElement;
    dup.onclick = () => {
      const c = newPalette(`${p.name} copy`);
      c.swatches = p.swatches.map((s) => ({ ...s }));
      palettes.push(c);
      savePalettes(palettes);
      render();
    };
    const del = el("button", "tiny", "✕") as HTMLButtonElement;
    del.onclick = () => {
      if (!window.confirm(`Delete palette “${p.name}”?`)) return;
      palettes = palettes.filter((x) => x !== p);
      savePalettes(palettes);
      render();
    };
    btns.append(use, rename, copy, dup, del);
    inner.append(btns);
    item.append(inner);

    if (p.id === activePalette()?.id && p.swatches.length) {
      const chips = el("div", "palette-item-swatches");
      p.swatches.forEach((s, i) => {
        const chip = el("span", "swatch-chip-wrap");
        const btn = el("button", "swatch-chip") as HTMLButtonElement;
        btn.style.background = swatchCss(s);
        btn.title = `swatch ${i + 1}: hue ${(s.h * 360).toFixed(0)}° · sat ${(s.s * 100).toFixed(0)} · bright ${(s.v * 100).toFixed(0)} — click to apply`;
        btn.onclick = () => applySwatch(s);
        const rm = el("button", "tiny", "✕") as HTMLButtonElement;
        rm.title = "remove swatch";
        rm.onclick = () => {
          p.swatches.splice(i, 1);
          savePalettes(palettes);
          render();
        };
        chip.append(btn, rm);
        chips.append(chip);
      });
      item.append(chips);
    }
    list.append(item);
  }
  if (!palettes.length) list.append(el("p", "small", "No palettes yet — hit “＋ save current color” while connected, or “＋ New palette”."));
  root.append(list);
}

/* ── controller UI (F5/F25/F26) ────────────────────────────────────── */

const KIND_INFO: [BindingKind, string][] = [
  ["rotary", "Circle a stick around its rim like an endless knob — engaging the rim never jumps the value, only rotation changes it. Sensitivity = full circles per full sweep."],
  ["rate", "Hold to glide the value up/down continuously. Sensitivity = full range per second at full deflection (per detent for encoder knobs)."],
  ["step", "One press moves by exact hardware steps. Sensitivity = steps per press — the d-pad precision nudger."],
  ["toggle", "Each press flips the target between off and on (Power, White light)."],
  ["absolute", "The control's position IS the value — a stick axis or trigger mapped directly onto the range."],
  ["action", "The press fires an app action instead of moving a channel (e.g. save the current color as a swatch)."],
];

function labelForTarget(id: string): string {
  return channelById(id)?.label ?? actionLabel(id) ?? id;
}

function bindingRow(b: Binding, idx: number): HTMLElement {
  const row = el("div", "binding");
  row.dataset["idx"] = String(idx);
  // Index-agnostic control suffixes for the diagram (F26).
  const suffixes = [
    b.controlKey.replace(/^gamepad\d+\./, ""),
    ...(b.controlKey2 ? [b.controlKey2.replace(/^gamepad\d+\./, "")] : []),
    ...b.modifiers.map((m) => m.controlKey.replace(/^gamepad\d+\./, "")),
  ];
  row.dataset["keys"] = suffixes.join(" ");
  row.append(
    el("span", "b-control", b.controlKey + (b.controlKey2 ? `+${b.controlKey2.split(".")[1]}` : "")),
    el("span", "b-arrow", `→ ${labelForTarget(b.channelId)}`),
  );

  const isAction = b.kind === "action";
  if (isAction) {
    row.append(el("span", "b-kind-fixed", "action"));
  } else {
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
    row.append(kind);
  }

  // F25: one ⓘ explaining every kind option.
  const kindInfo = el("button", "tiny info-btn", "ⓘ") as HTMLButtonElement;
  kindInfo.title = "What do these kinds mean?";
  kindInfo.onclick = () => {
    bindKindInfoOpen = !bindKindInfoOpen;
    render();
  };
  row.append(kindInfo);

  if (!isAction) {
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
    row.append(dir, sens, curve);
  }

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

  row.append(mods, del);
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

  // F26: standard-mapping gamepad diagram; assigned controls highlighted,
  // click → highlight the binding rows below.
  const bindingsFor = (suffix: string): Binding[] =>
    bindings.filter(
      (b) =>
        b.controlKey.replace(/^gamepad\d+\./, "") === suffix ||
        b.controlKey2?.replace(/^gamepad\d+\./, "") === suffix ||
        b.modifiers.some((m) => m.controlKey.replace(/^gamepad\d+\./, "") === suffix),
    );
  const diagramBox = el("div", "gp-diagram-box");
  diagramBox.append(
    gamepadDiagram({
      isAssigned: (suffix) => bindingsFor(suffix).length > 0,
      titleFor: (suffix) =>
        bindingsFor(suffix)
          .map((b) =>
            b.modifiers.some((m) => m.controlKey.replace(/^gamepad\d+\./, "") === suffix) &&
            b.controlKey.replace(/^gamepad\d+\./, "") !== suffix
              ? `modifier for ${labelForTarget(b.channelId)}`
              : `${b.kind} → ${labelForTarget(b.channelId)}`,
          )
          .join("\n"),
      onClick: (suffix) => {
        let first: HTMLElement | null = null;
        for (const row of document.querySelectorAll<HTMLElement>(".binding")) {
          const hit = (row.dataset["keys"] ?? "").split(" ").includes(suffix);
          row.classList.toggle("flash", hit);
          if (hit && !first) first = row;
          if (!hit) continue;
          window.setTimeout(() => row.classList.remove("flash"), 2400);
        }
        first?.scrollIntoView({ behavior: "smooth", block: "center" });
      },
    }),
    el("p", "small", "Standard-mapping pad (Xbox / Stadia / DS4). Lit controls have assignments — hover to see them, click to jump to the binding."),
  );
  root.append(diagramBox);

  const list = el("div", "bindings");
  list.append(el("h2", "", "Bindings"));
  if (bindKindInfoOpen) {
    const pop = el("div", "info-pop kind-info");
    for (const [k, text] of KIND_INFO) {
      const p = el("p", "");
      p.append(el("strong", "", k), document.createTextNode(` — ${text}`));
      pop.append(p);
    }
    list.append(pop);
  }
  if (bindings.length) {
    bindings.forEach((b, i) => list.append(bindingRow(b, i)));
  } else {
    list.append(el("p", "small", "No bindings yet — use 🎮 learn buttons on the Control tab."));
  }
  root.append(list);
}

/* ── animations UI (F16/F27/F29) ───────────────────────────────────── */

function renderAnimationsTab(root: HTMLElement): void {
  root.append(
    el("p", "small",
      "Client-driven animations: values stream through the same paced, flash-limited transport as your sliders — works on every supported family, including write-only ones. Touching any control stops the animation."),
  );
  const list = el("div", "anims");
  for (const a of animations) {
    const row = el("div", "anim-row");
    const nameWrap = el("span", "anim-name");
    nameWrap.append(el("span", "", a.name));
    const cyc = el("span", "small anim-cycle", a.cycle(anim.speed));
    cyc.id = `cy-${a.id}`;
    nameWrap.append(cyc);
    row.append(nameWrap);
    if (a.id === "palette-lerp") {
      const pal = activePalette();
      row.append(el("span", "small", pal ? `palette: ${pal.name} (${pal.swatches.length})` : "no palette yet — see Palettes tab"));
    }
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
  speed.step = "0.005";
  speed.value = String(anim.speed);
  speed.oninput = () => {
    anim.speed = Number(speed.value);
    // Live cycle-time readouts (F27 AC2) without a full re-render.
    for (const a of animations) {
      const cyc = document.getElementById(`cy-${a.id}`);
      if (cyc) cyc.textContent = a.cycle(anim.speed);
    }
  };
  speedRow.append(speed);
  list.append(speedRow);

  // F29 options: transition style + brightness override.
  const optRow = el("div", "anim-row anim-opts");
  const dipLabel = el("label", "check");
  const dip = el("input") as HTMLInputElement;
  dip.type = "checkbox";
  dip.checked = animPrefs.dip;
  dip.onchange = () => {
    animPrefs.dip = dip.checked;
    saveAnimPrefs();
  };
  dipLabel.append(dip, document.createTextNode(" fade to black between palette colors"));
  optRow.append(dipLabel);
  list.append(optRow);

  const ovRow = el("div", "anim-row anim-opts");
  const ovLabel = el("label", "check");
  const ov = el("input") as HTMLInputElement;
  ov.type = "checkbox";
  ov.checked = animPrefs.override;
  ov.onchange = () => {
    animPrefs.override = ov.checked;
    saveAnimPrefs();
    render();
  };
  ovLabel.append(ov, document.createTextNode(" override swatch brightness with:"));
  ovRow.append(ovLabel);
  const ovSlider = el("input") as HTMLInputElement;
  ovSlider.type = "range";
  ovSlider.min = "0";
  ovSlider.max = "1";
  ovSlider.step = "0.01";
  ovSlider.value = String(animPrefs.overrideV);
  ovSlider.disabled = !animPrefs.override;
  ovSlider.oninput = () => {
    animPrefs.overrideV = Number(ovSlider.value);
    saveAnimPrefs();
  };
  ovRow.append(ovSlider);
  list.append(ovRow);
  root.append(list);
  root.append(
    el("p", "small",
      "Off = the palette animation plays each swatch at its own saved brightness. Coming: device-native effect engines (e.g. LEDnetWF's built-in effects) exposed per family."),
  );
}

/* ── schedules UI (F30) ────────────────────────────────────────────── */

function fmtNode(n: ScheduleNode): string {
  if (n.kind === "palette") {
    const pal = palettes.find((p) => p.id === n.paletteId);
    return `start palette animation: ${pal?.name ?? "(missing palette)"}`;
  }
  const s = n.setting ?? {};
  if ((s["power"] ?? 1) < 0.5) return "power off";
  const parts: string[] = [];
  if ((s["whiteMode"] ?? 0) >= 0.5) parts.push("white light");
  else if (typeof s["hue"] === "number") parts.push(`hue ${Math.round((s["hue"] ?? 0) * 360)}°`);
  const v = s["value"] ?? s["brightness"];
  if (typeof v === "number") parts.push(`brightness ${Math.round(v * 100)}%`);
  return parts.length ? parts.join(", ") : "captured setting";
}

function renderSchedulesTab(root: HTMLElement): void {
  root.append(
    el("p", "small",
      "Schedules apply a saved light setting (or start a palette animation) at set times of day, in your local time zone. Honesty note: they currently run only while this app is open and connected — device-side timers (which would keep working with the app closed) need vendor commands we haven't reverse-engineered yet; that research is on the list."),
  );

  const bar = el("div", "bar");
  const add = el("button", "", "＋ New schedule") as HTMLButtonElement;
  add.onclick = () => {
    const name = window.prompt("Schedule name:", `Schedule ${schedules.length + 1}`);
    if (!name) return;
    schedules.push(newSchedule(name));
    saveSchedules(schedules);
    render();
  };
  const tmpl = el("button", "", "＋ Add day/evening template") as HTMLButtonElement;
  tmpl.title = "Bright white during the day, warm dim color in the evening, off late — copy and edit to taste";
  tmpl.onclick = () => {
    schedules.push(daylightTemplate());
    saveSchedules(schedules);
    render();
  };
  bar.append(add, tmpl);
  root.append(bar);

  for (const s of schedules) {
    const box = el("div", "schedule");
    const head = el("div", "strip-head");
    const left = el("span", "label-wrap");
    const enable = el("input") as HTMLInputElement;
    enable.type = "checkbox";
    enable.checked = s.enabled;
    enable.title = "Enabled schedules apply their most recent due node while connected";
    enable.onchange = () => {
      s.enabled = enable.checked;
      saveSchedules(schedules);
      scheduleRunner.check();
      render();
    };
    const name = el("input", "profile-name") as HTMLInputElement;
    name.value = s.name;
    name.onchange = () => {
      s.name = name.value;
      saveSchedules(schedules);
    };
    left.append(enable, name);
    head.append(left);
    const btns = el("span", "palette-item-btns");
    const copy = el("button", "tiny", "copy") as HTMLButtonElement;
    copy.title = "Duplicate this schedule for editing";
    copy.onclick = () => {
      const c = newSchedule(`${s.name} copy`);
      c.nodes = s.nodes.map((n) => ({ ...n, setting: n.setting ? { ...n.setting } : undefined }));
      schedules.push(c);
      saveSchedules(schedules);
      render();
    };
    const del = el("button", "tiny", "✕") as HTMLButtonElement;
    del.onclick = () => {
      if (!window.confirm(`Delete schedule “${s.name}”?`)) return;
      schedules = schedules.filter((x) => x !== s);
      saveSchedules(schedules);
      render();
    };
    btns.append(copy, del);
    head.append(btns);
    box.append(head);

    const nodes = [...s.nodes].sort((a, b) => a.time.localeCompare(b.time));
    for (const n of nodes) {
      const row = el("div", "schedule-node");
      const time = el("input") as HTMLInputElement;
      time.type = "time";
      time.value = n.time;
      time.onchange = () => {
        if (/^\d{2}:\d{2}$/.test(time.value)) {
          n.time = time.value;
          saveSchedules(schedules);
          render();
        }
      };
      row.append(time);
      const label = el("input", "node-label") as HTMLInputElement;
      label.value = n.label;
      label.placeholder = fmtNode(n);
      label.onchange = () => {
        n.label = label.value;
        saveSchedules(schedules);
      };
      row.append(label);
      row.append(el("span", "small", fmtNode(n)));
      const test = el("button", "tiny", "apply now") as HTMLButtonElement;
      test.title = "Try this node immediately";
      test.onclick = () => applyScheduleNode(n);
      const rm = el("button", "tiny", "✕") as HTMLButtonElement;
      rm.onclick = () => {
        s.nodes = s.nodes.filter((x) => x !== n);
        saveSchedules(schedules);
        render();
      };
      row.append(test, rm);
      box.append(row);
    }

    const addRow = el("div", "schedule-add");
    const now = new Date();
    const nowTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const addSetting = el("button", "tiny", "＋ add current light setting") as HTMLButtonElement;
    addSetting.title = "Capture everything the lamp is doing right now as a node";
    addSetting.onclick = () => {
      if (!capability) {
        setStatus("Connect a device first — this captures its current state.");
        return;
      }
      const setting: Partial<ChannelState> = {};
      for (const ch of capability.channels) setting[ch.id] = state[ch.id] ?? 0;
      s.nodes.push({ time: nowTime, label: "", kind: "setting", setting });
      saveSchedules(schedules);
      render();
    };
    addRow.append(addSetting);
    if (palettes.length) {
      const addPal = el("button", "tiny", "＋ add palette node") as HTMLButtonElement;
      addPal.title = "At this time, start the palette lerp animation with the chosen palette";
      const palSel = el("select", "palette-select") as HTMLSelectElement;
      for (const p of palettes) {
        const o = el("option", "", p.name) as HTMLOptionElement;
        o.value = p.id;
        palSel.append(o);
      }
      addPal.onclick = () => {
        s.nodes.push({ time: nowTime, label: "", kind: "palette", paletteId: palSel.value });
        saveSchedules(schedules);
        render();
      };
      addRow.append(addPal, palSel);
    }
    box.append(addRow);
    root.append(box);
  }
  if (!schedules.length) root.append(el("p", "small", "No schedules yet."));
}

/* ── shell ─────────────────────────────────────────────────────────── */

function render(): void {
  app.textContent = "";
  document.querySelectorAll(".diode-bank.pinned, .palette-row.pinned").forEach((n) => n.remove());

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
  bar.append(el("span", "status", statusText));
  bar.lastElementChild!.id = "status";
  app.append(bar);

  // F17: section tabs over shared state. Palettes/Schedules work
  // without a connection (they're browser data), so tabs always show.
  const nav = el("nav", "tabs");
  for (const [id, label] of [
    ["control", "Control"],
    ["palettes", "Palettes"],
    ["animations", "Animations"],
    ["schedules", "Schedules"],
    ["controller", "Controller"],
  ] as const) {
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
  else if (tab === "palettes") renderPalettesTab(section);
  else if (tab === "schedules") renderSchedulesTab(section);
  else renderControlTab(section);
  app.append(section);

  if (capability && pin !== "off") {
    document.body.append(diodeBank(`pinned pin-${pin}`));
  }
  if (palettePin !== "off") {
    const row = paletteRow(`pinned pin-${palettePin}`);
    // Stack below/above the diode bank when both pin to the same edge.
    if (capability && pin === palettePin) {
      row.style[palettePin === "top" ? "top" : "bottom"] = "64px";
    }
    document.body.append(row);
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
