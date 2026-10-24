import {
  type ChildProcess,
  type SpawnOptions,
  spawn,
} from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDisplayStore,
  type DisplayStore,
  hashToken,
  type MonitorHint,
} from "../settings/displays.js";
import { hintFor, type Monitor } from "../settings/monitors.js";
import {
  browserCommand,
  createDisplayLauncher,
  findBrowser,
  LIVE_WINDOW_MS,
} from "./display-launcher.js";

/**
 * A fake clock, so "recently" is a fact about the fixture rather than about how
 * long the suite took.
 */
const NOW = Date.parse("2026-10-18T12:00:00.000Z");
const STALE = new Date(NOW - LIVE_WINDOW_MS - 1000).toISOString();
const RECENT = new Date(NOW - 1000).toISOString();

/** The family `findBrowser` opens a window with, by the name it lands on: the
 *  contract, rather than a copy of each platform's install list. */
const BROWSER_NAME = /chrome|chromium|edge/i;

const ATTACHED: readonly Monitor[] = [
  {
    deviceName: "\\\\.\\DISPLAY1",
    serial: "4790810010513",
    main: true,
    positionX: 0,
    positionY: 0,
    currentResX: 2560,
    currentResY: 1440,
  },
  {
    deviceName: "\\\\.\\DISPLAY2",
    main: false,
    positionX: 2560,
    positionY: 0,
    currentResX: 1920,
    currentResY: 1080,
  },
];

/** One window a launcher opened: what it was spawned with, and a way to close it. */
interface OpenedWindow {
  readonly file: string;
  readonly args: readonly string[];
  readonly options: SpawnOptions;
  readonly kill: ReturnType<typeof vi.fn>;
  /** The browser exits, which is what a window the owner closed looks like. */
  close(): void;
}

/** A `spawn` that opens nothing: it records the command line and lets a case
 *  close a window, so no test needs a browser on the machine. */
function recordingSpawn(opened: OpenedWindow[]): typeof spawn {
  return ((file: string, args: readonly string[], options: SpawnOptions) => {
    const exits: (() => void)[] = [];
    const kill = vi.fn();

    const child = {
      killed: false,
      kill,
      once(event: string, handler: () => void): void {
        if (event === "exit") exits.push(handler);
      },
    };

    opened.push({
      file,
      args,
      options,
      kill,
      close: () => {
        for (const handler of exits) handler();
      },
    });

    return child as unknown as ChildProcess;
  }) as unknown as typeof spawn;
}

/** A promise the case resolves itself, so a pass can be parked inside an await. */
function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let settle: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });

  return { promise, resolve: settle };
}

describe("the host's own windows", () => {
  let directory: string;
  let displays: DisplayStore;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "yunari-launcher-"));
    displays = createDisplayStore(directory);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function launcher(
    opened: OpenedWindow[],
    monitors: () => Promise<readonly Monitor[]> = () =>
      Promise.resolve(ATTACHED),
  ) {
    return createDisplayLauncher({
      displays,
      port: 5227,
      browser: "/fake/chrome.exe",
      spawn: recordingSpawn(opened),
      monitors,
      now: () => NOW,
    });
  }

  /** A local display for a monitor, last seen at `seenAt` — the store stamps
   *  creation itself, and only a `touch` moves `lastSeenAt`. */
  async function local(
    label: string,
    monitor: MonitorHint,
    seenAt?: string,
  ): Promise<string> {
    const record = await displays.createLocal(label, monitor);
    if (seenAt !== undefined) await displays.touch(record.id, seenAt);

    return record.id;
  }

  it("launches a local display that has not been seen recently", async () => {
    const opened: OpenedWindow[] = [];
    const id = await local("Left screen", hintFor(ATTACHED[1]!), STALE);

    await launcher(opened).reconcile();

    expect(opened).toHaveLength(1);
    // The window goes where the monitor is, and opens the display's own URL.
    expect(opened[0]?.args).toContain("--window-position=2560,0");
    expect(opened[0]?.args).toContain("--window-size=1920,1080");
    expect(opened[0]?.args).toContain(
      `--app=http://127.0.0.1:5227/?display=${id}`,
    );
  });

  it("does not launch a display that was seen recently", async () => {
    const opened: OpenedWindow[] = [];
    await local("Left screen", hintFor(ATTACHED[1]!), RECENT);

    await launcher(opened).reconcile();

    // A sighting is a window that is up: this is what makes a host restart not
    // open a second one.
    expect(opened).toEqual([]);
  });

  it("does not launch one whose monitor is not attached", async () => {
    const opened: OpenedWindow[] = [];
    const id = await local(
      "Left screen",
      { deviceName: "\\\\.\\DISPLAY9" },
      STALE,
    );
    const before = await displays.find(id);

    await launcher(opened).reconcile();

    expect(opened).toEqual([]);
    // Untouched: the record is the owner's configuration, not a report about
    // the furniture.
    expect(await displays.find(id)).toEqual(before);
  });

  it("never launches a paired display", async () => {
    const opened: OpenedWindow[] = [];

    // A hand-edited file can hold a paired record with a hint and a stale
    // sighting; it is still a device the owner set up somewhere else, whose
    // window the host never opened and does not know where to put.
    await writeFile(
      path.join(directory, "display-clients.json"),
      JSON.stringify({
        displays: [
          {
            id: "kitchen-tablet",
            label: "Kitchen tablet",
            kind: "paired",
            createdAt: STALE,
            lastSeenAt: STALE,
            tokenHash: hashToken("tok"),
            monitor: { deviceName: "\\\\.\\DISPLAY2" },
          },
        ],
      }),
      "utf8",
    );

    await launcher(opened).reconcile();

    expect(opened).toEqual([]);
  });

  it("does not open a second window while the one it opened is still up", async () => {
    const opened: OpenedWindow[] = [];
    const windows = launcher(opened);
    // Never seen, so the sighting cannot be what stops the second launch: the
    // window the launcher is holding is.
    await local("Left screen", hintFor(ATTACHED[1]!));

    await windows.reconcile();
    await windows.reconcile();

    expect(opened).toHaveLength(1);
  });

  it("brings back a window that went away", async () => {
    const opened: OpenedWindow[] = [];
    const windows = launcher(opened);
    await local("Left screen", hintFor(ATTACHED[1]!), STALE);

    await windows.reconcile();
    expect(opened).toHaveLength(1);

    // The owner closed it, so nothing is polling and the next pass puts one
    // back rather than believing the display still has a window.
    opened[0]?.close();
    await windows.reconcile();
    expect(opened).toHaveLength(2);
  });

  it("does not open a second window when a killed host left an orphan behind", async () => {
    const opened: OpenedWindow[] = [];

    // A fresh launcher has no memory of the window a killed host left behind,
    // so the sighting is the only thing that says one is still up.
    await local("Left screen", hintFor(ATTACHED[1]!), RECENT);
    await launcher(opened).reconcile();

    expect(opened).toEqual([]);
  });

  it("spawns a host-owned child, not a detached one", async () => {
    const opened: OpenedWindow[] = [];
    await local("Left screen", hintFor(ATTACHED[1]!), STALE);

    await launcher(opened).reconcile();

    // The browser is the host's own child, which is what makes close()
    // unambiguous.
    expect(opened[0]?.options.detached).toBeUndefined();
  });

  it("closes the window it opened when the display is removed", async () => {
    const opened: OpenedWindow[] = [];
    const windows = launcher(opened);
    const id = await local("Left screen", hintFor(ATTACHED[1]!), STALE);

    await windows.reconcile();
    windows.close(id);

    expect(opened[0]?.kill).toHaveBeenCalled();
    // Closing twice is not an error: the second close has no window to close.
    expect(() => windows.close(id)).not.toThrow();
  });

  it("only ever closes a window it opened itself", async () => {
    const opened: OpenedWindow[] = [];
    const windows = launcher(opened);

    // A browser the owner started is not the host's to close.
    expect(() => windows.close("left-screen")).not.toThrow();
    expect(opened).toEqual([]);
  });

  it("closes the windows it opened when it stops", async () => {
    const opened: OpenedWindow[] = [];
    const windows = launcher(opened);

    await local("Left screen", hintFor(ATTACHED[1]!), STALE);
    await local("Right screen", hintFor(ATTACHED[0]!), STALE);
    // A display this launcher never launched: its monitor is not attached, so no
    // pass has opened anything for it.
    await local("Spare screen", { deviceName: "\\\\.\\DISPLAY9" }, STALE);

    await windows.reconcile();
    expect(opened).toHaveLength(2);

    windows.stop();

    // A window left behind is one the next run cannot see, and its empty child
    // map would put a second window on that monitor.
    expect(opened[0]?.kill).toHaveBeenCalledTimes(1);
    expect(opened[1]?.kill).toHaveBeenCalledTimes(1);

    // The map is cleared as it goes: a second stop closes nothing, and neither
    // does a close for a display whose window is already gone.
    expect(() => windows.stop()).not.toThrow();
    expect(() => windows.close("spare-screen")).not.toThrow();
    expect(opened[0]?.kill).toHaveBeenCalledTimes(1);
  });

  it("does not launch when it is stopped while a pass is waiting", async () => {
    const opened: OpenedWindow[] = [];
    const parked = deferred<readonly Monitor[]>();
    const windows = launcher(opened, () => parked.promise);
    await local("Left screen", hintFor(ATTACHED[1]!), STALE);

    // The pass is inside its probe, which is the only place a stop can land
    // between the entry check and a launch.
    const pass = windows.reconcile();
    windows.stop();
    parked.resolve(ATTACHED);
    await pass;

    // A child inserted now would sit in a map nothing will ever clear, and the
    // next run would put a second window on that monitor.
    expect(opened).toEqual([]);
  });

  it("stops reconciling after stop()", async () => {
    const opened: OpenedWindow[] = [];
    const windows = launcher(opened);
    await local("Left screen", hintFor(ATTACHED[1]!), STALE);

    windows.stop();
    await windows.reconcile();

    expect(opened).toEqual([]);
  });
});

describe("findBrowser", () => {
  it("answers undefined when no browser is installed, rather than guessing", () => {
    // A platform this host has no install path for has no candidate to guess
    // at; a guessed path is a display that silently never appears. (The
    // `linux` list is a real machine's, and a machine that has one of them is
    // exactly the case that is not this one.)
    expect(findBrowser("aix")).toBeUndefined();

    // Whatever this machine answers has to satisfy both halves, and neither
    // alone is enough: `existsSync` is satisfied by any file that is there,
    // which is what a guessed path is, and the name alone is satisfied by a
    // browser-shaped path that is not on this machine at all.
    const found = findBrowser();
    expect(
      found === undefined ||
        (existsSync(found) && BROWSER_NAME.test(path.basename(found))),
    ).toBe(true);
  });
});

describe("browserCommand", () => {
  it("opens the display's URL as an app window on its monitor, with its own profile", () => {
    const { file, args } = browserCommand(
      "chrome",
      {
        url: "http://127.0.0.1:5227/?display=left-screen",
        position: [2560, 0],
        size: [1920, 1080],
      },
      "/profiles/left-screen",
    );

    expect(file).toBe("chrome");
    expect(args).toContain("--app=http://127.0.0.1:5227/?display=left-screen");
    expect(args).toContain("--window-position=2560,0");
    expect(args).toContain("--window-size=1920,1080");
    expect(args).toContain("--start-fullscreen");
    expect(args).toContain("--user-data-dir=/profiles/left-screen");
    // No first-run page, no default-browser prompt, and none of the owner's
    // extensions on a wall screen.
    expect(args).toContain("--no-first-run");
    expect(args).toContain("--no-default-browser-check");
    expect(args).toContain("--disable-extensions");
  });
});
