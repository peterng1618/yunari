import { DASHBOARD_THEME_KIND } from "@yunari/renderer-core";
import { readThemePackage, themeVideoRefusals } from "@yunari/theme-package";
import type { ThemeOriginsStore } from "../settings/theme-origins.js";
import { downloadPackage } from "./download.js";
import { importThemePackage, type ThemeImportResult } from "./import.js";
import {
  type ThemeStore,
  ThemeTooLargeError,
  ThemeValidationError,
} from "./store.js";
import type { ThumbnailStore } from "./thumbnails.js";

/**
 * One catalogue item's Install action, end to end: fetch the package, write it
 * into the library, then record where this copy came from.
 *
 * The owners stay separate — `downloadPackage` holds the trust boundary for a
 * remote address, `importThemePackage` owns the id rule and the write, and
 * `ThemeOriginsStore` owns the provenance file. This module only orders them,
 * and its rule is that the origin is written **after** the theme landed: a
 * refused download or a refused theme write leaves `theme-origins.json`
 * untouched, and a refused origin write undoes a fresh import rather than
 * leaving a copy the catalogue cannot see.
 *
 * An item this machine already installed is an **update**: the bytes land on
 * that copy, in place, rather than beside it.
 */

export interface InstallRequest {
  readonly packageUrl: string;
  /** The catalogue's id for the item, never the library id. */
  readonly catalogueId: string;
  readonly version: string;
  readonly kind: string;
}

export interface InstallOptions {
  readonly store: ThemeStore;
  readonly origins: ThemeOriginsStore;
  /** The picture's owner; omitted costs the package's picture and nothing else. */
  readonly thumbnails?: ThumbnailStore;
  /** Injected so a test drives the download without a network. */
  readonly fetch?: typeof fetch;
}

/** `stage` is which owner refused, so a route can answer 502 for the remote end,
 *  500 for this host's own store, and 400 for an address, a package or a kind
 *  this build will not take. */
export type InstallResult =
  | { readonly ok: true; readonly id: string }
  | {
      readonly ok: false;
      readonly message: string;
      readonly stage: "address" | "download" | "package" | "store";
    };

/** The host failed to record where the copy came from. It has no copy table of
 *  its own to compose from, so the sentences live beside the other install
 *  refusals rather than in the editor's `ui-copy.ts`, which a host cannot read.
 *
 *  Three, not one, because the paths end differently: an update keeps the copy
 *  the person already had, and a fresh import is removed — unless the removal
 *  fails too, which leaves a theme the catalogue cannot see and a person who
 *  needs telling which one. */
export const INSTALL_REFUSALS = {
  updateKept:
    "This PC could not record where that theme came from; your copy is unchanged.",
  rolledBack:
    "This PC could not record where that theme came from, so it was not kept.",
  rolledBackFailed:
    "This PC could not record where that theme came from, and could not remove it; delete it from Your themes before installing again.",
} as const;

/**
 * The catalogue's `kind` names a shape this build runs; the library has no such
 * field. An item of another kind is refused by its identifier — a display word
 * is not what a catalogue author has to match against.
 */
export async function installCatalogueItem(
  request: InstallRequest,
  options: InstallOptions,
): Promise<InstallResult> {
  return exclusively(request.catalogueId, () => installOnce(request, options));
}

/**
 * Installs of one catalogue item run one at a time.
 *
 * Two overlapping installs resolve the same library id and both stage-and-rename
 * that folder; the loser's rename fails with the filesystem's own refusal
 * (EPERM on Windows) rather than interleaving safely. Distinct items keep
 * separate chains and still install in parallel.
 *
 * The queue holds the *settled* promise, so a refusal does not wedge the next
 * install, and it clears its own entry once it is the tail.
 */
const installing = new Map<string, Promise<unknown>>();

async function exclusively<T>(
  catalogueId: string,
  work: () => Promise<T>,
): Promise<T> {
  const previous = installing.get(catalogueId) ?? Promise.resolve();
  const next = previous.then(work, work);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  installing.set(catalogueId, settled);
  try {
    return await next;
  } finally {
    if (installing.get(catalogueId) === settled) {
      installing.delete(catalogueId);
    }
  }
}

async function installOnce(
  request: InstallRequest,
  options: InstallOptions,
): Promise<InstallResult> {
  if (request.kind !== DASHBOARD_THEME_KIND) {
    return {
      ok: false,
      stage: "package",
      message: `This build installs "${DASHBOARD_THEME_KIND}" items, not "${request.kind}".`,
    };
  }

  const downloaded = await downloadPackage(request.packageUrl, {
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  if (!downloaded.ok) {
    return {
      ok: false,
      stage: downloaded.stage,
      message: downloaded.message,
    };
  }

  // The envelope is checked before either write path runs, so a refused video
  // leaves the library and the origins file exactly as they were.
  const parsed = readThemePackage(downloaded.bytes);
  if (!parsed.ok) {
    return { ok: false, stage: "package", message: parsed.message };
  }
  const videoRefusal = themeVideoRefusals(parsed.envelope, parsed.assets)[0];
  if (videoRefusal !== undefined) {
    return { ok: false, stage: "package", message: videoRefusal };
  }

  const replaceId = await catalogueCopyId(request.catalogueId, options);
  const replacing = replaceId !== undefined;
  const imported = replacing
    ? await replaceCatalogueCopy(downloaded.bytes, replaceId, options)
    : await importThemePackage(downloaded.bytes, {
        store: options.store,
        ...(options.thumbnails === undefined
          ? {}
          : { thumbnails: options.thumbnails }),
      });
  if (!imported.ok) {
    return { ok: false, stage: "package", message: imported.message };
  }

  // After the write, never before: a theme whose origin a reinstall could not
  // find would be installed twice. A fresh copy is removed when the record
  // fails, so the next press replaces nothing and mints no `name-2`; an update
  // keeps the copy that was already the person's, and only its origin misses.
  try {
    await options.origins.write(imported.id, {
      catalogueId: request.catalogueId,
      version: request.version,
      installedAt: new Date().toISOString(),
    });
  } catch {
    if (replacing) {
      return {
        ok: false,
        stage: "store",
        message: INSTALL_REFUSALS.updateKept,
      };
    }
    const removed = await options.store.remove(imported.id).then(
      () => true,
      () => false,
    );
    return {
      ok: false,
      stage: "store",
      message: removed
        ? INSTALL_REFUSALS.rolledBack
        : INSTALL_REFUSALS.rolledBackFailed,
    };
  }
  await forgetOtherCopies(request.catalogueId, imported.id, options.origins);
  return { ok: true, id: imported.id };
}

/**
 * The library id this catalogue item already occupies, or nothing.
 *
 * The origins map says which item a library copy came from; the listing says
 * the copy is still there. An origin whose theme was deleted names an id with
 * nothing to replace, so trusting the map alone would mint a theme under a dead
 * key instead of updating one.
 *
 * The listing skips a folder whose `theme.json` will not read, so "not listed"
 * alone cannot mean "gone". A folder that is there but unreadable — `read`
 * answers the store's typed refusals where a missing theme answers `undefined`
 * — is a broken install of *this* item and is repaired in place rather than
 * duplicated beside it. No filesystem probe is needed: the store already tells
 * the two apart.
 */
async function catalogueCopyId(
  catalogueId: string,
  options: InstallOptions,
): Promise<string | undefined> {
  const origins = await options.origins.read();
  const ids = Object.entries(origins)
    .filter(([, origin]) => origin.catalogueId === catalogueId)
    .map(([id]) => id)
    .sort();
  if (ids.length === 0) return undefined;

  const listed = new Set((await options.store.list()).map((entry) => entry.id));
  const ordinary = ids.find((id) => listed.has(id));
  if (ordinary !== undefined) return ordinary;

  for (const id of ids) {
    if (await brokenCopyExists(options.store, id)) return id;
  }
  return undefined;
}

/**
 * Whether the library holds a theme under this id that the listing could not
 * show. `read` answers `undefined` for a missing theme and the store's typed
 * refusals for one it will not serve, which is why those two count and anything
 * else does not.
 */
async function brokenCopyExists(
  store: ThemeStore,
  id: string,
): Promise<boolean> {
  try {
    // Readable but unlisted: the listing raced this install, and the folder is
    // still the item's copy to replace. `undefined` is the absent theme.
    return (await store.read(id)) !== undefined;
  } catch (error) {
    return (
      error instanceof ThemeValidationError ||
      error instanceof ThemeTooLargeError
    );
  }
}

/**
 * The update path: the package lands on the copy the origin names, in place.
 *
 * Not `importThemePackage`, whose whole rule is that it never replaces — it
 * mints a free id. The document's id is stamped to the library id as the import
 * path stamps it, and the write is the store's `overwrite` rather than a base,
 * because the document being replaced is the catalogue's, not one this process
 * read.
 */
async function replaceCatalogueCopy(
  bytes: Uint8Array,
  id: string,
  options: InstallOptions,
): Promise<ThemeImportResult> {
  const parsed = readThemePackage(bytes);
  if (!parsed.ok) return { ok: false, message: parsed.message };

  try {
    await options.store.write(
      id,
      {
        envelope: { ...parsed.envelope, id },
        assets: parsed.assets,
        ...(parsed.credits === undefined ? {} : { credits: parsed.credits }),
      },
      { overwrite: true },
    );
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const { thumbnail } = parsed;
  if (thumbnail !== undefined && options.thumbnails !== undefined) {
    // After the theme and never a refusal, exactly as the import path does.
    await options.thumbnails.write(id, thumbnail).catch(() => undefined);
  }
  return { ok: true, id };
}

/**
 * Forgets origin entries that name this catalogue item under another library
 * id, once the copy this install landed on holds its own.
 *
 * Only one copy of an item should exist. A second key is a deleted theme's
 * origin, or one left by a broken copy just repaired, and two keys for one item
 * is the state in which a later update picks whichever id sorts first. Runs
 * after the landing copy's origin is written, so a refusal here leaves this
 * install's own provenance in place.
 */
async function forgetOtherCopies(
  catalogueId: string,
  id: string,
  origins: ThemeOriginsStore,
): Promise<void> {
  const all = await origins.read();
  await Promise.all(
    Object.entries(all)
      .filter(
        ([key, origin]) => key !== id && origin.catalogueId === catalogueId,
      )
      .map(([key]) => origins.removeTheme(key)),
  );
}

/**
 * The route's body as a request, or nothing when it is not the four strings the
 * install needs. Lives beside the request it builds so the wire shape has one
 * owner rather than a copy in the router.
 */
export function parseInstallRequest(
  value: unknown,
): InstallRequest | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const { packageUrl, catalogueId, version, kind } = value as Record<
    string,
    unknown
  >;

  if (
    typeof packageUrl !== "string" ||
    packageUrl === "" ||
    typeof catalogueId !== "string" ||
    catalogueId === "" ||
    typeof version !== "string" ||
    version === "" ||
    typeof kind !== "string" ||
    kind === ""
  ) {
    return undefined;
  }

  return { packageUrl, catalogueId, version, kind };
}
