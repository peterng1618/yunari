import { Worker } from "node:worker_threads";
import type { LibraryModule } from "./library.js";

/**
 * The sensor library's reads on a thread that is not the panel's.
 *
 * **Every `systeminformation` family shells out synchronously.** Measured on
 * this host with a 5 ms interval watching for gaps: `graphics()` blocks the
 * thread for 124 ms, `networkStats()` for 124 ms, the CPU and memory reads for
 * 16–55 ms. A panel frame is an asynchronous USB transfer completed on the same
 * loop, so every one of those blocks holds a frame on the glass; the ring that
 * carries 12.9 frames a second delivered 11.4 with a 150 ms hitch once a
 * second, all of it this.
 *
 * A worker thread is the whole fix: the library is asked on another thread and
 * answers over `postMessage`, and the values it returns are plain data.
 */

/**
 * The worker's program. `eval` so nothing is added to the host's build: the
 * module is resolved from the same install the host runs from, through
 * `createRequire` based at the host package rather than the process cwd.
 */
const SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const { createRequire } = require("node:module");

const requireFrom = createRequire(workerData.base);
const imported = requireFrom("systeminformation");
const library = imported.default ?? imported;

parentPort.on("message", (message) => {
  Promise.resolve()
    .then(() => library[message.method](...message.args))
    .then(
      (value) => parentPort.postMessage({ id: message.id, ok: true, value }),
      (error) =>
        parentPort.postMessage({
          id: message.id,
          ok: false,
          message: String((error && error.message) || error),
        }),
    );
});
`;

/** Only the reads this provider makes; `time` is synchronous and stays local. */
type AsyncMethod = Exclude<keyof LibraryModule, "time">;

interface Reply {
  readonly id: number;
  readonly ok: boolean;
  readonly value?: unknown;
  readonly message?: string;
}

/** The base `createRequire` resolves the library from: this package's root. */
const REQUIRE_BASE = new URL("../package.json", import.meta.url).href;

/** A worker typed as the module it stands in for, and how to stop it. */
export interface LibraryWorker {
  readonly module: LibraryModule;
  close(): void;
}

/** What the worker is for, so a test can stand in for the thread. */
export interface WorkerSeam {
  readonly spawn: (source: string, base: string) => Threaded;
}

/** The part of `node:worker_threads`' `Worker` this module uses. */
export interface Threaded {
  on(event: "message", listener: (reply: unknown) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "exit", listener: (code: number) => void): void;
  postMessage(message: unknown): void;
  unref(): void;
  terminate(): Promise<number> | void;
}

const nodeWorker: WorkerSeam = {
  spawn: (source, base) => {
    const worker = new Worker(source, { eval: true, workerData: { base } });
    worker.unref();
    return worker as unknown as Threaded;
  },
};

/** The in-process copy: the `time` read, and where a dead worker falls back. */
async function importLibrary(): Promise<LibraryModule> {
  const imported = await import("systeminformation");
  return (imported.default ?? imported) as unknown as LibraryModule;
}

/**
 * The library, read on a worker.
 *
 * `time()` is the one read with no worker to ask: it is synchronous in the
 * library and costs no subprocess, so it is served from a local copy. Every
 * other method is a request. **A worker that dies falls back to the local copy
 * rather than to gaps**: losing the thread is a speed regression, and a theme
 * that shows no GPU figures because of it would be a wrong answer.
 */
export async function createLibraryWorker(
  seam: WorkerSeam = nodeWorker,
  loadLocal: () => Promise<LibraryModule> = importLibrary,
): Promise<LibraryWorker> {
  const local = await loadLocal();

  let thread: Threaded | undefined;
  let failed = false;
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  const fail = (error: Error): void => {
    failed = true;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };

  try {
    thread = seam.spawn(SOURCE, REQUIRE_BASE);
  } catch {
    // No worker in this environment: the local copy is the whole module.
    thread = undefined;
    failed = true;
  }

  thread?.on("message", (raw) => {
    const reply = raw as Reply;
    const request = pending.get(reply.id);
    if (request === undefined) return;

    pending.delete(reply.id);
    if (reply.ok) {
      request.resolve(reply.value);
      return;
    }

    request.reject(new Error(reply.message ?? "the sensor read failed"));
  });
  thread?.on("error", (error) => {
    fail(error instanceof Error ? error : new Error(String(error)));
  });
  thread?.on("exit", (code) => {
    if (!failed) fail(new Error(`the sensor worker exited with ${code}`));
  });

  const ask = (
    method: AsyncMethod,
    args: readonly unknown[],
  ): Promise<unknown> => {
    const worker = thread;
    if (failed || worker === undefined) {
      return (
        local[method] as (...call: readonly unknown[]) => Promise<unknown>
      )(...args);
    }

    return new Promise((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { resolve, reject });

      try {
        worker.postMessage({ id, method, args });
      } catch (error) {
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  const module = new Proxy(
    { time: () => local.time() },
    {
      get: (target, property: string | symbol) => {
        if (property === "time") return target.time;
        // **Not thenable.** The provider awaits the module's own promise, and a
        // `then` that answered like a read would make the copy a thenable: the
        // runtime would call it with two functions and clone them to the thread.
        if (typeof property !== "string" || property === "then") {
          return undefined;
        }

        return (...args: readonly unknown[]) =>
          ask(property as AsyncMethod, args);
      },
    },
  ) as unknown as LibraryModule;

  return {
    module,
    close: () => {
      failed = true;
      void thread?.terminate();
      thread = undefined;
    },
  };
}
