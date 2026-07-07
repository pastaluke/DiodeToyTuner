# encoder-knob — the $7 precision dial

A rotary encoder that shows up in DiodeToyTuner as a clean relative-detent
HID input: turn the wheel, nudge any channel one hardware step at a time.
This is the canonical "physical knob for a digital value" build from the
project README.

## Parts (~$7)

| Part | Qty | ~Cost | Notes |
|---|---|---|---|
| RP2040 board (Raspberry Pi Pico, Waveshare RP2040-Zero, …) | 1 | $4 | any CircuitPython-capable RP2040 |
| EC11 rotary encoder (with push switch) | 1 | $1–3 | ubiquitous; salvage from old gear works |
| Wire / header / knob cap | — | $1 | |

## Wiring (Pico pin numbers; any GPIOs work — edit `code.py`)

```
EC11 A   → GP2
EC11 B   → GP3
EC11 C   → GND        (encoder common)
EC11 SW  → GP4        (push switch, other side to GND)
```

No pull-up resistors needed — the sketch enables internal pull-ups.

## Firmware

1. Install [CircuitPython](https://circuitpython.org/) on the board (drag
   the UF2 onto the `RPI-RP2` drive).
2. Copy `boot.py` and `code.py` from this directory onto the `CIRCUITPY`
   drive.
3. Done. The board enumerates as a HID device on vendor usage page
   `0xFF60` sending 2-byte reports: `[int8 detent_delta, uint8 buttons]`.

In the app, click **＋ knob / HID device**, pick the board, then hit
**🎮 learn** on any channel and turn the wheel. One detent = one binding
step (gain adjustable per binding).

## Why usage page 0xFF60?

Vendor-defined page (same convention QMK uses for raw HID) — it guarantees
the OS doesn't claim the device as a keyboard/mouse, keeps it outside the
browser's HID blocklist, and gives WebHID a precise filter. The report
format is deliberately trivial so ports to Arduino/PlatformIO are easy.

## Multi-knob variant

`code.py` supports up to 4 encoders — populate the `ENCODERS` list. Future
`knob-one` PCB (see [docs/research/06-hardware-targets.md](../../docs/research/06-hardware-targets.md)
Tier 4) is this exact circuit as a fab-ready board.
