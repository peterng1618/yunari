import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createThemeOriginsStore, type ThemeOrigin } from "./theme-origins.js";

/** The file as a hand-edited one would be, for the reader to read. */
const originsFile = (dir: string) => path.join(dir, "theme-origins.json");

const origin = (catalogueId: string): ThemeOrigin => ({
  catalogueId,
  version: "1.2.0",
  installedAt: "2026-10-21T09:00:00.000Z",
});

describe("theme origins", () => {
  let dir: string;
  let store: ReturnType<typeof createThemeOriginsStore>;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "yunari-theme-origins-"));
    store = createThemeOriginsStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seed(contents: string): Promise<void> {
    await writeFile(originsFile(dir), contents, "utf8");
  }

  it("reads an absent file as no origins", async () => {
    expect(await store.read()).toEqual({});
  });

  it("writes one theme's origin without disturbing another's", async () => {
    await store.write("living-room", origin("catalogue-living-room"));
    await store.write("office", origin("catalogue-office"));

    expect(await store.read()).toEqual({
      "living-room": origin("catalogue-living-room"),
      office: origin("catalogue-office"),
    });
  });

  it("serializes overlapping writes so neither entry is lost", async () => {
    // Both are read-modify-write over one file: an install's write can overlap
    // a delete's removal, and an unserialized pair reads the same map twice and
    // lets the later save replace the other's entry.
    const pairs = Array.from({ length: 5 }, (_unused, index) => index);
    await Promise.all(
      pairs.flatMap((index) => [
        store.write(`left-${index}`, origin(`catalogue-left-${index}`)),
        store.write(`right-${index}`, origin(`catalogue-right-${index}`)),
      ]),
    );

    const expected = Object.fromEntries(
      pairs.flatMap((index) => [
        [`left-${index}`, origin(`catalogue-left-${index}`)],
        [`right-${index}`, origin(`catalogue-right-${index}`)],
      ]),
    );
    expect(await store.read()).toEqual(expected);
  });

  it("never answers a reader racing a write with a half-written map", async () => {
    // Seeded so an empty answer is visibly wrong: `readOrigins` swallows a
    // parse error into `{}`, so a reader landing inside a truncating save
    // silently drops every origin rather than reporting a fault. Three hundred
    // entries is enough to make the save's window non-trivial; the property is
    // losing the map, not how large it is, and a 3000-entry map made this case
    // cost ~20 s under a loaded gate.
    const seeded = Object.fromEntries(
      Array.from({ length: 300 }, (_unused, index) => [
        `theme-${index}`,
        origin(`catalogue-${index}`),
      ]),
    );
    await seed(JSON.stringify(seeded));

    // The reads are staggered rather than all issued at t=0: they must land
    // inside the writes' window, not all resolve before the first one starts.
    // Every write keeps every seeded key, so a whole answer always holds them.
    const writes = Promise.all(
      Array.from({ length: 30 }, (_unused, index) =>
        store.write(`theme-${index}`, origin("catalogue-moved")),
      ),
    );
    const answers = await Promise.all(
      Array.from({ length: 60 }, async (_unused, index) => {
        await new Promise((resolve) => setTimeout(resolve, index));
        return store.read();
      }),
    );
    await writes;

    for (const answer of answers) {
      expect(
        Object.keys(answer).length,
        "a read racing a write lost the map",
      ).toBeGreaterThanOrEqual(Object.keys(seeded).length);
    }
  });

  it("answers a read issued during a write with the completed write", async () => {
    await store.write("wall", origin("catalogue-wall"));

    // The read is requested before the write settles; it must still see the
    // write, not the map the write started from.
    const writing = store.write("office", origin("catalogue-office"));
    const reading = store.read();
    const [, read] = await Promise.all([writing, reading]);

    expect(read).toEqual({
      wall: origin("catalogue-wall"),
      office: origin("catalogue-office"),
    });
  });

  it("drops an entry whose fields are not the three strings", async () => {
    await seed(
      JSON.stringify({
        wall: origin("catalogue-wall"),
        "bad id": origin("catalogue-bad"),
        missing: { catalogueId: "catalogue-missing", version: "1.0.0" },
        numbered: { catalogueId: "c", version: 2, installedAt: "then" },
        nulled: null,
        listed: [origin("catalogue-listed")],
      }),
    );

    // A hand-edited file must not blank the whole map, so one bad entry is
    // dropped rather than throwing the rest away.
    expect(await store.read()).toEqual({ wall: origin("catalogue-wall") });
  });

  it("removes one theme's entry and leaves the rest", async () => {
    await store.write("wall", origin("catalogue-wall"));
    await store.write("office", origin("catalogue-office"));

    await store.removeTheme("wall");

    expect(await store.read()).toEqual({ office: origin("catalogue-office") });
  });

  it("writes nothing when asked to remove a theme it has no entry for", async () => {
    const stored = JSON.stringify({ wall: origin("catalogue-wall") });
    await seed(stored);

    await store.removeTheme("office");

    expect(await readFile(originsFile(dir), "utf8")).toBe(stored);
  });

  it("treats a malformed file as no origins, and does not write over it", async () => {
    const corrupt = "{ not json";
    await seed(corrupt);

    expect(await store.read()).toEqual({});

    // Same rule as the absent file, and the same rule theme-settings.ts states:
    // nothing to remove is no write, so the unreadable file survives.
    await store.removeTheme("wall");

    expect(await readFile(originsFile(dir), "utf8")).toBe(corrupt);
  });

  it("refuses an id that is not a theme id, on write", async () => {
    await expect(
      store.write("../escape", origin("catalogue-x")),
    ).rejects.toThrow("Invalid");

    // A refused write is no write at all, so there is nothing on disk to read
    // back — the assertion that can go red, where `read()` answering `{}` on a
    // directory that was never written to cannot.
    await expect(readFile(originsFile(dir), "utf8")).rejects.toThrow();
  });

  it("writes nothing when the id names something on the prototype", async () => {
    const corrupt = "{ not json";
    await seed(corrupt);

    // `constructor` is a legal theme id, and `themeId in all` walks the
    // prototype chain and finds it, so a guard written that way would call this
    // a removal and replace the unreadable file with `{}`.
    await store.removeTheme("constructor");

    expect(await readFile(originsFile(dir), "utf8")).toBe(corrupt);
  });

  it("keeps a __proto__ key as an entry rather than as the map's prototype", async () => {
    // Built with `fromEntries` because `{ __proto__: x }` in a literal sets the
    // prototype, which is the very confusion this case is about.
    await seed(
      JSON.stringify(
        Object.fromEntries([["__proto__", origin("catalogue-proto")]]),
      ),
    );

    const read = await store.read();

    expect(Object.hasOwn(read, "__proto__")).toBe(true);
    expect(read["__proto__"]).toEqual(origin("catalogue-proto"));
    expect(Object.getPrototypeOf(read)).toBe(Object.prototype);

    // And it survives a write beside another theme, landing in the file as a key.
    await store.write("wall", origin("catalogue-wall"));

    expect(JSON.parse(await readFile(originsFile(dir), "utf8"))).toEqual(
      Object.fromEntries([
        ["__proto__", origin("catalogue-proto")],
        ["wall", origin("catalogue-wall")],
      ]),
    );
  });

  it("drops an entry stored under a key that is not a theme id", async () => {
    await seed(JSON.stringify({ "../escape": origin("catalogue-x") }));

    expect(await store.read()).toEqual({});

    // The key is dropped by the reader; a write lands the normalised map, where
    // a key that was carried rather than dropped would show.
    await store.write("wall", origin("catalogue-wall"));

    expect(JSON.parse(await readFile(originsFile(dir), "utf8"))).toEqual({
      wall: origin("catalogue-wall"),
    });
  });
});
