import { type ArrangeAction, canArrange } from "../arrange.js";
import {
  arrangeActions,
  type ObjectActionId,
  objectAction,
} from "../object-actions.js";
import { uiCopy } from "../ui-copy.js";
import { backgroundColumn } from "./background-column.js";
import type { BackgroundFunnel } from "./background-edits.js";
import type { createSelectionColumnRoot } from "./column.js";
import type { FieldDispatch } from "./dispatch.js";
import type { EditPorts } from "./edit-ports.js";
import type { createInspectorRoot } from "./inspector.js";
import type { SelectionInspectorOptions } from "./options.js";
import { type ColumnContext, perKindColumn } from "./per-kind-column.js";
import {
  type ArrangeButtonView,
  createSelectionLeadRoot,
} from "./selection-lead.js";
import { describedTarget, type SelectionState } from "./selection-state.js";
import {
  type ProjectionPorts,
  projectSelection,
  readField,
  type SelectionView,
} from "./view.js";

type ColumnRoot = ReturnType<typeof createInspectorRoot>;
type LeadRoot = ReturnType<typeof createSelectionLeadRoot>;
type SectionsRoot = ReturnType<typeof createSelectionColumnRoot>;

/**
 * Publishes the described selection to the three React roots.
 *
 * The background is not a Fabric object, so its branch is decided before the
 * Fabric path is entered; every other render projects the target through
 * `view.ts` and hands the same value to the subject, lead and section roots.
 * This module owns only that publication — which object is described and what
 * a write does belong to `selection-state.ts` and `dispatch.ts`.
 */
export function createProjection(args: {
  readonly state: SelectionState;
  readonly options: SelectionInspectorOptions;
  readonly background: BackgroundFunnel;
  readonly roots: {
    readonly column: ColumnRoot;
    readonly lead: LeadRoot;
    readonly sectionColumn: SectionsRoot;
  };
  readonly dispatcher: FieldDispatch;
  readonly editPorts: EditPorts;
}): { readonly render: () => void } {
  const { state, options, background, roots, dispatcher, editPorts } = args;
  const { column, lead, sectionColumn } = roots;
  const { edits, commit, stillTarget, write } = dispatcher;
  const { runEdits, cropEdits, chartEdits, fontEdits } = editPorts;
  const editor = state.editor;

  const columnContext = (): ColumnContext => {
    const chartFields = options.chartFields?.();
    return {
      editor,
      globals: state.globals,
      locale: state.locale,
      geometry: {
        read: readField,
        write,
      },
      stillTarget,
      commit,
      rerender: render,
      refreshGlass: options.refreshGlass,
      nodeBindings: options.nodeBindings,
      onNodeBindingsChange: options.onNodeBindingsChange,
      sampleSource: options.sampleSource,
      canWriteFontFace: options.fontActions !== undefined,
      ...(options.descriptors === undefined
        ? {}
        : { descriptors: options.descriptors }),
      ...(options.measured === undefined ? {} : { measured: options.measured }),
      ...(options.bound === undefined ? {} : { bound: options.bound }),
      ...(chartFields === undefined ? {} : { chartFields }),
    };
  };

  /**
   * The arrange actions, in the registry's order, each with its own answer — and
   * none at all when this selection can run none of them.
   *
   * Two or more selected objects — or groups — is what the eight are for, and
   * the threshold is `arrange.ts`'s: `canArrange` is asked per action, so a
   * control cannot advertise one `applyArrange` would refuse. Asking it per
   * action is also what draws `Distribute` disabled beside two selected objects
   * instead of absent, and what makes a single object's column show no arrange
   * row rather than eight greyed buttons about a question it does not have.
   */
  const arrangeRow = (): readonly ArrangeButtonView[] => {
    const buttons = arrangeActions().map(({ id, label }) => ({
      id,
      label,
      // The action's verb is the tail of the registry's own id; the run below
      // never parses it, because the registry's `run` carries it.
      enabled: canArrange(editor, id.slice("arrange:".length) as ArrangeAction),
    }));
    return buttons.some((button) => button.enabled) ? buttons : [];
  };

  /** The arrange row's one way to run: the registry's, so this module neither
   *  restates a verb nor reaches `applyArrange` behind the registry's back. */
  const runArrange = (id: ObjectActionId): void => {
    objectAction(id).run(editor);
  };

  /**
   * Publishes the background's column. Its sections are `backgroundColumn`'s
   * values, exactly the shape `perKindColumn` returns, so the same section root
   * renders them and the background is not a lesser surface. There is no lead:
   * the layer has no arrange actions to carry.
   */
  const renderBackground = (): void => {
    const view: SelectionView = {
      targetRevision: background.beginDescribe(),
      subject: {
        name: uiCopy.panels.layerKinds.background,
        // The background is not a scene object, so it has nothing to rename.
        authoredName: "",
        kind: "background",
        key: undefined,
      },
      locked: false,
      sections: backgroundColumn({
        background: options.background?.(),
        assets: options.assets?.() ?? [],
        globals: state.globals,
      }),
    };

    column.publish(view, edits);
    lead.publish({ arrange: [] }, runArrange);
    sectionColumn.publish(
      view,
      edits,
      runEdits,
      chartEdits(),
      cropEdits,
      fontEdits,
    );
  };

  /**
   * Projects the described object and publishes it to React. Every row, the
   * reveal a section may carry and the lead's two questions are the roots' to
   * render — there is nothing left for this module to mount into a rendered
   * container.
   */
  const render = (): void => {
    // A republish replaces the control that owned a held gesture, so a preview
    // still in flight is the edit that gesture made: it is saved before the
    // column moves on. A history restore replaced the document instead, and the
    // value the preview wrote is not what the restored document holds.
    if (state.restoring) state.pendingPreview.clear();
    else if (state.pendingPreview.settle()) commit();
    // Another surface owns the column (the token inspector, while a token is
    // selected), so nothing is projected into a column nobody can see.
    if (state.suppressed) return;
    // The background is no Fabric object: `target()` has nothing to describe
    // for it, so the branch is decided before the Fabric path is entered.
    if (options.backgroundSelected?.() === true) {
      renderBackground();
      return;
    }
    background.describing = false;

    const object = describedTarget(state);

    const ports: ProjectionPorts = {
      globals: state.globals,
      locale: state.locale,
      nodeBindings: options.nodeBindings,
      sampleSource: options.sampleSource,
      geometry: { read: readField },
    };
    const sections =
      object === undefined ? [] : perKindColumn(object, columnContext());

    const view = projectSelection(
      object,
      state.targetRevision,
      ports,
      sections,
    );
    // All three roots read the same selection: the subject root renders the
    // subject and the empty state, the lead renders what the selection itself
    // has to say, and the section root renders the sections and every row in
    // them.
    column.publish(view, edits);
    lead.publish(
      {
        arrange: object === undefined ? [] : arrangeRow(),
      },
      runArrange,
    );
    sectionColumn.publish(
      view,
      edits,
      runEdits,
      chartEdits(),
      cropEdits,
      fontEdits,
      options.onOpenFontPicker,
    );
  };

  return { render };
}
