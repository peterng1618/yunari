/**
 * Presence and Start for the two external programs the tray can offer. Both are
 * Windows-only; everywhere else the rows are absent and Start explains why.
 * RTSS starts only on an explicit request and is never stopped (ADR 0110);
 * LHM is stopped only when this module started it (ADR 0111).
 */

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { launchLhm as launchLhmDefault } from "../providers/lhm-launcher.js";
import type { ExternalAppState } from "./menu.js";

export interface ActionResult {
  readonly ok: boolean;
  readonly message: string;
  /** Foreground mode uses the existing LHM banner; the tray only needs `ok`. */
  readonly started?: boolean;
  readonly reason?: string;
}

interface FetchLike {
  (
    url: string,
    init?: { readonly signal: AbortSignal },
  ): Promise<{ readonly ok: boolean }>;
}

/** The slice of a spawned child this module uses. */
export interface SpawnedProcess {
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  unref(): void;
}

type SpawnProcess = (
  executable: string,
  args: readonly string[],
  options: {
    readonly detached: boolean;
    readonly stdio: "ignore";
    readonly windowsHide: boolean;
  },
) => SpawnedProcess;

interface LaunchedLhm {
  readonly started: boolean;
  readonly reason?: string;
  readonly stop: () => void;
}

type LaunchLhm = (options: {
  readonly executable: string;
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  readonly fetcher?: (url: string) => Promise<{ readonly ok: boolean }>;
}) => Promise<LaunchedLhm>;

export interface ExternalAppsOptions {
  readonly lhmUrl: string;
  /** `--lhm-exe`, the path the owner named. */
  readonly lhmExecutable?: string;
  /** The vendored copy, when one is staged. */
  readonly lhmDefaultExecutable?: string;
  /** `--rtss-exe`, the path the owner named. */
  readonly rtssExecutable?: string;
  readonly platform?: NodeJS.Platform;
  readonly exists?: (file: string) => boolean;
  readonly listProcesses?: (image: string) => Promise<boolean>;
  readonly fetchImpl?: FetchLike;
  readonly spawnProcess?: SpawnProcess;
  readonly launchLhm?: LaunchLhm;
}

export interface ExternalApps {
  findLhmExecutable(): string | undefined;
  findRtssExecutable(): string | undefined;
  lhmState(): Promise<ExternalAppState>;
  rtssState(): Promise<ExternalAppState>;
  startLhm(): Promise<ActionResult>;
  startRtss(): Promise<ActionResult>;
  stopOwnedLhm(): void;
}

const LHM_NAME = "LibreHardwareMonitor";
const RTSS_NAME = "RivaTuner Statistics Server";
const LHM_IMAGE = "LibreHardwareMonitor.exe";
const RTSS_IMAGE = "RTSS.exe";

const LHM_STANDARD_PATHS = [
  "C:\\Program Files\\LibreHardwareMonitor\\LibreHardwareMonitor.exe",
  "C:\\Program Files (x86)\\LibreHardwareMonitor\\LibreHardwareMonitor.exe",
] as const;

const RTSS_STANDARD_PATHS = [
  "C:\\Program Files (x86)\\RivaTuner Statistics Server\\RTSS.exe",
  "C:\\Program Files\\RivaTuner Statistics Server\\RTSS.exe",
] as const;

const ABSENT: ExternalAppState = { installed: false, running: false };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function firstCsvField(line: string): string {
  const open = line.indexOf('"');
  if (open !== -1) {
    const close = line.indexOf('"', open + 1);
    if (close !== -1) return line.slice(open + 1, close);
  }
  return line.split(",")[0]?.trim() ?? "";
}

/** Matches the image name in the first CSV field, never localized prose. */
export function parseTasklistImage(stdout: string, image: string): boolean {
  const wanted = image.trim().toLowerCase();
  return stdout
    .split(/\r?\n/)
    .some(
      (line) =>
        line.trim() !== "" && firstCsvField(line).toLowerCase() === wanted,
    );
}

function defaultListProcesses(image: string): Promise<boolean> {
  if (process.platform !== "win32") return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile(
      "tasklist",
      ["/FI", `IMAGENAME eq ${image}`, "/FO", "CSV", "/NH"],
      { timeout: 3000, windowsHide: true },
      (error, stdout) => {
        resolve(error === null && parseTasklistImage(stdout, image));
      },
    );
  });
}

const defaultSpawn: SpawnProcess = (executable, args, options) =>
  spawn(executable, args, options);

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

export function createExternalApps(options: ExternalAppsOptions): ExternalApps {
  const platform = options.platform ?? process.platform;
  const lhmUrl = options.lhmUrl;
  const exists = options.exists ?? existsSync;
  const listProcesses = options.listProcesses ?? defaultListProcesses;
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const spawnProcess = options.spawnProcess ?? defaultSpawn;
  const launchLhm = options.launchLhm ?? launchLhmDefault;

  let ownedStop: (() => void) | undefined;
  let startingLhm = false;
  let stopping = false;
  let startingRtss = false;

  const existsSafely = (file: string): boolean => {
    try {
      return exists(file);
    } catch {
      return false;
    }
  };

  const firstExisting = (
    candidates: readonly (string | undefined)[],
  ): string | undefined => {
    for (const candidate of candidates) {
      if (candidate !== undefined && existsSafely(candidate)) return candidate;
    }
    return undefined;
  };

  const findLhmExecutable = (): string | undefined => {
    if (platform !== "win32") return undefined;
    return firstExisting([
      options.lhmExecutable,
      options.lhmDefaultExecutable,
      ...LHM_STANDARD_PATHS,
    ]);
  };

  const findRtssExecutable = (): string | undefined => {
    if (platform !== "win32") return undefined;
    return firstExisting([options.rtssExecutable, ...RTSS_STANDARD_PATHS]);
  };

  const processIsRunning = async (image: string): Promise<boolean> => {
    try {
      return await listProcesses(image);
    } catch {
      return false;
    }
  };

  const webServerAnswers = async (): Promise<boolean> => {
    try {
      const response = await fetchImpl(`${lhmUrl}/data.json`, {
        signal: AbortSignal.timeout(1000),
      });
      return response.ok;
    } catch {
      return false;
    }
  };

  const lhmState = async (): Promise<ExternalAppState> => {
    if (platform !== "win32") return ABSENT;
    const executable = findLhmExecutable();
    const httpOk = await webServerAnswers();
    const process = await processIsRunning(LHM_IMAGE);
    const running = httpOk || process;
    const installed = executable !== undefined || running;
    return process && !httpOk
      ? { installed, running, detail: "web server off" }
      : { installed, running };
  };

  const rtssState = async (): Promise<ExternalAppState> => {
    if (platform !== "win32") return ABSENT;
    const executable = findRtssExecutable();
    const process = await processIsRunning(RTSS_IMAGE);
    return { installed: executable !== undefined || process, running: process };
  };

  const startLhm = async (): Promise<ActionResult> => {
    if (platform !== "win32") {
      return {
        ok: false,
        message: `${LHM_NAME} is available on Windows only.`,
      };
    }

    if (ownedStop !== undefined || startingLhm) {
      return { ok: true, message: `${LHM_NAME} is already starting.` };
    }

    if (await webServerAnswers()) {
      return { ok: true, message: `${LHM_NAME} is already running.` };
    }

    if (await processIsRunning(LHM_IMAGE)) {
      return {
        ok: false,
        message: `${LHM_NAME} is running but its web server is off.`,
        started: false,
        reason: "web server off",
      };
    }

    const executable = findLhmExecutable();
    if (executable === undefined) {
      return {
        ok: false,
        message: `${LHM_NAME} was not found. Install it or pass --lhm-exe.`,
      };
    }

    startingLhm = true;
    try {
      const result = await launchLhm({
        executable,
        baseUrl: lhmUrl,
        timeoutMs: 20_000,
        fetcher: (url) => fetchImpl(url),
      });
      startingLhm = false;

      if (result.started) {
        if (stopping) {
          // Exit ran while the launch was still resolving.
          result.stop();
        } else {
          ownedStop = result.stop;
        }
        return {
          ok: true,
          message: `Started ${LHM_NAME}.`,
          started: true,
        };
      }

      return {
        ok: false,
        message: result.reason ?? `${LHM_NAME} did not start.`,
        started: false,
      };
    } catch (error) {
      startingLhm = false;
      return {
        ok: false,
        message: `could not start ${LHM_NAME}: ${messageOf(error)}`,
        started: false,
      };
    }
  };

  const startRtss = (): Promise<ActionResult> => {
    if (platform !== "win32") {
      return Promise.resolve({
        ok: false,
        message: `${RTSS_NAME} is available on Windows only.`,
      });
    }

    // The menu disables the row while RTSS runs, so a second click is the only
    // duplicate to guard; a fresh process probe would race the spawn itself.
    if (startingRtss) {
      return Promise.resolve({
        ok: true,
        message: `${RTSS_NAME} is already starting.`,
      });
    }

    const executable = findRtssExecutable();
    if (executable === undefined) {
      return Promise.resolve({
        ok: false,
        message: `${RTSS_NAME} was not found. Install it or pass --rtss-exe.`,
      });
    }

    startingRtss = true;
    return new Promise((resolve) => {
      let child: SpawnedProcess;
      try {
        child = spawnProcess(executable, [], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        });
      } catch (error) {
        startingRtss = false;
        resolve({
          ok: false,
          message: `could not start ${RTSS_NAME}: ${messageOf(error)}`,
        });
        return;
      }

      child.once("spawn", () => {
        startingRtss = false;
        child.unref();
        resolve({ ok: true, message: `Started ${RTSS_NAME}.` });
      });
      child.once("error", (error) => {
        startingRtss = false;
        resolve({
          ok: false,
          message: `could not start ${RTSS_NAME}: ${messageOf(error)}`,
        });
      });
    });
  };

  const stopOwnedLhm = (): void => {
    stopping = true;
    const stop = ownedStop;
    ownedStop = undefined;
    stop?.();
  };

  return {
    findLhmExecutable,
    findRtssExecutable,
    lhmState,
    rtssState,
    startLhm,
    startRtss,
    stopOwnedLhm,
  };
}
