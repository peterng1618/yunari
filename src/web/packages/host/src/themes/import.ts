import type { FabricThemeEnvelope } from "@yunari/renderer-core";
import {
  readThemePackage,
  type ThemeCredits,
  themeIdFromName,
  themeVideoRefusals,
} from "@yunari/theme-package";
import {
  isValidThemeId,
  storeRefusalMessage,
  ThemeIdTakenError,
  type ThemeStore,
} from "./store.js";
import type { ThumbnailStore } from "./thumbnails.js";

/**
 * A package an author brought in lands in the library as a **host write**, so
 * the theme survives the editor closing. The reader is `@yunari/theme-package`'s
 * — the host owns the folder the bytes land in and §141 is its contract — so the
 * browser never parses a package and this is the only place one is read.
 *
 * **Import never overwrites.** A taken id gets a suffix, so re-importing your
 * own export makes a second entry rather than replacing the first: additive is
 * the safe direction, and the duplicate is visible and deletable where a silent
 * replace is data loss with no undo.
 */

/** How many suffixed candidates a name is worth before the library is judged to
 *  hold them all. Chosen, not measured: a library with a hundred themes of one
 *  name is a library somebody should look at. */
const MAX_SUFFIX = 100;
/** The base a package with no usable name lands under. An id space has to have
 *  *something* to mint from, and a package whose name is absent — or written in
 *  a script this shape has no letters for — is still a theme the author brought. */
const NAMELESS_BASE = "theme";

export type ThemeImportResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly message: string };

export interface ThemeImportOptions {
  readonly store: ThemeStore;
  /** The picture's owner. Omitted when the host stores none, which costs the
   *  package's picture and nothing else. */
  readonly thumbnails?: ThumbnailStore;
}

/**
 * Reads a package and writes it into the library, answering the id it landed
 * under or the refusal its owner gave.
 *
 * Every refusal is its owner's — the reader's for a package it will not read,
 * the store's for a write it would not take — because the reason is what the
 * author has to act on, and a sentence composed here would hide it. The one
 * translation is `storeRefusalMessage`: an `fs` failure's own text names a
 * path inside the profile, so it is logged and answered with the step.
 */
export async function importThemePackage(
  bytes: Uint8Array,
  options: ThemeImportOptions,
): Promise<ThemeImportResult> {
  const parsed = readThemePackage(bytes);
  if (!parsed.ok) return { ok: false, message: parsed.message };

  // Before the first write, so a refused video leaves the library exactly as it
  // was. The message is the envelope module's, matching installTheme.
  const videoRefusal = themeVideoRefusals(parsed.envelope, parsed.assets)[0];
  if (videoRefusal !== undefined) return { ok: false, message: videoRefusal };

  const landed = await writeUnderFreeId(
    parsed.envelope,
    parsed.assets,
    parsed.credits,
    options.store,
  );
  if (!landed.ok) return landed;

  const { thumbnail } = parsed;
  const thumbnails = options.thumbnails;
  if (thumbnail !== undefined && thumbnails !== undefined) {
    // After the theme, and never a refusal: the theme is what the author
    // brought, and a library with no picture falls back to text. The reader has
    // already dropped a picture the store would refuse, so this catches the
    // filesystem and nothing else.
    await thumbnails.write(landed.id, thumbnail).catch(() => undefined);
  }
  return landed;
}

/**
 * The ids an import will try, in this order: the package's own when the
 * library's shape admits it, otherwise the next free id derived from the
 * theme's name, otherwise a suffixed one.
 *
 * Each is a *candidate* only. Freeness is claimed by the write itself (R136),
 * never by a listing here: between a listing and a save there is a window in
 * which a theme the author already holds is replaced.
 *
 * **The shape arm is the rule's, not the reader's.** `readThemePackage` will
 * not hand over a document whose own id is out of shape — the envelope
 * validator refuses it — so the first arm is unreachable through a package
 * today. It is kept because the id rule is the host's: an import
 * that fell back to a name because the shape was *unusable* must not depend on
 * another package's validator to notice.
 */
export function importIdCandidates(
  envelope: FabricThemeEnvelope,
): readonly string[] {
  const base = themeIdFromName(envelope.metadata?.name ?? "") || NAMELESS_BASE;
  const suffixed = Array.from(
    { length: MAX_SUFFIX - 1 },
    (_unused, index) => `${base}-${index + 2}`,
  );
  // Deduplicated, because a name that slugs to the package's own id would
  // otherwise be tried twice — and the second attempt was always going to be
  // refused.
  return [
    ...new Set([
      ...(isValidThemeId(envelope.id) ? [envelope.id] : []),
      base,
      ...suffixed,
    ]),
  ];
}

/**
 * Writes the package under the first candidate the library will take, stamping
 * the id it landed under into the document: a stored theme's document says the
 * id it is stored as, so landing under a suffixed id makes the document that
 * id's.
 */
async function writeUnderFreeId(
  envelope: FabricThemeEnvelope,
  assets: Readonly<Record<string, Uint8Array>>,
  credits: ThemeCredits | undefined,
  store: ThemeStore,
): Promise<ThemeImportResult> {
  for (const id of importIdCandidates(envelope)) {
    try {
      await store.write(
        id,
        {
          envelope: { ...envelope, id },
          assets,
          ...(credits === undefined ? {} : { credits }),
        },
        { expectFree: true },
      );
      return { ok: true, id };
    } catch (error) {
      // A taken id is the one refusal that means "try the next one". Anything
      // else is the store's own answer to this document, and belongs to the
      // author rather than to the next candidate.
      if (!(error instanceof ThemeIdTakenError)) {
        return { ok: false, message: storeRefusalMessage(error) };
      }
    }
  }
  return {
    ok: false,
    message:
      "Every id this theme could land under is taken. Remove a theme, then import again.",
  };
}
