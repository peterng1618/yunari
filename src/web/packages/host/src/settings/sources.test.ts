import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSourceStore, normalizeSources } from "./sources.js";

/** A minimal valid source; each test overrides the one value it refuses. */
function source(overrides: Record<string, unknown> = {}) {
  return {
    id: "local",
    name: "Local service",
    url: "http://localhost:8080/data",
    intervalMs: 60_000,
    timeoutMs: 5_000,
    fields: [
      {
        id: "value",
        label: "Value",
        pointer: "/value",
        type: "number",
      },
    ],
    ...overrides,
  };
}

function normalizeOne(overrides: Record<string, unknown> = {}) {
  return normalizeSources({ sources: [source(overrides)] });
}

function field(id: string) {
  return { id, label: id, pointer: `/${id}`, type: "text" };
}

const sourcesFile = (dir: string) => path.join(dir, "sources.json");

describe("normalizeSources", () => {
  it("accepts a valid source and defaults intervalMs to one minute", () => {
    const { sources, issues } = normalizeSources({
      sources: [source({ intervalMs: undefined })],
    });

    expect(issues).toEqual([]);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.intervalMs).toBe(60_000);
  });

  it("accepts the interval and timeout boundaries", () => {
    const { sources, issues } = normalizeSources({
      sources: [
        source({ id: "fast", intervalMs: 10_000, timeoutMs: 1_000 }),
        source({ id: "slow", intervalMs: 86_400_000, timeoutMs: 10_000 }),
      ],
    });

    expect(issues).toEqual([]);
    expect(sources.map((one) => one.intervalMs)).toEqual([10_000, 86_400_000]);
    expect(sources.map((one) => one.timeoutMs)).toEqual([1_000, 10_000]);
  });

  it("refuses a 33rd source and keeps the first 32", () => {
    const many = Array.from({ length: 33 }, (_, index) =>
      source({ id: `source_${index}` }),
    );

    const { sources, issues } = normalizeSources({ sources: many });

    expect(sources).toHaveLength(32);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.sourceId).toBe("source_32");
    expect(issues[0]?.reason).toContain("32");
  });

  it("refuses a 65th field on one source", () => {
    const fields = Array.from({ length: 65 }, (_, index) =>
      field(`field_${index}`),
    );

    const { sources, issues } = normalizeOne({ fields });

    expect(sources).toHaveLength(0);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.reason).toContain("65");
    expect(issues[0]?.reason).toContain("64");
  });

  it("refuses intervalMs below 10_000 rather than clamping it", () => {
    const { sources, issues } = normalizeOne({ intervalMs: 9_999 });

    expect(sources).toHaveLength(0);
    expect(issues[0]?.reason).toContain("10000..86400000");
  });

  it("refuses intervalMs above 86_400_000 rather than clamping it", () => {
    const { sources, issues } = normalizeOne({ intervalMs: 86_400_001 });

    expect(sources).toHaveLength(0);
    expect(issues[0]?.reason).toContain("10000..86400000");
  });

  it("refuses timeoutMs below 1_000 rather than clamping it", () => {
    const { sources, issues } = normalizeOne({ timeoutMs: 999 });

    expect(sources).toHaveLength(0);
    expect(issues[0]?.reason).toContain("1000..10000");
  });

  it("refuses timeoutMs above 10_000 rather than clamping it", () => {
    const { sources, issues } = normalizeOne({ timeoutMs: 10_001 });

    expect(sources).toHaveLength(0);
    expect(issues[0]?.reason).toContain("1000..10000");
  });

  it("refuses a source id outside [a-z0-9_-]{1,32}", () => {
    const { sources, issues } = normalizeOne({ id: "Bad Id" });

    expect(sources).toHaveLength(0);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.reason).toContain("[a-z0-9_-]{1,32}");
  });

  it("refuses a field id outside [a-z0-9_-]{1,32}", () => {
    const { sources, issues } = normalizeOne({
      fields: [{ ...field("value"), id: "Upper" }],
    });

    expect(sources).toHaveLength(0);
    expect(issues[0]?.reason).toContain("[a-z0-9_-]{1,32}");
  });

  it("refuses a URL that carries credentials", () => {
    const { sources, issues } = normalizeOne({
      url: "http://user:secret@localhost:8080/data",
    });

    expect(sources).toHaveLength(0);
    expect(issues[0]?.reason).toContain("username or password");
  });

  it("refuses a URL that is not http or https", () => {
    const { sources, issues } = normalizeOne({ url: "file:///data.json" });

    expect(sources).toHaveLength(0);
    expect(issues[0]?.reason).toContain("http");
  });

  it("refuses a duplicate field id within one source, naming source and field", () => {
    const { sources, issues } = normalizeOne({
      fields: [field("value"), field("value")],
    });

    expect(sources).toHaveLength(0);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.reason).toContain('source "local"');
    expect(issues[0]?.reason).toContain('field "value"');
    expect(issues[0]?.reason).toContain("repeats an id");
  });

  it("refuses header auth without a header name", () => {
    const { sources, issues } = normalizeOne({
      auth: { kind: "header", credentialId: "local_key" },
    });

    expect(sources).toHaveLength(0);
    expect(issues[0]?.reason).toContain("headerName");
  });

  it("refuses query auth without a query name", () => {
    const { sources, issues } = normalizeOne({
      auth: { kind: "query", credentialId: "local_key" },
    });

    expect(sources).toHaveLength(0);
    expect(issues[0]?.reason).toContain("queryName");
  });

  it("refuses an unknown key inside a source", () => {
    const { sources, issues } = normalizeOne({ secret: "sk-live" });

    expect(sources).toHaveLength(0);
    expect(issues[0]?.reason).toContain('unknown key "secret"');
  });

  it("refuses an unknown unitKind rather than casting it", () => {
    const { sources, issues } = normalizeOne({
      fields: [{ ...field("value"), unitKind: "furlongs" }],
    });

    expect(sources).toHaveLength(0);
    expect(issues[0]?.reason).toContain("unitKind");
  });

  it("keeps one valid source and reports one invalid in the same call", () => {
    const { sources, issues } = normalizeSources({
      sources: [source(), source({ id: "broken", timeoutMs: 0 })],
    });

    expect(sources.map((one) => one.id)).toEqual(["local"]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.sourceId).toBe("broken");
  });

  it("never throws on arbitrary input", () => {
    for (const input of [
      undefined,
      null,
      7,
      "x",
      [],
      { sources: 5 },
      { sources: [null] },
    ]) {
      expect(() => normalizeSources(input)).not.toThrow();
    }

    expect(normalizeSources({ sources: "no" }).issues).toHaveLength(1);
  });
});

describe("source store", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "yunari-sources-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seed(contents: string): Promise<void> {
    await writeFile(sourcesFile(dir), contents, "utf8");
  }

  it("reads a missing file as no sources and no issues", async () => {
    const store = createSourceStore(dir);

    expect(await store.read()).toEqual({ sources: [], issues: [] });
  });

  it("reads a file that is not valid JSON as an issue, not a throw", async () => {
    await seed("{ not json");

    const read = await createSourceStore(dir).read();

    expect(read.sources).toEqual([]);
    expect(read.issues).toHaveLength(1);
  });

  it("reads a file that is not the expected envelope as an issue", async () => {
    await seed("[]");

    const read = await createSourceStore(dir).read();

    expect(read.sources).toEqual([]);
    expect(read.issues).toHaveLength(1);
  });

  it("writes and reads a source back", async () => {
    const store = createSourceStore(dir);

    const written = await store.write({ sources: [source()] });

    expect(written.issues).toEqual([]);
    const read = await store.read();
    expect(read.issues).toEqual([]);
    expect(read.sources).toHaveLength(1);
    expect(read.sources[0]?.url).toBe("http://localhost:8080/data");
  });

  it("skips one bad entry while the good one survives the same read", async () => {
    await seed(
      JSON.stringify({
        sources: [source(), source({ id: "BROKEN", url: "ftp://nope" })],
      }),
    );

    const read = await createSourceStore(dir).read();

    expect(read.sources.map((one) => one.id)).toEqual(["local"]);
    expect(read.issues).toHaveLength(1);
    expect(read.issues[0]?.sourceId).toBe("BROKEN");
  });

  it("refuses a rejected input without writing anything", async () => {
    const store = createSourceStore(dir);
    await store.write({ sources: [source()] });
    const before = await readFile(sourcesFile(dir));

    const refused = await store.write({
      sources: [source({ timeoutMs: 999 })],
    });

    expect(refused.issues).toHaveLength(1);
    expect(await readFile(sourcesFile(dir))).toEqual(before);
  });

  it("serializes overlapping writes so the file is never interleaved", async () => {
    const store = createSourceStore(dir);

    await Promise.all([
      store.write({ sources: [source({ id: "left" })] }),
      store.write({ sources: [source({ id: "right" })] }),
    ]);

    const read = await store.read();
    expect(read.issues).toEqual([]);
    expect(read.sources.map((one) => one.id)).toEqual(["right"]);
  });

  it("leaves the previous file byte-identical when the rename fails", async () => {
    const store = createSourceStore(dir);
    await store.write({ sources: [source()] });
    const before = await readFile(sourcesFile(dir));

    const failing = createSourceStore(dir, {
      rename: async () => {
        throw new Error("EPERM: rename failed");
      },
    });

    await expect(
      failing.write({ sources: [source({ id: "replacement" })] }),
    ).rejects.toThrow("EPERM");

    expect(await readFile(sourcesFile(dir))).toEqual(before);
  });
});
