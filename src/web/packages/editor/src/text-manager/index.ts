import type { TextContent, TextRun } from "@yunari/renderer-core";
import {
  guardBoxWidth,
  type PlanTextObject,
  writeAuthoredBoxDimension,
  YUNARI_TEXT_PROPERTY,
} from "@yunari/scene-fabric";
import { type Canvas, IText, Textbox } from "fabric/es";
import { GUIDE_COLOR, GUIDE_WIDTH } from "../snap-manager/constants.js";
import { uiCopy } from "../ui-copy.js";

/**
 * Pointer travel, in CSS pixels, that turns a placement press into a drag.
 * Below it the author meant a click, however unsteady their hand was.
 */
export const PLACEMENT_DRAG_THRESHOLD = 4;

/** What a placement gesture asks for: a corner, and a box when it was a drag. */
export interface TextPlacement {
  readonly left: number;
  readonly top: number;
  readonly box?: { readonly width: number; readonly height: number };
}

/** Who decides where a text may land, and who constructs it once it does. */
export interface TextPlacementPort {
  readonly contained: (point: {
    readonly x: number;
    readonly y: number;
  }) => boolean;
  readonly onPlace: (placement: TextPlacement) => void;
}

/** The native pointer Fabric wraps in its own canvas event payload. */
interface PlacementPointerEvent {
  /** A touch pointer has no `button`, so it reads as non-primary and cancels;
   *  touch placement is out of scope for this plan. */
  readonly e: {
    readonly clientX: number;
    readonly clientY: number;
    readonly button?: number;
  };
}

/** The positive-size rectangle between two scene points, anchored at the
 *  upper-left so a drag up or left is normalised rather than inverted. */
function rectangleBetween(
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
): { left: number; top: number; width: number; height: number } {
  return {
    left: Math.min(from.x, to.x),
    top: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

/**
 * What a new text is asked for: its words, and the authored box that makes it
 * a `Textbox`. No box asks for an `IText`, which measures its own ink.
 */
export interface TextCreationOptions {
  readonly text?: string;
  readonly box?: { readonly width: number; readonly height: number };
  readonly [key: string]: unknown;
}

interface TextManager {
  /** The class the request chose: an `IText` with no box, a `Textbox` with one. */
  addText(options?: TextCreationOptions): IText;
  /**
   * Arm the one-shot placement gesture: the next primary press on the canvas
   * places a text, and any other outcome disarms. While armed, hover and
   * selection belong to the gesture rather than to authored objects.
   */
  beginPlacement(port: TextPlacementPort): void;
  /**
   * Who paints an object's authoring view when the author starts editing it.
   * The session owns the run display that painting comes from, and the shell
   * that creates this manager has no session yet, so it is set rather than
   * passed.
   */
  setAuthoringView(paint: (object: IText) => void): void;
  /** Paints the object's authored runs over what Fabric left behind, which is
      how a refused in-place edit puts back what it would have dropped. */
  setRepaint(paint: (object: IText) => void): void;
  destroy(): void;
}

/** The runs and box this object was authored with, or nothing to write back. */
function authoredOf(object: PlanTextObject): TextContent | undefined {
  const authored = object.get(YUNARI_TEXT_PROPERTY);
  return typeof authored === "object" &&
    authored !== null &&
    Array.isArray((authored as Record<string, unknown>)["runs"])
    ? (authored as TextContent)
    : undefined;
}

/**
 * What the author typed becomes the object's authored run.
 *
 * A value run has no text of its own, so there is nothing to keep the reading
 * *and* the words: typing over one replaces it with a literal, keeping the type
 * preset and colour it was painted with. The run editor turns it back into a
 * reading when the author wants one.
 *
 * Refused outright once the object carries more than one run. Fabric hands back
 * one flat string and no way to say which run each character came from, so the
 * only write available here drops the siblings — and an object that was "32" and
 * "%" would come back as one run of whatever was typed, with the reading gone
 * and no record that it had been. The run editor owns each run's text, and it
 * can refuse nothing: this says so rather than losing the work.
 */
function keepTypedText(object: PlanTextObject): "written" | "refused" {
  const authored = authoredOf(object);
  if (authored === undefined) return "written";
  if (authored.runs.length > 1) return "refused";

  const first = authored.runs[0] as TextRun | undefined;
  object.set(YUNARI_TEXT_PROPERTY, {
    ...authored,
    runs: [
      {
        kind: "literal",
        text: object.text,
        ...(first?.typePreset === undefined
          ? {}
          : { typePreset: first.typePreset }),
        ...(first?.style === undefined ? {} : { style: first.style }),
      },
    ],
  });
  return "written";
}

/**
 * A width the author dragged is the new authored box.
 *
 * Fabric's `changeWidth` writes through `set`, which re-enters
 * `initDimensions`; the scene's width guard puts the dragged number back before
 * `object:resizing` reports it, so what arrives here is the author's.
 */
function adoptResizedBox(object: object): void {
  const target = (object as { transform?: { target?: unknown } }).transform
    ?.target;
  // Box-only: an `IText` measures its own width, so writing a `yunariText.box`
  // for one would state a size nothing paints. The class gate is the invariant;
  // that only Textbox controls emit this event today is not.
  if (!(target instanceof Textbox)) return;

  const authored = authoredOf(target);
  if (authored === undefined) return;

  // A text the editor just made carries its runs but no box until something
  // states a size, so this write is also what gives it one. Returning early
  // here is why the first drag on a new text snapped back: the pass that
  // followed had no authored box to restore and measured the clip instead.
  //
  // Unscaled: `yunariText.box` is the object's size *before* `scaleX`.
  // `assertBox` divides the stored number by the scale to get Fabric's `width`
  // and `boxFrom` multiplies it back for the clip and the placement, so the
  // stored number is `width` itself. Writing `width * scaleX` handed the next
  // pass a box that many units too large, which the pass wrote straight onto the
  // width -- every resize of a scaled text left it `scaleX` times the size the
  // author dragged to (240 units dragged at `scaleX` 0.7432, 177.6 landed:
  // `vg-233`).
  writeAuthoredBoxDimension(target, "width", target.width);
}

/** Fabric's floor is 1 and a `NaN` propagates into the clip, so refuse both. */
function isBoxDimension(box: {
  readonly width: number;
  readonly height: number;
}): boolean {
  return [box.width, box.height].every(
    (value) => Number.isFinite(value) && value >= 1,
  );
}

/**
 * A double-click on a text object: it shows the run's binding, selects the
 * whole run so typing replaces it, and keeps what was typed.
 *
 * Fabric owns the gesture — it enters editing itself, on the first click's
 * mouse-up — so what is left to the application is the authored side: the runs,
 * the box, and the history entry.
 */
export function createTextManager(
  canvas: Canvas,
  save: () => void,
  /** How a refused edit reaches the author; the shell's diagnostics own it. */
  warn?: (message: string) => void,
): TextManager {
  let showAuthoringView: (object: IText) => void = () => {};
  /** Repaints the authored runs, so a refused edit does not leave un-authored
      text standing on the canvas as though it had been kept. */
  let repaint: (object: IText) => void = () => {};
  /**
   * The text this edit's view painted, so an edit that changed nothing is told
   * apart from one that did.
   *
   * Recorded on the canvas's own entry event because that is the one place both
   * routes meet: Fabric enters editing itself on a double-click, and the Add
   * tile constructs a text and enters it directly. A per-object handler
   * installed by the double-click was how a placed text's words were lost.
   */
  let editing:
    | {
        readonly target: IText;
        readonly painted: string;
        /** The display Fabric captured as `_textBeforeEdit`, which its own
         *  `object:modified` comparison is made against. */
        readonly entryText: string;
      }
    | undefined;

  const onEditingEntered = (event: { target?: unknown }): void => {
    const target = event.target;
    if (!(target instanceof IText)) return;
    // What the object carries as the edit opens: a constructed text is still
    // showing its placeholder, and a double-click replaces this with the run's
    // authoring view it paints afterwards. `entryText` stays that display,
    // because it is the one Fabric's own modification test used.
    editing = { target, painted: target.text, entryText: target.text };
  };

  const onEditingExited = (event: { target?: unknown }): void => {
    const target = event.target;
    if (!(target instanceof IText)) return;
    const record = editing?.target === target ? editing : undefined;
    editing = undefined;

    // Fabric's `exitEditing` (`index.mjs:17102-17105`) compares
    // `_textBeforeEdit` to decide whether to fire `modified` and never restores
    // it, so after a double-click and nothing else `text` is still the token
    // this view painted. Writing that back would turn a sensor card into prose
    // from a gesture that changed nothing.
    if (record !== undefined && target.text !== record.painted) {
      if (keepTypedText(target) === "refused") {
        warn?.(uiCopy.inspectorFields.multiRunRefused);
        // Fabric has already left editing, so the object's own text is the only
        // thing standing where the authored runs should be. Putting them back
        // is what makes the refusal honest rather than a warning the author
        // watches scroll away from text that was never kept.
        repaint(target);
        canvas.requestRenderAll();
        return;
      }
      // Fabric is silent only when what was typed is the display it captured
      // before the authoring view painted (`_textBeforeEdit`): typing a card's
      // own reading back reports no modification, and the run this branch just
      // wrote still needs its history entry. Every other change is saved by
      // `onModified`; the condition is the exact complement of Fabric's, so the
      // two can never save one edit twice.
      if (target.text === record.entryText) save();
    }
    // The token was this edit's view and it ends with the edit: repaint now
    // rather than at the next sample tick, so Escape puts the reading back on
    // the frame the author pressed it. The refresh loop's own copy is at most
    // a quarter second behind and is what restores every *other* object.
    repaint(target);
    canvas.requestRenderAll();
  };

  const onDoubleClick = (event: { target?: unknown }): void => {
    const target = event.target;

    if (!(target instanceof IText)) {
      return;
    }

    // Fabric enters inline editing on the second click's mouse-up
    // (`Text.mouseUpHandler`, `index.mjs:17824`/`:17833` — the first leaves
    // `this.selected` false, so its guard at `:17832` is never reached), so the
    // object is already editing by the time the double-click arrives. Bailing
    // on `isEditing` instead is what left the first keystroke editing a reading:
    // the token has to be painted now, and the whole run selected, or Fabric's
    // hidden textarea still holds the reading and typing edits that rather than
    // what is on screen.
    target.enterEditing();
    // Fabric captured `_textBeforeEdit` as the display before this view paints,
    // so that pre-paint text is what its own modification test compares
    // against; a manager that entered mid-edit has no earlier record to keep.
    const entryText =
      editing?.target === target ? editing.entryText : target.text;
    showAuthoringView(target);
    // The painted token is this edit's baseline for "did the author type
    // anything"; `entryText` stays the display Fabric saw, which is what says
    // whether Fabric will report the edit at all.
    editing = { target, painted: target.text, entryText };
    // Fabric writes the hidden textarea exactly once, as it enters editing
    // (`enterEditingImpl`, `index.mjs:16908`), and `_updateTextarea` then only
    // ever syncs the *selection*. So a run painted after that point is what the
    // author sees and not what their keystrokes edit — the first one lands in
    // the reading still in the box. Fabric publishes no call to rewrite the
    // value, so this repeats Fabric's own write rather than changing what
    // Fabric does. The upgrade path, if that field ever moves, is to paint the
    // token before `enterEditing` — which needs a signal that a *double*-click
    // is coming, and Fabric enters editing on the second click's mouse-up, so
    // there is none.
    if (target.hiddenTextarea) {
      target.hiddenTextarea.value = target.text;
    }
    target.selectAll();
    // Fabric collapses the caret again after this handler — the second
    // mouse-up's own behaviour re-runs `initDelayedCursor` — so the whole-run
    // selection is re-asserted once every listener has had its say. A keystroke
    // can only arrive in a later task, by which point this has run.
    requestAnimationFrame(() => {
      if (target.isEditing) {
        target.selectAll();
        canvas.requestRenderAll();
      }
    });
    canvas.requestRenderAll();
  };

  const onResizing = (event: object): void => {
    // Fabric reports a resize on every step of the drag, and `adoptResizedBox`
    // changes the authored box on each one, so this only records the box. The
    // history entry waits for `object:modified` — Fabric reports the gesture as
    // finished only then, and a per-step save is a full scene serialisation and
    // an undo entry per tick.
    adoptResizedBox(event);
  };

  const onModified = (event: { target?: unknown }): void => {
    if (event.target instanceof IText) {
      save();
    }
  };

  /** The armed placement gesture, if any. One-shot: every outcome disarms it. */
  let placement: TextPlacementPort | undefined;
  let press:
    | {
        readonly clientX: number;
        readonly clientY: number;
        readonly scene: { readonly x: number; readonly y: number };
      }
    | undefined;
  /** The rectangle the drag would place, painted as chrome on `after:render`. */
  let outline:
    | {
        readonly left: number;
        readonly top: number;
        readonly width: number;
        readonly height: number;
      }
    | undefined;
  /** What arming replaced, so every exit can put it back exactly. */
  let resumeCanvasState:
    | {
        readonly skipTargetFind: boolean;
        readonly selection: boolean;
        readonly defaultCursor: string;
        readonly cursor: string;
      }
    | undefined;
  /** The canvas was already claimed when the tool armed — the viewport's
   *  space-held pan, for instance — so this gesture owns none of its state. */
  let claimedElsewhere = false;
  /** A non-primary press is a cancel, but the element's `contextmenu`
   *  listeners share the target and arrive afterwards; this keeps the menu
   *  closed for that press even though the gesture has already disarmed. */
  let suppressContextMenu = false;

  const disarmPlacement = (): void => {
    placement = undefined;
    press = undefined;
    claimedElsewhere = false;
    const hadOutline = outline !== undefined;
    outline = undefined;
    if (resumeCanvasState !== undefined) {
      canvas.skipTargetFind = resumeCanvasState.skipTargetFind;
      canvas.selection = resumeCanvasState.selection;
      canvas.defaultCursor = resumeCanvasState.defaultCursor;
      // Fabric re-applies `defaultCursor` on the next move; this is what puts
      // the pointer back on the frame the gesture ends, without waiting for it.
      canvas.setCursor(resumeCanvasState.cursor);
      resumeCanvasState = undefined;
    }
    // The outline lives only in the last framebuffer; a render is what removes
    // it when the gesture ends before the next move would have repainted it.
    if (hadOutline) canvas.requestRenderAll();
  };

  const place = (value: TextPlacement): void => {
    const armed = placement;
    // Disarm before the callback: a construction that refuses, or one that
    // arms again, must never leave this press able to place a second object.
    disarmPlacement();
    armed?.onPlace(value);
  };

  const onPlacementDown = (event: PlacementPointerEvent): void => {
    // Any press starts a new gesture, armed or not: a suppression flag left by
    // a press whose context menu never came must not swallow a later menu.
    suppressContextMenu = false;
    if (placement === undefined) return;
    // A right or middle press is a cancel, never a placement: the primary
    // button is the whole gesture. Its context menu arrives later, so the
    // suppression flag has to outlive the disarm.
    if (event.e.button !== 0) {
      suppressContextMenu = true;
      disarmPlacement();
      return;
    }

    // Someone else owns the canvas (the viewport's space-held pan). This press
    // is theirs, so the tool cancels rather than placing over their claim.
    if (claimedElsewhere) {
      disarmPlacement();
      return;
    }
    const scene = canvas.getScenePoint(event.e as never);
    if (!placement.contained({ x: scene.x, y: scene.y })) {
      disarmPlacement();
      return;
    }
    press = {
      clientX: event.e.clientX,
      clientY: event.e.clientY,
      scene: { x: scene.x, y: scene.y },
    };
    outline = undefined;
  };

  const onPlacementMove = (event: PlacementPointerEvent): void => {
    const start = press;
    if (placement === undefined || start === undefined) return;
    // Travel is a screen-space decision, so it is taken from client pixels;
    // the rectangle that gets placed is in scene units.
    const travelled = Math.hypot(
      event.e.clientX - start.clientX,
      event.e.clientY - start.clientY,
    );
    if (travelled < PLACEMENT_DRAG_THRESHOLD) {
      if (outline !== undefined) {
        outline = undefined;
        canvas.requestRenderAll();
      }
      return;
    }
    // Only the outline changes while the pointer moves; nothing is constructed
    // until the release, so a move can never add an object or a history entry.
    outline = rectangleBetween(
      start.scene,
      canvas.getScenePoint(event.e as never),
    );
    canvas.requestRenderAll();
  };

  const onPlacementUp = (event: PlacementPointerEvent): void => {
    const start = press;
    if (placement === undefined || start === undefined) return;
    const release = canvas.getScenePoint(event.e as never);
    const travelled =
      Math.hypot(
        event.e.clientX - start.clientX,
        event.e.clientY - start.clientY,
      ) >= PLACEMENT_DRAG_THRESHOLD;
    const box = rectangleBetween(start.scene, release);
    // A rectangle with no drawable dimension is a click: the author meant a
    // point, not an invisible one-unit Text box.
    if (!travelled || box.width < 1 || box.height < 1) {
      place({ left: start.scene.x, top: start.scene.y });
      return;
    }
    place({
      left: box.left,
      top: box.top,
      box: { width: box.width, height: box.height },
    });
  };

  const onPlacementKeyDown = (event: KeyboardEvent): void => {
    if (placement === undefined) return;
    // Space belongs to the viewport's pan, which claims the same canvas state.
    // Cancelling here — in the capture phase, before that claim runs — is what
    // stops the two owners from capturing each other's cursor and target find.
    if (event.key !== "Escape" && event.key !== " ") return;
    disarmPlacement();
  };

  /**
   * The element's contextmenu listeners are a shared target: the app's menu is
   * registered after this manager, so stopping immediate propagation from here
   * is what keeps a right press on the armed tool from opening it.
   */
  const onPlacementContextMenu = (event: MouseEvent): void => {
    const armed = placement !== undefined;
    if (!armed && !suppressContextMenu) return;
    suppressContextMenu = false;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (armed) disarmPlacement();
  };

  /** The drag outline is editor chrome: drawn after the render, on the lower
   *  context through the viewport, and never a canvas object or a history entry. */
  const onPlacementAfterRender = (): void => {
    if (outline === undefined) return;
    const context = canvas.contextContainer;
    if (!context) return;
    context.save();
    try {
      context.transform(...canvas.viewportTransform);
      context.lineWidth = GUIDE_WIDTH / (canvas.getZoom() || 1);
      context.strokeStyle = GUIDE_COLOR;
      context.setLineDash([4, 4]);
      context.strokeRect(
        outline.left,
        outline.top,
        outline.width,
        outline.height,
      );
    } finally {
      context.restore();
    }
  };

  canvas.on("mouse:dblclick" as never, onDoubleClick as never);
  canvas.on("text:editing:entered" as never, onEditingEntered as never);
  canvas.on("text:editing:exited" as never, onEditingExited as never);
  canvas.on("object:resizing" as never, onResizing as never);
  canvas.on("object:modified" as never, onModified as never);
  canvas.on("mouse:down" as never, onPlacementDown as never);
  canvas.on("mouse:move" as never, onPlacementMove as never);
  canvas.on("mouse:up" as never, onPlacementUp as never);
  canvas.on("after:render" as never, onPlacementAfterRender as never);
  window.addEventListener("keydown", onPlacementKeyDown, true);
  canvas.upperCanvasEl.addEventListener("contextmenu", onPlacementContextMenu);

  return {
    addText(options = {}) {
      const { box, text: content = "", ...rest } = options;
      if (box !== undefined && !isBoxDimension(box)) {
        throw new Error(
          "A text box needs a finite width and height of at least 1.",
        );
      }
      const id = `text-${crypto.randomUUID()}`;
      let text: IText;
      if (box === undefined) {
        // No box is the whole of the width mode: an `IText` measures its own
        // ink, so an authored box or a width guard would be a constraint the
        // class cannot honour.
        text = new IText(content, { id, ...rest });
      } else {
        // A `Textbox` is an `IText` at runtime; only Fabric's generic
        // signatures make the subclass unassignable under
        // `exactOptionalPropertyTypes`, so the annotation needs the cast.
        text = new Textbox(content, {
          id,
          ...rest,
          width: box.width,
          height: box.height,
        }) as IText;
        // Installed at construction, not on the first authored pass: the author
        // types into a new text immediately, and both passes skip an object
        // that is being edited — so a handle dragged while those passes are
        // skipping would otherwise be widened back to its longest word by
        // Fabric's own `initDimensions` before it ever met the guard.
        guardBoxWidth(text);
        // The drawn rectangle is the authored box, both dimensions of it. A
        // measurement here would make the box the author drew a suggestion.
        // Runs are a precondition: the write refuses without authored content.
        writeAuthoredBoxDimension(text, "width", box.width);
        writeAuthoredBoxDimension(text, "height", box.height);
      }
      canvas.add(text);
      canvas.setActiveObject(text);
      save();
      return text;
    },
    beginPlacement(port) {
      // Already armed: swapping the port must not capture the crosshair as
      // the state to restore.
      if (placement !== undefined) {
        placement = port;
        return;
      }
      placement = port;
      press = undefined;
      outline = undefined;
      suppressContextMenu = false;
      // A canvas that is already claimed belongs to another owner. Arming must
      // not overwrite that claim, and the next primary press is theirs: it
      // cancels this gesture without placing.
      if (canvas.skipTargetFind) {
        claimedElsewhere = true;
        return;
      }
      claimedElsewhere = false;
      resumeCanvasState = {
        skipTargetFind: canvas.skipTargetFind,
        selection: canvas.selection,
        defaultCursor: canvas.defaultCursor,
        cursor: canvas.upperCanvasEl.style.cursor,
      };
      // Fabric re-applies `defaultCursor` on every hover, so that is the
      // property the crosshair has to live in; `setCursor` paints it now
      // instead of waiting for the pointer to move.
      canvas.skipTargetFind = true;
      canvas.selection = false;
      canvas.defaultCursor = "crosshair";
      canvas.setCursor("crosshair");
    },
    setAuthoringView(paint) {
      showAuthoringView = paint;
    },
    setRepaint(paint) {
      repaint = paint;
    },
    destroy() {
      canvas.off("mouse:dblclick" as never, onDoubleClick as never);
      canvas.off("text:editing:entered" as never, onEditingEntered as never);
      canvas.off("text:editing:exited" as never, onEditingExited as never);
      canvas.off("object:resizing" as never, onResizing as never);
      canvas.off("object:modified" as never, onModified as never);
      canvas.off("mouse:down" as never, onPlacementDown as never);
      canvas.off("mouse:move" as never, onPlacementMove as never);
      canvas.off("mouse:up" as never, onPlacementUp as never);
      canvas.off("after:render" as never, onPlacementAfterRender as never);
      window.removeEventListener("keydown", onPlacementKeyDown, true);
      canvas.upperCanvasEl.removeEventListener(
        "contextmenu",
        onPlacementContextMenu,
      );
      disarmPlacement();
    },
  };
}
