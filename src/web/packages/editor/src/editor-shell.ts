import {
  type Artboard,
  type AssetReference,
  type Background,
  cropsToDisc,
  cssArtboardPaint,
  cssArtboardPaintMapped,
  type FabricThemeEnvelope,
  type FabricThemeEnvelopeInput,
  type Globals,
  readFabricThemeEnvelope,
  resolveStyleValue,
  type ScenePlan,
  validateFabricThemeEnvelope,
} from "@yunari/renderer-core";
import {
  applyObjectPalettePaints,
  applyObjectTypeTokens,
  artboardBackdrop,
  artboardPaintKey,
  type BackdropFit,
  type BackdropMedia,
  type BackgroundMediaHandle,
  type BackgroundMediaSource,
  createGlass,
  createSceneAdapter,
  disposeScene,
  fabricArtboardPaint,
  mountBackgroundMedia,
  reviveScene,
  reviveThemeEnvelope,
  type SceneAdapter,
  sceneObjects,
  serialiseScene,
  serialiseThemeEnvelope,
} from "@yunari/scene-fabric";
import {
  ActiveSelection,
  type ActiveSelectionOptions,
  Canvas,
  Circle,
  classRegistry,
  type FabricObject,
  Point,
  Rect,
} from "fabric/es";
import { createClipboardManager } from "./clipboard-manager/index.js";
import { applyEditorControls } from "./controls-manager/index.js";
import { canCrop, createCropManager } from "./crop-manager/index.js";
import { createDeletionManager } from "./deletion-manager/index.js";
import { lensBox, resolveLens } from "./display-lens.js";
import type { EditorInteraction } from "./editor-interaction.js";
import { createErrorManager } from "./error-manager/index.js";
import { createGroupingManager } from "./grouping-manager/index.js";
import { EditorHistory } from "./history-manager/index.js";
import { createImageManager } from "./image-manager/index.js";
import { createLayerManager } from "./layer-manager/index.js";
import { createObjectLockManager } from "./object-lock-manager/index.js";
import { createTextManager } from "./text-manager/index.js";
import {
  createViewportManager,
  type ViewportManager,
} from "./viewport-manager/index.js";
import { bindViewportNavigation } from "./viewport-manager/navigation.js";

export interface EditorShellOptions {
  readonly host: HTMLElement;
  readonly artboard: Artboard;
  readonly plan?: ScenePlan;
  /** A validated v2 document revives directly into the interactive canvas. */
  readonly envelope?: FabricThemeEnvelope;
  readonly assets?: readonly AssetReference[];
  readonly resolveAsset?: (
    assetId: string,
  ) => BackgroundMediaSource | undefined;
  /**
   * Resolves a scene object's own `yunariAsset` reference, for the revival
   * that happens here — before a session exists to own the bytes.
   *
   * Separate from `resolveAsset` because the lifetimes differ: a media source
   * is handed over with a disposer and is revoked when the layer unmounts,
   * while this URL has to outlive the load it was used for and is owned by
   * whoever holds the asset manager.
   */
  readonly resolveSceneAsset?: (assetId: string) => string | undefined;
}

export interface EditorShell {
  readonly editor: EditorInteraction;
  /** The camera over the mounted canvas, for readouts and view controls. */
  readonly viewport: ViewportManager;
  readonly scene?: SceneAdapter;
  snapshot(input: FabricThemeEnvelopeInput): FabricThemeEnvelope;
  /**
   * Re-resolves the glass lifecycle. The handle this shell owns re-resolves on
   * its own when the canvas gains or loses an object; an authored treatment
   * written on a panel that is already there is neither, so the control that
   * writes it asks for this.
   */
  refreshGlass(): void;
  setArtboard(artboard: Artboard): void;
  /**
   * The background layer moves. Its colour repaints the letterbox and the
   * plate, its media re-places (or remounts, when the asset changed) — the scene
   * itself is untouched, because the layer is a DOM sibling rather than a scene
   * object.
   */
  setBackground(background: Background | undefined): void;
  setBackgroundMedia(
    assets: readonly AssetReference[],
    resolveAsset: (assetId: string) => BackgroundMediaSource | undefined,
  ): void;
  /** Whether the document's background is a video, which is the only media the
   *  playback control has anything to pause. */
  backgroundVideo(): boolean;
  /** Whether a video background is currently playing. A scene with no video
   *  background reports `false`; the control is not drawn there. */
  backgroundPlaying(): boolean;
  /** Pauses or resumes a video background. Transient view state: it is never
   *  written to the document, and an image background ignores it. */
  setBackgroundPlaying(playing: boolean): void;
  /** Notifies when the background's kind or playback state changes, for the
   *  control that projects both. */
  onBackgroundPlaybackChange(listener: () => void): () => void;
  setGlobals(globals: Globals | undefined): void;
  setFitMode(): void;
  /**
   * The artboard's background media, for the capture path. The layer is a DOM
   * sibling the canvas cannot see, so the only thing that can put it in a
   * picture is something holding the handle.
   *
   * `fit` answers the question the caller is asking: `"authored"` is the layer
   * this display is showing, and `"theme"` is the same picture placed on the
   * artboard alone. A stored picture is of the theme, so every capture asks for
   * `"theme"` — a thumbnail must not depend on which display happened to be
   * previewed when it was taken.
   */
  backdrop(fit?: BackdropFit): BackdropMedia | undefined;
  destroy(): void;
}

/**
 * Bindings whose object is no longer in the scene, dropped.
 *
 * A binding is keyed by its object's id, so deleting the object leaves a key
 * that names something the scene no longer has — and `serialiseThemeEnvelope`
 * then produces a document the validator refuses, so **every later save in that
 * session throws** and the author is told nothing. The Starter binds 25 of its
 * 52 objects, so deleting one sensor readout disarms saving for good while the
 * row looks like it simply vanished.
 *
 * Dropping them here rather than at each delete path is deliberate: the keyboard,
 * the layer list, the context menu, undo and any future path all arrive at
 * `snapshot`, so this cannot be the one that was forgotten. A binding is
 * meaningless without its object, so nothing is lost that the document could
 * still use — and an author who re-adds an object with that id gets its reading
 * back, which is the only thing a saved binding was ever for.
 */
function dropDanglingBindings(
  canvas: Canvas,
  input: FabricThemeEnvelopeInput,
): FabricThemeEnvelopeInput {
  const bindings = input.bindings;
  if (bindings === undefined) return input;
  // Through groups: a binding is keyed by the id of the object that reads it,
  // and the starter's cards are groups, so a walk that stops at the canvas
  // would declare every reading inside a card dangling and strip it on the
  // first save. `sceneObjects` owns that depth rule, so this cannot re-spell it.
  const live = new Set<string>();
  for (const object of sceneObjects(canvas.getObjects())) {
    const id = object.get("id");
    if (typeof id === "string") live.add(id);
  }
  const kept = Object.entries(bindings).filter(([id]) => live.has(id));
  if (kept.length === Object.keys(bindings).length) return input;
  return { ...input, bindings: Object.fromEntries(kept) };
}

const EDITOR_CONTAINER_ID = "yunari-fabric-editor";
let nextEditorContainer = 1;

/** Last resolved artboard paint and clip per mounted shell; both are only
 * rebuilt when their paint or their size changes. */
interface PaintMemo {
  background: string | undefined;
  clip: string | undefined;
}

class SelectionOrderedActiveSelection extends ActiveSelection {
  constructor(
    objects: FabricObject[] = [],
    options: Partial<ActiveSelectionOptions> = {},
  ) {
    super(objects, { ...options, multiSelectionStacking: "selection-order" });
  }
}

classRegistry.setClass(SelectionOrderedActiveSelection, "ActiveSelection");

/** The artboard plate: a bounded region of the canvas, so the pasteboard stays
 * visible around it. `canvas.backgroundColor` cannot do this — Fabric fills it
 * as one path and the viewport transform never bounds that fill — and a
 * `clipPath` would hide the objects outside the artboard too. */
function artboardPlate(artboard: Artboard, background: unknown): Rect {
  return new Rect({
    width: artboard.width,
    height: artboard.height,
    left: 0,
    top: 0,
    originX: "left",
    originY: "top",
    fill:
      fabricArtboardPaint(background, artboard.width, artboard.height) ?? "",
    selectable: false,
    evented: false,
    hasControls: false,
    hasBorders: false,
    // The authored paint belongs to the envelope's artboard, so the scene must
    // not carry a second copy of it.
    excludeFromExport: true,
  });
}

/** The artboard clip: the boundary the object layer is cut to, so what the
 * editor shows is what the display shows.
 *
 * Fabric's `clipPath` on the *canvas* is scene-level and is not a per-object
 * property, which is what `vg-046` requires of a repair here: the crop
 * manager's authored image clip and the derived text-box clip are both
 * `FabricObject.clipPath` and neither is read, replaced or serialised by this,
 * and `canvas.getObjects()` still returns the scene root itself rather than a
 * wrapper group. `absolutePositioned` puts the rect in artboard units, so the
 * camera's zoom and pan clip at the board's edge rather than at the canvas'.
 *
 * `excludeFromExport` keeps it out of the persisted document, on the same
 * reasoning as the plate: the boundary belongs to the envelope's artboard, so
 * a scene document must not carry a second copy of it.
 *
 * `crop` is the disc a circle theme ships as under a circle lens. The square
 * artboard's corners stay in the document — they are authored, and a rect
 * preview has to show them — but the glass never draws them. */
function artboardClip(artboard: Artboard, crop: boolean): Rect | Circle {
  if (crop) {
    return new Circle({
      radius: Math.min(artboard.width, artboard.height) / 2,
      left: artboard.width / 2,
      top: artboard.height / 2,
      originX: "center",
      originY: "center",
      absolutePositioned: true,
      excludeFromExport: true,
    });
  }
  return new Rect({
    width: artboard.width,
    height: artboard.height,
    left: artboard.width / 2,
    top: artboard.height / 2,
    originX: "center",
    originY: "center",
    absolutePositioned: true,
    excludeFromExport: true,
  });
}

/** The memo key for {@link artboardClip}. The crop flag is part of it: a lens
 *  change that starts or stops cropping must not reuse the other clip. */
function artboardClipKey(artboard: Artboard, crop: boolean): string {
  return `${artboard.width}x${artboard.height}:${crop ? "circle" : "rect"}`;
}

/** Installs the boundary the canvas is cut to, if it is not already there.
 * Returns whether it wrote, so a caller that skips the full paint pass can
 * request its own render. The class is part of the guard as well as the key: an
 * undo revives the scene with whatever clip it carried. */
function syncClip(
  canvas: Canvas,
  artboard: Artboard,
  crop: boolean,
  memo: PaintMemo,
): boolean {
  const key = artboardClipKey(artboard, crop);
  const Clip = crop ? Circle : Rect;
  if (key === memo.clip && canvas.clipPath instanceof Clip) {
    return false;
  }
  memo.clip = key;
  canvas.clipPath = artboardClip(artboard, crop);
  return true;
}

/** One background paint, resolved against the document's globals. The plate and
 *  the media layer read the same value, so a token resolves once. */
function backgroundStylePaint(
  value: Parameters<typeof resolveStyleValue>[0],
  globals: Globals | undefined,
): unknown {
  const issues: Parameters<typeof resolveStyleValue>[3] = [];
  return resolveStyleValue(value, globals ?? {}, "background", issues);
}

function applyArtboardPaint(
  editor: EditorInteraction,
  artboard: Artboard,
  documentBackground: Background | undefined,
  globals: Globals | undefined,
  memo: PaintMemo,
  crop: boolean,
): unknown {
  const resolve = (value: Parameters<typeof resolveStyleValue>[0]): unknown => {
    return backgroundStylePaint(value, globals);
  };
  const paint = resolve(documentBackground?.color);
  // A gradient is rebuilt only when the paint or the board's size changes, the
  // same memo the player keeps. The plate is rebuilt whenever it is missing,
  // because `loadFromJSON` clears the canvas it lived on.
  const paintKey = `${artboardPaintKey(paint)}:${artboard.width}x${artboard.height}`;
  // **With background media declared there is no plate at all.** The
  // plate is on the canvas, which sits above the media layer, so it covers the
  // media exactly as the player's canvas fill did; the display's letterbox,
  // painted from the same resolved colour, is the board's colour instead — and
  // it is behind the layer, which is the order the reader needs.
  const wantsPlate = documentBackground?.media === undefined;
  if (!wantsPlate) {
    memo.background = undefined;
    // `delete` rather than `= undefined`: the property is optional and
    // `exactOptionalPropertyTypes` is on, and Fabric reads an absent
    // `backgroundImage` exactly as it reads an undefined one.
    if (editor.canvas.backgroundImage !== undefined) {
      delete editor.canvas.backgroundImage;
    }
  } else if (
    paintKey !== memo.background ||
    !(editor.canvas.backgroundImage instanceof Rect)
  ) {
    memo.background = paintKey;
    editor.canvas.backgroundImage = artboardPlate(artboard, paint);
  }
  // Same shape as the plate's guard: rebuilt when the board is resized, and
  // whenever it is missing, which is what `loadFromJSON` — and so every undo —
  // leaves behind. `reviveScene` restores it too, so this is the belt to that
  // braces rather than the only copy of the rule.
  syncClip(editor.canvas, artboard, crop, memo);
  // A revived envelope from before the camera carried the artboard paint here;
  // left set it would cover the pasteboard again.
  editor.canvas.backgroundColor = "";
  applyObjectPalettePaints(editor.canvas, globals);
  applyObjectTypeTokens(editor.canvas, globals);
  editor.canvas.requestRenderAll();
  // The caller keeps this: it is what the glass backdrop composes the media
  // over, and re-resolving it there would put a second owner on the paint.
  return paint;
}

/** Whether `object` is the entered group or one of its direct children. Mirrors
 * the grouping manager's own reachability rule; the manager does not publish
 * it, and the entry is a single level rather than a walk. */
function insideGroup(object: FabricObject, entry: FabricObject): boolean {
  return object === entry || object.parent === entry;
}

function createNativeEditor(input: {
  readonly container: HTMLElement;
  readonly host: HTMLElement;
  readonly artboard: () => Artboard;
  /** The same resolver the mount revives with, so undo restores an image the
   *  way opening the document did rather than dropping it. */
  readonly resolveSceneAsset?: (assetId: string) => string | undefined;
}): EditorInteraction {
  const { container, host } = input;
  applyEditorControls(() => input.artboard().height);
  const element = document.createElement("canvas");
  container.append(element);
  // The canvas takes the host's size, not the artboard's: it is a viewport onto
  // the workspace now, and the camera chooses what part of it the artboard fills.
  const canvas = new Canvas(element, {
    width: Math.max(1, host.clientWidth),
    height: Math.max(1, host.clientHeight),
    // Objects the marquee touched were swept into the selection, so a drag
    // that clipped a card's corner selected it. Selection here is a set the
    // author means to act on, and a partly covered object is ambiguous; only
    // bounds fully inside the rectangle are taken.
    selectionFullyContained: true,
    // A canvas-level `clipPath` is composited *after* `drawControls`, so a
    // handle on a partly-outside object is cut away with the rest of it. This
    // moves the controls above the clip instead — the one flag that decides
    // whether a clipped selection stays grabbable. Fabric draws both to the
    // lower canvas in 7.x; the split the flag acts on is lower vs. upper, not
    // objects vs. handles.
    controlsAboveOverlay: true,
  });
  const viewport = createViewportManager({
    canvas,
    host,
    artboard: () => input.artboard(),
  });
  const unbindNavigation = bindViewportNavigation({ canvas, viewport });
  // Before the history, because undo revives through it and a refusal raised
  // there is reported the same way a refusal raised on load is.
  const errors = createErrorManager(canvas);
  // Constructed before the history it saves through: the capture seam below
  // reads it, and the callbacks only reach the history once it exists.
  const grouping = createGroupingManager({
    canvas,
    save: () => history.save(),
    suspend: () => history.suspend(),
  });
  /** A capture reads the document, not the entered-group view state. The
   *  entry's `selectable`/`evented` flags are persisted alongside the authored
   *  ones, so every serialisation lends the manager's flags back first. */
  const captured = <T>(read: () => T): T => {
    const release = grouping.suspendReachability();
    try {
      return read();
    } finally {
      release();
    }
  };
  const history = new EditorHistory({
    canvas,
    serialize: (target) => captured(() => serialiseScene(target)),
    revive: (target, scene) =>
      reviveScene(
        target,
        scene,
        input.resolveSceneAsset,
        // Undo normalises a legacy display text exactly as the mount did, or an
        // edit would come back as a class the author cannot type into.
        { editableText: true },
      ),
  });
  history.reset();
  const save = (): void => history.save();
  const deletion = createDeletionManager(canvas, save);
  const images = createImageManager(canvas, save);
  const text = createTextManager(
    canvas,
    save,
    // The board, not the viewport: a scaled run with no authored size takes a
    // share of the frame it was authored on.
    () => input.artboard().height,
  );
  /** A completed mouse-driven move/scale/rotate needs the same history entry
   * explicit actions get; Fabric only reports it after the gesture ends.
   *
   * Registered after the text manager, whose own commit pins a scaled text's
   * run sizes and resets the scale: this save then sees that state and dedupes,
   * so a scale gesture is one entry. Registered first, it would record the
   * interim scaled state and leave the reset to a second, near-identical undo. */
  canvas.on("object:modified", save);
  const objectLockManager = createObjectLockManager(canvas, save);
  const crop = createCropManager({
    canvas,
    save,
    suspend: () => history.suspend(),
    errors,
  });

  /** Double-click enters the group the pointer resolved to, and leaves the one
   * already entered when the pointer was outside it — the same gesture both ways,
   * which is what makes the way out discoverable. Escape stays the keyboard
   * route. `text-manager` owns this event too and returns early for a non-`IText`
   * target, so a group double-click reaches here untouched rather than being
   * taken over. The scene point goes with it: Fabric resolved the group, and
   * only the manager can re-resolve the child beneath it. */
  const enterGroupOnDoubleClick = (event: {
    readonly target?: unknown;
    readonly scenePoint?: Point;
  }): void => {
    const target = event.target as FabricObject | undefined | null;
    const entered = grouping.groupContext()[0];
    // Everything outside an entered group is `evented: false`, so Fabric
    // resolves a double-click out there to nothing at all — no target *is* the
    // outside. Without this a miss was silent and only Escape could leave.
    if (
      entered !== undefined &&
      (target == null || !insideGroup(target, entered))
    ) {
      grouping.exitGroup();
      return;
    }
    if (target === undefined || target === null) return;
    // A double-click on a picture opens its crop, the gesture the selection
    // inspector's Crop control also offers. Enter commits it and Escape
    // discards it, so the canvas is the crop's own surface.
    if (canCrop(target)) {
      crop.begin(target);
      return;
    }
    grouping.enterGroup({
      object: target,
      ...(event.scenePoint === undefined
        ? {}
        : { scenePoint: event.scenePoint }),
    });
  };
  canvas.on("mouse:dblclick" as never, enterGroupOnDoubleClick as never);

  return {
    canvas,
    // The authored frame, read through so a resize is seen by whoever asks
    // next rather than frozen at mount.
    artboard: () => input.artboard(),
    viewport,
    historyManager: {
      attachEnvelope: (port) => history.attachEnvelope(port),
      saveState: save,
      resetHistory: () => history.reset(),
      undo: () => history.undo(),
      redo: () => history.redo(),
      suspend: () => history.suspend(),
    },
    textManager: text,
    imageManager: images,
    layerManager: createLayerManager(canvas, save),
    objectLockManager,
    errorManager: errors,
    cropManager: crop,
    deletionManager: deletion,
    clipboardManager: createClipboardManager({
      canvas,
      save,
      errors,
      deletion,
      importImage: (input) => images.importImage(input),
    }),
    groupingManager: grouping,
    destroy: () => {
      // Both double-click listeners outlive the canvas otherwise.
      text.destroy();
      images.destroy();
      grouping.destroy();
      objectLockManager.destroy();
      canvas.off("mouse:dblclick" as never, enterGroupOnDoubleClick as never);
      unbindNavigation();
      viewport.destroy();
      // Disposal is asynchronous; a failure here must not be an unhandled
      // rejection during teardown.
      void canvas.dispose().catch(() => undefined);
    },
  };
}

/** Mounts the native editor with Yunari's chart-resource lifecycle hook. */
export async function mountEditorShell({
  host,
  artboard,
  plan,
  envelope,
  assets,
  resolveAsset,
  resolveSceneAsset,
}: EditorShellOptions): Promise<EditorShell> {
  if (plan !== undefined && envelope !== undefined) {
    throw new Error(
      "An editor shell accepts either a scene plan or a Fabric envelope, not both.",
    );
  }
  // The migrated document is the one the shell mounts: validating the migrated
  // shape and then reviving the raw one would hand the first real N−1
  // migration a document its migration was meant to replace.
  const read =
    envelope === undefined ? undefined : readFabricThemeEnvelope(envelope);
  if (read !== undefined && !read.ok) {
    throw new Error(
      `Invalid theme: ${read.issues[0]?.message ?? "unknown validation error"}`,
    );
  }
  const opened = read?.ok === true ? read.envelope : undefined;
  const container = document.createElement("div");
  container.id = `${EDITOR_CONTAINER_ID}-${nextEditorContainer}`;
  nextEditorContainer += 1;
  /** The retired image-editor package exposed its instance as `window[containerId]`
   * for devtools/e2e access; keep that contract on the numbered id, which stays
   * stable even after the container's own `id` attribute is reset below. */
  const debugKey = container.id;
  container.style.position = "absolute";
  container.style.inset = "0";
  container.style.visibility = "hidden";
  let currentArtboard = artboard;
  let currentBackground: Background | undefined = opened?.background;
  let globals: Globals | undefined = opened?.globals;
  host.append(container);
  const paintMemo: PaintMemo = { background: undefined, clip: undefined };

  try {
    const editor = createNativeEditor({
      container,
      host,
      artboard: () => currentArtboard,
      ...(resolveSceneAsset === undefined ? {} : { resolveSceneAsset }),
    });
    (window as unknown as Record<string, unknown>)[debugKey] = editor;
    // The resolved artboard paint, kept because the glass backdrop composes it
    // under the media and re-resolving it there would be a second owner
    // of the paint. Every paint pass goes through here so it cannot go stale.
    let artboardPaint: unknown;
    /** Whether the canvas crops to the artboard's disc. The rule itself belongs
     *  to the vocabulary owner, so the clip and the preview frames that depend
     *  on it cannot drift apart. */
    const cropToDisc = (): boolean =>
      cropsToDisc(
        currentArtboard.shape ?? "rect",
        editor.viewport.displayShape() ?? "rect",
      );
    /** The display's screen, painted from the board's own paint. Declared before
     *  the paint pass so the letterbox and the plate cannot drift apart, and
     *  created below once the container is in place. */
    let screen: HTMLElement | undefined;
    /** The screen's own paint — the letterbox. It is the plate's paint with the
     *  plate's mapping, so a gradient continues across the board's edge instead
     *  of restarting on the lens box. The camera moves the board inside the
     *  screen, so this is read after every camera change, not once at mount. */
    const paintScreen = (): void => {
      if (screen === undefined) return;
      const lens = editor.viewport.displayScreenRect();
      const mapped =
        lens === undefined
          ? undefined
          : cssArtboardPaintMapped(
              artboardPaint,
              lens,
              editor.viewport.artboardScreenRect(),
            );
      screen.style.background =
        mapped ?? cssArtboardPaint(artboardPaint) ?? "#000";
    };
    const paintArtboard = (): void => {
      artboardPaint = applyArtboardPaint(
        editor,
        currentArtboard,
        currentBackground,
        globals,
        paintMemo,
        cropToDisc(),
      );
      paintScreen();
    };
    // No observer here: `createViewportManager` registers one on the host at
    // construction and owns the refit decision, reading the box the camera was
    // framed in before `setDimensions` overwrites it. A second one on the same
    // host ran that same `resize()` again against the already-updated box, so
    // it decided "still fitted" from a frame the camera was never in.

    // Undo and redo revive the scene through `loadFromJSON`, which drops the
    // plate; the history manager's own post-revive signal is the point at which
    // the canvas is settled again. `canvas:cleared` fires too early — Fabric
    // re-applies the serialized background after it.
    editor.canvas.on("editor:history-state-loaded" as never, paintArtboard);

    if (opened !== undefined) {
      await reviveThemeEnvelope(
        editor.canvas,
        opened,
        resolveSceneAsset,
        // The editor is the only surface that types into text; the player keeps
        // the display class it persisted.
        { editableText: true },
      );
      editor.historyManager.resetHistory();
    }

    const scene =
      plan === undefined && opened === undefined
        ? undefined
        : createSceneAdapter({ canvas: editor.canvas });

    // After the plan, so the shell's own clip is the one left on the canvas:
    // the adapter applies the plan's artboard too, and it paints no background
    // of its own any more.
    if (plan !== undefined) {
      scene?.apply(plan);
    }
    paintArtboard();
    editor.viewport.zoomToFit();

    host.replaceChildren(container);
    container.id = EDITOR_CONTAINER_ID;
    container.style.visibility = "";
    let mediaAssets = assets ?? opened?.assets;
    let mediaResolve = resolveAsset;
    const reportMediaError = (message: string): void => {
      editor.errorManager.warn("background-media", message);
    };
    // **A pointer gesture owns the canvas for its duration.** Fabric draws the
    // marquee straight onto the context, not into the scene, so any full
    // repaint erases it until the pointer moves again. A video background asks
    // for one per decoded frame, which made the marquee flash and then vanish
    // while the button was still held. The frames keep decoding; only the
    // repaint they ask for waits for the gesture to end, and one request then
    // brings the glass sampler current.
    let gestureDown = false;
    const startGesture = (): void => {
      gestureDown = true;
    };
    const endGesture = (): void => {
      if (!gestureDown) return;
      gestureDown = false;
      editor.canvas.requestRenderAll();
    };
    editor.canvas.on("mouse:down" as never, startGesture as never);
    // The window, not the canvas, ends the gesture: a marquee released outside
    // the stage still has to unblock the next frame.
    window.addEventListener("mouseup", endGesture);
    window.addEventListener("blur", endGesture);

    /** Whether the document's background is a video, the only media the
     *  playback control has anything to pause. */
    const backgroundVideo = (): boolean => {
      const assetId = currentBackground?.media?.assetId;
      return (
        assetId !== undefined &&
        mediaAssets?.some(
          (asset) => asset.id === assetId && asset.kind === "video",
        ) === true
      );
    };
    // Transient: the author's pause lasts for this mount, never the document.
    let backgroundPaused = false;
    const playbackListeners = new Set<() => void>();
    const notifyPlayback = (): void => {
      for (const listener of playbackListeners) listener();
    };
    let videoBackground = backgroundVideo();
    /** Announces only a change the control can see. Every background tweak
     *  moves the layer, but an offset edit does not change its kind. */
    const syncPlaybackKind = (): void => {
      const next = backgroundVideo();
      if (next === videoBackground) return;
      videoBackground = next;
      notifyPlayback();
    };
    // Every mount of the media layer goes through here, so the frame
    // subscription cannot be left off one of them. `setBackgroundMedia` is a
    // remount, not an update, and the session performs one during mount - the
    // layer that had the subscription was being torn down and replaced on every
    // editor start.
    const mountMedia = (): BackgroundMediaHandle | undefined => {
      if (mediaResolve === undefined) return undefined;
      const mounted = mountBackgroundMedia({
        host: container,
        background: currentBackground,
        artboard: currentArtboard,
        assets: mediaAssets,
        resolveAsset: mediaResolve,
        onMediaError: reportMediaError,
        // The video is a DOM sibling, so Fabric never sees a frame change.
        onFrame: () => {
          if (!gestureDown) editor.canvas.requestRenderAll();
        },
      });
      // A remount is still the same document: a pause the author set carries
      // over an asset change rather than restarting the video under them.
      if (backgroundPaused) mounted.pause();
      return mounted;
    };
    let media = mountMedia();
    // The media layer is a DOM sibling of the canvas rather than a Fabric
    // object, so it has to be repositioned by hand whenever the camera moves.
    // A display box exists only once the host has laid the camera out and a
    // lens is active; until then a display-bounded layer falls back to the
    // artboard rather than to a guessed host size.
    const placeMedia = (): void => {
      const artboard = editor.viewport.artboardScreenRect();
      // A circle theme's theme-bounded media ships as the disc, whatever the
      // preview lens is: the corners it would otherwise paint are never glass.
      const board =
        currentArtboard.shape === "circle"
          ? { ...artboard, radius: "circle" as const }
          : artboard;
      const display = editor.viewport.displayScreenRect();
      if (display === undefined) {
        media?.setBounds({ artboard: board });
        return;
      }
      media?.setBounds({
        artboard: board,
        display:
          editor.viewport.displayShape() === "circle"
            ? { ...display, radius: "circle" }
            : display,
      });
    };
    editor.viewport.onChange(placeMedia);
    placeMedia();

    screen = document.createElement("div");
    screen.dataset["yunariDisplayScreen"] = "";
    screen.style.cssText = "position:absolute;pointer-events:none;";
    container.prepend(screen);
    const guide = document.createElement("div");
    guide.dataset["yunariThemeGuide"] = "";
    guide.hidden = true;
    container.append(guide);
    // The disc the shipped glass masks a circle theme to. It is the outline the
    // rect preview needs, because the authoring clip keeps the corners visible.
    const disc = document.createElement("div");
    disc.dataset["yunariThemeDisc"] = "";
    disc.hidden = true;
    container.append(disc);
    // Also a DOM sibling rather than a Fabric object, and for the same reason
    // as the media layer above: a Fabric frame would be a scene object, so it
    // would change what `canvas.getObjects()` means and what `serialiseScene`
    // writes. Review Focus 1 of this plan is that gate, and this is the cheap
    // route past it rather than a second one through it.
    //
    // Hidden under Fit, because there is no screen to draw then — a frame
    // around the whole stage would be a device the author never chose.
    const placeScreen = (): void => {
      const rect = editor.viewport.displayScreenRect();
      screen.hidden = rect === undefined;
      screen.style.borderRadius =
        editor.viewport.displayShape() === "circle" ? "50%" : "";
      // Repainted here as well as in `paintArtboard`, because the screen did not
      // exist when the first paint pass ran, and the mapping follows the board
      // rather than the element.
      paintScreen();
      if (rect !== undefined) {
        screen.style.left = `${rect.left}px`;
        screen.style.top = `${rect.top}px`;
        screen.style.width = `${rect.width}px`;
        screen.style.height = `${rect.height}px`;
      }

      // The guide marks the artboard's real bounds when the lens and the board
      // disagree; when they agree the two frames would coincide, so it is noise.
      // A crop disc is the third case: it already states the boundary, so the
      // rect frame would only draw it twice. Geometry is written before the
      // visibility check, so a hidden guide is never left holding a stale frame
      // for the next reveal.
      const board = editor.viewport.artboardScreenRect();
      const side = Math.min(board.width, board.height);
      guide.style.left = `${board.left}px`;
      guide.style.top = `${board.top}px`;
      guide.style.width = `${board.width}px`;
      guide.style.height = `${board.height}px`;
      const id = editor.viewport.display();
      const lens = id === undefined ? undefined : resolveLens(id);
      // **One artboard unit on either edge of the lens box is noise.** The
      // starter is 1672 × 941 — 16:9 to the eye, not to an exact aspect — so an
      // exact comparison drew the guide on the default view. One unit is the
      // smallest authored distance, and a real mismatch (4:3, 19.5:9, a circle)
      // is hundreds of units. The tolerance is on the box, not
      // an epsilon on its aspect.
      const ONE_ARTBOARD_UNIT = 1;
      const box =
        lens === undefined ? undefined : lensBox(lens, currentArtboard);
      const coincident =
        box !== undefined &&
        Math.abs(box.width - currentArtboard.width) <= ONE_ARTBOARD_UNIT &&
        Math.abs(box.height - currentArtboard.height) <= ONE_ARTBOARD_UNIT;
      const crop = cropToDisc();
      // The disc is the boundary the shipped glass masks, so it is noise once
      // the canvas already clips there — and absent on a rect theme entirely.
      disc.style.left = `${board.left + (board.width - side) / 2}px`;
      disc.style.top = `${board.top + (board.height - side) / 2}px`;
      disc.style.width = `${side}px`;
      disc.style.height = `${side}px`;
      disc.style.borderRadius = "50%";
      disc.hidden = currentArtboard.shape !== "circle" || crop;
      guide.hidden = lens === undefined || coincident || crop;

      // A lens change is a clip change, and the camera does not repaint the
      // artboard; re-apply it here or the mount's rect outlives the lens.
      if (syncClip(editor.canvas, currentArtboard, crop, paintMemo)) {
        editor.canvas.requestRenderAll();
      }
    };
    editor.viewport.onChange(placeScreen);
    placeScreen();

    const backdrop = (
      fit: BackdropFit = "authored",
    ): BackdropMedia | undefined =>
      artboardBackdrop({
        background: artboardPaint,
        width: currentArtboard.width,
        height: currentArtboard.height,
        media: media?.backdrop(fit),
        artboardShape: currentArtboard.shape ?? "rect",
      });

    // After the media, because a glass panel samples that layer for its backdrop.
    // Always wired, never conditionally: the session replaces the layer through
    // `setBackgroundMedia` *after* this returns, so `media` is undefined here
    // even when the theme has a background. Omitting the option left the editor
    // sampling nothing at all.
    //
    // The backdrop composes the board's paint under the media, which is
    // what the plate used to do for the sampler — and it has to, because the
    // plate is not drawn at all once the board declares media.
    const glass = createGlass({
      canvas: editor.canvas,
      backdrop,
      onGlassError: (message) => editor.errorManager.warn("glass", message),
    });

    return {
      editor,
      viewport: editor.viewport,
      ...(scene === undefined ? {} : { scene }),
      snapshot(input) {
        // A capture reads the document, not the entered-group view state.
        const release = editor.groupingManager.suspendReachability();
        try {
          const next = serialiseThemeEnvelope(
            editor.canvas,
            dropDanglingBindings(editor.canvas, input),
          );
          const validation = validateFabricThemeEnvelope(next);
          if (!validation.ok) {
            throw new Error(
              `Invalid theme: ${validation.issues[0]?.message ?? "unknown validation error"}`,
            );
          }
          return validation.envelope;
        } finally {
          release();
        }
      },
      refreshGlass: () => glass.sync(),
      setArtboard(nextArtboard) {
        currentArtboard = nextArtboard;
        // The camera frames the board; the authored fit mode belongs to the
        // player's letterbox, which the editor no longer draws.
        editor.viewport.zoomToFit();
        paintArtboard();
        // The guide, the disc and the clip are all drawn from the board's
        // shape and size, and a conversion changes both without moving the
        // camera enough to be relied on.
        placeScreen();
        // The media is a layer over the board rather than part of the scene, so
        // it takes the new size and the new camera box directly; nothing about
        // it changed except where it sits.
        media?.setArtboardSize(currentArtboard);
        placeMedia();
      },
      setBackground(nextBackground) {
        currentBackground = nextBackground;
        paintArtboard();
        media?.setBackground(currentBackground);
        placeMedia();
        syncPlaybackKind();
      },
      setBackgroundMedia(nextAssets, nextResolveAsset) {
        media?.destroy();
        mediaAssets = nextAssets;
        mediaResolve = nextResolveAsset;
        media = mountMedia();
        placeMedia();
        syncPlaybackKind();
      },
      backgroundVideo,
      backgroundPlaying: () => backgroundVideo() && !backgroundPaused,
      setBackgroundPlaying(playing) {
        if (backgroundPaused === !playing) return;
        backgroundPaused = !playing;
        if (playing) media?.resume();
        else media?.pause();
        notifyPlayback();
      },
      onBackgroundPlaybackChange(listener) {
        playbackListeners.add(listener);
        return () => playbackListeners.delete(listener);
      },
      setGlobals(nextGlobals) {
        globals = nextGlobals;
        paintArtboard();
      },
      setFitMode() {
        // The authoring view always frames the whole board; `cover` is the
        // player's crop of it, which the stage does not draw.
        editor.viewport.zoomToFit();
      },
      backdrop,
      destroy() {
        editor.canvas.off("mouse:down" as never, startGesture as never);
        window.removeEventListener("mouseup", endGesture);
        window.removeEventListener("blur", endGesture);
        playbackListeners.clear();
        glass.dispose();
        media?.destroy();
        scene?.dispose();
        disposeScene(editor.canvas);
        editor.clipboardManager.destroy();
        editor.destroy();
        delete (window as unknown as Record<string, unknown>)[debugKey];
      },
    };
  } catch (error) {
    container.remove();
    throw error;
  }
}
