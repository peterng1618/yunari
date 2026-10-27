import type { FontAssetReference } from "@yunari/renderer-core";
import { useEffect, useReducer, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { ImportOutcome } from "../../asset-finder/actions.js";
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
import { AssetCard } from "./asset-card.js";
import {
  type FontMetadata,
  FontMetadataForm,
  fontMetadataFromFilename,
} from "./font-metadata-form.js";
import {
  ImportVideoModal,
  type VideoImportStep,
} from "./import-video-modal.js";
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
  /** Told the document moved, so a reference this pane cannot see — a deleted
   *  object, a cleared background — redraws the cards. Optional, like the
   *  others, so the pane mounts where there is no document to follow. */
  readonly subscribeDocumentChange?: (listener: () => void) => () => void;
  /** Told the declarations moved, so the document's own panels re-resolve: the
   *  artboard's background media, its bytes, and the pane's title count. */
  readonly onChanged?: () => void;
  /** Opens the finder. Optional so the pane draws without a shell. */
  readonly onFindAssets?: () => void;
  /** Writes the asset as the artboard's background media — envelope state the
   *  pane cannot reach itself. */
  readonly onBackground?: (asset: LocalAssetReference) => void;
  /** The one route a picked `.mpkg` or video takes. The session prepares the
   *  bytes and declares them; the pane only opens the modal. Optional so a pane
   *  mounted without a document still draws, and a video-shaped pick then
   *  refuses rather than declaring a container the manager must not hold. */
  readonly onImportVideo?: (
    file: File,
    isPackage: boolean,
    onStep: (step: VideoImportStep) => void,
  ) => Promise<ImportOutcome>;
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

const ASSET_FILE_ACCEPT = `${ASSET_FILE_EXTENSIONS.map((ext) => `.${ext}`).join(",")},.mpkg`;
/** A replacement is a declared asset's own byte swap, so a container the import
 *  path intercepts (`.mpkg`) has no place here. */
const REPLACE_FILE_ACCEPT = ASSET_FILE_EXTENSIONS.map((ext) => `.${ext}`).join(
  ",",
);

/** The package is intercepted before the manager sees it: a `.mpkg` is a
 *  container the host reads, never a declared asset. */
function isPackageFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".mpkg");
}

function isVideoFile(file: File): boolean {
  return mimeOf(file.name)?.startsWith("video/") === true;
}

/** One card, and every declaration it stands for. A font family is one card:
 *  its weights are a choice a preset makes, not files the author picked, so
 *  importing six weights must not draw six cards. */
interface AssetRow {
  readonly key: string;
  /** The face the card's actions act on: weight 400 where the family has it. */
  readonly asset: LocalAssetReference;
  readonly ids: readonly string[];
  readonly label?: string;
  readonly detail?: string;
}

function isFace(asset: LocalAssetReference): asset is LocalAssetReference & {
  readonly family: string;
  readonly weight: string | number;
  readonly style: string;
  readonly format: string;
} {
  return "family" in asset && typeof asset.family === "string";
}

/** `font · woff2 · 400 normal · 700 normal`: what a family card holds. */
function faceDetail(faces: readonly LocalAssetReference[]): string {
  const parts = faces.flatMap((face) =>
    isFace(face) ? [`${face.weight} ${face.style}`] : [],
  );
  const format = faces
    .map((face) => (isFace(face) ? face.format : ""))
    .find((value) => value !== "");
  return [
    uiCopy.panels.assetCard.kind.font,
    ...(format === undefined ? [] : [format]),
    ...parts,
  ].join(" · ");
}

function rowsOf(assets: readonly LocalAssetReference[]): readonly AssetRow[] {
  const families = new Map<string, LocalAssetReference[]>();
  for (const asset of assets) {
    if (!isFace(asset)) continue;
    const faces = families.get(asset.family);
    if (faces === undefined) families.set(asset.family, [asset]);
    else faces.push(asset);
  }
  const seen = new Set<string>();
  const rows: AssetRow[] = [];
  for (const asset of assets) {
    if (!isFace(asset)) {
      rows.push({ key: asset.id, asset, ids: [asset.id] });
      continue;
    }
    // A family's card sits where its first face was declared.
    if (seen.has(asset.family)) continue;
    seen.add(asset.family);
    const faces = families.get(asset.family) ?? [asset];
    const lead =
      faces.find(
        (face) =>
          isFace(face) &&
          Number(face.weight) === 400 &&
          face.style === "normal",
      ) ?? faces[0]!;
    rows.push({
      key: `font:${asset.family}`,
      asset: lead,
      ids: faces.map((face) => face.id),
      label: asset.family,
      detail: faceDetail(faces),
    });
  }
  return rows;
}

export function AssetsPane({
  manager,
  editor,
  isReferenced,
  subscribeDocumentChange,
  onChanged,
  onFindAssets,
  onBackground,
  onFontCommit,
  onImportVideo,
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
  /** The pick the modal is running: a video or package the host prepares before
   *  anything is declared. */
  const [videoImport, setVideoImport] = useState<
    { readonly file: File; readonly package: boolean } | undefined
  >();
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
  // Hidden panes are never unmounted, so reachability is re-read on the two
  // things that move it without touching a declaration: a document write (an
  // undo, a cleared background) and the canvas itself. Reading once at mount is
  // what left a deleted object's asset reading In use forever.
  useEffect(
    () => subscribeDocumentChange?.(render),
    [subscribeDocumentChange, render],
  );
  useEffect(() => {
    const canvas = editor.canvas;
    if (typeof canvas.on !== "function") return;
    canvas.on("object:added", render);
    canvas.on("object:removed", render);
    return () => {
      canvas.off("object:added", render);
      canvas.off("object:removed", render);
    };
  }, [editor, render]);

  const declarations = manager.declarations;
  const chosen =
    declarations.find((asset) => asset.id === chosenId) ?? declarations[0];
  // Read live at every call: a render's object list is a snapshot, and Remove
  // is decided by what the scene and the document hold at the press.
  const referenced = (assetId: string): boolean =>
    assetReferencedBy(editor.canvas.getObjects(), assetId) ||
    isReferenced?.(assetId) === true;

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
   * Takes the one automatic placement a file's kind makes unambiguous: a
   * picture is placed, a font opens its metadata form, and a video or package
   * waits on the import modal — nothing is declared at the pick, so a file the
   * author walks away from leaves no declaration.
   *
   * `background` is the author overriding that choice: an image is forced into
   * background media, and a font is refused before the manager declares it, so
   * no control leaves a file the author asked not to import.
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
    // A package or a video crosses the host before anything is declared, so both
    // open the one modal rather than reaching the manager with a container it
    // must refuse (a `.mpkg`) or bytes the publish envelope cannot take.
    if (isPackageFile(file) || isVideoFile(file)) {
      if (onImportVideo === undefined) {
        refuse(new Error("No video import route is wired."));
        return;
      }
      setVideoImport({ file, package: isPackageFile(file) });
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
    if (intent === "background") {
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

  /** The modal's run: the session owns the host call and the declaration, and a
   *  success is the background write a picked video makes. */
  const runVideoImport = async (
    file: File,
    isVideoPackage: boolean,
    onStep: (step: VideoImportStep) => void,
  ): Promise<ImportOutcome> => {
    if (onImportVideo === undefined) {
      return { ok: false, message: uiCopy.panels.assetImportFailed };
    }
    const outcome = await onImportVideo(file, isVideoPackage, onStep);
    if (outcome.ok) setMessage(uiCopy.panels.assetBackgroundSet);
    return outcome;
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

  const remove = async (
    asset: LocalAssetReference,
    ids: readonly string[] = [asset.id],
  ): Promise<void> => {
    if (ids.some((id) => referenced(id))) {
      setMessage(uiCopy.panels.assetReferenced);
      return;
    }
    let removed = false;
    for (const id of ids) {
      removed = manager.remove(id) || removed;
    }
    if (removed) {
      setMessage("");
      setChosenId(undefined);
      onChanged?.();
      return;
    }
    // The declaration was not there to remove — a row drawn from a list the
    // manager has already moved would otherwise press onto nothing.
    setMessage(uiCopy.panels.assetRemoveFailed);
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
  const actionsFor = (
    asset: LocalAssetReference,
    ids: readonly string[] = [asset.id],
  ): React.JSX.Element => {
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
        onClick={() => void submit(() => remove(asset, ids))}
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
              {rowsOf(assets).map((row) => {
                const asset = row.asset;
                const previewUrl = manager.previewUrl(asset.id);
                const rowChosen =
                  chosen !== undefined && row.ids.includes(chosen.id);
                return (
                  <li key={row.key}>
                    <AssetCard
                      asset={asset}
                      chosen={rowChosen}
                      referenced={row.ids.some(referenced)}
                      {...(previewUrl === undefined ? {} : { previewUrl })}
                      {...(row.label === undefined ? {} : { label: row.label })}
                      {...(row.detail === undefined
                        ? {}
                        : { detail: row.detail })}
                      onChoose={() => {
                        setChosenId(asset.id);
                        // An open form belongs to the card it was opened on.
                        setFont(undefined);
                        setMessage("");
                      }}
                      {...(rowChosen
                        ? { actions: actionsFor(asset, row.ids) }
                        : {})}
                    />
                    {font !== undefined &&
                      "assetId" in font &&
                      row.ids.includes(font.assetId) && (
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
      {videoImport !== undefined && (
        <ImportVideoModal
          file={videoImport.file}
          package={videoImport.package}
          onRun={(onStep) =>
            runVideoImport(videoImport.file, videoImport.package, onStep)
          }
          onClose={() => setVideoImport(undefined)}
        />
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
        accept={REPLACE_FILE_ACCEPT}
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
      // A video is the modal's now, which names its own outcome; the arm stays
      // so the switch remains total over the manager's kinds.
      return uiCopy.panels.assetDeclaredOnly;
    case "font":
      return uiCopy.panels.assetDeclaredFont;
  }
}
