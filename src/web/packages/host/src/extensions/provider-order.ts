import path from "node:path";
import type { InstalledPlugin } from "@yunari/extension-api";
import type { SensorProvider } from "../providers/provider.js";
import { createJsonFile } from "../settings/json-file.js";

/** Plugin provider precedence, stored beside the plugins it names. */

/** The one definition of "this plugin contributes sensor providers": a worker
 *  plugin that names at least one contribution. Order keys and the provider
 *  adapter both read it here rather than spelling it twice. */
export function isProviderPlugin(plugin: InstalledPlugin): boolean {
  return (
    plugin.manifest.execution === "trusted-worker" &&
    (plugin.manifest.contributes.sensorProviders?.length ?? 0) > 0
  );
}

export interface ProviderOrder {
  readonly version: 1;
  readonly pluginOrder: readonly string[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Refuse anything this store did not write; a hand-edited file reads empty. */
export function readProviderOrder(value: unknown): ProviderOrder {
  if (!isRecord(value) || value["version"] !== 1) {
    throw new Error("Provider order refused: it is not version 1.");
  }

  const pluginOrder = value["pluginOrder"];
  if (
    !Array.isArray(pluginOrder) ||
    pluginOrder.some((key) => typeof key !== "string")
  ) {
    throw new Error(
      "Provider order refused: pluginOrder is not a list of keys.",
    );
  }

  return { version: 1, pluginOrder: [...(pluginOrder as string[])] };
}

export function createProviderOrderStore(file: string): {
  read(): Promise<ProviderOrder>;
  write(order: ProviderOrder): Promise<void>;
} {
  const stored = createJsonFile<ProviderOrder>(
    path.dirname(file),
    path.basename(file),
    {
      normalize: readProviderOrder,
      empty: () => ({ version: 1, pluginOrder: [] }),
    },
  );

  return {
    read: () => stored.read(),
    write: (order) => stored.write(readProviderOrder(order)),
  };
}

/**
 * Built-ins keep their own precedence; plugin rows follow, ordered by the
 * stored plugin keys. A key the order does not name — or one no plugin
 * carries — sorts last in the order the installer listed it.
 */
export function orderProviders(
  builtins: readonly SensorProvider[],
  plugins: readonly SensorProvider[],
  order: ProviderOrder,
): readonly SensorProvider[] {
  const rankOf = new Map<string, number>();
  for (const [index, key] of order.pluginOrder.entries()) {
    if (!rankOf.has(key)) rankOf.set(key, index);
  }

  const ranked = plugins.map((provider, index) => ({
    provider,
    index,
    rank: rankOf.get(provider.pluginKey ?? ""),
  }));

  ranked.sort((left, right) => {
    if (left.rank !== undefined && right.rank !== undefined) {
      return left.rank - right.rank || left.index - right.index;
    }
    if (left.rank !== undefined) return -1;
    if (right.rank !== undefined) return 1;
    return left.index - right.index;
  });

  return [...builtins, ...ranked.map((entry) => entry.provider)];
}
