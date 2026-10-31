import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJsonFile, type JsonFile } from "./json-file.js";

interface Map {
  readonly entries: Readonly<Record<string, number>>;
}

const normalize = (parsed: unknown): Map => {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("not a map");
  }
  const entries = (parsed as { entries?: unknown }).entries;
  if (typeof entries !== "object" || entries === null) {
    throw new Error("not a map");
  }
  return { entries: entries as Record<string, number> };
};

describe("the settings JSON file", () => {
  let dir: string;
  let file: JsonFile<Map>;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "yunari-json-file-"));
    file = createJsonFile(dir, "map.json", {
      normalize,
      empty: () => ({ entries: {} }),
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads a missing file as empty", async () => {
    expect(await file.read()).toEqual({ entries: {} });
  });

  it("does not leave a temporary file behind", async () => {
    await file.write({ entries: { a: 1 } });

    expect(await readdir(dir)).toEqual(["map.json"]);
  });

  it("queues overlapping mutations, so neither loses the other", async () => {
    await Promise.all([
      file.mutate((current) => ({
        next: { entries: { ...current.entries, a: 1 } },
        result: undefined,
      })),
      file.mutate((current) => ({
        next: { entries: { ...current.entries, b: 2 } },
        result: undefined,
      })),
    ]);

    expect(
      JSON.parse(await readFile(path.join(dir, "map.json"), "utf8")),
    ).toEqual({ entries: { a: 1, b: 2 } });
  });

  it("refuses to write over a file it cannot read", async () => {
    const corrupt = "{ not json";
    await writeFile(path.join(dir, "map.json"), corrupt, "utf8");

    await expect(
      file.mutate((current) => ({ next: current, result: undefined })),
    ).rejects.toThrow("map.json could not be read, so it was not written");

    expect(await readFile(path.join(dir, "map.json"), "utf8")).toBe(corrupt);
  });

  it("reads a file it cannot parse as empty rather than failing", async () => {
    await writeFile(path.join(dir, "map.json"), "not json", "utf8");

    expect(await file.read()).toEqual({ entries: {} });
  });
});
