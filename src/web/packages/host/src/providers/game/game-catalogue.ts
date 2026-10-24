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
