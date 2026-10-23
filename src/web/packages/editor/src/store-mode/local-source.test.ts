import {
  DASHBOARD_THEME_KIND,
  type FabricThemeEnvelope,
  facetRecordOf,
} from "@yunari/renderer-core";
import { describe, expect, it, vi } from "vitest";
import type {
  ThemeLibraryClient,
  ThemeLibraryEntry,
  ThemeOrigin,
} from "../theme-library-client.js";
import {
  localThemeSource,
  matchesFacets,
  matchesQuery,
  type StoreItem,
  settledTags,
} from "./local-source.js";

/**
 * The local half's item source: what one item is, and what narrows the list.
 *
 * The gallery reads this and never the host, so everything the cell needs — the
 * kind, the facets and the theme's own ground — is settled on the listing rather
 * than by opening anything.
 */

/** A stored theme, with a document a cell has something to draw from: a named
 *  author, a bound sensor and a 1920×1080 board. */
function envelope(
  overrides: Partial<FabricThemeEnvelope> = {},
): FabricThemeEnvelope {
  return {
    schemaVersion: 2,
    fabricVersion: "7.4.0",
    id: "living-room",
    artboard: {
      width: 1920,
      height: 1080,
    },
    background: { color: { value: { kind: "solid", color: "#101014" } } },
    metadata: {
      name: "Living room",
      themeLanguage: "en",
      author: "mira-k",
      version: "1.4.0",
    },
    scene: { version: "7.4.0", objects: [] },
    bindings: { "cpu-label": [{ id: "cpu", semanticKey: "cpu.load" }] },
    ...overrides,
  };
}

/** The listing entry the host derives for a document — the record through
 *  `facetRecordOf`, so the fixture is the derivation rather than a transcription
 *  of it (A.4a put that derivation in the host). */
function entry(
  document: FabricThemeEnvelope,
  ground: string | undefined,
  origin?: ThemeOrigin,
): ThemeLibraryEntry {
  return {
    id: document.id,
    name: document.metadata?.name ?? document.id,
    ...(document.metadata?.author === undefined
      ? {}
      : { author: document.metadata.author }),
    ...(document.metadata?.version === undefined
      ? {}
      : { version: document.metadata.version }),
    updatedAt: "2026-10-15T09:31:00.000Z",
    thumbnailUrl: `/api/themes/${document.id}/thumbnail`,
    ...(ground === undefined ? {} : { ground }),
    ...(origin === undefined ? {} : { origin }),
    facets: facetRecordOf(document),
  };
}

/** A theme carrying these style tags, which is the one thing a style case
 *  states — and it keeps the document's binding of one sensor. */
function tagged(...tags: readonly string[]): FabricThemeEnvelope {
  return envelope({
    id: `tagged-${tags.join("-")}`,
    metadata: { name: "Tagged", themeLanguage: "en", tags },
  });
}

/** The ground the host derives for the fixture document, and the value the
 *  cases that are not about an absence hand the client. */
const GROUND = "#101014";

/** A client whose listing is the fixtures and whose `open` **rejects**: the
 *  source must never call it, and a case that silently started to would fail
 *  here rather than pass on a stub that answers. */
function clientOf(
  documents: readonly FabricThemeEnvelope[],
  ground: string | undefined,
  origin?: ThemeOrigin,
): ThemeLibraryClient {
  return {
    list: vi.fn(async () =>
      documents.map((document) => entry(document, ground, origin)),
    ),
    open: vi.fn(async () => {
      throw new Error("the source opened a theme it should not have opened");
    }),
    save: vi.fn(async () => "base-after-save"),
    assign: vi.fn(async () => undefined),
    listDisplays: vi.fn(async () => ({ default: null, displays: [] })),
  };
}

describe("the local half's items", () => {
  it("labels every item with the kind it is", async () => {
    const source = localThemeSource(clientOf([envelope()], GROUND));

    const items = await source.list();

    // The wire value, not a display word: `Theme` is `uiCopy`'s to word and may
    // change without a format change, while this may not.
    expect(items.map((item) => item.kind)).toEqual(["dashboard-theme"]);
    expect(source.kind).toBe(DASHBOARD_THEME_KIND);
  });

  it("derives each item's facets from its envelope", async () => {
    const document = envelope();
    const source = localThemeSource(clientOf([document], GROUND));

    const items = await source.list();

    expect(items[0]?.facets.sensors.map((sensor) => sensor.key)).toEqual([
      "cpu.load",
    ]);
    expect(items[0]?.facets.width).toBe(1920);
    expect(items[0]?.facets.height).toBe(1080);
    expect(items[0]?.facets.aspect).toBe("16:9");
    expect(items[0]?.facets.orientation).toBe("landscape");
    expect(items[0]?.facets.author).toBe("mira-k");
    expect(items[0]?.author).toBe("mira-k");
  });

  it("reads the ground off the listing and opens nothing", async () => {
    // The whole point of R114: one pass over the library. A source that opened
    // each theme for the paint would be the second read the spec refuses, and
    // the client's `open` rejects, so any such call fails this case.
    const client = clientOf([envelope()], GROUND);
    const source = localThemeSource(client);

    const items = await source.list();

    expect(items[0]?.ground).toBe("#101014");
    expect(client.open).not.toHaveBeenCalled();
    expect(client.list).toHaveBeenCalledOnce();
  });

  it("carries a listing's absent ground as an absence", async () => {
    // A document with no paint, or one with media behind the board, arrives with
    // no ground — and nothing invents a colour to fill the box.
    const client = clientOf([envelope()], undefined);

    const items = await localThemeSource(client).list();

    expect(items[0]?.ground).toBeUndefined();
  });

  it("carries the document's version, and its absence as an absence", async () => {
    // The caption line prints `1.4.0 · 2026-10-14` from the listing, so the
    // version travels with the item exactly as the author does (R128) — and a
    // document that declares none arrives with nothing rather than with a
    // fabricated `0.0.0` or an empty string the caption would draw a separator
    // beside.
    const versioned = await localThemeSource(
      clientOf([envelope()], GROUND),
    ).list();
    const bare = await localThemeSource(
      clientOf(
        [
          envelope({
            id: "bare",
            metadata: { name: "Bare", themeLanguage: "en" },
          }),
        ],
        GROUND,
      ),
    ).list();

    expect(versioned[0]?.version).toBe("1.4.0");
    expect(bare[0]?.version).toBeUndefined();
  });

  it("carries a listing's origin, and a theme the host has no record for as an absence", async () => {
    // Where a theme came from is consumer state kept beside the library, so a
    // theme the author made here arrives with **no key at all** — the same
    // absence `author` carries for a document that declares none. An origin
    // invented to fill the field would make every theme read as installed.
    const origin: ThemeOrigin = {
      catalogueId: "yunari/office-wall",
      version: "1.3.0",
      installedAt: "2026-10-14T00:00:00.000Z",
    };
    const installed = await localThemeSource(
      clientOf([envelope()], GROUND, origin),
    ).list();
    const madeHere = await localThemeSource(
      clientOf([envelope()], GROUND),
    ).list();

    expect(installed[0]?.origin).toEqual(origin);
    expect(madeHere[0]?.origin).toBeUndefined();
  });
});

describe("narrowing by a facet", () => {
  /** One item, built through the source so the case reads the record the source
   *  actually hands the predicate. */
  async function item(document: FabricThemeEnvelope): Promise<StoreItem> {
    const items = await localThemeSource(clientOf([document], GROUND)).list();
    const first = items[0];
    if (first === undefined) throw new Error("the source listed nothing");
    return first;
  }

  /** A theme binding one sensor, or both. */
  function binding(...keys: readonly string[]): FabricThemeEnvelope {
    return envelope({
      id: `binds-${keys.join("-")}`,
      bindings: Object.fromEntries(
        keys.map((key) => [`${key}-label`, [{ id: key, semanticKey: key }]]),
      ),
    });
  }

  it("asks a theme to read every sensor the selection names", async () => {
    const cpuOnly = await item(binding("cpu.load"));
    const both = await item(binding("cpu.load", "gpu.load"));

    // The spec's own example: "Themes that use CPU and GPU" must not return a
    // CPU-only theme.
    expect(matchesFacets(cpuOnly, { sensors: ["cpu.load", "gpu.load"] })).toBe(
      false,
    );
    expect(matchesFacets(both, { sensors: ["cpu.load", "gpu.load"] })).toBe(
      true,
    );
    expect(matchesFacets(both, { sensors: ["gpu.load"] })).toBe(true);
    expect(matchesFacets(cpuOnly, { sensors: ["gpu.load"] })).toBe(false);
  });

  it("matches nothing for a theme that binds nothing, and keeps it under any", async () => {
    const bare = await item(
      envelope({
        id: "bare",
        metadata: { name: "Bare", themeLanguage: "en" },
        bindings: {},
      }),
    );

    expect(matchesFacets(bare, { sensors: ["cpu.load"] })).toBe(false);
    expect(matchesFacets(bare, { sensors: [] })).toBe(true);
    expect(matchesFacets(bare, {})).toBe(true);
  });

  it("holds every shape group the selection names, and reads a value by its group", async () => {
    const wide = await item(envelope());
    const upright = await item(
      envelope({ id: "upright", artboard: { width: 1080, height: 1920 } }),
    );
    const tall = await item(
      envelope({ id: "tall", artboard: { width: 2560, height: 1440 } }),
    );

    // A portrait board reads its landscape inversion's bucket, so the flat rule
    // returned it for a landscape selection. The orientation group is what
    // separates them.
    expect(upright.facets.aspect).toBe("16:9");
    expect(upright.facets.orientation).toBe("portrait");
    expect(matchesFacets(upright, { shape: ["landscape", "16:9"] })).toBe(
      false,
    );
    expect(matchesFacets(wide, { shape: ["landscape", "16:9"] })).toBe(true);

    // Bucket and size are two groups: both have to hold.
    expect(matchesFacets(wide, { shape: ["16:9", "1920x1080"] })).toBe(true);
    expect(matchesFacets(tall, { shape: ["16:9", "1920x1080"] })).toBe(false);
    expect(matchesFacets(tall, { shape: ["16:9"] })).toBe(true);

    // Within one group the values are alternatives.
    expect(matchesFacets(wide, { shape: ["landscape", "portrait"] })).toBe(
      true,
    );
    expect(matchesFacets(upright, { shape: ["landscape", "portrait"] })).toBe(
      true,
    );
    expect(matchesFacets(wide, { shape: ["portrait", "square"] })).toBe(false);

    // A value that names no group is satisfied by nothing.
    expect(matchesFacets(wide, { shape: ["landscape", "wide-ish"] })).toBe(
      false,
    );
    expect(matchesFacets(wide, { shape: ["wide-ish"] })).toBe(false);
  });

  it("matches a 19.5:9 selection against a board that reads that bucket", async () => {
    // A bucket a person can choose must find the themes filed under it: the id
    // carries a decimal point, so a ratio-shaped value is not only `n:n`.
    const phone = await item(
      envelope({ id: "phone", artboard: { width: 2340, height: 1080 } }),
    );

    expect(phone.facets.aspect).toBe("19.5:9");
    expect(matchesFacets(phone, { shape: ["19.5:9"] })).toBe(true);
  });

  it("holds the ordinary reading where a facet is not Sensors or Shape", async () => {
    const one = await item(envelope());

    expect(
      matchesFacets(one, { "colour-mode": ["dark", "unclassified"] }),
    ).toBe(true);
    expect(matchesFacets(one, { "colour-mode": ["light"] })).toBe(false);
    expect(matchesFacets(one, { author: ["mira-k", "someone-else"] })).toBe(
      true,
    );
    expect(matchesFacets(one, { author: ["someone-else"] })).toBe(false);
    // Across facets it is AND, whichever reading each facet takes.
    expect(
      matchesFacets(one, { author: ["mira-k"], sensors: ["cpu.load"] }),
    ).toBe(true);
    expect(
      matchesFacets(one, { author: ["mira-k"], sensors: ["gpu.load"] }),
    ).toBe(false);
    expect(
      matchesFacets(one, { author: ["someone-else"], sensors: ["cpu.load"] }),
    ).toBe(false);
  });

  it("keeps an unclassified theme reachable under any and under no other value", async () => {
    // A picture behind the board: the token is not what a viewer sees, so the
    // document carries no colour mode. `unclassified` is the absence of an
    // answer rather than one a person can ask for, so it is reachable by not
    // asking and by nothing else (spec, "Finding a theme") — a selection naming
    // it must not be the one thing that finds it.
    const filmed = await item(
      envelope({
        id: "film",
        artboard: {
          width: 1920,
          height: 1080,
        },
        background: {
          color: { value: { kind: "solid", color: "#101014" } },
          media: { assetId: "loop", bounds: "theme" },
        },
      }),
    );
    const daylight = await item(
      envelope({
        id: "daylight",
        artboard: {
          width: 1920,
          height: 1080,
        },
        background: { color: { value: { kind: "solid", color: "#f7f7f7" } } },
      }),
    );
    const dark = await item(envelope());

    expect(filmed.facets.colourMode).toBe("unclassified");
    expect(matchesFacets(filmed, {})).toBe(true);
    expect(matchesFacets(filmed, { "colour-mode": [] })).toBe(true);
    expect(matchesFacets(filmed, { "colour-mode": ["unclassified"] })).toBe(
      false,
    );
    expect(
      matchesFacets(filmed, { "colour-mode": ["dark", "unclassified"] }),
    ).toBe(false);

    expect(daylight.facets.colourMode).toBe("light");
    expect(matchesFacets(daylight, { "colour-mode": ["light"] })).toBe(true);
    expect(matchesFacets(daylight, { "colour-mode": ["dark"] })).toBe(false);
    expect(dark.facets.colourMode).toBe("dark");
    expect(matchesFacets(dark, { "colour-mode": ["light"] })).toBe(false);
  });

  it("matches a style selection as OR, unlike sensors and shape", async () => {
    const retro = await item(tagged("retro"));
    const neon = await item(tagged("neon-2"));
    const both = await item(tagged("retro", "neon-2"));

    // Two values in one facet are alternatives, so a theme carrying either
    // answers — where the same pair on Sensors asks for both, which is the one
    // exception the spec calls out. `retro` binds `cpu.load` alone.
    expect(matchesFacets(retro, { style: ["retro", "neon-2"] })).toBe(true);
    expect(matchesFacets(neon, { style: ["retro", "neon-2"] })).toBe(true);
    expect(matchesFacets(both, { style: ["retro", "neon-2"] })).toBe(true);
    expect(matchesFacets(retro, { style: ["neon-2"] })).toBe(false);
    expect(
      matchesFacets(retro, { sensors: ["cpu.load", "gpu.load"] }),
      "a style selection reads like a sensor selection",
    ).toBe(false);
  });

  it("matches no style selection when the theme carries none", async () => {
    const bare = await item(
      envelope({
        id: "bare",
        metadata: { name: "Bare", themeLanguage: "en" },
      }),
    );

    // Nothing is asked of a facet nobody chose in, so an empty answer is
    // excluded by a style selection and kept by no selection at all.
    expect(bare.facets.tags).toEqual([]);
    expect(matchesFacets(bare, { style: ["retro"] })).toBe(false);
    expect(matchesFacets(bare, { style: [] })).toBe(true);
    expect(matchesFacets(bare, {})).toBe(true);
  });

  it("reads a tag that names a prototype member as the tag it is", async () => {
    // `constructor` is well-formed under the format's own rule, so it is a tag a
    // theme may carry — and one the facet must answer as itself rather than as
    // the member of `Object.prototype` that shares its name.
    const one = await item(tagged("constructor"));

    expect(one.facets.tags).toEqual(["constructor"]);
    expect(matchesFacets(one, { style: ["constructor"] })).toBe(true);
    expect(matchesFacets(one, { style: ["toString"] })).toBe(false);
  });

  it("matches nothing on a facet id this build does not know", async () => {
    // No rule at all, rather than a rule that matches everything: a filter over
    // a vocabulary nothing populates cannot be satisfied.
    const one = await item(envelope());

    expect(matchesFacets(one, { nonsense: ["calm"] })).toBe(false);
    expect(matchesFacets(one, { nonsense: [] })).toBe(true);
  });

  it("matches nothing for a facet id that names a prototype member", async () => {
    // The table is a plain object, so a bare `FACET_MATCHERS[id]` read answers
    // `Object.prototype`'s member for these names: one that matches everything
    // (`constructor`), one that is not a function at all (`__proto__`) and one
    // that throws when called with these arguments (`valueOf`). A facet id the
    // table does not hold has no rule, whichever name it borrows — and the
    // reading is a *guard*, because these are legal keys on the wire rather than
    // hypotheticals (phase C's facets arrive from a listing).
    const one = await item(envelope());

    for (const id of [
      "constructor",
      "toString",
      "hasOwnProperty",
      "valueOf",
      "__proto__",
    ]) {
      const chosen = { [id]: ["calm"] };
      expect(() => matchesFacets(one, chosen), id).not.toThrow();
      expect(matchesFacets(one, chosen), id).toBe(false);
    }
  });
});

/**
 * The query, which is the sixth filter and the one that is not a facet: what a
 * person types is matched against the two words the cell already prints.
 *
 * **It is tested here rather than only through the region**, because it is a
 * pure predicate and the region's cases read it a page at a time: a rule that
 * matched the author but not the name, or that stopped trimming, would still
 * leave a listing that looked right.
 */
describe("narrowing by a query", () => {
  /** One item, built through the source so the case reads the item the predicate
   *  is really handed. */
  async function item(): Promise<StoreItem> {
    const items = await localThemeSource(clientOf([envelope()], GROUND)).list();
    const first = items[0];
    if (first === undefined) throw new Error("the source listed nothing");
    return first;
  }

  it("matches the name and the author, case-folded and trimmed", async () => {
    const one = await item();

    expect(matchesQuery(one, "Living room")).toBe(true);
    expect(matchesQuery(one, "living")).toBe(true);
    expect(matchesQuery(one, "LIVING ROOM")).toBe(true);
    expect(matchesQuery(one, "  living  ")).toBe(true);
    expect(matchesQuery(one, "mira-k")).toBe(true);
    expect(matchesQuery(one, "MIRA")).toBe(true);
    // A substring of neither word, which is the miss the net needs.
    expect(matchesQuery(one, "kitchen")).toBe(false);
    expect(matchesQuery(one, "1.4.0")).toBe(false);
  });

  it("answers every item for an empty query, which is an untouched well", async () => {
    const one = await item();

    expect(matchesQuery(one, "")).toBe(true);
    expect(matchesQuery(one, "   ")).toBe(true);
  });

  it("reads a theme with no author without matching the word it is drawn with", async () => {
    // The cell prints `No author` for a document that declares none. That word
    // is `uiCopy`'s, not the item's, so a query for it must not find such a
    // theme — the predicate reads the field, and the field is absent.
    const items = await localThemeSource(
      clientOf(
        [
          envelope({
            id: "bare",
            metadata: { name: "Bare", themeLanguage: "en" },
          }),
        ],
        GROUND,
      ),
    ).list();
    const bare = items[0];
    if (bare === undefined) throw new Error("the source listed nothing");

    expect(bare.author).toBeUndefined();
    expect(matchesQuery(bare, "no author")).toBe(false);
    expect(matchesQuery(bare, "bare")).toBe(true);
  });
});

/**
 * **What a style pill's "proposed" is read against**: the seed, plus the tags the
 * listing's *other* themes carry.
 *
 * It is a reading of the listing rather than of one item, which is why it lives
 * beside the predicates rather than in the modal — and it is why the facet's own
 * options cannot answer the question: those are the tags the items carry, this
 * item included, so its own tag is always among them.
 */
describe("the style vocabulary one item is read against", () => {
  /** One listing's items, read through the source the way every case here does. */
  async function listed(
    ...documents: readonly FabricThemeEnvelope[]
  ): Promise<readonly StoreItem[]> {
    return localThemeSource(clientOf(documents, GROUND)).list();
  }

  async function only(document: FabricThemeEnvelope): Promise<StoreItem> {
    const [first] = await listed(document);
    if (first === undefined) throw new Error("the source listed nothing");
    return first;
  }

  it("holds the seed's words, and not a tag this theme is the first to use", async () => {
    const mine = await only(tagged("retro-diner"));

    const settled = settledTags([mine], mine);

    // A word in the seed is settled however few themes carry it, and this
    // theme's own tag is the one the vocabulary does not hold — which is exactly
    // what makes it proposed rather than the facet having failed to match.
    expect(settled).toContain("retro");
    expect(settled).not.toContain("retro-diner");
  });

  it("holds a tag another theme carries, and never the item's own", async () => {
    const items = await listed(tagged("retro-diner"), {
      ...tagged("neon-2"),
      id: "neighbour",
    });
    const [mine, other] = items;
    if (mine === undefined || other === undefined) {
      throw new Error("the source listed one theme of two");
    }

    // Read for each item in turn: each is the first use of its own tag, and the
    // other theme is the only thing that settles it.
    expect(settledTags(items, mine)).toContain("neon-2");
    expect(settledTags(items, mine)).not.toContain("retro-diner");
    expect(settledTags(items, other)).toContain("retro-diner");
    expect(settledTags(items, other)).not.toContain("neon-2");
  });
});
