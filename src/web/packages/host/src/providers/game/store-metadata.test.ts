import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSteamStore } from "./store-metadata.js";

const APP_ID = 1201270;
const APP_NAME = "Example Game";
const PORTRAIT = `/steam/apps/${APP_ID}/library_600x900.jpg`;
const HEADER = `https://cdn.akamai.steamstatic.com/steam/apps/${APP_ID}/header.jpg`;

const JPEG = [0xff, 0xd8, 0xff, 0xd9];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const HIT = {
  total: 1,
  items: [{ type: "app", id: APP_ID, name: APP_NAME }],
};
const MISS = { total: 0, items: [] };

function details(
  name = APP_NAME,
  headerImage = HEADER,
): Record<string, unknown> {
  return {
    [String(APP_ID)]: {
      success: true,
      data: { name, header_image: headerImage },
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function bytesOf(values: readonly number[], status = 200): Response {
  return new Response(new Uint8Array(values), { status });
}

interface Call {
  readonly url: URL;
  readonly init: RequestInit | undefined;
}

interface Harness {
  readonly store: ReturnType<typeof createSteamStore>;
  readonly calls: Call[];
  advance(ms: number): void;
}

function harness(
  directory: string,
  respond: (call: Call) => Response | Promise<Response>,
): Harness {
  const calls: Call[] = [];
  let now = 1_000_000;

  const fetchImpl = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(
      input instanceof URL
        ? input.toString()
        : typeof input === "string"
          ? input
          : input.url,
    );
    const call = { url, init };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;

  return {
    store: createSteamStore({
      fetchImpl,
      cacheDir: directory,
      nowMs: () => now,
    }),
    calls,
    advance(ms) {
      now += ms;
    },
  };
}

/** The normal route: a hit, its canonical details, and a JPEG portrait. */
function happyPath(call: Call): Response {
  if (call.url.pathname === "/api/storesearch/") return json(HIT);
  if (call.url.pathname === "/api/appdetails") return json(details());
  if (call.url.pathname.endsWith(PORTRAIT)) return bytesOf(JPEG);
  return new Response("", { status: 404 });
}

const temporary: string[] = [];

async function cacheDir(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-store-"));
  temporary.push(directory);
  return directory;
}

afterEach(async () => {
  for (const directory of temporary.splice(0)) {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

describe("Steam store lookup", () => {
  it("searches by the local name, then reads the canonical app details", async () => {
    const h = harness(await cacheDir(), happyPath);

    await expect(h.store.lookup("Example Game™")).resolves.toEqual({
      id: APP_ID,
      name: APP_NAME,
    });

    expect(h.calls).toHaveLength(2);

    const search = h.calls[0]?.url;
    expect(`${search?.origin}${search?.pathname}`).toBe(
      "https://store.steampowered.com/api/storesearch/",
    );
    expect([...(search?.searchParams.keys() ?? [])].sort()).toEqual([
      "cc",
      "l",
      "term",
    ]);
    expect(search?.searchParams.get("term")).toBe("Example Game™");
    expect(search?.searchParams.get("cc")).toBe("us");
    expect(search?.searchParams.get("l")).toBe("en");
    // Nothing identifying this machine rides along.
    expect(h.calls[0]?.init?.headers).toBeUndefined();

    const appDetails = h.calls[1]?.url;
    expect(appDetails?.pathname).toBe("/api/appdetails");
    expect(appDetails?.searchParams.get("appids")).toBe(String(APP_ID));
    expect(appDetails?.searchParams.get("filters")).toBe("basic");
  });

  it("writes the fixed cache entry shape and answers a restart from disk", async () => {
    const directory = await cacheDir();
    const first = harness(directory, happyPath);
    await first.store.lookup(APP_NAME);

    const file = path.join(directory, "game-metadata.json");
    const stored = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    expect(stored).toEqual({
      "example game": { id: APP_ID, name: APP_NAME, at: 1_000_000 },
    });

    const second = harness(directory, happyPath);
    await expect(second.store.lookup("example game")).resolves.toEqual({
      id: APP_ID,
      name: APP_NAME,
    });
    expect(second.calls).toHaveLength(0);
  });

  it("treats a prototype key as a miss and caches the no-match", async () => {
    const directory = await cacheDir();
    const h = harness(directory, (call) =>
      call.url.pathname === "/api/storesearch/"
        ? json(MISS)
        : new Response("", { status: 500 }),
    );

    await expect(h.store.lookup("Constructor")).resolves.toBeUndefined();
    expect(h.calls).toHaveLength(1);

    const stored = JSON.parse(
      await fs.readFile(path.join(directory, "game-metadata.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(stored["constructor"]).toEqual({ none: true, at: 1_000_000 });
  });

  it("ignores bundle results and accepts only an app result", async () => {
    const mixed = harness(await cacheDir(), (call) => {
      if (call.url.pathname === "/api/storesearch/") {
        return json({
          total: 2,
          items: [
            { type: "bundle", id: 999, name: APP_NAME },
            { type: "app", id: APP_ID, name: APP_NAME },
          ],
        });
      }
      return json(details());
    });

    await expect(mixed.store.lookup(APP_NAME)).resolves.toEqual({
      id: APP_ID,
      name: APP_NAME,
    });
    expect(mixed.calls[1]?.url.searchParams.get("appids")).toBe(String(APP_ID));

    const bundleOnly = harness(await cacheDir(), () =>
      json({ total: 1, items: [{ type: "bundle", id: 999, name: APP_NAME }] }),
    );
    await expect(bundleOnly.store.lookup(APP_NAME)).resolves.toBeUndefined();
    expect(bundleOnly.calls).toHaveLength(1);
  });

  it("caps the persisted cache at 500 entries, evicting the oldest", async () => {
    const directory = await cacheDir();
    const seeded: Record<string, unknown> = {};

    for (let index = 1; index <= 500; index += 1) {
      seeded[`game ${index}`] = { none: true, at: index };
    }

    await fs.writeFile(
      path.join(directory, "game-metadata.json"),
      JSON.stringify(seeded),
    );

    const miss = (call: Call): Response =>
      call.url.pathname === "/api/storesearch/"
        ? json(MISS)
        : new Response("", { status: 500 });

    const h = harness(directory, miss);
    await expect(h.store.lookup("New Game")).resolves.toBeUndefined();

    const file = path.join(directory, "game-metadata.json");
    const stored = JSON.parse(await fs.readFile(file, "utf8")) as Record<
      string,
      unknown
    >;
    expect(Object.keys(stored)).toHaveLength(500);
    expect(stored["game 1"]).toBeUndefined();
    expect(stored["game 2"]).toBeDefined();
    expect(stored["new game"]).toEqual({ none: true, at: 1_000_000 });

    // A restart reads the capped file: the survivor answers without a request,
    // the evicted name needs one.
    const restarted = harness(directory, miss);
    await restarted.store.lookup("game 2");
    expect(restarted.calls).toHaveLength(0);
    await restarted.store.lookup("game 1");
    expect(restarted.calls).toHaveLength(1);
  });

  it("tolerates an absent or corrupt cache file", async () => {
    const absent = harness(await cacheDir(), happyPath);
    await expect(absent.store.lookup(APP_NAME)).resolves.toEqual({
      id: APP_ID,
      name: APP_NAME,
    });
    expect(absent.calls).toHaveLength(2);

    const corrupt = await cacheDir();
    const file = path.join(corrupt, "game-metadata.json");
    await fs.writeFile(file, "{ not json");

    const h = harness(corrupt, happyPath);
    await expect(h.store.lookup(APP_NAME)).resolves.toEqual({
      id: APP_ID,
      name: APP_NAME,
    });

    const stored = JSON.parse(await fs.readFile(file, "utf8")) as Record<
      string,
      unknown
    >;
    expect(stored["example game"]).toEqual({
      id: APP_ID,
      name: APP_NAME,
      at: 1_000_000,
    });
  });

  it("makes no second request for the same normalised name", async () => {
    const h = harness(await cacheDir(), happyPath);
    await h.store.lookup("Example Game");
    await h.store.lookup("EXAMPLE  GAME");
    expect(h.calls).toHaveLength(2);
  });

  it("caches a no-match for the process life", async () => {
    const directory = await cacheDir();
    const h = harness(directory, (call) => {
      if (call.url.pathname === "/api/storesearch/") return json(MISS);
      return new Response("", { status: 500 });
    });

    await expect(h.store.lookup(APP_NAME)).resolves.toBeUndefined();
    await expect(h.store.lookup(APP_NAME)).resolves.toBeUndefined();
    expect(h.calls).toHaveLength(1);

    const stored = JSON.parse(
      await fs.readFile(path.join(directory, "game-metadata.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(stored["example game"]).toEqual({ none: true, at: 1_000_000 });

    const restarted = harness(directory, happyPath);
    await expect(restarted.store.lookup(APP_NAME)).resolves.toBeUndefined();
    expect(restarted.calls).toHaveLength(0);
  });

  it("refuses a sequel and caches that refusal", async () => {
    const h = harness(await cacheDir(), (call) => {
      if (call.url.pathname === "/api/storesearch/") {
        return json({
          total: 1,
          items: [{ type: "app", id: 70, name: "Half-Life 2" }],
        });
      }
      return json(details("Half-Life 2"));
    });

    await expect(h.store.lookup("Half-Life")).resolves.toBeUndefined();
    await expect(h.store.lookup("Half-Life")).resolves.toBeUndefined();
    expect(h.calls).toHaveLength(1);
  });

  it("suppresses a 429 for ten minutes, then retries", async () => {
    let status = 429;
    const h = harness(await cacheDir(), (call) =>
      call.url.pathname === "/api/storesearch/"
        ? status === 429
          ? json({}, 429)
          : json(HIT)
        : json(details()),
    );

    await expect(h.store.lookup(APP_NAME)).resolves.toBeUndefined();
    expect(h.calls).toHaveLength(1);

    await expect(h.store.lookup(APP_NAME)).resolves.toBeUndefined();
    expect(h.calls).toHaveLength(1);

    h.advance(10 * 60_000 - 1);
    await expect(h.store.lookup(APP_NAME)).resolves.toBeUndefined();
    expect(h.calls).toHaveLength(1);

    status = 200;
    h.advance(1);
    await expect(h.store.lookup(APP_NAME)).resolves.toEqual({
      id: APP_ID,
      name: APP_NAME,
    });
    expect(h.calls).toHaveLength(3);
  });

  it("suppresses a rejected fetch for ten minutes", async () => {
    let reject = true;
    const h = harness(await cacheDir(), (call) => {
      if (reject) throw new Error("offline");
      return happyPath(call);
    });

    await expect(h.store.lookup(APP_NAME)).resolves.toBeUndefined();
    await expect(h.store.lookup(APP_NAME)).resolves.toBeUndefined();
    expect(h.calls).toHaveLength(1);

    reject = false;
    h.advance(10 * 60_000);
    await expect(h.store.lookup(APP_NAME)).resolves.toEqual({
      id: APP_ID,
      name: APP_NAME,
    });
  });

  it("leaves other entries untouched when a lookup fails", async () => {
    const directory = await cacheDir();
    const h = harness(directory, (call) => {
      const name = call.url.searchParams.get("term");
      if (name === "Broken Game") return json({}, 429);
      return happyPath(call);
    });

    await h.store.lookup(APP_NAME);
    await expect(h.store.lookup("Broken Game")).resolves.toBeUndefined();

    const stored = JSON.parse(
      await fs.readFile(path.join(directory, "game-metadata.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(stored["example game"]).toEqual({
      id: APP_ID,
      name: APP_NAME,
      at: 1_000_000,
    });
    expect(stored["broken game"]).toBeUndefined();
  });
});

describe("Steam store cover", () => {
  it("caches portrait bytes and makes no second request", async () => {
    const directory = await cacheDir();
    const h = harness(directory, happyPath);

    await expect(h.store.cover(APP_ID)).resolves.toBe(
      `/api/game/artwork/${APP_ID}.jpg`,
    );
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]?.url.toString()).toBe(
      `https://cdn.akamai.steamstatic.com${PORTRAIT}`,
    );
    expect([
      ...(await fs.readFile(path.join(directory, `${APP_ID}.jpg`))),
    ]).toEqual(JPEG);

    await expect(h.store.cover(APP_ID)).resolves.toBe(
      `/api/game/artwork/${APP_ID}.jpg`,
    );
    expect(h.calls).toHaveLength(1);
  });

  it("falls back to header_image when the portrait answers 404", async () => {
    const directory = await cacheDir();
    const h = harness(directory, (call) => {
      if (call.url.pathname.endsWith(PORTRAIT)) {
        return new Response("", { status: 404 });
      }
      if (call.url.pathname === "/api/appdetails") return json(details());
      if (call.url.toString() === HEADER) return bytesOf(PNG);
      return new Response("", { status: 404 });
    });

    await expect(h.store.cover(APP_ID)).resolves.toBe(
      `/api/game/artwork/${APP_ID}.png`,
    );
    expect(h.calls.map((call) => call.url.toString())).toEqual([
      `https://cdn.akamai.steamstatic.com${PORTRAIT}`,
      `https://store.steampowered.com/api/appdetails?appids=${APP_ID}&filters=basic`,
      HEADER,
    ]);
    expect([
      ...(await fs.readFile(path.join(directory, `${APP_ID}.png`))),
    ]).toEqual(PNG);
  });

  it("writes nothing when the bytes are not a JPEG or PNG", async () => {
    const directory = await cacheDir();
    const h = harness(directory, () => bytesOf([0x3c, 0x68, 0x74, 0x6d, 0x6c]));

    await expect(h.store.cover(APP_ID)).resolves.toBeUndefined();
    await expect(fs.readdir(directory)).resolves.toEqual([]);
  });

  it("suppresses a failed cover for ten minutes, then retries", async () => {
    let available = false;
    const h = harness(await cacheDir(), (call) =>
      available ? happyPath(call) : new Response("", { status: 404 }),
    );

    await expect(h.store.cover(APP_ID)).resolves.toBeUndefined();
    // The portrait and the details fallback, both refused.
    expect(h.calls).toHaveLength(2);

    await expect(h.store.cover(APP_ID)).resolves.toBeUndefined();
    expect(h.calls).toHaveLength(2);

    h.advance(10 * 60_000 - 1);
    await expect(h.store.cover(APP_ID)).resolves.toBeUndefined();
    expect(h.calls).toHaveLength(2);

    available = true;
    h.advance(1);
    await expect(h.store.cover(APP_ID)).resolves.toBe(
      `/api/game/artwork/${APP_ID}.jpg`,
    );
    expect(h.calls).toHaveLength(3);
  });

  it("clears the cover suppression on success and serves the cached file", async () => {
    let available = false;
    const h = harness(await cacheDir(), (call) =>
      available ? happyPath(call) : new Response("", { status: 404 }),
    );

    await expect(h.store.cover(APP_ID)).resolves.toBeUndefined();
    expect(h.calls).toHaveLength(2);

    available = true;
    h.advance(10 * 60_000);
    await expect(h.store.cover(APP_ID)).resolves.toBe(
      `/api/game/artwork/${APP_ID}.jpg`,
    );
    expect(h.calls).toHaveLength(3);

    h.advance(10 * 60_000);
    await expect(h.store.cover(APP_ID)).resolves.toBe(
      `/api/game/artwork/${APP_ID}.jpg`,
    );
    expect(h.calls).toHaveLength(3);
  });

  it("refuses a non-positive app id without a request", async () => {
    const h = harness(await cacheDir(), happyPath);
    await expect(h.store.cover(0)).resolves.toBeUndefined();
    await expect(h.store.cover(-1)).resolves.toBeUndefined();
    expect(h.calls).toHaveLength(0);
  });
});
