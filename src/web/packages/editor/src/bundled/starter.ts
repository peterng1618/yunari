import type { FabricThemeEnvelope } from "@yunari/renderer-core";
import { readThemePackage } from "@yunari/theme-package";
import starterUrl from "./starter.theme.zip?url";

/**
 * The starter template as the product ships it: one package, committed beside
 * this module.
 *
 * The composition is authored data now, not a builder. A zip is the same
 * container a saved theme uses, so what the editor opens from `New from
 * template` is byte-for-byte the format a saved theme round-trips through, and
 * there is no second composition to keep in step with it.
 */

interface LoadedStarter {
  readonly envelope: FabricThemeEnvelope;
  readonly assets: Readonly<Record<string, Uint8Array>>;
}

let loaded: LoadedStarter | undefined;

/**
 * Reads and holds the committed package. Call once before any document is
 * created; the two getters below are synchronous and refuse until it has run.
 *
 * A refused package throws rather than falling back to a blank document: an
 * empty template that opens silently over a broken bundle is exactly the
 * fabricated content the product forbids.
 */
export async function loadBundledStarter(
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher(starterUrl);
  if (!response.ok) {
    throw new Error(
      `The starter template could not be read (${response.status} ${starterUrl}).`,
    );
  }
  const result = readThemePackage(new Uint8Array(await response.arrayBuffer()));
  if (!result.ok) {
    throw new Error(
      `The bundled starter template is not readable: ${result.message}.`,
    );
  }
  loaded = { envelope: result.envelope, assets: result.assets };
}

/** A deep copy, so opening the template never shares authored state with the
 *  copy a later mount mutates. */
export function bundledStarterEnvelope(): FabricThemeEnvelope {
  if (loaded === undefined) throw notLoaded();
  return structuredClone(loaded.envelope);
}

/** A copy of the declared bytes, keyed by their package paths. */
export function bundledStarterAssets(): Readonly<Record<string, Uint8Array>> {
  if (loaded === undefined) throw notLoaded();
  return Object.fromEntries(
    Object.entries(loaded.assets).map(([path, bytes]) => [path, bytes.slice()]),
  );
}

function notLoaded(): Error {
  return new Error(
    "The bundled starter template has not been loaded; call loadBundledStarter() first.",
  );
}
