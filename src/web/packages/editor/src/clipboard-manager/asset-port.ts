import { type AssetManager, mimeOf } from "../asset-manager/index.js";

/** One declared image or SVG, as a clipboard payload carries it. The bytes are
 *  the authority; `path` is the source package path, read only for the file name
 *  the destination's own validation needs. */
export interface ClipboardAsset {
  readonly id: string;
  readonly kind: "image" | "svg";
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** A source id, and the destination declaration that replaced it. */
export interface ClipboardAssetDeclaration {
  readonly from: string;
  readonly id: string;
  readonly previewUrl: string;
}

/** What the clipboard asks of the theme's asset owner. The session installs it
 *  because the declaration list is the document's: a clipboard that held a
 *  second one would leave the pasted reference pointing at bytes the theme does
 *  not hold. */
export interface ClipboardAssets {
  /** The declared bytes behind a reference, or `undefined` when the source theme
   *  cannot name them. A reference the clipboard cannot carry is refused rather
   *  than pasted as a dead handle. */
  readonly read: (assetId: string) => ClipboardAsset | undefined;
  /** Declares every carried file in the destination theme, under fresh ids.
   *  All or none: a failure removes what this call already declared, so a paste
   *  that could not finish leaves the theme's declaration list as it found it. */
  readonly declare: (
    assets: readonly ClipboardAsset[],
  ) => Promise<readonly ClipboardAssetDeclaration[]>;
}

function fileNameOf(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? path : path.slice(separator + 1);
}

/** The clipboard's port onto one `AssetManager`: read from the source theme,
 *  declare into the destination through the manager's own validation. */
export function createClipboardAssets(
  assets: AssetManager,
  onDeclared: () => void,
): ClipboardAssets {
  return {
    read(assetId) {
      const declaration = assets.declarations.find(
        (candidate) => candidate.id === assetId,
      );
      if (
        declaration === undefined ||
        (declaration.kind !== "image" && declaration.kind !== "svg")
      )
        return undefined;
      const bytes = assets.assets[declaration.path];
      return bytes === undefined
        ? undefined
        : {
            id: declaration.id,
            kind: declaration.kind,
            path: declaration.path,
            bytes,
          };
    },

    async declare(entries) {
      const declared: { readonly id: string }[] = [];
      try {
        const results: ClipboardAssetDeclaration[] = [];
        for (const entry of entries) {
          const filename = fileNameOf(entry.path);
          const mime = mimeOf(filename);
          if (mime === undefined)
            throw new Error(
              `The clipboard carries an unsupported file: ${entry.path}`,
            );
          // The destination's own importer validates the bytes and allocates a
          // fresh id, so a carried file cannot claim the source theme's name.
          const reference = await assets.import(
            new File([entry.bytes as unknown as BlobPart], filename, {
              type: mime,
            }),
          );
          declared.push(reference);
          const previewUrl = assets.previewUrl(reference.id);
          if (previewUrl === undefined)
            throw new Error(
              `The pasted file cannot be read: ${reference.path}`,
            );
          results.push({
            from: entry.id,
            id: reference.id,
            previewUrl,
          });
        }
        return results;
      } catch (error) {
        for (const reference of declared) assets.remove(reference.id);
        throw error;
      } finally {
        if (declared.length > 0) onDeclared();
      }
    },
  };
}
