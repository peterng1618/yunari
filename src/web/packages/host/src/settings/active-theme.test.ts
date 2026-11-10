import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createActiveThemeStore } from "./active-theme.js";
import { DEFAULT_DISPLAY } from "./displays.js";

/** Every theme exists, so a case about the store is not a case about its caller. */
const yes = async () => true;

const settingsFile = (dir: string) => path.join(dir, "active-theme.json");

describe("the active theme", () => {
  let dir: string;
  let store: ReturnType<typeof createActiveThemeStore>;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "yunari-active-"));
    store = createActiveThemeStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("chooses nothing before a consumer has chosen", async () => {
    expect(await store.read(DEFAULT_DISPLAY, yes)).toBeUndefined();
  });

  it("remembers a choice", async () => {
    await store.write(DEFAULT_DISPLAY, "living-room");

    expect(await store.read(DEFAULT_DISPLAY, yes)).toBe("living-room");
  });

  it("reads back what one display was given, and nothing for another", async () => {
    await store.write("hall-tv", "attic-wall");

    expect(await store.read("hall-tv", yes)).toBe("attic-wall");
    expect(await store.read("kitchen-tablet", yes)).toBeUndefined();
  });

  it("keeps one display's choice when another is written", async () => {
    await store.write("hall-tv", "attic-wall");
    await store.write("kitchen-tablet", "living-room");

    expect(await store.read("hall-tv", yes)).toBe("attic-wall");
    expect(await store.read("kitchen-tablet", yes)).toBe("living-room");
  });

  it("reads every display's entry at once", async () => {
    await store.write("hall-tv", "attic-wall");
    await store.write("kitchen-tablet", "living-room");
    await store.write(DEFAULT_DISPLAY, "kitchen-strip");

    // One read of the file rather than one per display: this is the whole map a
    // list of every display is drawn from.
    expect(await store.readAll(yes)).toEqual({
      "hall-tv": "attic-wall",
      "kitchen-tablet": "living-room",
      [DEFAULT_DISPLAY]: "kitchen-strip",
    });
  });

  it("leaves out of that map a theme that is gone", async () => {
    await store.write("hall-tv", "deleted-theme");
    await store.write("kitchen-tablet", "living-room");

    // The same rule a single read makes: an entry naming a theme the library no
    // longer holds is no choice, and a list must not show one.
    expect(await store.readAll(async (id) => id !== "deleted-theme")).toEqual({
      "kitchen-tablet": "living-room",
    });
  });

  it("keeps both when two displays are written at once", async () => {
    await Promise.all([
      store.write("hall-tv", "attic-wall"),
      store.write("kitchen-tablet", "living-room"),
    ]);

    // Each write is a read-modify-write of the whole map, so an unserialized
    // pair reads the same map and the later save drops the earlier entry.
    expect(await store.read("hall-tv", yes)).toBe("attic-wall");
    expect(await store.read("kitchen-tablet", yes)).toBe("living-room");
  });

  it("does not serve the default's theme to a display with no entry", async () => {
    await store.write(DEFAULT_DISPLAY, "living-room");

    expect(await store.read("hall-tv", yes)).toBeUndefined();
  });

  it("treats a theme that is gone as no choice", async () => {
    await store.write("hall-tv", "deleted-theme");

    expect(await store.read("hall-tv", async () => false)).toBeUndefined();
  });

  it("reads the old single-theme file as the default", async () => {
    await writeFile(settingsFile(dir), '{"id":"living-room"}', "utf8");

    expect(await store.read(DEFAULT_DISPLAY, yes)).toBe("living-room");
  });

  it("reads a file holding a display beside `id` as the map it is", async () => {
    await writeFile(
      settingsFile(dir),
      '{"id":"living-room","hall-tv":"attic-wall"}',
      "utf8",
    );

    // `id` is a legal display id, so a second key makes this a map rather than
    // the old single-theme shape — and reading it as the old shape would take
    // `hall-tv`'s theme with it.
    expect(await store.read(DEFAULT_DISPLAY, yes)).toBeUndefined();
    expect(await store.read("hall-tv", yes)).toBe("attic-wall");

    await store.write("kitchen-tablet", "living-room");

    expect(await store.read("hall-tv", yes)).toBe("attic-wall");
  });

  it("reads the machine's old entry as the default's", async () => {
    await writeFile(
      settingsFile(dir),
      '{"this-pc":"living-room","hall-tv":"attic-wall"}',
      "utf8",
    );

    // The machine was a row of its own before an assignment belonged to a
    // display. What it was served is what a display with no choice of its own
    // is served now, and the other display keeps its own.
    expect(await store.read(DEFAULT_DISPLAY, yes)).toBe("living-room");
    expect(await store.read("hall-tv", yes)).toBe("attic-wall");

    await store.write("kitchen-tablet", "attic-wall");

    expect(JSON.parse(await readFile(settingsFile(dir), "utf8"))).toEqual({
      [DEFAULT_DISPLAY]: "living-room",
      "hall-tv": "attic-wall",
      "kitchen-tablet": "attic-wall",
    });
  });

  it("keeps a default already written over the machine's old entry", async () => {
    await writeFile(
      settingsFile(dir),
      '{"this-pc":"living-room","default":"attic-wall"}',
      "utf8",
    );

    expect(await store.read(DEFAULT_DISPLAY, yes)).toBe("attic-wall");
  });

  it("writes the map once it writes, so the old key is not written again", async () => {
    await writeFile(settingsFile(dir), '{"id":"living-room"}', "utf8");
    await store.write("hall-tv", "attic-wall");

    // The default's own choice survives the migration and is spelled the way
    // the map spells it.
    expect(JSON.parse(await readFile(settingsFile(dir), "utf8"))).toEqual({
      [DEFAULT_DISPLAY]: "living-room",
      "hall-tv": "attic-wall",
    });
  });

  it("refuses an id that is not a theme id, on write", async () => {
    await expect(store.write("hall-tv", "../etc")).rejects.toThrow();
  });

  it("treats a corrupt file as nothing chosen", async () => {
    await writeFile(settingsFile(dir), "{ not json", "utf8");

    expect(await store.read(DEFAULT_DISPLAY, yes)).toBeUndefined();
  });

  it("refuses to write over a file it could not read", async () => {
    await writeFile(settingsFile(dir), "{ not json", "utf8");

    // Every mutator rewrites the whole map, so a write that started from a file
    // it could not read would take the other displays' choices with it.
    await expect(store.write("hall-tv", "attic-wall")).rejects.toThrow(
      "could not be read",
    );
    expect(await readFile(settingsFile(dir), "utf8")).toBe("{ not json");
  });

  it("refuses to clear over a file it could not read", async () => {
    await writeFile(settingsFile(dir), "{ not json", "utf8");

    await expect(store.clear("hall-tv")).rejects.toThrow("could not be read");
    expect(await readFile(settingsFile(dir), "utf8")).toBe("{ not json");
  });

  it("clears one display without touching another", async () => {
    await store.write("hall-tv", "attic-wall");
    await store.write("kitchen-tablet", "living-room");

    await store.clear("hall-tv");

    expect(await store.read("hall-tv", yes)).toBeUndefined();
    expect(await store.read("kitchen-tablet", yes)).toBe("living-room");
  });
});
