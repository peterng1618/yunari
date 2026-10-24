import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { powershellPath } from "../helpers/supervisor.js";

/**
 * Every game launcher's installed apps, read through injected seams so the
 * catalogue is testable without this machine's stores (decision 0110).
 *
 * Each reader is local and read-only: a missing directory or malformed file is
 * an empty list, never an error, because an absent launcher must not take the
 * game provider down. Epic's manifest JSON is the first reader; the seam types
 * below are shared by the later GOG, itch, Xbox and uninstall readers.
 */

export interface InstalledGame {
  readonly source: "steam" | "epic" | "gog" | "itch" | "xbox" | "uninstall";
  readonly name: string;
  readonly installDir: string;
  readonly exes: readonly string[];
}

export interface CatalogueSeams {
  readonly readFile: (file: string) => Promise<string>;
  readonly readdir: (dir: string) => Promise<readonly string[]>;
  readonly programData: string;
  readonly appData: string;
  /** One PowerShell invocation returning parsed JSON, already redacted by the caller. */
  readonly runPowerShell: (script: string) => Promise<unknown>;
  /** Steam's installed apps; defaults to an empty list until Task 1.4 wires it. */
  readonly steamApps: () => Promise<readonly InstalledGame[]>;
  /** Where Xbox titles install; injected so tests never touch the real drive. */
  readonly xboxRoot: string;
}

const POWERSHELL_TIMEOUT_MS = 10_000;

/**
 * One-shot PowerShell: runs a script and parses its JSON stdout. Long-running
 * helpers belong to the 0102 supervisor; a catalogue read is a single call.
 */
async function runPowerShellJson(script: string): Promise<unknown> {
  const executable = powershellPath();

  if (executable === undefined) return undefined;

  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64"),
  ];

  const output = await new Promise<string | undefined>((resolve) => {
    execFile(
      executable,
      args,
      { windowsHide: true, timeout: POWERSHELL_TIMEOUT_MS, encoding: "utf8" },
      (error, stdout) => {
        resolve(error ? undefined : stdout);
      },
    );
  });

  if (output === undefined) return undefined;

  try {
    return JSON.parse(output);
  } catch {
    return undefined;
  }
}

/**
 * The real seams for the provider. Steam's list is empty until Task 1.4 wires
 * `steam-library.ts` in, so no reader depends on the order of that task.
 */
export function defaultCatalogueSeams(): CatalogueSeams {
  return {
    readFile: (file) => fs.readFile(file, "utf8"),
    readdir: (dir) => fs.readdir(dir),
    programData: process.env["ProgramData"] ?? "C:\\ProgramData",
    appData:
      process.env["APPDATA"] ??
      path.win32.join(os.homedir(), "AppData", "Roaming"),
    runPowerShell: runPowerShellJson,
    steamApps: async () => [],
    xboxRoot: "C:\\XboxGames",
  };
}

/** Epic's launcher writes one `.item` per install here. */
const EPIC_MANIFEST_DIRS = [
  "Epic",
  "EpicGamesLauncher",
  "Data",
  "Manifests",
] as const;

function textField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

/**
 * One Epic manifest, or `undefined` when it is a DLC or an incomplete install
 * (decision 0110). A DLC names its parent in `MainGameAppName`; an incomplete
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
    exes: [path.win32.join(installDir, executable)],
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
          : [path.win32.join(installDir, executable)],
    });
  }

  return games;
}

const XBOX_CONTENT_DIR = "Content";
const XBOX_CONFIG_FILE = "MicrosoftGame.config";

/** `MicrosoftGame.config` is XML; these take its executable without a parser. */
const XBOX_EXECUTABLE_PATTERNS = [
  /<Executable\b[^>]*\bName\s*=\s*"([^"]+)"/i,
  /<Executable\b[^>]*>([^<]+)<\/Executable>/i,
  /\bExecutable\s*=\s*"([^"]+)"/i,
] as const;

function executableFromXboxConfig(text: string): string | undefined {
  for (const pattern of XBOX_EXECUTABLE_PATTERNS) {
    const value = pattern.exec(text)?.[1]?.trim();

    if (value !== undefined && value !== "") return value;
  }

  return undefined;
}

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
      path.win32.join(contentDir, XBOX_CONFIG_FILE),
    );
    hasConfig = true;
    configured = executableFromXboxConfig(text);
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
