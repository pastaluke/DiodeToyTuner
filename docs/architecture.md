# Architecture

Research-backed design; every decision here cites an entity in
[`research/knowledge-graph.yaml`](research/knowledge-graph.yaml).

## Layer diagram

```
┌────────────────────────────────────────────────────────────┐
│ UI  (app/src/ui)                                           │
│  channel strips · fine-step controls · mapping editor      │
├────────────────────────────────────────────────────────────┤
│ Mapping engine  (app/src/input/mapping.ts)                 │
│  InputSource events ──▶ Binding(transform) ──▶ Parameter   │
├───────────────┬────────────────────────────────────────────┤
│ Input sources │ Device layer                               │
│ (app/src/input)│ (app/src/core, app/src/drivers)           │
│  gamepad.ts   │  DeviceCapability · Channel · Parameter    │
│  hid.ts       │  Driver registry + identification pipeline │
├───────────────┴────────────────────────────────────────────┤
│ Transport  (app/src/transport/ble.ts)                      │
│  Web Bluetooth wrapper · allowlist enforcement ·           │
│  paced write queue · slew limiter                          │
└────────────────────────────────────────────────────────────┘
```

## Core model (`app/src/core/types.ts`)

- **Parameter** — one tunable knob. Value is always a float in `[0,1]`
  (`decision.unit_interval_model`). Carries `steps` (real hardware
  resolution, e.g. 256 for 8-bit RGB, 101 for ELK brightness) so the UI can
  display true quantization and offer exact-step nudging.
- **Channel** — a diode or diode group: `{id, label, kind: r|g|b|w|cw|ww|pixel,
  wavelengthNm?, parameter}`.
- **DeviceCapability** — what a connected device honestly exposes: channels,
  exclusivity constraints (Triones RGB-xor-W), config tier (dangerous
  setters, off by default per threat model M5a).

## Drivers (`app/src/drivers/`)

A driver is mostly **data plus pure functions**:

```ts
interface Driver {
  family: string;                    // matches knowledge-graph family.* id
  chooserFilters: BluetoothLEScanFilter[];   // stage 0
  services: string[];                // full allowlist, declared up front
  identify(evidence): number;        // stages 1–3 → confidence 0..1
  describe(): DeviceCapability;
  postConnect?(io): Promise<void>;   // decision.driver_post_connect_hook
  encode(channelValues): Uint8Array[]; // pure: values → frames
}
```

Rules (from the threat model): drivers never hold a writable characteristic;
they return frames, the transport writes them. Confidence < 0.8 → transport
refuses writes until the blink test passes (`decision.allowlist_writes`).

### Adding a driver — checklist
1. Add/verify `family.*`, `protocol.*`, `identification.*` entities in the
   knowledge graph (+ compendium doc). Cite sources.
2. Implement the interface; `encode()` must be a pure function with unit
   tests against known-good byte strings from the compendium.
3. Register in `drivers/registry.ts`.
4. Update the identification table in research doc 04 if evidence changed.

## Transport (`app/src/transport/ble.ts`)

- Owns the single writable characteristic handle per connection.
- **Paced queue:** coalesces rapid parameter changes (keep-latest per
  channel-set), writes without response at a fixed minimum interval
  (default 20 ms) — cheap controllers drop frames otherwise
  (`platform.web_bluetooth` notes).
- **Slew/flash limiter:** clamps full-range luminance transition rate
  (threat model M6a). Opt-out is explicit and warned.

## Input & mapping (`app/src/input/`)

- **InputSource** normalizes everything to `{sourceId, controlId, value}`
  where value ∈ [0,1] (buttons) or [-1,1] (axes/relative deltas).
  - `gamepad.ts`: polls Gamepad API standard mapping; chord detection for
    "Start+Select+D-pad" selection schemes.
  - `hid.ts`: WebHID report parsing for encoders/knobs (relative deltas).
- **Binding** = `{source control, target parameter(s), transform}` where
  transform = deadzone → curve (linear/gamma/log) → gain → mode
  (absolute | relative | step-quantized).
- **Profiles** are pure-data JSON, schema-validated (threat model M4a);
  they reference parameters by id, never raw bytes.

## What is deliberately NOT here

- Effect/animation engine (`decision.effects_out_of_scope`).
- Cloud anything (threat model M7).
- Wi-Fi device support in-browser — goes through the future local bridge
  (`transport.bridge`).
