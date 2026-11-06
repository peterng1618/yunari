import type { AssetReference } from "@yunari/renderer-core";

/** One side of an adoption: the declarations an owner holds and their bytes. */
export interface PackagedAssetOwner {
  readonly declarations: readonly AssetReference[];
  readonly assets: Readonly<Record<string, Uint8Array>>;
}

/** What one adoption produced; the ids map a package id onto the adopted one. */
export interface PackagedAssetAdoption {
  readonly declarations: readonly AssetReference[];
  readonly assets: Record<string, Uint8Array>;
  readonly assetIds: ReadonlyMap<string, string>;
}

function sha256(bytes: Uint8Array): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
}

async function digestOf(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await sha256(bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** The path tail's stem and extension, kept separately so a rename keeps the
 *  file type a reader needs. */
function splitName(path: string): {
  readonly stem: string;
  readonly extension: string;
} {
  const tail = path.slice(path.lastIndexOf("/") + 1);
  const dot = tail.lastIndexOf(".");
  return dot <= 0
    ? { stem: tail, extension: "" }
    : { stem: tail.slice(0, dot), extension: tail.slice(dot + 1) };
}

/**
 * A fresh id and path for an arrival that collides with a resident.
 *
 * The stem is sanitised exactly as the editor's own allocator does, and both
 * halves are suffixed independently so a collision in either renames both.
 */
function allocate(
  stem: string,
  extension: string,
  taken: {
    readonly ids: ReadonlySet<string>;
    readonly paths: ReadonlySet<string>;
  },
): { readonly id: string; readonly path: string } {
  const base =
    stem.replaceAll(/[^A-Za-z0-9_-]+/g, "-").replaceAll(/^-+|-+$/g, "") ||
    "asset";
  const pathOf = (suffix: number): string =>
    `assets/${base}${suffix === 1 ? "" : `-${suffix}`}${
      extension === "" ? "" : `.${extension}`
    }`;
  let pathSuffix = 1;
  let path = pathOf(pathSuffix);
  while (taken.paths.has(path)) {
    pathSuffix += 1;
    path = pathOf(pathSuffix);
  }
  let idSuffix = 1;
  let id = base;
  while (taken.ids.has(id)) {
    idSuffix += 1;
    id = `${base}-${idSuffix}`;
  }
  return { id, path };
}

/**
 * Declares a package's assets without letting it overwrite the resident ones.
 *
 * **Every declaration is verified before anything is returned.** A pack whose
 * bytes disagree with its digest, or whose declaration carries no digest, is
 * refused whole: a half-adopted set is a scene naming bytes the document does
 * not hold. The editor and the MCP server both adopt through this owner, so a
 * second insertion renames an asset the same way wherever it is dispatched.
 *
 * A resident id or path the arrival collides with renames the arrival; so does
 * an earlier declaration adopted in this same call. Every other declaration
 * field travels unchanged.
 */
export async function adoptPackagedAssets(
  existing: PackagedAssetOwner,
  packaged: PackagedAssetOwner,
): Promise<PackagedAssetAdoption> {
  const verified: {
    readonly declaration: AssetReference;
    readonly bytes: Uint8Array;
  }[] = [];
  for (const declaration of packaged.declarations) {
    const bytes = Object.hasOwn(packaged.assets, declaration.path)
      ? packaged.assets[declaration.path]
      : undefined;
    if (bytes === undefined) {
      throw new Error(`Package asset has no bytes: ${declaration.path}.`);
    }
    if (declaration.sha256 === undefined) {
      throw new Error(
        `Package asset ${declaration.path} declares no SHA-256 digest.`,
      );
    }
    const digest = await digestOf(bytes);
    if (declaration.sha256 !== digest) {
      throw new Error(
        `Package asset ${declaration.path} does not match its declared SHA-256 digest.`,
      );
    }
    verified.push({ declaration, bytes });
  }

  const ids = new Set(existing.declarations.map((asset) => asset.id));
  const paths = new Set(existing.declarations.map((asset) => asset.path));
  const adopted: AssetReference[] = [];
  const assets: Record<string, Uint8Array> = { ...existing.assets };
  const assetIds = new Map<string, string>();

  for (const { declaration, bytes } of verified) {
    const collides = ids.has(declaration.id) || paths.has(declaration.path);
    const { stem, extension } = splitName(declaration.path);
    const placed = collides
      ? allocate(stem, extension, { ids, paths })
      : { id: declaration.id, path: declaration.path };
    const reference: AssetReference = {
      ...declaration,
      id: placed.id,
      path: placed.path,
    };
    adopted.push(reference);
    assets[placed.path] = bytes;
    ids.add(placed.id);
    paths.add(placed.path);
    assetIds.set(declaration.id, placed.id);
  }

  return {
    declarations: [...existing.declarations, ...adopted],
    assets,
    assetIds,
  };
}
