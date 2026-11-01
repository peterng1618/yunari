import type { Binding } from "@yunari/renderer-core";
import { applyAuthoredText, applyObjectTypeTokens } from "@yunari/scene-fabric";
import type { FabricObject } from "fabric/es";
import type { ChartEdits } from "../chart-manager/chart-fields.js";
import type { SelectionInspectorOptions } from "./options.js";
import {
  appendRun,
  dropRun,
  type RunTarget,
  writeBindingFormat,
  writeBindingZone,
  writeRunColour,
  writeRunPreset,
  writeRunSource,
  writeRunStyle,
  writeRunText,
  writeTextLayout,
  writeUnitDisplay,
} from "./run-edits.js";
import type { SelectionState } from "./selection-state.js";
import type { CropEdits, FontFaceEdits, RunEdits } from "./view.js";

/** The write ports the column's non-field sub-surfaces reach. */
export interface EditPorts {
  readonly runEdits: RunEdits;
  readonly cropEdits: CropEdits;
  /** The chart owner's writes, or a port that does nothing. */
  chartEdits(): ChartEdits;
  readonly fontEdits: FontFaceEdits;
}

/**
 * The write ports for the run editor, the crop row, the chart fields and the
 * face field.
 *
 * These are not object fields: a run write replaces authored text and records
 * one history entry, a crop command drives the session, and the chart and face
 * ports are their owners' own actions. They share `index.ts`'s target and
 * history path through `commit` and `stillTarget`.
 */
export function createEditPorts(args: {
  readonly state: SelectionState;
  readonly options: SelectionInspectorOptions;
  readonly commit: () => void;
  readonly stillTarget: (object: FabricObject) => boolean;
  readonly rerender: () => void;
}): EditPorts {
  const { state, options, commit, stillTarget, rerender } = args;
  const editor = state.editor;

  /**
   * Applies one run edit to the described object and records one history entry.
   *
   * Not lock-gated: a locked object still takes its bindings and its authored
   * text, which is what the run editor writes — hiding it would refuse work the
   * editor performs.
   */
  const applyRunEdit = (change: (object: FabricObject) => boolean): boolean => {
    const object = state.described;
    if (object === undefined) {
      rerender();
      return false;
    }
    if (!stillTarget(object)) return false;
    if (!change(object)) {
      rerender();
      return false;
    }
    applyAuthoredText(editor.canvas, state.globals, {
      artboardHeight: editor.artboard().height,
    });
    // A run edit can change the first run's type token — the preset picker
    // does, and so does dropping run zero — and the object-level face is
    // `object-type.ts`'s to write. The authored pass deliberately leaves
    // `fontFamily`/`fontWeight` alone, so the face is refreshed here or not at
    // all (`vg-766`).
    applyObjectTypeTokens(editor.canvas, state.globals);
    commit();
    rerender();
    return true;
  };

  /** The node id a run editor hangs its bindings on, when the object has one. */
  const nodeIdOf = (object: FabricObject): string => {
    const id = object.get("id");
    return typeof id === "string" && id.length > 0 ? id : "";
  };

  /** The live bindings a node declares; the session owns the list. */
  const bindingsOf = (nodeId: string): readonly Binding[] =>
    nodeId === "" ? [] : (options.nodeBindings?.(nodeId) ?? []);

  const setBindings = (nodeId: string, next: readonly Binding[]): void => {
    if (nodeId !== "") options.onNodeBindingsChange?.(nodeId, next);
  };

  /**
   * Runs one write against the described object's run target. The write rules
   * themselves live beside the run editor, so a test drives the same functions
   * this port does; this only resolves the target and records the entry.
   */
  const runEdit = (change: (target: RunTarget) => boolean): boolean =>
    applyRunEdit((object) => {
      const nodeId = nodeIdOf(object);
      return change({
        object,
        nodeId,
        bindings: () => bindingsOf(nodeId),
        setBindings: (next) => setBindings(nodeId, next),
      });
    });

  const runEdits: RunEdits = {
    setRunText: (index, text) => runEdit((t) => writeRunText(t, index, text)),
    setRunPreset: (index, ref) => runEdit((t) => writeRunPreset(t, index, ref)),
    setRunColour: (index, ref) => runEdit((t) => writeRunColour(t, index, ref)),
    setRunSize: (index, value) =>
      runEdit((t) => writeRunStyle(t, index, "fontSize", value)),
    setRunLineHeight: (index, value) =>
      runEdit((t) => writeRunStyle(t, index, "lineHeight", value)),
    setRunTracking: (index, value) =>
      runEdit((t) => writeRunStyle(t, index, "letterSpacing", value)),
    setUnitDisplay: (index, value) =>
      runEdit((t) => writeUnitDisplay(t, index, value)),
    setSource: (index, key) => runEdit((t) => writeRunSource(t, index, key)),
    setFormat: (index, format) =>
      runEdit((t) => writeBindingFormat(t, index, format)),
    setZone: (index, zone) => runEdit((t) => writeBindingZone(t, index, zone)),
    writeLayout: (patch) => runEdit((t) => writeTextLayout(t, patch)),
    addRun: () => runEdit(appendRun),
    removeRun: (index) => runEdit((t) => dropRun(t, index)),
    ...(options.openFontFinder === undefined
      ? {}
      : { openFontFinder: options.openFontFinder }),
    ...(options.importLocalFont === undefined
      ? {}
      : {
          importLocalFont: (onImported) => {
            // The object that opened the dialog, not whichever one happens to be
            // selected when its commit answers: a run index means nothing on
            // another object, so a selection that moved means the token goes
            // nowhere rather than into the wrong run.
            const opened = state.described;
            options.importLocalFont?.((tokenId) => {
              if (opened === undefined || state.described !== opened) return;
              onImported(tokenId);
            });
          },
        }),
  };

  /**
   * The crop row's four commands, on the session the editor owns.
   *
   * `begin` resolves the target and refuses a stale one first, for the reason
   * every other field does — a button that held focus across a selection change
   * would otherwise start cropping whatever is selected now. The other three act
   * on the open session, which names its own image.
   */
  const cropEdits: CropEdits = {
    begin: () => {
      const object = state.described;
      if (object === undefined) {
        rerender();
        return false;
      }
      if (!stillTarget(object)) return false;
      return editor.cropManager.begin(object);
    },
    setAspect: (ratio) => editor.cropManager.setAspect(ratio),
    apply: () => editor.cropManager.apply(),
    cancel: () => editor.cropManager.cancel(),
  };

  /**
   * The chart owner's writes, or a port that does nothing.
   *
   * A no-op rather than `undefined`: the column's charts are rendered only when
   * `chartFields` answered, so a chart control can only exist when an owner is
   * mounted — and a `SelectionColumn` that had to guard every row's callbacks
   * would be a second copy of that same condition.
   */
  const chartEdits = (): ChartEdits =>
    options.chartEdits?.() ?? {
      onSettings: () => {},
      onBinding: () => {},
      onAspect: () => {},
      onAddBinding: () => {},
      onRemoveBinding: () => {},
    };

  /**
   * The face field's port, built once so the field's own effects — the
   * favourites read and the specimen cache — are not re-run by a fresh object
   * on every publish.
   *
   * A missing action is a no-op rather than a refusal the author sees: the
   * column only projects the field when `canWriteFontFace` says an owner is
   * mounted, so the absent case is a column built without one and never a press
   * that silently did nothing.
   */
  const fontEdits: FontFaceEdits = {
    applyFace: async (presetId, face) => {
      await options.fontActions?.applyFace(presetId, face);
    },
    applyTrio: async (trioId) => {
      await options.fontActions?.applyTrio(trioId);
    },
    listFavorites: async () => (await options.favoritesClient?.list()) ?? [],
    // With no store the list stays what the author has this session: the star
    // still answers, and nothing claims to have been saved.
    saveFavorites: async (ids) =>
      (await options.favoritesClient?.save(ids)) ?? ids,
  };

  return { runEdits, cropEdits, chartEdits, fontEdits };
}
