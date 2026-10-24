import path from "node:path";
import type { InstalledGame } from "./catalogue.js";
import type { CatalogueSeams } from "./seams.js";

const ITCH_APPS_DIRS = ["itch", "apps"] as const;
const ITCH_MANIFEST_FILE = ".itch.toml";

/**
 * `.itch.toml` in the shape this reader consumes: `name` in the root or `[app]`
 * table, `exe` beside it, and the first `[[actions]]` entry's `path`. Any other
 * line is ignored; the file is small and a TOML dependency is not warranted.
 */
function parseItchManifest(text: string): {
  readonly name: string | undefined;
  readonly executable: string | undefined;
} {
  let table = "";
  let name: string | undefined;
  let exe: string | undefined;
  let actionPath: string | undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line === "" || line.startsWith("#")) continue;

    const header = /^\[\[?([^\]]*)\]\]?$/.exec(line);

    if (header !== null) {
      table = (header[1] ?? "").trim();
      continue;
    }

    const pair = /^([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"/.exec(line);

    if (pair === null) continue;

    const key = pair[1]?.toLowerCase();
    // TOML basic strings write a literal backslash as `\\`.
    const value = (pair[2]?.trim() ?? "").replace(/\\\\/g, "\\");

    if (key === undefined || value === "") continue;

    if (key === "name" && (table === "" || table === "app")) {
      name ??= value;
    } else if (key === "exe" && (table === "" || table === "app")) {
      exe ??= value;
    } else if (key === "path" && table === "actions") {
      actionPath ??= value;
    }
  }

  return { name, executable: exe ?? actionPath };
}

function itchExecutable(executable: string, appDir: string): string {
  return path.win32.isAbsolute(executable)
    ? executable
    : path.win32.join(appDir, executable);
}

/** One app directory: its manifest when readable, else its own executables. */
async function readItchApp(
  seams: CatalogueSeams,
  appDir: string,
  directoryName: string,
): Promise<InstalledGame | undefined> {
  let text: string | undefined;

  try {
    text = await seams.readFile(path.win32.join(appDir, ITCH_MANIFEST_FILE));
  } catch {
    text = undefined;
  }

  if (text !== undefined) {
    const manifest = parseItchManifest(text);

    return {
      source: "itch",
      name: manifest.name ?? directoryName,
      installDir: appDir,
      exes:
        manifest.executable === undefined
          ? []
          : [itchExecutable(manifest.executable, appDir)],
    };
  }

  // No readable manifest: only the app directory's own files can name a
  // launcher, and a folder with none is not an install this reader can report.
  let entries: readonly string[];

  try {
    entries = await seams.readdir(appDir);
  } catch {
    return undefined;
  }

  const exes = entries
    .filter((entry) => entry.toLowerCase().endsWith(".exe"))
    .map((entry) => path.win32.join(appDir, entry));

  if (exes.length === 0) return undefined;

  return {
    source: "itch",
    name: directoryName,
    installDir: appDir,
    exes,
  };
}

/** Every app itch's launcher manages: one child directory of `apps` per game. */
export async function readItchGames(
  seams: CatalogueSeams,
): Promise<readonly InstalledGame[]> {
  const root = path.win32.join(seams.appData, ...ITCH_APPS_DIRS);
  let entries: readonly string[];

  try {
    entries = await seams.readdir(root);
  } catch {
    return [];
  }

  const games: InstalledGame[] = [];

  for (const entry of entries) {
    const game = await readItchApp(seams, path.win32.join(root, entry), entry);

    if (game !== undefined) games.push(game);
  }

  return games;
}
