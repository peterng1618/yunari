import { describe, expect, it } from "vitest";
import type { LibraryModule } from "./library.js";
import {
  createLibraryWorker,
  type LibraryWorker,
  type Threaded,
  type WorkerSeam,
} from "./library-worker.js";

interface Posted {
  readonly id: number;
  readonly method: string;
  readonly args: readonly unknown[];
}

/** A thread the test drives by hand: it records requests and answers them. */
function fakeThread(): {
  readonly thread: Threaded;
  readonly posted: Posted[];
  readonly emit: (event: "message" | "error" | "exit", value: unknown) => void;
} {
  const posted: Posted[] = [];
  const listeners = new Map<string, ((value: never) => void)[]>();

  return {
    posted,
    emit: (event, value) => {
      for (const listener of listeners.get(event) ?? []) {
        (listener as (raw: unknown) => void)(value);
      }
    },
    thread: {
      on: (event, listener) => {
        listeners.set(event, [
          ...(listeners.get(event) ?? []),
          listener as (value: never) => void,
        ]);
      },
      postMessage: (message) => {
        posted.push(message as Posted);
      },
      unref: () => {},
      terminate: () => {},
    },
  };
}

/** A local module that answers without touching the machine. */
const LOCAL = {
  mem: async () => ({ total: 42 }),
  time: () => ({ current: 7 }),
} as unknown as LibraryModule;

async function workerOver(thread: Threaded): Promise<LibraryWorker> {
  const seam: WorkerSeam = { spawn: () => thread };
  return createLibraryWorker(seam, async () => LOCAL);
}

describe("createLibraryWorker", () => {
  it("asks the thread and answers with what it returned", async () => {
    const { thread, posted, emit } = fakeThread();
    const worker = await workerOver(thread);

    const pending = worker.module.graphics();
    expect(posted).toHaveLength(1);
    expect(posted[0]?.method).toBe("graphics");

    emit("message", {
      id: posted[0]?.id,
      ok: true,
      value: { controllers: [{ model: "Fake GPU" }] },
    });

    await expect(pending).resolves.toEqual({
      controllers: [{ model: "Fake GPU" }],
    });
    worker.close();
  });

  it("is not a thenable: awaiting the module yields the module", async () => {
    const { thread, posted } = fakeThread();
    const worker = await workerOver(thread);

    await expect(Promise.resolve(worker.module)).resolves.toBe(worker.module);
    expect(posted).toHaveLength(0);
    worker.close();
  });

  it("serves the synchronous time read locally, without a request", async () => {
    const { thread, posted } = fakeThread();
    const worker = await workerOver(thread);

    expect(worker.module.time()).toEqual({ current: 7 });
    expect(posted).toHaveLength(0);
    worker.close();
  });

  it("falls back to the local copy once the thread is gone", async () => {
    const { thread, posted, emit } = fakeThread();
    const worker = await workerOver(thread);

    emit("error", new Error("the thread died"));

    await expect(worker.module.mem()).resolves.toEqual({ total: 42 });
    expect(posted, "no request reaches a dead thread").toHaveLength(0);
    worker.close();
  });

  it("rejects the requests already in flight when the thread dies", async () => {
    const { thread, emit } = fakeThread();
    const worker = await workerOver(thread);

    const pending = worker.module.graphics();
    emit("exit", 1);

    await expect(pending).rejects.toThrow(/exited with 1/);
    worker.close();
  });
});
