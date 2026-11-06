import { colorhuntSource } from "./colours/colorhunt.js";
import { colorswoopSource } from "./colours/colorswoop.js";
import { curatedFontSource } from "./fonts/curated.js";
import { googleFontSource } from "./fonts/google.js";
import { uigradientsSource } from "./gradients/uigradients.js";
import { webgradientsSource } from "./gradients/webgradients.js";
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
 * `asset-finder/` except a category body it declares (R2).
 */
export const ASSET_SOURCES: readonly AssetSource[] = [
  lucideSource,
  lineiconsSource,
  fontAwesomeSource,
  unsplashSource,
  colorhuntSource,
  colorswoopSource,
  uigradientsSource,
  webgradientsSource,
  curatedFontSource,
  googleFontSource,
  wallpaperEngineSource,
];

/**
 * Built-ins first, then plugin sources. One id names one source: a plugin may
 * neither shadow a built-in nor another plugin.
 */
export function createAssetSources(
  builtins: readonly AssetSource[],
  plugins: readonly AssetSource[],
): readonly AssetSource[] {
  const sources: AssetSource[] = [];
  const seen = new Set<string>();

  for (const source of [...builtins, ...plugins]) {
    if (seen.has(source.id))
      throw new Error(`"${source.id}" is already an asset source`);
    seen.add(source.id);
    sources.push(source);
  }

  return sources;
}
