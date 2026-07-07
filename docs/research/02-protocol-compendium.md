# 02 — Protocol Compendium

Byte-level facts for each supported (or planned) device family. All values
hex unless noted. Confidence levels: **community-verified** = multiple
independent reverse-engineering efforts agree; **reported** = single source,
not yet reproduced by us. Update to **verified-by-us** only after testing
against real hardware, and note the exact device/firmware tested.

Cross-reference: machine-readable form of everything here lives in
[`knowledge-graph.yaml`](knowledge-graph.yaml).

---

## Family: ELK-BLEDOM (a.k.a. Lotus Lantern strips) — confidence: community-verified

The most common cheap BLE RGB strip controller. Vendor apps: **Lotus Lantern /
LotusLamp X / duoCo Strip**. Sold under countless brand names.

### GATT
| Role | UUID |
|---|---|
| Primary service | `0000fff0-0000-1000-8000-00805f9b34fb` |
| Write (commands) | `0000fff3-0000-1000-8000-00805f9b34fb` |
| Notify/read | `0000fff4-0000-1000-8000-00805f9b34fb` |
| Variant service (some units) | `0000ffe0…` with write `0000ffe1…`, read `0000ffe2…` |

### Commands (write-without-response to fff3, 9-byte frames `7e … ef`)
| Action | Bytes | Notes |
|---|---|---|
| Power on | `7e 07 04 ff 00 01 02 01 ef` | some captures show `7e 00 04 f0 00 01 ff 00 ef` — both accepted on tested units (firmware variants) |
| Power off | `7e 07 04 00 00 00 02 01 ef` | variant: `7e 00 04 00 00 00 ff 00 ef` |
| Set RGB | `7e 07 05 03 RR GG BB 10 ef` | RR/GG/BB = 0x00–0xFF. **8-bit per channel = 256 steps.** |
| Brightness | `7e 04 01 BB 01 ff 02 01 ef` | BB = 0x00–0x64 (**0–100 decimal → only 101 steps!**) |
| MELK init (some MELK-* units) | write `7e 07 83` -prefixed init frames before first command | see dave-code-ruiz/elkbledom source |

### Quirks
- Brightness is a *separate multiplier* over RGB with coarser (1%) resolution.
  For maximum precision, drive RGB directly and leave brightness at 100.
- Devices accept writes with no pairing/bonding; anyone in radio range can
  control them (see threat model doc).
- No reliable state read-back on most units; treat as write-only and shadow
  state locally.

Sources: https://github.com/8none1/elk-bledob (Wireshark captures),
https://github.com/dave-code-ruiz/elkbledom (UUIDs, name table, MELK init).

---

## Family: Triones / HappyLighting — confidence: community-verified

Classic cheap RGBW BLE bulbs and strips. Vendor apps: Triones, HappyLighting.

### GATT
| Role | UUID (16-bit) |
|---|---|
| Service | `FFD5` |
| Write | `FFD9` |
| Notify (status) | `FFD4` |

### Commands (write to FFD9)
| Action | Bytes | Notes |
|---|---|---|
| Power on | `cc 23 33` | |
| Power off | `cc 24 33` | |
| Static RGB | `56 RR GG BB 00 f0 aa` | 8-bit per channel |
| White channel | `56 00 00 00 WW 0f aa` | WW = white intensity 0x00–0xFF; **RGB and W are mutually exclusive modes** on most units |
| Built-in mode | `bb MM SS 44` | MM = 0x25–0x38, SS = speed 0x01 (fast)–0xFF (slow) |
| Status query | `ef 01 77` | 12-byte notification on FFD4 |

### Status response (12 bytes on FFD4)
`66 ?? PW MD ?? ?? RR GG BB WW ?? 99` — PW: 0x23 on / 0x24 off; MD: 0x41 =
static color, 0x25–0x38 = built-in mode.

### Quirks
- True RGBW hardware but firmware forbids simultaneous RGB+W — expose as two
  exclusive channel groups, not four free channels.
- One of the few cheap families with **readable state**: use it to seed the UI.

Source: https://github.com/madhead/saberlight/blob/master/protocols/Triones/protocol.md,
https://github.com/sysofwan/ha-triones.

---

## Family: Zengge LEDnetWF (BLE side of Magic Home) — confidence: community-verified

Zengge's BLE product line (ring lights, fairy strings, strips, sunset
lamps). Vendor app: Zengge / Magic Home family. **Field sighting
2026-07-07:** a Zengge-app sunset lamp advertising `LEDnetWF020027A5AE11`
(name = `LEDnetWF` + 4 product hex + 8 MAC hex) via our Diagnose mode.

### GATT
| Role | UUID |
|---|---|
| Service | `0000ffff-0000-1000-8000-00805f9b34fb` (variant units: `0000ff00…`) |
| Write | `0000ff01-0000-1000-8000-00805f9b34fb` |
| Notify | `0000ff02-0000-1000-8000-00805f9b34fb` |

### Verbatim packets (captures from 8none1/zengge_lednetwf)
| Action | Bytes |
|---|---|
| Power on | `00 04 80 00 00 0d 0e 0b · 3b 23 00 00 00 00 00 00 00 32 00 00 · 90` |
| Power off | `00 5b 80 00 00 0d 0e 0b · 3b 24 00 00 00 00 00 00 00 32 00 00 · 91` |
| HSV color (fw 0x53) | `00 05 80 00 00 0d 0e 0b · 3b a1 HH SS VV 00 00 00 00 00 00 00 · chk` |
| LED-settings query | `00 35 80 00 00 04 05 0a · 81 8a 8b · 96` (response arrives on ff02 → identity probe) |
| Effect (fw 0x53) | `00 06 80 00 00 04 05 0b · 38 EE SS BB` (effect 0x01–0x71, speed/brightness 1–0x64) |

Checksum = sum of payload bytes & 0xFF (wrapper excluded) — confirmed:
power-on `0x3b+0x23+0x32 = 0x90`. Wrapper byte 7 is `0x0b` for commands,
`0x0a` for queries expecting a response; SEQ (byte 1) increments and is
generally ignored by the device.

### Framing (all commands share a fragmenting wrapper)
| Byte(s) | Meaning |
|---|---|
| 0 | Flags; `40` = fragmented |
| 1–2 | Command counter (device mostly ignores) |
| 3 | Fragment flags; `80` = final/only fragment |
| 4 | Fragment counter |
| 5–6 | Total payload length, big-endian (first fragment only) |
| 7 | Bytes to end incl. checksum (first fragment only) |
| 8 | Usually `0b` (first fragment only) |
| last | Checksum = sum of post-header bytes (device often ignores) |

### Payload highlights
- Power: `23` = on, `24` = off (same magic numbers as Triones — shared
  heritage across Chinese LED firmware).
- Color set uses **HSV**, hue stored as `hue/2` to fit one byte (→ 180 hue
  steps), saturation & value as 0–100 (**101 steps each**).
- Effects: numbered 0x01–0x71 (fw 0x53, ring lights) or 0x01–0x64 (fw 0x56,
  strips).
- "Smear" custom pattern command: per-pixel RGB for addressable models —
  future path to per-diode control on this family.
- LED configuration command sets chip type, color order, pixel count.

### Identification bonus
Advertises as `LEDnetWF` + MAC suffix; **advertising manufacturer data
contains power state, current color, and config without connecting** —
useful for passive state display.

Source: https://github.com/8none1/zengge_lednetwf (retired; work continues at
https://github.com/8none1/lednetwf_ble).

---

## Family: SP110E (BanlanX SPxxx) pixel controllers — confidence: community-verified

~$5 BLE controllers for addressable strips (WS2812B, SK6812, …). Vendor app:
LED Hue. Related models SP105E, SP107E, SP611E etc. differ in protocol —
treat each as its own family until verified.

### GATT
| Role | UUID (16-bit) |
|---|---|
| Service | `FFE0` |
| Write/notify characteristic | `FFE1` (descriptor `2902`) |

### Protocol
- 14 commands, each **4 bytes**: `[d0 d1 d2 CMD]` (data first, command byte
  last; rename is longer).
- **Init handshake required immediately after connect** or the device drops
  the link: write `01 00` to `FFE2`, then `01 b7 e3 d5` to `FFE1`.

| Action | Cmd byte | Data bytes | Notes |
|---|---|---|---|
| CHECK_DEVICE | `d5` | 3 | device info + checksum validation |
| GET_INFO | `10` | 0 | → 12-byte state notification (no checksum) |
| LED_ON / LED_OFF | `aa` / `ab` | 0 | |
| SET_STATIC_COLOR | `1e` | RR GG BB | 8-bit each |
| SET_BRIGHT | `2a` | BB | **true 0–255 → 256 steps** (beats ELK's 101) |
| SET_WHITE | `69` | WW | white diode on RGBW ICs (SK6812 RGBW etc.) |
| SET_MODE | `2c` | MM | presets 1–120; **121 = static color** |
| SET_SPEED | `03` | SS | preset animation speed |
| SET_MODE_AUTO | `06` | 0 | cycle presets |
| SET_IC_MODEL | `1c` | 1 | ⚠ config-tier: 32 IC types (SM16703…PG412) |
| SET_RGB_SEQ | `3c` | 1 | ⚠ config-tier: RGB/RBG/GRB/GBR/BRG/BGR |
| SET_LED_NUM | `2d` | 2 | ⚠ config-tier: pixel count 1–1024 |
| RENAME | `bb` | len+ASCII | |

### Correction (2026-07-07)
Earlier notes here claimed per-pixel control. **Wrong**: the SP110E BLE
protocol is whole-strip only — no per-pixel streaming exists. Its precision
value over ELK-BLEDOM is the true 256-step brightness path and a real white
channel on RGBW ICs. Per-pixel on sealed BLE hardware currently means
LEDnetWF addressable models ("smear" command).

Source: https://gist.github.com/mbullington/37957501a07ad065b67d4e8d39bfe012
(LED Hue app RE), https://github.com/roslovets/SP110E (asyncio reference
implementation).

---

## Family: MagicHome2 BLE string lights (SurpLife / YIQU) — confidence: reported

Fully reverse-engineered BLE protocol + ESPHome integration exists at
https://github.com/rabidpaperclip/magichome2-ble (app `com.zennge.magichome2`).
Not yet distilled here — pull byte tables from that repo when adding the
driver.

---

## Family: Zengge Wi-Fi (Magic Home / flux_led) — confidence: community-verified, out of BLE scope

The Wi-Fi siblings speak a TCP protocol on port 5577, fully implemented in
https://github.com/lightinglibs/flux_led (now in Home Assistant core).
Web pages cannot open raw TCP sockets, so browser support requires a local
bridge (future `transport.bridge`); recorded for completeness.

---

## Shared observations across families

1. **Write-mostly protocols.** Only Triones and LEDnetWF give usable state
   feedback. Architecture must shadow state client-side.
2. **8-bit ceilings, sometimes worse.** RGB channels are 8-bit everywhere;
   brightness/saturation paths are often 0–100. The UI must surface the
   *actual* step count per parameter (core product promise).
3. **No authentication anywhere.** None of these families pair or bond.
   Security burden falls entirely on our side (see 05).
4. **16-bit "FFxx" pseudo-standard UUIDs collide.** `FFE0/FFE1` is used by
   SP110E *and* some ELK variants *and* generic HM-10 serial modules —
   service UUID alone is not identification (see 04).
5. **Init sequences matter.** MELK and SP110E both require magic writes on
   connect. Driver interface must have a `postConnect()` hook.
