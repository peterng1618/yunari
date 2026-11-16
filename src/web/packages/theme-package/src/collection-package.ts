import {
  type CollectionInclude,
  collectionIncludeOf,
  isCatalogueId,
  MAX_COLLECTION_INCLUDES,
} from "@yunari/renderer-core";

// Re-exported for this package's consumers: the value is renderer-core's one
// owner, and a consumer holding the package read should not need a second
// import for the bound that read enforces.
export { MAX_COLLECTION_INCLUDES } from "@yunari/renderer-core";

/** The collection format's own name and version: the manifest of a package
 *  that lists catalogue ids rather than carrying a theme. Both are written and
 *  checked here only, so a version bump is one edit. */
export const COLLECTION_PACKAGE_FORMAT = "yunari-collection-package";
export const COLLECTION_PACKAGE_VERSION = 1;

const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;

export interface CollectionPackage {
  readonly name: string;
  readonly description: string;
  readonly includes: readonly CollectionInclude[];
}

export type CollectionPackageResult =
  | { readonly ok: true; readonly package: CollectionPackage }
  | { readonly ok: false; readonly message: string };

/** A collection before it is bytes: the fields the builder holds and the host
 *  validates. It is the package's own shape, so the writer and reader cannot
 *  disagree about a field. */
export type CollectionDraft = CollectionPackage;

export type CollectionDraftResult =
  | { readonly ok: true; readonly draft: CollectionDraft }
  | { readonly ok: false; readonly message: string };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): CollectionPackageResult {
  return { ok: false, message };
}

/**
 * A collection package, read structurally and within bounds.
 *
 * The reader owns no listing: it checks that every include is a catalogue id
 * and leaves existence, publication and self-reference to the store, which is
 * the only surface that can answer them. It refuses a document whose format,
 * version, name, description, includes or optional flag it cannot account for,
 * so a caller can validate before writing anything.
 */
export function readCollectionPackage(
  bytes: Uint8Array,
): CollectionPackageResult {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("That collection package is not UTF-8 text.");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return fail("That collection package is not valid JSON.");
  }
  if (!isRecord(value)) {
    return fail("A collection package must be a JSON object.");
  }
  if (value["format"] !== COLLECTION_PACKAGE_FORMAT) {
    return fail("Unsupported collection package format.");
  }
  if (value["version"] !== COLLECTION_PACKAGE_VERSION) {
    return fail("Unsupported collection package version.");
  }

  const rawName = value["name"];
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (name === "" || name.length > MAX_NAME_LENGTH) {
    return fail(
      `A collection package needs a name of 1-${MAX_NAME_LENGTH} characters.`,
    );
  }

  const rawDescription = value["description"];
  const description =
    rawDescription === undefined
      ? ""
      : typeof rawDescription === "string"
        ? rawDescription.trim()
        : undefined;
  if (
    description === undefined ||
    description.length > MAX_DESCRIPTION_LENGTH
  ) {
    return fail(
      `A collection package needs a description of at most ${MAX_DESCRIPTION_LENGTH} characters.`,
    );
  }

  const declared = value["includes"];
  if (!Array.isArray(declared)) {
    return fail("A collection package needs a list of includes.");
  }
  if (declared.length === 0) {
    return fail("A collection package needs 1-64 includes.");
  }
  if (declared.length > MAX_COLLECTION_INCLUDES) {
    return fail(
      `A collection package may carry at most ${MAX_COLLECTION_INCLUDES} includes.`,
    );
  }

  const includes: CollectionInclude[] = [];
  const seen = new Set<string>();
  for (const entry of declared) {
    if (!isRecord(entry)) {
      return fail("A collection include must be an object.");
    }
    // The record's shape is renderer-core's, beside the bound this reader
    // imports: one parser answers what `{ id, optional }` is for both the
    // package and the catalogue wire. The sentences below stay this format's.
    const include = collectionIncludeOf(entry);
    if (include === undefined) {
      const id = entry["id"];
      if (typeof id !== "string" || !isCatalogueId(id)) {
        return fail(
          "A collection include needs an id that is a lowercase catalogue UUID.",
        );
      }
      return fail(
        `The collection include "${id}" has an optional flag that is not a boolean.`,
      );
    }
    if (seen.has(include.id)) {
      return fail(`The collection include "${include.id}" appears twice.`);
    }
    seen.add(include.id);
    includes.push(include);
  }

  return { ok: true, package: { name, description, includes } };
}

/**
 * The collection's one writer, beside its reader.
 *
 * The manifest is the format's own JSON: the format's name and version, the
 * author's fields, and each include with its optional flag spelled out. The
 * reader is what decides whether the result is a collection, so a caller that
 * serializes and re-reads has checked the exact bytes it will post or store.
 */
export function collectionManifest(draft: CollectionDraft): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      format: COLLECTION_PACKAGE_FORMAT,
      version: COLLECTION_PACKAGE_VERSION,
      name: draft.name,
      description: draft.description,
      includes: draft.includes.map((include) => ({
        id: include.id,
        optional: include.optional,
      })),
    }),
  );
}

/**
 * A draft, read through the package reader that owns the format's bounds.
 *
 * The shape is normalised first — a non-string name becomes `""`, an absent
 * description `""`, and a list that is not an array `[]` — so the reader names
 * the field it refused rather than a caller having to guard every member. The
 * bounds, catalogue ids and the duplicate rule stay the reader's.
 */
export function readCollectionDraft(value: unknown): CollectionDraftResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      message: "A collection needs a name and its listings.",
    };
  }
  const name = value["name"];
  const description = value["description"];
  const includes = value["includes"];
  const read = readCollectionPackage(
    new TextEncoder().encode(
      JSON.stringify({
        format: COLLECTION_PACKAGE_FORMAT,
        version: COLLECTION_PACKAGE_VERSION,
        name: typeof name === "string" ? name : "",
        description: description === undefined ? "" : description,
        includes: Array.isArray(includes) ? includes : [],
      }),
    ),
  );
  return read.ok
    ? { ok: true, draft: read.package }
    : { ok: false, message: read.message };
}

/** The draft, or nothing where it is not one. */
export function parseCollectionDraft(
  value: unknown,
): CollectionDraft | undefined {
  const read = readCollectionDraft(value);
  return read.ok ? read.draft : undefined;
}

export type CollectionIncludesResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/**
 * Who may be an include: the catalogue's half of collection validation.
 *
 * The reader owns the manifest's structure — ids, bounds and duplicates. This
 * owns what only a catalogue can answer, and is pure so every surface that holds
 * a published map applies one rule: each include is published, none is the
 * collection itself, and none is another collection. `published` maps a
 * published id to its listing kind; an id absent from it is unknown or
 * unpublished. The host checks a draft with it before uploading, and the Worker
 * checks the stored package with it before a version row exists.
 */
export function validateCollectionIncludes(
  includes: readonly CollectionInclude[],
  published: ReadonlyMap<string, string>,
  selfId: string,
): CollectionIncludesResult {
  for (const { id } of includes) {
    if (id === selfId) {
      return { ok: false, message: "A collection cannot include itself." };
    }
    const kind = published.get(id);
    if (kind === undefined) {
      return {
        ok: false,
        message: `The collection includes "${id}", which is not a published item.`,
      };
    }
    if (kind === "collection") {
      return {
        ok: false,
        message: `The collection includes "${id}", which is itself a collection; collections are one level deep.`,
      };
    }
  }
  return { ok: true };
}
