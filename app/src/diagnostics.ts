/**
 * Diagnose mode: connect (read-only!) to ANY BLE device the user picks and
 * report its identity evidence — advertised name, GATT services and
 * characteristics with properties, Device Information strings, and how
 * every registered driver scores it. Exists because unknown sunset-lamp
 * variants fail silently (invisible in the filtered chooser); see
 * docs/research/07-sunset-lamp-survey.md.
 *
 * NO WRITES happen here, ever. Threat-model rule 1 stays intact: this file
 * never touches a writable characteristic's write methods.
 */
import { drivers, identifyAll } from "./drivers/registry";

function u16(id: number): string {
  return `0000${id.toString(16).padStart(4, "0")}-0000-1000-8000-00805f9b34fb`;
}

/** Known + candidate LED-controller services, from the research corpus.
 *  With acceptAllDevices, only services listed here are enumerable after
 *  connect — keep in sync with docs/research/07 and the knowledge graph. */
const CANDIDATE_SERVICES: string[] = [
  ...new Set([
    ...drivers.flatMap((d) => d.services),
    u16(0xfff0), // ELK-BLEDOM
    u16(0xffe0), // ELK variant / SP110E / HM-10 class
    u16(0xffd0), // Triones notify
    u16(0xffd5), // Triones write
    u16(0xffe5), // older Zengge/Magic Blue bulbs (write ffe9)
    u16(0xff00), // assorted cheap controllers
    u16(0xee00), // BJ_LED-class (MohuanLED) candidate
    u16(0xafd0), // SPxxx-class candidate
    u16(0x180a), // Device Information (read manufacturer/model strings)
    "6e400001-b5a3-f393-e0a9-e50e24dcca9e", // Nordic UART, used by some controllers
  ]),
];

const DIS_STRINGS: Record<string, string> = {
  [u16(0x2a29)]: "manufacturer",
  [u16(0x2a24)]: "model",
  [u16(0x2a26)]: "firmware",
  [u16(0x2a27)]: "hardware",
};

const PROP_KEYS = [
  "read",
  "write",
  "writeWithoutResponse",
  "notify",
  "indicate",
] as const;

export async function runDiagnosis(): Promise<string> {
  const lines: string[] = ["=== DiodeToyTuner device diagnosis ==="];
  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: CANDIDATE_SERVICES,
  });
  lines.push(`advertised name : ${device.name ?? "(none)"}`);

  const gatt = device.gatt;
  if (!gatt) {
    lines.push("no GATT server exposed — cannot inspect further");
    return lines.join("\n");
  }

  try {
    const server = await gatt.connect();
    let services: BluetoothRemoteGATTService[] = [];
    try {
      services = await server.getPrimaryServices();
    } catch {
      lines.push("no enumerable services (none match the candidate list)");
    }

    const serviceUuids: string[] = [];
    for (const svc of services) {
      serviceUuids.push(svc.uuid);
      lines.push(`service ${svc.uuid}`);
      try {
        for (const chr of await svc.getCharacteristics()) {
          const props = PROP_KEYS.filter((k) => chr.properties[k]).join(",");
          lines.push(`  characteristic ${chr.uuid} [${props}]`);
          const label = DIS_STRINGS[chr.uuid];
          if (label && chr.properties.read) {
            try {
              const v = await chr.readValue();
              lines.push(`    ${label}: ${new TextDecoder().decode(v).replace(/\0+$/, "")}`);
            } catch {
              /* unreadable in practice — fine */
            }
          }
        }
      } catch {
        lines.push("  (characteristics not enumerable)");
      }
    }

    const scored = identifyAll({ name: device.name ?? "", serviceUuids });
    lines.push(
      scored.length
        ? `driver candidates: ${scored
            .map((s) => `${s.driver.family} (confidence ${s.confidence.toFixed(2)})`)
            .join("; ")}`
        : "driver candidates: NONE — unknown family; paste this report into a GitHub issue",
    );
  } finally {
    gatt.disconnect();
  }
  return lines.join("\n");
}
