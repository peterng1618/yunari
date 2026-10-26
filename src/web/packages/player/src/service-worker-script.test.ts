import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `public/sw.js` is copied verbatim by Vite, so this runs the real file against
 * a fake service-worker global rather than a transcription of it: the rule
 * under test is which navigation the worker stores, and a copy could drift.
 */

const ORIGIN = "http://127.0.0.1:8080";

type FetchEvent = {
  readonly request: {
    readonly method: string;
    readonly mode: string;
    readonly url: string;
  };
  respondWith: (answer: Promise<Response>) => void;
};

function loadWorker(): {
  readonly listeners: Map<string, (event: FetchEvent) => void>;
  readonly stored: Map<string, Response>;
} {
  const source = readFileSync(
    fileURLToPath(new URL("../public/sw.js", import.meta.url)),
    "utf8",
  );
  const listeners = new Map<string, (event: FetchEvent) => void>();
  const stored = new Map<string, Response>();
  const cache = {
    async addAll() {
      return undefined;
    },
    async put(key: string, response: Response) {
      stored.set(key, response);
    },
  };
  const caches = {
    async open() {
      return cache;
    },
    async match(key: string) {
      return stored.get(key);
    },
    async keys() {
      return [...stored.keys()];
    },
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener(type: string, listener: (event: FetchEvent) => void) {
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
  return { listeners, stored };
}

function navigate(
  listener: (event: FetchEvent) => void,
  path: string,
): Promise<Response> | undefined {
  let answered: Promise<Response> | undefined;
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

function fetchListener(listeners: Map<string, (event: FetchEvent) => void>) {
  const listener = listeners.get("fetch");
  if (listener === undefined)
    throw new Error("sw.js registered no fetch handler");
  return listener;
}

afterEach(() => vi.unstubAllGlobals());

describe("the published service worker's navigation cache", () => {
  it("answers the player's document from the network and stores it under the shell key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("player")),
    );
    const { listeners, stored } = loadWorker();

    const answered = navigate(fetchListener(listeners), "/?theme=office");

    expect(answered).toBeDefined();
    expect((await answered)?.status).toBe(200);
    await vi.waitFor(() => expect(stored.has("/")).toBe(true));
  });

  it("passes every other navigation through, so no other page is cached", () => {
    const fetched = vi.fn(async () => new Response("editor"));
    vi.stubGlobal("fetch", fetched);
    const { listeners, stored } = loadWorker();

    const answered = navigate(fetchListener(listeners), "/editor/");

    // No `respondWith` means the browser fetches the page itself: the worker
    // neither caches it nor answers it from the player's document.
    expect(answered).toBeUndefined();
    expect(fetched).not.toHaveBeenCalled();
    expect(stored.size).toBe(0);
  });
});
