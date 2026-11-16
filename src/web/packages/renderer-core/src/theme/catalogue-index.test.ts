import { describe, expect, it } from "vitest";
import {
  document,
  entry,
  facets,
  INCLUDED_ID,
  include,
  includeIds,
  KNOWN,
  OTHER_ID,
  REQUIRED_ENTRY_FIELDS,
  remixOf,
  unreadable,
  without,
} from "./catalogue-index.fixture.js";
import {
  MAX_COLLECTION_INCLUDES,
  MAX_LISTING_MEMBERS,
  parseCatalogueIndex,
  parseCatalogueItemFile,
} from "./catalogue-index.js";

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

  it("keeps a member kind this build does not ship", () => {
    const members = [{ id: "a", kind: "future-thing", name: "A" }];
    const parsed = parseCatalogueIndex(document([entry({ members })]), KNOWN);

    expect(parsed.refused).toStrictEqual([]);
    expect(parsed.entries[0]?.members).toStrictEqual(members);
  });

  it("refuses includes on a non-collection entry", () => {
    const parsed = parseCatalogueIndex(
      document([entry({ includes: [include(INCLUDED_ID)] })]),
      KNOWN,
    );

    expect(parsed.entries).toStrictEqual([]);
    expect(parsed.refused).toStrictEqual([
      { kind: "dashboard-theme", reason: "malformed", count: 1 },
    ]);
  });

  it("accepts a collection with includes and no members", () => {
    const includes = [include(INCLUDED_ID)];
    const collection = entry({ kind: "collection", members: [], includes });
    const parsed = parseCatalogueIndex(document([collection]), [
      ...KNOWN,
      "collection",
    ]);

    expect(parsed.refused).toStrictEqual([]);
    expect(parsed.entries[0]).toMatchObject({
      kind: "collection",
      members: [],
      includes,
    });
    expect(parseCatalogueItemFile(collection)).toMatchObject({
      ok: true,
      file: { kind: "collection", members: [], includes },
    });
  });

  it("keeps each include's optional flag from the wire", () => {
    const includes = [include(INCLUDED_ID, true), include(OTHER_ID)];
    const parsed = parseCatalogueIndex(
      document([entry({ kind: "collection", members: [], includes })]),
      [...KNOWN, "collection"],
    );

    expect(parsed.entries[0]?.includes).toEqual(includes);
  });

  it.each([
    ["a bare id string", [INCLUDED_ID]],
    ["a record with no id", [{ optional: false }]],
    [
      "a record whose optional is not a boolean",
      [{ id: INCLUDED_ID, optional: "yes" }],
    ],
  ])("refuses an include that is %s", (_label, includes) => {
    const parsed = parseCatalogueIndex(
      document([entry({ kind: "collection", members: [], includes })]),
      [...KNOWN, "collection"],
    );

    expect(parsed.entries).toStrictEqual([]);
    expect(parsed.refused).toStrictEqual([
      { kind: "collection", reason: "malformed", count: 1 },
    ]);
  });

  it("refuses a collection whose includes value is not a catalogue id", () => {
    const parsed = parseCatalogueIndex(
      document([
        entry({
          kind: "collection",
          includes: [{ id: "aurora", optional: false }],
        }),
      ]),
      [...KNOWN, "collection"],
    );

    expect(parsed.entries).toStrictEqual([]);
    expect(parsed.refused).toStrictEqual([
      { kind: "collection", reason: "malformed", count: 1 },
    ]);
  });

  it("refuses a malformed member", () => {
    const parsed = parseCatalogueIndex(
      document([entry({ members: [{ id: "a", kind: "widget" }] })]),
      KNOWN,
    );

    expect(parsed.entries).toStrictEqual([]);
    expect(parsed.refused).toStrictEqual([
      { kind: "dashboard-theme", reason: "malformed", count: 1 },
    ]);
  });

  it("refuses a member id repeated in one list", () => {
    const members = [
      { id: "clock", kind: "widget", name: "Clock" },
      { id: "clock", kind: "widget", name: "Clock again" },
    ];
    const parsed = parseCatalogueIndex(document([entry({ members })]), KNOWN);

    expect(parsed.entries).toStrictEqual([]);
    expect(parsed.refused).toStrictEqual([
      { kind: "dashboard-theme", reason: "malformed", count: 1 },
    ]);
  });

  it("accepts one member id under two groups", () => {
    // A plugin may contribute the same id as a sensor provider and a data
    // source; both records are separate members, so the identity is the pair.
    const members = [
      { id: "acme", kind: "sensor-provider", name: "Acme load" },
      { id: "acme", kind: "data-source", name: "Acme HTTP" },
    ];
    const parsed = parseCatalogueIndex(document([entry({ members })]), KNOWN);

    expect(parsed.refused).toStrictEqual([]);
    expect(parsed.entries[0]?.members).toStrictEqual(members);
  });

  it("refuses a whitespace-only member name or id", () => {
    const parsed = parseCatalogueIndex(
      document([
        entry({
          id: "blank-name",
          members: [{ id: "clock", kind: "widget", name: "   " }],
        }),
        entry({
          id: "blank-id",
          members: [{ id: "\t", kind: "widget", name: "Clock" }],
        }),
      ]),
      KNOWN,
    );

    expect(parsed.entries).toStrictEqual([]);
    expect(parsed.refused).toStrictEqual([
      { kind: "dashboard-theme", reason: "malformed", count: 2 },
    ]);
  });

  it("refuses an oversized members list but keeps the bound itself", () => {
    const atBound = Array.from({ length: MAX_LISTING_MEMBERS }, (_, index) => ({
      id: `member-${index}`,
      kind: "widget",
      name: `Member ${index}`,
    }));

    expect(
      parseCatalogueIndex(document([entry({ members: atBound })]), KNOWN)
        .refused,
    ).toStrictEqual([]);

    const oversized = [
      ...atBound,
      { id: "one-too-many", kind: "widget", name: "One too many" },
    ];
    expect(
      parseCatalogueIndex(document([entry({ members: oversized })]), KNOWN)
        .entries,
    ).toStrictEqual([]);
  });

  it("refuses duplicate includes, so a count cannot read two as three", () => {
    // Only X is installed: a `[X, X, Y]` list read as three includes would
    // report "2 of 3", so the duplicate is refused before it can be counted.
    const parsed = parseCatalogueIndex(
      document([
        entry({
          kind: "collection",
          members: [],
          includes: [
            include(INCLUDED_ID),
            include(INCLUDED_ID),
            include(OTHER_ID),
          ],
        }),
      ]),
      [...KNOWN, "collection"],
    );

    expect(parsed.entries).toStrictEqual([]);
    expect(parsed.refused).toStrictEqual([
      { kind: "collection", reason: "malformed", count: 1 },
    ]);
  });

  it("refuses a collection with an empty or missing includes list", () => {
    const parsed = parseCatalogueIndex(
      document([
        entry({ id: "empty", kind: "collection", members: [], includes: [] }),
        entry({ id: "missing", kind: "collection", members: [] }),
      ]),
      [...KNOWN, "collection"],
    );

    expect(parsed.entries).toStrictEqual([]);
    expect(parsed.refused).toStrictEqual([
      { kind: "collection", reason: "malformed", count: 2 },
    ]);
  });

  it("refuses a collection that includes itself", () => {
    const parsed = parseCatalogueIndex(
      document([
        entry({
          id: INCLUDED_ID,
          kind: "collection",
          members: [],
          includes: [include(INCLUDED_ID), include(OTHER_ID)],
        }),
      ]),
      [...KNOWN, "collection"],
    );

    expect(parsed.entries).toStrictEqual([]);
    expect(parsed.refused).toStrictEqual([
      { kind: "collection", reason: "malformed", count: 1 },
    ]);
  });

  it("keeps a collection with the greatest allowed number of includes", () => {
    const includes = includeIds(MAX_COLLECTION_INCLUDES);
    const collection = entry({
      kind: "collection",
      members: [],
      includes,
    });

    expect(
      parseCatalogueIndex(document([collection]), [...KNOWN, "collection"])
        .entries[0]?.includes,
    ).toStrictEqual(includes);

    expect(
      parseCatalogueIndex(
        document([
          entry({
            kind: "collection",
            members: [],
            includes: includeIds(MAX_COLLECTION_INCLUDES + 1),
          }),
        ]),
        [...KNOWN, "collection"],
      ).entries,
    ).toStrictEqual([]);
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
      members: [],
    });
  });
});
