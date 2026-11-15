import { type CatalogueOrigin, isStoreItemKind } from "@yunari/renderer-core";

/**
 * The one client reader of this PC's origin register.
 *
 * A collection's installed count needs the origin of each included listing, and
 * those origins live in one place the host owns. The register's own rows are
 * metadata only — no bytes, no package URL — so the surface reads it once
 * instead of fetching member packages, and the update diff will read the same
 * answer later. Keeping the parse here means one spelling of the register's
 * wire rather than a copy beside each reader.
 */
const ORIGINS_PATH = "/api/store/origins";

export interface OriginsReadOptions {
  readonly fetch?: typeof fetch;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

/** One record, held to the shape the card and the update diff read. An entry
 *  this build cannot use leaves the answer unusable rather than silently
 *  shrinking the register. */
function originOf(value: unknown): CatalogueOrigin | undefined {
  if (!isRecord(value)) return undefined;

  const kind = value["kind"];
  const catalogueId = value["catalogueId"];
  const version = value["version"];
  const installedAt = value["installedAt"];
  if (!isStoreItemKind(kind)) return undefined;
  if (typeof catalogueId !== "string" || catalogueId === "") return undefined;
  if (typeof version !== "string" || version === "") return undefined;
  if (typeof installedAt !== "string" || installedAt === "") return undefined;

  const collections = value["collections"];
  if (collections === undefined) {
    return { kind, catalogueId, version, installedAt };
  }
  const named = isStringArray(collections) ? collections : undefined;
  if (named === undefined) return undefined;
  return { kind, catalogueId, version, installedAt, collections: named };
}

/**
 * Reads the register, or rejects. A failed read is a stated failure the caller
 * draws with a retry; it is never an empty register, because "nothing is
 * installed" is a claim this reader cannot make from an answer it did not get.
 */
export async function readOrigins(
  options: OriginsReadOptions = {},
): Promise<readonly CatalogueOrigin[]> {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const response = await fetcher(ORIGINS_PATH);
  if (!response.ok) {
    throw new Error(`The host answered ${response.status}.`);
  }

  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body["origins"])) {
    throw new Error("The host did not answer an origin register.");
  }

  return body["origins"].map((row): CatalogueOrigin => {
    const origin = originOf(row);
    if (origin === undefined) {
      throw new Error("The host answered an unusable origin record.");
    }
    return origin;
  });
}
