import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_DISPLAY } from "./displays.js";
import {
  createThemeSettingsStore,
  normalizeAnswers,
} from "./theme-settings.js";

/** The file as a hand-edited one would be, for the reader to read. */
const answersFile = (dir: string) => path.join(dir, "theme-answers.json");

describe("theme answers", () => {
  let dir: string;
  let store: ReturnType<typeof createThemeSettingsStore>;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "yunari-theme-answers-"));
    store = createThemeSettingsStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seed(contents: unknown): Promise<void> {
    await writeFile(answersFile(dir), JSON.stringify(contents), "utf8");
  }

  it("has no answers for a theme nobody has answered for", async () => {
    expect(await store.read("this-pc", "living-room")).toEqual({});
  });

  it("answers each theme separately", async () => {
    await store.write("this-pc", "living-room", { "system-disk": "c" });
    await store.write("this-pc", "office", {
      gpu: "nvidia-geforce-rtx-3080-ti",
    });

    expect(await store.read("this-pc", "living-room")).toEqual({
      "system-disk": "c",
    });
    expect(await store.read("this-pc", "office")).toEqual({
      gpu: "nvidia-geforce-rtx-3080-ti",
    });
  });

  it("keeps two displays' answers for one theme apart", async () => {
    await store.write("this-pc", "wall", { gpu: "gpu-0" });
    await store.write("kitchen-tablet", "wall", { gpu: "gpu-1" });

    expect(await store.read("this-pc", "wall")).toEqual({ gpu: "gpu-0" });
    expect(await store.read("kitchen-tablet", "wall")).toEqual({
      gpu: "gpu-1",
    });
  });

  it("keeps only known groups with a usable device id", () => {
    expect(
      normalizeAnswers({
        gpu: "nvidia-geforce-rtx-3080-ti",
        cpu: "intel-core-i9",
        "system-disk": "../../etc/passwd",
        "data-disk": "",
      }),
    ).toEqual({ gpu: "nvidia-geforce-rtx-3080-ti" });
  });

  it("drops an unknown display, an unknown theme and an unknown group", async () => {
    await seed({
      "../x": { wall: { gpu: "gpu-0" } },
      "this-pc": {
        "bad id": { gpu: "gpu-1" },
        wall: { nope: "gpu-0", gpu: "gpu-0" },
      },
    });

    // Each of the three keys is held to its own pattern, so only the last
    // answer survives.
    expect(await store.read("this-pc", "bad id")).toEqual({});
    expect(await store.read("this-pc", "wall")).toEqual({ gpu: "gpu-0" });

    // `read` refuses the *requested* display before it opens the map, so a read
    // of `../x` answering `{}` cannot tell a stored key that was dropped from a
    // read that was refused — and the unknown display key is the whole of what
    // this case is about. The write below goes through the same normalisation
    // and lands on disk, where a key that was carried rather than dropped shows.
    await store.write("this-pc", "office", { gpu: "gpu-2" });

    expect(JSON.parse(await readFile(answersFile(dir), "utf8"))).toEqual({
      "this-pc": { wall: { gpu: "gpu-0" }, office: { gpu: "gpu-2" } },
    });
  });

  it("removes one theme across every display, and one display across every theme", async () => {
    await store.write("this-pc", "wall", { gpu: "gpu-0" });
    await store.write("this-pc", "office", { gpu: "gpu-1" });
    await store.write("kitchen-tablet", "wall", { gpu: "gpu-2" });

    await store.removeTheme("wall");

    expect(await store.read("this-pc", "wall")).toEqual({});
    expect(await store.read("kitchen-tablet", "wall")).toEqual({});
    expect(await store.read("this-pc", "office")).toEqual({ gpu: "gpu-1" });

    await store.write("kitchen-tablet", "wall", { gpu: "gpu-2" });
    await store.removeDisplay("kitchen-tablet");

    expect(await store.read("kitchen-tablet", "wall")).toEqual({});
    expect(await store.read("this-pc", "office")).toEqual({ gpu: "gpu-1" });
  });

  it("reads the shape that was on disk before this task as the default's answers", async () => {
    await seed({ wall: { gpu: "gpu-0" } });

    // One answer set per theme is the answers of whoever asked, and that is the
    // display an unpaired client is served as.
    expect(await store.read(DEFAULT_DISPLAY, "wall")).toEqual({ gpu: "gpu-0" });
    expect(await store.read("wall", "wall")).toEqual({});
  });

  it("writes the new shape once it writes, so the old file is migrated", async () => {
    await seed({ wall: { gpu: "gpu-0" } });
    await store.write("kitchen-tablet", "wall", { gpu: "gpu-1" });

    expect(JSON.parse(await readFile(answersFile(dir), "utf8"))).toEqual({
      [DEFAULT_DISPLAY]: { wall: { gpu: "gpu-0" } },
      "kitchen-tablet": { wall: { gpu: "gpu-1" } },
    });
  });

  it("reads a file that already holds a display named after a theme id as it is", async () => {
    // `wall` is a legal theme id *and* a legal display id, so only the depth of
    // the values tells the two shapes apart — reading this as the old shape
    // would eat the display it holds.
    await seed({ wall: { gpu: { "system-disk": "disk-c" } } });

    expect(await store.read("wall", "gpu")).toEqual({
      "system-disk": "disk-c",
    });
    expect(await store.read(DEFAULT_DISPLAY, "wall")).toEqual({});

    await store.write("kitchen-tablet", "wall", { gpu: "gpu-1" });

    expect(await store.read("wall", "gpu")).toEqual({
      "system-disk": "disk-c",
    });
  });

  it("reads a level holding an unusable theme key as a level", async () => {
    // One bad key must not flip the whole file: read as the old shape, the
    // display holding it — and every answer beside that key — would be gone.
    await seed({
      "this-pc": { wall: { gpu: "gpu-0" }, "bad id": { gpu: "gpu-1" } },
    });

    expect(await store.read("this-pc", "wall")).toEqual({ gpu: "gpu-0" });
    expect(await store.read(DEFAULT_DISPLAY, "this-pc")).toEqual({});
  });

  it("does not write over a file it could not read when there is nothing to remove", async () => {
    const corrupt = "{ not json";
    await writeFile(answersFile(dir), corrupt, "utf8");

    await store.removeTheme("wall");
    await store.removeDisplay("kitchen-tablet");

    expect(await readFile(answersFile(dir), "utf8")).toBe(corrupt);
  });

  it("refuses a write over a file it could not read", async () => {
    const corrupt = "{ not json";
    await writeFile(answersFile(dir), corrupt, "utf8");

    await expect(
      store.write("this-pc", "wall", { gpu: "gpu-0" }),
    ).rejects.toThrow("theme-answers.json could not be read, so it was not");

    expect(await readFile(answersFile(dir), "utf8")).toBe(corrupt);
  });

  it("keeps both answers when two writes overlap", async () => {
    // Both are read-modify-write over the whole file; serialised, neither
    // reads a file the other has not saved yet.
    await Promise.all([
      store.write("this-pc", "wall", { gpu: "gpu-0" }),
      store.write("this-pc", "office", { gpu: "gpu-1" }),
    ]);

    expect(await store.read("this-pc", "wall")).toEqual({ gpu: "gpu-0" });
    expect(await store.read("this-pc", "office")).toEqual({ gpu: "gpu-1" });
  });

  it("does not treat an inherited property name as a stored theme", async () => {
    const stored = JSON.stringify({ "this-pc": { wall: { gpu: "gpu-0" } } });
    await writeFile(answersFile(dir), stored, "utf8");

    // `constructor`, `toString` and `__proto__` match THEME_ID, so `in` would
    // find them on every level and rewrite the file to remove nothing.
    await store.removeTheme("constructor");
    await store.removeDisplay("constructor");

    expect(await readFile(answersFile(dir), "utf8")).toBe(stored);
  });

  it("stores a theme whose id is __proto__", async () => {
    await store.write("this-pc", "__proto__", { gpu: "gpu-0" });

    expect(await store.read("this-pc", "__proto__")).toEqual({
      gpu: "gpu-0",
    });
  });

  it("leaves the file alone when there is nothing to remove", async () => {
    const stored = JSON.stringify({ "this-pc": { wall: { gpu: "gpu-0" } } });
    await writeFile(answersFile(dir), stored, "utf8");

    await store.removeTheme("office");
    await store.removeDisplay("kitchen-tablet");

    expect(await readFile(answersFile(dir), "utf8")).toBe(stored);
  });

  it("does not write an empty level", async () => {
    await store.write("this-pc", "wall", { gpu: "gpu-0" });
    await store.write("this-pc", "wall", {});

    expect(await store.read("this-pc", "wall")).toEqual({});
    expect(JSON.parse(await readFile(answersFile(dir), "utf8"))).toEqual({});
  });

  it("refuses an id that is not a theme id, on write", async () => {
    await expect(store.write("this-pc", "../escape", {})).rejects.toThrow(
      "Invalid",
    );
    // A read of one is nothing, rather than an error.
    expect(await store.read("this-pc", "../escape")).toEqual({});
  });

  it("refuses a display id that is not one, on write", async () => {
    await expect(store.write("../escape", "wall", {})).rejects.toThrow(
      "Invalid",
    );
    expect(await store.read("../escape", "wall")).toEqual({});
  });

  it("treats a corrupt file as nothing answered", async () => {
    await writeFile(answersFile(dir), "not json", "utf8");

    expect(await store.read("this-pc", "living-room")).toEqual({});
  });
});
