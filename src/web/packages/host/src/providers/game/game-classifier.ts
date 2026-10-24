import path from "node:path";
import type { InstalledGame } from "./catalogue/catalogue.js";

/**
 * Decides whether the foreground process is a game from local evidence only:
 * the installed catalogue, runtime markers beside the executable, and the
 * window class plus a sustained fullscreen reading.
 */

export interface ClassifierReading {
  readonly pid: number;
  readonly path?: string;
  readonly name?: string;
  readonly class?: string;
  readonly fullscreen?: boolean;
  readonly d3dFullscreen?: boolean;
}

export interface GameEvidence {
  readonly running: boolean;
  readonly evidence: "catalogue" | "runtime" | "window" | "none";
  readonly game?: InstalledGame;
}

export interface ClassifierState {
  /** Samples, including this one, in which the foreground window was fullscreen. */
  readonly fullscreenSamples: number;
  readonly readdir: (dir: string) => Promise<readonly string[]>;
}

export const GAME_WINDOW_CLASSES = [
  "UnityWndClass",
  "UnrealWindow",
  "SDL_app",
  "GLFW30",
] as const;

export const GAME_MARKER_FILES = [
  "steam_api64.dll",
  "steam_api.dll",
  "EOSSDK-Win64-Shipping.dll",
  "Galaxy64.dll",
  "Galaxy.dll",
  "UnityPlayer.dll",
  "EasyAntiCheat",
  "BattlEye",
  "*.pak",
] as const;

/**
 * Processes that are never a game. `applicationframehost` is the fallback the
 * helper reports when it could not resolve a packaged app's CoreWindow child,
 * so a Store game that did resolve never carries this name.
 */
export const NON_GAME_PROCESSES = [
  "explorer",
  "dwm",
  "searchhost",
  "shellexperiencehost",
  "applicationframehost",
  "lockapp",
  "logonui",
  "winlogon",
  "csrss",
  "node",
  "yunari-dashboard",
] as const;

const NONE: GameEvidence = { running: false, evidence: "none" };

function normalised(value: string): string {
  return path.win32.normalize(value).toLowerCase();
}

/** Exact root or anything below it; a shared name prefix is not inside. */
function isWithin(candidate: string, root: string): boolean {
  const trimmed = root.replace(/[\\/]+$/, "");
  return candidate === trimmed || candidate.startsWith(`${trimmed}\\`);
}

/** The executable's name without directories or a `.exe` suffix. */
function stem(value: string): string {
  const base = value.split(/[\\/]/).pop() ?? value;
  return base.toLowerCase().replace(/\.exe$/, "");
}

function isNonGame(reading: ClassifierReading): boolean {
  const excluded = new Set<string>(NON_GAME_PROCESSES);
  if (reading.name !== undefined && excluded.has(stem(reading.name))) return true;
  return reading.path !== undefined && excluded.has(stem(reading.path));
}

function catalogueMatch(
  reading: ClassifierReading,
  catalogue: readonly InstalledGame[],
): InstalledGame | undefined {
  if (reading.path === undefined) return undefined;

  const target = normalised(reading.path);

  return catalogue.find((entry) => {
    const exact = entry.exes.some((exe) => normalised(exe) === target);
    return exact || isWithin(target, normalised(entry.installDir));
  });
}

/**
 * Markers in the executable's own directory. A `.pak` alone is an asset, not a
 * game: it needs the sibling `Engine` directory a packaged build carries.
 */
async function hasRuntimeMarker(
  executablePath: string,
  readdir: ClassifierState["readdir"],
): Promise<boolean> {
  let entries: readonly string[];

  try {
    entries = await readdir(path.win32.dirname(executablePath));
  } catch {
    return false;
  }

  const names = new Set(entries.map((entry) => entry.toLowerCase()));
  const named = GAME_MARKER_FILES.some(
    (marker) => marker !== "*.pak" && names.has(marker.toLowerCase()),
  );

  if (named) return true;

  return (
    names.has("engine") &&
    [...names].some((entry) => entry.endsWith(".pak"))
  );
}

function isGameWindow(
  reading: ClassifierReading,
  state: ClassifierState,
): boolean {
  const windowClass = reading.class;

  if (windowClass === undefined) return false;
  if (state.fullscreenSamples < 2) return false;
  if (reading.fullscreen !== true && reading.d3dFullscreen !== true) return false;

  if ((GAME_WINDOW_CLASSES as readonly string[]).includes(windowClass)) {
    return true;
  }

  return windowClass.startsWith("Allegro");
}

export async function classifyForeground(
  reading: ClassifierReading,
  catalogue: readonly InstalledGame[],
  state: ClassifierState,
): Promise<GameEvidence> {
  if (isNonGame(reading)) return NONE;
  if (reading.pid === 0) return NONE;
  if (reading.path === undefined && reading.name === undefined) return NONE;

  const game = catalogueMatch(reading, catalogue);
  if (game !== undefined) {
    return { running: true, evidence: "catalogue", game };
  }

  if (
    reading.path !== undefined &&
    (await hasRuntimeMarker(reading.path, state.readdir))
  ) {
    return { running: true, evidence: "runtime" };
  }

  if (isGameWindow(reading, state)) return { running: true, evidence: "window" };

  return NONE;
}
