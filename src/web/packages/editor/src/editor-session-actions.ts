import type { FontCut } from "@yunari/renderer-core";
import { applyArrange, canArrange } from "./arrange.js";
import {
  applyPreset,
  creditOf,
  importFinderResult,
} from "./asset-finder/actions.js";
import { assetBytes } from "./asset-finder/client.js";
import type { FontActions } from "./asset-finder/fonts.js";
import {
  iconObject,
  iconShapes,
  placeIcon,
} from "./asset-finder/icon-shape.js";
import type { WallpaperActions } from "./asset-finder/wallpaper.js";
import { type AssetManager, mimeOf } from "./asset-manager/index.js";
import type { ChartManager } from "./chart-manager/index.js";
import type { EditorDocument } from "./editor-document.js";
import type { EditorSessionOptions } from "./editor-session-options.js";
import {
  importPickedVideo,
  importWallpaperItem,
  type VideoImportHost,
} from "./editor-session-video.js";
import type { EditorActionFacade } from "./editor-shell/session-facade.js";
import { newInk } from "./new-object-defaults.js";
import { constructing, insertNewShape } from "./new-object-panel.js";
import type { TypeTokens } from "./type-preset-manager/index.js";
import { uiCopy } from "./ui-copy.js";
import { startProject } from "./wallpaper-engine/client.js";

/** How much of the artboard's shorter edge an imported icon takes. An SVG's
 *  viewBox is its own unit (24 for Lucide, 512 for Font Awesome), so its size
 *  says nothing about the frame it lands on; this is the one share every
 *  imported icon gets, which also makes two sources' glyphs comparable. */
const IMPORTED_ICON_SHARE = 0.12;

/** The owners a shell action reaches, all of them the session's own. */
export interface ActionFacadeHost {
  readonly options: EditorSessionOptions;
  readonly document: EditorDocument;
  readonly assets: AssetManager;
  readonly charts: ChartManager;
  readonly video: VideoImportHost;
  readonly declarationsChanged: () => void;
  /** Arms the one text placement the Add pane and this facade share. */
  readonly armText: () => void;
}

/**
 * The finder's Fonts pane actions. Every action is the document's write; the
 * footer only reports a press. Apply to selected token travels only when a
 * store names a type token, because the footer draws that action on the
 * callback's presence (R9). The inspector's token wins, else the shell's
 * canvas projection; a paint is not a type target. Read when the pane is
 * built and closed over until the next build: safe because the finder is
 * modal and nothing can move either store while it is open — a non-modal
 * finder would need the read moved into the action.
 */
function fontActions(host: ActionFacadeHost): FontActions {
  const { document, options } = host;
  const presets = document.envelope.globals?.typeTokens as
    | TypeTokens
    | undefined;
  const token = options.tokenSelection?.get();
  const selected =
    token?.kind === "preset"
      ? token.id
      : options.selection?.get().selectionPresetId;
  const favorites = options.favoritesClient;
  const run = (action: () => Promise<unknown>): void => {
    void document.runFontAction(async () => {
      await action();
      // An adopted face is a declaration, so the Assets count and the
      // background column re-resolve as they do after an import.
      host.declarationsChanged();
    });
  };
  return {
    ...(presets === undefined ? {} : { presets }),
    onApplyTrio: (trio) => {
      run(() => document.applyFontTrio(trio));
    },
    onAddTrioPresets: (trio) => {
      run(() => document.addTypeTokensFromTrio(trio));
    },
    onAddPreset: (cut, role, family) => {
      run(() => document.addTypeTokenFromCut(cut, role, family));
    },
    ...(selected === undefined
      ? {}
      : {
          onApplyToSelected: (cut: FontCut, family: readonly FontCut[]) => {
            run(() => document.applyCutToPreset(selected, cut, family));
          },
        }),
    // A host that keeps no favourites store answers 404; the client reads
    // that as no favourites, so the pane draws no star rather than failing.
    ...(favorites === undefined
      ? {}
      : {
          listFavorites: () => favorites.list(),
          saveFavorites: (ids: readonly string[]) => favorites.save(ids),
        }),
  };
}

/**
 * The finder's Wallpaper Engine pane actions: one write per card kind, plus
 * the `.mpkg` import. The pane owns the listing and the card states; each
 * callback here is the session's existing import or project route.
 */
function wallpaperActions(host: ActionFacadeHost): WallpaperActions {
  return {
    onSetBackground: (item, trim) =>
      importWallpaperItem(host.video, item, trim),
    onConvert: (item) => startProject(item.workshopId),
    onImportPackage: (file, onStep) =>
      importPickedVideo(host.video, file, { package: true, onStep }),
  };
}

/** The shell's header one reachability surface, built from the session's owners:
 *  the File and View menus and the theme toolbar all dispatch through it. */
export function buildActionFacade(host: ActionFacadeHost): EditorActionFacade {
  const { options, document, assets, charts } = host;
  const editor = options.shell.editor;
  return {
    newDocument: () => document.newDocument(),
    newFromStarter: () => document.newFromStarter(),
    // The picker, and nothing of the document's: an import lands in the
    // library while whatever is open stays open.
    importPackage: () => options.onImportPackage?.(),
    downloadPackage: () => document.save(),
    exportTheme: () => document.release(),
    activate: () => document.activateTheme(),
    openLibrary: () => document.openLibrary(),
    // The finder's Fonts body, wired to the document's writes. The panel is
    // presentational: every refusal reaches the author through
    // `runFontAction`, and the selection-to-preset projection is the shell's.
    fontActions: () => fontActions(host),
    // The finder's Wallpaper Engine pane: the listing is the pane's own fetch
    // — it is a library, not a search — so the session owns only the writes a
    // card triggers: a video's background, a scene's local project, and a
    // picked `.mpkg` through the same one-call import the Assets pane uses.
    wallpaperActions: () => wallpaperActions(host),
    // One finder row's action. The bytes come from the host, the manager
    // keeps its caps and sanitising, and the credit is written before the
    // asset's own consequence runs — an import that places nothing still
    // carries its attribution.
    importAsset: async (page, result, placement) => {
      // A preset is editor-local data, not an asset: no bytes, no credit.
      const preset = result.preset;
      if (preset !== undefined) return applyPreset({ ...result, preset });

      const fetched = await assetBytes(page.source, result.id);
      if (fetched === undefined)
        return {
          ok: false as const,
          message: uiCopy.assets.bytesUnavailable(result.name),
        };

      // An icon is authored as geometry, not as a picture: the starter theme's
      // icons are paths for the same reason — a path takes the theme's ink, a
      // stroke width and a shadow, and an SVG image takes none of them.
      if (result.kind === "icon") {
        const credit = creditOf(result);
        if (!document.canAddCredit(credit))
          return { ok: false as const, message: uiCopy.assets.creditsFull };

        try {
          const artboard = document.envelope.artboard;
          const ink = newInk(document.envelope.globals);
          const shapes = await iconShapes(
            new TextDecoder().decode(fetched.bytes),
            ink,
          );
          if (shapes.length === 0)
            return { ok: false as const, message: uiCopy.assets.emptyIcon };

          const placed = iconObject(
            shapes,
            result.name,
            `icon-${crypto.randomUUID()}`,
          );
          placeIcon(placed, artboard, IMPORTED_ICON_SHARE);
          document.addCredit(credit);
          editor.canvas.add(placed);
          editor.canvas.setActiveObject(placed);
          editor.historyManager.saveState();
          editor.canvas.requestRenderAll();
          return { ok: true as const };
        } catch (error) {
          // A glyph the parser refuses, or a theme with no palette to paint
          // it: the author gets the reason in the dialog, not a dead button.
          return {
            ok: false as const,
            message: error instanceof Error ? error.message : String(error),
          };
        }
      }

      const file = new File(
        [fetched.bytes as unknown as BlobPart],
        fetched.filename,
        { type: mimeOf(fetched.filename) ?? "" },
      );
      const outcome = await importFinderResult({
        page,
        result,
        bytes: fetched.bytes,
        filename: fetched.filename,
        manager: assets,
        document,
        place: (assetId) => {
          // An image lands in the theme's background unless the author asked
          // for the canvas, which is the second press the finder offers.
          if (result.kind === "image" && placement !== "place") {
            // The background is a layer now, and its media carries the box it
            // fills. A newly placed picture keeps the box it was fitted to and
            // starts unmirrored and centred.
            const background = document.envelope.background;
            document.setBackground({
              ...background,
              media: {
                assetId,
                bounds: background?.media?.bounds ?? "theme",
              },
            });
            return;
          }
          // Every other declared picture is placed through the Add pane's own
          // path: `placeImage` takes the declaration this import just made, so
          // the file is not imported twice. (An icon never reaches here — it
          // is authored as geometry above.)
          const declared = assets.declarations.find(
            (entry) => entry.id === assetId,
          );
          if (declared !== undefined) {
            void assets
              .placeImage(editor, file, declared)
              .catch((error: unknown) =>
                options.onError?.(
                  error instanceof Error ? error.message : String(error),
                ),
              );
          }
        },
      });
      if (outcome.ok === true) {
        // A finder import makes a declaration just as the Assets pane's own
        // file does, so the pane's title and the background column re-resolve.
        host.declarationsChanged();
      }
      return outcome.ok
        ? { ok: true as const }
        : { ok: false as const, message: outcome.message };
    },
    openLibraryTheme: (id, onAccepted) =>
      document.openLibraryTheme(id, onAccepted),
    saveLibrary: () => document.saveLibrary(),
    openRecent: () => document.openRecentLibrary(),
    saveAs: () => document.saveLibraryAs(),
    // The constructions the shell dispatches are wrapped in the one owner of
    // a construction's refusal (`new-object-panel.ts`), because the surfaces
    // that reach them — the layer footer through `bridge.run`, and the canvas
    // context menu through `creationGroups` — both hold a `void` and cannot
    // report a throw themselves (`vg-484`). `addText` arms rather than
    // constructs now, so its refusal is reported at the gesture's end by
    // `armText`. `insertCard` is not wrapped: the document reports that one
    // at its own owner.
    addText: () => host.armText(),
    // A non-text construction is another tool: the armed text placement is
    // cancelled first, or the next canvas press would place a text instead of
    // selecting what was just made.
    addShape: (kind) =>
      constructing(editor, () => {
        editor.textManager.cancelPlacement();
        insertNewShape(editor, document.envelope.globals, kind);
      }),
    addChart: (family) =>
      constructing(editor, () => {
        editor.textManager.cancelPlacement();
        charts.addChart(family);
      }),
    insertCard: (cardId) => {
      editor.textManager.cancelPlacement();
      document.insertCard(cardId);
    },
    outlineText: () => document.outlineText(),
    arrange: (action) => applyArrange(editor, action),
    canArrange: (action) => canArrange(editor, action),
    undo: () => void editor.historyManager.undo(),
    redo: () => void editor.historyManager.redo(),
    copy: () => void editor.clipboardManager.copy(),
    cut: () => void editor.clipboardManager.cut(),
    deleteActive: () => void editor.deletionManager.deleteActive(),
    duplicate: () => void editor.clipboardManager.duplicate(),
    group: () => editor.groupingManager.group(),
    ungroup: () => editor.groupingManager.ungroup(),
    isDirty: () => document.isDirty(),
    publishableDocument: () => {
      // A document with no stored base has no folder, and a published
      // document's assets are served from the theme's own folder — so a
      // display given one would render a theme with holes. The base's own
      // `id` is a content hash of the stored document, not the folder it
      // lives in, so the id published under is the document's.
      if (!document.isStored()) return undefined;
      const envelope = document.snapshot();
      return { id: envelope.id, envelope };
    },
    subscribeDocumentChange: (listener) =>
      document.subscribeDocumentChange(listener),
  };
}
