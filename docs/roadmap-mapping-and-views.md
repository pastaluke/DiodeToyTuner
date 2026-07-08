# Roadmap: mapping customization & value views

Classified from the first hardware-verified field session (2026-07-07,
LEDnetWF sunset lamp + gamepad). Status values: `planned` → `shipped` →
`verified`. Each feature has acceptance criteria (AC) so any future session
can pick it up cold.

## F1 — Shareable configuration profiles (Steam-style) — shipped

Users build a named configuration for a device family in-app (bindings +
view choices), export it as JSON, share it online, import others' files.

- AC1: "Export profile" downloads `<name>.dtt-profile.json` containing
  name, device family, bindings, and per-channel view choices.
- AC2: "Import profile" accepts such a file, schema-validates it (reject
  malformed with a visible error; profiles are pure data — threat model
  M4a), and applies it to the connected device.
- AC3: The active profile auto-saves to `localStorage` per device family
  and auto-loads on reconnect.

## F2 — Rotary stick gesture ("stick as endless encoder") — shipped

Push a stick to its rim anywhere (N/E/S/W — doesn't matter), then rotate
around the rim; angular travel changes the bound value, CW = increase,
CCW = decrease (invertible). Fixes both stick complaints: single-axis-only
control, and snap-back-to-zero destroying the value.

- AC1: Engaging the rim does NOT change the value; only rotation after
  engagement does. Releasing the stick (returning inside the engage
  radius) leaves the value untouched.
- AC2: Sensitivity is expressed as **revolutions per full sweep** (0→1);
  e.g. 4 means four full circles to traverse the whole range. Editable
  per binding, fractional values allowed.
- AC3: Learn on a stick axis defaults the binding to rotary with the
  correct sibling axis auto-paired (axes 0+1 = left stick, 2+3 = right).

## F3 — Modifier buttons (hold to change sensitivity) — shipped

Any binding can reference modifier controls: while held, they scale the
binding's speed (e.g. RT ×4 = coarser/faster, LT ×0.25 = finer/slower).

- AC1: A binding can hold multiple modifiers, each = {control, scale};
  held modifiers multiply together.
- AC2: Modifiers are assigned by a learn gesture and their scale is
  editable per modifier; removable individually.
- AC3: Modifiers affect rotary, rate, and step bindings (not absolute).

## F4 — Directional & step bindings (d-pad left/right etc.) — shipped

Buttons can decrease as well as increase, and can move by exact hardware
steps.

- AC1: Every channel has "learn +" and "learn −"; a button captured via
  "learn −" decreases.
- AC2: Button bindings default to **step** mode: one press = N hardware
  steps (N editable, default 1) — the d-pad becomes a precision nudger.
- AC3: Analog triggers captured by learn default to **rate** mode
  (held = continuous change, speed editable).

## F5 — Binding editor — shipped

All bindings are visible and editable in place: kind (absolute / rate /
step / rotary), direction, sensitivity, curve, modifiers, delete.

- AC1: Every parameter of every binding is editable without re-learning.
- AC2: Edits apply immediately and persist (F1 auto-save).

## F6 — Portrait/mobile layout — shipped

- AC1: In a ~400 px-wide viewport, each channel's label, control widget,
  fine-step buttons and readout are fully visible and usable; sliders
  span the available width.

## F7 — Configurable value views — shipped

Per channel, the user chooses how the value is presented:

- `slider` (default), with true-step display (existing),
- `wheel` for hue-kind channels: a color wheel with a dot circumnavigating
  it at the current hue; dragging on the wheel sets hue,
- `steps`: a numeric hardware-step field (e.g. 0–179) for exact-value
  entry — the "specific per-diode values" view.

- AC1: View choice is per channel, switchable live, saved in the profile.
- AC2: The wheel shows the reachable color circle and never implies more
  resolution than the channel has (readout still shows step N/max).

## F8 — LEDnetWF white channel — shipped (needs hardware verification)

The verified sunset lamp has a dedicated white LED. Answer to "where is
white in the current app": it was **not represented at all** — the hue
slider only drives the RGB diodes. The protocol has a separate white-mode
payload (`3b b1 00 00 00 TT BB …`, temp & brightness 0–100 — interpreted
from the capture `3b b1 00 00 00 1b 36 … 3d`, checksum-consistent; byte
positions are a hypothesis marked `reported` in the graph).

- AC1: LEDnetWF exposes `White temp` and `White brightness` channels
  (101 steps each, honest).
- AC2: Setting White brightness > 0 switches the lamp to white mode;
  setting it to 0 returns to HSV color mode (mirrors how the vendor app
  treats the modes as exclusive).
- AC3: First hardware test flips the white-payload confidence in the
  knowledge graph (either verifying the byte positions or correcting
  them in the same commit).

## F9 — Cyclic channels (hue wraps around) — planned

Hue 0.0 and 1.0 are both red, one hardware step apart. Channels gain
`cyclic: true`; all mutation paths wrap instead of clamping.

- AC1: `+1 step` at max lands on 0 (and vice versa); rotary/rate/step
  bindings cross the seam smoothly instead of pinning.
- AC2: Applies to any driver's cyclic channel, not just LEDnetWF hue.
- AC3: Absolute bindings and the slider still present 0→1 linearly (a
  slider can't wrap); the wheel view is the natural cyclic control.

## F10 — Toggle bindings for binary channels — planned

- AC1: A button learned onto a 2-step channel (e.g. Power) defaults to a
  new `toggle` kind: each press flips the value.
- AC2: `toggle` is selectable in the binding editor for any channel
  (flips between 0 and 1).

## F11 — Learn button order — planned

- AC1: `learn −` renders left of `learn +`, matching slider direction.

## F12 — Hue slider shows the spectrum — planned

- AC1: Sliders for cyclic hue channels paint the full reachable spectrum
  along the track (red at both ends), for every family exposing hue.

## F13 — Channel info (ⓘ) — planned

Each channel gets a brief explanation from high level down to the
physical diode ("Hue: which mix of the red/green/blue diodes is lit —
the lamp rotates diode duty cycles to fake the in-between colors").

- AC1: ⓘ per channel; click/hover reveals text; drivers may supply
  channel-specific text, with sensible fallbacks by channel kind so every
  family gets coverage.

## F14 — Combined color control (wheel with saturation radius) — planned

One control representing the end result: a 2D disc — angle = hue,
radius = saturation (white at center). 

- AC1: Dragging sets hue+saturation together on HSV families.
- AC2: On RGB families the same control drives r/g/b via HSV→RGB
  conversion (value taken from the existing brightness/value channel) —
  the control is family-agnostic.
- AC3: Toggleable; preference saved in the profile.

## F15 — Physical diode view (pinnable) — planned

Four rendered "LEDs" (R, G, B, W) showing what the physical diodes are
actually doing right now — brightness-accurate, so users don't stare at
bare emitters. Derivation: RGB families direct (× brightness multiplier
where the family has one); HSV families via HSV→RGB; white channels →
the W diode. 

- AC1: Available for every family; diodes the family lacks render as
  absent/off.
- AC2: Pinnable as a banner stuck to top or bottom that stays put while
  scrolling; pin state persists.

## F16 — Animation groundwork — planned

Two lanes, architecture laid now so nothing needs walking back:
1. **Client-driven animations** (universal): a ticker generates channel
   values through the existing paced/flash-limited transport — works on
   every family including write-only ones. Effect vocabulary borrowed
   from WLED/LedFx (sweep, breathe, …), translated to whatever channels
   the connected family exposes.
2. **Device-native effects** (per family): e.g. LEDnetWF effect command
   `38 EE SS BB` — exposed later as driver capabilities.

- AC1: `Animation` interface + engine that targets channels by kind
  (cyclic hue if present, else RGB trio via conversion; value/brightness
  for intensity effects) so one animation definition runs on any family.
- AC2: Ships with ≥2 demos (hue sweep, breathe) with speed control,
  start/stop, running through the normal transport limits.
- AC3: Client animations stop cleanly when bindings/sliders move the
  same channels (user input wins).

## F17 — Navigation shell (nested menus) — planned

App splits into sections so users see only what they want: **Control**
(default: channel strips, combined wheel, diode view), **Controller**
(profile + binding editor), **Animations** (F16), Schedules (future).

- AC1: Tab/menu shell with the default landing on Control; last-used tab
  remembered.
- AC2: Architecture allows sections to be added (Schedules) without
  restructuring — sections are render functions over shared state.

## Principle P1 — Family-agnostic UI

Every feature above must degrade gracefully across ALL drivers, not just
the family used in field testing: capability-driven (channel kinds,
cyclic flags, step counts), never hardcoded to one driver's channel ids.

## Deferred (recorded, not in this batch)

- Hold-to-repeat on step bindings.
- Chorded selection ("Start+Select+D-pad picks which lamp/group") — needs
  multi-device connections first.
- Per-pixel smear channels for addressable LEDnetWF models.
- Profile sharing gallery (beyond file export/import).
