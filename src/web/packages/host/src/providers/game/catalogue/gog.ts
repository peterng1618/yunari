import path from "node:path";
import type { InstalledGame } from "./catalogue.js";
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
    });
  }

  return games;
}
