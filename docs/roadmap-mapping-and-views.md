# Roadmap: mapping customization & value views

Classified from the first hardware-verified field session (2026-07-07,
LEDnetWF sunset lamp + gamepad). F18+ classified from the second field
session (2026-07-08 — F1–F17 confirmed working on hardware, white diode
verified). Status values: `planned` → `shipped` → `verified`. Each
feature has acceptance criteria (AC) so any future session can pick it
up cold.

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

## F8 — LEDnetWF white channel — verified 2026-07-08 (brightness byte); temp byte does NOT change tint on the test lamp — see F19

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

## F9 — Cyclic channels (hue wraps around) — shipped

Hue 0.0 and 1.0 are both red, one hardware step apart. Channels gain
`cyclic: true`; all mutation paths wrap instead of clamping.

- AC1: `+1 step` at max lands on 0 (and vice versa); rotary/rate/step
  bindings cross the seam smoothly instead of pinning.
- AC2: Applies to any driver's cyclic channel, not just LEDnetWF hue.
- AC3: Absolute bindings and the slider still present 0→1 linearly (a
  slider can't wrap); the wheel view is the natural cyclic control.

## F10 — Toggle bindings for binary channels — shipped

- AC1: A button learned onto a 2-step channel (e.g. Power) defaults to a
  new `toggle` kind: each press flips the value.
- AC2: `toggle` is selectable in the binding editor for any channel
  (flips between 0 and 1).

## F11 — Learn button order — shipped

- AC1: `learn −` renders left of `learn +`, matching slider direction.

## F12 — Hue slider shows the spectrum — shipped

- AC1: Sliders for cyclic hue channels paint the full reachable spectrum
  along the track (red at both ends), for every family exposing hue.

## F13 — Channel info (ⓘ) — shipped

Each channel gets a brief explanation from high level down to the
physical diode ("Hue: which mix of the red/green/blue diodes is lit —
the lamp rotates diode duty cycles to fake the in-between colors").

- AC1: ⓘ per channel; click/hover reveals text; drivers may supply
  channel-specific text, with sensible fallbacks by channel kind so every
  family gets coverage.

## F14 — Combined color control (wheel with saturation radius) — shipped

One control representing the end result: a 2D disc — angle = hue,
radius = saturation (white at center). 

- AC1: Dragging sets hue+saturation together on HSV families.
- AC2: On RGB families the same control drives r/g/b via HSV→RGB
  conversion (value taken from the existing brightness/value channel) —
  the control is family-agnostic.
- AC3: Toggleable; preference saved in the profile.

## F15 — Physical diode view (pinnable) — shipped

Four rendered "LEDs" (R, G, B, W) showing what the physical diodes are
actually doing right now — brightness-accurate, so users don't stare at
bare emitters. Derivation: RGB families direct (× brightness multiplier
where the family has one); HSV families via HSV→RGB; white channels →
the W diode. 

- AC1: Available for every family; diodes the family lacks render as
  absent/off.
- AC2: Pinnable as a banner stuck to top or bottom that stays put while
  scrolling; pin state persists.

## F16 — Animation groundwork — shipped (2 demo animations)

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

## F17 — Navigation shell (nested menus) — shipped

App splits into sections so users see only what they want: **Control**
(default: channel strips, combined wheel, diode view), **Controller**
(profile + binding editor), **Animations** (F16), Schedules (future).

- AC1: Tab/menu shell with the default landing on Control; last-used tab
  remembered.
- AC2: Architecture allows sections to be added (Schedules) without
  restructuring — sections are render functions over shared state.

## F18 — White ↔ color mode toggle with shared brightness — shipped

Field feedback (2026-07-08): the only way to turn the white diode on was
raising White brightness, which silently killed the color diodes — and
the two modes kept separate brightness values, so toggling could jump
from very dim to very bright.

- AC1: LEDnetWF exposes a 2-step `White light` mode channel; the mode is
  an explicit toggle, not a side effect of a brightness slider.
- AC2: One shared `Brightness` value drives whichever mode is active and
  is preserved across toggles (no brightness surprises).
- AC3: The mode toggle is bindable to a controller button (existing
  `toggle` binding kind — 2-step channels learn as toggles by default).
- AC4: 2-step channels (Power, White light) render as labeled toggle
  buttons, not sliders.

## F19 — White temperature: field finding — recorded

On the verified sunset lamp, the white temperature byte does NOT change
tint — it only dims the lamp while white mode is on. Likely a
single-temperature white emitter (the vendor payload byte may scale
duty cycle on such units).

- AC1: Channel info + notes say this honestly ("may only dim on
  single-white hardware").
- AC2: Knowledge graph white_payload entry carries the field
  observation in the same commit.

## F20 — Adopt device state on connect — shipped (LEDnetWF layout needs verification)

The app opened with everything at 0, so the first slider touch stomped
the lamp's real state to zero and caused flashing while tuning hue/sat.

- AC1: Driver interface gains `readState()`; after identification the
  app merges whatever the device reports into the shadow state WITHOUT
  writing anything.
- AC2: Triones parses its documented 12-byte status frame
  (community-verified). SP110E parses GET_INFO (layout `reported`).
  LEDnetWF parses the settings-query response (layout hypothesized
  flux_led-style, `reported`) and surfaces the raw hex in the status
  line so a hardware session can verify/correct it.
- AC3: Families with no read-back keep defaults but never regress.

## F21 — Friendly wording — shipped

- AC1: "Value (brightness)" → "Brightness"; jargon lives behind ⓘ.
- AC2: Labels across drivers reviewed for plain words (SP110E
  "Brightness (true 256-step)" → "Brightness", etc.).

## F22 — Diode panel: numbers + black at zero — shipped

- AC1: Each diode in the pinnable bank shows its current power level as
  a number (percent).
- AC2: A diode at 0 renders as a black circle (clearly OFF), not a
  faint translucent disc.

## F23 — Pure-diode hash marks on hue controls — shipped

- AC1: Small R/G/B marks sit at the hue positions where only one diode
  conducts (0°, 120°, 240°) on the spectrum slider track and both
  wheels.
- AC2: Toggleable; preference saved in the profile.

## F24 — Sub-step brightness (question answered — no code path)

Hardware quantizes: the LEDnetWF lamp has exactly 101 brightness duty
levels; there is nothing between step N and N+1 to send. The honest
fix is hardware with more steps (SP110E: 256). Perceived low-end
jumpiness is PWM-linear vs. eye-log; a gamma remap would spend steps
differently but cannot create new ones. Recorded in Brightness ⓘ text.

## F25 — Binding editor info icon — shipped

- AC1: One ⓘ beside the kind dropdown explains every option (rotary /
  rate / step / toggle / absolute / action) in one popover.

## F26 — Controller diagram — shipped

- AC1: A standard-mapping gamepad diagram renders above the bindings
  list; controls that have assignments are highlighted and titled with
  what they do.
- AC2: Clicking a control highlights (and scrolls to) its binding rows
  where step values / modifiers are edited.
- AC3: Diagram is the standard Gamepad-API mapping — works for any
  standard-mapping pad (Stadia, Xbox, DS4 in BT mode).

## F27 — Freaky-slow animations — shipped

- AC1: Sweep/breathe speed maps log-scale down to multi-minute cycles
  (~30+ min per revolution at the floor) while keeping the old top end.
- AC2: The UI shows the resulting cycle time so slow settings are
  legible.

## F28 — Palettes — shipped

- AC1: "Save current color" appends the current hue/sat/brightness as a
  swatch to the active palette; the action is assignable to a
  controller button (new `action` binding kind).
- AC2: Palettes have names, persist in localStorage, and are shareable:
  Copy puts JSON on the clipboard, Import reads it back.
- AC3: Palette list shows each palette's swatches as the row background
  with text always readable in front.
- AC4: The palette creation row is pinnable to top or bottom and stays
  across tab navigation.

## F29 — Palette lerp animation — shipped

- AC1: New animation lerps hue/sat/brightness through the active
  palette's swatches (hue takes the short way around the circle).
- AC2: Transition style option: smooth crossfade, or fade brightness to
  0 and back up on each new color.
- AC3: Brightness override toggle: off = animate through each swatch's
  stored brightness; on = a uniform brightness slider wins.

## F30 — Schedules groundwork — shipped (client-side)

- AC1: Schedules tab: named schedules with time nodes; each node is a
  captured light setting ("add current light setting") or a palette
  animation start; toggle on/off, copy, edit, delete.
- AC2: A built-in template ships: bright white during the day, warm dim
  color in the evening, computed in the user's local time zone —
  copyable and editable.
- AC3: A client-side runner applies the most recent due node while the
  app is connected (checks every 30 s, applies once per node per day).
- AC4: Device-side schedules (running with the app closed) require the
  vendor timer/RTC commands — not yet reverse-engineered for any family;
  recorded as a research TODO in the knowledge graph, and the UI says
  honestly that schedules currently need the app connected.

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
