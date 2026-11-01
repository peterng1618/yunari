import type { ObjectBounds } from "../bounds.js";

/** One line a source object offers as a snap candidate. */
export type SnapSourceLine<Category extends string> = Readonly<{
  key: "left" | "center-x" | "right" | "top" | "center-y" | "bottom";
  axis: "x" | "y";
  position: number;
  category: Category;
}>;

/** Returns a source object's edges and centres in their stable order. */
export function createSnapSourceLines<Category extends string>({
  bounds,
  edgeCategory,
}: {
  bounds: ObjectBounds;
  edgeCategory: Category;
}): readonly SnapSourceLine<Category>[] {
  return Object.freeze([
    {
      key: "left",
      axis: "x",
      position: bounds.left,
      category: edgeCategory,
    },
    {
      key: "center-x",
      axis: "x",
      position: bounds.centerX,
      category: "center" as Category,
    },
    {
      key: "right",
      axis: "x",
      position: bounds.right,
      category: edgeCategory,
    },
    {
      key: "top",
      axis: "y",
      position: bounds.top,
      category: edgeCategory,
    },
    {
      key: "center-y",
      axis: "y",
      position: bounds.centerY,
      category: "center" as Category,
    },
    {
      key: "bottom",
      axis: "y",
      position: bounds.bottom,
      category: edgeCategory,
    },
  ]);
}

/**
 * Compares candidates by distance, then category priority, then the stable
 * snapshot order. The tolerance makes two equal corrections a tie.
 */
export function isPreferredSnapCandidate<
  Category extends string,
  Candidate extends { category: Category; snapshotIndex: number },
>({
  candidate,
  distance,
  bestCandidate,
  bestDistance,
  priority,
  epsilon,
}: {
  candidate: Candidate;
  distance: number;
  bestCandidate: Candidate | null;
  bestDistance: number;
  priority: Readonly<Record<Category, number>>;
  epsilon: number;
}): boolean {
  if (!bestCandidate) return true;

  const distanceDifference = distance - bestDistance;
  if (distanceDifference < -epsilon) return true;
  if (distanceDifference > epsilon) return false;

  const categoryPriority = priority[candidate.category];
  const bestCategoryPriority = priority[bestCandidate.category];
  if (categoryPriority !== bestCategoryPriority) {
    return categoryPriority < bestCategoryPriority;
  }

  return candidate.snapshotIndex < bestCandidate.snapshotIndex;
}
