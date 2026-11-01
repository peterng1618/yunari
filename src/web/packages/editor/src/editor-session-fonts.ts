import {
  FONT_ASSET_FORMATS,
  type FontAssetReference,
} from "@yunari/renderer-core";
import {
  MAX_CREDITS_ENTRIES,
  type ThemeCreditsEntry,
} from "@yunari/theme-package";
import {
  ASSET_FILE_EXTENSIONS,
  type AssetManager,
} from "./asset-manager/index.js";
import { openFontImportDialog } from "./components/font-import-dialog.js";
import type { EditorDocument } from "./editor-document.js";
import type { FontCommitInput } from "./panes/assets/assets-pane.js";
import { fontMetadataFromFilename } from "./panes/assets/font-metadata-form.js";
import { uiCopy } from "./ui-copy.js";

/** The font formats the manager packages, so the picker offers no file the
 *  importer refuses. A `font/*` pattern would offer `.ttc` and every other face
 *  format the package cannot carry. */
const FONT_FILE_ACCEPT = ASSET_FILE_EXTENSIONS.filter((extension) =>
  (FONT_ASSET_FORMATS as readonly string[]).includes(extension),
)
  .map((extension) => `.${extension}`)
  .join(",");

/** The document and manager a font commit writes through, plus the one signal
 *  that says a declaration moved. */
export interface FontCommitHost {
  readonly assets: AssetManager;
  readonly document: EditorDocument;
  readonly declarationsChanged: () => void;
}

/**
 * The one font commit the Assets pane reports: a fresh file or a declared
 * face, with or without the preset.
 *
 * The cap is checked before anything is declared, because nothing removes a
 * credit and the package writer refuses an over-cap list at the next save.
 * A fresh file has no id until it is declared (and `import` never dedupes),
 * so its question is the list's length, asked directly: `canAddCredit`'s
 * duplicate-key arm would let a legacy pre-assetId credit of the same title
 * mask a full list. A declared face's real id lets `canAddCredit` answer,
 * because re-creating that face's preset replaces its own credit rather than
 * growing the list. Cancel declares the file and writes neither the preset
 * nor the credit.
 */
export async function commitFont(
  host: FontCommitHost,
  input: FontCommitInput,
): Promise<
  | { readonly ok: true; readonly message: string; readonly tokenId?: string }
  | { readonly ok: false; readonly message: string }
> {
  const { source, metadata, role, withPreset } = input;
  if (!withPreset) {
    try {
      if (!("file" in source))
        throw new Error("A declared font has nothing to import.");
      await host.assets.importFont(source.file, metadata);
      host.declarationsChanged();
      return { ok: true, message: uiCopy.panels.assetDeclaredFont };
    } catch (error) {
      return { ok: false, message: messageOf(error) };
    }
  }

  const credit: ThemeCreditsEntry = {
    kind: "font",
    title: metadata.family,
    license: metadata.licence,
    changes: "Imported unchanged",
    ...(metadata.sourceUrl === undefined
      ? {}
      : { source: { url: metadata.sourceUrl } }),
    ...("assetId" in source ? { assetId: source.assetId } : {}),
  };
  const full =
    "file" in source
      ? host.document.credits().length >= MAX_CREDITS_ENTRIES
      : !host.document.canAddCredit(credit);
  if (full) return { ok: false, message: uiCopy.assets.creditsFull };

  try {
    const asset: FontAssetReference =
      "file" in source
        ? await host.assets.importFont(source.file, metadata)
        : host.assets.amendFont(source.assetId, metadata);
    const tokenId = host.document.addTypeTokenFromLocalFont(asset, role);
    host.document.addCredit({ ...credit, assetId: asset.id });
    host.declarationsChanged();
    // Only a fresh import is an import; amending a declared face writes the
    // preset, which the Tokens pane shows.
    return {
      ok: true,
      message: "file" in source ? uiCopy.panels.assetDeclaredFont : "",
      // The token this commit created or adopted, so a caller that asked for
      // the import can point its own reference at it.
      tokenId,
    };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/**
 * The import row: the OS picker, then the metadata dialog.
 *
 * A dismissed picker declares nothing, and the input is removed either way so
 * a second press starts from an empty pick. `onImported` is the run row's:
 * the dialog names the token its commit produced, and that caller acts on it.
 */
export function pickFontFile(
  host: FontCommitHost,
  onImported?: (tokenId: string) => void,
): void {
  const input = document.createElement("input");
  input.type = "file";
  input.hidden = true;
  input.accept = FONT_FILE_ACCEPT;
  input.dataset["yunariTokenFontImport"] = "";
  const dispose = (): void => input.remove();
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    dispose();
    if (file !== undefined) openFontImport(host, file, onImported);
  });
  // Fired by a browser that reports a cancelled picker; without it the input
  // would stay on the body until the next pick.
  input.addEventListener("cancel", dispose);
  document.body.append(input);
  input.click();
}

/**
 * The dialog answers with the same two commits the Assets pane makes, minus
 * the role: this import may never rewrite a role token.
 */
function openFontImport(
  host: FontCommitHost,
  file: File,
  onImported?: (tokenId: string) => void,
): void {
  void openFontImportDialog({
    filename: file.name,
    initial: fontMetadataFromFilename(file.name),
    onCommit: (metadata) =>
      commitFont(host, {
        source: { file },
        metadata,
        role: null,
        withPreset: true,
      }),
    onCancel: (metadata) =>
      commitFont(host, {
        source: { file },
        metadata,
        role: null,
        withPreset: false,
      }),
    ...(onImported === undefined ? {} : { onCommitted: onImported }),
  });
}

/** A refusal's own words, or the value itself when it was not an `Error`. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The package's declared font families, one entry per family, sorted the way a
 * reader scans a list rather than the order the files arrived in. A family
 * differing only in case is the same family, so the first spelling is kept.
 */
export function declaredFamilies(
  declarations: AssetManager["declarations"],
): readonly string[] {
  const held = new Map<string, string>();
  for (const asset of declarations) {
    if (asset.kind !== "font" || !("family" in asset)) continue;
    const key = asset.family.toLowerCase();
    if (!held.has(key)) held.set(key, asset.family);
  }
  return [...held.values()].sort((left, right) =>
    left.localeCompare(right, "en", { sensitivity: "base" }),
  );
}
