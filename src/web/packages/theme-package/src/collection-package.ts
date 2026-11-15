import { isCatalogueId } from "@yunari/renderer-core";

/** The collection format's own name: the manifest of a package that lists
 *  catalogue ids rather than carrying a theme. */
export const COLLECTION_PACKAGE_FORMAT = "yunari-collection-package";
export const MAX_COLLECTION_INCLUDES = 64;

const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;

/** One catalogue listing a collection installs. `optional` is the author's
 *  default for the install sheet, not a hint: an unticked optional member may
 *  be skipped. */
export interface CollectionInclude {
  readonly id: string;
  readonly optional: boolean;
}

export interface CollectionPackage {
  readonly name: string;
  readonly description: string;
  readonly includes: readonly CollectionInclude[];
}

export type CollectionPackageResult =
  | { readonly ok: true; readonly package: CollectionPackage }
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
  if (value["version"] !== 1) {
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
    const id = entry["id"];
    if (typeof id !== "string" || !isCatalogueId(id)) {
      return fail(
        "A collection include needs an id that is a lowercase catalogue UUID.",
      );
    }
    if (seen.has(id)) {
      return fail(`The collection include "${id}" appears twice.`);
    }
    seen.add(id);
    const optional = entry["optional"];
    if (optional !== undefined && typeof optional !== "boolean") {
      return fail(
        `The collection include "${id}" has an optional flag that is not a boolean.`,
      );
    }
    includes.push({ id, optional: optional === true });
  }

  return { ok: true, package: { name, description, includes } };
}
