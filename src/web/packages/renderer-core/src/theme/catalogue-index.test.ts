import { describe, expect, it } from "vitest";
import {
  isCatalogueId,
  isCatalogueStatus,
  parseCatalogueIndex,
  parseCatalogueItemFile,
} from "./catalogue-index.js";

/** The kinds this build ships; a `widget-preset` is a kind the catalogue may
    hold and this client cannot read. */
const KNOWN = ["dashboard-theme"];

/** The record the Action derives: every field a reader touches, which is the
    shallow check the parser makes and nothing more. */
function facets(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    author: "ada",
    colourMode: "dark",
    sensors: [],
    tags: ["ops"],
    orientation: "landscape",
    aspect: "16:9",
    width: 1920,
    height: 1080,
    ...overrides,
  };
}

/** One wire entry, every field well-formed; a case states only the part it is
    about. */
function entry(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "acme-ops",
    kind: "dashboard-theme",
    name: "Acme Ops",
    version: "1.0.0",
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-02T00:00:00Z",
    downloads: 12,
    favorites: 3,
    packageUrl: "https://example.test/acme-ops.json",
    thumbnail: "themes/acme-ops.png",
    facets: facets(),
    ...overrides,
  };
}

/** One well-formed credit; a case states only the part it is about. */
function remixOf(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    catalogueId: "3f2a1c9e-8b7d-4c6a-9e0f-1a2b3c4d5e6f",
    name: "Aurora",
    version: "1.2.0",
    ...overrides,
  };
}

/** The entry `entry()` builds with a field actually absent, not present-and-empty. */
function without(field: string, overrides: Record<string, unknown> = {}) {
  const value = entry(overrides);
  delete value[field];
  return value;
}

/** The brief's "one entry missing `name`": it declares no `kind` either, which is
    why its refusal names nothing. An entry that is the wrong shape *and* declares
    a kind is named by that kind — the case below. */
function unreadable(id: string): Record<string, unknown> {
  const value = entry({ id });
  delete value.kind;
  delete value.name;
  return value;
}

/** The fields `asEntry` holds for presence: each omitted-field case must fail
    when its own check is removed. */
const REQUIRED_ENTRY_FIELDS = [
  "version",
  "createdAt",
  "updatedAt",
  "packageUrl",
  "thumbnail",
  "favorites",
] as const;

function document(entries: readonly unknown[]): Record<string, unknown> {
  return { generatedAt: "2026-10-21T00:00:00Z", entries: [...entries] };
}

describe("parseCatalogueIndex", () => {
  it("keeps the readable entries and reports each refusal once, in order", () => {
    const parsed = parseCatalogueIndex(
      document([
        entry(),
        entry({ id: "beta" }),
        entry({ id: "w1", kind: "widget-preset" }),
        entry({ id: "w2", kind: "widget-preset" }),
        unreadable("nameless"),
      ]),
      KNOWN,
    );

    expect(parsed.entries.length).toBe(2);
    expect(parsed.entries.map((item) => item.id)).toEqual(["acme-ops", "beta"]);
    expect(parsed.refused).toStrictEqual([
      { kind: "widget-preset", reason: "unknown-kind", count: 2 },
      { kind: undefined, reason: "malformed", count: 1 },
    ]);
  });

  it("orders the refusals by first appearance in the document", () => {
    const parsed = parseCatalogueIndex(
      document([
        unreadable("nameless"),
        entry({ id: "w1", kind: "widget-preset" }),
      ]),
      KNOWN,
    );

    expect(parsed.refused.map((row) => row.reason)).toEqual([
      "malformed",
      "unknown-kind",
    ]);
  });

  it("keeps two unknown kinds in the order each first appeared", () => {
    const parsed = parseCatalogueIndex(
      document([
        entry({ id: "w1", kind: "widget-preset" }),
        entry({ id: "s1", kind: "sprite-pack" }),
        entry({ id: "w2", kind: "widget-preset" }),
      ]),
      KNOWN,
    );

    expect(parsed.refused).toStrictEqual([
      { kind: "widget-preset", reason: "unknown-kind", count: 2 },
      { kind: "sprite-pack", reason: "unknown-kind", count: 1 },
    ]);
  });

  it("refuses a malformed entry by its own kind, not as an unknown kind", () => {
    const parsed = parseCatalogueIndex(
      document([without("name", { id: "nameless", kind: "widget-preset" })]),
      KNOWN,
    );

    expect(parsed.entries).toStrictEqual([]);
    expect(parsed.refused).toStrictEqual([
      { kind: "widget-preset", reason: "malformed", count: 1 },
    ]);
  });

  it("refuses a document that is not an object", () => {
    const whole = {
      entries: [],
      refused: [{ kind: undefined, reason: "malformed", count: 1 }],
    };

    expect(parseCatalogueIndex("nope", KNOWN)).toStrictEqual(whole);
    expect(parseCatalogueIndex(null, KNOWN)).toStrictEqual(whole);
    expect(parseCatalogueIndex([entry()], KNOWN)).toStrictEqual(whole);
  });

  it("refuses a document with no generatedAt", () => {
    expect(parseCatalogueIndex({ entries: [entry()] }, KNOWN)).toStrictEqual({
      entries: [],
      refused: [{ kind: undefined, reason: "malformed", count: 1 }],
    });
  });

  it("refuses nothing when a malformed document dropped nothing", () => {
    // Nothing was dropped, so nothing was refused: the surface then says the
    // store is empty rather than that unreadable entries were left out.
    expect(parseCatalogueIndex({ entries: [] }, KNOWN)).toStrictEqual({
      entries: [],
      refused: [],
    });
  });

  it("refuses a document whose generatedAt is not a string, counting its entries", () => {
    const parsed = parseCatalogueIndex(
      { generatedAt: 21, entries: [entry(), entry({ id: "beta" })] },
      KNOWN,
    );

    expect(parsed).toStrictEqual({
      entries: [],
      refused: [{ kind: undefined, reason: "malformed", count: 2 }],
    });
  });

  it("refuses a document whose entries is not an array", () => {
    expect(
      parseCatalogueIndex(
        { generatedAt: "2026-10-21T00:00:00Z", entries: "nope" },
        KNOWN,
      ),
    ).toStrictEqual({
      entries: [],
      refused: [{ kind: undefined, reason: "malformed", count: 1 }],
    });
  });

  it("refuses an entry whose facets is not a record", () => {
    const parsed = parseCatalogueIndex(
      document([
        entry({ id: "null-facets", facets: null }),
        entry({ id: "array-facets", facets: [] }),
        without("facets", { id: "absent-facets" }),
      ]),
      KNOWN,
    );

    expect(parsed.entries).toStrictEqual([]);
    expect(parsed.refused).toStrictEqual([
      { kind: "dashboard-theme", reason: "malformed", count: 3 },
    ]);
  });

  it("refuses an entry whose facets record is missing a field a reader needs", () => {
    const withoutTags = facets();
    delete withoutTags.tags;

    const parsed = parseCatalogueIndex(
      document([
        entry({ id: "empty-facets", facets: {} }),
        entry({ id: "no-tags", facets: withoutTags }),
        entry({ id: "zero-width", facets: facets({ width: 0 }) }),
        entry({ id: "nan-height", facets: facets({ height: Number.NaN }) }),
      ]),
      KNOWN,
    );

    expect(parsed.entries).toStrictEqual([]);
    expect(parsed.refused).toStrictEqual([
      { kind: "dashboard-theme", reason: "malformed", count: 4 },
    ]);
  });

  it("refuses a facets record whose members are the wrong type", () => {
    const parsed = parseCatalogueIndex(
      document([
        entry({ id: "null-sensor", facets: facets({ sensors: [null] }) }),
        entry({
          id: "unlabelled-sensor",
          facets: facets({ sensors: [{ key: "cpu.load" }] }),
        }),
        entry({ id: "numeric-tag", facets: facets({ tags: [1] }) }),
        entry({ id: "numeric-author", facets: facets({ author: 5 }) }),
      ]),
      KNOWN,
    );

    expect(parsed.entries).toStrictEqual([]);
    expect(parsed.refused).toStrictEqual([
      { kind: "dashboard-theme", reason: "malformed", count: 4 },
    ]);
  });

  it("refuses an entry that omits any required field", () => {
    for (const key of REQUIRED_ENTRY_FIELDS) {
      const parsed = parseCatalogueIndex(document([without(key)]), KNOWN);

      expect(parsed.entries, `an entry omitting ${key} was read`).toStrictEqual(
        [],
      );
      expect(parsed.refused, `${key}'s refusal`).toStrictEqual([
        { kind: "dashboard-theme", reason: "malformed", count: 1 },
      ]);
    }
  });

  it("refuses an entry whose counts are not counts", () => {
    const parsed = parseCatalogueIndex(
      document([
        entry({ id: "string-downloads", downloads: "12" }),
        entry({ id: "negative-downloads", downloads: -1 }),
        entry({ id: "nan-favorites", favorites: Number.NaN }),
        entry({
          id: "infinite-favorites",
          favorites: Number.POSITIVE_INFINITY,
        }),
      ]),
      KNOWN,
    );

    expect(parsed.entries).toStrictEqual([]);
    expect(parsed.refused).toStrictEqual([
      { kind: "dashboard-theme", reason: "malformed", count: 4 },
    ]);
  });

  it("refuses an entry whose fields are inherited rather than its own", () => {
    // What a bare `record[key]` read would accept: no own field at all, every
    // field resolved off the prototype. `JSON.parse` cannot produce one, which is
    // why the reader's check has to be constructed here.
    const inherited = Object.create(entry());

    const parsed = parseCatalogueIndex(document([inherited]), KNOWN);

    expect(parsed.entries).toStrictEqual([]);
    expect(parsed.refused).toStrictEqual([
      { kind: undefined, reason: "malformed", count: 1 },
    ]);
  });

  it("reads an entry whose id is __proto__", () => {
    const parsed = parseCatalogueIndex(
      document([entry({ id: "__proto__" })]),
      KNOWN,
    );

    expect(parsed.refused).toStrictEqual([]);
    expect(parsed.entries.map((item) => item.id)).toEqual(["__proto__"]);
  });

  it("carries an entry's remixOf and omits the key when there is none", () => {
    const credit = remixOf();
    const parsed = parseCatalogueIndex(
      document([
        entry({ id: "remixed", remixOf: credit }),
        entry({ id: "plain" }),
      ]),
      KNOWN,
    );

    expect(parsed.entries[0]?.remixOf).toStrictEqual(credit);
    expect(Object.hasOwn(parsed.entries[1] ?? {}, "remixOf")).toBe(false);
  });

  it("refuses an entry whose remixOf is malformed", () => {
    const parsed = parseCatalogueIndex(
      document([entry({ remixOf: remixOf({ catalogueId: "aurora" }) })]),
      KNOWN,
    );

    expect(parsed.entries).toStrictEqual([]);
    expect(parsed.refused).toStrictEqual([
      { kind: "dashboard-theme", reason: "malformed", count: 1 },
    ]);
  });

  it("carries the entry's fields through unchanged", () => {
    const derived = facets({ width: 1920 });
    const parsed = parseCatalogueIndex(
      document([entry({ facets: derived })]),
      KNOWN,
    );

    expect(parsed.entries[0]).toStrictEqual({
      id: "acme-ops",
      kind: "dashboard-theme",
      name: "Acme Ops",
      version: "1.0.0",
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-02T00:00:00Z",
      downloads: 12,
      favorites: 3,
      packageUrl: "https://example.test/acme-ops.json",
      thumbnail: "themes/acme-ops.png",
      facets: derived,
    });
  });
});

describe("isCatalogueId", () => {
  it("accepts a lowercase UUID", () =>
    expect(isCatalogueId("3f2a1c9e-8b7d-4c6a-9e0f-1a2b3c4d5e6f")).toBe(true));
  it.each([
    "aurora",
    "3F2A1C9E-8B7D-4C6A-9E0F-1A2B3C4D5E6F",
    "3f2a1c9e-8b7d-4c6a-9e0f",
  ])("refuses %s", (id) => expect(isCatalogueId(id)).toBe(false));
});

describe("parseCatalogueItemFile", () => {
  it("reads the authored header and ignores an id or author it is given", () => {
    const parsed = parseCatalogueItemFile({
      ...entry(),
      id: "the-directory-name",
      author: "ada",
    });

    expect(parsed).toStrictEqual({
      ok: true,
      file: {
        kind: "dashboard-theme",
        name: "Acme Ops",
        version: "1.0.0",
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: "2026-10-02T00:00:00Z",
        downloads: 12,
        favorites: 3,
        packageUrl: "https://example.test/acme-ops.json",
        thumbnail: "themes/acme-ops.png",
      },
    });
  });

  it("refuses a misspelt field by naming it", () => {
    const misspelt = { ...entry() };
    delete misspelt["name"];

    expect(parseCatalogueItemFile(misspelt)).toStrictEqual({
      ok: false,
      reason: `item.json's "name" must be a non-empty string.`,
    });
  });

  it("refuses an authored header that omits any required field", () => {
    for (const key of REQUIRED_ENTRY_FIELDS) {
      const header = entry();
      delete header[key];
      const parsed = parseCatalogueItemFile(header);

      expect(parsed.ok, `an item.json omitting ${key} was read`).toBe(false);
      expect(parsed.ok ? "" : parsed.reason, `${key}'s refusal`).toContain(
        `"${key}"`,
      );
    }
  });

  it("refuses a count that is not a count", () => {
    expect(parseCatalogueItemFile(entry({ downloads: -1 }))).toStrictEqual({
      ok: false,
      reason: `item.json's "downloads" must be a count of zero or more.`,
    });
  });

  it("carries the authored remixOf through unchanged", () => {
    const credit = remixOf();
    const parsed = parseCatalogueItemFile(entry({ remixOf: credit }));

    expect(parsed.ok && parsed.file.remixOf).toStrictEqual(credit);
  });

  it("accepts a plugin entry and refuses an unknown kind", () => {
    expect(
      parseCatalogueItemFile({
        ...entry(),
        kind: "plugin",
        publisher: "acme",
        executionProfile: "declarative",
      }),
    ).toMatchObject({
      ok: true,
      file: {
        kind: "plugin",
        publisher: "acme",
        executionProfile: "declarative",
      },
    });
    expect(parseCatalogueItemFile({ ...entry(), kind: "sensor-pack" })).toEqual(
      {
        ok: false,
        reason:
          'item.json\'s "kind" must be one of dashboard-theme, editor-theme, widget-pack, path-preset-pack, plugin.',
      },
    );
  });

  it("refuses a malformed remixOf with the one sentence", () => {
    const reason = `item.json's "remixOf" must be { catalogueId, name, version } with a UUID id and a version.`;
    const malformed = [
      null,
      [],
      "nope",
      remixOf({ catalogueId: "aurora" }),
      remixOf({ version: "1.0" }),
      remixOf({ name: "" }),
      remixOf({ extra: true }),
    ];

    for (const bad of malformed) {
      expect(
        parseCatalogueItemFile(entry({ remixOf: bad })),
        String(bad),
      ).toStrictEqual({
        ok: false,
        reason,
      });
    }
  });
});

describe("isCatalogueStatus", () => {
  it("accepts the six wire states and refuses anything else", () => {
    for (const status of [
      "draft",
      "pending",
      "published",
      "unpublished",
      "rejected",
      "removed",
    ]) {
      expect(isCatalogueStatus(status), status).toBe(true);
    }

    for (const other of [
      "shadow-banned",
      "Published",
      "",
      3,
      undefined,
      null,
    ]) {
      expect(isCatalogueStatus(other), String(other)).toBe(false);
    }
  });
});
