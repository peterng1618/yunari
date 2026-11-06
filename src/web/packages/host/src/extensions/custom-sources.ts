import { type CustomSource, readCustomSource } from "../settings/sources.js";
import type { ExtensionService } from "./service.js";

/**
 * The trust boundary for a plugin's declarative custom sources.
 *
 * A plugin row is accepted only when the extension may load and the row needs
 * no host credential. There is no plugin secret namespace in this phase, so an
 * `auth` block would name an entry in the user's shared credential store and
 * hand the plugin a secret it does not own. `sources.json` rows keep full
 * credential support.
 */
export async function pluginSourceRows(
  extensions: Pick<ExtensionService, "list" | "mayLoad">,
): Promise<readonly CustomSource[]> {
  const rows: CustomSource[] = [];

  for (const extension of await extensions.list()) {
    if (extension.consent === "missing") continue;
    if (!(await extensions.mayLoad(extension.key))) continue;

    for (const raw of extension.contributions.customSources ?? []) {
      const read = readCustomSource(raw);
      // A malformed row costs its own row, never the host.
      if (!read.ok) continue;
      const auth = read.source.auth;
      if (auth !== undefined && auth.kind !== "none") continue;
      rows.push(read.source);
    }
  }

  return rows;
}
