/**
 * What a theme asks of the display it is given to, read from the envelope
 * alone.
 *
 * Two facts, both already the document's: a background whose declared asset is
 * a video, and a panel carrying a glass treatment. The asset's own declaration
 * decides its type — the model refuses to infer one from a path — and a
 * treatment is read with `glass.ts`'s guard rather than a shape re-tested here.
 * Nothing is opened, nothing is revived, and no renderer is needed: this runs
 * where a theme is listed, which is before any display has it.
 */

import { isGlassTreatment, YUNARI_GLASS_PROPERTY } from "./glass.js";

/**
 * A cost worth saying out loud before a theme is given to a display. The list
 * is the surface's whole vocabulary: a cost that is not here is not shown, and
 * the two are told apart because they are different problems — a repaint on any
 * device, and a PC that can never idle.
 */
export type PerformanceCost = "glass-over-video" | "video-background";

/** Every object in the scene's own JSON tree, a group's children included. */
function* sceneObjects(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) {
    for (const entry of value) yield* sceneObjects(entry);
    return;
  }
  if (typeof value !== "object" || value === null) return;

  const node = value as Record<string, unknown>;
  yield node;
  yield* sceneObjects(node["objects"]);
}

/** Whether any object in the scene carries a treatment the editor could write. */
function hasGlass(scene: unknown): boolean {
  for (const object of sceneObjects(scene)) {
    if (isGlassTreatment(object[YUNARI_GLASS_PROPERTY])) return true;
  }
  return false;
}

/**
 * The declared kind of the asset the background layer names, or undefined when
 * the envelope does not say. `gif` needs no case of its own: a background
 * accepts only image, SVG and video, so "video" is the whole of the test.
 */
function backgroundAssetKind(document: Record<string, unknown>): unknown {
  const background = document["background"];
  if (typeof background !== "object" || background === null) return undefined;

  const media = (background as Record<string, unknown>)["media"];
  if (typeof media !== "object" || media === null) return undefined;

  const assetId = (media as Record<string, unknown>)["assetId"];
  const assets = document["assets"];
  if (typeof assetId !== "string" || !Array.isArray(assets)) return undefined;

  const declared = assets.find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as Record<string, unknown>)["id"] === assetId,
  );

  return declared === undefined
    ? undefined
    : (declared as Record<string, unknown>)["kind"];
}

/**
 * What this theme costs, in a stable order, or nothing when it costs nothing
 * worth saying.
 *
 * Takes `unknown` and never throws. It runs on a theme the host has on disk,
 * and a listing is the wrong place to raise: a malformed envelope has no costs,
 * rather than an exception that would fail the whole list.
 */
export function performanceCostsOf(
  envelope: unknown,
): readonly PerformanceCost[] {
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    Array.isArray(envelope)
  ) {
    return [];
  }

  const document = envelope as Record<string, unknown>;
  if (backgroundAssetKind(document) !== "video") return [];

  // Glass over a video is the repaint; a video alone is the idle. One answer
  // rather than two, because the first is the cost of the pair.
  return [
    hasGlass(document["scene"]) ? "glass-over-video" : "video-background",
  ];
}
