import { type FabricObject, Group } from "fabric/es";

/**
 * Which scene objects an artboard does not contain.
 *
 * Fabric clips the scene's canvas to the artboard rect (`adapter.ts`), so an
 * object outside is drawn nowhere — not shrunk, not scaled away, simply never
 * painted — and an author cannot tell a short dashboard from a broken one. The
 * editor changes the artboard and kept saying the same sentence at every size,
 * which is the same measurement with the number left out.
 *
 * The counting lives here rather than in the surface that reads it because it is
 * a fact about the scene, not about what an inspector chooses to say about it.
 * **The editor's artboard panel is the only reader left.** The player raised the
 * same figure as a crop notice until the user removed it on 2026-10-18:
 * a display says nothing about an overhang now, and
 * every one of them counts.
 */

/** One object in artboard units, as Fabric reports it for the scene plane. */
export interface SceneBox {
  readonly visible: boolean;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /**
   * 0 at the canvas root, one deeper inside a group.
   *
   * `sceneBoxesOf` emits a box before its own children, so the depth alone
   * says which boxes are a box's ancestors — which is what lets the counting
   * below stop at a group that is already outside instead of reporting its
   * parts again.
   */
  readonly depth: number;
}

export interface ArtboardSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Artboard units of slack at an edge. Fabric's own coordinates are fractional,
 * so a panel the author placed flush against the edge must not be reported as
 * cropped over a rounding error; at the tightest fit this repo offers, a unit
 * is a fraction of a pixel.
 */
export const EDGE_TOLERANCE = 1;

/**
 * Objects that can count. An object the author hid is not cropped, so counting
 * it would put a false cause next to the real one; an object with no area paints
 * nothing at any position. Both are the author's own doing.
 *
 * The exclusion lives here rather than in a branch of each reader because
 * `outsideCount`, `outsideEdges` and `outsideBoxes` all go through
 * `countedBoxes`, and both surfaces are handed boxes by `sceneBoxesOf`.
 *
 * **Every overhang counts.** There was a third term — an author's mark that a
 * crop was deliberate — and the user removed it on 2026-10-18:
 * nothing is marked, so an object that runs off the
 * edge on purpose reads as a fault for as long as it stands.
 */
export function countable(box: SceneBox): boolean {
  return box.visible && box.width > 0 && box.height > 0;
}

export function right(box: SceneBox): number {
  return box.left + box.width;
}

export function bottom(box: SceneBox): number {
  return box.top + box.height;
}

/** Whether the artboard does not contain the box. */
function beyond(box: SceneBox, artboard: ArtboardSize): boolean {
  return (
    box.left < -EDGE_TOLERANCE ||
    box.top < -EDGE_TOLERANCE ||
    right(box) > artboard.width + EDGE_TOLERANCE ||
    bottom(box) > artboard.height + EDGE_TOLERANCE
  );
}

/**
 * The boxes a crop notice is made of, in one traversal.
 *
 * `sceneBoxesOf` emits a group before its own children, so one pass with a
 * single depth watermark is enough to know that a box sits inside a group the
 * count already reported. That group is the thing the artboard does not
 * contain: what a display loses is the card, not the seven boxes inside it, and
 * a starter whose cards are groups would otherwise report one cropped card
 * eight times — which destroys the number's only job, telling a reader that a
 * short dashboard is not a broken one.
 *
 * A group the artboard *does* contain is descended into, so a part that runs
 * off on its own is still reported as itself.
 */
function countedBoxes(
  boxes: readonly SceneBox[],
  artboard: ArtboardSize,
): { readonly counted: number; readonly outside: readonly SceneBox[] } {
  const outside: SceneBox[] = [];
  let counted = 0;
  // The depth of the node already reported as outside, or undefined while the
  // walk is outside no such subtree.
  let reportedAt: number | undefined;
  for (const box of boxes) {
    if (reportedAt !== undefined) {
      // Deeper than it, so it belongs to that node rather than standing alone.
      if (box.depth > reportedAt) continue;
      // Back at its level or above: this subtree is over.
      reportedAt = undefined;
    }
    if (!countable(box)) continue;
    counted += 1;
    if (beyond(box, artboard)) {
      outside.push(box);
      reportedAt = box.depth;
    }
  }
  return { counted, outside };
}

/** Which edges ran off the frame, in a fixed order so a theme reads the same. */
export function outsideEdges(
  boxes: readonly SceneBox[],
  artboard: ArtboardSize,
): readonly ("left" | "right" | "top" | "bottom")[] {
  const outside = countedBoxes(boxes, artboard).outside;
  const edges: ("left" | "right" | "top" | "bottom")[] = [];
  if (outside.some((box) => right(box) > artboard.width + EDGE_TOLERANCE)) {
    edges.push("right");
  }
  if (outside.some((box) => bottom(box) > artboard.height + EDGE_TOLERANCE)) {
    edges.push("bottom");
  }
  if (outside.some((box) => box.left < -EDGE_TOLERANCE)) edges.push("left");
  if (outside.some((box) => box.top < -EDGE_TOLERANCE)) edges.push("top");
  return edges;
}

/**
 * How many countable objects the artboard does not contain, out of how many it
 * could. The total is what makes the figure a proportion of the dashboard
 * rather than a bare complaint.
 */
export function outsideCount(
  boxes: readonly SceneBox[],
  artboard: ArtboardSize,
): { readonly outside: number; readonly counted: number } {
  const { counted, outside } = countedBoxes(boxes, artboard);
  return { outside: outside.length, counted };
}

/** The boxes the artboard does not contain, one per thing that is lost. */
export function outsideBoxes(
  boxes: readonly SceneBox[],
  artboard: ArtboardSize,
): readonly SceneBox[] {
  return countedBoxes(boxes, artboard).outside;
}

/**
 * Fabric objects as the boxes this counts, groups flattened to their children.
 *
 * A group is a box AND its children, not one or the other: the group is what
 * Fabric draws and what a display loses, and its children are what an author
 * selects and moves.
 */
export function sceneBoxesOf(
  objects: readonly FabricObject[],
  depth = 0,
): SceneBox[] {
  return objects.flatMap((object) => {
    const rect = object.getBoundingRect();
    // An object that has not been laid out reports no rect, and reading it
    // would take the whole editor down over a count.
    if (rect === undefined) return [];
    const box: SceneBox = {
      visible: object.visible,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      depth,
    };
    return object instanceof Group
      ? [box, ...sceneBoxesOf(object.getObjects(), depth + 1)]
      : [box];
  });
}
