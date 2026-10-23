import { useEffect, useReducer, useRef, useState } from "react";
import {
  ASSET_FILE_EXTENSIONS,
  type AssetManager,
  assetReferencedBy,
  type LocalAssetReference,
  type PlacedAssetReference,
} from "../../asset-manager/index.js";
import { ControlSelect } from "../../components/ui/control-select.js";
import type { EditorInteraction } from "../../editor-interaction.js";
import { FIND_GLYPH, Glyph } from "../../editor-shell/icons.js";
import { uiCopy } from "../../ui-copy.js";
import { requestNormalizedVideo } from "../../video-normalizer.js";

/**
 * The Add pane's file path: the declared-asset library the Assets pane used to
 * be, now the pane's own foot.
 *
 * **The list is the declarations, not the placed objects.** An image or an SVG
 * is declared *and* placed; a video or a font is declared only, because no
 * image object can carry it — and the artboard paints a video as background
 * media. A list built from what is on the canvas keeps the placeable files and
 * silently loses everything else, which is the defect Review Focus 5 names: a
 * font imported once would be unreachable and un-removable.
 *
 * **Replace is a byte swap on the chosen asset, never a re-point of a
 * selection.** The author picks a row and gives *it* a new file; every object
 * bound to that id re-points when the manager rehydrates, and the package does
 * not grow. "Re-point the selected object at a new asset" is a different,
 * selection-scoped capability that `vg-154` records as remaining work, and its
 * home is ruled elsewhere: a control over a selected object lives in the
 * selection inspector (`selection-inspector/crop.ts` states the rule), not in
 * this library. Building it is the row's own open decision, so this file must
 * not grow it.
 *
 * The element contracts the imperative panel carried are preserved verbatim:
 * `data-yunari-asset-select`, `-preview`, `-import`, `-replace`, `-remove` and
 * the two `-input` file pickers, plus the `role="alert"` that carries a refusal
 * in words. `data-yunari-panel` is the pane's, written by `Pane`, and is
 * deliberately not written again here.
 */
interface FileSectionProps {
  readonly manager: AssetManager;
  readonly editor: EditorInteraction;
  /** Told the declarations moved, so the document's own panels re-resolve: the
   *  artboard's background-media list and the media it renders. */
  readonly changed: () => void;
  /** The envelope-side references no object carries — the artboard's background
   *  media and a type preset's face. Optional, so the section is mountable
   *  where there is no envelope to ask. */
  readonly isReferenced?: (assetId: string) => boolean;
  /** Opens the finder. Optional so a section mounted without a shell still
   *  draws its control; the shell always passes it. */
  readonly onFindAssets?: () => void;
}

export function FileSection({
  manager,
  editor,
  changed,
  isReferenced,
  onFindAssets,
}: FileSectionProps): React.JSX.Element {
  const importInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [chosenId, setChosenId] = useState<string | undefined>(
    () => manager.declarations[0]?.id,
  );
  const [message, setMessage] = useState("");
  /** The host's normalized copy, held until the author presses to write it.
   *  Keyed by the asset, so choosing another row cannot draw the wrong one. */
  const [held, setHeld] = useState<
    { readonly assetId: string; readonly bytes: Uint8Array } | undefined
  >();
  const [normalizing, setNormalizing] = useState(false);
  // The manager's declarations are live external state, so a mutation has to be
  // followed by a render rather than by a state copy that could go stale.
  const [, render] = useReducer((count: number) => count + 1, 0);
  // One submission at a time: the pickers are cleared after every use, so a
  // re-fire of the same file is caught here rather than importing twice.
  const busy = useRef(false);

  const declarations = manager.declarations;
  const chosen =
    declarations.find((asset) => asset.id === chosenId) ?? declarations[0];
  const previewUrl =
    chosen === undefined ? undefined : manager.previewUrl(chosen.id);

  /**
   * Runs one submission, and refuses to start a second while it is in flight.
   *
   * Serialising is *new in this surface*: the panel this replaces had no guard
   * and let two imports interleave in one manager. The cost is named rather than
   * hidden — a second pick inside the window is dropped with nothing said.
   */
  const submit = async (task: () => Promise<void>): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    try {
      await task();
    } finally {
      busy.current = false;
      render();
    }
  };

  /** The manager's own refusal, told to the author and to the diagnostics. */
  const refuse = (error: unknown): void => {
    setMessage(uiCopy.panels.assetImportFailed);
    editor.errorManager.error("image", uiCopy.panels.assetImportFailed, error);
  };

  const importFile = async (file: File): Promise<void> => {
    let asset: LocalAssetReference;
    try {
      asset = await manager.import(file);
    } catch (error) {
      // The manager validates before it mutates, so a refused file leaves the
      // package and the document exactly as they were.
      refuse(error);
      return;
    }
    if (isPlaceable(asset)) {
      try {
        await manager.placeImage(editor, file, asset);
        // One committed edit for the declaration and the object together.
        editor.historyManager.saveState();
        editor.canvas.requestRenderAll();
      } catch (error) {
        // The bytes are declared even when nothing took them — the author can
        // still see the file and remove it, which is better than a silent loss.
        refuse(error);
        changed();
        return;
      }
    }
    setMessage(importMessage(asset));
    // The selection is left where it was, as the deleted panel left it: an
    // author pointing at one asset must not find the list pointing at another
    // because they added a file. Only an empty list moves it, via `chosen`'s
    // fallback to the first declaration.
    changed();
  };

  const replaceFile = async (file: File): Promise<void> => {
    const id = chosen?.id;
    if (id === undefined || !declarations.some((asset) => asset.id === id)) {
      refuse(new Error("No declared asset to replace."));
      return;
    }
    try {
      await manager.replace(id, file);
      // Rehydration is what carries the new pixels to every object bound to
      // this id, at whatever depth it sits.
      await manager.hydrate(editor.canvas);
    } catch (error) {
      // `replace` validates before it writes, so a refused file leaves the
      // package, the document and the preview exactly as they were.
      refuse(error);
      return;
    }
    setMessage("");
    setHeld(undefined);
    editor.historyManager.saveState();
    editor.canvas.requestRenderAll();
    changed();
  };

  const removeChosen = async (): Promise<void> => {
    const id = chosen?.id;
    if (id === undefined) return;
    if (
      assetReferencedBy(editor.canvas.getObjects(), id) ||
      isReferenced?.(id) === true
    ) {
      setMessage(uiCopy.panels.assetReferenced);
      return;
    }
    if (manager.remove(id)) {
      setMessage("");
      setChosenId(undefined);
      setHeld(undefined);
      changed();
    }
  };

  /**
   * Sends the chosen video to the host and holds the copy it answers with.
   *
   * Nothing is written here: the master is the file the author imported, and a
   * re-encode shown to them for approval must not quietly become the document.
   * `useNormalized` is the press that writes it. The host's own sentence is the
   * refusal, because it names which envelope rule the video broke.
   */
  const normalizeVideo = async (): Promise<void> => {
    const asset = chosen;
    if (asset === undefined || asset.kind !== "video") return;
    // A held copy belongs to the press that produced it: a second press, even
    // one the host refuses, must never leave the previous mode's result armed.
    // Cleared before the bytes check too, so no early return keeps it.
    setHeld(undefined);
    setMessage("");
    const bytes = manager.assets[asset.path];
    if (bytes === undefined) {
      refuse(new Error(`Missing declared asset bytes for ${asset.id}.`));
      return;
    }
    setNormalizing(true);
    try {
      // No crop is asked for: the host keeps the whole frame, and the
      // background layer crops at render time (0095).
      const outcome = await requestNormalizedVideo(bytes);
      if (!outcome.ok) {
        setMessage(outcome.message);
        return;
      }
      setHeld({ assetId: asset.id, bytes: outcome.bytes });
      setMessage("");
    } finally {
      setNormalizing(false);
    }
  };

  /** The second press: the held copy becomes the master's bytes, in place. */
  const useNormalized = async (): Promise<void> => {
    const pending = held;
    if (pending === undefined || pending.assetId !== chosen?.id) return;
    try {
      await manager.replaceBytes(pending.assetId, pending.bytes);
      // Rehydration carries the new bytes to whatever renders this id — the
      // artboard's background media included.
      await manager.hydrate(editor.canvas);
    } catch (error) {
      // Writing the held copy is a byte swap, not an import; the import
      // sentence would name the wrong failure (N6).
      setMessage(uiCopy.panels.useNormalizedFailed);
      editor.errorManager.error(
        "image",
        uiCopy.panels.useNormalizedFailed,
        error,
      );
      return;
    }
    setHeld(undefined);
    setMessage("");
    editor.historyManager.saveState();
    editor.canvas.requestRenderAll();
    changed();
  };

  const video = chosen?.kind === "video" ? chosen : undefined;
  const pending = held?.assetId === video?.id ? held : undefined;
  const pendingPreviewUrl = useHeldVideoUrl(pending?.bytes);

  return (
    <section>
      {/* The entry drawing puts the finder above the library, at the drop
          target's own weight: it is a way to add an asset, not a tool over the
          ones already declared. */}
      <button
        type="button"
        data-yunari-find-assets=""
        onClick={() => onFindAssets?.()}
        className="mb-[var(--space-8)] flex w-full items-center justify-center gap-[var(--space-6)] rounded-[var(--radius-md)] border border-accent px-[var(--space-10)] py-[var(--space-6)] text-sm text-accent"
      >
        <Glyph icon={FIND_GLYPH} size={13} />
        {uiCopy.file.findAssets}
      </button>
      {/* The Add pane's drawing gives this picker its own shape rather than a
          labelled field row: `shell.html:128-132` draws an `Asset` eyebrow over
          a trigger spanning the pane, the file name at `flex:1`. The heading is
          what names the control, and the name it prints is the whole file name
          — in a 74px label column the trigger was 170px wide and ellipsised it
          (`vg-302`). */}
      <ControlSelect
        shape="headed"
        label={uiCopy.panels.assetList}
        data={{ "data-yunari-asset-select": "" }}
        value={chosen?.id ?? ""}
        options={declarations.map((asset) => ({
          id: asset.id,
          name: fileNameOf(asset),
        }))}
        onChange={(id) => {
          setChosenId(id);
          // A held copy belongs to the asset it was produced for.
          setHeld(undefined);
          setMessage("");
        }}
      />
      {/* A video and a font have nothing to preview, and hiding the empty frame
          is what keeps the previous asset's picture from standing as if it were
          this one's. */}
      <img
        className="yunari-asset-preview"
        data-yunari-asset-preview=""
        alt={chosen === undefined ? "" : fileNameOf(chosen)}
        src={previewUrl}
        hidden={previewUrl === undefined}
      />
      <div className="yunari-field-row">
        <button
          type="button"
          data-yunari-asset-import=""
          onClick={() => importInput.current?.click()}
        >
          {uiCopy.panels.importFile}
        </button>
        <button
          type="button"
          data-yunari-asset-replace=""
          onClick={() => replaceInput.current?.click()}
        >
          {uiCopy.panels.replaceAsset}
        </button>
        <button
          type="button"
          data-yunari-asset-remove=""
          onClick={() => void submit(removeChosen)}
        >
          {uiCopy.panels.removeAsset}
        </button>
        {/* A video is the one kind with an envelope to fit, and the envelope
            keeps its whole frame: cropping belongs to the background layer,
            where the author can pan it back. Neither control exists for a file
            that is not a video. */}
        {video !== undefined && (
          <>
            <button
              type="button"
              data-yunari-asset-normalize=""
              disabled={normalizing}
              onClick={() => void submit(() => normalizeVideo())}
            >
              {normalizing
                ? uiCopy.panels.normalizingVideo
                : uiCopy.panels.normalizeVideo}
            </button>
            {pending !== undefined && pendingPreviewUrl !== undefined && (
              // Spec rule 4: the author previews the normalized asset, not the
              // master, before the press that writes it.
              <video
                className="yunari-asset-preview"
                data-yunari-asset-normalized-preview=""
                controls
                src={pendingPreviewUrl}
              />
            )}
            {pending !== undefined && (
              <button
                type="button"
                data-yunari-asset-use-normalized=""
                onClick={() => void submit(useNormalized)}
              >
                {uiCopy.panels.useNormalizedVideo}
              </button>
            )}
          </>
        )}
      </div>
      <p role="alert">{message}</p>
      <input
        ref={importInput}
        type="file"
        hidden
        accept={ASSET_FILE_ACCEPT}
        data-yunari-asset-import-input=""
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file !== undefined) void submit(() => importFile(file));
        }}
      />
      <input
        ref={replaceInput}
        type="file"
        hidden
        accept={ASSET_FILE_ACCEPT}
        data-yunari-asset-replace-input=""
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file !== undefined) void submit(() => replaceFile(file));
        }}
      />
    </section>
  );
}

/** A blob URL for the held copy, so it can be previewed before it is written.
 *  Revoked when the copy changes or the section unmounts. */
function useHeldVideoUrl(bytes: Uint8Array | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (bytes === undefined) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(
      new Blob([bytes as unknown as BlobPart], { type: "video/mp4" }),
    );
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [bytes]);
  return url;
}

/**
 * The file types the two pickers offer, derived from the manager's own
 * `TYPES` so the chooser cannot drift from what the manager can read. The
 * manager still refuses a file whose bytes or MIME do not match; this only
 * keeps a person from picking the wrong one at all.
 */
const ASSET_FILE_ACCEPT = ASSET_FILE_EXTENSIONS.map((ext) => `.${ext}`).join(
  ",",
);

/** The kinds a canvas image can be bound to; a video or a font is declared
 *  without ever becoming an object. */
function isPlaceable(
  asset: LocalAssetReference,
): asset is PlacedAssetReference {
  return asset.kind === "image" || asset.kind === "svg";
}

/**
 * What the pane says an import did, decided by the kind.
 *
 * The switch has no `default`, so a fifth kind in the manager's `TYPES` fails to
 * compile here rather than falling through to the placed message: the kind union
 * is what decides, and the code should have to say so.
 */
function importMessage(asset: LocalAssetReference): string {
  switch (asset.kind) {
    case "image":
    case "svg":
      return uiCopy.panels.assetPlaced;
    case "video":
      return uiCopy.panels.assetDeclaredVideo;
    case "font":
      return uiCopy.panels.assetDeclaredFont;
  }
}

/** The file an author chose, not the id the package keys it by. */
function fileNameOf(asset: LocalAssetReference): string {
  const separator = asset.path.lastIndexOf("/");
  return separator < 0 ? asset.path : asset.path.slice(separator + 1);
}
