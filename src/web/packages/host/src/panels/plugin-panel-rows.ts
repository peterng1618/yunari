import type { PanelFamily } from "./panel-device.js";
import type { PanelFamilyRegistry } from "./panel-families.js";

/**
 * The plugin panel rows the live registry is built from.
 *
 * Rows carry the plugin key that owns them, so a revoked plugin's families can
 * be removed without rebuilding the registry: every surface reads the registry,
 * so a removed row disappears from all of them at once. This is the one owner
 * of that list; `main.ts` adds rows and revocation removes them here.
 */

export interface PluginPanelRow {
  readonly pluginKey: string;
  readonly family: PanelFamily;
}

export class PluginPanelRows {
  readonly #registry: PanelFamilyRegistry;
  #rows: readonly PluginPanelRow[] = [];

  constructor(registry: PanelFamilyRegistry) {
    this.#registry = registry;
  }

  rows(): readonly PluginPanelRow[] {
    return this.#rows;
  }

  add(row: PluginPanelRow): void {
    this.#rows = [...this.#rows, row];
    this.#sync();
  }

  /** Removes every row the plugin owns. Answers whether any row was removed. */
  remove(pluginKey: string): boolean {
    const remaining = this.#rows.filter((row) => row.pluginKey !== pluginKey);
    if (remaining.length === this.#rows.length) return false;

    this.#rows = remaining;
    this.#sync();
    return true;
  }

  #sync(): void {
    this.#registry.setPlugins(this.#rows.map((row) => row.family));
  }
}
