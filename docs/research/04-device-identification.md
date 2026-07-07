# 04 — Reliable Device Identification

The user's intent is "control *that* strip on *my* desk." Our job is to
(a) help them find it in the browser chooser, and (b) once connected, decide
**with evidence** which protocol family it speaks before writing a single
byte. Mis-identification is both a UX bug and a safety bug.

## Why it's hard

1. **16-bit `FFxx` UUID collisions.** `FFE0/FFE1` is used by SP110E, some
   ELK variants, and every HM-10 UART module on earth. `FFF0` appears on
   ELK-BLEDOM *and* unrelated gadgets (heart-rate toys, diffusers). A service
   UUID alone is a *hint*, never an identification.
2. **Name chaos.** The same board ships under dozens of advertised names
   (`ELK-BLEDOM`, `ELK-BLEDOB`, `MELK-OA10`, `LEDBLE`, `XROCKER`,
   `JACKYLED`, …). Conversely, some vendors let users rename devices.
3. **No standard Device Information.** Cheap firmware rarely implements the
   Device Information Service (0x180A); when it does, strings are junk.
4. **Web Bluetooth constraint:** we can't passively scan and sniff; we get
   exactly one user-picked device and only the services we pre-declared.

## Identification pipeline (implemented in `app/src/drivers/registry.ts`)

```
Stage 0  Chooser filters      — union of all drivers' {namePrefix, service}
                                filters → the browser only shows plausible
                                devices to the user in the first place.
Stage 1  Name match           — advertised name vs. per-family prefix tables.
                                Score: exact-known-name 0.9, known-prefix 0.7.
Stage 2  GATT topology probe  — enumerate declared services/characteristics;
                                require the family's full expected shape
                                (service AND write char AND notify char,
                                properties matching). Score +0.25 per match
                                element, capped.
Stage 3  Passive evidence     — family-specific, read-only: e.g. Triones
                                status query `ef 01 77` → expect 12-byte
                                `66 … 99` notification. A correct magic-framed
                                response is near-proof. Score → 1.0.
Stage 4  Threshold gate       — combined confidence ≥ 0.8 → enable driver.
                                0.5–0.8 → show "probable match, confirm with a
                                safe blink test". < 0.5 → refuse to write;
                                offer "expert mode" (explicit user override,
                                logged, off by default).
```

**The blink test** (Stage 3.5, user-triggered): the candidate driver sends
its family's *lowest-risk reversible command pair* (e.g. power off → on, or
set color to current shadow value) and asks "did your light blink?" A human
confirming physical effect on the intended device is the strongest
possible binding of *this GATT connection* ↔ *that physical lamp* — and
doubles as protection against controlling the *neighbor's* identically-named
strip (see threat model).

## Per-family identification table

| Family | Name evidence | GATT evidence | Active probe (read-only) |
|---|---|---|---|
| ELK-BLEDOM | prefixes: `ELK-BLE`, `ELK-BT`, `ELK-BULB`, `MELK`, `LEDBLE`, `LED-`, `XROCKER`, `JACKYLED`, `DMRRBA` | svc `fff0` + write `fff3` + notify `fff4` (or `ffe0`/`ffe1`/`ffe2` variant) | none reliable (write-only family) → blink test required below 0.8 |
| Triones | prefixes: `Triones`, `LEDBLE-` (collides with ELK — GATT disambiguates) | svc `ffd5` + write `ffd9`, notify svc/char `ffd0`/`ffd4` | status query `ef 01 77` → 12-byte `66…99` frame = confirmed |
| LEDnetWF | prefix: `LEDnetWF` | Zengge service set | advertising manufacturer-data carries state (parse before connect if available via chooser `adData`) |
| SP110E | prefixes: `SP110E` (also `SP105E`, `SP107E` → different protocols — do NOT cross-drive) | svc `ffe0` + char `ffe1` w/ notify+write (+ init char `ffe2`) | after init handshake: `GET_INFO` (`00 00 00 10`) → 12-byte state frame = confirmed |

Maintain this table in `knowledge-graph.yaml` (`identification.*` entities);
the registry reads its data from generated constants that must match.

## Rules distilled (drivers MUST follow)

1. Never write to a characteristic outside the driver's declared allowlist.
2. Never enable a driver below the confidence threshold without an explicit,
   per-session user override.
3. Name prefixes are case-sensitive as tabulated; renames defeat Stage 1 —
   that's fine, Stages 2–3 carry the decision.
4. When two families claim the same evidence (LEDBLE case), *both* run their
   Stage 2/3 probes; highest confirmed score wins; ties → ask the user via
   blink test.
5. Remember confirmed identifications per device (`device.id` from Web
   Bluetooth is a stable, origin-scoped identifier) so re-connection is
   instant and prompt-free.

## Sources

- Name tables: https://github.com/dave-code-ruiz/elkbledom (19+ model names)
- Triones probe: https://github.com/madhead/saberlight/blob/master/protocols/Triones/protocol.md
- LEDnetWF adv-data state: https://github.com/8none1/zengge_lednetwf
- SP110E: https://gist.github.com/mbullington/37957501a07ad065b67d4e8d39bfe012
- Chooser/permission model: https://developer.mozilla.org/en-US/docs/Web/API/Bluetooth/requestDevice
