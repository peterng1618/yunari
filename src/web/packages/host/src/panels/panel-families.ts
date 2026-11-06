import { KRAKEN_FAMILIES } from "./kraken-z3-panel.js";
import type {
  PanelControlCommand,
  PanelFamily,
  PanelGeometry,
  PanelHint,
  PanelSupport,
} from "./panel-device.js";
import { TUR_FAMILIES } from "./tur-usb-panel.js";
import { TURZX_FAMILIES } from "./turzx-panel.js";

/**
 * Every panel family this host ships, in one table.
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
export const BUILTIN_PANEL_FAMILIES: readonly PanelFamily[] = [
  ...TUR_FAMILIES,
  ...KRAKEN_FAMILIES,
  ...TURZX_FAMILIES,
];

/**
 * What a family declares about itself, without the device it opens.
 *
 * The manifest a plugin row is built from carries these fields and nothing
 * else: `open` and `attached` are the host's to supply, and a plugin states
 * only what it claims.
 */
export interface PanelFamilyContribution {
  readonly id: string;
  readonly label: string;
  readonly vendorId: number;
  readonly productId: number;
  readonly geometry: PanelGeometry;
  readonly support: PanelSupport;
  readonly commands: readonly PanelControlCommand["kind"][];
  readonly renderModes?: readonly string[];
}

/**
 * The families this host can drive, built-in rows first.
 *
 * `forDevice` is the only lookup: a second path to the same answer is how two
 * surfaces come to disagree about which driver owns a pair of USB ids.
 */
export class PanelFamilyRegistry {
  readonly #families: readonly PanelFamily[];

  constructor(families: readonly PanelFamily[]) {
    this.#families = families;
  }

  all(): readonly PanelFamily[] {
    return this.#families;
  }

  /** The family claiming a pair of USB ids, if any. */
  forDevice(vendorId: number, productId: number): PanelFamily | undefined {
    return this.#families.find(
      (family) =>
        family.vendorId === vendorId && family.productId === productId,
    );
  }

  /**
   * Every panel attached right now, from every family.
   *
   * De-duplicated by hardware, because a family's `attached` may enumerate more
   * than its own row (the TUR driver lists its whole table): the record's
   * identity is the device, and one device offered twice is two rows a person
   * cannot tell apart.
   *
   * **A family whose `attached` throws is skipped.** A plugin worker that died
   * must not remove the built-in rows' hints from the answer.
   */
  async attached(): Promise<readonly PanelHint[]> {
    const seen = new Set<string>();
    const hints: PanelHint[] = [];

    for (const family of this.#families) {
      let found: readonly PanelHint[];

      try {
        found = await family.attached();
      } catch {
        continue;
      }

      for (const hint of found) {
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

  /**
   * A registry with `plugins` appended after this registry's rows.
   *
   * A plugin row whose vendor/product pair already exists is dropped: a
   * built-in driver keeps its hardware, and a later plugin row cannot displace
   * an earlier one that claimed the same pair.
   */
  withBuiltinsFirst(plugins: readonly PanelFamily[]): PanelFamilyRegistry {
    const seen = new Set(
      this.#families.map((family) => `${family.vendorId}:${family.productId}`),
    );
    const accepted: PanelFamily[] = [];

    for (const plugin of plugins) {
      const key = `${plugin.vendorId}:${plugin.productId}`;
      if (seen.has(key)) continue;

      seen.add(key);
      accepted.push(plugin);
    }

    return new PanelFamilyRegistry([...this.#families, ...accepted]);
  }
}

/** The built-in rows, then every plugin row that does not shadow one. */
export function createPanelFamilyRegistry(
  plugins: readonly PanelFamily[] = [],
): PanelFamilyRegistry {
  return new PanelFamilyRegistry(BUILTIN_PANEL_FAMILIES).withBuiltinsFirst(
    plugins,
  );
}
