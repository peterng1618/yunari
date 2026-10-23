import { describe, expect, it } from "vitest";
import type { FabricThemeEnvelope } from "./fabric-envelope.js";
import {
  ASPECT_BUCKETS,
  facetRecordOf,
  PUBLISHED_BUCKETS,
} from "./facet-record.js";

/** The smallest envelope a record can be read from; each case states only the
    part of the document it is about. */
function envelope(
  overrides: Partial<FabricThemeEnvelope> = {},
): FabricThemeEnvelope {
  return {
    schemaVersion: 2,
    fabricVersion: "7.4.0",
    id: "theme",
    artboard: { width: 1920, height: 1080 },
    scene: {},
    ...overrides,
  } as FabricThemeEnvelope;
}

/** The same envelope at another artboard size, which is all a shape case states. */
function shaped(width: number, height: number): FabricThemeEnvelope {
  return envelope({ artboard: { width, height } });
}

/** A ground written as a literal, which is the shape the editor saves. */
function ground(value: unknown): FabricThemeEnvelope {
  return envelope({
    background: { color: { value } },
  });
}

describe("facetRecordOf", () => {
  it("reads a solid ground's own relative luminance", () => {
    expect(facetRecordOf(ground("#000000")).colourMode).toBe("dark");
    expect(facetRecordOf(ground("#ffffff")).colourMode).toBe("light");
    // Perceptual mid-grey is inside the band, so neither text colour is clearly
    // the readable one and the record says so rather than picking a side.
    expect(facetRecordOf(ground("#808080")).colourMode).toBe("unclassified");
  });

  it("resolves a ground written as a palette reference", () => {
    const document = envelope({
      background: { color: { ref: "palette.ink" } },
      globals: {
        palette: {
          ink: { name: "Ink", value: { kind: "solid", color: "#ffffff" } },
        },
      },
    } as unknown as Partial<FabricThemeEnvelope>);

    expect(facetRecordOf(document).colourMode).toBe("light");
  });

  it("averages a gradient's stops", () => {
    const gradient = (stops: readonly string[]): FabricThemeEnvelope =>
      ground({
        kind: "gradient",
        angle: 0,
        stops: stops.map((color, index) => ({ offset: index, color })),
      });

    // Two dark stops average dark; black to white averages perceptual mid-grey,
    // which is the band, not `light`.
    expect(facetRecordOf(gradient(["#000000", "#333333"])).colourMode).toBe(
      "dark",
    );
    expect(facetRecordOf(gradient(["#000000", "#ffffff"])).colourMode).toBe(
      "unclassified",
    );
  });

  it("never guesses when there is media behind it", () => {
    const document = envelope({
      background: {
        color: { value: "#000000" },
        media: { assetId: "photo", bounds: "theme" },
      },
    } as unknown as Partial<FabricThemeEnvelope>);

    expect(facetRecordOf(document).colourMode).toBe("unclassified");
  });

  it("is unclassified for a ground it cannot read", () => {
    // No ground at all, a reference the palette does not declare, and a colour
    // the parser rejects (8-digit hex) are three absences, not three defaults.
    expect(facetRecordOf(envelope()).colourMode).toBe("unclassified");
    expect(
      facetRecordOf(
        envelope({
          background: { color: { ref: "palette.gone" } },
        } as unknown as Partial<FabricThemeEnvelope>),
      ).colourMode,
    ).toBe("unclassified");
    expect(facetRecordOf(ground("#0815234d")).colourMode).toBe("unclassified");
  });

  it("groups the sensors a theme binds, labelled by the descriptor", () => {
    const document = envelope({
      bindings: {
        a: [{ id: "a1", semanticKey: "cpu.load" }],
        b: [
          { id: "b1", semanticKey: "gpu.load" },
          { id: "b2", semanticKey: "cpu.load" },
        ],
        c: [{ id: "c1", semanticKey: "reactor.output" }],
      },
    } as unknown as Partial<FabricThemeEnvelope>);

    expect(facetRecordOf(document).sensors).toEqual([
      { key: "cpu.load", label: "CPU load", family: "cpu" },
      { key: "gpu.load", label: "GPU load", family: "gpu" },
      // A key this build's vocabulary does not know is still listed, because the
      // alternative is a theme that reads something invisible to search.
      { key: "reactor.output", label: "reactor.output", family: undefined },
    ]);
  });

  it("matches no sensor for a theme that binds nothing", () => {
    expect(facetRecordOf(envelope()).sensors).toEqual([]);
    expect(facetRecordOf(envelope({ bindings: {} })).sensors).toEqual([]);
  });

  it("calls 1000x1001 portrait and 1001x1000 landscape, never square", () => {
    // Near-equal, and never square: exact equality is the rule, so each side of
    // the pair reads its own way.
    expect(facetRecordOf(shaped(1000, 1001)).orientation).toBe("portrait");
    expect(facetRecordOf(shaped(1001, 1000)).orientation).toBe("landscape");
    expect(facetRecordOf(shaped(1000, 1000)).orientation).toBe("square");
  });

  it("buckets the ratio in log space and answers other past the tolerance", () => {
    expect(facetRecordOf(shaped(1920, 1080)).aspect).toBe("16:9");
    expect(facetRecordOf(shaped(1920, 1200)).aspect).toBe("16:10");
    // 0.1% from square, and inside any tolerance that keeps 1920x1080 at 16:9.
    expect(facetRecordOf(shaped(1000, 999)).aspect).toBe("1:1");
    // A portrait artboard reads the same bucket as its landscape inversion.
    expect(facetRecordOf(shaped(1080, 1920)).aspect).toBe("16:9");
    // 2.35:1 is 0.7% from 21:9 — past the tolerance, so it falls to `other`
    // rather than being filed under the nearest wrong bucket.
    expect(facetRecordOf(shaped(2350, 1000)).aspect).toBe("other");
  });

  it("buckets the two shapes the owner ruled", () => {
    expect(facetRecordOf(shaped(3840, 960)).aspect).toBe("4:1");
    expect(facetRecordOf(shaped(2340, 1080)).aspect).toBe("19.5:9");
  });

  it("has a table entry for every bucket the array publishes, and the reverse", () => {
    // The compile-time table catches a union member with no entry; this catches
    // the other direction — an entry with no `ASPECT_BUCKETS` row, which is a
    // bucket the union offers and `aspectOf` can never return.
    expect(ASPECT_BUCKETS.map((e) => e.bucket).sort()).toEqual(
      Object.keys(PUBLISHED_BUCKETS).sort(),
    );
  });

  it("orders the buckets by ascending ratio", () => {
    // `aspectOf` returns the first match, so an entry declared out of order
    // silently steals its neighbour's artboards.
    const ratios = ASPECT_BUCKETS.map((e) => e.ratio);
    expect(ratios).toEqual([...ratios].sort((a, b) => a - b));
  });

  it("reads a document's tags into its record", () => {
    // A repeat is well-formed — the format's rule is shape and count — and the
    // facet is where it collapses, so the record holds the value once.
    expect(
      facetRecordOf(
        envelope({ metadata: { tags: ["retro", "neon-2", "retro"] } }),
      ).tags,
    ).toEqual(["retro", "neon-2"]);
  });

  it("reads a document with no tags as an empty list", () => {
    // Required and possibly empty: every record was derived from a document, so
    // there is always an answer, and the facet draws no value for the empty one.
    expect(facetRecordOf(envelope()).tags).toEqual([]);
    expect(facetRecordOf(envelope({ metadata: {} })).tags).toEqual([]);
  });

  it("carries the author and the exact pixel size the document declares", () => {
    expect(facetRecordOf(envelope()).author).toBeUndefined();
    expect(
      facetRecordOf(
        envelope({
          metadata: { author: "A. Author" },
          artboard: { width: 1440, height: 900 },
        }),
      ),
    ).toMatchObject({ author: "A. Author", width: 1440, height: 900 });
  });
});
