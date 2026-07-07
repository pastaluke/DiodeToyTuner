# Research Index

> **For agents and contributors:** this directory is the project's long-term
> memory. Every technical decision in the app should be traceable to a fact
> recorded here. When you learn something new about a device, protocol, or
> platform API, record it here **and** in `knowledge-graph.yaml` before (or
> alongside) writing code that depends on it.

Research was gathered 2026-07 from the public reverse-engineering community
(primarily Home Assistant custom integrations and standalone GitHub protocol
docs). Primary sources are cited inline in each document.

## Documents

| Doc | Contents | Read when… |
|---|---|---|
| [01-ecosystem-survey.md](01-ecosystem-survey.md) | Prior art: WLED, OpenRGB, LedFx, flux_led, Home Assistant BLE integrations, HID Remapper. What each does well, what we borrow. | deciding scope, avoiding reinvention |
| [02-protocol-compendium.md](02-protocol-compendium.md) | Byte-level protocols per device family: GATT UUIDs, command formats, checksums, quirks. | writing or fixing a driver |
| [03-web-platform-capabilities.md](03-web-platform-capabilities.md) | Web Bluetooth, Gamepad API, WebHID, Web Serial: what they allow, browser support, security model, hard limits. | touching transport or input code |
| [04-device-identification.md](04-device-identification.md) | How to reliably identify which device family a BLE advertisement belongs to; name prefixes, service UUIDs, confidence scoring. | touching discovery/matching code |
| [05-security-threat-model.md](05-security-threat-model.md) | Threats, mitigations, and the rules drivers must obey (allowlists, rate limits, no-unknown-writes). | reviewing any PR that writes to hardware |
| [06-hardware-targets.md](06-hardware-targets.md) | Cheap boards users can buy/solder today; DIY and custom-PCB path. | planning hardware/ directory work |
| [knowledge-graph.yaml](knowledge-graph.yaml) | **Machine-readable** entities + relations distilled from all of the above. | you are an agent deciding implementation details |

## How to use the knowledge graph

`knowledge-graph.yaml` contains three top-level keys:

- `entities:` — devices, protocols, GATT endpoints, apps, platform APIs,
  hardware, each with a stable `id` (e.g. `protocol.elk_bledom`) and typed
  fields. Facts carry `source:` URLs and a `confidence:` level
  (`verified-by-us` | `community-verified` | `reported`).
- `relations:` — `[subject, predicate, object]` triples, e.g.
  `[family.elk_bledom, controlled_by_app, app.lotus_lantern]`.
- `decisions:` — architecture decisions with the entity IDs that justify them.

Rules:

1. **Never contradict the graph silently.** If code needs to deviate from a
   recorded fact, the fact was wrong — fix the graph in the same commit and
   downgrade/annotate its `confidence`.
2. **New device support starts in the graph.** Add the family, protocol, and
   identification entities first; the driver implements what the graph says.
3. Keep `id`s stable; they are referenced from code comments and docs.
