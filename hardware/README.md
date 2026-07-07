# hardware/

Open hardware companions to the app. Nothing here yet — the plan and design
rules live in [`docs/research/06-hardware-targets.md`](../docs/research/06-hardware-targets.md)
(Tier 4).

Planned boards:

| Board | What it is | Status |
|---|---|---|
| `knob-one/` | RP2040 + 1–4 EC11 rotary encoders presenting USB HID; the canonical "encoder wheel light toy" input. | planned |
| `quad-mosfet-hat/` | 4-channel MOSFET carrier for ESP32 devkits (analog 12/24 V RGB(W) strips) with screw terminals. | planned |

Rules when contributing a board:

- KiCad 8+ native project files committed (no binary-only exports).
- Per release tag: generated Gerbers, BOM (with LCSC part numbers for
  JLCPCB assembly), and CPL zips.
- A README per board with difficulty rating and a hand-solder-friendly
  variant where feasible (classroom use is a design goal).
- Until the PCBs exist, both builds work fine on breadboards — see the
  Tier 1/Tier 3 recipes in the research doc.
