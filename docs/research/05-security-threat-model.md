# 05 — Security Threat Model

Scope: a browser app that writes to unauthenticated BLE lighting hardware and
reads local input devices. "It's just lights" is not an excuse — flashing
lights can harm (photosensitivity), wrong-device writes are a neighborly
hazard, and a web app is a high-exposure attack surface.

## Assets

1. The user's lights behaving only as the user intends.
2. Bystanders' devices (identical hardware in radio range) staying untouched.
3. User privacy: which devices they own, when they're home (light activity).
4. Input-device data (a game controller is low-risk; WebHID misuse is not).
5. Photosensitive users' health.

## What the platform already guarantees (do not weaken)

- **No silent scanning/connecting:** Web Bluetooth requires a user gesture +
  browser-owned picker; the page sees only the picked device.
- **Service scoping:** only services declared at `requestDevice()` time are
  accessible. → We declare exactly the union of driver allowlists, nothing
  more. *Never add a broad `optionalServices` list "for debugging".* 
- **GATT blocklist:** browser refuses access to HID-over-GATT etc.
- **Secure context:** HTTPS-only in production.

## Threats & mitigations

### T1 — Wrong-device writes (the neighbor's strip)
Identical unauthenticated controllers are common in dense housing.
- M1a: identification pipeline with confidence gate (doc 04).
- M1b: **blink-test binding** — user physically confirms the lamp before the
  driver unlocks full write access.
- M1c: per-device remembered bindings; UI always shows *which* named device a
  control surface is bound to.

### T2 — Malicious/compromised page dependencies (supply chain)
A lighting app doesn't need 400 npm packages.
- M2: near-zero runtime dependencies (currently: none beyond Vite at build
  time); lockfile committed; CI `npm audit` gate before adding anything.

### T3 — XSS / injected script drives the radio
Any script in-page inherits granted device permissions.
- M3a: strict Content-Security-Policy (no inline script, no remote script,
  no eval) shipped in `index.html` meta + host headers.
- M3b: no third-party analytics/CDN scripts, ever. Self-host everything.

### T4 — Malicious mapping profiles (shared JSON)
Profiles are shareable; a hostile profile could try to reference arbitrary
GATT writes or absurd strobe rates.
- M4a: profiles are **pure data** (JSON schema-validated); they may only bind
  inputs to *named driver parameters*, never to raw bytes/UUIDs.
- M4b: rate/flash limits enforced *below* the mapping engine (see T6), so no
  profile can exceed them.

### T5 — Unknown-device writes ("it might work" temptation)
Writing family-A bytes to family-B hardware is undefined behavior; some
controllers brick or wedge on malformed config commands (LED-count/chip-type
setters are the dangerous ones).
- M5a: config-mutating commands (pixel count, chip type, color order) are a
  separate driver capability tier, off by default, double-confirmed in UI.
- M5b: below-threshold identification → no writes (doc 04, rule 2).

### T6 — Photosensitive-seizure hazard
Fine-grained control + input mapping makes accidental high-frequency
full-field flashing easy (e.g. binding brightness to a noisy axis).
- M6a: transport-level slew/rate limiter: default cap ~10 full-range
  luminance transitions per second, with a documented, deliberate opt-out
  ("strobe mode") that shows a photosensitivity warning. WCAG's three-flashes-
  per-second threshold informs the conservative default for *sustained*
  flashing.
- M6b: input smoothing (deadzone + EMA) on analog sources by default.

### T7 — Privacy leakage
- M7: no telemetry, no cloud, no accounts. Device names/IDs and profiles are
  stored in `localStorage` only. Document that Web Bluetooth device IDs are
  origin-scoped and not globally trackable.

### T8 — Radio-level realities (accepted residual risk)
These BLE devices are unauthenticated by design; anyone in range can control
them with or without our app, and traffic is sniffable. We cannot fix the
hardware. We *document* it honestly and never market false security. (This is
also why we refuse to add "hide from other apps" pseudo-features.)

## Engineering rules (enforced in review)

1. Every GATT write goes through `transport/ble.ts` — no driver holds a raw
   characteristic handle for writing outside the paced, limited queue.
2. Drivers declare `services`, `writeChar`, `notifyChar`, and command
   builders as **data**; the transport enforces the allowlist.
3. New driver PRs must update `knowledge-graph.yaml` + doc 02 + doc 04 tables.
4. No `eval`, no `Function`, no dynamic script injection, no remote assets.
5. `SECURITY.md` at repo root covers reporting; keep it current.
