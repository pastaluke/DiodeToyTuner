# Ways to use this app

Every entry carries a status, mirroring the knowledge graph's confidence
levels:

- ✅ **verified** — someone ran the app against this exact setup and it
  worked. PRs flipping an entry to verified must name the device, advertised
  BLE name, and any quirks hit (and upgrade the matching
  `knowledge-graph.yaml` entries to `verified-by-us`).
- 🧪 **theoretical** — assembled from community-verified protocol research;
  expected to work, not yet demonstrated end-to-end with this app.

## Devices you may already own

| Setup | Status | Notes |
|---|---|---|
| Strip controlled by **Lotus Lantern / LotusLamp X / duoCo Strip** (ELK-BLEDOM family) | 🧪 theoretical | Driver shipped; protocol from two independent RE efforts. Largest install base — most likely first ✅. |
| Bulb/strip controlled by **HappyLighting / Triones** | 🧪 theoretical | Driver shipped; only family with state read-back, so the app can show real device state. |
| **SP110E** pixel controller (LED Hue app) | 🧪 theoretical | Driver shipped incl. the required init handshake. Whole-strip control only (BLE protocol has no per-pixel). |
| **Zengge / Magic Home BLE** (LEDnetWF names) | ❌ not yet | Next driver target (per-pixel "smear" command is the prize). |
| **Magic Home Wi-Fi**, **WLED** devices | ❌ not yet | Browsers can't reach them directly; needs the planned local bridge. |

## Running the app

| Method | Status | Notes |
|---|---|---|
| `npm run dev` on localhost, Chrome/Edge desktop with Bluetooth | 🧪 theoretical | Secure-context rules allow Web Bluetooth on localhost. |
| GitHub Pages (`.github/workflows/deploy-pages.yml`) → Chrome on Android | 🧪 theoretical | Repo Settings → Pages → Source: "GitHub Actions"; deploys on push to `main`. |
| Cloudflare Pages (root `app`, build `npm run build`, output `app/dist`) | 🧪 theoretical | Same bundle; relative base makes it host-agnostic. |
| iPhone | ⚠️ mostly no | iOS Safari/Chrome lack Web Bluetooth. The third-party "Bluefy" browser implements it; untested. Android or desktop is the smooth path. |

## 🧪 Theoretical cheapest option if you don't already own a compatible device

**The bowl lamp** (~$13–17): a single RGBW light source under any diffuse
white bowl/dome you already own, USB- or power-bank-powered, controlled by
this app over BLE.

### Shopping list

| Item | ~Cost | Buying notes |
|---|---|---|
| SP110E BLE controller — **USB-input version** | $5–6 | Amazon/AliExpress. Choose the variant with a USB-A plug for power and a 3-pin JST-SM output connector. |
| SK6812 **RGBW** strip, 1 m, 30 LED/m (warm- or neutral-white) | $8–10 | The RGBW part matters: a real dedicated white diode per pixel. You'll use ~15–20 cm; the rest is spare. |
| USB power | $0 | Any phone charger (mains) or USB power bank (battery mode — a small bank runs ~6 LEDs at full white for many hours). |

### Assembly (≈10 minutes, usually zero soldering)

1. Cut the strip at a marked cut line — ~6 LEDs is plenty under a bowl.
2. Plug the strip's JST-SM pigtail into the SP110E's output. (No pigtail on
   your strip → three wires to solder: 5 V, GND, Data-In. Mind the data
   direction arrows.)
3. Coil the segment face-up under the bowl; plug the controller into USB.

### One-time configuration quirk

The SP110E must be told the IC type (`SK6812_RGBW`) and pixel count once.
Those commands are documented in
[research/02-protocol-compendium.md](research/02-protocol-compendium.md) but
deliberately not exposed in the app yet — a wrong IC/count setting makes
strips display garbage, so they're config-tier (threat model M5a) pending a
double-confirm UI. Until then: set them once in the vendor "LED Hue" app,
then never open it again.

### What you get

Four independently tunable diode types under the diffuser — R/G/B at 8-bit
each, the white diode at 256 steps, plus a true 256-step brightness
multiplier. A miniature of the isolated-wavelength dark-room experiment, and
the natural first target for binding an encoder knob or gamepad stick.

## Verification protocol

When you test any entry above for real:

1. Note device model, advertised BLE name, firmware oddities.
2. Flip the row to ✅ with those details.
3. Upgrade the corresponding `confidence:` fields in
   [research/knowledge-graph.yaml](research/knowledge-graph.yaml) to
   `verified-by-us` in the same commit.
