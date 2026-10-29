import path from "node:path";
import type { InstalledGame } from "./catalogue.js";
import { type CatalogueSeams, textField } from "./seams.js";

/** Epic's launcher writes one `.item` per install here. */
const EPIC_MANIFEST_DIRS = [
  "Epic",
  "EpicGamesLauncher",
  "Data",
  "Manifests",
] as const;

/**
 * One Epic manifest, or `undefined` when it is a DLC or an incomplete install.
 * A DLC names its parent in `MainGameAppName`; an incomplete
 * install has no executable to match yet.
 */
function parseEpicManifest(text: string): InstalledGame | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }

  const record = parsed as Record<string, unknown>;

  if (record["bIsIncompleteInstall"] === true) return undefined;

  const appName = textField(record, "AppName");
  const mainGame = textField(record, "MainGameAppName");

  if (
    appName !== undefined &&
    mainGame !== undefined &&
    mainGame.toLowerCase() !== appName.toLowerCase()
  ) {
    return undefined;
  }

  const name = textField(record, "DisplayName");
  const installDir = textField(record, "InstallLocation");
  const executable = textField(record, "LaunchExecutable");

  if (
    name === undefined ||
    installDir === undefined ||
    executable === undefined
  ) {
    return undefined;
  }

  return {
    source: "epic",
    name,
    installDir,
    exes: [
      path.win32.isAbsolute(executable)
        ? executable
        : path.win32.join(installDir, executable),
    ],
  };
}

/**
 * Every installed Epic app this machine's launcher describes. A missing
 * manifest directory is no Epic install, not a failure; a single bad file is
 * skipped so its valid neighbours still reach the catalogue.
 */
export async function readEpicGames(
  seams: CatalogueSeams,
): Promise<readonly InstalledGame[]> {
  const dir = path.win32.join(seams.programData, ...EPIC_MANIFEST_DIRS);
  let entries: readonly string[];

  try {
    entries = await seams.readdir(dir);
  } catch {
    return [];
  }

  const games: InstalledGame[] = [];

  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith(".item")) continue;

    let text: string;

    try {
      text = await seams.readFile(path.win32.join(dir, entry));
    } catch {
      continue;
    }

    const game = parseEpicManifest(text);
    if (game !== undefined) games.push(game);
  }

  return games;
}
