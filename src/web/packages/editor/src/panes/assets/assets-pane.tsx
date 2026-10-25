import { useReducer, useRef, useState } from "react";
import {
  ASSET_FILE_EXTENSIONS,
  type AssetManager,
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
import { uiCopy } from "../../ui-copy.js";
import { AssetCard, assetFileName } from "./asset-card.js";

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
  /** Opens the finder. Optional so the pane draws without a shell. */
  readonly onFindAssets?: () => void;
  /** Opens the asset preview. */
  readonly onPreview?: (asset: LocalAssetReference) => void;
  /** Writes the asset as the artboard's background media — envelope state the
   *  pane cannot reach itself. */
  readonly onBackground?: (asset: LocalAssetReference) => void;
  /** Creates a type preset from a declared face; the preset library owns the
   *  write. */
  readonly onCreatePreset?: (asset: LocalAssetReference) => void;
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
  onFindAssets,
  onPreview,
  onBackground,
  onCreatePreset,
}: AssetsPaneProps): React.JSX.Element {
  const importInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [chosenId, setChosenId] = useState<string | undefined>(
    () => manager.declarations[0]?.id,
  );
  const [message, setMessage] = useState("");
  // The manager's declarations are live external state, so a mutation is
  // followed by a render rather than by a state copy that could go stale.
  const [, render] = useReducer((count: number) => count + 1, 0);

  const declarations = manager.declarations;
  const chosen =
    declarations.find((asset) => asset.id === chosenId) ?? declarations[0];
  const objects = editor.canvas.getObjects();
  const referenced = (assetId: string): boolean =>
    assetReferencedBy(objects, assetId) || isReferenced?.(assetId) === true;

  /** The manager's or the error surface's own refusal, told in words. */
  const refuse = (error: unknown): void => {
    setMessage(uiCopy.panels.assetImportFailed);
    editor.errorManager.error("image", uiCopy.panels.assetImportFailed, error);
  };

  const importFile = async (file: File): Promise<void> => {
    try {
      await manager.import(file);
    } catch (error) {
      // The manager validates before it mutates, so a refusal leaves the
      // package and the document exactly as they were.
      refuse(error);
      return;
    }
    setMessage("");
    render();
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
    render();
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
    render();
  };

  const remove = (asset: LocalAssetReference): void => {
    if (referenced(asset.id)) {
      setMessage(uiCopy.panels.assetReferenced);
      return;
    }
    if (manager.remove(asset.id)) {
      setMessage("");
      setChosenId(undefined);
      render();
    }
  };

  /** The actions a chosen card draws. The two canvas writes are absent where
   *  the kind cannot perform them; Create type preset is a face's own. */
  const actionsFor = (asset: LocalAssetReference): React.JSX.Element => {
    const actions: React.JSX.Element[] = [
      <ControlIconButton
        key="preview"
        label={uiCopy.panels.assetCard.preview}
        onClick={() => onPreview?.(asset)}
      >
        <Glyph icon={VISIBLE_GLYPH} size={13} />
      </ControlIconButton>,
    ];
    if (asset.kind === "image" || asset.kind === "svg") {
      actions.push(
        <ControlIconButton
          key="place"
          label={uiCopy.assets.placeOnCanvas}
          onClick={() => void place(asset)}
        >
          <Glyph icon={PLACE_ON_CANVAS_GLYPH} size={13} />
        </ControlIconButton>,
      );
    }
    if (asset.kind !== "font") {
      actions.push(
        <ControlIconButton
          key="background"
          label={uiCopy.assets.action.image}
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
        onClick={() => remove(asset)}
      >
        <Glyph icon={DELETE_ITEM_GLYPH} size={13} />
      </ControlIconButton>,
    );
    if (asset.kind === "font") {
      actions.push(
        <ControlIconButton
          key="preset"
          label={uiCopy.panels.assetCard.createTypePreset}
          onClick={() => onCreatePreset?.(asset)}
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
          onClick={() => importInput.current?.click()}
          className="flex-1 rounded-[var(--radius-md)] border border-accent px-[var(--space-10)] py-[var(--space-6)] text-sm text-accent"
        >
          {uiCopy.panels.importFile}
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
              {assets.map((asset) => (
                <li key={asset.id}>
                  <AssetCard
                    asset={asset}
                    chosen={asset.id === chosen?.id}
                    referenced={referenced(asset.id)}
                    onChoose={() => {
                      setChosenId(asset.id);
                      setMessage("");
                    }}
                    {...(asset.id === chosen?.id
                      ? { actions: actionsFor(asset) }
                      : {})}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
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
          if (file !== undefined) void importFile(file);
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
          if (file !== undefined) void replaceFile(file);
        }}
      />
    </section>
  );
}
