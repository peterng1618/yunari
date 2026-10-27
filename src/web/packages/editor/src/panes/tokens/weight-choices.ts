import type { FaceChoice } from "./token-inspector.js";

/** Lightest first, and `italic` after `normal` at the same weight. */
function compareFaces(a: FaceChoice, b: FaceChoice): number {
  return (
    Number(a.weight) - Number(b.weight) ||
    (a.style === "italic" ? 1 : 0) - (b.style === "italic" ? 1 : 0)
  );
}

/**
 * The weight list a bound preset offers: one entry per `weight|style`, lightest
 * first.
 *
 * A packaged family declares one face per subset, so several faces share a
 * weight and style. Each such group keeps the lexicographically first asset id,
 * so which subset the entry points at never depends on declaration order.
 */
export function weightChoices(
  faces: readonly FaceChoice[],
): readonly FaceChoice[] {
  const byWeight = new Map<string, FaceChoice>();
  for (const face of faces) {
    const key = `${face.weight}|${face.style}`;
    const held = byWeight.get(key);
    if (held === undefined || face.assetId < held.assetId) {
      byWeight.set(key, face);
    }
  }
  return [...byWeight.values()].sort(compareFaces);
}
