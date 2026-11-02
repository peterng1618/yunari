import {
  applyAuthoredText,
  isLocked,
  type PlanTextObject,
  scaleOf,
  writeAuthoredBoxDimension,
} from "@yunari/scene-fabric";
import type { FabricObject } from "fabric/es";
import { uiCopy } from "../ui-copy.js";
import type { BackgroundFunnel } from "./background-edits.js";
import { writeGlassField } from "./glass.js";
import type { SelectionInspectorOptions } from "./options.js";
import { writePanelField, writeShapeGeometryField } from "./panel.js";
import {
  type GeometryKey,
  isAutoText,
  MIN_DIMENSION,
} from "./per-kind-column.js";
import { type SelectionState, targetOf } from "./selection-state.js";
import {
  editRefusal,
  IMAGE_BINDING_FIELD_ID,
  isTextObject,
  type SelectionEdits,
} from "./view.js";

/** The geometry keys the funnel writes directly; every other id is a shape's
    own geometry and is parsed by its owner in `panel.ts`. */
const GEOMETRY_KEYS: ReadonlySet<string> = new Set([
  "left",
  "top",
  "width",
  "height",
  "angle",
]);

/** The one geometry writer, shared with the column's own context. */
export type FieldWrite = (
  object: FabricObject,
  key: GeometryKey,
  value: number,
) => boolean;

export interface FieldDispatch {
  /** The column's one write port, including the background's prefix routing. */
  readonly edits: SelectionEdits;
  readonly write: FieldWrite;
  /** One entry per committed edit, matching the dock's own actions. */
  readonly commit: () => void;
  /** Whether the object is still the described target; re-renders when not. */
  readonly stillTarget: (object: FabricObject) => boolean;
}

/**
 * The write funnel for a described Fabric object: which field writes what,
 * the revision guard in front of it, and the one history entry a commit
 * records.
 *
 * A `background.*` id is routed by prefix before the funnel is reached: the
 * background is envelope state, not a Fabric object, so there is no object for
 * `writeField` to write. That branch is `background-edits.ts`'s.
 */
export function createFieldDispatch(args: {
  readonly state: SelectionState;
  readonly options: SelectionInspectorOptions;
  readonly background: BackgroundFunnel;
  readonly rerender: () => void;
}): FieldDispatch {
  const { state, options, background, rerender } = args;
  const editor = state.editor;

  /** Writes one field to the object without rendering or saving history, so a
      caller can batch several writes into one entry. Returns whether the write
      was applied: a text without a box refuses its dimensions. */
  const write: FieldWrite = (object, key, value) => {
    switch (key) {
      case "left":
        object.set({ left: value });
        break;
      case "top":
        object.set({ top: value });
        break;
      case "width": {
        // A point text's width is measured from what it says and grows with it;
        // it has no authored box. Writing `scaleX` or a box would change
        // neither what it draws nor what the readout next shows, so the write
        // is refused rather than landing a history entry for nothing (Task 2.2).
        if (isAutoText(object)) return false;
        // A text object's width is the box its text wraps inside, not a scale
        // on the type. Writing `scaleX` instead stretched every glyph: a 24px
        // caption asked for a 220-unit box came back at 3.4× the size, and the
        // H field squashed the same type to 0.44 of its height. The authored box
        // is the owner, and the renderer re-asserts it.
        //
        // The unit the box is written in is the object's own, unscaled one:
        // the field shows the drawn edge — `readField` reads `width * scaleX` —
        // and a scaled text object draws `box × scale`. So the write divides by
        // the same scale the read multiplies by, or the control cannot
        // round-trip: a 140 × 27 box at scale 2 read 280, typing 280 back
        // stored 280, and the object drew 560 (vg-109). A dragged handle writes
        // the same unscaled unit (`text-manager`'s `adoptResizedBox`,
        // `controls-manager`'s height control), and `scaleOf` is the rule for a
        // zero scale, so neither side re-spells it.
        //
        // The box owns its own minimum, in box units. A drawn number is handed
        // over divided by the scale and may be refused there; flooring the
        // drawn number first would divide a floor (1) below the box's own
        // (1/scale on a scaled text) and turn the refusal into a silent no-op
        // with a history entry over it.
        if (isTextObject(object)) {
          const written = writeAuthoredBoxDimension(
            object as PlanTextObject,
            "width",
            value / scaleOf(object.scaleX),
          );
          if (!written) return false;
          applyAuthoredText(editor.canvas, state.globals, {
            artboardHeight: editor.artboard().height,
          });
          break;
        }
        // Scale rather than resize: a chart's own width is its raster size. A
        // dimension below one unit would make the object vanish from the canvas
        // and from its own selection box; the funnel lands it on that floor.
        const dimension = Math.max(value, MIN_DIMENSION);
        const next = dimension / (object.width <= 0 ? 1 : object.width);
        object.set({ scaleX: next });
        break;
      }
      case "height": {
        if (isAutoText(object)) return false;
        if (isTextObject(object)) {
          // Same unit as the width above, and as `writeAuthoredBoxDimension`'s
          // own seeding of the other dimension from the object's edges — those
          // are unscaled too, so the first Size edit still produces a whole box
          // in one unit (vg-057). The box refuses a dimension below its own
          // minimum; the funnel takes that refusal rather than flooring it.
          const written = writeAuthoredBoxDimension(
            object as PlanTextObject,
            "height",
            value / scaleOf(object.scaleY),
          );
          if (!written) return false;
          applyAuthoredText(editor.canvas, state.globals, {
            artboardHeight: editor.artboard().height,
          });
          break;
        }
        const dimension = Math.max(value, MIN_DIMENSION);
        const next = dimension / (object.height <= 0 ? 1 : object.height);
        object.set({ scaleY: next });
        break;
      }
      case "angle": {
        // The property alone rotates about the authored left/top origin while
        // the gesture holds the centre (`centeredRotation`), so the centre is
        // read before the write and restored after it (vg-475; canvas-nudge).
        const centre = object.getRelativeCenterPoint();
        object.set({ angle: value });
        object.setPositionByOrigin(centre, "center", "center");
        break;
      }
    }

    object.setCoords();
    return true;
  };

  /** One entry per committed edit, matching the dock's own actions. */
  const commit = (): void => {
    editor.canvas.requestRenderAll();
    editor.historyManager.saveState();
  };

  /**
   * The target may have changed while a field held focus; re-render rather
   * than write to an object the panel no longer describes. Every committing
   * field asks this first, so a stale event cannot mutate the selection that
   * has since been replaced.
   */
  const stillTarget = (object: FabricObject): boolean => {
    if (targetOf(state) === object) return true;
    rerender();
    return false;
  };

  /**
   * Writes the object's display name. Removing the key, not storing blank: the
   * id is what the projection falls back to, so an emptied field leaves the
   * object exactly as an unnamed one is.
   *
   * The canvas fires the same signal a drag reports, because the layer row
   * prints this name and its panel caches the projection: a rename that only
   * wrote the object would leave the two surfaces disagreeing until something
   * else republished.
   */
  const writeName = (
    object: FabricObject,
    value: string | number | boolean,
  ): void => {
    const trimmed = (typeof value === "string" ? value : String(value)).trim();
    object.set("name", trimmed === "" ? undefined : trimmed);
    object.setCoords();
    editor.canvas.requestRenderAll();
    editor.canvas.fire("object:modified" as never, { target: object } as never);
  };

  /**
   * Writes opacity from a percentage, refusing a value outside Fabric's 0–1.
   */
  const writeOpacity = (
    object: FabricObject,
    value: string | number | boolean,
  ): boolean => {
    const percent = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      editor.errorManager.warn("controls", uiCopy.inspectorFields.invalidValue);
      return false;
    }

    object.set({ opacity: percent / 100 });
    object.setCoords();
    return true;
  };

  /**
   * One field, written by the owner that owns it: the funnel a slider's preview
   * and its release share, so the two cannot take different routes to the
   * document (`vg-254`).
   *
   * `settled` marks the settled write rather than a frame of one. A frame
   * announces no refusal — sixty times a second is a log, not a report — and
   * re-resolves no glass lifecycle, because `sync` answers *which* objects carry
   * a treatment and a blur inside an existing one cannot change that answer.
   */
  const writeField = (
    object: FabricObject,
    fieldId: string,
    value: string | number | boolean,
    settled: boolean,
  ): boolean => {
    if (fieldId === "name") {
      writeName(object, value);
      return true;
    }
    if (fieldId === "opacity") return writeOpacity(object, value);
    if (fieldId === IMAGE_BINDING_FIELD_ID) {
      // The binding belongs to the envelope, not the Fabric object: the session
      // owns the map, so the funnel hands it the whole replacement. One image,
      // one reading; the blank entry is the picker's clear.
      const nodeId = object.get("id");
      if (typeof nodeId !== "string" || nodeId.length === 0) return false;
      if (typeof value !== "string") return false;
      if (options.onNodeBindingsChange === undefined) return false;
      options.onNodeBindingsChange(
        nodeId,
        value === "" ? [] : [{ id: "image", semanticKey: value }],
      );
      return true;
    }
    if (GEOMETRY_KEYS.has(fieldId)) {
      return write(object, fieldId as GeometryKey, value as number);
    }

    let applied: boolean;
    if (fieldId.startsWith("panel-")) {
      // The panel's material writes — resolve a reference, create a default
      // shadow, move a live one — are `panel.ts`'s; this funnel only asks.
      applied = writePanelField(
        object,
        { editor, globals: state.globals },
        fieldId,
        value as string | number,
      );
    } else if (fieldId.startsWith("glass-")) {
      // The treatment writes are `glass.ts`'s. Nothing else re-resolves the
      // lifecycle: a property written on a panel that is already there is
      // neither a gain nor a loss of an object, so the control asks — once.
      applied = writeGlassField(
        object,
        { editor, globals: state.globals },
        fieldId,
        value,
      );
      if (applied && settled) options.refreshGlass();
    } else {
      // A shape's own geometry: the parse, the bound and the scale it adopts are
      // its owner's, and this is the funnel that asks for the write.
      applied = writeShapeGeometryField(
        object,
        fieldId,
        value as string | number,
      );
      // Every field here moves a corner, a handle or an endpoint, and a stale
      // control box outlives the render.
      if (applied) object.setCoords();
    }

    if (!applied && settled) {
      editor.errorManager.warn("controls", uiCopy.inspectorFields.invalidValue);
    }
    return applied;
  };

  /**
   * The guard in front of the write funnel, then the write.
   *
   * `editRefusal` is `view.ts`'s, read against the live target **at call time**:
   * a control whose draft outlived its selection is refused before the funnel is
   * reached, because the funnel would otherwise resolve the *current* target and
   * write an old draft into a newly selected object. **Nothing here records
   * history** — `commit` is the only caller that saves it.
   */
  const applyField = (
    expectedRevision: number,
    fieldId: string,
    value: string | number | boolean,
    settled: boolean,
  ): boolean => {
    const object = state.described;
    if (object === undefined) return false;

    const refusal = editRefusal(
      { expectedRevision, fieldId, value },
      { targetRevision: state.targetRevision, locked: isLocked(object) },
    );
    if (refusal !== undefined) {
      if (settled && refusal === "invalid") {
        editor.errorManager.warn(
          "controls",
          fieldId === "name"
            ? uiCopy.inspectorFields.invalidName
            : uiCopy.inspectorFields.invalidValue,
        );
      }
      return false;
    }

    return writeField(object, fieldId, value, settled);
  };

  /**
   * The column's three write routes, on one funnel.
   *
   * A preview and its cancel are the gesture's own halves: the preview
   * writes the field and repaints without re-publishing the column, so the
   * control's moving value stays its own state; the cancel writes the start
   * value back and re-publishes once. Neither records a history entry.
   *
   * A `background.*` id is routed by prefix before the funnel is reached: the
   * background is envelope state, not a Fabric object, so there is no object
   * for `writeField` to write.
   */
  const edits: SelectionEdits = {
    commit(expectedRevision, fieldId, value) {
      // **Another field's unsettled preview ends here.** Its value already sits
      // in the document; the save is what makes it the one edit that gesture
      // made, before this commit records its own.
      if (state.pendingPreview.settleOther(fieldId)) commit();
      // Routed by prefix, so a background field can never reach `writeField`'s
      // Fabric path: there is no object for it to write.
      if (fieldId.startsWith("background.")) {
        const result = background.commit(expectedRevision, fieldId, value);
        if (result !== "ok") {
          if (result === "invalid") {
            editor.errorManager.warn(
              "controls",
              uiCopy.inspectorFields.invalidValue,
            );
          }
          rerender();
          return false;
        }
        state.pendingPreview.discard(fieldId);
        rerender();
        return true;
      }
      if (!applyField(expectedRevision, fieldId, value, true)) {
        rerender();
        return false;
      }
      state.pendingPreview.discard(fieldId);
      commit();
      rerender();
      return true;
    },
    preview(expectedRevision, fieldId, value) {
      // The background's controls commit on change: there is no gesture whose
      // in-flight value would be previewed.
      if (fieldId.startsWith("background.")) return false;
      // A different field's preview ends when this gesture starts.
      if (state.pendingPreview.settleOther(fieldId)) commit();
      if (!applyField(expectedRevision, fieldId, value, false)) return false;
      if (state.described !== undefined)
        state.pendingPreview.record(state.described, fieldId, value);
      editor.canvas.requestRenderAll();
      return true;
    },
    cancelPreview(expectedRevision, fieldId, value) {
      if (fieldId.startsWith("background.")) return;
      if (state.pendingPreview.settleOther(fieldId)) commit();
      // The cancel is this field's own end: its preview must not be saved as
      // the edit it just took back.
      state.pendingPreview.discard(fieldId);
      if (!applyField(expectedRevision, fieldId, value, false)) return;
      editor.canvas.requestRenderAll();
      rerender();
    },
  };

  return { edits, write, commit, stillTarget };
}
