import { holderOf, isLocked, targetsOf } from "@yunari/scene-fabric";
import type { Canvas, FabricObject } from "fabric/es";

export interface DeletionManager {
  /** True when at least one object was removed. */
  deleteActive(): boolean;
}

/** A keyboard delete must respect the same lock the panels honour. */
function deletable(object: FabricObject): boolean {
  return !isLocked(object);
}

export function createDeletionManager(
  canvas: Canvas,
  save: () => void,
): DeletionManager {
  return {
    deleteActive(): boolean {
      const active = canvas.getActiveObject();
      if (active === undefined) return false;
      const targets = targetsOf(active).filter(deletable);
      if (targets.length === 0) return false;

      // Resolved before the selection is discarded: an `ActiveSelection` is one
      // of the things that put these objects where they are.
      const removals = targets.map(
        (object) => [holderOf(canvas, object), object] as const,
      );

      canvas.discardActiveObject();
      let removed = 0;
      for (const [owner, object] of removals) {
        if (owner.remove(object).length > 0) {
          removed += 1;
          // Disposed here rather than by the scene adapter (`vg-486`): it no
          // longer disposes whatever anyone removes,
          // because the removal event cannot tell a deletion from a reparent.
          // A root `Group` takes its children with it; a member removed from a
          // group never fired that event at all, so this closes a leak too.
          object.dispose();
        }
      }
      // A removal that found nothing is not a deletion, and recording history
      // for it would leave the entry discarded as unchanged — the editor's state
      // and its claims agreeing on a scene that never moved.
      if (removed === 0) return false;
      canvas.requestRenderAll();
      save();
      return true;
    },
  };
}
