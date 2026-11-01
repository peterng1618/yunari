import { uiCopy } from "../ui-copy.js";
import { PresetPreview } from "./finder-card.js";
import type { PreviewTarget } from "./finder-model.js";
import type { FinderPreview } from "./preview-modal.js";

/** What the preview surface draws for a double-clicked card, from the target's
 *  own wire result or library item. */
export function previewModel(target: PreviewTarget): FinderPreview {
  if (target.kind === "local") {
    const copy = uiCopy.assets.wallpaperEngine;
    return {
      id: target.item.workshopId,
      name: target.item.title,
      meta: `${copy.kind[target.item.kind]} · ${copy.size(target.item.filesize)}`,
      licence: "unknown",
      sourceUrl: target.item.attribution?.workshopUrl ?? "",
      imageUrl: target.item.previewUrl,
      posterOnly: target.item.kind === "video",
    };
  }
  const result = target.row.result;
  return {
    id: result.id,
    name: result.name,
    meta: result.subtitle ?? "",
    licence: result.licence,
    sourceUrl: result.sourceUrl,
    imageUrl: result.preview === "" ? undefined : result.preview,
    posterOnly: result.kind === "video",
    ...(result.preset === undefined
      ? {}
      : { content: <PresetPreview preset={result.preset} /> }),
  };
}
