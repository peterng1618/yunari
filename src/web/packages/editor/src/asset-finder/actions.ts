import type {
  AssetPage,
  AssetPreset,
  AssetResult,
} from "@yunari/renderer-core";
import type { ThemeCreditsEntry } from "@yunari/theme-package";
import { type AssetManager, mimeOf } from "../asset-manager/index.js";
import type { EditorDocument } from "../editor-document.js";
import {
  type PresetLibraryStore,
  presetLibrary,
} from "../preset-library/index.js";
import { uiCopy } from "../ui-copy.js";

/** The outcome is yes or a sentence: what was placed differs by kind — an image
 *  carries an asset reference and an icon carries none — and no caller reads
 *  the difference. */
export type ImportOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/** Where a row's consequence lands: the source's default, or the second action
 *  an image offers — the theme's background or the canvas. */
export type AssetPlacement = "place" | "background";

/** The finder's action for one row: bytes in, declared asset and credit out.
 *
 * The asset manager keeps its caps and its SVG sanitising, unchanged; the
 * credit is the source's own word for what it served, which is why `kind`
 * travels on the result rather than being guessed from the filename.
 */
export async function importFinderResult(input: {
  readonly page: AssetPage;
  readonly result: AssetResult;
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly manager: AssetManager;
  readonly document: EditorDocument;
  readonly place: (assetId: string) => void;
}): Promise<ImportOutcome> {
  const mime = mimeOf(input.filename);
  if (mime === undefined)
    return { ok: false, message: uiCopy.assets.unknownAssetFile };

  // Checked before the bytes are declared: an over-cap entry would leave the
  // document unable to save, and no surface can remove one.
  const credit = creditOf(input.result);
  if (!input.document.canAddCredit(credit))
    return { ok: false, message: uiCopy.assets.creditsFull };

  try {
    const file = new File(
      [input.bytes as unknown as BlobPart],
      input.filename,
      {
        type: mime,
      },
    );
    const reference = await input.manager.import(file);
    input.document.addCredit(credit);
    input.place(reference.id);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Adds a row's preset to the editor-local library. A preset is data, not an
 *  imported asset: there are no bytes to declare and no author to credit. The
 *  store owns dedupe, hex normalisation and the offset check, so its counts
 *  are what the author is told — a palette becomes one preset per swatch. */
export function applyPreset(
  result: AssetResult & { readonly preset: AssetPreset },
  library: PresetLibraryStore = presetLibrary,
): { ok: true; message?: string } | { ok: false; message: string } {
  const preset = result.preset;

  if (preset.kind === "palette") {
    const { added } = library.addColours(
      preset.colours.map((value, index) => ({
        name: `${result.name} ${index + 1}`,
        value,
      })),
    );
    return {
      ok: true,
      message:
        added === 0
          ? uiCopy.assets.presetAlreadyStored
          : uiCopy.assets.presetAdded(added),
    };
  }

  const { added } = library.addGradient({
    name: result.name,
    angle: preset.angle,
    stops: preset.stops,
  });
  return {
    ok: true,
    message: added
      ? uiCopy.assets.gradientAdded
      : uiCopy.assets.presetAlreadyStored,
  };
}

/** The attribution an imported result carries (spec R7). An image's subtitle
 *  is its photographer; an icon's is a style, which is not an author. */
export function creditOf(result: AssetResult): ThemeCreditsEntry {
  return {
    kind: result.kind,
    title: result.name,
    ...(result.kind === "image" && result.subtitle !== undefined
      ? { author: { name: result.subtitle } }
      : {}),
    license: result.licence,
    changes: "Imported unchanged",
    ...(result.sourceUrl === "" ? {} : { source: { url: result.sourceUrl } }),
  };
}
