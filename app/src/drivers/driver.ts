import type { ChannelState, DeviceCapability } from "../core/types";

/** Evidence collected during/after connection, fed to Driver.identify(). */
export interface IdentityEvidence {
  /** Advertised / GATT device name ("" if withheld). */
  name: string;
  /** Discovered primary service UUIDs (long form, lowercase). */
  serviceUuids: string[];
}

/** Minimal write/notify surface handed to postConnect probes.
 *  Drivers never keep this — frames for normal control flow come from
 *  encode() and are written by the paced transport (threat model rule 1). */
export interface ProbeIO {
  write(bytes: Uint8Array): Promise<void>;
  /** Resolves with the next notification, or null on timeout. */
  nextNotification(timeoutMs: number): Promise<Uint8Array | null>;
}

/**
 * A driver is data + pure functions. See docs/architecture.md and
 * docs/research/04-device-identification.md for the pipeline stages.
 */
export interface Driver {
  /** Knowledge-graph id, e.g. "family.elk_bledom". */
  family: string;
  label: string;

  /** Stage 0: what the browser chooser should show. */
  chooserFilters: BluetoothLEScanFilter[];
  /** Full allowlist of services this driver may touch (declared up front —
   *  Web Bluetooth makes undeclared services invisible, which enforces it). */
  services: string[];
  /** Characteristic used for command writes, per discovered service. */
  writeChar: Record<string, string>;
  /** Optional notify characteristic per service. */
  notifyChar?: Record<string, string>;

  /** Stages 1–2 (+3 where possible): evidence → confidence in [0,1]. */
  identify(evidence: IdentityEvidence): number;

  /** Optional active read-only probe (stage 3), e.g. Triones status query.
   *  Returns a confidence override in [0,1] or null if inconclusive. */
  probe?(io: ProbeIO): Promise<number | null>;

  /** Init writes some hardware demands right after connect
   *  (decision.driver_post_connect_hook). */
  postConnect?(io: ProbeIO): Promise<void>;

  describe(): DeviceCapability;

  /** Pure: full shadow state → protocol frames, in write order. */
  encode(state: ChannelState): Uint8Array[];

  /** A reversible, lowest-risk frame pair for the blink test:
   *  [disturb, restore]. */
  blinkTest(state: ChannelState): [Uint8Array[], Uint8Array[]];
}

export function hex(...bytes: number[]): Uint8Array {
  return Uint8Array.from(bytes);
}

/** Confidence gate below which the transport refuses writes until the user
 *  passes a blink test (docs/research/04, stage 4). */
export const CONFIDENCE_WRITE_THRESHOLD = 0.8;
