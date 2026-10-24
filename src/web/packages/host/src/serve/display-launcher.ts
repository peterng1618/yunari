import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DisplayRecord, DisplayStore } from "../settings/displays.js";
import {
  isAttached,
  launchFor,
  listMonitors,
  type Monitor,
} from "../settings/monitors.js";

/**
 * The host's own windows on its local monitors (§ "The host's own monitors",
 * ruling 13): one per attached local display, and a host that starts again finds
 * the window already up rather than opening a second one.
 *
 * `lhm-launcher.ts`'s shape with a browser where LHM was. The child is the
 * host's own — never detached — which is what makes `close` unambiguous: a
 * browser the owner started is not the host's to close.
 */

/**
 * How recently a display must have been seen for its window to be presumed
 * running.
 *
 * A local display's page polls continuously, so a sighting inside this window
 * *is* a window that is up: a closed one goes stale and comes back on the next
 * pass, and a host restarted under a live window opens nothing.
 */
export const LIVE_WINDOW_MS = 15_000;

/** How often the comparison is made again. Long enough that the probe it costs
 *  is not a background load of its own, short enough that a window the owner
 *  closed is back within half a minute. */
const RECONCILE_INTERVAL_MS = 15_000;

/** Where a browser installs, per platform. Only what is there is used. */
function installPaths(platform: NodeJS.Platform): readonly string[] {
  if (platform === "win32") {
    const local = process.env["LOCALAPPDATA"];

    return [
      // A per-user install first: it is what a machine with no administrator
      // account has, and Edge is the one browser every Windows ships.
      ...(local === undefined
        ? []
        : [path.join(local, "Google", "Chrome", "Application", "chrome.exe")]),
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ];
  }

  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }

  // A platform this host has no path for has none: answering Linux paths for
  // anything else would be a guess about a machine nobody looked at.
  if (platform !== "linux") return [];

  return [
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];
}

/** The names the same browsers answer to on `PATH`. */
function executableNames(platform: NodeJS.Platform): readonly string[] {
  if (platform === "win32") return ["chrome.exe", "msedge.exe"];
  if (platform === "darwin") return ["google-chrome", "chromium"];
  if (platform === "linux") {
    return ["google-chrome", "chromium", "chromium-browser"];
  }

  return [];
}

/**
 * The Chromium-family browser to open a window with, or `undefined` when this
 * machine has none.
 *
 * Never a guessed path: a guess is a display that silently never appears, which
 * is worse than saying nothing was found.
 */
export function findBrowser(
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  for (const candidate of installPaths(platform)) {
    if (existsSync(candidate)) return candidate;
  }

  const directories = (process.env["PATH"] ?? "").split(path.delimiter);

  for (const name of executableNames(platform)) {
    for (const directory of directories) {
      if (directory.length === 0) continue;

      const candidate = path.join(directory, name);
      if (existsSync(candidate)) return candidate;
    }
  }

  return undefined;
}

/**
 * The command line that opens one display's window: the browser, the URL, the
 * monitor's geometry, and a profile directory of its own.
 *
 * **This is the one owner of the argv** (ruling 33). `launchFor` answers the URL
 * and the geometry and builds no command line, because a second flag set would
 * drift from this one the first time either side added a flag — and nothing
 * fails when it does.
 *
 * The profile is per display so a wall screen carries neither the owner's
 * session nor their extensions, and the app flags make this one fullscreen
 * window with no browser chrome, no first-run page and no default-browser
 * prompt.
 */
export function browserCommand(
  browser: string,
  target: {
    readonly url: string;
    readonly position: readonly [number, number];
    readonly size: readonly [number, number];
  },
  profileDir: string,
): { readonly file: string; readonly args: readonly string[] } {
  return {
    file: browser,
    args: [
      `--app=${target.url}`,
      `--window-position=${target.position[0]},${target.position[1]}`,
      `--window-size=${target.size[0]},${target.size[1]}`,
      "--start-fullscreen",
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
    ],
  };
}

export interface Launcher {
  /** Ensures every attached local display has a window; never a second one. */
  reconcile(): Promise<void>;
  /** Closes the window this launcher opened for a display, if any. */
  close(displayId: string): void;
  stop(): void;
}

/**
 * The browser profile a display's window uses.
 *
 * Under the temp directory because it is a cache — a session, a cache, an
 * extension list nothing reads back — and never the owner's own profile, so a
 * wall screen cannot see their logins.
 */
function profileDirFor(displayId: string): string {
  return path.join(os.tmpdir(), "yunari-display-profiles", displayId);
}

/**
 * Whether a record's window is presumed to be running.
 *
 * A record no `touch` has moved is not seen at all — the store stamps
 * `createdAt` and `lastSeenAt` from one instant — so only a record whose
 * `lastSeenAt` has moved can count as a sighting, and a sighting inside
 * `LIVE_WINDOW_MS` is a window that is up. A timestamp nothing can read is no
 * evidence of a window either.
 *
 * Nothing writes a local display's `lastSeenAt` yet, so this answers false for
 * every local display and the child map is the whole of the dedupe until a
 * window names itself on a repeating request (Task 2.2).
 */
function windowIsLive(record: DisplayRecord, now: number): boolean {
  if (record.lastSeenAt === record.createdAt) return false;

  const seenAt = Date.parse(record.lastSeenAt);

  return !Number.isNaN(seenAt) && now - seenAt < LIVE_WINDOW_MS;
}

export function createDisplayLauncher(input: {
  readonly displays: DisplayStore;
  readonly port: number;
  readonly spawn?: typeof spawn;
  readonly now?: () => number;
  /** What is attached, read once per pass. Supplied so a case can hold a fixture
   *  rather than this machine's screens, the same reason
   *  `HostServerOptions.monitors` is. */
  readonly monitors?: () => Promise<readonly Monitor[]>;
  /** The browser to open. Omitted asks `findBrowser()` — this machine's own
   *  answer — and is supplied so a case does not depend on one being installed. */
  readonly browser?: string;
}): Launcher {
  const spawnProcess = input.spawn ?? spawn;
  const now = input.now ?? Date.now;
  const readMonitors = input.monitors ?? listMonitors;

  /** The windows this launcher opened, by display id — never by hint: the store
   *  refuses a second record holding one (ruling 32), and a map keyed by hint
   *  would leave a record with no window and no explanation. */
  const windows = new Map<string, ChildProcess>();

  let stopped = false;
  let passing = false;

  const forget = (displayId: string, child: ChildProcess): void => {
    // A window the owner closed, or one that never started, is not a window
    // this launcher still has: the next pass may put one back.
    if (windows.get(displayId) === child) windows.delete(displayId);
  };

  const launch = (record: DisplayRecord, monitor: Monitor): void => {
    const browser = input.browser ?? findBrowser();

    if (browser === undefined) return;

    const command = browserCommand(
      browser,
      launchFor(monitor, input.port, record.id),
      profileDirFor(record.id),
    );

    // The host's own child, never detached. `spawn` reports a failure as an
    // `error` event rather than by throwing, and an unhandled one ends the
    // process, so both events are handled.
    const child = spawnProcess(command.file, [...command.args], {
      stdio: "ignore",
    });

    windows.set(record.id, child);
    child.once("exit", () => forget(record.id, child));
    child.once("error", () => forget(record.id, child));
  };

  const reconcile = async (): Promise<void> => {
    // A pass that is already running answers this one: the interval repeats, so
    // nothing is lost that the next pass does not do again.
    if (stopped || passing) return;

    passing = true;

    try {
      const monitors = await readMonitors();
      const displays = await input.displays.list();

      // Checked again here, because these awaits are the only place `stop()` can
      // interleave — it clears the map and kills what it held, so a pass resuming
      // here would insert a child nothing will ever close again. The loop below
      // never awaits, so the flag cannot change after this point.
      if (stopped) return;

      for (const record of displays) {
        // A paired display is a device the owner set up somewhere else: the host
        // never opened a window for it and does not know where one would go.
        if (record.kind !== "local") continue;

        const hint = record.monitor;
        if (hint === undefined || !isAttached(hint, monitors)) continue;
        if (windows.has(record.id)) continue;
        if (windowIsLive(record, now())) continue;

        // The monitor itself, so a window knows where to go: the same
        // `isAttached` rule, asked one monitor at a time.
        const monitor = monitors.find((candidate) =>
          isAttached(hint, [candidate]),
        );
        if (monitor === undefined) continue;

        launch(record, monitor);
      }
    } catch {
      // A pass that could not read is a pass with nothing to do. A probe that
      // failed is not "nothing is attached", and a record list that could not be
      // read is not an empty one; the next pass asks again.
    } finally {
      passing = false;
    }
  };

  const timer = setInterval(() => void reconcile(), RECONCILE_INTERVAL_MS);
  // The host's lifetime is the terminal's. A timer that kept the process alive
  // would outlive the thing it serves.
  timer.unref();

  return {
    reconcile,

    close(displayId: string): void {
      const child = windows.get(displayId);
      if (child === undefined) return;

      windows.delete(displayId);

      // Only ever a window this launcher opened: a browser the owner started is
      // not the host's to close.
      if (!child.killed) child.kill();
    },

    stop(): void {
      stopped = true;
      clearInterval(timer);

      // A console Ctrl+C reaches the host's own children; a service manager's
      // signal and a killed host do not, and a window left behind is one the
      // next run cannot see — its empty child map would put a second window on
      // that monitor. Only a window this launcher opened is the host's to close,
      // and the map is cleared first so a second stop() closes nothing.
      const opened = [...windows.values()];
      windows.clear();

      for (const child of opened) {
        if (!child.killed) child.kill();
      }
    },
  };
}
