import type { FabricThemeEnvelope } from "@yunari/renderer-core";
import type { ThemeCredits, WidgetDocument } from "@yunari/theme-package";
import { createElement } from "react";
import { openModal } from "../components/ui/modal-host.js";
import {
  fileNameFor,
  serializeThemePackage,
  serializeWidgetPackage,
  widgetFileNameFor,
} from "../persist.js";
import { uiCopy } from "../ui-copy.js";
import {
  ReplaceDocumentPrompt,
  type ReplacementAnswer,
} from "./replace-document-prompt.js";

export type Downloader = (name: string, bytes: Uint8Array) => void;

function defaultDownloader(name: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes as unknown as BlobPart], {
    type: "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** Product file export for .yunari-theme packages. */
export class PersistenceManager {
  /** What was last saved, or `undefined` while nothing has been. A document
   *  with nothing saved behind it — a draft restored after a crash — has no
   *  state to compare against, so it reads as unsaved from its first frame
   *  rather than claiming to match a save that never happened. */
  #savedDocument: string | undefined;
  readonly #downloader: Downloader;

  constructor(
    initial: FabricThemeEnvelope,
    initialAssets: Readonly<Record<string, Uint8Array>> = {},
    options?: {
      readonly downloader?: Downloader;
      readonly unsaved?: boolean;
    },
  ) {
    this.#savedDocument =
      options?.unsaved === true
        ? undefined
        : documentKey(initial, initialAssets);
    this.#downloader = options?.downloader ?? defaultDownloader;
  }

  isDirty(
    theme: FabricThemeEnvelope,
    assets: Readonly<Record<string, Uint8Array>> = {},
  ): boolean {
    return (
      this.#savedDocument === undefined ||
      documentKey(theme, assets) !== this.#savedDocument
    );
  }

  markSaved(
    theme: FabricThemeEnvelope,
    assets: Readonly<Record<string, Uint8Array>> = {},
  ): void {
    this.#savedDocument = documentKey(theme, assets);
  }

  async save(
    theme: FabricThemeEnvelope,
    assets: Readonly<Record<string, Uint8Array>> = {},
    thumbnail?: Uint8Array,
    credits?: ThemeCredits,
  ): Promise<void> {
    const result = serializeThemePackage(theme, assets, thumbnail, credits);
    if (!result.ok) {
      throw new Error(result.message);
    }
    this.#downloader(fileNameFor(theme), result.bytes);
    this.#savedDocument = documentKey(theme, assets);
  }

  /** Downloads a selection's widget package. It is not a save: the document's
   *  own baseline is untouched, because the theme did not change. */
  exportWidget(
    document: WidgetDocument,
    assets: Readonly<Record<string, Uint8Array>> = {},
  ): void {
    const result = serializeWidgetPackage(document, assets);
    if (!result.ok) throw new Error(result.message);
    this.#downloader(widgetFileNameFor(document), result.bytes);
  }

  destroy(): void {}
}

/** Asks before a document is replaced. A prompt the author reads on the way to
 *  losing their work, so it is a `Dialog` — named, centred, keyboard-dismissable
 *  and portalled to the top layer, where an unclassed `<dialog>` once picked up
 *  no margin from the preflight reset and landed over the very menu it was
 *  opened from, asking its question in the corner of the screen.
 *
 *  A dismissal resolves `cancel`, which is what an empty `returnValue` already
 *  meant: Escape must not be read as consent to lose the work.
 *
 *  **The question is the caller's**, defaulting to the replacement one. What the
 *  prompt asks is the only thing that makes it a *replacement* rather than a
 *  guard about unsaved work, so the shell's mode switch — which leaves the same
 *  document with the same unsaved state — reuses this instrument and supplies
 *  its own words rather than carrying a second guard that could not offer Save. */
export async function confirmDocumentReplacement(
  question: string = uiCopy.replaceDocument.question,
): Promise<ReplacementAnswer> {
  const answer = await openModal<ReplacementAnswer>((settle) =>
    createElement(ReplaceDocumentPrompt, { question, settle }),
  );
  return answer ?? "cancel";
}

/**
 * Authored state only: a thumbnail is a rendering of one machine, so a
 * different one is not a change to the document.
 *
 * The scene half is compared as the serialiser produced it, not as the canvas
 * holds it. `@yunari/scene-fabric`'s `serialiseScene` is the one owner of what is derived
 * — a live preview's `text`, its per-character `styles`, an image's decoded
 * `src` — so a repaint between two reads cannot make an untouched document
 * differ from itself, and a future derived key is excluded by changing that
 * module rather than this one. Every caller here reaches the key through
 * `snapshot()`, which is that serialisation.
 *
 * The asset half of the key is each path's *declared* `sha256`, not its bytes.
 * The bytes made the key a one-boxed-number-per-byte array and its stringified
 * form an ~86 MB retained string for a 24 MB asset, paid on every open, new and
 * save, and it answered a question the digest already answers — a byte can only
 * reach the map by being imported, replaced or adopted, and every one of those
 * recomputes the declaration the envelope carries. The envelope's own JSON is in
 * the key too, so a document whose fields moved while its assets stood still is
 * still a changed document, and the map's own paths are listed so bytes with no
 * declaration — and a rename, an addition or a removal — cannot hide behind it.
 */
export function documentKey(
  theme: FabricThemeEnvelope,
  assets: Readonly<Record<string, Uint8Array>>,
): string {
  const declared = new Map(
    (theme.assets ?? []).map((asset) => [asset.path, asset.sha256 ?? null]),
  );
  // The union, not the loaded map. Enumerating `assets` alone caught the case it
  // was written for — bytes with no declaration — but made the key a function of
  // *how much has loaded*: a theme whose asset bytes arrive after the manager was
  // constructed read as edited with nothing touched. Measured on the Starter,
  // whose one declared asset is exactly that: the key gained its
  // `assets/starter-backdrop.jpg` entry when the backdrop finished loading, and
  // every later prompt to replace a document asked about work nobody had done. A
  // declared path is in the list whether or not its bytes are here, so loading
  // stops being an edit, and an undeclared one still appears with a null digest.
  const paths = [
    ...new Set([...declared.keys(), ...Object.keys(assets)]),
  ].sort();
  return JSON.stringify([
    theme,
    paths.map((path) => [path, declared.get(path) ?? null]),
  ]);
}
