import path from "node:path";
import type { InstalledGame } from "./catalogue.js";
import { executableFromGameConfig, GAME_CONFIG_FILE } from "./game-config.js";
import type { CatalogueSeams } from "./seams.js";

const XBOX_CONTENT_DIR = "Content";

/** One title under the Xbox root, or `undefined` when it names no launcher. */
async function readXboxTitle(
  seams: CatalogueSeams,
  titleDir: string,
): Promise<InstalledGame | undefined> {
  const contentDir = path.win32.join(titleDir, XBOX_CONTENT_DIR);
  let configured: string | undefined;
  let hasConfig = false;

  try {
    const text = await seams.readFile(
      path.win32.join(contentDir, GAME_CONFIG_FILE),
    );
    hasConfig = true;
    configured = executableFromGameConfig(text);
  } catch {
    hasConfig = false;
  }

  // A config that names no executable is not the fallback case; the title is
  // unreadable rather than config-less.
  if (hasConfig && configured === undefined) return undefined;

  let executable = configured;

  if (executable === undefined) {
    let entries: readonly string[];

    try {
      entries = await seams.readdir(contentDir);
    } catch {
      return undefined;
    }

    const candidates = entries.filter((entry) =>
      entry.toLowerCase().endsWith(".exe"),
    );

    if (candidates.length !== 1) return undefined;
    executable = candidates[0];
  }

  if (executable === undefined) return undefined;

  return {
    source: "xbox",
    name: path.win32.basename(titleDir),
    installDir: contentDir,
    exes: [
      path.win32.isAbsolute(executable)
        ? executable
        : path.win32.join(contentDir, executable),
    ],
  };
}

/**
 * Every Xbox title under the root, one directory level deep. A title with no
 * config is accepted only when `Content` holds exactly one executable; zero or
 * several is ambiguous and skipped.
 */
export async function readXboxGames(
  seams: CatalogueSeams,
): Promise<readonly InstalledGame[]> {
  let titles: readonly string[];

  try {
    titles = await seams.readdir(seams.xboxRoot);
  } catch {
    return [];
  }

  const games: InstalledGame[] = [];

  for (const title of titles) {
    const game = await readXboxTitle(
      seams,
      path.win32.join(seams.xboxRoot, title),
    );

    if (game !== undefined) games.push(game);
  }

  return games;
}
