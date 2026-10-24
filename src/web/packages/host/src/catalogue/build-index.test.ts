import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type FabricThemeEnvelope,
  facetRecordOf,
  parseCatalogueIndex,
} from "@yunari/renderer-core";
import { writeThemePackage } from "@yunari/theme-package";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCatalogueIndexCommand,
  type CatalogueItem,
  catalogueIndexOf,
} from "./build-index.js";

const GENERATED_AT = "2026-10-21T12:00:00Z";

/** The smallest envelope `validateFabricThemeEnvelope` accepts. */
function themeFor(id: string, name: string): FabricThemeEnvelope {
  return {
    schemaVersion: "2.0.0",
    fabricVersion: "7.4.0",
    id,
    artboard: { width: 1920, height: 1080 },
    metadata: { name, author: "Ada", themeLanguage: "en" },
    scene: { version: "7.4.0", objects: [] },
  };
}

function itemFor(id: string, overrides: Record<string, unknown> = {}): unknown {
  return {
    kind: "dashboard-theme",
    name: `Theme ${id}`,
    version: "1.0.0",
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-02T00:00:00Z",
    downloads: 12,
    favorites: 3,
    packageUrl: `https://github.com/x/y/releases/download/${id}/${id}.zip`,
    thumbnail: `catalogue/${id}/thumbnail.png`,
    ...overrides,
  };
}

const REMIX = {
  catalogueId: "3f2a1c9e-8b7d-4c6a-9e0f-1a2b3c4d5e6f",
  name: "Aurora",
  version: "1.2.0",
};

function item(id: string, theme: unknown = themeFor(id, `Theme ${id}`)) {
  return { id, item: itemFor(id), theme };
}

const temporary: string[] = [];

/** ZIP magic and nothing else: a package `readThemePackage` refuses. */
const NOT_A_PACKAGE = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

async function catalogueOf(
  entries: readonly {
    readonly id: string;
    readonly theme?: FabricThemeEnvelope;
    readonly item?: unknown;
    /** Bytes to write instead of a package built from `theme`; `null` writes
     *  no package at all. */
    readonly packageBytes?: Uint8Array | null;
  }[],
): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "yunari-catalogue-"));
  temporary.push(root);
  for (const { id, item, theme, packageBytes } of entries) {
    const directory = path.join(root, id);
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "item.json"),
      JSON.stringify(item ?? itemFor(id)),
    );
    if (packageBytes === null) continue;
    await writeFile(
      path.join(directory, `${id}.zip`),
      packageBytes ?? writtenPackage(id, theme),
    );
  }
  return root;
}

function writtenPackage(id: string, theme?: FabricThemeEnvelope): Uint8Array {
  const written = writeThemePackage({
    envelope: theme ?? themeFor(id, `Theme ${id}`),
    assets: {},
  });
  if (!written.ok) throw new Error(written.message);
  return written.bytes;
}

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("catalogueIndexOf", () => {
  it("publishes the readable items, sorted, with the derived facets", () => {
    const valid = themeFor("aurora", "Aurora");
    const items: CatalogueItem[] = [
      item("beta"),
      item("aurora", valid),
      item("broken", { schemaVersion: "2.0.0" }),
    ];

    const index = catalogueIndexOf(items, GENERATED_AT);

    expect(index.generatedAt).toBe(GENERATED_AT);
    expect(index.entries.map((entry) => entry.id)).toEqual(["aurora", "beta"]);
    expect(index.entries[0]?.facets).toEqual(facetRecordOf(valid));
  });

  it("carries remixOf into the credited entry and no key into the plain one", () => {
    const index = catalogueIndexOf(
      [
        {
          id: "beta",
          item: itemFor("beta", { remixOf: REMIX }),
          theme: themeFor("beta", "Beta"),
        },
        item("alpha"),
      ],
      GENERATED_AT,
    );

    const beta = index.entries.find((entry) => entry.id === "beta");
    const alpha = index.entries.find((entry) => entry.id === "alpha");
    expect(beta?.remixOf).toStrictEqual(REMIX);
    expect(Object.hasOwn(alpha ?? {}, "remixOf")).toBe(false);
  });

  it("publishes an item whose document carries the legacy integer version", () => {
    const legacy = { ...themeFor("aurora", "Aurora"), schemaVersion: 2 };

    const index = catalogueIndexOf([item("aurora", legacy)], GENERATED_AT);

    expect(index.entries.map((entry) => entry.id)).toEqual(["aurora"]);
    expect(index.entries[0]?.facets).toEqual(
      facetRecordOf(themeFor("aurora", "Aurora")),
    );
  });

  it("refuses an item from a schema major it cannot migrate", () => {
    const index = catalogueIndexOf(
      [
        item("ancient", {
          ...themeFor("ancient", "Ancient"),
          schemaVersion: "1.0.0",
        }),
      ],
      GENERATED_AT,
    );

    expect(index.entries).toEqual([]);
  });

  it("refuses an item from a newer schema major", () => {
    const index = catalogueIndexOf(
      [
        item("future", {
          ...themeFor("future", "Future"),
          schemaVersion: "3.0.0",
        }),
      ],
      GENERATED_AT,
    );

    expect(index.entries).toEqual([]);
  });

  it("refuses an item whose header an entry cannot be built from", () => {
    const index = catalogueIndexOf(
      [
        item("aurora"),
        {
          id: "headerless",
          item: { kind: "dashboard-theme" },
          theme: themeFor("headerless", "Headerless"),
        },
      ],
      GENERATED_AT,
    );

    expect(index.entries.map((entry) => entry.id)).toEqual(["aurora"]);
  });
});

describe("buildCatalogueIndexCommand", () => {
  it("is absent for every other command line", async () => {
    expect(await buildCatalogueIndexCommand([])).toBeUndefined();
    expect(
      await buildCatalogueIndexCommand(["--port", "1234"]),
    ).toBeUndefined();
  });

  it("writes a deterministic index, refusing the unreadable item", async () => {
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const catalogue = await catalogueOf([
      { id: "beta", theme: themeFor("beta", "Beta") },
      { id: "alpha", theme: themeFor("alpha", "Alpha") },
      { id: "broken", packageBytes: NOT_A_PACKAGE },
      { id: "absent", packageBytes: null },
    ]);
    const out = path.join(catalogue, "index.json");
    const argv = [
      "--build-catalogue-index",
      catalogue,
      "--out",
      out,
      "--generated-at",
      GENERATED_AT,
    ];

    expect(await buildCatalogueIndexCommand(argv)).toBe(0);

    const bytes = await readFile(out, "utf8");
    const output = JSON.parse(bytes) as unknown;
    expect(bytes.endsWith("\n")).toBe(true);
    expect(parseCatalogueIndex(output, ["dashboard-theme"]).refused).toEqual(
      [],
    );

    const parsed = parseCatalogueIndex(output, ["dashboard-theme"]);
    expect(parsed.entries.map((entry) => entry.id)).toEqual(["alpha", "beta"]);
    expect(parsed.entries[0]?.facets).toEqual(
      facetRecordOf(themeFor("alpha", "Alpha")),
    );
    expect(errors.mock.calls.flat().join("\n")).toContain("catalogue/broken");
    expect(errors.mock.calls.flat().join("\n")).toContain("catalogue/absent");

    expect(await buildCatalogueIndexCommand(argv)).toBe(0);
    expect(await readFile(out, "utf8")).toBe(bytes);
  });

  it("writes remixOf only for the item that carries it", async () => {
    const catalogue = await catalogueOf([
      {
        id: "beta",
        item: itemFor("beta", { remixOf: REMIX }),
        theme: themeFor("beta", "Beta"),
      },
      { id: "alpha" },
    ]);
    const out = path.join(catalogue, "index.json");

    expect(
      await buildCatalogueIndexCommand([
        "--build-catalogue-index",
        catalogue,
        "--out",
        out,
        "--generated-at",
        GENERATED_AT,
      ]),
    ).toBe(0);

    const output = JSON.parse(await readFile(out, "utf8")) as {
      readonly entries: readonly Record<string, unknown>[];
    };
    const beta = output.entries.find((entry) => entry["id"] === "beta");
    const alpha = output.entries.find((entry) => entry["id"] === "alpha");
    expect(beta?.["remixOf"]).toStrictEqual(REMIX);
    expect(Object.hasOwn(alpha ?? {}, "remixOf")).toBe(false);
  });

  it("fails on a catalogue directory that does not exist", async () => {
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const status = await buildCatalogueIndexCommand([
      "--build-catalogue-index",
      path.join(os.tmpdir(), "yunari-catalogue-does-not-exist"),
      "--out",
      path.join(os.tmpdir(), "index.json"),
      "--generated-at",
      GENERATED_AT,
    ]);

    expect(status).toBe(1);
    expect(errors.mock.calls.flat().join("\n")).toContain(
      "yunari-catalogue-does-not-exist",
    );
  });

  it("fails on an unknown option or a missing --generated-at", async () => {
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const catalogue = await catalogueOf([{ id: "alpha" }]);

    expect(
      await buildCatalogueIndexCommand([
        "--build-catalogue-index",
        catalogue,
        "--out",
        path.join(catalogue, "index.json"),
        "--generated-at",
        GENERATED_AT,
        "--unknown",
      ]),
    ).toBe(1);
    expect(errors.mock.calls.flat().join("\n")).toContain(
      "Unknown option --unknown.",
    );

    errors.mockClear();
    expect(
      await buildCatalogueIndexCommand([
        "--build-catalogue-index",
        catalogue,
        "--out",
        path.join(catalogue, "index.json"),
      ]),
    ).toBe(1);
    expect(errors.mock.calls.flat().join("\n")).toContain(
      "--build-catalogue-index needs <catalogueDir>, --out and --generated-at.",
    );
  });

  it("fails on a --generated-at that is not an ISO 8601 instant", async () => {
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const catalogue = await catalogueOf([{ id: "alpha" }]);

    const status = await buildCatalogueIndexCommand([
      "--build-catalogue-index",
      catalogue,
      "--out",
      path.join(catalogue, "index.json"),
      "--generated-at",
      "banana",
    ]);

    expect(status).toBe(1);
    expect(errors.mock.calls.flat().join("\n")).toContain(
      '--generated-at must be an ISO 8601 instant, not "banana".',
    );
  });

  it("names a misspelt header field instead of publishing nothing", async () => {
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const misspelt: Record<string, unknown> = {
      ...(itemFor("alpha") as Record<string, unknown>),
    };
    delete misspelt["name"];
    const catalogue = await catalogueOf([{ id: "alpha", item: misspelt }]);

    const status = await buildCatalogueIndexCommand([
      "--build-catalogue-index",
      catalogue,
      "--out",
      path.join(catalogue, "index.json"),
      "--generated-at",
      GENERATED_AT,
    ]);

    expect(status).toBe(1);
    const stderr = errors.mock.calls.flat().join("\n");
    expect(stderr).toContain(`item.json's "name" must be a non-empty string.`);
    expect(stderr).toContain("1 catalogue directory was refused");
  });

  it("fails when every directory in a non-empty catalogue is refused", async () => {
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const catalogue = await catalogueOf([
      { id: "broken", packageBytes: NOT_A_PACKAGE },
    ]);

    const status = await buildCatalogueIndexCommand([
      "--build-catalogue-index",
      catalogue,
      "--out",
      path.join(catalogue, "index.json"),
      "--generated-at",
      GENERATED_AT,
    ]);

    expect(status).toBe(1);
    expect(errors.mock.calls.flat().join("\n")).toContain(
      "1 catalogue directory was refused",
    );
  });

  it("fails when an item declares a kind this build does not ship", async () => {
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const catalogue = await catalogueOf([
      { id: "alpha" },
      {
        id: "typo",
        item: { ...(itemFor("typo") as object), kind: "dashboard-theme " },
      },
    ]);

    const status = await buildCatalogueIndexCommand([
      "--build-catalogue-index",
      catalogue,
      "--out",
      path.join(catalogue, "index.json"),
      "--generated-at",
      GENERATED_AT,
    ]);

    expect(status).toBe(1);
    expect(errors.mock.calls.flat().join("\n")).toContain(
      'kind "dashboard-theme " is not a kind this build ships',
    );
  });

  it("names an --out it cannot write", async () => {
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const catalogue = await catalogueOf([{ id: "alpha" }]);
    const out = path.join(catalogue, "no-such-dir", "index.json");

    const status = await buildCatalogueIndexCommand([
      "--build-catalogue-index",
      catalogue,
      "--out",
      out,
      "--generated-at",
      GENERATED_AT,
    ]);

    expect(status).toBe(1);
    expect(errors.mock.calls.flat().join("\n")).toContain(
      `Cannot write ${out}`,
    );
  });
});
