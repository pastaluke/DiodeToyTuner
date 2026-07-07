# 06 — Hardware Targets

What a user can buy, solder, or fabricate to use (or extend) DiodeToyTuner.
Ordered by cost and effort.

## Tier 0 — Sealed controllers you already own (~$5–15, zero effort)

The core audience. Supported/planned via BLE drivers:

| Hardware | Typical source | Family (driver) | Diode access granularity |
|---|---|---|---|
| "Bluetooth LED strip" controllers bundled with 5050 RGB strips | Amazon/AliExpress, dozens of brands | ELK-BLEDOM | grouped R,G,B (8-bit) + coarse brightness (101 steps) |
| RGBW BLE bulbs / strip controllers | same | Triones/HappyLighting | grouped R,G,B (8-bit) XOR W (8-bit) |
| Zengge BLE rings/fairy strings/strips | same | LEDnetWF | HSV path (180/101/101 steps); per-pixel via "smear" on addressable models |
| SP110E pixel controller | ~$5 | SP110E | **per-diode** on addressable strips; configurable chip/order/count |

Practical guidance for buyers wanting *maximum* tunability per dollar:
**SP110E + WS2812B/SK6812 strip** is the precision king among sealed BLE
gear — individually addressable diodes, 8-bit per subpixel, and SK6812 RGBW
adds a real white diode per pixel.

## Tier 1 — Solder-a-little: analog strips on open boards (~$8–20)

Non-addressable 12/24 V RGB(W) strips driven by MOSFETs from an ESP32 —
each color rail is a PWM channel you own end-to-end:

- **ESP32 devkit (~$4–6) + 4× logic-level N-MOSFET (IRLZ44N or AO3400) +
  12 V supply.** With WLED in PWM mode you get **up to 16-bit-ish PWM
  resolution** via LEDC — far beyond the 8-bit ceiling of sealed controllers.
  This is the cheapest route to genuinely fine intensity steps (dimming
  curves for the "wavelength room" use case).
- Pre-made option: **GLEDOPTO** and **Athom** sell inexpensive pre-flashed
  (WLED) controllers with screw terminals — no soldering at all.

DiodeToyTuner reaches these via the WLED JSON API once `transport.bridge`
lands (browser can't reach raw LAN cleanly; see doc 03).

## Tier 2 — Addressable on open boards (~$10–40)

- **QuinLED-Dig-Uno / Dig-Quad** (open design, sold assembled): the community
  standard for serious WLED rigs — proper level shifting (74HCT), fusing,
  screw terminals.
- Bare recipe: ESP32 + 74AHCT125 level shifter + 1000 µF cap + 330 Ω data
  resistor + WS2812B/SK6812 strip. Every guide in the WLED knowledge base
  (kno.wled.ge) applies.

## Tier 3 — Input hardware (the "physical knobs" side) (~$3–15)

- **EC11 rotary encoder ($1–3) + RP2040 board ($4, e.g. Pi Pico / Waveshare
  RP2040-Zero)** running a tiny CircuitPython sketch that presents a HID
  device → read via WebHID. This is the canonical "encoder wheel toy" build;
  a reference sketch belongs in `hardware/encoder-knob/` (planned).
- **Any standard gamepad** (Xbox/PS/Stadia-in-BT-mode/8BitDo): zero hardware
  work, Gamepad API, 4 analog axes + 2 analog triggers out of the box.
- **HID Remapper** (open source RP2040 firmware, remapper.org): turns
  arbitrary USB inputs into clean HID — pairs beautifully with our WebHID
  source.
- **MIDI knob boxes** (used Korg nanoKONTROL ≈ $20): 8–9 faders/knobs, Web
  MIDI, later milestone.

## Tier 4 — Custom PCBs (planned `hardware/` content)

Goal: publish KiCad projects + fab-ready Gerbers/BOM/CPL so anyone can order
from JLCPCB/PCBWay for a few dollars, or hand-etch:

1. **`knob-one`** — RP2040-Zero footprint + 1–4 EC11 encoders + optional
   OLED; USB HID input surface for DiodeToyTuner. (All through-hole/module
   parts option for classroom soldering.)
2. **`quad-mosfet-hat`** — 4-channel MOSFET carrier for ESP32 devkits with
   screw terminals and proper gate resistors; the Tier 1 recipe as a tidy
   board.

Design rules for this directory when work starts: KiCad 8+ native files
committed (no binary-only exports), generated Gerber/BOM/CPL zips per
release tag, LCSC part numbers in BOM for JLCPCB assembly, and a README per
board with a mouse-vs-solder difficulty rating.

## Sources

- https://kno.wled.ge/ (compatible hardware, wiring guides)
- https://github.com/wled/WLED
- https://quinled.info/ (Dig-Uno/Dig-Quad)
- https://www.remapper.org/
- https://github.com/roslovets/SP110E
- Community listings for GLEDOPTO/Athom pre-flashed controllers (via WLED docs)
