import { describe, expect, it } from "vitest";
import { weightChoices } from "./weight-choices.js";

/** One family, every subset declared: two 400s (latin, vietnamese), a 700 and a
 *  700 italic. Declaration order is deliberately not the wanted order. */
const MANROPE = [
  { assetId: "manrope-vietnamese-400", weight: 400, style: "normal" },
  { assetId: "manrope-latin-700", weight: 700, style: "normal" },
  { assetId: "manrope-latin-400", weight: 400, style: "normal" },
  { assetId: "manrope-latin-700-italic", weight: 700, style: "italic" },
] as const;

const listing = (
  choices: readonly { weight: string | number; style: string }[],
) =>
  choices.map((face) =>
    face.style === "italic" ? `${face.weight} italic` : String(face.weight),
  );

describe("weightChoices", () => {
  it("offers one entry per weight and style, lightest first", () => {
    const choices = weightChoices(MANROPE);

    expect(listing(choices)).toEqual(["400", "700", "700 italic"]);
    // The two 400 subsets collapse to the lexicographically first asset id,
    // which is the latin file even though the vietnamese one is declared first.
    expect(choices.find((face) => face.weight === 400)?.assetId).toBe(
      "manrope-latin-400",
    );
  });

  it("orders by weight regardless of declaration order", () => {
    const reversed = weightChoices([...MANROPE].reverse());

    expect(listing(reversed)).toEqual(["400", "700", "700 italic"]);
    expect(reversed.map((face) => face.assetId)).toEqual(
      weightChoices(MANROPE).map((face) => face.assetId),
    );
  });
});
