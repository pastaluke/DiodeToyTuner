# DiodeToyTuner

**The GIMP/Audacity of LED control.**

DiodeToyTuner is an open source, precision remote for cheap, ubiquitous BLE LED
controllers — the boards that normally lock you into vendor apps like **Zengge
Magic Home** or **Lotus Lantern / LotusLamp X**. Instead of a wall of pre-saved
"party mode" profiles, it gives you *every knob the hardware actually exposes*,
each one addressable as a continuous value between `0.0` and `1.0`, at whatever
real resolution the device supports.

Think:

- **DSLR-level control** — but for the power a diode receives.
- **Photoshop/GIMP-level control** — but for light instead of pixels.
- **Audacity-level control** — but for LEDs instead of audio.

It runs as a web app (Chrome/Edge/Chromium, via Web Bluetooth) so there is
nothing to install, nothing phones home, and every write to your hardware is
gated behind an explicit user gesture in a browser-owned device picker.

## What it does

1. **Connects** to common, inexpensive BLE LED controllers (ELK-BLEDOM /
   Lotus Lantern strips, Triones / HappyLighting bulbs, Zengge LEDnetWF,
   SP110E pixel controllers, …) using their reverse-engineered protocols.
2. **Describes** the device as a set of *channels* (R, G, B, W, per-pixel where
   available) with honest metadata: bit depth, real step count, quantization.
   No fake precision — if the device is 8-bit, you see all 256 steps and
   exactly which one you're on.
3. **Tunes** each channel with unit-interval floats (`0.0 – 1.0`), via sliders
   with fine-step keyboard control, numeric entry, or…
4. **Maps physical inputs to channels.** Plug in a USB/BT rotary encoder, a
   game controller, an old Stadia controller in Bluetooth mode — and bind any
   axis/button/wheel to any channel or channel group, Steam-Controller-style,
   with per-binding curves, gains, and relative/absolute modes.

## Why not just use WLED / OpenRGB / LedFx?

Those are excellent projects and we borrow ideas from all of them (see
[`docs/research/01-ecosystem-survey.md`](docs/research/01-ecosystem-survey.md)).
But they answer different questions:

| Project | Question it answers |
|---|---|
| **WLED** | "What firmware should I flash onto *my own* ESP32?" |
| **OpenRGB** | "How do I control the RGB on my *PC components*?" |
| **LedFx** | "How do I make my lights react to *music*?" |
| **Vendor apps** (Magic Home, Lotus Lantern) | "How do I pick one of 200 canned effects?" |
| **DiodeToyTuner** | "How do I get *raw, precise, scriptable, mappable* control of the diodes on the cheap controller I already own — without reflashing it?" |

## Example projects this enables

- **Encoder-wheel light toy** — a $3 rotary encoder mapped to hue; a second
  one mapped to brightness. Instant interactive light sculpture.
- **Wavelength room** — a panel that drives single diode channels in
  isolation (R alone, G alone, B alone, W alone) at finely tuned intensities,
  for experiencing narrow-band light in a dark room.
- **Controller-as-lighting-desk** — Start+Select+D-pad selects a light or
  group; sticks and triggers tune the selected channels. Config is a JSON
  mapping profile you can share.

## Repository layout

```
├── app/                     # The web app (Vite + TypeScript, Web Bluetooth)
│   └── src/
│       ├── core/            # Capability model, unit-interval value math
│       ├── drivers/         # One driver per protocol family
│       ├── transport/       # Web Bluetooth wrapper, write pacing
│       ├── input/           # Gamepad / WebHID sources + mapping engine
│       └── ui/              # Minimal, honest UI
├── docs/
│   ├── architecture.md      # How the pieces fit; how to add a driver
│   └── research/            # ← Research corpus. START HERE for agents.
│       ├── 00-INDEX.md
│       ├── 01-ecosystem-survey.md
│       ├── 02-protocol-compendium.md
│       ├── 03-web-platform-capabilities.md
│       ├── 04-device-identification.md
│       ├── 05-security-threat-model.md
│       ├── 06-hardware-targets.md
│       └── knowledge-graph.yaml   # Machine-readable facts + relations
├── hardware/                # (Planned) open PCB designs for DIY boards
└── SECURITY.md
```

## Quick start

```bash
cd app
npm install
npm run dev        # open the printed URL in Chrome/Edge
```

Then click **Connect a device**, pick your LED controller from the browser's
Bluetooth chooser, and start tuning. `npm run build` type-checks and produces
a static bundle you can host anywhere (HTTPS is required for Web Bluetooth,
except on `localhost`).

## Design principles

1. **Unit interval everywhere.** Every tunable parameter is a float in
   `[0, 1]`. Drivers quantize to hardware resolution and report the real step
   size back to the UI. Precision is never faked.
2. **Drivers are honest capability descriptors.** A driver's job is to say
   *exactly* what the hardware exposes — individually addressable diodes,
   grouped RGB(W), global brightness multipliers — and nothing more.
3. **Local-only by default.** No cloud, no accounts, no telemetry. The only
   network the app touches is the Bluetooth radio, and only after a user
   gesture.
4. **Allowlist, don't guess.** We only write to GATT services/characteristics
   that a driver explicitly declares for a positively identified device
   family. See [`docs/research/04-device-identification.md`](docs/research/04-device-identification.md).
5. **Forkable by design.** Small dependency surface, plain TypeScript,
   documented protocols, machine-readable research. Fork it into your art
   installation, your classroom kit, your product.

## Status

Early but functional. Working: research corpus + knowledge graph, capability
model, **ELK-BLEDOM, Triones, and SP110E drivers**, gamepad + WebHID input
sources, mapping engine core, reference RP2040 encoder-knob firmware
([`hardware/encoder-knob/`](hardware/encoder-knob/)), CI. See
[`docs/research/00-INDEX.md`](docs/research/00-INDEX.md) for what's known and
[`docs/architecture.md`](docs/architecture.md) for how to extend.

## License

[MIT](LICENSE) — maximally forkable, as intended.
