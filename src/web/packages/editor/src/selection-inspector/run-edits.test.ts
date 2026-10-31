import type { Binding, TextRun } from "@yunari/renderer-core";
import { YUNARI_TEXT_PROPERTY } from "@yunari/scene-fabric";
import { describe, expect, it } from "vitest";
import type { RunTarget } from "./run-edits.js";
import { insertReading, writeRunStyle } from "./run-edits.js";

/**
 * A run's own size, leading and tracking are style writes, and the boundary is
 * the rule that holds whichever control sent the draft. The three keys are not
 * one rule: a size is a positive whole unit, a leading is a positive decimal
 * multiplier, and tracking is any finite number — negative tightens.
 */

const PLAIN: TextRun = {
  kind: "literal",
  text: "Hi",
  typeToken: "typeTokens.body",
  style: { color: { ref: "palette.ink" } },
};

/** The smallest object a run write needs — `ObjectWithText`'s two accesses. */
function targetWith(run: TextRun | readonly TextRun[]): {
  readonly target: RunTarget;
  readonly written: () => readonly TextRun[];
  readonly bindings: () => readonly Binding[];
} {
  let content: Record<string, unknown> = {
    runs: Array.isArray(run) ? run : [run],
  };
  let bindings: readonly Binding[] = [];
  const object = {
    get: (name: string) =>
      name === YUNARI_TEXT_PROPERTY ? content : undefined,
    set: (name: string, value: unknown) => {
      if (name === YUNARI_TEXT_PROPERTY) {
        content = value as Record<string, unknown>;
      }
    },
  };
  return {
    target: {
      object,
      nodeId: "clock-label",
      bindings: () => bindings,
      setBindings: (next) => {
        bindings = next;
      },
    },
    written: () => content["runs"] as readonly TextRun[],
    bindings: () => bindings,
  };
}

/** The authored literal value under one style key, or undefined. */
function styleValue(
  runs: readonly TextRun[],
  key: "fontSize" | "lineHeight" | "letterSpacing",
): unknown {
  const style = runs[0]?.style?.[key];
  return style !== undefined && "value" in style ? style.value : undefined;
}

describe("writing a run's own style", () => {
  it("writes a size, a leading and a tracking value", () => {
    for (const key of ["fontSize", "lineHeight", "letterSpacing"] as const) {
      const { target, written } = targetWith(PLAIN);
      expect(writeRunStyle(target, 0, key, 40)).toBe(true);
      expect(styleValue(written(), key)).toBe(40);
      // The rest of the style is kept: size does not drop a colour.
      expect(written()[0]?.style?.["color"]).toEqual({ ref: "palette.ink" });
    }
  });

  it("rounds a size to a whole unit and a leading to two decimals", () => {
    const size = targetWith(PLAIN);
    expect(writeRunStyle(size.target, 0, "fontSize", 46.6)).toBe(true);
    expect(styleValue(size.written(), "fontSize")).toBe(47);

    // 1.18 is the starter theme's own leading: flooring it at 1 would collapse
    // the leading the author chose, and rounding to an integer would too.
    const leading = targetWith(PLAIN);
    expect(writeRunStyle(leading.target, 0, "lineHeight", 1.18)).toBe(true);
    expect(styleValue(leading.written(), "lineHeight")).toBe(1.18);
  });

  it("refuses a leading that would round to zero, and keeps the smallest it can", () => {
    const tiny = targetWith(PLAIN);
    // 0.004 passes "> 0" and rounds to 0 — a multiplier that collapses the
    // lines — so the rounded value is what must pass the bound.
    expect(writeRunStyle(tiny.target, 0, "lineHeight", 0.004)).toBe(false);
    expect(styleValue(tiny.written(), "lineHeight")).toBeUndefined();

    const edge = targetWith(PLAIN);
    expect(writeRunStyle(edge.target, 0, "lineHeight", 0.01)).toBe(true);
    expect(styleValue(edge.written(), "lineHeight")).toBe(0.01);
  });

  it("keeps tracking negative, rounded to two decimals", () => {
    const { target, written } = targetWith(PLAIN);
    expect(writeRunStyle(target, 0, "letterSpacing", -0.555)).toBe(true);
    expect(styleValue(written(), "letterSpacing")).toBe(-0.56);
  });

  it("removes the key when cleared", () => {
    const { target, written } = targetWith(PLAIN);
    writeRunStyle(target, 0, "fontSize", 40);
    expect(writeRunStyle(target, 0, "fontSize", undefined)).toBe(true);
    expect(written()[0]?.style?.["fontSize"]).toBeUndefined();
  });

  it("refuses a size below 1, a leading at or below 0, and any non-finite value", () => {
    const refusals: readonly (readonly [
      "fontSize" | "lineHeight" | "letterSpacing",
      number,
    ])[] = [
      ["fontSize", 0],
      ["fontSize", -5],
      ["fontSize", Number.NaN],
      ["fontSize", Number.POSITIVE_INFINITY],
      ["lineHeight", 0],
      ["lineHeight", -1],
      ["lineHeight", Number.NaN],
      ["lineHeight", Number.POSITIVE_INFINITY],
      ["letterSpacing", Number.NaN],
      ["letterSpacing", Number.NEGATIVE_INFINITY],
    ];
    for (const [key, value] of refusals) {
      const { target, written } = targetWith(PLAIN);
      expect(writeRunStyle(target, 0, key, value), `${key} ${value}`).toBe(
        false,
      );
      expect(styleValue(written(), key)).toBeUndefined();
    }
  });

  it("answers no change when clearing a key the run never authored", () => {
    const { target, written } = targetWith(PLAIN);
    expect(writeRunStyle(target, 0, "fontSize", undefined)).toBe(false);
    // No write at all: the run object is the one the object already held, so a
    // history entry and a repaint are not spent on it.
    expect(written()[0]).toBe(PLAIN);
  });
});

describe("inserting a reading inline", () => {
  it("splits the typed text around a value run and binds it", () => {
    const { target, written, bindings } = targetWith(PLAIN);

    expect(
      insertReading(target, {
        text: "Hi @ram x",
        start: 3,
        end: 7,
        semanticKey: "ram.used.percent",
      }),
    ).toBe(true);

    const runs = written();
    expect(runs.map((run) => run.kind)).toEqual([
      "literal",
      "value",
      "literal",
    ]);
    expect(runs[0]).toMatchObject({ text: "Hi " });
    expect(runs[2]).toMatchObject({ text: " x" });
    // The reading takes the prose's look, on every split piece.
    for (const run of runs) {
      expect(run.typeToken).toBe("typeTokens.body");
      expect(run.style).toEqual({ color: { ref: "palette.ink" } });
    }

    const built = bindings();
    expect(built).toHaveLength(1);
    expect(built[0]?.semanticKey).toBe("ram.used.percent");
    expect(built[0]?.id).toMatch(/^binding-/);
    expect(runs[1]).toMatchObject({ kind: "value", bindingId: built[0]?.id });
  });

  it("leaves no empty literal when the range is the whole text", () => {
    const { target, written } = targetWith(PLAIN);

    expect(
      insertReading(target, {
        text: "@ram",
        start: 0,
        end: 4,
        semanticKey: "ram.used.percent",
      }),
    ).toBe(true);

    expect(written().map((run) => run.kind)).toEqual(["value"]);
  });

  it("refuses content a split cannot map, and writes nothing", () => {
    const multi = targetWith([PLAIN, PLAIN]);
    expect(
      insertReading(multi.target, {
        text: "@ram",
        start: 0,
        end: 4,
        semanticKey: "ram.used.percent",
      }),
    ).toBe(false);
    expect(multi.written()).toHaveLength(2);
    expect(multi.bindings()).toEqual([]);

    const valued = targetWith({
      kind: "value",
      bindingId: "load",
      typeToken: "typeTokens.body",
    });
    expect(
      insertReading(valued.target, {
        text: "@ram",
        start: 0,
        end: 4,
        semanticKey: "ram.used.percent",
      }),
    ).toBe(false);
  });

  it("refuses a range outside the text and an empty key", () => {
    for (const range of [
      { text: "@ram", start: 0, end: 9 },
      { text: "@ram", start: 3, end: 1 },
      { text: "@ram", start: 0.5, end: 4 },
      { text: "@ram", start: 0, end: 4, semanticKey: "" },
    ]) {
      const { target, written } = targetWith(PLAIN);
      expect(
        insertReading(target, {
          semanticKey: "ram.used.percent",
          ...range,
        }),
        JSON.stringify(range),
      ).toBe(false);
      expect(written()[0]).toBe(PLAIN);
    }
  });
});
