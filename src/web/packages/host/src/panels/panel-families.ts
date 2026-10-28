import { attachedKrakens, openKraken } from "./kraken-z3-panel.js";
import type { PanelDevice, PanelHint } from "./panel-device.js";
import { attachedPanels, openPanel, panelModelFor } from "./tur-usb-panel.js";

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
 * A row is deliberately not a class hierarchy. The two families share no
 * packet, no endpoint and no notion of a frame; the only thing they share is
 * what `PanelDevice` says, so a row is a lookup and a constructor.
 */

export interface PanelFamily {
  /** The model id a display record carries, e.g. `lianli-9-2`. */
  readonly id: string;
  readonly label: string;
  readonly vendorId: number;
  readonly productId: number;
  /** True when `present` writes to the device rather than streaming a frame. */
  readonly stores: boolean;
  /** Panels of this family attached right now, as record hints. */
  readonly attached: () => Promise<readonly PanelHint[]>;
  readonly open: () => Promise<PanelDevice>;
}

/** The Lian Li screens: one bulk endpoint, one JPEG per frame. */
const TUR_FAMILY: readonly PanelFamily[] = [
  {
    id: "lianli-9-2",
    label: 'Lian Li 9.2" LCD',
    vendorId: 0x1cbe,
    productId: 0xa092,
    stores: false,
    attached: () => attachedPanels(),
    open: () => {
      const model = panelModelFor(0x1cbe, 0xa092);
      if (model === undefined) throw new Error('The 9.2" model is not listed.');
      return openPanel(model);
    },
  },
  {
    id: "lianli-8-8",
    label: 'Lian Li Universal Screen 8.8"',
    vendorId: 0x1cbe,
    productId: 0xa088,
    stores: false,
    attached: () => attachedPanels(),
    open: () => {
      const model = panelModelFor(0x1cbe, 0xa088);
      if (model === undefined) throw new Error('The 8.8" model is not listed.');
      return openPanel(model);
    },
  },
];

/** The Kraken Z: HID control, bulk data, and content that outlives the host. */
const KRAKEN_FAMILY: readonly PanelFamily[] = [
  {
    id: "kraken-z3",
    label: "NZXT Kraken Z (Z53/Z63/Z73)",
    vendorId: 0x1e71,
    productId: 0x3008,
    stores: true,
    attached: () => Promise.resolve(attachedKrakens()),
    open: () => openKraken("The NZXT Kraken"),
  },
];

export const PANEL_FAMILIES: readonly PanelFamily[] = [
  ...TUR_FAMILY,
  ...KRAKEN_FAMILY,
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
