import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { powershellPath } from "../../helpers/supervisor.js";

/**
 * Every game launcher's installed apps, read through injected seams so the
 * catalogue is testable without this machine's stores (decision 0110).
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
