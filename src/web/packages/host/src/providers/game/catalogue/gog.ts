import path from "node:path";
import type { InstalledArtwork, InstalledGame } from "./catalogue.js";
import { type CatalogueSeams, textField } from "./seams.js";

/**
 * GOG's launcher keeps one registry key per install. A single PowerShell call
 * enumerates them; the seam returns parsed JSON, so an unreadable registry is
 * `undefined` rather than a throw.
 */
const GOG_REGISTRY_SCRIPT = [
  "$games = Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\*' -ErrorAction SilentlyContinue",
  "ConvertTo-Json -InputObject @($games) -Compress",
].join("; ");

/** A GOG product id; the registry names it as the key and as `gameId`. */
const GOG_GAME_ID = /^\d{1,12}$/;

/**
 * The launcher's own icon, which GOG writes as `goggame-<gameId>.ico` in the
 * install root. A plain installer may carry only `gog.ico`, which names no
 * game, so that file is not art for this entry.
 */
async function findArtwork(
  seams: CatalogueSeams,
  installDir: string,
  record: Record<string, unknown>,
): Promise<InstalledArtwork | undefined> {
  const id = textField(record, "gameId") ?? textField(record, "PSChildName");

  if (id === undefined || !GOG_GAME_ID.test(id)) return undefined;

  const expected = `goggame-${id}.ico`.toLowerCase();
  let entries: readonly string[];

  try {
    entries = await seams.readdir(installDir);
  } catch {
    return undefined;
  }

  const name = entries.find((entry) => entry.toLowerCase() === expected);

  return name === undefined
    ? undefined
    : {
        source: "gog",
        id,
        file: path.win32.join(installDir, name),
        extension: "ico",
      };
}

/**
 * Every GOG install this machine's launcher registers. A DLC names its parent
 * in `dependsOn`, and an entry without a name or install path is not a game.
 */
export async function readGogGames(
  seams: CatalogueSeams,
): Promise<readonly InstalledGame[]> {
  let answer: unknown;

  try {
    answer = await seams.runPowerShell(GOG_REGISTRY_SCRIPT);
  } catch {
    return [];
  }

  if (!Array.isArray(answer)) return [];

  const games: InstalledGame[] = [];

  for (const entry of answer) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      continue;
    }

    const record = entry as Record<string, unknown>;

    if (textField(record, "dependsOn") !== undefined) continue;

    const name = textField(record, "gameName");
    const installDir = textField(record, "path");

    if (name === undefined || installDir === undefined) continue;

    const executable = textField(record, "exe");
    const artwork = await findArtwork(seams, installDir, record);

    games.push({
      source: "gog",
      name,
      installDir,
      exes:
        executable === undefined
          ? []
          : [
              path.win32.isAbsolute(executable)
                ? executable
                : path.win32.join(installDir, executable),
            ],
      ...(artwork === undefined ? {} : { artwork }),
    });
  }

  return games;
}
