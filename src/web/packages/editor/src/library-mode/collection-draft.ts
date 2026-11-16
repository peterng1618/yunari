import {
  COLLECTION_PACKAGE_FORMAT,
  type CollectionInclude,
  readCollectionPackage,
} from "@yunari/theme-package";

/**
 * A collection draft, as the builder holds it before it becomes a package.
 *
 * The bounds are not restated here: `collectionManifest` writes the bytes and
 * `readCollectionPackage` is the one reader that decides whether they are a
 * collection, naming the field it refused. A second copy of "1–200 characters"
 * or "1–64 includes" would drift from the format's owner.
 */
export interface CollectionDraft {
  readonly name: string;
  readonly description: string;
  readonly includes: readonly CollectionInclude[];
}

export type CollectionDraftResult =
  | { readonly ok: true; readonly draft: CollectionDraft }
  | { readonly ok: false; readonly message: string };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The draft as the package's own JSON, with the shape's holes left for the
 * reader to name: a non-string name becomes `""`, an absent description `""`,
 * and a list that is not an array `[]`. Everything else — the bounds, the
 * catalogue ids and the duplicate rule — stays the reader's.
 */
function manifestValue(value: Readonly<Record<string, unknown>>): unknown {
  const name = value["name"];
  const description = value["description"];
  const includes = value["includes"];
  return {
    format: COLLECTION_PACKAGE_FORMAT,
    version: 1,
    name: typeof name === "string" ? name : "",
    description: description === undefined ? "" : description,
    includes: Array.isArray(includes) ? includes : [],
  };
}

/**
 * The draft's one validation, through the package reader that owns the format.
 *
 * A draft is a manifest without its envelope, so it is serialised and read back
 * rather than checked twice: the reader's sentence is the refusal a person
 * sees, whether the problem is a bound, a non-catalogue id or a duplicate.
 */
export function readCollectionDraft(value: unknown): CollectionDraftResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      message: "A collection needs a name and its listings.",
    };
  }
  const read = readCollectionPackage(
    new TextEncoder().encode(JSON.stringify(manifestValue(value))),
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

/**
 * The exact bytes a submission posts: the format's name and version, the
 * author's fields, and each include with its optional flag spelled out.
 */
export function collectionManifest(draft: CollectionDraft): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      format: COLLECTION_PACKAGE_FORMAT,
      version: 1,
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
 * Whether the draft names the listing the submission itself creates.
 *
 * It is separate from {@link readCollectionDraft} because only the caller knows
 * the listing's id: the parser stays a function of the draft alone, and a new
 * collection's id exists only in the surface that is about to publish it.
 */
export function selfIncludeRefusal(
  draft: CollectionDraft,
  listingId: string,
): string | undefined {
  return draft.includes.some((include) => include.id === listingId)
    ? "A collection cannot include itself."
    : undefined;
}
