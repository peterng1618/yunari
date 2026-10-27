import { describe, expect, it } from "vitest";
import {
  applyFontTrio,
  catalogFaces,
  faceForRole,
  fontTrio,
  fontTrios,
} from "./font-catalog.js";

/** A real trio with three distinct families, so a test cannot pass on a
 * fixture whose three roles happen to share one family. */
const trio = fontTrios().find(
  (candidate) => new Set(candidate.faces.map((face) => face.family)).size === 3,
)!;

describe("curated font trios", () => {
  it("serves every generated trio through one owner", () => {
    expect(fontTrios().length).toBeGreaterThan(1);
    expect(fontTrio(trio.id)).toBe(trio);
    expect(fontTrio("no-such-trio")).toBeUndefined();
  });

  it("selects the face for a role, and the nearest weight within it", () => {
    // Identity, not a field comparison, on both halves: a trio holds exactly
    // one face per role, so an unbounded lookup still satisfies a definedness
    // or weight assertion while returning the wrong face. That bug is silent in
    // a unit test and loud in a shipped theme, because `applyFontTrio` writes
    // whatever comes back into every preset holding that role.
    const heading = trio.faces.find((face) => face.role === "heading")!;
    const body = trio.faces.find((face) => face.role === "body")!;
    expect(faceForRole(trio, "heading", heading.weight)).toBe(heading);
    // 9999 is past every weight in the trio, so the nearest face is the role's
    // own whatever the sort compares. This pins the role filter alone.
    expect(faceForRole(trio, "body", 9999)).toBe(body);
    // The heading's own weight, asked of the body role. Filtered, the body face
    // is the only candidate and this passes; unfiltered, the heading face is
    // nearer to its own weight than the body face is, so it returns that
    // instead. This catches the same missing filter as 9999 does, at a weight
    // where the face that leaks in is the heading's own.
    //
    // A low weight does not work here: body and mono are both 400 on this trio,
    // so the nearest-weight sort ties and stable order returns body regardless —
    // 326 of the 379 trios answer a weight-1 lookup with body either way.
    //
    // Neither assertion can catch a broken comparator, and no assertion in this
    // file could: a trio holds one face per role, so the filtered array has one
    // element and the sort is a no-op on it. The comparator is only observable
    // once the filter is already gone.
    expect(faceForRole(trio, "body", heading.weight)).toBe(body);
  });

  it("exposes each distinct face once for the picker", () => {
    const faces = catalogFaces();
    expect(new Set(faces.map((face) => face.id)).size).toBe(faces.length);
    // 261, not the design doc's measured 238. That count came from clamping
    // every heading to a uniform 700, which overwrites the pairing's own `h1`
    // recommendation for the 146 pairings whose heading is not a 700, and marks
    // the result `clamped` when it is in fact the author's choice. Clamping to
    // the recommendation keeps those extra faces, so the list is longer.
    expect(faces).toHaveLength(261);
  });

  it("updates every role token without changing its treatment or custom tokens", () => {
    const heading = trio.faces.find((face) => face.role === "heading")!;
    const body = trio.faces.find((face) => face.role === "body")!;
    const mono = trio.faces.find((face) => face.role === "mono")!;
    const presets = {
      heading: { family: "Segoe UI", weight: "500" },
      // Not a role id, so the role rule does not touch it.
      metric: { family: "Segoe UI", weight: "300" },
      body: { family: "Segoe UI" },
      mono: { family: "Segoe UI" },
      custom: { family: "Georgia" },
    };

    expect(applyFontTrio(presets, trio)).toEqual({
      heading: {
        family: heading.family,
        weight: heading.weight,
        face: { assetId: heading.id },
      },
      metric: { family: "Segoe UI", weight: "300" },
      body: {
        family: body.family,
        weight: body.weight,
        face: { assetId: body.id },
      },
      mono: {
        family: mono.family,
        weight: mono.weight,
        face: { assetId: mono.id },
      },
      custom: { family: "Georgia" },
    });
  });

  it("leaves a token with no trio role untouched", () => {
    const custom = {
      only: { family: "Georgia" },
    };
    expect(applyFontTrio(custom, trio)).toEqual(custom);
  });
});
