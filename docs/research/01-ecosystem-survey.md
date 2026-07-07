# 01 — Ecosystem Survey (Prior Art)

Goal: understand what already exists, what the DIY/lighting community has
adopted, and where DiodeToyTuner's niche is. Gathered 2026-07.

## The niche, precisely

Existing projects cluster into four groups. None of them is "a precision,
protocol-speaking remote for the stock firmware on cheap BLE controllers,
with arbitrary physical-input mapping":

1. **Replacement firmware** (WLED, ESPHome) — total control, but you must own
   flashable hardware (ESP8266/ESP32) and reflash it. Doesn't help with the
   sealed BLE controllers sold with strips on Amazon/AliExpress.
2. **PC-peripheral RGB** (OpenRGB) — huge device matrix, direct-to-hardware
   control, plugin architecture worth imitating; but scoped to PC components
   and USB, not standalone BLE lighting.
3. **Effect engines** (LedFx, Hyperion) — treat lights as output for audio /
   video pipelines; deliberately *not* per-knob manual control.
4. **Vendor-app replacements** (Home Assistant custom integrations,
   Lotus-Lantern-GUI, Elkotrol) — speak the right protocols, but are either
   bound to a smart-home hub, single-family, or single-platform desktop apps.
   These are our richest *protocol* sources.

## Project-by-project

### WLED — `https://github.com/wled/WLED` (formerly Aircoookie/WLED)
- ESP32/ESP8266 firmware for addressable LEDs (WS2812B, SK6812, APA102…) and
  analog PWM RGB(W). The de-facto community standard; enormous ecosystem
  (controllers sold pre-flashed: Athom, GLEDOPTO; QuinLED boards designed
  for it). EUPL-1.2 licensed, C++.
- **Borrow:** its JSON API is a good reference for a clean lighting state
  model (segments, per-channel values, transitions); its "usermod" pattern for
  extensions; its hardware compatibility lists.
- **Interop:** a WLED device on the LAN is itself a great DiodeToyTuner
  target later via HTTP/JSON (`transport.http`), giving us addressable-pixel
  precision on open hardware without writing firmware ourselves.

### OpenRGB — `https://openrgb.org`
- Cross-platform C++ app controlling PC RGB (motherboards, RAM, peripherals)
  without vendor software; universal SDK/API; plugin system; also speaks
  E1.31. Community standard for "one app instead of 6 vendor apps."
- **Borrow:** the *universal device abstraction* (every device = zones →
  LEDs, each with modes); the SDK-server idea (external programs drive
  lights through one local API); their hard-won lesson that reverse-engineered
  SMBus writes need conservative safety rails.

### LedFx — `https://github.com/LedFx/LedFx`
- Python music-visualization engine driving WLED/E1.31 devices. Popular for
  audio-reactive setups.
- **Borrow:** virtual-device grouping (many physical devices → one logical
  canvas); confirms our decision *not* to compete on effects.

### flux_led / Magic Home ecosystem — `https://github.com/lightinglibs/flux_led`
- Python utility + library for Zengge-manufactured Wi-Fi "Magic Home" devices;
  protocol reverse-engineered from app packet captures; absorbed into Home
  Assistant core. The canonical Zengge Wi-Fi protocol reference.
- **Borrow:** device-model detection tables (they map model numbers →
  capabilities), dimmable-channel handling, and their approach of shipping a
  library + thin CLI.

### Zengge BLE (LEDnetWF) — `https://github.com/8none1/zengge_lednetwf` → `https://github.com/8none1/lednetwf_ble`
- Reverse-engineered BLE protocol for Zengge's LEDnetWF devices (the BLE side
  of the Magic Home / Zengge app family). Repo includes full packet-format
  docs; active work continues in the `lednetwf_ble` Home Assistant
  integration. Details captured in [02-protocol-compendium.md](02-protocol-compendium.md).

### ELK-BLEDOM family (Lotus Lantern) —
`https://github.com/dave-code-ruiz/elkbledom`, `https://github.com/8none1/elk-bledob`
- The single most common cheap BLE strip controller on Amazon. Controlled by
  the "Lotus Lantern" / "LotusLamp X" / "duoCo Strip" apps. Multiple
  independent reverse-engineering efforts agree on the protocol (see
  compendium). Home Assistant custom component `elkbledom` supports 19+ name
  variants — its name-matching table seeded our identification research.
- Community GUIs exist (Lotus-Lantern-GUI in Python/CustomTkinter,
  OpenRGBLotusLantern plugin, Elkotrol on XDA) — all single-family. Their
  existence proves demand for exactly what we're building, generalized.

### Triones / HappyLighting — `https://github.com/madhead/saberlight`, `https://github.com/sysofwan/ha-triones`
- Classic cheap RGBW BLE bulbs/strips. saberlight's `protocols/Triones/protocol.md`
  is a model of good protocol documentation (we mirror its style). Simple
  fixed-frame protocol, fully captured in the compendium.

### SP110E and SPxxx pixel controllers — `https://github.com/roslovets/SP110E`
- ~$5 BLE controllers for *addressable* strips (WS2812 etc.). Protocol
  reverse-engineered from the "LED Hue" app (14 four-byte commands, service
  FFE0/char FFE1). Python asyncio driver + HA integration exist. Whole-strip
  control only (no per-pixel over BLE — corrected 2026-07-07), but the
  brightness path is a true 256 steps and RGBW ICs get a real white channel.

### HID Remapper — `https://www.remapper.org`
- Open source RP2040-based universal input remapper, *configured entirely via
  WebHID from a web page*. Proves the exact interaction pattern we want for
  input mapping (expressions, layers, macros — all configured in-browser).
- **Borrow:** UI patterns for binding physical inputs to abstract outputs;
  evidence that WebHID-configured tooling is accepted by the accessibility
  and input-hacking communities.

### Home Assistant as protocol commons
- The single richest source of maintained, battle-tested BLE LED protocol
  code is HA custom integrations (`elkbledom`, `lednetwf_ble`, `ha-triones`,
  `SP110E-HASS`, `lotus-lantern-HACS`, `magichome2-ble`). Their issue trackers
  document real-device quirks (init sequences, notification requirements,
  firmware variants). When a driver misbehaves, check the corresponding HA
  integration's issues first.

## Gap analysis → our scope

| Capability | WLED | OpenRGB | HA integrations | Vendor apps | **DiodeToyTuner** |
|---|---|---|---|---|---|
| Works on sealed cheap BLE controllers | ✗ (needs reflash) | ✗ | ✓ | ✓ | ✓ |
| No hub/install required | ✗ | ✗ | ✗ (needs HA) | app install | ✓ (web) |
| Raw per-channel precision UI | partial | partial | ✗ (bulb model) | ✗ | **core feature** |
| Arbitrary physical-input mapping | ✗ | ✗ | via automations (clunky) | ✗ | **core feature** |
| Honest quantization display | ✗ | ✗ | ✗ | ✗ | **core feature** |
| Forkable single-purpose codebase | firmware | large C++ | plugin-bound | ✗ | ✓ |

## Sources

- https://github.com/wled/WLED and https://kno.wled.ge/
- https://openrgb.org and https://openrgb.org/plugins.html
- https://github.com/LedFx/LedFx
- https://github.com/lightinglibs/flux_led
- https://github.com/8none1/zengge_lednetwf, https://github.com/8none1/lednetwf_ble
- https://github.com/dave-code-ruiz/elkbledom, https://github.com/8none1/elk-bledob
- https://github.com/madhead/saberlight/blob/master/protocols/Triones/protocol.md
- https://github.com/sysofwan/ha-triones
- https://github.com/roslovets/SP110E, https://github.com/roslovets/SP110E-HASS
- https://github.com/rabidpaperclip/magichome2-ble
- https://github.com/saharki/lotus-lantern-HACS
- https://github.com/SmartyDolla/Lotus-Lantern-GUI, https://github.com/Rattlyy/OpenRGBLotusLantern
- https://www.remapper.org/manual/
- https://xdaforums.com/t/app-elkotrol-elk-bledom-bluetooth-led-strip-control-app.4597905/
