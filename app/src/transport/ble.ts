/**
 * Web Bluetooth transport: the ONLY place GATT writes happen.
 * Enforces (threat model, docs/research/05):
 *  - allowlist: writes go to the driver's declared write characteristic only
 *  - pacing: keep-latest queue, min interval between frames (cheap
 *    controllers drop frames under pressure)
 *  - flash limiting: full-range luminance transitions are rate-capped by
 *    default (photosensitivity, M6a)
 *  - confidence gate: no writes until identification unlocks (M1/M5)
 */
import type { ChannelState } from "../core/types";
import type { Driver, ProbeIO } from "../drivers/driver";

const MIN_WRITE_INTERVAL_MS = 20;
const FLASH_WINDOW_MS = 1000;
const MAX_FLASHES_PER_WINDOW = 3; // conservative; cf. WCAG 3-flash threshold

export class BleDevice {
  private writeCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private notifyCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private pending: ChannelState | null = null;
  private lastSent: ChannelState = {};
  private flashTimes: number[] = [];
  private pumping = false;
  private lastWriteAt = 0;

  /** Gate flipped by the identification pipeline / blink test. */
  writeUnlocked = false;
  /** Explicit, warned opt-out of flash limiting ("strobe mode"). */
  strobeMode = false;

  constructor(
    readonly device: BluetoothDevice,
    readonly driver: Driver,
  ) {}

  async connect(): Promise<string[]> {
    const gatt = this.device.gatt;
    if (!gatt) throw new Error("Device has no GATT server");
    const server = await gatt.connect();
    const found: string[] = [];
    for (const svcUuid of this.driver.services) {
      try {
        const service = await server.getPrimaryService(svcUuid);
        found.push(svcUuid);
        const writeUuid = this.driver.writeChar[svcUuid];
        if (writeUuid && !this.writeCharacteristic) {
          this.writeCharacteristic = await service.getCharacteristic(writeUuid);
        }
        const notifyUuid = this.driver.notifyChar?.[svcUuid];
        if (notifyUuid && !this.notifyCharacteristic) {
          try {
            this.notifyCharacteristic = await service.getCharacteristic(notifyUuid);
            await this.notifyCharacteristic.startNotifications();
          } catch {
            this.notifyCharacteristic = null; // notify is optional
          }
        }
      } catch {
        // service absent on this unit — fine, variants differ
      }
    }
    if (!this.writeCharacteristic) {
      throw new Error(
        "None of the driver's declared services/characteristics were found — refusing to guess.",
      );
    }
    return found;
  }

  disconnect(): void {
    this.device.gatt?.disconnect();
  }

  /** IO surface for read-only probes and init sequences. Not paced —
   *  used only pre-unlock by driver.probe/postConnect. */
  probeIO(): ProbeIO {
    const notify = this.notifyCharacteristic;
    const write = this.writeCharacteristic!;
    return {
      write: async (bytes) => {
        await writeFrame(write, bytes);
      },
      nextNotification: (timeoutMs) =>
        new Promise((resolve) => {
          if (!notify) return resolve(null);
          const timer = setTimeout(() => {
            notify.removeEventListener("characteristicvaluechanged", handler);
            resolve(null);
          }, timeoutMs);
          const handler = (ev: Event) => {
            clearTimeout(timer);
            notify.removeEventListener("characteristicvaluechanged", handler);
            const dv = (ev.target as BluetoothRemoteGATTCharacteristic).value;
            resolve(dv ? new Uint8Array(dv.buffer) : null);
          };
          notify.addEventListener("characteristicvaluechanged", handler);
        }),
    };
  }

  /** Keep-latest: rapid slider/gamepad motion coalesces to the newest state. */
  setState(state: ChannelState): void {
    this.pending = { ...state };
    void this.pump();
  }

  /** Blink test (docs/research/04): disturb, wait, restore. Caller asks the
   *  human "did it blink?" and flips writeUnlocked on confirmation. */
  async runBlinkTest(state: ChannelState): Promise<void> {
    const [disturb, restore] = this.driver.blinkTest(state);
    const write = this.writeCharacteristic!;
    for (const f of disturb) await writeFrame(write, f);
    await sleep(600);
    for (const f of restore) await writeFrame(write, f);
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.pending) {
        if (!this.writeUnlocked) {
          this.pending = null;
          break; // confidence gate: silently drop until unlocked
        }
        const state = this.pending;
        this.pending = null;

        // Flash limiter: a "flash" is any channel jumping > 0.5 in one write.
        const isFlash = Object.entries(state).some(
          ([id, v]) => Math.abs(v - (this.lastSent[id] ?? 0)) > 0.5,
        );
        if (isFlash && !this.strobeMode) {
          const now = performance.now();
          this.flashTimes = this.flashTimes.filter((t) => now - t < FLASH_WINDOW_MS);
          if (this.flashTimes.length >= MAX_FLASHES_PER_WINDOW) {
            await sleep(FLASH_WINDOW_MS - (now - this.flashTimes[0]!));
          }
          this.flashTimes.push(performance.now());
        }

        const wait = MIN_WRITE_INTERVAL_MS - (performance.now() - this.lastWriteAt);
        if (wait > 0) await sleep(wait);

        for (const frame of this.driver.encode(state)) {
          await writeFrame(this.writeCharacteristic!, frame);
        }
        this.lastWriteAt = performance.now();
        this.lastSent = state;
      }
    } finally {
      this.pumping = false;
    }
  }
}

async function writeFrame(
  chr: BluetoothRemoteGATTCharacteristic,
  bytes: Uint8Array,
): Promise<void> {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  if (chr.properties.writeWithoutResponse) {
    await chr.writeValueWithoutResponse(buf);
  } else {
    await chr.writeValueWithResponse(buf);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}
