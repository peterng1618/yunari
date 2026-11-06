import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BUILTIN_PATH_PRESETS, type PathPreset } from "@yunari/theme-package";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPathPresetStore, type PathPresetStore } from "./path-presets.js";

const encoder = new TextEncoder();

function pathPackBytes(
  packId: string,
  presets: readonly unknown[],
  overrides: Record<string, unknown> = {},
): Uint8Array {
  return encoder.encode(
    JSON.stringify({
      format: "yunari-path-preset-pack",
      version: 1,
      id: packId,
      name: packId,
      presets,
      ...overrides,
    }),
  );
}

function shape(id: string, data = "M 0 0 L 10 10 Z"): unknown {
  return { id, label: id, data, paint: "fill" };
}

const stateFile = (directory: string) =>
  path.join(directory, "path-presets.json");

describe("the path preset store", () => {
  let directory: string;
  let store: PathPresetStore;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "yunari-path-presets-"));
    store = createPathPresetStore(directory);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("installs a pack under namespaced ids and removes only that pack", async () => {
    await store.addUser({ label: "Mine", data: "M 0 0 L 10 10" });
    await store.addPack(pathPackBytes("acme", [shape("wave")]));

    expect((await store.read()).presets.map((preset) => preset.id)).toEqual([
      "user:mine",
      "pack:acme:wave",
    ]);

    await store.removePack("acme");

    expect((await store.read()).presets.map((preset) => preset.id)).toEqual([
      "user:mine",
    ]);
  });

  it("refuses a pack whose path draws nothing and leaves the file untouched", async () => {
    await store.addUser({ label: "Mine", data: "M 0 0 L 10 10" });
    const before = await readFile(stateFile(directory), "utf8");

    await expect(
      store.addPack(pathPackBytes("bad", [shape("empty", "M 0 0")])),
    ).rejects.toThrow("draws nothing");

    expect(await readFile(stateFile(directory), "utf8")).toBe(before);
  });

  it("refuses a pack in another format, a duplicate preset id, and non-text path data", async () => {
    await expect(
      store.addPack(
        pathPackBytes("bad", [shape("wave")], {
          format: "yunari-widget-package",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      store.addPack(
        pathPackBytes("bad", [shape("wave"), shape("wave", "M 0 0 L 2 2")]),
      ),
    ).rejects.toThrow();
    await expect(
      store.addPack(
        pathPackBytes("bad", [
          { id: "wave", label: "Wave", data: 42, paint: "fill" },
        ]),
      ),
    ).rejects.toThrow();

    expect(await store.read()).toEqual({
      version: 1,
      presets: [],
      removedBuiltins: [],
      migrated: false,
    });
  });
});

describe("user presets", () => {
  let directory: string;
  let store: PathPresetStore;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "yunari-path-presets-"));
    store = createPathPresetStore(directory);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("slugs the label and suffixes a collision", async () => {
    const first = await store.addUser({
      label: "  My Star! ",
      data: "M 0 0 L 10 10 Z",
    });
    const second = await store.addUser({
      label: "My Star!",
      data: "M 0 0 L 10 10",
    });
    const third = await store.addUser({
      label: "My Star!",
      data: "M 0 0 L 20 20",
    });

    expect(first.id).toBe("user:my-star");
    expect(second.id).toBe("user:my-star-2");
    expect(third.id).toBe("user:my-star-3");
    expect(second.paint).toBe("stroke");
    expect(first.paint).toBe("fill");
  });

  it("falls back to preset when the label has no usable characters", async () => {
    expect(
      (await store.addUser({ label: "!!!", data: "M 0 0 L 10 10" })).id,
    ).toBe("user:preset");
  });

  it("refuses a blank label, blank data, and data that draws nothing", async () => {
    await expect(
      store.addUser({ label: " ", data: "M 0 0 L 10 10" }),
    ).rejects.toThrow();
    await expect(store.addUser({ label: "Mine", data: " " })).rejects.toThrow();
    await expect(
      store.addUser({ label: "Mine", data: "M 0 0" }),
    ).rejects.toThrow("draws nothing");
  });

  it("removes one user row and ignores a built-in id", async () => {
    const builtins = createPathPresetStore(directory, BUILTIN_PATH_PRESETS);
    await builtins.addUser({ label: "Mine", data: "M 0 0 L 10 10" });

    await builtins.remove("line");
    expect((await builtins.read()).presets.map((preset) => preset.id)).toEqual([
      "line",
      "arc",
      "wedge",
      "user:mine",
    ]);

    await builtins.remove("user:mine");
    expect((await builtins.read()).presets.map((preset) => preset.id)).toEqual([
      "line",
      "arc",
      "wedge",
    ]);
  });
});

describe("built-in presets", () => {
  let directory: string;
  let store: PathPresetStore;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "yunari-path-presets-"));
    store = createPathPresetStore(directory, BUILTIN_PATH_PRESETS);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("lists the built-ins before the stored rows", async () => {
    await store.addUser({ label: "Mine", data: "M 0 0 L 10 10" });

    expect((await store.read()).presets.map((preset) => preset.id)).toEqual([
      "line",
      "arc",
      "wedge",
      "user:mine",
    ]);
  });

  it("removes a known built-in once and ignores an unknown id", async () => {
    await store.removeBuiltin("arc");
    await store.removeBuiltin("arc");
    await store.removeBuiltin("star");

    const state = await store.read();
    expect(state.removedBuiltins).toEqual(["arc"]);
    expect(state.presets.map((preset) => preset.id)).toEqual(["line", "wedge"]);
  });

  it("restores every built-in without touching a user row", async () => {
    await store.addUser({ label: "Mine", data: "M 0 0 L 10 10" });
    await store.removeBuiltin("line");

    await store.restoreBuiltins();

    const state = await store.read();
    expect(state.removedBuiltins).toEqual([]);
    expect(state.presets.map((preset) => preset.id)).toEqual([
      "line",
      "arc",
      "wedge",
      "user:mine",
    ]);
  });

  it("stores only user and pack rows in the state file", async () => {
    await store.addUser({ label: "Mine", data: "M 0 0 L 10 10" });
    await store.removeBuiltin("line");

    const stored = JSON.parse(await readFile(stateFile(directory), "utf8")) as {
      presets: readonly { id: string }[];
    };

    expect(stored.presets.map((preset) => preset.id)).toEqual(["user:mine"]);
  });
});

describe("pack replacement", () => {
  let directory: string;
  let store: PathPresetStore;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "yunari-path-presets-"));
    store = createPathPresetStore(directory);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("replaces exactly the reinstalled pack's rows", async () => {
    await store.addUser({ label: "Mine", data: "M 0 0 L 10 10" });
    await store.addPack(pathPackBytes("acme", [shape("wave"), shape("star")]));
    await store.addPack(pathPackBytes("other", [shape("dot")]));

    await store.addPack(pathPackBytes("acme", [shape("square")]));

    expect((await store.read()).presets.map((preset) => preset.id)).toEqual([
      "user:mine",
      "pack:other:dot",
      "pack:acme:square",
    ]);
  });

  it("removes only rows whose id starts with the pack's exact prefix", async () => {
    await store.addPack(pathPackBytes("acme", [shape("wave")]));
    await store.addPack(pathPackBytes("acme-extra", [shape("wave")]));

    await store.removePack("acme");

    expect((await store.read()).presets.map((preset) => preset.id)).toEqual([
      "pack:acme-extra:wave",
    ]);
  });
});

describe("migrating browser presets", () => {
  let directory: string;
  let store: PathPresetStore;

  const mine: PathPreset = {
    id: "user:mine",
    label: "Mine",
    data: "M 0 0 L 10 10",
    paint: "stroke",
  };

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "yunari-path-presets-"));
    store = createPathPresetStore(directory, BUILTIN_PATH_PRESETS);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("merges the browser rows once and keeps only ids that name a built-in", async () => {
    const state = await store.migrate({
      presets: [mine],
      removedBuiltins: ["arc", "star", "arc"],
    });

    expect(state).toEqual({
      version: 1,
      presets: [BUILTIN_PATH_PRESETS[0], BUILTIN_PATH_PRESETS[2], mine],
      removedBuiltins: ["arc"],
      migrated: true,
    });

    const before = await readFile(stateFile(directory), "utf8");
    const again = await store.migrate({
      presets: [
        {
          id: "user:other",
          label: "Other",
          data: "M 0 0 L 1 1",
          paint: "stroke",
        },
      ],
      removedBuiltins: ["line"],
    });

    expect(again).toEqual(state);
    expect(await readFile(stateFile(directory), "utf8")).toBe(before);
  });

  it("refuses an invalid migration whole", async () => {
    await expect(
      store.migrate({
        presets: [
          mine,
          { id: "user:bad", label: "Bad", data: "M 0 0", paint: "stroke" },
        ],
        removedBuiltins: [],
      }),
    ).rejects.toThrow("draws nothing");

    expect(await store.read()).toEqual({
      version: 1,
      presets: [...BUILTIN_PATH_PRESETS],
      removedBuiltins: [],
      migrated: false,
    });
  });

  it("refuses a migrated row with an id that is not a user id", async () => {
    await expect(
      store.migrate({
        presets: [{ ...mine, id: "line" }],
        removedBuiltins: [],
      }),
    ).rejects.toThrow();
  });
});
