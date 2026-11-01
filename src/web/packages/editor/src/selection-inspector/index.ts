import type { FabricGlobals } from "@yunari/renderer-core";
import { OBJECT_LOCK_CHANGED_EVENT } from "../object-lock-manager/index.js";
import { createBackgroundFunnel } from "./background-edits.js";
import { createSelectionColumnRoot } from "./column.js";
import { createFieldDispatch } from "./dispatch.js";
import { createEditPorts } from "./edit-ports.js";
import { createInspectorRoot } from "./inspector.js";
import type { SelectionInspectorOptions } from "./options.js";
import { createProjection } from "./projection.js";
import { createSelectionLeadRoot } from "./selection-lead.js";
import { createSelectionState } from "./selection-state.js";

/**
 * Properties of the selected object. An author's most common action is "select a
 * thing, change a thing", which had no control surface at all: the inspector
 * offered only document-level settings.
 *
 * The surface itself — which sections a selection gets, and which question each
 * field answers — is `perKindColumn`, which returns it as data. This module owns
 * the object: which one is described (`selection-state.ts`), how a field writes
 * it and the commit path (`dispatch.ts`), the background's own funnel
 * (`background-edits.ts`) and the publication to React (`projection.ts`). Reads
 * the live Fabric object and writes through the canvas, saving history once per
 * committed edit (§67). Whole artboard units (§57).
 *
 * The column renders through React now: `render` projects a
 * serializable `SelectionView` from Fabric and publishes it to the React root.
 * React holds that value and never the object it describes, which is what keeps
 * Fabric out of React and one writer of the scene.
 */

export interface SelectionInspector {
  readonly root: HTMLElement;
  /** Re-reads the active object; call on every selection change. */
  render(): void;
  /** Theme globals changed, so a displayed resolution may have too. */
  setGlobals(next: FabricGlobals | undefined): void;
  /** The document's language changed, so a formatted preview may have too. */
  setLocale(next: string | undefined): void;
  /**
   * Whether another surface owns this column for now — the token inspector,
   * while a token is selected.
   *
   * Inline `display`, not a class or the `hidden` attribute: the root carries
   * Tailwind display utilities, and either of those loses to them in the
   * cascade. `render()` is a no-op while suppressed, so the hidden column does
   * not project an object nobody can see; clearing it re-renders.
   */
  setSuppressed(suppressed: boolean): void;
  /** Unmounts the three trees and detaches the column. A host that replaces the
   *  inspector needs this: a portal is removed against the container it was
   *  opened in, and a detached container makes that removal throw. */
  destroy(): void;
}

export function createSelectionInspector(
  host: HTMLElement,
  options: SelectionInspectorOptions,
): SelectionInspector {
  const state = createSelectionState(options.editor, options.globals);
  const background = createBackgroundFunnel(options);
  const editor = state.editor;

  const root = document.createElement("section");
  root.dataset["yunariPanel"] = "selection";
  host.append(root);

  // Three React roots share the column, in document order: the subject and the
  // empty state; the lead — the arrange actions and the one refusal the
  // subject's kind carries, which are the selection's own rather than a
  // property of it; then the sections, header, count, open state and every row
  // under them. Splitting them rather than growing one root is what keeps each
  // value beside the code that projects it, and the order here is the order the
  // imperative column had.
  const reactHost = document.createElement("div");
  const leadHost = document.createElement("div");
  const sectionsHost = document.createElement("div");
  root.append(reactHost, leadHost, sectionsHost);
  const column = createInspectorRoot(reactHost);
  const lead = createSelectionLeadRoot(leadHost);
  const sectionColumn = createSelectionColumnRoot(sectionsHost);

  // The write ports and the projection need each other: an edit re-renders, and
  // a render publishes the edit ports. The holder breaks the cycle without a
  // second owner of either.
  let rerender = (): void => {};
  const dispatcher = createFieldDispatch({
    state,
    options,
    background,
    rerender: () => rerender(),
  });
  const editPorts = createEditPorts({
    state,
    options,
    commit: dispatcher.commit,
    stillTarget: dispatcher.stillTarget,
    rerender: () => rerender(),
  });
  const projection = createProjection({
    state,
    options,
    background,
    roots: { column, lead, sectionColumn },
    dispatcher,
    editPorts,
  });
  rerender = projection.render;

  // Fabric reports a finished drag/resize/rotate as `object:modified`; the fields
  // must follow it or they would show stale numbers.
  editor.canvas.on("object:modified", rerender);
  editor.canvas.on("selection:created", rerender);
  editor.canvas.on("selection:updated", rerender);
  editor.canvas.on("selection:cleared", rerender);
  // A deletion fires no selection event — the active object is discarded first,
  // so the panel went on showing the deleted object's name and geometry while
  // the layer list and canvas had both moved on. The three surfaces disagreed
  // about what the document contained.
  editor.canvas.on("object:removed", rerender);
  editor.canvas.on("object:added", rerender);
  // A lock change writes the object and fires no other event (vg-148), so the
  // lock manager notifies and the column follows it rather than offering the
  // writing fields it will refuse.
  editor.canvas.on(OBJECT_LOCK_CHANGED_EVENT as never, rerender);
  // Restoring history rebuilds the scene and drops the selection; the fields
  // must re-bind to the same object rather than vanishing. Scoped to this one
  // render, because every *other* loss of selection is the author deselecting
  // and the column must empty for that — `try`/`finally` so a throw inside
  // `render` cannot leave the flag armed for the next deselect.
  editor.canvas.on("editor:history-state-loaded" as never, () => {
    state.restoring = true;
    try {
      rerender();
    } finally {
      state.restoring = false;
    }
  });

  rerender();

  return {
    root,
    render: projection.render,
    setGlobals(next) {
      state.globals = next;
      rerender();
    },
    setLocale(next) {
      state.locale = next;
      rerender();
    },
    setSuppressed(next) {
      if (next === state.suppressed) return;
      state.suppressed = next;
      if (next) {
        root.style.display = "none";
        return;
      }
      root.style.removeProperty("display");
      rerender();
    },
    destroy() {
      column.destroy();
      lead.destroy();
      sectionColumn.destroy();
      root.remove();
    },
  };
}
