# hardware/

Open hardware companions to the app. Plan and design rules live in
[`docs/research/06-hardware-targets.md`](../docs/research/06-hardware-targets.md)
(Tier 4).

| Board | What it is | Status |
|---|---|---|
| [`encoder-knob/`](encoder-knob/) | Breadboard build: RP2040 + EC11 encoder(s) → USB HID dial read by the app via WebHID. CircuitPython firmware included. | **working** |
| `knob-one/` | The `encoder-knob` circuit as a fab-ready PCB (1–4 encoders, optional OLED). | planned |
| `quad-mosfet-hat/` | 4-channel MOSFET carrier for ESP32 devkits (analog 12/24 V RGB(W) strips) with screw terminals. | planned |

Rules when contributing a board:

- KiCad 8+ native project files committed (no binary-only exports).
- Per release tag: generated Gerbers, BOM (with LCSC part numbers for
  JLCPCB assembly), and CPL zips.
- A README per board with difficulty rating and a hand-solder-friendly
  variant where feasible (classroom use is a design goal).
- Until the PCBs exist, both builds work fine on breadboards — see the
  Tier 1/Tier 3 recipes in the research doc.
