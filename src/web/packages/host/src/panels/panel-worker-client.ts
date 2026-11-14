import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { DeviceSink, DeviceTelemetry } from "./device-sink.js";
import type {
  PanelControlCommand,
  PanelDevice,
  PanelOpenOptions,
  PanelVideo,
} from "./panel-device.js";
import type { Rasterizer } from "./panel-raster.js";
import type {
  WorkerAsk,
  WorkerOpened,
  WorkerReply,
} from "./panel-worker-protocol.js";

/**
 * The host's half of one panel's worker.
 *
 * **Two proxies, one thread.** `device` and the rasteriser `attach` answers are
 * `PanelDevice` and `Rasterizer` implemented over `postMessage`, so the manager,
 * the runner and their tests keep the interfaces they already had. Everything a
 * caller can reach — a frame, a picture, a command, a lighting write — is a
 * request, and the thread never hands out its handle.
 *
 * A thread that exits or throws fails every request waiting on it: the device
 * is gone, and the runner's own three-failure rule is what reports it.
 */

/** The part of `node:worker_threads`' `Worker` this module uses. */
export interface WorkerThread {
  on(event: "message", listener: (message: unknown) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "exit", listener: (code: number) => void): void;
  postMessage(message: unknown): void;
  unref(): void;
  terminate(): Promise<number> | void;
}

/** The page the host opened for this panel, and how to give it back. */
export interface PanelWorkerPage {
  /** The page target's own devtools socket, from the raster browser. */
  readonly pageUrl: string;
  readonly url: string;
  /** Closes the page's target. The browser owns it, not the thread. */
  readonly closePage: () => Promise<void>;
}

export interface PanelWorkerOptions {
  readonly vendorId: number;
  readonly productId: number;
  readonly open?: PanelOpenOptions;
  /** Test seam: the thread, already spawned. Production starts the sibling
   *  bundle, which the host's build writes beside `main.js`. */
  readonly spawn?: () => WorkerThread;
}

export interface PanelWorker {
  /** The open device, as the rest of the host sees it. */
  readonly device: PanelDevice;
  attach(page: PanelWorkerPage): Promise<Rasterizer>;
}

/** The sibling entry the host's bundle writes. */
export function spawnPanelThread(): WorkerThread {
  const thread = new Worker(
    fileURLToPath(new URL("./panel-worker.js", import.meta.url)),
  );
  // A panel must not be the reason this process will not exit; shutdown
  // terminates it. This is the same unref the shared browser and retry timer
  // take.
  thread.unref();
  return thread as unknown as WorkerThread;
}

export async function openPanelWorker(
  options: PanelWorkerOptions,
): Promise<PanelWorker> {
  const thread = (options.spawn ?? spawnPanelThread)();
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  let failed: Error | undefined;
  let nextId = 1;

  const fail = (error: Error): void => {
    failed ??= error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };

  thread.on("message", (raw) => {
    const reply = raw as WorkerReply;
    const request = pending.get(reply.id);
    if (request === undefined) return;

    pending.delete(reply.id);
    if (reply.ok) {
      request.resolve(reply.value);
      return;
    }

    request.reject(new Error(reply.message ?? "the panel worker failed"));
  });
  thread.on("error", (error) => fail(reason(error)));
  thread.on("exit", (code) =>
    fail(new Error(`the panel worker exited with ${code}`)),
  );

  const ask = <T>(request: WorkerAsk): Promise<T> => {
    if (failed !== undefined) return Promise.reject(failed);

    const id = nextId;
    nextId += 1;

    return new Promise<T>((resolve, reject) => {
      pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });

      try {
        thread.postMessage({ ...request, id });
      } catch (error) {
        pending.delete(id);
        reject(reason(error));
      }
    });
  };

  let opened: WorkerOpened;

  try {
    opened = await ask<WorkerOpened>({
      kind: "open",
      vendorId: options.vendorId,
      productId: options.productId,
      ...(options.open === undefined ? {} : { open: options.open }),
    });
  } catch (error) {
    fail(reason(error));
    await thread.terminate();
    throw error;
  }

  const closeThread = async (): Promise<void> => {
    fail(new Error("the panel worker is closed."));
    await thread.terminate();
  };

  const video: PanelVideo | undefined = opened.hasVideo
    ? {
        start: async (bytes, placement, rotation) => {
          await ask({
            kind: "video-start",
            bytes,
            placement,
            ...(rotation === undefined ? {} : { rotation }),
          });
        },
        presentOverlay: async (png) =>
          (await ask<unknown>({ kind: "video-overlay", png })) === true,
        stop: async () => {
          await ask({ kind: "video-stop" });
        },
      }
    : undefined;

  const controls =
    opened.commands.length === 0
      ? undefined
      : {
          commands: opened.commands,
          run: async (command: PanelControlCommand): Promise<string> => {
            const reply = await ask<unknown>({ kind: "command", command });
            return typeof reply === "string" ? reply : "";
          },
        };

  const descriptor = opened.sink;
  const sink: DeviceSink | undefined =
    descriptor === undefined
      ? undefined
      : {
          id: descriptor.id,
          kind: descriptor.kind,
          name: descriptor.name,
          ...(descriptor.lighting === undefined
            ? {}
            : { lighting: descriptor.lighting }),
          ...(descriptor.display === undefined
            ? {}
            : { display: descriptor.display }),
          ...(descriptor.controls === undefined
            ? {}
            : {
                controls: {
                  pump: descriptor.controls.pump,
                  fans: descriptor.controls.fans,
                  telemetry: descriptor.controls.telemetry,
                  set: async (input) => {
                    await ask({ kind: "set-controls", input });
                  },
                  read: async () =>
                    await ask<DeviceTelemetry>({ kind: "read-controls" }),
                },
              }),
          writeColors: async (rgb) => {
            await ask({ kind: "colors", rgb });
          },
        };

  const device: PanelDevice = {
    geometry: opened.geometry,
    // The thread already opened it; there is no second open to make.
    open: async () => {},
    present: async (still) => {
      await ask({ kind: "present", still });
    },
    close: async () => {
      try {
        await ask({ kind: "close" });
      } catch {
        // A thread that already died has no device left to release; its
        // handle went with it.
      }
      await closeThread();
    },
    ...(opened.stillFormat === undefined
      ? {}
      : { stillFormat: opened.stillFormat }),
    ...(opened.frameIntervalMs === undefined
      ? {}
      : { frameIntervalMs: opened.frameIntervalMs }),
    ...(controls === undefined ? {} : { controls }),
    ...(video === undefined ? {} : { video }),
    ...(sink === undefined ? {} : { sink }),
  };

  return {
    device,

    async attach(page: PanelWorkerPage): Promise<Rasterizer> {
      await ask({ kind: "attach", pageUrl: page.pageUrl, url: page.url });

      return {
        capture: async () =>
          await ask<Uint8Array>({ kind: "capture", overlay: false }),
        captureOverlay: async () =>
          await ask<Uint8Array>({ kind: "capture", overlay: true }),
        close: async () => {
          // Every release is attempted, as the runner's own stop does: a page
          // the thread could not close is still a target this host must give
          // back.
          let failure: unknown;

          try {
            await ask({ kind: "close-raster" });
          } catch (error) {
            failure = error;
          }

          try {
            await page.closePage();
          } catch (error) {
            failure ??= error;
          }

          if (failure !== undefined) throw failure;
        },
      };
    },
  };
}

function reason(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
