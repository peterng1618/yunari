import { describe, expect, it } from "vitest";
import {
  glassTreatment,
  isGlassTreatment,
  MAX_GLASS_BLUR_RADIUS,
  supportsGlass,
  YUNARI_GLASS_PROPERTY,
} from "./glass.js";

function objectWith(value: unknown): { get(name: string): unknown } {
  return {
    get: (name) => (name === YUNARI_GLASS_PROPERTY ? value : undefined),
  };
}

describe("the glass treatment contract", () => {
  it("accepts the whole authored range, including the two off spellings", () => {
    // Absence is off; zero is authored-but-no-blur. Both must be expressible
    // without a clamp, and both are legal persisted state.
    expect(isGlassTreatment({ blurRadius: 0 })).toBe(true);
    expect(isGlassTreatment({ blurRadius: 1.5 })).toBe(true);
    expect(isGlassTreatment({ blurRadius: MAX_GLASS_BLUR_RADIUS })).toBe(true);
    expect(glassTreatment(objectWith(undefined))).toBeUndefined();
  });

  it("refuses a non-finite, negative or out-of-range radius", () => {
    expect(isGlassTreatment({ blurRadius: Number.NaN })).toBe(false);
    expect(isGlassTreatment({ blurRadius: Number.POSITIVE_INFINITY })).toBe(
      false,
    );
    expect(isGlassTreatment({ blurRadius: -0.5 })).toBe(false);
    expect(isGlassTreatment({ blurRadius: MAX_GLASS_BLUR_RADIUS + 0.01 })).toBe(
      false,
    );
  });

  it("refuses a wrong type or a missing radius rather than coercing it", () => {
    // A string "12" or an absent radius would both become 0 under coercion,
    // which is indistinguishable from an authored "no blur".
    expect(isGlassTreatment({ blurRadius: "12" })).toBe(false);
    expect(isGlassTreatment({ blurRadius: null })).toBe(false);
    expect(isGlassTreatment({})).toBe(false);
    expect(isGlassTreatment({ radius: 12 })).toBe(false);
    expect(isGlassTreatment(undefined)).toBe(false);
    expect(isGlassTreatment(null)).toBe(false);
    expect(isGlassTreatment(12)).toBe(false);
    expect(isGlassTreatment([{ blurRadius: 12 }])).toBe(false);
  });

  it("refuses a treatment carrying anything beyond the authored radius", () => {
    // Derived state must never ride along in the persisted treatment: a
    // resolved surface or a sampled device pixel would be exactly the leak
    // the persisted document must not carry.
    expect(isGlassTreatment({ blurRadius: 12, tint: "#fff" })).toBe(false);
    expect(isGlassTreatment({ blurRadius: 12, blurRadiusPx: 24 })).toBe(false);
  });

  it("reads a treatment off an object only when the property is valid", () => {
    expect(glassTreatment(objectWith({ blurRadius: 16 }))).toEqual({
      blurRadius: 16,
    });
    expect(glassTreatment(objectWith({ blurRadius: 999 }))).toBeUndefined();
  });

  it("hands back a copy, so a renderer cannot corrupt the revived object", () => {
    // The treatment on a revived object is the object's own state. Returning
    // it by reference would let a renderer that mutates what it read rewrite
    // the scene behind the validator's back; `readonly` is a compile-time
    // promise that a `ScenePlan` update or a `set()` would quietly break.
    const stored = { blurRadius: 16 };
    const read = glassTreatment(objectWith(stored));

    expect(read).toEqual({ blurRadius: 16 });
    expect(read).not.toBe(stored);

    (read as { blurRadius: number }).blurRadius = 999;
    expect(stored).toEqual({ blurRadius: 16 });
  });

  it("allows glass on every kind the product can prove is closed", () => {
    // The predicate is geometry, not a roster: the treatment needs a closed
    // path to sample the backdrop through, and each of these has one.
    for (const type of [
      "Rect",
      "Circle",
      "Ellipse",
      "Triangle",
      "Polygon",
      "Path",
      "Group",
    ])
      expect(supportsGlass(type), type).toBe(true);
  });

  it("refuses an open path, whose interior there is nothing to sample", () => {
    // The exclusion is the geometry, so it is named here rather than left as
    // an absence someone re-adds on the theory that it "probably works".
    // A polyline and a line are classes with no interior; a `Path` is admitted
    // here and its own commands are read at the scene, where `hasClosedPath`
    // can see them.
    for (const type of ["Polyline", "Line"])
      expect(supportsGlass(type), type).toBe(false);
  });

  it("refuses a kind that is not a panel, on its own terms", () => {
    // These are not closed-vs-open questions: a blur behind a glyph or a
    // plotted series has no meaning at all.
    expect(supportsGlass("Textbox")).toBe(false);
    expect(supportsGlass("YunariChart")).toBe(false);
    expect(supportsGlass("FabricImage")).toBe(false);
    // Case-exact, because the property is compared against a persisted string.
    expect(supportsGlass("rect")).toBe(false);
    expect(supportsGlass("circle")).toBe(false);
  });

  it("reads a treatment back off every kind that may carry one", () => {
    // The other half of the round trip: a value the validator admits must be
    // a value the reader hands to the renderer, or an admitted treatment would
    // composite nothing and look like a broken blur.
    for (const type of [
      "Rect",
      "Circle",
      "Ellipse",
      "Triangle",
      "Polygon",
      "Group",
    ]) {
      if (!supportsGlass(type)) continue;
      expect(glassTreatment(objectWith({ blurRadius: 24 })), type).toEqual({
        blurRadius: 24,
      });
    }
  });

  it("still refuses an out-of-range treatment on a newly admitted kind", () => {
    // Admitting a kind admits its vocabulary, not its values.
    expect(
      glassTreatment(objectWith({ blurRadius: MAX_GLASS_BLUR_RADIUS + 1 })),
    ).toBeUndefined();
  });
});
