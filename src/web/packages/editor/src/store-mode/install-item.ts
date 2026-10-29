import { uiCopy } from "../ui-copy.js";
import type { StoreItem } from "./local-source.js";

/** Where an install is handed over. The host's own route, named once. */
const INSTALL_PATH = "/api/themes/install";

export type InstallOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/**
 * What both install controls need from the region that owns the press: the
 * action itself, which item is in flight, and the last refusal in the host's own
 * words. One shape rather than three props through the gallery, the cell and the
 * modal.
 */
export interface InstallControl {
  readonly onInstall: (item: StoreItem) => void;
  /** The items a press is in flight for, so each control disables itself on
   *  its own id and two items install without losing one another's busy state. */
  readonly installingIds: ReadonlySet<string>;
  /** The last refusal and the item it names; a refusal for another item is not
   *  drawn beside this one. */
  readonly refusal:
    | { readonly id: string; readonly message: string }
    | undefined;
}

/**
 * Posts one catalogue item to the host, which fetches and writes the package.
 * The browser posts four facts and reads no bytes: the
 * host owns the download, the validation and the folder, so a client that
 * downloaded here would be a second owner of the same install.
 *
 * Every refusal is the host's own words, for the reason `theme-import.ts`
 * carries out its refusals: the host knows which part of the install failed, and
 * a sentence composed here would hide it.
 */
export async function installItem(
  item: StoreItem,
  options?: { readonly fetch?: typeof fetch },
): Promise<InstallOutcome> {
  const catalogue = item.catalogue;
  const version = item.version;
  // An online item always carries both; a caller that hands a library item has
  // no package to name, and inventing one would post an install of nothing.
  if (catalogue === undefined || version === undefined || version === "") {
    return {
      ok: false,
      message: uiCopy.store.install.noCatalogueVersion,
    };
  }

  const fetcher = options?.fetch ?? globalThis.fetch.bind(globalThis);
  let response: Response;
  try {
    response = await fetcher(INSTALL_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        packageUrl: catalogue.packageUrl,
        catalogueId: catalogue.id,
        version,
        kind: item.kind,
      }),
    });
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (!response.ok) {
    const reason = await response.text().catch(() => "");
    return {
      ok: false,
      message:
        reason.trim() === ""
          ? uiCopy.store.install.refused(response.status)
          : reason,
    };
  }

  return { ok: true };
}
