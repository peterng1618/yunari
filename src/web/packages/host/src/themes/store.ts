import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  type FabricThemeEnvelope,
  type FacetRecord,
  facetRecordOf,
  type PerformanceCost,
  performanceCostsOf,
  resolveStyleValue,
  type ThemeRemix,
  type ValidationIssue,
  validateFabricThemeEnvelope,
} from "@yunari/renderer-core";
import { cssArtboardPaint } from "@yunari/scene-fabric";
import { moveToTrash } from "./trash.js";

/**
 * A theme is a directory, read and written in place (ADR-0017). The archive
 * format is only what an author exports, so nothing on this working path
 * compresses and re-expands: `list()` reads one small JSON file per theme
 * instead of inflating a package, and a save writes the bytes the author typed.
 *
 *     <library>/<theme-id>/theme.json
 *     <library>/<theme-id>/assets/<declared path>
 */

interface ThemeStoreEntry {
  readonly id: string;
  readonly name: string;
  /** The envelope's author, when it declares one; the library shows it. */
  readonly author?: string;
  /** The document's own version, when it declares one. Read from the same
   *  envelope as `author` and for the same reason: the store's caption line
   *  prints `1.4.0 · 2026-10-14`, and a listing that had to open a theme to
   *  find its version would be the second pass over the library R114 refuses.
   *  A theme that declares none has no key at all, so nothing draws a
   *  separator with nothing after it. */
  readonly version?: string;
  /** The catalogue item this document was remixed from, when it declares one.
   *  Read from the same envelope as `author` and `version`, so the library can
   *  credit the parent without opening the theme; a document that declares no
   *  credit has no key at all. */
  readonly remixOf?: ThemeRemix;
  readonly updatedAt: string;
  /** What this theme will cost a display, read from the document this entry
   *  was already built from — the assignment surface says it before the press. */
  readonly costs: readonly PerformanceCost[];
  /** What this theme *is* — author, colour mode, sensors, shape — derived from
   *  the same envelope, so a reader filtering the library never opens a theme
   *  to ask. Required, because every entry here was built from a document. */
  readonly facets: FacetRecord;
  /** The artboard's paint as CSS, for a gallery cell with no picture to show.
   *  Derived from the same envelope and for the same reason as `facets`: the
   *  reader must not open a theme to find one paint string. Absent when there is
   *  no paint to read, media behind the board included. */
  readonly ground?: string;
}

interface ThemeStoreRecord extends ThemeStoreEntry {
  readonly ok: true;
  /** The stored document's identity, which a save made from this read is
   *  based on. See {@link ThemeWriteOptions.base}. */
  readonly base: string;
  readonly envelope: FabricThemeEnvelope;
  readonly assets: Readonly<Record<string, Uint8Array>>;
}

/** What a theme folder holds: the document, and the bytes it declares. */
export interface ThemeContent {
  readonly envelope: FabricThemeEnvelope;
  readonly assets: Readonly<Record<string, Uint8Array>>;
}

/**
 * What a save says about the document it was built from.
 *
 * `base` is the whole concurrency guard, and it is the *document's* content
 * rather than the folder's mtime: an mtime moves when anything touches the
 * folder — the staged rename this store itself performs included — so it
 * reports a change that did not happen and misses one that did. A hash of the
 * bytes answers the only question that matters, which is whether the document
 * the author is editing is still the document that is stored.
 *
 * Absent means the client is not claiming a base, and the save is applied as it
 * always was. That is what a first save is — there is nothing stored to be
 * behind — and what a script or an older client sends.
 *
 * A base that matched also lets the save leave an asset out: the host holds
 * those exact bytes in the folder it is about to replace, and copying them is
 * cheaper than receiving them again. Nothing about that is a second claim to
 * trust — it is the same claim, already settled by the comparison above, and
 * the host re-checks the file itself before it copies.
 */
interface ThemeWriteOptions {
  readonly base?: string;
  /** Apply the save whatever is stored. The one way past the guard, and only
   *  an author who was told their save was refused should reach for it. */
  readonly overwrite?: boolean;
  /** The caller claims the id is unused, and the store refuses if it is not.
   *  A listing followed by a save leaves a window in which a theme is replaced;
   *  this closes it by making the claim and the write one step. Not expressed
   *  through `overwrite`, which is the opposite claim. */
  readonly expectFree?: boolean;
}

/** A save's outcome: the listing line, and the base the next save is made on. */
interface ThemeStoreSave extends ThemeStoreEntry {
  readonly base: string;
}

/**
 * A save was refused because the stored theme moved on after the document the
 * save was built from. The previous version is untouched, and the author's
 * document is still theirs to keep, reload past, or replace deliberately.
 */
export class ThemeConflictError extends Error {
  constructor(id: string) {
    super(
      `"${id}" was changed by someone else after this document was opened. ` +
        "Reload it to take the newer version, or save again to replace it.",
    );
    this.name = "ThemeConflictError";
  }
}

/**
 * A save that claimed a free id was refused because the library already holds
 * something under it. Nothing was written and what is there is untouched — the
 * caller's next move is to land somewhere else, which is why this is its own
 * error rather than the conflict above: a conflict is a document to reload,
 * this is an id to re-mint.
 */
export class ThemeIdTakenError extends Error {
  constructor(id: string) {
    super(`"${id}" is already in the library.`);
    this.name = "ThemeIdTakenError";
  }
}

/**
 * A save was refused because the theme's assets do not fit the bounds the
 * store's own reads enforce. Nothing was written and the previous version is
 * untouched, so the author's document is still theirs to shrink and send
 * again — which is the whole difference between this and a save that reports
 * success and cannot be opened afterwards.
 */
export class ThemeAssetLimitError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ThemeAssetLimitError";
  }
}

/**
 * A stored theme whose `theme.json` is present and does not validate — a stale
 * locale key, a stray `media.rotation`. The read-side sibling of the two
 * refusals above: the file is there, the validator's own diagnosis already
 * exists, and answering the `undefined` an absent theme answers with is what
 * throws that diagnosis away one layer below the reader (vg-110, ADR-0043).
 *
 * `issues` is the validator's own list rather than one flattened sentence, so a
 * reader can point at the fault. `list()` still skips such a theme: an
 * unreadable document is not a library line, and that half is a different
 * decision.
 */
export class ThemeValidationError extends Error {
  readonly issues: readonly ValidationIssue[];
  constructor(id: string, issues: readonly ValidationIssue[]) {
    super(
      `"${id}" is stored but does not validate: ` +
        (issues[0]?.message ?? "no reason was reported."),
    );
    this.name = "ThemeValidationError";
    this.issues = issues;
  }
}

/**
 * A stored theme whose `theme.json` is past the size the store will read. Its
 * own member of the family above rather than a {@link ThemeValidationError}:
 * nothing about the document is invalid — the validator never runs, and the
 * bound is the store's own, not the schema's — so dressing it as one would
 * report a fault that does not exist. What it must not be either is the
 * `undefined` an absent theme answers with, which is what told a reader a theme
 * they can see on disk was not there (vg-409, decisions/0043).
 *
 * It carries no `issues`: there is no diagnosis to hand over, only the fact
 * that the document is too large to open. The bound is named because shrinking
 * below it is the one thing the author can do about it.
 */
export class ThemeTooLargeError extends Error {
  constructor(id: string) {
    super(
      `"${id}" is stored but larger than the ${size(MAX_THEME_FILE_BYTES)} ` +
        "the store will open.",
    );
    this.name = "ThemeTooLargeError";
  }
}

/**
 * How a removal reaches the platform's trash. The default is the real one;
 * a test substitutes a rename so the store's own decisions can be told apart
 * from the operating system's.
 */
interface ThemeStoreOptions {
  readonly trash?: (folder: string) => Promise<void>;
}

export interface ThemeStore {
  list(): Promise<readonly ThemeStoreEntry[]>;
  read(id: string): Promise<ThemeStoreRecord | undefined>;
  write(
    id: string,
    content: ThemeContent,
    options?: ThemeWriteOptions,
  ): Promise<ThemeStoreSave>;
  /** Moves the theme's folder to the trash. Nothing else is ever removed.
   *  Answers false, as {@link ThemeStore.read} answers undefined, when the
   *  library holds no theme under that id. */
  remove(id: string): Promise<boolean>;
}

const THEME_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;
const NONCE_REGEX = /^[0-9a-z]+$/;
const THEME_FILE = "theme.json";
const ASSETS_DIR = "assets";

/** Which half of the save a scratch folder is part of. */
type ScratchKind = "staging" | "retired";

/** Chosen import bounds, not measured disk limits. The asset caps leave room
 *  for the archive's envelope (95 MiB) so neither format accepts a theme the
 *  other would refuse. */
const MAX_THEME_FILE_BYTES = 32 * 1024 * 1024;
const MAX_ASSET_BYTES = 80 * 1024 * 1024;
const MAX_ASSET_COUNT = 128;
const MAX_TOTAL_ASSET_BYTES = 90 * 1024 * 1024;

/** Bytes as an author reads them, and the exact bytes behind them. The
 *  platform does both, so there is no size table here to drift from the bounds
 *  above; pinned to English because every refusal in this store is an English
 *  sentence, and a locale-dependent number inside one would be the only part
 *  of it the author cannot predict.
 *
 *  Both forms are there because the megabytes alone cannot tell a 32 MB asset
 *  from a 32 MB asset and one byte — and "32 MB, but at most 32 MB" is not a
 *  reason an author can do anything with. */
const MEGABYTES = new Intl.NumberFormat("en", {
  style: "unit",
  unit: "megabyte",
  maximumFractionDigits: 1,
});
const BYTES = new Intl.NumberFormat("en");

const size = (bytes: number): string =>
  `${MEGABYTES.format(bytes / (1024 * 1024))} (${BYTES.format(bytes)} bytes)`;

/**
 * Why a measure of a theme's assets does not fit, or undefined when it does.
 *
 * `read` and `write` both answer to these and to nothing else. A store that
 * refuses to read a 33 MB asset but saves one anyway tells the author the save
 * worked and leaves them a blank display, so the bound is written once and
 * both paths ask about it here: a check spelled in two places is a check that
 * eventually fires in one.
 *
 * Each takes only the measure it refuses, so `read` can stop at the asset that
 * is too big instead of reading a folder's worth of bytes to find out. That is
 * also why they return the reason rather than throwing — `read` has no message
 * to give a caller, only "no such theme".
 */
function assetCountRefusal(declared: number): string | undefined {
  return declared > MAX_ASSET_COUNT
    ? `This theme declares ${declared} assets; a theme may declare at most ` +
        `${MAX_ASSET_COUNT}. Remove one, then save again.`
    : undefined;
}

function assetSizeRefusal(
  assetPath: string,
  bytes: number,
): string | undefined {
  return bytes > MAX_ASSET_BYTES
    ? `Asset "${assetPath}" is ${size(bytes)}; one asset may be at most ` +
        `${size(MAX_ASSET_BYTES)}. Shrink or remove it, then save again.`
    : undefined;
}

function assetTotalRefusal(total: number): string | undefined {
  return total > MAX_TOTAL_ASSET_BYTES
    ? `This theme's assets come to ${size(total)}; together they may be at ` +
        `most ${size(MAX_TOTAL_ASSET_BYTES)}. Shrink or remove one, then ` +
        `save again.`
    : undefined;
}

/**
 * Why a whole theme's assets do not fit, measured in declaration order so the
 * answer is the same one {@link ThemeStore.read} would reach, or undefined when
 * they fit. `sizes` is each declared path's size in bytes.
 */
function assetBounds(
  declared: number,
  sizes: Iterable<readonly [string, number]>,
): string | undefined {
  const tooMany = assetCountRefusal(declared);
  if (tooMany !== undefined) {
    return tooMany;
  }
  let total = 0;
  for (const [assetPath, bytes] of sizes) {
    const tooBig = assetSizeRefusal(assetPath, bytes);
    if (tooBig !== undefined) {
      return tooBig;
    }
    total += bytes;
    const tooHeavy = assetTotalRefusal(total);
    if (tooHeavy !== undefined) {
      return tooHeavy;
    }
  }
  return undefined;
}

export function isValidThemeId(id: string): boolean {
  return THEME_ID_REGEX.test(id);
}

/**
 * A scratch name no theme id can claim, because a listing skips the leading
 * dot, and carrying the id it stands for — so a save that died between its two
 * renames can be put back where the author left it.
 */
function scratchName(kind: ScratchKind, id: string): string {
  const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2);
  return `.${kind}-${nonce}.${id}`;
}

/** The theme a scratch folder stands for, or undefined if it names no theme. */
function scratchTarget(
  name: string,
): { readonly kind: ScratchKind; readonly id: string } | undefined {
  for (const kind of ["staging", "retired"] as const) {
    const prefix = `.${kind}-`;
    if (!name.startsWith(prefix)) {
      continue;
    }
    // The nonce is alphanumeric, so the first dot ends it; an id may hold a
    // hyphen but never a dot, so what follows is the whole id.
    const rest = name.slice(prefix.length);
    const dot = rest.indexOf(".");
    if (dot < 1) {
      return undefined;
    }
    const id = rest.slice(dot + 1);
    return NONCE_REGEX.test(rest.slice(0, dot)) && isValidThemeId(id)
      ? { kind, id }
      : undefined;
  }
  return undefined;
}

/**
 * What a killed save left in the library. Renaming onto an existing directory
 * is not portable — POSIX allows it only for an empty one and Windows refuses
 * it — so the swap is two renames and a crash between them cannot be made
 * impossible; it can only be undone. A `.staging-` folder is the debris of a
 * write that never committed, so it goes. A `.retired-` folder is the last good
 * copy of a theme that has no name of its own any more, so it comes back:
 * without this, the failure a crash actually produces is a theme that looks
 * deleted rather than one that is broken.
 */
async function repairScratch(
  library: string,
  entries: readonly Dirent[],
  saving: ReadonlySet<string>,
): Promise<boolean> {
  let repaired = false;
  await Promise.all(
    entries.map(async (entry) => {
      try {
        if (!entry.isDirectory()) {
          return;
        }
        const target = scratchTarget(entry.name);
        // A save in flight owns its scratch folders; repairing here would
        // delete a staging folder it is about to rename in.
        if (target === undefined || saving.has(target.id)) {
          return;
        }
        const scratch = path.join(library, entry.name);
        if (target.kind === "staging") {
          await fs.rm(scratch, { recursive: true, force: true });
          repaired = true;
          return;
        }
        // A live theme wins. Restoring an older copy over a newer one would
        // trade a crash for silent data loss, so an occupied name is left alone
        // and the retired copy stays where it is until nothing stands there.
        const occupied = await fs
          .stat(path.join(library, target.id))
          .then(() => true)
          .catch(() => false);
        if (!occupied) {
          await fs.rename(scratch, path.join(library, target.id));
          repaired = true;
        }
      } catch {
        // A repair that cannot finish must not cost the listing.
      }
    }),
  );
  // Whether anything moved, so the caller knows if it must look again.
  return repaired;
}

/** The declared paths a theme folder must hold, one file each. */
function declaredPaths(envelope: FabricThemeEnvelope): readonly string[] {
  return (envelope.assets ?? []).map((asset) => asset.path);
}

/** What the document says each path holds, for the assets it says it hashes. */
function declaredHashes(
  envelope: FabricThemeEnvelope,
): ReadonlyMap<string, string> {
  const hashes = new Map<string, string>();
  for (const asset of envelope.assets ?? []) {
    // An unhashed declaration is a path with no content to compare, so it never
    // joins the map rather than joining it as `undefined`.
    if (asset.sha256 !== undefined) {
      hashes.set(asset.path, asset.sha256);
    }
  }
  return hashes;
}

/**
 * The declared paths the previous folder already holds correctly, with the size
 * of each, so a save can copy them across instead of rewriting them and weigh
 * them against the bounds it is about to be held to.
 *
 * The declared `sha256` is the authority and nothing is re-hashed here: it was
 * computed at import from the exact bytes, and a matching declaration on both
 * sides means the same content. What a hash cannot say is whether the file is
 * *there* — a folder an author emptied, or a path that is not a regular file,
 * still has to be written, or the save would commit a theme missing it.
 */
async function reusableAssets(
  library: string,
  id: string,
  envelope: FabricThemeEnvelope,
  previous: FabricThemeEnvelope | undefined,
): Promise<ReadonlyMap<string, number>> {
  // No readable previous document means nothing to compare against, so the
  // save writes everything rather than trusting a hash it cannot corroborate.
  if (previous === undefined) {
    return new Map();
  }
  const before = declaredHashes(previous);
  const reusable = new Map<string, number>();
  await Promise.all(
    (envelope.assets ?? []).map(async (asset) => {
      const sha256 = asset.sha256;
      if (sha256 === undefined || before.get(asset.path) !== sha256) {
        return;
      }
      // `lstat`, not `stat`: a symlink is not the file it points at, and
      // copying one would carry its target into the new folder. A file's own
      // size is therefore the one `read` will measure for it later.
      const fileSize = await fs
        .lstat(path.join(library, id, ...asset.path.split("/")))
        .then((stat) => (stat.isFile() ? stat.size : undefined))
        .catch(() => undefined);
      if (fileSize !== undefined) {
        reusable.set(asset.path, fileSize);
      }
    }),
  );
  return reusable;
}

/**
 * Validates both halves of a folder and returns the envelope to persist.
 *
 * `fromStored` says the save may leave an asset out because the folder being
 * replaced already holds it. Only a save that has already been checked against
 * the document it descends from sets it, so "the host has these bytes" is the
 * host's own knowledge and never a client's claim — which is the whole reason
 * a partial payload cannot slip a stale write past the guard.
 */
function checked(
  id: string,
  content: ThemeContent,
  fromStored: boolean,
): FabricThemeEnvelope {
  if (!isValidThemeId(id)) {
    throw new Error("Invalid theme id.");
  }
  const validation = validateFabricThemeEnvelope(content.envelope);
  if (!validation.ok) {
    throw new Error(validation.issues[0]?.message ?? "Invalid theme.");
  }
  const envelope = validation.envelope;
  if (envelope.id !== id) {
    throw new Error(
      `Theme id "${envelope.id}" does not match target id "${id}".`,
    );
  }
  // The declaration is the whole truth about what a theme carries: a byte on
  // disk that no reference names is unreachable, and a reference with no file
  // is a theme that renders nothing. So a save that is not reconstructing must
  // supply every declared path and nothing else, and a save that is may leave
  // out only what the declaration names.
  const declared = declaredPaths(envelope);
  const named = new Set(declared);
  const supplied = Object.keys(content.assets);
  if (
    supplied.some((assetPath) => !named.has(assetPath)) ||
    (!fromStored &&
      (supplied.length !== declared.length ||
        declared.some((assetPath) => content.assets[assetPath] === undefined)))
  ) {
    throw new Error("Assets must exactly match the theme declaration.");
  }
  return envelope;
}

/** The identity of a stored document: the hash of the bytes that are on disk. */
function contentId(document: string | Uint8Array): string {
  return createHash("sha256").update(document).digest("hex");
}

/**
 * Whether anything already stands under this id in the library.
 *
 * A `stat`, not a read: a folder whose `theme.json` does not validate is still
 * the author's work, so a save that claims a free id must refuse for it exactly
 * as it refuses for a theme the listing would show. A plain file under the id
 * counts too — it is somebody's, and not this save's to replace.
 */
async function occupied(library: string, id: string): Promise<boolean> {
  return fs
    .stat(path.join(library, id))
    .then(() => true)
    .catch(() => false);
}

/** The validated `theme.json` in a folder, and what those bytes identify. */
interface StoredTheme {
  readonly envelope: FabricThemeEnvelope;
  readonly contentId: string;
}

/** The document the bytes hold, or a validation error if they are not JSON. */
function parseThemeDocument(id: string, bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new ThemeValidationError(id, [
      {
        code: "not-an-object",
        path: "",
        message: `theme.json is not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
    ]);
  }
}

/**
 * The stored document, or `undefined` when the file is not there. A file that
 * *is* there and cannot be read throws rather than answering `undefined`: the
 * two facts were indistinguishable to every reader, and only the open path
 * wants them apart (vg-110, vg-409, decisions/0043).
 *
 * Both refusals are typed and neither is the other: a document that does not
 * validate is a {@link ThemeValidationError} carrying the validator's issues,
 * and one past the size bound is a {@link ThemeTooLargeError}. The size bound is
 * deliberately not a validation failure — the validator never sees the document
 * — and it is deliberately not an absence either.
 */
async function readStored(
  library: string,
  id: string,
): Promise<StoredTheme | undefined> {
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(path.join(library, id, THEME_FILE));
  } catch {
    return undefined;
  }
  if (bytes.byteLength > MAX_THEME_FILE_BYTES) {
    throw new ThemeTooLargeError(id);
  }
  const validation = validateFabricThemeEnvelope(parseThemeDocument(id, bytes));
  if (!validation.ok) {
    throw new ThemeValidationError(id, validation.issues);
  }
  return { envelope: validation.envelope, contentId: contentId(bytes) };
}

/**
 * {@link readStored} with a present-but-unreadable theme answered as the same
 * absence a missing one is — a document that does not validate, and one past the
 * size bound. Every reader that treats "no theme I can serve" as one answer uses
 * this — the listing, a removal, and the previous document a save is checked
 * against. Only {@link ThemeStore.read} calls `readStored` directly, because it
 * is the one caller the two facts are different answers for.
 */
async function readStoredOrAbsent(
  library: string,
  id: string,
): Promise<StoredTheme | undefined> {
  try {
    return await readStored(library, id);
  } catch (error) {
    if (
      error instanceof ThemeValidationError ||
      error instanceof ThemeTooLargeError
    ) {
      return undefined;
    }
    throw error;
  }
}

/** The validated `theme.json` in a folder, or undefined if it has none. */
async function readEnvelope(
  library: string,
  id: string,
): Promise<FabricThemeEnvelope | undefined> {
  return (await readStoredOrAbsent(library, id))?.envelope;
}

/**
 * The background layer's paint, read the document's own way and converted at
 * the CSS boundary — the resolver the plan and the player both read, so a
 * reference is resolved here exactly as it is on the artboard.
 *
 * **Media behind the board is `undefined`, not the token's paint.** With a
 * background media layer a picture is the ground and the token is not what a
 * viewer sees, which is the same reason `facetRecordOf` answers `unclassified`
 * for that document.
 */
function groundOf(envelope: FabricThemeEnvelope): string | undefined {
  if (envelope.background?.media !== undefined) return undefined;
  return cssArtboardPaint(
    resolveStyleValue(
      envelope.background?.color,
      envelope.globals ?? {},
      "background",
      [],
    ),
  );
}

/** One library line: what the document says, and when the folder changed. */
async function entryFor(
  library: string,
  id: string,
  envelope: FabricThemeEnvelope,
): Promise<ThemeStoreEntry | undefined> {
  try {
    const stat = await fs.stat(path.join(library, id));
    const author = envelope.metadata?.author;
    const version = envelope.metadata?.version;
    const remixOf = envelope.metadata?.remixOf;
    const ground = groundOf(envelope);
    return {
      id,
      name: envelope.metadata?.name ?? id,
      ...(author === undefined ? {} : { author }),
      ...(version === undefined ? {} : { version }),
      ...(remixOf === undefined ? {} : { remixOf }),
      updatedAt: stat.mtime.toISOString(),
      // From the envelope this entry was already handed, so the listing pays
      // nothing new for it: no asset is opened and no second read is made.
      costs: performanceCostsOf(envelope),
      facets: facetRecordOf(envelope),
      ...(ground === undefined ? {} : { ground }),
    };
  } catch {
    return undefined;
  }
}

export function createThemeStore(
  directory: string,
  options?: ThemeStoreOptions,
): ThemeStore {
  const trash = options?.trash ?? moveToTrash;
  // The ids with a save in flight, so a listing landing inside one does not
  // mistake that save's scratch folders for the debris of a dead one.
  const saving = new Set<string>();

  return {
    /**
     * Names, authors and modified times, from `theme.json` alone. The archive
     * this replaced inflated every package in the library to print one line
     * each, which is the cost that made listing worth removing.
     *
     * Repair runs here rather than on start: the store has no lifecycle of its
     * own, and this is the one call through which a theme becomes visible at
     * all — so a crash is undone exactly where it would otherwise be seen, and
     * the repaired theme appears in the listing that repaired it.
     */
    async list(): Promise<readonly ThemeStoreEntry[]> {
      try {
        await fs.mkdir(directory, { recursive: true });
        const seen = await fs.readdir(directory, { withFileTypes: true });
        const entries = (await repairScratch(directory, seen, saving))
          ? await fs.readdir(directory, { withFileTypes: true })
          : seen;
        const themes = await Promise.all(
          entries
            .filter((entry) => entry.isDirectory())
            .map(async (entry) => {
              if (!isValidThemeId(entry.name)) {
                return undefined;
              }
              const envelope = await readEnvelope(directory, entry.name);
              return envelope === undefined
                ? undefined
                : entryFor(directory, entry.name, envelope);
            }),
        );
        return themes
          .filter((entry): entry is ThemeStoreEntry => entry !== undefined)
          .sort((a, b) => a.id.localeCompare(b.id));
      } catch {
        return [];
      }
    },

    async read(id: string): Promise<ThemeStoreRecord | undefined> {
      if (!isValidThemeId(id)) {
        return undefined;
      }
      const stored = await readStored(directory, id);
      if (stored === undefined) {
        return undefined;
      }
      const { envelope } = stored;
      const entry = await entryFor(directory, id, envelope);
      if (entry === undefined) {
        return undefined;
      }

      try {
        const declared = declaredPaths(envelope);
        if (assetCountRefusal(declared.length) !== undefined) {
          return undefined;
        }
        const assets: Record<string, Uint8Array> = {};
        let total = 0;

        for (const assetPath of declared) {
          const bytes = await fs.readFile(
            path.join(directory, id, ...assetPath.split("/")),
          );
          if (assetSizeRefusal(assetPath, bytes.byteLength) !== undefined) {
            return undefined;
          }
          total += bytes.byteLength;
          if (assetTotalRefusal(total) !== undefined) {
            return undefined;
          }
          assets[assetPath] = new Uint8Array(bytes);
        }

        return { ok: true, ...entry, base: stored.contentId, envelope, assets };
      } catch {
        return undefined;
      }
    },

    /**
     * Stages the whole folder beside its target and renames it into place, so
     * an interrupted save can never leave a half-written theme where a working
     * one used to be — the property the single archive file had, kept now that
     * a theme is a directory.
     *
     * An asset the previous theme already holds unchanged is copied across
     * instead of rewritten, with its own timestamps kept: the folder is still
     * staged whole and renamed in, so a file this save did not write is still
     * the same file to everything that watches one.
     *
     * A save that declares a `base` is checked against the stored document
     * first, and the check runs before anything is created on disk: a refusal
     * leaves the theme byte-for-byte as it was, which is the same promise the
     * staged rename makes about an interrupted save.
     *
     * The asset bounds `read` refuses are refused here too, beside the check
     * that proves the folder holds what this save left out — so what the store
     * will not serve is never what it stores, and the author's "Saved to
     * library" is a claim the store can keep.
     *
     * That check is also what lets a save omit an asset. Only a save whose base
     * *matched* may leave one out, and only of the document it is replacing — an
     * `overwrite` stands the guard down and therefore carries the whole theme,
     * because what is on disk is then not the document this save came from.
     *
     * A save that claims a free id (`expectFree`) is refused here too, and
     * before any of the above: the claim and the write are one step, so nothing
     * can land between them.
     */
    async write(
      id: string,
      content: ThemeContent,
      options?: ThemeWriteOptions,
    ): Promise<ThemeStoreSave> {
      // Before anything is created on disk, and before the base is compared:
      // the claim is about the folder, not about a document, so it is settled
      // by the folder's own existence.
      if (options?.expectFree === true && (await occupied(directory, id))) {
        throw new ThemeIdTakenError(id);
      }
      const stored = await readStoredOrAbsent(directory, id);
      let reconstructFrom: StoredTheme | undefined;
      if (options?.overwrite !== true && options?.base !== undefined) {
        // A theme that is not stored cannot have been moved on, so a base
        // against nothing is a first save rather than a stale one.
        if (stored !== undefined && stored.contentId !== options.base) {
          throw new ThemeConflictError(id);
        }
        reconstructFrom = stored;
      }
      const envelope = checked(id, content, reconstructFrom !== undefined);
      const serialized = JSON.stringify(envelope);
      await fs.mkdir(directory, { recursive: true });
      const target = path.join(directory, id);
      const staging = path.join(directory, scratchName("staging", id));
      const retired = path.join(directory, scratchName("retired", id));
      // `rename` onto an existing directory succeeds on POSIX and fails on
      // Windows, so an old folder is moved aside first and removed after — and
      // a crash between the two leaves the theme recoverable under its
      // `.retired-` name rather than gone.
      let hadPrevious = false;
      saving.add(id);

      try {
        const reusable = await reusableAssets(
          directory,
          id,
          envelope,
          stored?.envelope,
        );
        // A save that left an asset out has to have left out one the folder
        // still holds. A hash proves the content is right, never that the file
        // is *there*, and a theme committed without a declared file is a theme
        // that renders nothing — so this refuses rather than quietly shipping a
        // hole, and refuses before the staging folder exists, so nothing is left
        // half-done.
        const lost = declaredPaths(envelope).find(
          (assetPath) =>
            content.assets[assetPath] === undefined && !reusable.has(assetPath),
        );
        if (lost !== undefined) {
          throw new Error(
            `Asset "${lost}" is not in the library folder, so a save that ` +
              "leaves an asset out cannot leave out this one. Send it in full.",
          );
        }
        // A theme the store would refuse to read must not be written at all: the
        // save would report success, and the next open would find nothing. An
        // asset this save left out is weighed from the file it is replacing —
        // the same measurement `read` takes from that file — so both paths
        // judge the same theme by the same number. Beside the check above, and
        // before the staging folder exists, so a refusal leaves the previous
        // version byte-for-byte as it was.
        const weighed = declaredPaths(envelope).map((assetPath) => {
          const carried = content.assets[assetPath];
          // `lost` above has already refused the case where there is no file to
          // weigh, so the fallback is a number only in a world that cannot get
          // here; it still weighs, and it still refuses rather than throwing on
          // a missing one.
          return [
            assetPath,
            carried?.byteLength ?? reusable.get(assetPath) ?? 0,
          ] as const;
        });
        const tooBig = assetBounds(weighed.length, weighed);
        if (tooBig !== undefined) {
          throw new ThemeAssetLimitError(tooBig);
        }
        await fs.mkdir(path.join(staging, ASSETS_DIR), { recursive: true });
        await fs.writeFile(path.join(staging, THEME_FILE), serialized);
        // The declaration, not the payload, is the list: every declared path
        // ends up in the folder, whether the save carried its bytes or the
        // folder being replaced already had them.
        for (const assetPath of declaredPaths(envelope)) {
          // The declaration is validated above, so a path cannot escape; this
          // is the belt to that suspenders, because the write is a filesystem
          // call and the check is not.
          const file = path.join(staging, ...assetPath.split("/"));
          await fs.mkdir(path.dirname(file), { recursive: true });
          const bytes = content.assets[assetPath];
          // Copied rather than written whenever the folder already holds these
          // bytes: either the payload carried them unchanged, or it left them
          // out and the check above proved the file is there. A copy keeps the
          // file's own timestamps, so a save that did not write it leaves the
          // same file in place for everything that watches one.
          if (bytes === undefined || reusable.has(assetPath)) {
            await fs.cp(path.join(target, ...assetPath.split("/")), file, {
              preserveTimestamps: true,
            });
          } else {
            await fs.writeFile(file, bytes);
          }
        }

        hadPrevious = await fs
          .stat(target)
          .then(() => true)
          .catch(() => false);
        if (hadPrevious) {
          await fs.rename(target, retired);
        }
        await fs.rename(staging, target);
      } catch (error) {
        await fs.rm(staging, { recursive: true, force: true });
        throw error;
      } finally {
        saving.delete(id);
      }

      if (hadPrevious) {
        await fs.rm(retired, { recursive: true, force: true });
      }

      const entry = await entryFor(directory, id, envelope);
      if (entry === undefined) {
        throw new Error("The theme could not be read back after saving.");
      }
      // The bytes just written are what the next save is based on, so the base
      // is computed here rather than read back — a re-read would also be a
      // second chance for something else to have moved underneath.
      return { ...entry, base: contentId(serialized) };
    },

    /**
     * Moves the theme's folder to the operating system's trash, and does
     * nothing else to anything.
     *
     * A theme is a folder of authored work (ADR-0017), so this is the one
     * destructive act the store has, and the trash is what makes it
     * recoverable — the ruling that put it there, and `docs/decisions/0021` for
     * how each platform's own trash is reached. There is no fallback to an
     * unlink: a refused delete is recoverable and a silent one is not.
     *
     * A save in flight owns its folder — it swaps it in with two renames — so
     * a removal that arrived between them would take the folder the second
     * rename is about to move into place. It is refused instead.
     */
    async remove(id: string): Promise<boolean> {
      if (!isValidThemeId(id)) {
        throw new Error("Invalid theme id.");
      }
      if (saving.has(id)) {
        throw new Error(
          `"${id}" is being saved right now; try again in a moment.`,
        );
      }
      // Read first, so only what the library would have listed can be removed.
      // A directory whose name a theme id could claim but which holds no theme
      // is somebody's file, and its loss would be unexplained.
      if ((await readEnvelope(directory, id)) === undefined) {
        return false;
      }
      await trash(path.join(directory, id));
      return true;
    },
  };
}
