/**
 * Driver registry + the identification pipeline of
 * docs/research/04-device-identification.md.
 */
import { CONFIDENCE_WRITE_THRESHOLD, type Driver, type IdentityEvidence } from "./driver";
import { elkBledomDriver } from "./elk-bledom";
import { trionesDriver } from "./triones";

export const drivers: Driver[] = [elkBledomDriver, trionesDriver];

/** Stage 0: union of every driver's chooser filters + declared services.
 *  optionalServices must list everything any driver might touch — Web
 *  Bluetooth hides undeclared services forever after. */
export function chooserRequest(): RequestDeviceOptions {
  return {
    filters: drivers.flatMap((d) => d.chooserFilters),
    optionalServices: [...new Set(drivers.flatMap((d) => d.services))],
  };
}

export interface Identification {
  driver: Driver;
  confidence: number;
  /** true → transport may write; false → blink test required first. */
  writeUnlocked: boolean;
}

/** Stages 1–2: score every driver on the evidence; ties/overlaps resolved
 *  by score (rule 4 of doc 04: both LEDBLE claimants run, best wins). */
export function identifyAll(evidence: IdentityEvidence): Identification[] {
  return drivers
    .map((driver) => {
      const confidence = driver.identify(evidence);
      return {
        driver,
        confidence,
        writeUnlocked: confidence >= CONFIDENCE_WRITE_THRESHOLD,
      };
    })
    .filter((c) => c.confidence >= 0.5)
    .sort((a, b) => b.confidence - a.confidence);
}
