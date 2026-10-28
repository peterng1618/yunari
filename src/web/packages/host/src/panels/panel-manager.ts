import { findBrowser } from "../serve/display-launcher.js";
import type { DisplayRecord, DisplayStore } from "../settings/displays.js";
import { familyFor } from "./panel-families.js";
import { createRasterizer } from "./panel-raster.js";
import { createPanelRunner, type PanelRunner } from "./panel-runner.js";

/**
 * Every panel this host drives, one runner each.
 *
 * **The host's third kind of display, and the only one it draws.** A paired
 * client and a local monitor are browsers the host *serves*; a panel has no
 * URL and nothing to admit, so the host has to produce its pixels
 * (`docs/decisions/0130-panel-protocol.md`).
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
  readonly onError?: (displayId: string, message: string) => void;
  /** The browser to rasterise with; the launcher's own discovery by default. */
  readonly browser?: string | undefined;
}

export interface PanelManager {
  /** Starts a panel's runner, or does nothing when one is already running. */
  start(displayId: string): Promise<void>;
  /** Stops a panel's runner. A record removed without this leaves it driving. */
  stop(displayId: string): void;
  /** Every attached panel that has a record and no runner yet. */
  reconcile(): Promise<void>;
  /** What the manager holds, for a surface that reports it. */
  running(): readonly string[];
  stopAll(): Promise<void>;
}

/** One running panel, and the promise its first start produced. */
interface Entry {
  runner: PanelRunner | undefined;
  timer: ReturnType<typeof setInterval> | undefined;
  /** Set while `open()` runs, so two calls cannot open the interface twice. */
  starting: Promise<void> | undefined;
}

export function createPanelManager(options: PanelManagerOptions): PanelManager {
  const entries = new Map<string, Entry>();
  const report = options.onError ?? (() => {});
  let stopping = false;

  const start = async (displayId: string): Promise<void> => {
    if (stopping) return;

    const existing = entries.get(displayId);
    if (existing?.runner !== undefined) return;
    if (existing?.starting !== undefined) return existing.starting;

    const entry: Entry = {
      runner: undefined,
      timer: undefined,
      starting: undefined,
    };
    entries.set(displayId, entry);

    entry.starting = (async () => {
      try {
        const record = await options.displays.find(displayId);

        if (record === undefined || record.kind !== "panel") {
          entries.delete(displayId);
          return;
        }

        await run(displayId, record, entry);
      } catch (error) {
        entries.delete(displayId);
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
    let rasterizer: Awaited<ReturnType<typeof createRasterizer>>;

    try {
      rasterizer = await createRasterizer({
        browser,
        url: options.pageFor(displayId),
        geometry: device.geometry,
      });
    } catch (error) {
      await device.close();
      throw error;
    }

    const runner = createPanelRunner({
      device,
      rasterizer,
      // A panel that uploads to its own memory pays an upload per frame, so its
      // floor wins over the streaming default. The device states the floor
      // rather than this file guessing at one family's cost.
      ...(device.minimumIntervalMs === undefined
        ? {}
        : { intervalMs: device.minimumIntervalMs }),
      // One line per frame that changed: a panel that is quiet is either a
      // still theme — which is free — or a pipeline that stopped, and an owner
      // reading a console cannot tell those apart without being told.
      onFrame: () =>
        console.log(
          `Panel ${displayId}: showed a ${device.geometry.width}x${device.geometry.height} image.`,
        ),
      onError: (message) => report(displayId, message),
    });

    entry.runner = runner;
    // The panel's first frame is sent at once rather than after an interval: a
    // record the owner just added is a panel showing whatever was there before.
    void runner.tick();

    entry.timer = setInterval(() => {
      void runner.tick();
    }, runner.intervalMs);

    // A panel must not be the reason this process will not exit.
    entry.timer.unref();
  };

  const stop = (displayId: string): void => {
    const entry = entries.get(displayId);
    if (entry === undefined) return;

    entries.delete(displayId);
    if (entry.timer !== undefined) clearInterval(entry.timer);
    void entry.runner?.stop();
  };

  return {
    start,

    stop,

    async reconcile(): Promise<void> {
      if (stopping) return;

      const records = await options.displays.list();

      for (const record of records) {
        if (record.kind !== "panel") continue;
        if (entries.get(record.id)?.runner !== undefined) continue;
        await start(record.id);
      }

      // A runner whose record went away is a panel still being fed a theme
      // nobody assigned it. `remove` stops its own, and this catches the record
      // deleted by hand.
      const live = new Set(records.map((record) => record.id));
      for (const displayId of entries.keys()) {
        if (!live.has(displayId)) stop(displayId);
      }
    },

    running(): readonly string[] {
      return [...entries.entries()]
        .filter(([, entry]) => entry.runner !== undefined)
        .map(([displayId]) => displayId);
    },

    async stopAll(): Promise<void> {
      stopping = true;
      const runners = [...entries.values()];

      for (const entry of entries.values()) {
        if (entry.timer !== undefined) clearInterval(entry.timer);
      }
      entries.clear();

      await Promise.all(runners.map((entry) => entry.runner?.stop()));
    },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hex(value: number): string {
  return value.toString(16).padStart(4, "0");
}
