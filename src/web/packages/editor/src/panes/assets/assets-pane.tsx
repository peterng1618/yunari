import type { FontAssetReference } from "@yunari/renderer-core";
import { useEffect, useReducer, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import {
  ASSET_FILE_EXTENSIONS,
  type AssetManager,
  assetFileName,
  assetReferencedBy,
  type LocalAssetReference,
  mimeOf,
} from "../../asset-manager/index.js";
import { ControlIconButton } from "../../components/ui/control-icon-button.js";
import type { EditorInteraction } from "../../editor-interaction.js";
import {
  DELETE_ITEM_GLYPH,
  Glyph,
  KIND_GLYPHS,
  PLACE_ON_CANVAS_GLYPH,
  REPLACE_ASSET_GLYPH,
  VISIBLE_GLYPH,
} from "../../editor-shell/icons.js";
import type { FontTrioRole } from "../../type-preset-apply.js";
import { uiCopy } from "../../ui-copy.js";
import { requestNormalizedVideo } from "../../video-normalizer.js";
import { AssetCard } from "./asset-card.js";
import {
  type FontMetadata,
  FontMetadataForm,
  fontMetadataFromFilename,
} from "./font-metadata-form.js";
import { isPreviewable, openAssetPreview } from "./preview-modal.js";

/**
 * The Assets pane's body: every declared file as a card, grouped by kind.
 *
 * **The list is the declarations, not the placed objects.** A video or a font
 * is declared only — no canvas object can carry it — so a list built from the
 * scene would lose both, and a font imported once would be unreachable and
 * un-removable.
 *
 * **In use is either reference route.** `assetReferencedBy` walks the scene at
 * any depth; `isReferenced` asks the envelope, which holds the artboard's
 * background media and a type preset's face. The second is optional, so the
 * pane mounts where there is no envelope to ask.
 *
 * The component owns no bytes and no document state. Files are declared,
 * replaced, hydrated and removed through the manager; placement goes through
 * the manager with the editor's canvas; background media and preset creation
 * are the document's, so the pane delegates them through callbacks that a
 * caller with a document supplies.
 */
interface AssetsPaneProps {
  readonly manager: AssetManager;
  readonly editor: EditorInteraction;
  /** The envelope-side references no object carries. */
  readonly isReferenced?: (assetId: string) => boolean;
  /** Told the declarations moved, so the document's own panels re-resolve: the
   *  artboard's background media, its bytes, and the pane's title count. */
  readonly onChanged?: () => void;
  /** Opens the finder. Optional so the pane draws without a shell. */
  readonly onFindAssets?: () => void;
  /** Writes the asset as the artboard's background media — envelope state the
   *  pane cannot reach itself. */
  readonly onBackground?: (asset: LocalAssetReference) => void;
  /** The one font commit: declares or amends the face, then writes the preset
   *  and the credit. The cap check and the document writes are the caller's,
   *  because neither can be reached from the pane. Required: a face cannot be
   *  declared without the document that credits it. */
  readonly onFontCommit: FontCommit;
}

export interface FontCommitInput {
  readonly source: { readonly file: File } | { readonly assetId: string };
  readonly metadata: FontMetadata;
  readonly role: FontTrioRole | null;
  readonly withPreset: boolean;
}

export type FontCommit = (
  input: FontCommitInput,
) => Promise<
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly message: string }
>;

/** What a chosen font's form is being drawn for: a file not yet declared, or a
 *  declaration whose metadata the form may amend. */
type FontDraft =
  | { readonly file: File; readonly metadata: FontMetadata }
  | { readonly assetId: string; readonly metadata: FontMetadata };

/** The metadata a declared face carries, read back into the form. */
function metadataOfFont(asset: FontAssetReference): FontMetadata {
  const weight = Number(asset.weight);
  return {
    family: asset.family,
    // A declaration always carries a usable weight; a hand-edited package that
    // does not falls back to the parser's default rather than printing NaN.
    weight: Number.isFinite(weight) && weight > 0 ? weight : 400,
    style: asset.style,
    licence: asset.license?.name ?? "unknown",
    ...(asset.sourceUrl === undefined ? {} : { sourceUrl: asset.sourceUrl }),
  };
}

type LocalAssetKind = LocalAssetReference["kind"];

/** Which section a declared kind is drawn in. A total map, so a kind the
 *  manager grows fails to compile here rather than drawing nowhere. An SVG is
 *  an image file, so it sits with Images rather than inventing a section. */
const GROUP_OF: Readonly<Record<LocalAssetKind, SectionId>> = {
  font: "fonts",
  image: "images",
  svg: "images",
  video: "videos",
};

type SectionId = "fonts" | "images" | "videos";

const SECTIONS: readonly { readonly id: SectionId; readonly label: string }[] =
  [
    { id: "fonts", label: uiCopy.assets.category.font },
    { id: "images", label: uiCopy.assets.category.image },
    { id: "videos", label: uiCopy.assets.category.video },
  ];

const ASSET_FILE_ACCEPT = ASSET_FILE_EXTENSIONS.map((ext) => `.${ext}`).join(
  ",",
);

export function AssetsPane({
  manager,
  editor,
  isReferenced,
  onChanged,
  onFindAssets,
  onBackground,
  onFontCommit,
}: AssetsPaneProps): React.JSX.Element {
  const importInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  /** Which import the next pick is: the picker answers with files, never an
   *  intent, so the control that opened it is what decides. */
  const importIntent = useRef<"auto" | "background">("auto");
  const [chosenId, setChosenId] = useState<string | undefined>(
    () => manager.declarations[0]?.id,
  );
  const [message, setMessage] = useState("");
  /** The host's normalized copy, held until the author presses to write it.
   *  Keyed by the asset, so choosing another card cannot draw the wrong one. */
  const [held, setHeld] = useState<
    { readonly assetId: string; readonly bytes: Uint8Array } | undefined
  >();
  const [normalizing, setNormalizing] = useState(false);
  /** The font whose metadata form is open. A pick opens one before anything is
   *  declared; Create type preset on a card opens the same form for its face. */
  const [font, setFont] = useState<FontDraft | undefined>();
  const [fontBusy, setFontBusy] = useState(false);
  // The manager's declarations are live external state, so a mutation is
  // followed by a render rather than by a state copy that could go stale. A
  // save's prune is one of those mutations and never passes through this pane,
  // which is why the manager tells it rather than the local actions alone.
  const [, render] = useReducer((count: number) => count + 1, 0);
  useEffect(() => manager.subscribe(render), [manager, render]);

  const declarations = manager.declarations;
  const chosen =
    declarations.find((asset) => asset.id === chosenId) ?? declarations[0];
  const objects = editor.canvas.getObjects();
  const referenced = (assetId: string): boolean =>
    assetReferencedBy(objects, assetId) || isReferenced?.(assetId) === true;

  // One submission at a time: the pickers are cleared after every use, so a
  // re-fire of the same file is caught here rather than importing twice.
  const busy = useRef(false);
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

  /** The manager's or the error surface's own refusal, told in words. */
  const refuse = (error: unknown): void => {
    setMessage(uiCopy.panels.assetImportFailed);
    editor.errorManager.error("image", uiCopy.panels.assetImportFailed, error);
  };

  /**
   * Declares the picked file and takes the one automatic placement its kind
   * makes unambiguous: a picture is placed, a video becomes the artboard's
   * background media, and a font opens its metadata form — nothing is declared
   * at the pick, so a file the author walks away from leaves no declaration.
   *
   * `background` is the author overriding that choice: an image or a video is
   * forced into background media, and a font is refused before the manager
   * declares it, so no control leaves a file the author asked not to import.
   */
  const importFile = async (
    file: File,
    intent: "auto" | "background",
  ): Promise<void> => {
    if (intent === "background" && mimeOf(file.name)?.startsWith("font/")) {
      setMessage(uiCopy.panels.assetBackgroundFontRefused);
      return;
    }
    if (intent === "auto" && mimeOf(file.name)?.startsWith("font/")) {
      setFont({ file, metadata: fontMetadataFromFilename(file.name) });
      setMessage("");
      return;
    }
    let asset: LocalAssetReference;
    try {
      asset = await manager.import(file);
    } catch (error) {
      // The manager validates before it mutates, so a refusal leaves the
      // package and the document exactly as they were.
      refuse(error);
      return;
    }
    if (intent === "background" || asset.kind === "video") {
      // The sentence names what actually ran: a pane mounted without the
      // callback declared the file and set no background.
      if (onBackground === undefined) {
        setMessage(uiCopy.panels.assetDeclaredOnly);
      } else {
        onBackground(asset);
        setMessage(uiCopy.panels.assetBackgroundSet);
      }
      onChanged?.();
      return;
    }
    if (asset.kind === "image" || asset.kind === "svg") {
      try {
        await manager.placeImage(editor, file, asset);
        // One committed edit for the declaration and the object together.
        editor.historyManager.saveState();
        editor.canvas.requestRenderAll();
      } catch (error) {
        // The bytes are declared even when nothing took them — the author can
        // still see the file and remove it, which is better than a silent loss.
        refuse(error);
        onChanged?.();
        return;
      }
    }
    setMessage(importMessage(asset));
    // The selection stays where it was: an author pointing at one asset must
    // not find the list moved because they added a file.
    onChanged?.();
  };

  /** Opens the same form for a face the package already declares. */
  const openFontForm = (asset: LocalAssetReference): void => {
    if (!("format" in asset)) return;
    setFont({ assetId: asset.id, metadata: metadataOfFont(asset) });
    setMessage("");
  };

  /** Create type preset: one commit for the declaration, the preset and the
   *  credit. The caller holds the cap check, so a refusal declares nothing. */
  const commitFont = (
    metadata: FontMetadata,
    role: FontTrioRole | null,
  ): void => {
    const pending = font;
    if (pending === undefined) return;
    void submit(async () => {
      setFontBusy(true);
      try {
        const source =
          "file" in pending
            ? { file: pending.file }
            : { assetId: pending.assetId };
        const outcome = await onFontCommit({
          source,
          metadata,
          role,
          withPreset: true,
        });
        setMessage(outcome.message);
        if (!outcome.ok) return;
        setFont(undefined);
        if ("file" in pending) {
          // The declaration the commit just made is the card to point at.
          const fonts = manager.declarations.filter(
            (asset) => asset.kind === "font",
          );
          setChosenId(fonts.at(-1)?.id);
        }
      } finally {
        setFontBusy(false);
      }
    });
  };

  /** Cancel on a fresh pick still declares the file — with the values on the
   *  form, and no preset or credit; on a declared face it only closes. */
  const cancelFont = (metadata: FontMetadata): void => {
    const pending = font;
    if (pending === undefined) return;
    if (!("file" in pending)) {
      setFont(undefined);
      return;
    }
    void submit(async () => {
      setFontBusy(true);
      try {
        const outcome = await onFontCommit({
          source: { file: pending.file },
          metadata,
          role: null,
          withPreset: false,
        });
        setMessage(outcome.message);
        if (!outcome.ok) return;
        setFont(undefined);
        const fonts = manager.declarations.filter(
          (asset) => asset.kind === "font",
        );
        setChosenId(fonts.at(-1)?.id);
      } catch (error) {
        // The form stays open, so the values it refuses can be repaired.
        refuse(error);
      } finally {
        setFontBusy(false);
      }
    });
  };

  const replaceFile = async (file: File): Promise<void> => {
    const id = chosen?.id;
    if (id === undefined) {
      refuse(new Error("No declared asset to replace."));
      return;
    }
    try {
      await manager.replace(id, file);
      // Rehydration carries the new pixels to every object bound to this id,
      // whatever depth it sits at.
      await manager.hydrate(editor.canvas);
    } catch (error) {
      refuse(error);
      return;
    }
    setMessage("");
    setHeld(undefined);
    editor.historyManager.saveState();
    editor.canvas.requestRenderAll();
    onChanged?.();
  };

  /** Puts a declared picture on the canvas. The bytes are the manager's; the
   *  `File` is only the shape its placement path reads them through. */
  const place = async (asset: LocalAssetReference): Promise<void> => {
    if (asset.kind !== "image" && asset.kind !== "svg") return;
    const bytes = manager.assets[asset.path];
    const type = mimeOf(asset.path);
    if (bytes === undefined || type === undefined) {
      refuse(new Error(`Missing declared asset bytes for ${asset.id}.`));
      return;
    }
    const file = new File(
      [bytes as unknown as BlobPart],
      assetFileName(asset),
      {
        type,
      },
    );
    try {
      await manager.placeImage(editor, file, asset);
    } catch (error) {
      refuse(error);
      return;
    }
    editor.historyManager.saveState();
    editor.canvas.requestRenderAll();
  };

  const remove = async (asset: LocalAssetReference): Promise<void> => {
    if (referenced(asset.id)) {
      setMessage(uiCopy.panels.assetReferenced);
      return;
    }
    if (manager.remove(asset.id)) {
      setMessage("");
      setChosenId(undefined);
      setHeld(undefined);
      onChanged?.();
      return;
    }
    // The declaration was not there to remove — a row drawn from a list the
    // manager has already moved would otherwise press onto nothing.
    setMessage(uiCopy.panels.assetRemoveFailed);
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
    // one the host refuses, must never leave the previous result armed.
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
    onChanged?.();
  };

  /**
   * Opens the asset's own surface, with the pane's closures so its commands run
   * through `submit()` exactly as the card's do.
   *
   * A video has no URL from the manager — `previewUrl` answers `undefined` for
   * one — so the pane mints the stage's blob URL and releases it when the modal
   * reports it has closed. Nothing is written: the URL is a reading of the
   * declared bytes.
   */
  const openPreview = (asset: LocalAssetReference): void => {
    if (!isPreviewable(asset)) return;
    const bytes = manager.assets[asset.path];
    let videoUrl: string | undefined;
    if (asset.kind === "video" && bytes !== undefined) {
      const type = mimeOf(asset.path);
      videoUrl = URL.createObjectURL(
        new Blob([bytes as unknown as BlobPart], {
          ...(type === undefined ? {} : { type }),
        }),
      );
    }
    setChosenId(asset.id);
    void openAssetPreview({
      asset,
      previewUrl:
        asset.kind === "video" ? videoUrl : manager.previewUrl(asset.id),
      inUse: referenced(asset.id),
      sizeBytes: bytes?.byteLength,
      onRemove: () => submit(() => remove(asset)),
      onReplace: () => {
        setChosenId(asset.id);
        replaceInput.current?.click();
      },
      onBackground:
        onBackground === undefined
          ? undefined
          : () => void submit(async () => onBackground(asset)),
      onPlace:
        asset.kind === "video"
          ? undefined
          : () => void submit(() => place(asset)),
      onClose: () => {
        if (videoUrl !== undefined) URL.revokeObjectURL(videoUrl);
      },
    });
  };

  /** The actions a chosen card draws. The two canvas writes are absent where
   *  the kind cannot perform them; Create type preset is a face's own. Preview
   *  is absent for a face too: the finder owns a font's specimen. */
  const actionsFor = (asset: LocalAssetReference): React.JSX.Element => {
    const actions: React.JSX.Element[] = [];
    if (isPreviewable(asset)) {
      actions.push(
        <ControlIconButton
          key="preview"
          label={uiCopy.panels.assetCard.preview}
          onClick={() => openPreview(asset)}
        >
          <Glyph icon={VISIBLE_GLYPH} size={13} />
        </ControlIconButton>,
      );
    }
    if (asset.kind === "image" || asset.kind === "svg") {
      actions.push(
        <ControlIconButton
          key="place"
          label={uiCopy.assets.placeOnCanvas}
          onClick={() => void submit(() => place(asset))}
        >
          <Glyph icon={PLACE_ON_CANVAS_GLYPH} size={13} />
        </ControlIconButton>,
      );
    }
    if (asset.kind !== "font") {
      actions.push(
        <ControlIconButton
          key="background"
          label={
            asset.kind === "video"
              ? uiCopy.assets.action.video
              : uiCopy.assets.action.image
          }
          disabled={onBackground === undefined}
          onClick={() => onBackground?.(asset)}
        >
          <Glyph icon={KIND_GLYPHS.image} size={13} />
        </ControlIconButton>,
      );
    }
    actions.push(
      <ControlIconButton
        key="replace"
        label={uiCopy.panels.assetCard.replace}
        data={{ "data-yunari-asset-replace": "" }}
        onClick={() => replaceInput.current?.click()}
      >
        <Glyph icon={REPLACE_ASSET_GLYPH} size={13} />
      </ControlIconButton>,
      <ControlIconButton
        key="remove"
        label={uiCopy.panels.assetCard.remove}
        data={{ "data-yunari-asset-remove": "" }}
        destructive
        onClick={() => void submit(() => remove(asset))}
      >
        <Glyph icon={DELETE_ITEM_GLYPH} size={13} />
      </ControlIconButton>,
    );
    if (asset.kind === "font") {
      actions.push(
        <ControlIconButton
          key="preset"
          label={uiCopy.panels.assetCard.createTypePreset}
          data={{ "data-yunari-font-open": "" }}
          onClick={() => openFontForm(asset)}
        >
          <Glyph icon={KIND_GLYPHS.text} size={13} />
        </ControlIconButton>,
      );
    }
    return <>{actions}</>;
  };

  const video = chosen?.kind === "video" ? chosen : undefined;
  const pending = held?.assetId === video?.id ? held : undefined;
  const pendingPreviewUrl = useHeldVideoUrl(pending?.bytes);

  return (
    <section>
      <div className="mb-[var(--space-8)] flex gap-[var(--space-6)]">
        <button
          type="button"
          data-yunari-asset-import=""
          onClick={() => {
            importIntent.current = "auto";
            importInput.current?.click();
          }}
          className="flex-1 rounded-[var(--radius-md)] border border-accent px-[var(--space-10)] py-[var(--space-6)] text-sm text-accent"
        >
          {uiCopy.panels.importFile}
        </button>
        <button
          type="button"
          data-yunari-asset-import-background=""
          disabled={onBackground === undefined}
          onClick={() => {
            importIntent.current = "background";
            importInput.current?.click();
          }}
          className="flex-1 rounded-[var(--radius-md)] border border-edge px-[var(--space-10)] py-[var(--space-6)] text-sm text-muted"
        >
          {uiCopy.panels.importAsBackground}
        </button>
        <button
          type="button"
          data-yunari-find-assets=""
          onClick={() => onFindAssets?.()}
          className="flex-1 rounded-[var(--radius-md)] border border-edge px-[var(--space-10)] py-[var(--space-6)] text-sm text-muted"
        >
          {uiCopy.file.findAssets}
        </button>
      </div>
      {/* A picked font has no card until the form's commit or cancel, so its
          form stands where the card will be rather than waiting for one. */}
      {font !== undefined && "file" in font && (
        <div className="mb-[var(--space-8)] overflow-hidden rounded-[var(--radius-md)] border border-accent bg-panel">
          <FontMetadataForm
            filename={font.file.name}
            initial={font.metadata}
            busy={fontBusy}
            onCommit={commitFont}
            onCancel={cancelFont}
          />
        </div>
      )}
      {SECTIONS.map((section) => {
        const assets = declarations.filter(
          (asset) => GROUP_OF[asset.kind] === section.id,
        );
        if (assets.length === 0) return null;
        return (
          <section key={section.id} className="mb-[var(--space-8)]">
            <h3 className="mb-[var(--space-6)] text-[10px] uppercase tracking-[0.11em] text-faint">
              {section.label}
            </h3>
            <ul className="flex flex-col gap-[var(--space-4)]">
              {assets.map((asset) => {
                const previewUrl = manager.previewUrl(asset.id);
                return (
                  <li key={asset.id}>
                    <AssetCard
                      asset={asset}
                      chosen={asset.id === chosen?.id}
                      referenced={referenced(asset.id)}
                      {...(previewUrl === undefined ? {} : { previewUrl })}
                      onChoose={() => {
                        setChosenId(asset.id);
                        // A held copy belongs to the asset it was produced for,
                        // and an open form to the card it was opened on.
                        setHeld(undefined);
                        setFont(undefined);
                        setMessage("");
                      }}
                      {...(asset.id === chosen?.id
                        ? { actions: actionsFor(asset) }
                        : {})}
                    />
                    {font !== undefined &&
                      "assetId" in font &&
                      font.assetId === asset.id && (
                        <FontMetadataForm
                          filename={assetFileName(asset)}
                          initial={font.metadata}
                          busy={fontBusy}
                          onCommit={commitFont}
                          onCancel={cancelFont}
                        />
                      )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {/* Only a video has an envelope to fit, and the envelope keeps its whole
          frame: cropping belongs to the background layer, where the author can
          pan it back. Neither control exists for a file that is not a video. */}
      {video !== undefined && (
        <div className="yunari-field-row">
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
        </div>
      )}
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
          const intent = importIntent.current;
          if (file !== undefined) void submit(() => importFile(file, intent));
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

/**
 * Mounts the pane into the shell's persistent host.
 *
 * The same shape `createNewObjectPanel` has: the shell owns the node and React
 * owns the content, and the returned `destroy` is the only path that unmounts.
 */
export function createAssetsPane(
  host: HTMLElement,
  props: AssetsPaneProps,
): { destroy(): void } {
  const node = document.createElement("div");
  host.append(node);
  const reactRoot: Root = createRoot(node);
  // Flushed, so a caller that reads the pane straight after building it sees
  // the cards rather than the empty frame before React's first commit.
  flushSync(() => reactRoot.render(<AssetsPane {...props} />));
  return {
    destroy() {
      reactRoot.unmount();
      node.remove();
    },
  };
}

/** A blob URL for the held copy, so it can be previewed before it is written.
 *  Revoked when the copy changes or the pane unmounts. */
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
      // Reached only where no background callback ran; the background sentence
      // is written on that path instead.
      return uiCopy.panels.assetDeclaredOnly;
    case "font":
      return uiCopy.panels.assetDeclaredFont;
  }
}
