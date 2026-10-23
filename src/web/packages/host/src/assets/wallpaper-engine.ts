import type { AssetSource } from "./source.js";

/**
 * This PC's Wallpaper Engine library, as a finder source.
 *
 * The listing, the previews, the payload bytes and the scene flow are the
 * host's (`wallpaper-engine/source.ts`) and are served at their own routes; this
 * entry exists so the finder's registry names the `local` category and its body.
 * The body fetches `/api/wallpaper-engine` itself, so nothing here is a grid.
 */
export const wallpaperEngineSource: AssetSource = {
  id: "wallpaper-engine",
  label: "Wallpaper Engine",
  category: "local",
  body: "wallpaper-engine",
  requires: undefined,
  configurable: false,
  // A local library is a body, not a grid, and `searchSources` filters
  // `body === "grid"`, so the search route never asks this source.
  search: async () => ({ results: [], next: undefined }),
  // A row's bytes are served at `/api/wallpaper-engine/item/<id>/asset`, which
  // no consumer reaches through this port; a filename invented here would be a
  // second answer to a question this route already answers.
  bytesOf: async () => undefined,
};
