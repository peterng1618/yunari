import { describe, expect, it } from "vitest";
import {
  entry,
  INCLUDED_ID,
  include,
  OTHER_ID,
  REQUIRED_ENTRY_FIELDS,
  remixOf,
} from "./catalogue-index.fixture.js";
import { parseCatalogueItemFile } from "./catalogue-index.js";

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
        members: [],
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
          'item.json\'s "kind" must be one of dashboard-theme, editor-theme, widget-pack, path-preset-pack, plugin, collection.',
      },
    );
  });

  it("refuses a collection header that includes the entry's own id", () => {
    const header = entry({
      kind: "collection",
      members: [],
      includes: [include(INCLUDED_ID), include(OTHER_ID)],
    });

    expect(parseCatalogueItemFile(header, INCLUDED_ID)).toStrictEqual({
      ok: false,
      reason: expect.stringContaining("itself"),
    });
    expect(
      parseCatalogueItemFile(header, "11111111-1111-4111-8111-111111111111"),
    ).toMatchObject({
      ok: true,
      file: {
        kind: "collection",
        includes: [include(INCLUDED_ID), include(OTHER_ID)],
      },
    });
  });

  it("refuses a duplicate member id in a header", () => {
    const members = [
      { id: "clock", kind: "widget", name: "Clock" },
      { id: "clock", kind: "widget", name: "Clock again" },
    ];

    expect(parseCatalogueItemFile(entry({ members }))).toStrictEqual({
      ok: false,
      reason: expect.stringContaining("distinct ids"),
    });
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
