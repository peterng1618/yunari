import { type FabricObject, Group } from "fabric/es";

/** Scene objects that are decoration rather than alignable content. The
 * artboard plate spans the whole artboard, so it is "aligned" with every object
 * on the cross axis and its stroke edges sit half a pixel outside the true
 * artboard bounds, winning boundary snaps over the artboard's own source.
 * It is excluded by id — `background` is the plate's conventional id, which
 * the starter used to author and an author can still draw — not by
 * `selectable`, which would also drop locked neighbours. The starter no longer
 * authors one: its backdrop is packaged media mounted below the canvas,
 * so nothing on the canvas spans the artboard. */
export const IGNORED_IDS: readonly string[] = ["background"];

/** The objects one group holds; every other object holds none. The one reader
 * of the scene tree, shared by the exclusion walk and candidate collection. */
export const partsOf = (object: FabricObject): readonly FabricObject[] =>
  object instanceof Group ? object.getObjects() : [];

/** Adds every object below `object`, at any depth. */
function collectParts({
  object,
  into,
}: {
  object: FabricObject;
  into: Set<FabricObject>;
}): void {
  for (const part of partsOf(object)) {
    into.add(part);
    collectParts({ object: part, into });
  }
}

/** Collects the set of objects excluded from processing.
 *
 * The dragged object's own ancestors and its own parts are both excluded
 * (`vg-123`), and the reason is that **everything excluded here travels with the
 * drag**: its own parts move with it, and Fabric re-fits a group's box around the
 * child being dragged — measured in `vg-123`'s fix round on the nested fixture,
 * where the child's own `left` moved `-90.5` while the card's box collapsed from
 * 400×200 onto it. So an ancestor's box, or one of the object's own parts, offers
 * the drag a line that moves with it, which is acquired at every step and pins
 * the drag wherever it starts. A group with a **declared** `width`/`height` keeps
 * that box rather than the parts' union, so the box equality the first version of
 * this comment asserted does not hold; the exclusion does, because the re-fit is
 * what makes the ancestor's box the drag's own line. Neither end was reachable
 * while the candidate set was roots. */
export const collectExcludedObjects = ({
  activeObject,
}: {
  activeObject?: FabricObject | null;
}): Set<FabricObject> => {
  const excluded = new Set<FabricObject>();

  if (!activeObject) return excluded;

  excluded.add(activeObject);
  // Fabric keeps the owning group on `parent`, and a group can itself sit in
  // one, so the whole chain is walked rather than a single hop.
  for (
    let ancestor = activeObject.parent;
    ancestor !== undefined;
    ancestor = ancestor.parent
  ) {
    excluded.add(ancestor);
  }
  collectParts({ object: activeObject, into: excluded });

  return excluded;
};

/** Decides whether an object is excluded as a snap target. */
export const shouldIgnoreObject = ({
  object,
  excluded,
  ignoredIds = IGNORED_IDS,
}: {
  object: FabricObject;
  excluded: Set<FabricObject>;
  ignoredIds?: readonly string[];
}): boolean => {
  if (excluded.has(object)) return true;

  const { visible = true } = object;
  if (!visible) return true;

  const { id } = object as FabricObject & { id?: string };
  if (id && ignoredIds.includes(id)) return true;

  return false;
};
