# Security Policy

DiodeToyTuner writes to unauthenticated Bluetooth hardware from a web page,
so we take the surrounding controls seriously. The full threat model lives in
[`docs/research/05-security-threat-model.md`](docs/research/05-security-threat-model.md)
and is normative for code review.

## Ground rules baked into the app

- **No silent radio access** — every connection starts from the browser's
  user-gesture device chooser; the page can never scan or connect on its own.
- **Write allowlists** — GATT writes go only to characteristics explicitly
  declared by a positively identified driver, through one paced transport
  queue. No raw-byte escape hatches in mapping profiles.
- **Identification before actuation** — devices below the identification
  confidence threshold get no writes until the user confirms a physical
  blink test (protects against controlling look-alike devices, including
  other people's).
- **Flash-rate limiting by default** — photosensitivity protection at the
  transport layer; opting out is explicit and warned.
- **No cloud, no telemetry, no third-party scripts** — profiles and device
  bindings stay in local storage; strict CSP; near-zero runtime dependencies.

## Honest limitations

The supported device families implement **no pairing, bonding, or
authentication at all**. Anyone within radio range can control them with any
app. We cannot fix that in software and will not pretend to.

## Reporting a vulnerability

Open a GitHub security advisory on this repository (preferred), or a plain
issue if the problem is not sensitive. Please include reproduction steps and
affected device family if applicable. There is no bounty program; there is
prompt attention and credit.
