import { KRAKEN_FAMILIES } from "./kraken-z3-panel.js";
import type { PanelFamily, PanelHint } from "./panel-device.js";
import { TUR_FAMILIES } from "./tur-usb-panel.js";

/**
 * Every panel family this host can drive, in one table.
 *
 * **This file is the seam the port was for.** `panel-manager` used to import the
 * TUR driver directly, so its own claim that "a second panel family is a row in
 * `PANEL_MODELS`" was false the moment a family spoke a different protocol —
 * which the Kraken does, on two interfaces, with a storage write instead of a
 * frame push. Adding it is what proved the boundary: what the manager needs is
 * *which model a device is* and *how to open one*, and that pair is what a row
 * here supplies.
 *
 * Each driver module owns its own rows and exports them; this file only gathers
 * them, so a new family is a new driver and one spread, not an edit here.
 */

export const PANEL_FAMILIES: readonly PanelFamily[] = [
  ...TUR_FAMILIES,
  ...KRAKEN_FAMILIES,
];

/** The family claiming a pair of USB ids, if any. */
export function familyFor(
  vendorId: number,
  productId: number,
): PanelFamily | undefined {
  return PANEL_FAMILIES.find(
    (family) => family.vendorId === vendorId && family.productId === productId,
  );
}

/**
 * Every panel attached right now, from every family.
 *
 * De-duplicated by hardware, because a family's `attached` may enumerate more
 * than its own row (the TUR driver lists its whole table): the record's identity
 * is the device, and one device offered twice is two rows a person cannot tell
 * apart.
 */
export async function attachedDevices(): Promise<readonly PanelHint[]> {
  const seen = new Set<string>();
  const hints: PanelHint[] = [];

  for (const family of PANEL_FAMILIES) {
    for (const hint of await family.attached()) {
      if (hint.vendorId !== family.vendorId) continue;
      if (hint.productId !== family.productId) continue;

      const key = `${hint.vendorId}:${hint.productId}:${hint.serial}`;
      if (seen.has(key)) continue;

      seen.add(key);
      hints.push(hint);
    }
  }

  return hints;
}
