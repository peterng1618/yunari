import { fontAwesomeSource } from "./icons/fontawesome.js";
import { lineiconsSource } from "./icons/lineicons.js";
import { lucideSource } from "./icons/lucide.js";
import { unsplashSource } from "./images/unsplash.js";
import type { AssetSource } from "./source.js";
import { wallpaperEngineSource } from "./wallpaper-engine.js";

/**
 * The one registry: adding a source is one entry here plus its adapter.
 *
 * A source added here must not require a change under the editor's
 * `asset-finder/` except a category body it declares (spec R2).
 */
export const ASSET_SOURCES: readonly AssetSource[] = [
  lucideSource,
  lineiconsSource,
  fontAwesomeSource,
  unsplashSource,
  wallpaperEngineSource,
];
