import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { powershellPath } from "../../helpers/supervisor.js";
import {
  readSteamApps as readSteamAppsFromDisk,
  resolveSteamRoot as resolveSteamRootFromRegistry,
  type SteamApp,
} from "../steam-library.js";

/**
 * Every game launcher's installed apps, read through injected seams so the
 * catalogue is testable without this machine's stores.
 *
 * Each reader is local and read-only: a missing directory or malformed file is
 * an empty list, never an error, because an absent launcher must not take the
 * game provider down.
 */

import type { InstalledGame } from "./catalogue.js";

export interface CatalogueSeams {
  readonly readFile: (file: string) => Promise<string>;
  readonly readdir: (dir: string) => Promise<readonly string[]>;
  readonly programData: string;
  readonly appData: string;
  /** One PowerShell invocation returning parsed JSON, already redacted by the caller. */
  readonly runPowerShell: (script: string) => Promise<unknown>;
  /** Steam's installed apps, already in catalogue shape; the default adapter
   *  resolves Steam's root and maps its library. */
  readonly steamApps: () => Promise<readonly InstalledGame[]>;
  /** Where Xbox titles install; injected so tests never touch the real drive. */
  readonly xboxRoot: string;
}

const POWERSHELL_TIMEOUT_MS = 10_000;

/**
 * One-shot PowerShell: runs a script and parses its JSON stdout. Long-running
 * helpers belong to the supervisor; a catalogue read is a single call.
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

/** Steam's registry and disk reads, injected so tests use neither. */
export interface CatalogueSeamOptions {
  readonly resolveSteamRoot?: () => Promise<string | undefined>;
  readonly readSteamApps?: (root: string) => Promise<readonly SteamApp[]>;
}

/**
 * The real seams for the provider. Steam's apps come from `steam-library.ts`
 * through the injectable adapter below; a missing root or unreadable library is
 * no Steam apps, not a failure.
 */
export function defaultCatalogueSeams(
  options: CatalogueSeamOptions = {},
): CatalogueSeams {
  const resolveRoot = options.resolveSteamRoot ?? resolveSteamRootFromRegistry;
  const readApps = options.readSteamApps ?? readSteamAppsFromDisk;

  return {
    readFile: (file) => fs.readFile(file, "utf8"),
    readdir: (dir) => fs.readdir(dir),
    programData: process.env["ProgramData"] ?? "C:\\ProgramData",
    appData:
      process.env["APPDATA"] ??
      path.win32.join(os.homedir(), "AppData", "Roaming"),
    runPowerShell: runPowerShellJson,
    steamApps: async () => {
      try {
        const root = await resolveRoot();

        if (root === undefined) return [];

        const apps = await readApps(root);

        return apps.map((app) => ({
          source: "steam" as const,
          name: app.name,
          installDir: app.installDir,
          exes: [],
        }));
      } catch {
        return [];
      }
    },
    xboxRoot: "C:\\XboxGames",
  };
}

export function textField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

/** PowerShell booleans arrive as JSON booleans or as the string `"True"`. */
export function isTrueFlag(value: unknown): boolean {
  return (
    value === true ||
    (typeof value === "string" && value.trim().toLowerCase() === "true")
  );
}
