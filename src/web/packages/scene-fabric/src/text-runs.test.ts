import type { PlanTextSegment, ResolvedStyle } from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import { textShapeFor } from "./text-runs.js";

/**
 * §89's runs as per-character styles.
 *
 * The indices are the whole risk: they are what Fabric looks a style up by, and
 * an off-by-one shifts every run after the first — a label that takes the
 * value's colour, which reads as a theme bug.
 */

/** Code points, which is what Fabric's grapheme splitter agrees with here. */
const splitGraphemes = (value: string): readonly string[] => [...value];

function segment(text: string, style: ResolvedStyle = {}): PlanTextSegment {
  return { text, style };
}

describe("one run", () => {
  it("needs no per-character styles at all", () => {
    // The object's own paint covers it, so writing a style map would be a
    // second copy of the same fact.
    const shape = textShapeFor(
      [segment("42 °C", { fill: "#fff" })],
      { fill: "#fff" },
      splitGraphemes,
    );

    expect(shape.text).toBe("42 °C");
    expect(shape.styles).toEqual({});
    expect(shape.unsupported).toEqual([]);
  });
});

describe("several runs", () => {
  it("concatenates the text and styles each run’s own characters", () => {
    const shape = textShapeFor(
      [
        segment("CPU ", { fill: "#888" }),
        segment("42", { fill: "#fff", fontSize: 32 }),
      ],
      { fill: "#888" },
      splitGraphemes,
    );

    expect(shape.text).toBe("CPU 42");

    // Four characters of label, then two of value. The boundary is the
    // assertion: index 3 is still the label and index 4 is the value.
    expect(shape.styles[0]?.[3]).toMatchObject({ fill: "#888" });
    expect(shape.styles[0]?.[4]).toMatchObject({ fill: "#fff", fontSize: 32 });
    expect(shape.styles[0]?.[5]).toMatchObject({ fill: "#fff" });
    expect(shape.styles[0]?.[6]).toBeUndefined();
  });

  it("carries only what the run authored, so inherited colour survives", () => {
    // The defect this exists for, and it was invisible to every other test
    // here because they all gave each run an explicit fill. A per-character
    // entry *overrides* the object, so a default in one replaces the node's
    // colour with nothing — and the run renders invisible under a green suite.
    // Found by putting a screenshot of this path next to the DOM path's.
    const shape = textShapeFor(
      [
        segment("Yunari", { fontWeight: 700 }),
        segment(" dashboard", { fill: "#888" }),
      ],
      { fill: "#ffffff" },
      splitGraphemes,
    );

    expect(shape.styles[0]?.[0]).toEqual({ fontWeight: 700 });
    expect(shape.styles[0]?.[0]).not.toHaveProperty("fill");
    // The run that *did* author a colour still gets it.
    expect(shape.styles[0]?.[7]).toMatchObject({ fill: "#888" });
  });

  it("restarts the index on a newline, because Fabric’s lines do", () => {
    // Fabric keys styles by line and then by index *within that line*. Carrying
    // a running total across a newline would style the wrong characters from
    // the second line onwards, in a way that only shows on multi-line text.
    const shape = textShapeFor(
      [segment("a\nbc", { fill: "#111" }), segment("d", { fill: "#222" })],
      {},
      splitGraphemes,
    );

    expect(shape.styles[0]?.[0]).toMatchObject({ fill: "#111" });
    expect(shape.styles[1]?.[0]).toMatchObject({ fill: "#111" });
    expect(shape.styles[1]?.[1]).toMatchObject({ fill: "#111" });
    // 'd' continues line 1 at index 2 — it follows 'bc' rather than starting
    // a line of its own.
    expect(shape.styles[1]?.[2]).toMatchObject({ fill: "#222" });
  });

  it("counts graphemes through the injected splitter, not string length", () => {
    // '👍' is two UTF-16 code units and one grapheme. Using `.length` would
    // leave every style after it one index too far along. The splitter is
    // injected precisely so this file can prove it is used.
    const shape = textShapeFor(
      [segment("👍", { fill: "#111" }), segment("x", { fill: "#222" })],
      {},
      splitGraphemes,
    );

    expect(shape.styles[0]?.[0]).toMatchObject({ fill: "#111" });
    expect(shape.styles[0]?.[1]).toMatchObject({ fill: "#222" });
  });

  it("maps colour to Fabric’s fill, with `color` winning", () => {
    const shape = textShapeFor(
      [segment("a", { color: "#abc", fill: "#def" }), segment("b")],
      {},
      splitGraphemes,
    );

    expect(shape.styles[0]?.[0]).toMatchObject({ fill: "#abc" });
  });
});

describe("vertical layout", () => {
  it("stands each grapheme on its own line, upright", () => {
    const shape = textShapeFor(
      [segment("A1", { fill: "#fff" })],
      { fill: "#fff" },
      splitGraphemes,
      true,
    );

    expect(shape.text).toBe("A\n1");
    // Nothing was authored on the run beyond the object's own paint, so the
    // object still paints it and no per-character map is needed.
    expect(shape.styles).toEqual({});
  });

  it("never lets two runs share a line", () => {
    // A run is a chunk of reading, and in this mode a chunk ends its line, so
    // the value starts below the label rather than beside its last character.
    const shape = textShapeFor(
      [segment("CPU ", { fill: "#888" }), segment("42", { fill: "#fff" })],
      { fill: "#888" },
      splitGraphemes,
      true,
    );

    expect(shape.text).toBe("C\nP\nU\n \n4\n2");
    expect(shape.styles[3]?.[0]).toMatchObject({ fill: "#888" });
    expect(shape.styles[4]?.[0]).toMatchObject({ fill: "#fff" });
  });

  it("drops authored line breaks, because the break is implicit here", () => {
    const shape = textShapeFor([segment("a\r\nb")], {}, splitGraphemes, true);

    expect(shape.text).toBe("a\nb");
  });
});

describe("what a run cannot carry", () => {
  it("reports an object-level property that differs per run", () => {
    // Fabric's per-character keys are fill, stroke, strokeWidth, the font
    // properties, the decorations and `deltaY`. Opacity and shadow are
    // object-level, so a run asking for its own is a §85 gap — reported, not
    // silently dropped.
    const shape = textShapeFor(
      [segment("a", { opacity: 0.5 }), segment("b", { shadowColor: "#000" })],
      { opacity: 1 },
      splitGraphemes,
    );

    expect(shape.unsupported).toContain("opacity");
    expect(shape.unsupported).toContain("shadowColor");
  });

  it("says nothing when the run agrees with the object", () => {
    // A run repeating the node's own opacity is expressible — the object
    // carries it. Reporting that would train the reader to ignore the warnings.
    const shape = textShapeFor(
      [segment("a", { opacity: 0.5 }), segment("b", { opacity: 0.5 })],
      { opacity: 0.5 },
      splitGraphemes,
    );

    expect(shape.unsupported).toEqual([]);
  });

  it("reports each property once however many runs ask for it", () => {
    const shape = textShapeFor(
      [
        segment("a", { letterSpacing: 2 }),
        segment("b", { letterSpacing: 3 }),
        segment("c", { letterSpacing: 4 }),
      ],
      {},
      splitGraphemes,
    );

    expect(shape.unsupported).toEqual(["letterSpacing"]);
  });
});
