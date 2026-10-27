import type { TextRun } from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import { scaledRuns } from "./scale-runs.js";

const BOARD = 1080;

function literal(
  size: number | undefined,
  typeToken?: `typeTokens.${string}`,
): TextRun {
  return {
    kind: "literal",
    text: "CPU",
    ...(typeToken === undefined ? {} : { typeToken }),
    ...(size === undefined ? {} : { style: { fontSize: { value: size } } }),
  };
}

describe("scaledRuns", () => {
  it("multiplies a run's own size by the scale, rounded", () => {
    const [run] = scaledRuns([literal(46)], 1.5, BOARD);

    expect(run?.style?.["fontSize"]).toEqual({ value: 69 });
  });

  it("takes the role default when the run authors no size", () => {
    const [run] = scaledRuns([literal(undefined, "typeTokens.body")], 2, BOARD);

    // The body ratio is 1/67.5 of the board: 16 at 1080.
    expect(run?.style?.["fontSize"]).toEqual({ value: 32 });
  });

  it("scales a heading run from its own ratio", () => {
    const [run] = scaledRuns(
      [literal(undefined, "typeTokens.heading")],
      1.5,
      BOARD,
    );

    expect(run?.style?.["fontSize"]).toEqual({ value: 108 });
  });

  it("keeps every other run field and style key", () => {
    const run: TextRun = {
      kind: "literal",
      text: "CPU",
      typeToken: "typeTokens.mono",
      style: { color: { ref: "palette.accent" }, lineHeight: { value: 1.2 } },
    };

    const [scaled] = scaledRuns([run], 2, BOARD);

    expect(scaled).toEqual({
      ...run,
      style: {
        color: { ref: "palette.accent" },
        lineHeight: { value: 1.2 },
        fontSize: { value: 28 },
      },
    });
    // The authored keys keep their order and the new one lands last.
    expect(Object.keys(scaled?.style ?? {})).toEqual([
      "color",
      "lineHeight",
      "fontSize",
    ]);
  });

  it.each([
    ["one", 1],
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("returns the input for a scale of %s", (_label, scaleY) => {
    const runs = [literal(46)];

    expect(scaledRuns(runs, scaleY, BOARD)).toBe(runs);
  });
});
