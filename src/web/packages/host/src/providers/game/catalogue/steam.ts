import type { InstalledGame } from "./catalogue.js";
import type { CatalogueSeams } from "./seams.js";

/**
 * Steam's installed games. The seam already carries catalogue entries, because
 * the default adapter maps the Steam library before it reaches here.
 */
export function readSteamGames(
  seams: CatalogueSeams,
): Promise<readonly InstalledGame[]> {
  return seams.steamApps();
}
