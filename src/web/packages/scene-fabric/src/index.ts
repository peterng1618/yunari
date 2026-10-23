export type { ArtboardSize, SceneBox } from "./artboard-crop.js";
export {
  bottom,
  countable,
  EDGE_TOLERANCE,
  outsideBoxes,
  outsideCount,
  outsideEdges,
  right,
  sceneBoxesOf,
} from "./artboard-crop.js";
export { scaleOf, writeAuthoredBoxDimension } from "./authored-box.js";
/** Fabric ScenePlan renderer. Keep Fabric out of renderer-core; player code uses `fabric/es` StaticCanvas only. */

export type {
  FabricThemeEnvelope,
  FabricThemeEnvelopeInput,
} from "@yunari/renderer-core";
export type { SceneAdapter, SceneAdapterOptions } from "./adapter.js";
export { createSceneAdapter } from "./adapter.js";
export type { ArtboardBackdropOptions } from "./artboard-backdrop.js";
export { artboardBackdrop } from "./artboard-backdrop.js";
export {
  artboardPaintKey,
  cssArtboardPaint,
  fabricArtboardPaint,
  fillArtboardPaint,
} from "./artboard-paint.js";
export {
  type BackgroundMediaHandle,
  type BackgroundMediaOptions,
  type BackgroundMediaSource,
  mountBackgroundMedia,
} from "./background-media.js";
export type {
  ChartSerialisedKey,
  YunariChartOptions,
} from "./chart-object.js";
export {
  CHART_SERIALISED_KEYS,
  withoutEngineAnimation,
  YunariChart,
} from "./chart-object.js";
export { type ChartRefreshRate, startChartRefresh } from "./chart-refresh.js";
export type { UnsupportedReporter } from "./fabric-nodes.js";
export {
  applyAuthoredText,
  type PlanTextObject,
  refreshBoundText,
  YUNARI_TEXT_PROPERTY,
} from "./fabric-text.js";
export { type FontAssetLoadOptions, loadFontAssets } from "./font-assets.js";
export {
  type BackdropMedia,
  createGlass,
  type DeviceRect,
  type GlassHandle,
  type GlassOptions,
} from "./glass.js";
export {
  type FabricAssetReference,
  objectAssetReference,
  setObjectAssetReference,
  YUNARI_ASSET_PROPERTY,
} from "./object-asset.js";
export { holderOf, targetsOf } from "./object-holder.js";
export { isLocked } from "./object-lock.js";
export {
  ARC_FILL_REFUSED,
  applyObjectPalettePaints,
  type FabricPaintRefs,
  type PaintApplicationOptions,
  paintPropertyFor,
  YUNARI_PAINT_PROPERTY,
} from "./object-paint.js";
export {
  applyObjectTypePresets,
  reassignObjectTypePresetReferences,
} from "./object-type.js";
export {
  objectPaletteReferences,
  type PaletteReference,
  reassignObjectPaletteReferences,
} from "./palette-references.js";
export type { SerialisedScene } from "./persist.js";
export {
  assertFabricThemeEnvelopeCompatible,
  disposeScene,
  reviveScene,
  reviveThemeEnvelope,
  SCENE_PERSISTED_PROPERTIES,
  serialiseScene,
  serialiseThemeEnvelope,
} from "./persist.js";
export {
  clampRenderScale,
  DEFAULT_RENDER_SCALE,
  MAX_BACKING_PIXELS,
  MAX_RENDER_SCALE,
} from "./render-scale.js";
export type {
  FabricSceneHandle,
  FabricSceneOptions,
  SceneArtboard,
} from "./scene.js";
export { mountFabricScene } from "./scene.js";
export { Arc, Wedge } from "./sector-object.js";
