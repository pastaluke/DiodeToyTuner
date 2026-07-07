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

## Deferred (recorded, not in this batch)

- Hold-to-repeat on step bindings.
- Chorded selection ("Start+Select+D-pad picks which lamp/group") — needs
  multi-device connections first.
- Per-pixel smear channels for addressable LEDnetWF models.
- Profile sharing gallery (beyond file export/import).
