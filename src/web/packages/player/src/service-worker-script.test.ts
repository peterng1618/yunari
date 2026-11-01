import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `public/sw.js` is copied verbatim by Vite, so this runs the real file against
 * a fake service-worker global rather than a transcription of it: the rules
 * under test are which navigation the worker stores and which builds it keeps,
 * and a copy could drift.
 */

const ORIGIN = "http://127.0.0.1:8080";

type RequestLike = {
  readonly method: string;
  readonly mode: string;
  readonly url: string;
};
type FetchEvent = {
  readonly request: RequestLike;
  respondWith: (answer: Promise<Response>) => void;
};

type FakeCache = {
  addAll(urls: readonly string[]): Promise<void>;
  put(key: string | RequestLike, response: Response): Promise<void>;
};

type FakeCaches = {
  readonly entries: Map<string, Map<string, Response>>;
  open(name: string): Promise<FakeCache>;
  match(key: string | RequestLike): Promise<Response | undefined>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
};

type Worker = {
  readonly listeners: Map<string, (event: never) => void>;
  readonly caches: FakeCaches;
  /** Runs a lifecycle listener and returns what it passed to `waitUntil`. */
  run(type: string): Promise<void>;
};

function keyOf(key: string | RequestLike): string {
  return typeof key === "string" ? key : key.url;
}

function loadWorker(): Worker {
  const source = readFileSync(
    fileURLToPath(new URL("../public/sw.js", import.meta.url)),
    "utf8",
  );
  const listeners = new Map<string, (event: never) => void>();
  const entries = new Map<string, Map<string, Response>>();

  const entriesOf = (name: string): Map<string, Response> => {
    const existing = entries.get(name);
    if (existing !== undefined) return existing;
    const created = new Map<string, Response>();
    entries.set(name, created);
    return created;
  };

  const caches: FakeCaches = {
    entries,
    async open(name) {
      const held = entriesOf(name);
      return {
        async addAll(urls) {
          for (const url of urls) held.set(url, new Response("cached"));
        },
        async put(key, response) {
          held.set(keyOf(key), response);
        },
      };
    },
    async match(key) {
      for (const held of entries.values()) {
        const found = held.get(keyOf(key));
        if (found !== undefined) return found;
      }
      return undefined;
    },
    async keys() {
      return [...entries.keys()];
    },
    async delete(name) {
      return entries.delete(name);
    },
  };

  const self = {
    location: { origin: ORIGIN },
    addEventListener(type: string, listener: (event: never) => void) {
      listeners.set(type, listener);
    },
    async skipWaiting() {
      return undefined;
    },
    clients: {
      async claim() {
        return undefined;
      },
    },
  };

  new Function("self", "caches", source)(self, caches);

  return {
    listeners,
    caches,
    async run(type) {
      const listener = listeners.get(type);
      if (listener === undefined)
        throw new Error(`sw.js has no ${type} handler`);

      let running: Promise<void> | undefined;
      listener({
        request: { method: "GET", mode: "navigate", url: `${ORIGIN}/` },
        respondWith(answer: Promise<Response>) {
          running = answer.then(() => undefined);
        },
        waitUntil(promise: Promise<void>) {
          running = promise;
        },
      } as never);

      if (running === undefined) throw new Error(`${type} did nothing`);
      return running;
    },
  };
}

/** Answers the document with `html`, and every other URL with a small body. */
function serve(html: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      return new Response(url === "/" ? html : "asset");
    }),
  );
}

/** Loads the worker and runs the install that names a cache from `html`. */
async function installed(
  html: string,
): Promise<{ worker: Worker; name: string }> {
  serve(html);
  const worker = loadWorker();
  await worker.run("install");

  const shells = (await worker.caches.keys()).filter((key) =>
    key.startsWith("yunari-shell-"),
  );
  expect(shells).toHaveLength(1);
  return { worker, name: shells[0] ?? "" };
}

function navigate(worker: Worker, path: string): Promise<Response> | undefined {
  let answered: Promise<Response> | undefined;
  const listener = worker.listeners.get("fetch") as
    | ((event: FetchEvent) => void)
    | undefined;
  if (listener === undefined)
    throw new Error("sw.js registered no fetch handler");

  listener({
    request: {
      method: "GET",
      mode: "navigate",
      url: new URL(path, ORIGIN).href,
    },
    respondWith(answer) {
      answered = answer;
    },
  });
  return answered;
}

afterEach(() => vi.unstubAllGlobals());

describe("the published service worker's shell cache", () => {
  it("names the cache from the document and drops the previous build on activate", async () => {
    const { worker, name } = await installed("<html>build one</html>");
    // A display upgrading from the fixed-name cache the worker used to write.
    worker.caches.entries.set("yunari-shell-v2", new Map());

    await worker.run("activate");

    expect(name.startsWith("yunari-shell-")).toBe(true);
    expect(name).not.toBe("yunari-shell-v2");
    // The old build's hashed assets are what would otherwise accumulate.
    expect(await worker.caches.keys()).toEqual([name]);
  });

  it("rotates on the next navigation, because a rebuilt bundle need not change the worker", async () => {
    const { worker, name: first } = await installed("<html>build one</html>");

    serve("<html>build two</html>");
    const answered = navigate(worker, "/?theme=office");
    expect((await answered)?.status).toBe(200);

    await vi.waitFor(async () => {
      expect(worker.caches.entries.has(first)).toBe(false);
    });

    const [second] = await worker.caches.keys();
    expect(second).not.toBe(first);
    await vi.waitFor(() =>
      expect(worker.caches.entries.get(second ?? "")?.has("/")).toBe(true),
    );
  });

  it("answers the player's document from the network and stores it under the shell key", async () => {
    const { worker, name } = await installed("<html>build one</html>");

    serve("<html>build one</html>");
    const answered = navigate(worker, "/?theme=office");

    expect(answered).toBeDefined();
    expect((await answered)?.status).toBe(200);
    await vi.waitFor(() =>
      expect(worker.caches.entries.get(name)?.has("/")).toBe(true),
    );
  });

  it("passes every other navigation through, so no other page is cached", async () => {
    const { worker } = await installed("<html>build one</html>");
    const fetched = vi.fn(async () => new Response("editor"));
    vi.stubGlobal("fetch", fetched);

    const answered = navigate(worker, "/editor/");

    // No `respondWith` means the browser fetches the page itself: the worker
    // neither caches it nor answers it from the player's document.
    expect(answered).toBeUndefined();
    expect(fetched).not.toHaveBeenCalled();
  });
});
