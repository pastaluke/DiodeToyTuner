# 07 — Sunset-Lamp Survey (app-controlled projection lamps)

Question investigated (2026-07-07): the Amazon "sunset lamp projector with
APP control" category (Neroupe, easeking, Tsrarey, and dozens of identical
listings) — do they all use the same tech/chip?

## Answer: no single chip, but a small number of recurring families

Sunset lamps are the same white-label BLE LED controllers as strip lights,
repackaged behind a lens. Community reporting and vendor manuals cluster
them into these app families:

| App the manual points to | Underlying family | Our support |
|---|---|---|
| **Zengge / Magic Home** | LEDnetWF (svc `ffff`, wrapped HSV frames) — **field-confirmed in a sunset lamp**: `LEDnetWF020027A5AE11` sighted via Diagnose, 2026-07-07 | ✅ driver shipped |
| **Lotus Lantern / LotusLamp X / duoCo Strip** | ELK-BLEDOM (`7e…ef` frames, svc `fff0`) | ✅ driver shipped |
| **HappyLighting / Triones** | Triones (svc `ffd5`) | ✅ driver shipped |
| **Smart Life / Tuya** | Tuya BLE or Wi-Fi module | ❌ out of reach: Tuya BLE is **authenticated + encrypted** (session keys from the Tuya cloud pairing); not a realistic Web Bluetooth target |
| **MohuanLED** | BJ_LED (cheapest AliExpress tier) | ⏳ protocol documented upstream, no driver yet |
| **iDeal LED** | idealLED (lightly encrypted, RE'd) | ⏳ protocol documented upstream, no driver yet |
| **LED Lamp / LED BLE-class apps** | LEDBLE/QHM-style (led-ble lib families) | ⏳ candidate, needs a real device report |

Implications:

1. A random "APP control" sunset lamp has a good chance (probably the
   majority of Amazon listings, which favor Lotus Lantern) of being
   ELK-BLEDOM — but it is NOT guaranteed, and Smart Life-based ones are
   effectively closed to us.
2. **The listing never tells you the chip.** The only reliable tells before
   purchase: which app the manual/listing names. After purchase: the BLE
   advertised name and GATT layout (→ use the app's Diagnose mode).
3. Name variants keep growing. Newly recorded: `ELK-LAMPL` (lamp-shaped
   ELK devices, from the elk-led-controller Rust library's device table) —
   added to our ELK chooser filters. `QHM-XXXX` names are reported working
   with Home Assistant's LED BLE integration (led-ble protocol class).

## Failure modes when a lamp "doesn't work" with our app

In order of likelihood:

1. **Not visible in the chooser** — its advertised name matches no driver's
   `namePrefix` filter. The chooser only shows devices matching some filter,
   so an unknown name is invisible rather than failing loudly.
   → Fixed by Diagnose mode (`acceptAllDevices`) + growing the name tables.
2. **Visible, connects, but GATT doesn't match** — different family than
   the name suggested; identification correctly refuses to write.
   → The Diagnose report tells us which family to implement.
3. **Smart Life / Tuya inside** — connects to nothing we can speak;
   requires the vendor app. Document, don't fight the crypto.
4. **Right family, variant command set** — e.g. ELK power frames differ by
   firmware; needs byte-table patch from a live report.

## Diagnose mode (added to the app because of this survey)

`🔍 Diagnose a device` uses `acceptAllDevices: true` plus a broad
`optionalServices` candidate list (all known LED service UUIDs + Device
Information `180a` + Nordic UART). It connects read-only, enumerates
services/characteristics with their properties, reads Device Information
strings when present, scores the evidence against every registered driver,
and renders a copyable report. No writes are ever sent in diagnose mode.

Candidate service list maintained in `app/src/diagnostics.ts`; keep it in
sync with new families here and in the knowledge graph.

## Sources

- https://github.com/dave-code-ruiz/elkbledom (ELK name zoo)
- https://github.com/b1scoito/elk-led-controller (ELK-LAMPL variant)
- https://github.com/8none1/bj_led (BJ_LED / MohuanLED)
- https://github.com/8none1/idealLED (iDeal LED, incl. att_protocol.md)
- https://github.com/8none1/ledble-ledlamp (LEDBLE "LED Lamp" app family)
- https://www.home-assistant.io/integrations/led_ble/ (QHM- report; led-ble class)
- https://lotus-lantern.com/ , https://apps.apple.com/us/app/lotuslanternx/id1279356519 ,
  https://play.google.com/store/apps/details?id=com.xiaoyu.hlight (vendor apps)
- https://www.galacticnight.com.au/blogs/news/how-to-connect-sunset-lamp-to-app-unlock-easy-ambience-control-2025
  (retailer confirming the Smart Life / HappyLighting / Lotus Lantern split)
