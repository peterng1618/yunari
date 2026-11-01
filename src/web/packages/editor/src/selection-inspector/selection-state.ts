import type { FabricGlobals } from "@yunari/renderer-core";
import type { FabricObject } from "fabric/es";
import type { EditorInteraction } from "../editor-interaction.js";
import { createPendingPreview } from "./pending-preview.js";

/**
 * The state one inspector closes over.
 *
 * It exists as a value rather than a set of module-level locals so the pieces
 * that read it — the target resolver, the write dispatch and the projection —
 * share one owner instead of each holding a private copy. Only `createSelectionInspector`
 * mutates `globals`, `locale` and `suppressed`, through its public methods.
 */
export interface SelectionState {
  readonly editor: EditorInteraction;
  /** Theme globals, so a token's resolution can be shown. */
  globals: FabricGlobals | undefined;
  /** The document's language; a format preview is spelled in it. */
  locale: string | undefined;
  /** Whether another surface owns the column; see `SelectionInspector.setSuppressed`. */
  suppressed: boolean;
  /**
   * The last object the fields described, kept only so a history restore can
   * re-bind. Restoring rebuilds the scene and drops Fabric's selection, so an
   * author who undoes an edit would otherwise lose the panel they were working
   * in; the object's Yunari id survives the restore, so the fields find it
   * again.
   *
   * **Deliberately not cleared when the selection goes away.** A restore fires
   * Fabric's own `selection:cleared` too, and clearing here would empty this
   * before `restoring` was ever consulted — the memory has to outlive the
   * deselect it must not be used for.
   */
  bound: FabricObject | undefined;
  /** True only for the render a history load triggers. */
  restoring: boolean;
  /**
   * The identity token for the object a published view describes. Bumped
   * whenever the described target is replaced, cleared, removed, rehydrated by
   * history or changed by crop context — a document id cannot identify an
   * `ActiveSelection`, so the object's own identity is the token.
   */
  targetRevision: number;
  described: FabricObject | undefined;
  /** The one slider preview that has been written but neither committed nor
   *  cancelled (`pending-preview.ts`). */
  readonly pendingPreview: ReturnType<typeof createPendingPreview>;
}

export function createSelectionState(
  editor: EditorInteraction,
  globals: FabricGlobals | undefined,
): SelectionState {
  return {
    editor,
    globals,
    locale: undefined,
    suppressed: false,
    bound: undefined,
    restoring: false,
    targetRevision: 0,
    described: undefined,
    pendingPreview: createPendingPreview(),
  };
}

function objectById(
  state: SelectionState,
  id: unknown,
): FabricObject | undefined {
  if (typeof id !== "string") {
    return undefined;
  }

  const find = (objects: readonly FabricObject[]): FabricObject | undefined => {
    for (const object of objects) {
      if (object.get("id") === id) {
        return object;
      }

      const children = (
        object as { getObjects?: () => FabricObject[] }
      ).getObjects?.();
      if (children !== undefined) {
        const nested = find(children);
        if (nested !== undefined) {
          return nested;
        }
      }
    }

    return undefined;
  };

  return find(state.editor.canvas.getObjects());
}

/**
 * The object to describe: the live selection, or the re-bound one across a
 * history restore. **A deselect is neither**, and the column empties for it.
 *
 * A crop session is the exception: it makes its own frame the active object,
 * so following the selection would describe that frame rather than the image
 * the author is cropping. The session names its image, and the fields stay
 * bound to it until the session ends.
 */
export function targetOf(state: SelectionState): FabricObject | undefined {
  const cropping = state.editor.cropManager.target;
  if (cropping !== undefined) {
    state.bound = cropping;
    return cropping;
  }

  const active = state.editor.canvas.getActiveObject() ?? undefined;
  if (active !== undefined) {
    state.bound = active;
    return active;
  }

  if (state.restoring && state.bound !== undefined) {
    const again = objectById(state, state.bound.get("id"));
    state.bound = again;
    return again;
  }

  return undefined;
}

/**
 * Resolves the target and bumps the revision when it is a different object, so
 * a published view names the object it was projected from.
 */
export function describedTarget(
  state: SelectionState,
): FabricObject | undefined {
  const object = targetOf(state);
  if (object !== state.described) {
    state.described = object;
    state.targetRevision += 1;
  }
  return object;
}
