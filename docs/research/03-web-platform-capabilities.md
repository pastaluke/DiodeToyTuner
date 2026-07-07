# 03 — Web Platform Capabilities & Constraints

What the browser gives us, what it refuses, and the consequences for
architecture. Gathered 2026-07.

## Web Bluetooth (transport backbone)

- **Support:** Chromium-based browsers only (Chrome, Edge, Opera, Samsung
  Internet; Chrome on Android). Firefox and Safari have explicitly declined
  to implement, citing privacy/security. **Consequence:** we are a
  Chromium-first app; document this loudly; a future native/Tauri bridge is
  the answer for other browsers, not polyfills.
- **HTTPS required** (secure context), except `localhost` during dev.
- **User-gesture chooser:** `navigator.bluetooth.requestDevice()` may only be
  called from a user gesture and always shows a browser-owned picker. The
  page never sees devices the user didn't pick. This is a *feature* for us:
  the security story starts with "the browser physically cannot let us scan
  and connect silently."
- **Filters:** `requestDevice({filters: [{namePrefix}, {services}], optionalServices: […]})`.
  Services not listed in `filters`/`optionalServices` at request time are
  **invisible post-connect** — drivers must declare every service they might
  touch up front. This is our natural allowlist enforcement point.
- **GATT blocklist:** the spec ships a blocklist of services/characteristics
  (e.g. HID) that web pages may never touch, mitigating keystroke-injection
  style attacks. Our own allowlist sits on top of this.
- **Write modes:** `writeValueWithResponse` (ack'd, slow ~1 per conn interval)
  vs `writeValueWithoutResponse` (fast, lossy under buffer pressure). Cheap
  LED controllers want without-response + client-side pacing (~10–30 ms
  between frames) — hence the transport layer's write queue.
- **`watchAdvertisements()` / `requestLEDevice` scanning:** advertisement
  watching is still flag-gated/experimental in places; do not build core
  identification on it. Identification happens via chooser filters + post-
  connect GATT probing instead.
- **Reconnect:** `getDevices()` (persistent permissions) lets previously
  authorized devices reconnect without re-prompting (Chrome ≥ 85, behind
  Permissions Policy). Use for "reconnect on load" convenience.

## Gamepad API (controllers: Xbox, PlayStation, Stadia-in-BT-mode, generic)

- Poll-based: `navigator.getGamepads()` each animation frame; no events for
  axis motion. Standard mapping (`mapping: "standard"`) normalizes most
  modern pads: 4 axes in **[-1, 1]** (analog sticks), 17 buttons with
  `.value` in **[0, 1]** — triggers are analog buttons 6/7. This maps
  beautifully onto our unit-interval model.
- A Stadia controller in Bluetooth mode enumerates as a standard gamepad —
  the user's "Start+Select+D-pad selects group" scenario needs zero special
  code, just chord detection in the mapping engine.
- No system-level remapping possible from a page; we ship our own mapping
  layer (that *is* the product).
- Browsers require a button press before a pad becomes visible (fingerprint
  protection) — surface "press any button" hint in UI.

## WebHID (rotary encoders, custom knobs, exotic inputs)

- Chromium desktop only. `navigator.hid.requestDevice()` with usage-page
  filters; page receives `inputreport` events with raw report bytes.
- Lets us read devices the Gamepad API doesn't understand: USB rotary
  encoders/knobs (e.g. Griffin PowerMate-alikes), jog wheels, custom
  RP2040 boards presenting vendor-defined HID usages.
- FIDO/keyboard-ish usages are blocklisted by the browser; fine for us.
- Precedent: **HID Remapper** (remapper.org) configures its hardware entirely
  via WebHID — community-accepted pattern.
- **DIY encoder recipe** (documented for users in 06): any $3 EC11 encoder +
  a $4 RP2040 running a 20-line CircuitPython sketch presenting either (a) a
  standard HID dial / consumer-control, or (b) a vendor-defined usage we read
  via WebHID. Either path plugs straight into the input engine.

## Web Serial / WebUSB (fallback lanes)

- Web Serial (Chromium desktop): talk to a USB-serial microcontroller — an
  alternative uplink for DIY input hardware or for a serial-attached LED rig.
- WebUSB: rarely needed given WebHID/Serial; keep out of scope until a
  concrete device demands it.

## Wi-Fi-device reality check

Browsers cannot open raw TCP/UDP sockets, so Wi-Fi families that speak raw
TCP (Magic Home port 5577) or UDP (E1.31/Art-Net) are unreachable from the
page alone. WLED's HTTP/JSON API *is* reachable (fetch), subject to the
device accepting cross-origin requests from a secure page (mixed-content:
HTTPS page → HTTP LAN device is blocked; Private Network Access rules apply).
**Decision:** BLE first; LAN/HTTP via optional local bridge process later
(`transport.bridge` entity in the graph).

## MIDI (bonus input source)

Web MIDI is broadly supported in Chromium; knob boxes (e.g. Korg nanoKONTROL)
are cheap, ubiquitous, and give 128-step CCs (14-bit with paired CCs). Cleanly
slots in as another input source class later.

## Sources

- https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API
- https://developer.mozilla.org/en-US/docs/Web/API/Bluetooth/requestDevice
- https://webbluetoothcg.github.io/web-bluetooth/ (incl. GATT blocklist)
- https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API
- https://w3c.github.io/gamepad/
- https://wicg.github.io/webhid/
- https://developer.chrome.com/blog/talking-to-the-stadia-controller-with-webhid
- https://www.remapper.org/manual/
