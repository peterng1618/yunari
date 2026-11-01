import { ActiveSelection, type FabricObject } from "fabric/es";
import {
  type CanvasNudge,
  createCanvasNudge,
  stepFor,
} from "./canvas-nudge.js";
import type { EditorDocument } from "./editor-document.js";
import type { EditorSessionOptions } from "./editor-session-options.js";
import type { ShortcutManager } from "./shortcut-manager/index.js";

/**
 * Registers every chord the session dispatches and returns the nudge owner the
 * chord handlers share.
 *
 * Registered here rather than in `PRODUCT_SHORTCUTS` where a chord is
 * context-only — no menu or tooltip displays "Escape". The handler reaches the
 * same owner the matching control does, so a chord never becomes a second
 * implementation of a command.
 */
export function registerSessionShortcuts(deps: {
  readonly shortcuts: ShortcutManager;
  readonly options: EditorSessionOptions;
  readonly document: EditorDocument;
}): CanvasNudge {
  const { shortcuts, options, document } = deps;
  const editor = options.shell.editor;
  const canvas = editor.canvas;

  const nudge = createCanvasNudge({
    canvas,
    history: editor.historyManager,
  });

  shortcuts.register("file.save", () => {
    // Save, not export: the library is where the product stores a theme, and
    // Ctrl+S must not download a package. The package save stays its own File
    // row, with no chord.
    void document.saveLibrary();
  });
  // The File menu's row carries this chord, and the row reads *Import
  // package*: the chord does what the control it is printed beside does.
  shortcuts.register("file.open", () => {
    options.onImportPackage?.();
  });
  shortcuts.register("file.new", () => {
    void document.newDocument();
  });
  shortcuts.register("file.findAssets", () => {
    options.onFindAssets?.();
  });
  shortcuts.register("edit.undo", () => {
    // First: a burst's entry is not recorded until it closes, so an undo
    // inside the idle window would find nothing to step back to.
    nudge.endBurst();
    void editor.historyManager.undo();
  });
  shortcuts.register("edit.redo", () => {
    nudge.endBurst();
    void editor.historyManager.redo();
  });
  shortcuts.register("edit.delete", () => {
    editor.deletionManager.deleteActive();
  });
  shortcuts.register("edit.copy", () => {
    void editor.clipboardManager.copy();
  });
  shortcuts.register("edit.cut", () => {
    void editor.clipboardManager.cut();
  });
  shortcuts.register("edit.duplicate", () => {
    void editor.clipboardManager.duplicate();
  });
  shortcuts.register("edit.group", () => {
    editor.groupingManager.group();
  });
  shortcuts.register("edit.ungroup", () => {
    editor.groupingManager.ungroup();
  });
  // Context-only, so it is registered here rather than in `PRODUCT_SHORTCUTS`:
  // no menu or tooltip displays "Escape".
  shortcuts.register("view.exit-group", () => {
    editor.groupingManager.exitGroup();
  });
  // The `?` reference. The manager dispatches; the sheet is chrome and lives
  // in the shell, so the gesture leaves through the session's own callback.
  shortcuts.register("help.shortcuts", () => {
    options.onShowShortcuts?.();
  });
  // The header prints this chord beside the publish control, so it does what
  // that control does — opens the surface — and nothing of its own. The host
  // is moved only by the switch inside the surface.
  shortcuts.register("publish.surface", () => {
    options.onPublishSurface?.();
  });
  shortcuts.register("canvas.front", () => {
    editor.layerManager.bringToFront();
  });
  shortcuts.register("canvas.back", () => {
    editor.layerManager.sendToBack();
  });

  // The theme's full-artboard background rect is `selectable: false`, but it
  // *is* returned by `getObjects()`. Selecting it would let the next nudge or
  // drag move the background off the artboard, so it is filtered out here.
  // Locked objects are selectable now, so this filter no longer excludes
  // them; `object-lock-manager` owns that, dropping locked members from a
  // selection once it exists. Snapping makes the opposite call — a locked
  // object *is* alignable against — so this filter is deliberately stricter
  // than `snap-manager`'s.
  const selectableObjects = (): FabricObject[] =>
    canvas.getObjects().filter((object) => object.selectable === true);

  shortcuts.register("canvas.select-all", () => {
    const objects = selectableObjects();
    // An `ActiveSelection` of one object is not a selection.
    if (objects.length < 2) return;
    canvas.discardActiveObject();
    canvas.setActiveObject(new ActiveSelection(objects, { canvas }));
    canvas.requestRenderAll();
  });

  // Four literal registrations, not a loop over a key map: `ProductShortcutId`
  // is a closed union and a template literal is not assignable to it without a
  // cast.
  shortcuts.register("canvas.nudge-left", (event) => {
    nudge.nudgeBy(-stepFor(event), 0);
  });
  shortcuts.register("canvas.nudge-right", (event) => {
    nudge.nudgeBy(stepFor(event), 0);
  });
  shortcuts.register("canvas.nudge-up", (event) => {
    nudge.nudgeBy(0, -stepFor(event));
  });
  shortcuts.register("canvas.nudge-down", (event) => {
    nudge.nudgeBy(0, stepFor(event));
  });

  return nudge;
}
