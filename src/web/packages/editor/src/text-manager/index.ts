import type { TextContent, TextRun } from "@yunari/renderer-core";
import {
  guardBoxWidth,
  type PlanTextObject,
  writeAuthoredBoxDimension,
  YUNARI_TEXT_PROPERTY,
} from "@yunari/scene-fabric";
import { type Canvas, IText, Textbox } from "fabric/es";
import { uiCopy } from "../ui-copy.js";

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
  if (!isText(target)) return;

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

function isText(value: unknown): value is PlanTextObject & {
  readonly width: number;
  readonly scaleX: number;
} {
  return value instanceof IText;
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
    showAuthoringView(target);
    // What the authoring view painted, so an edit that changed nothing can be
    // told apart from one that did — see the `editing:exited` handler.
    const painted = target.text;
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
    target.once("editing:exited", () => {
      // Fabric's `exitEditing` (`index.mjs:17102-17105`) compares
      // `_textBeforeEdit` to decide whether to fire `modified` and never
      // restores it, so after a double-click and nothing else `text` is still
      // the token this view painted. Writing that back would turn a sensor card
      // into prose from a gesture that changed nothing.
      if (target.text !== painted) {
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
        save();
      }
      // The token was this edit's view and it ends with the edit: repaint now
      // rather than at the next sample tick, so Escape puts the reading back on
      // the frame the author pressed it. The refresh loop's own copy is at most
      // a quarter second behind and is what restores every *other* object.
      repaint(target);
      canvas.requestRenderAll();
    });
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

  canvas.on("mouse:dblclick" as never, onDoubleClick as never);
  canvas.on("object:resizing" as never, onResizing as never);
  canvas.on("object:modified" as never, onModified as never);

  return {
    addText(options = {}) {
      const { box, text: content = "", ...rest } = options;
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
        writeAuthoredBoxDimension(text, "width", box.width);
        writeAuthoredBoxDimension(text, "height", box.height);
      }
      canvas.add(text);
      canvas.setActiveObject(text);
      save();
      return text;
    },
    setAuthoringView(paint) {
      showAuthoringView = paint;
    },
    setRepaint(paint) {
      repaint = paint;
    },
    destroy() {
      canvas.off("mouse:dblclick" as never, onDoubleClick as never);
      canvas.off("object:resizing" as never, onResizing as never);
      canvas.off("object:modified" as never, onModified as never);
    },
  };
}
