import { findBrowser } from "../serve/display-launcher.js";
import type { DisplayRecord, DisplayStore } from "../settings/displays.js";
import type {
  PanelControlCommand,
  PanelDevice,
  PanelVideoSource,
} from "./panel-device.js";
import { familyFor } from "./panel-families.js";
import { createRasterizer } from "./panel-raster.js";
import { createPanelRunner, type PanelRunner } from "./panel-runner.js";

/**
 * Every panel this host drives, one runner each.
 *
 * **The host's third kind of display, and the only one it draws.** A paired
 * client and a local monitor are browsers the host *serves*; a panel has no
 * URL and nothing to admit, so the host has to produce its pixels itself.
 *
 * The manager is deliberately thin. It reads the records, opens what is
 * attached, and owns one interval per panel; everything a panel *is* lives
 * behind `PanelDevice`, and *which* driver claims a device is `panel-families`'
 * table. A second panel family is a row there and nothing here changes — which
 * is what adding the Kraken, a family with a different transport and a
 * different content mechanism, was able to prove.
 */

export interface PanelManagerOptions {
  readonly displays: DisplayStore;
  /** The player page a display is shown at, including its credential. */
  readonly pageFor: (displayId: string) => string;
  /** The clip the display's theme plays itself, or undefined for a still theme.
   *  Read once per start: a changed assignment is a restart, not a re-read. */
  readonly videoFor?: (
    displayId: string,
  ) => Promise<PanelVideoSource | undefined>;
  readonly onError?: (displayId: string, message: string) => void;
  /** The browser to rasterise with; the launcher's own discovery by default. */
  readonly browser?: string | undefined;
  /** How long shutdown waits for one display before abandoning it. */
  readonly shutdownGraceMs?: number;
  /**
   * How often a panel with no runner is opened again. A paired panel is retried
   * for as long as its record exists: a restarted device, a power cut and a
   * vendor app that held the port all come back this way. Absent means no
   * timer, which is what the unit tests want.
   */
  readonly reconcileIntervalMs?: number;
}

/** A command aimed at a display whose device is not being driven now. */
export class PanelNotRunningError extends Error {}

/**
 * What the manager is doing with one display.
 *
 * `connecting` is an attempt in flight — a start, or a manual reconnect whose
 * device has not answered yet. A record with no entry at all is `disconnected`:
 * the retry loop has nothing open for it.
 */
export type PanelConnectionStatus = "connected" | "connecting" | "disconnected";

export interface PanelManager {
  /** Starts a panel's runner, or does nothing when one is already running. */
  start(displayId: string): Promise<void>;
  /**
   * Sends one hardware command to a display's running device.
   *
   * A display with no runner is refused rather than opened or queued for
   * later: starting a panel is the owner's decision, and a command that waited
   * for a start could reach hardware the caller never asked to drive.
   */
  command(displayId: string, command: PanelControlCommand): Promise<string>;
  /** Stops a panel's runner, answering once the device is released. A record
   *  removed without this leaves it driving. */
  stop(displayId: string): Promise<void>;
  /** Restarts a panel's runner so it reads its theme again. A panel that
   *  started a video keeps playing that clip until its runner is replaced. */
  refresh(displayId: string): Promise<void>;
  /** Re-reads the clip this display would play and restarts its runner only
   *  when that clip differs from the one already playing. A saved theme's page
   *  picks up its document by itself; the device's copy of the video is the one
   *  part nothing re-reads. */
  refreshVideo(displayId: string): Promise<void>;
  /** Every attached panel that has a record and no runner yet. */
  reconcile(): Promise<void>;
  /** What this display's device is doing, for a surface that reports it. */
  status(displayId: string): PanelConnectionStatus;
  /** Stops and starts one display now: the manual retake. */
  reconnect(displayId: string): Promise<void>;
  /** What the manager holds, for a surface that reports it. */
  running(): readonly string[];
  stopAll(): Promise<void>;
}

/** One running panel, and the promise its first start produced. */
interface Entry {
  runner: PanelRunner | undefined;
  /** The device `runner` drives, kept so a control can reach its `controls`. */
  device: PanelDevice | undefined;
  /** The clip the runner was started with, so a later read can be compared
   *  against what is actually playing rather than re-uploading it blindly. */
  video: PanelVideoSource | undefined;
  timer: ReturnType<typeof setInterval> | undefined;
  /** Set while `open()` runs, so two calls cannot open the interface twice. */
  starting: Promise<void> | undefined;
}

/**
 * How long shutdown waits for work already in flight. A wedged device must not
 * hold the process open: the OS closes the handle when the process exits.
 */
const SHUTDOWN_GRACE_MS = 10_000;

export function createPanelManager(options: PanelManagerOptions): PanelManager {
  const entries = new Map<string, Entry>();
  /** The last message logged for each display, so a retry loop that keeps
   *  failing the same way says so once rather than every pass. */
  const lastReported = new Map<string, string>();
  /**
   * Logs one panel fact, skipping the same sentence twice in a row.
   *
   * The retry loop earns this: an unplugged panel fails identically every 15 s
   * for as long as it stays unplugged, and a console line per pass would bury
   * the change that matters. A different message — another failure, or a
   * reconnect — is always written.
   */
  const report = (displayId: string, message: string): void => {
    if (lastReported.get(displayId) === message) return;
    lastReported.set(displayId, message);
    options.onError?.(displayId, message);
  };
  /**
   * One promise chain per display: start, stop and refresh never overlap.
   *
   * Opening a device while the previous one's close is still draining is how a
   * second start lands on a port the first has not released, and a late start
   * failure could delete the entry a newer start had just installed. The serial
   * port has no lock of its own, so this queue is the lock.
   */
  const chains = new Map<string, Promise<unknown>>();
  let stopping = false;

  const trim = (displayId: string, settled: Promise<unknown>): void => {
    if (chains.get(displayId) === settled) chains.delete(displayId);
  };

  const enqueue = <T>(
    displayId: string,
    work: () => Promise<T>,
  ): Promise<T> => {
    const previous = chains.get(displayId) ?? Promise.resolve();
    const next = previous.then(work, work);
    chains.set(displayId, next);
    // Its own chain, not `finally`: a rejected tail is the caller's to see,
    // and a derived rejection here would be one nobody handles.
    void next.then(
      () => trim(displayId, next),
      () => trim(displayId, next),
    );
    return next;
  };

  const startNow = async (displayId: string): Promise<void> => {
    if (stopping) return;

    const existing = entries.get(displayId);
    if (existing?.runner !== undefined) return;
    if (existing?.starting !== undefined) return existing.starting;

    const entry: Entry = {
      runner: undefined,
      device: undefined,
      video: undefined,
      timer: undefined,
      starting: undefined,
    };
    entries.set(displayId, entry);

    entry.starting = (async () => {
      try {
        const record = await options.displays.find(displayId);

        if (record === undefined || record.kind !== "panel") {
          if (entries.get(displayId) === entry) entries.delete(displayId);
          return;
        }

        await run(displayId, record, entry);
      } catch (error) {
        // Only this entry's own failure may remove it: a newer start for the
        // same display owns whatever entry is there now.
        if (entries.get(displayId) === entry) entries.delete(displayId);
        report(displayId, messageOf(error));
      } finally {
        entry.starting = undefined;
      }
    })();

    return entry.starting;
  };

  const run = async (
    displayId: string,
    record: DisplayRecord,
    entry: Entry,
  ): Promise<void> => {
    const hardware = record.panel;
    if (hardware === undefined) {
      throw new Error("The panel record names no device.");
    }

    const family = familyFor(hardware.vendorId, hardware.productId);
    if (family === undefined) {
      throw new Error(
        `No driver on this host claims ${hex(hardware.vendorId)}:${hex(hardware.productId)}.`,
      );
    }

    const browser = options.browser ?? findBrowser();
    if (browser === undefined) {
      throw new Error(
        "No Chromium-family browser was found, and a panel needs one to render.",
      );
    }

    const device = await family.open();

    // A clip the device plays itself, when this display's theme has one. A
    // theme that cannot be read is a still panel, not a failed one.
    let video: PanelVideoSource | undefined;
    if (device.video !== undefined && options.videoFor !== undefined) {
      try {
        video = await options.videoFor(displayId);
      } catch (error) {
        report(displayId, messageOf(error));
      }
    }

    entry.video = video;

    let rasterizer: Awaited<ReturnType<typeof createRasterizer>>;

    try {
      rasterizer = await createRasterizer({
        browser,
        url: options.pageFor(displayId),
        geometry: device.geometry,
        // The device says which still it consumes; a panel that decodes to raw
        // pixels takes PNG rather than paying for a lossy intermediate.
        ...(device.stillFormat === undefined
          ? {}
          : { stillFormat: device.stillFormat }),
      });
    } catch (error) {
      await device.close();
      throw error;
    }

    // A video theme is read before the runner exists: a panel whose assignment
    // cannot be read is a still panel, not a panel with no runner.
    const runner = createPanelRunner({
      device,
      rasterizer,
      ...(video === undefined ? {} : { video }),
      // The device states its own cadence: a storing upload and a nine-frame
      // stream differ by an order of magnitude, and the driver is the one that
      // measured it.
      ...(device.frameIntervalMs === undefined
        ? {}
        : { intervalMs: device.frameIntervalMs }),
      onError: (message) => report(displayId, message),
      // The device refused three frames in a row: remove this runner and let
      // the retry pass open the panel again. Detaching goes through this
      // display's chain so a concurrent stop cannot race the close.
      onLost: () => {
        void enqueue(displayId, () => detachNow(displayId)).then(
          () => report(displayId, "disconnected; retrying."),
          () => report(displayId, "disconnected; retrying."),
        );
      },
    });

    // Shutdown, or a stop queued before this open finished, owns the device
    // now: nothing would ever tick or close this runner if it were installed.
    if (stopping || entries.get(displayId) !== entry) {
      await runner.stop();
      return;
    }

    entry.runner = runner;
    entry.device = device;
    // A runner is connected: the next failure of any kind is news again.
    lastReported.delete(displayId);
    // One line per start is the panel's whole progress report: a frame log would
    // bury the error beside it, and a panel that is quiet is either a still
    // theme — which is free — or a pipeline that stopped. Errors are reported
    // as they happen through `onError`.
    console.log(
      `Panel ${displayId}: ${video === undefined ? "stills" : "video"} at ` +
        `${device.geometry.width}x${device.geometry.height}.`,
    );
    // The panel's first frame is sent at once rather than after an interval: a
    // record the owner just added is a panel showing whatever was there before.
    void runner.tick();

    entry.timer = setInterval(() => {
      void runner.tick();
    }, runner.intervalMs);

    // A panel must not be the reason this process will not exit.
    entry.timer.unref();
  };

  /**
   * Stops one display, throwing when the device would not release.
   *
   * A failure leaves the entry in place: the runner and the port it failed to
   * give up are still there, and removing the entry would strand them with
   * nothing pointing at them.
   */
  const stopNow = async (displayId: string): Promise<void> => {
    const entry = entries.get(displayId);
    if (entry === undefined) return;

    // The timer first: a tick while the port is closing races the close.
    if (entry.timer !== undefined) {
      clearInterval(entry.timer);
      entry.timer = undefined;
    }

    // A start still opening has not set `runner` yet; waiting for it is what
    // makes the release before a restart real rather than a race.
    await entry.starting;
    if (entry.timer !== undefined) {
      clearInterval(entry.timer);
      entry.timer = undefined;
    }

    await entry.runner?.stop();

    if (entries.get(displayId) === entry) entries.delete(displayId);
  };

  /**
   * Lets go of a runner whose device is already gone, and removes the entry so
   * the retry pass owns the display again.
   *
   * Unlike {@link stopNow} this answers even when the close fails: a lost port
   * refusing its own close is the state that made this necessary, and leaving
   * the entry behind would strand the display forever.
   */
  const detachNow = async (displayId: string): Promise<void> => {
    const entry = entries.get(displayId);
    if (entry === undefined) return;

    if (entries.get(displayId) === entry) entries.delete(displayId);
    if (entry.timer !== undefined) {
      clearInterval(entry.timer);
      entry.timer = undefined;
    }

    try {
      await entry.runner?.stop();
    } catch {
      // The device is gone; its close failing is the same fact.
    }
  };

  /**
   * Sends one control to the device running now, or refuses.
   *
   * Deliberately not on the display's chain: waiting there would queue the
   * command behind a start that has not opened a device yet, which is exactly
   * the "later" a control must not be deferred to. The adapter's own queue
   * orders the write behind any frame already in flight.
   */
  const commandNow = async (
    displayId: string,
    command: PanelControlCommand,
  ): Promise<string> => {
    const entry = entries.get(displayId);
    const device = entry?.device;
    const runner = entry?.runner;

    // A runner whose stop already began is `running === false`: its port is on
    // the way down, so a write now is a race with the close.
    if (runner === undefined || device === undefined || !runner.running) {
      throw new PanelNotRunningError(
        `Panel display ${displayId} is not running; start it before sending a command.`,
      );
    }

    const controls = device.controls;
    if (controls === undefined) {
      throw new PanelNotRunningError(
        `Panel display ${displayId} does not accept commands.`,
      );
    }

    if (command.kind !== "restart") return controls.run(command);

    // **A restart is a planned disconnection.** The interface drops for about
    // fifteen seconds, so writing to this port again is writing to a stream the
    // device has already torn down. Detach on purpose — even when the write
    // failed — and the retry pass opens the panel when it comes back.
    try {
      return await controls.run(command);
    } finally {
      await enqueue(displayId, () => detachNow(displayId)).catch(
        () => undefined,
      );
      report(displayId, "restarting; reconnecting when the panel returns.");
    }
  };

  /**
   * Restarts one display, or opens it when it is not held.
   *
   * A close that failed is not a reason to keep the entry: a device that went
   * away — the vendor app took the port, the panel was restarted — cannot close
   * itself, and the runner is already not running. Keeping it would answer
   * "connecting" forever, because the retry pass opens an entry only when it
   * holds no runner. The entry is dropped and the open attempted; if the port
   * is genuinely still held, the open fails, the status is `disconnected`, and
   * the retry pass tries again.
   */
  const refreshNow = async (displayId: string): Promise<void> => {
    try {
      await stopNow(displayId);
    } catch (error) {
      report(displayId, messageOf(error));
      await detachNow(displayId);
    }

    await startNow(displayId);
  };

  /**
   * Restarts a display only when its clip changed.
   *
   * A theme save changes the document the page polls and, when it touches the
   * background, the bytes a panel plays. The page answers the first by itself;
   * the device's copy is only replaced by a restart, so a save asks every
   * running panel here and the comparison decides which one pays for it. A
   * read that fails leaves the panel playing what it has, which is honest: the
   * save landed, and the next start will try the new clip again.
   */
  const refreshVideoNow = async (displayId: string): Promise<void> => {
    const entry = entries.get(displayId);
    if (entry?.runner === undefined || options.videoFor === undefined) return;

    let video: PanelVideoSource | undefined;

    try {
      video = await options.videoFor(displayId);
    } catch (error) {
      report(displayId, messageOf(error));
      return;
    }

    if (sameVideo(entry.video, video)) return;

    await refreshNow(displayId);
  };

  const reconcileNow = async (): Promise<void> => {
    if (stopping) return;

    const records = await options.displays.list();

    for (const record of records) {
      if (record.kind !== "panel") continue;

      const entry = entries.get(record.id);
      if (entry !== undefined) {
        // A start in flight owns the display until it settles.
        if (entry.runner === undefined) continue;
        if (entry.runner.running) continue;

        // A runner that stopped but could not release its device is a stale
        // entry: the close failed and the entry was left behind. Let go of it
        // first, or `startNow` would see a runner and skip the display forever.
        await enqueue(record.id, () => detachNow(record.id));
      }

      await enqueue(record.id, () => startNow(record.id));
    }

    // A runner whose record went away is a panel still being fed a theme
    // nobody assigned it. `remove` stops its own, and this catches the record
    // deleted by hand. A refusal is reported and left for the next pass.
    const live = new Set(records.map((record) => record.id));
    for (const displayId of [...entries.keys()]) {
      if (live.has(displayId)) continue;

      await enqueue(displayId, () => stopNow(displayId)).catch(
        (error: unknown) => {
          report(displayId, messageOf(error));
        },
      );
    }
  };

  /**
   * The retry loop: every paired panel without a runner is opened again, for
   * as long as its record exists.
   *
   * The same cadence as `display-launcher`'s monitor reconcile, and the same
   * unref'd timer: a host that is shutting down must not be kept alive by a
   * panel it is about to close.
   */
  const retry =
    options.reconcileIntervalMs === undefined
      ? undefined
      : setInterval(() => {
          void reconcileNow().catch((error: unknown) => {
            console.error(`Panel retry: ${messageOf(error)}`);
          });
        }, options.reconcileIntervalMs);
  retry?.unref();

  const statusNow = (displayId: string): PanelConnectionStatus => {
    const entry = entries.get(displayId);
    // A runner is connected until it is given up on: a lost one clears its own
    // `running` flag, and the detach queued behind it removes the entry.
    if (entry === undefined) return "disconnected";
    return entry.runner?.running === true ? "connected" : "connecting";
  };

  return {
    start: (displayId) => enqueue(displayId, () => startNow(displayId)),

    command: (displayId, command) => commandNow(displayId, command),

    stop: (displayId) => enqueue(displayId, () => stopNow(displayId)),

    refresh: (displayId) => enqueue(displayId, () => refreshNow(displayId)),

    refreshVideo: (displayId) =>
      enqueue(displayId, () => refreshVideoNow(displayId)),

    reconcile: reconcileNow,

    status: statusNow,

    reconnect: (displayId) => enqueue(displayId, () => refreshNow(displayId)),

    running(): readonly string[] {
      return [...entries.entries()]
        .filter(([, entry]) => entry.runner !== undefined)
        .map(([displayId]) => displayId);
    },

    async stopAll(): Promise<void> {
      stopping = true;
      if (retry !== undefined) clearInterval(retry);
      const grace = options.shutdownGraceMs ?? SHUTDOWN_GRACE_MS;

      // Work already queued still has to settle first: a start that began
      // before shutdown would otherwise open a port after this returns. A
      // device that never answers is abandoned after the grace period, and the
      // start that owns it closes itself once it sees `stopping`.
      const stalled = new Set<string>();
      await Promise.all(
        [...chains.entries()].map(async ([displayId, chain]) => {
          if (await within(chain, grace)) return;

          stalled.add(displayId);
          report(
            displayId,
            `Shutdown waited ${grace / 1000}s for this panel and is closing anyway.`,
          );
        }),
      );

      // Every stop goes through the display's own chain, so a DELETE that
      // arrived first is not raced by a second close. The stop itself is as
      // boundable as a queued one: a close that never calls back would
      // otherwise keep shutdown here and never release the host.
      await Promise.all(
        [...entries.keys()]
          .filter((displayId) => !stalled.has(displayId))
          .map(async (displayId) => {
            const stop = enqueue(displayId, () => stopNow(displayId)).catch(
              (error: unknown) => {
                report(displayId, messageOf(error));
              },
            );
            if (await within(stop, grace)) return;

            report(
              displayId,
              `Shutdown waited ${grace / 1000}s for this panel's close and is closing anyway.`,
            );
          }),
      );

      entries.clear();
    },
  };
}

/** Whether `work` settles within `ms`; a rejection counts as settled. */
function within(work: Promise<unknown>, ms: number): Promise<boolean> {
  return Promise.race([
    work.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), ms);
      // The bound is not what keeps the process alive while it waits.
      timer.unref();
    }),
  ]);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether two reads describe the same clip and the same authored pan. */
function sameVideo(
  first: PanelVideoSource | undefined,
  second: PanelVideoSource | undefined,
): boolean {
  if (first === undefined || second === undefined) return first === second;

  return (
    first.placement.offsetX === second.placement.offsetX &&
    first.placement.offsetY === second.placement.offsetY &&
    sameBytes(first.bytes, second.bytes)
  );
}

function sameBytes(first: Uint8Array, second: Uint8Array): boolean {
  if (first.length !== second.length) return false;

  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false;
  }

  return true;
}

function hex(value: number): string {
  return value.toString(16).padStart(4, "0");
}
