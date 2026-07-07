/**
 * Core capability model.
 *
 * Everything tunable is a float in [0,1] (knowledge graph:
 * decision.unit_interval_model). Drivers quantize to real hardware
 * resolution and report the true step count so the UI never fakes
 * precision.
 */

export type ChannelKind =
  | "r" | "g" | "b" | "w" | "cw" | "ww"
  | "hue" | "sat" | "val"
  | "power" | "pixel";

export interface Channel {
  /** Stable id, unique within the device, e.g. "r", "brightness". */
  id: string;
  label: string;
  kind: ChannelKind;
  /**
   * True number of distinct hardware states, e.g. 256 for 8-bit RGB,
   * 101 for ELK-BLEDOM brightness (0–100), 2 for power.
   */
  steps: number;
  /**
   * Channels sharing a group id are mutually exclusive at the firmware
   * level (e.g. Triones RGB xor White). The UI enforces one active group.
   */
  exclusiveGroup?: string;
  /** Approximate dominant wavelength, when meaningful (the "wavelength room"). */
  wavelengthNm?: number;
}

export interface DeviceCapability {
  /** Knowledge-graph family id, e.g. "family.elk_bledom". */
  family: string;
  label: string;
  channels: Channel[];
  notes?: string[];
}

/** Shadow state: channel id → unit-interval value. Most families are
 *  write-only (decision.write_only_shadow_state), so this is the truth
 *  the UI displays. */
export type ChannelState = Record<string, number>;
