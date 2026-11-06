import { describe, expect, it } from "vitest";
import type { FabricPalette } from "./fabric-envelope.js";
import {
  isOfferedPaletteToken,
  paletteTokenIds,
  paletteTokenOptions,
} from "./palette-tokens.js";

/** A document's tokens, as a hand-authored or store-downloaded theme declares
    them. `none` is the reserved transparent token every starter carries. */
const PALETTE = {
  none: { name: "None", value: { kind: "solid", color: "#00000000" } },
  ink: { name: "Ink", value: { kind: "solid", color: "#e8ecf3" } },
  heat: {
    name: "Heat",
    value: {
      kind: "gradient",
      angle: 0,
      stops: [
        { offset: 0, color: "#000000" },
        { offset: 1, color: "#ffffff" },
      ],
    },
  },
} as unknown as FabricPalette;

describe("isOfferedPaletteToken", () => {
  it("excludes the reserved none and includes an authored token", () => {
    expect(isOfferedPaletteToken("none")).toBe(false);
    expect(isOfferedPaletteToken("ink")).toBe(true);
  });
});

describe("paletteTokenIds", () => {
  it("lists the document's tokens in declaration order without none", () => {
    expect(paletteTokenIds(PALETTE)).toEqual(["ink", "heat"]);
  });

  it("offers nothing when the document declares no palette", () => {
    expect(paletteTokenIds(undefined)).toEqual([]);
  });
});

describe("paletteTokenOptions", () => {
  it("names each of the document's tokens by the name its author gave it", () => {
    expect(paletteTokenOptions(PALETTE).map((option) => option.name)).toEqual([
      "None",
      "Ink",
      "Heat",
    ]);
  });

  it("offers each token under its stored reference", () => {
    expect(paletteTokenOptions(PALETTE).map((option) => option.id)).toEqual([
      "palette.none",
      "palette.ink",
      "palette.heat",
    ]);
  });

  it("applies the caller's own filter and nothing else", () => {
    // The surfaces differ in which tokens they offer — the inspector hides
    // `none`, a solid-only field hides the gradients — and that is the whole of
    // what stays at the surface.
    expect(
      paletteTokenOptions(
        PALETTE,
        (_id, entry) => entry.value.kind === "solid",
      ).map((option) => option.id),
    ).toEqual(["palette.none", "palette.ink"]);
  });

  it("falls back to the reference for a token the author has deleted", () => {
    // A token the document no longer declares a name for has nothing left to
    // label it, so the reference is the label — the one case a picker is handed
    // a reference where it offered a name. **The Document pane's own walk pinned
    // it a second time until item 17 removed that panel**.
    const deleted = {
      gone: { value: { kind: "solid", color: "#101010" } },
    } as unknown as FabricPalette;
    expect(paletteTokenOptions(deleted)).toEqual([
      { id: "palette.gone", name: "palette.gone" },
    ]);
  });

  it("offers nothing when the document declares no palette", () => {
    expect(paletteTokenOptions(undefined)).toEqual([]);
  });
});
