# Contributing

Welcome — this project is designed to be forked and extended.

## Ground rules

1. **Research first.** Facts about devices/protocols/platform APIs live in
   `docs/research/` and `docs/research/knowledge-graph.yaml`. Code that
   depends on a fact not recorded there should add it (with sources) in the
   same PR. Agents: start at `docs/research/00-INDEX.md`.
2. **Security rules are normative.** `docs/research/05-security-threat-model.md`
   — especially: all GATT writes go through the transport, drivers declare
   allowlists as data, no new runtime dependencies without discussion, no
   remote scripts/telemetry ever.
3. **Honest precision.** Never present more resolution than the hardware has.
   If a device path has 101 steps, `steps: 101`, not 256.

## Adding a device driver

Follow the checklist in `docs/architecture.md` § "Adding a driver". In short:
knowledge graph entities → compendium entry → driver (data + pure `encode()`)
→ registry → identification table.

Good first drivers, in order of research-readiness:

- **Zengge LEDnetWF** (framing documented; HSV path; per-pixel "smear"
  command on addressable models — the current per-diode frontier)
- **MagicHome2 BLE** (distill from rabidpaperclip/magichome2-ble first)

## Dev setup

```bash
cd app && npm install && npm run dev   # Chromium browser, localhost
npm run build                          # type-check + bundle (CI gate)
```

Testing against real hardware? Note the exact device, advertised name, and
firmware quirks in your PR — and upgrade the relevant knowledge-graph
`confidence:` fields to `verified-by-us`.
