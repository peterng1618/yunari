import type { TextRun } from "@yunari/renderer-core";
import { YUNARI_TEXT_PROPERTY } from "@yunari/scene-fabric";
import { describe, expect, it } from "vitest";
import type { RunTarget } from "./run-edits.js";
import { writeRunStyle } from "./run-edits.js";

/**
 * A run's own size, leading and tracking are style writes, and the boundary is
 * the rule that holds whichever control sent the draft: a finite value at least
 * 1 is rounded and written, `undefined` removes the key, and anything else is
 * refused without touching the object.
 */

const PLAIN: TextRun = {
  kind: "literal",
  text: "Hi",
  typeToken: "typeTokens.body",
  style: { color: { ref: "palette.ink" } },
};

/** The smallest object a run write needs — `ObjectWithText`'s two accesses. */
function targetWith(run: TextRun): {
  readonly target: RunTarget;
  readonly written: () => readonly TextRun[];
} {
  let content: Record<string, unknown> = { runs: [run] };
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
      bindings: () => [],
      setBindings: () => {},
    },
    written: () => content["runs"] as readonly TextRun[],
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

  it("rounds a finite value at least 1", () => {
    const { target, written } = targetWith(PLAIN);
    expect(writeRunStyle(target, 0, "fontSize", 46.6)).toBe(true);
    expect(styleValue(written(), "fontSize")).toBe(47);
  });

  it("removes the key when cleared", () => {
    const { target, written } = targetWith(PLAIN);
    writeRunStyle(target, 0, "fontSize", 40);
    expect(writeRunStyle(target, 0, "fontSize", undefined)).toBe(true);
    expect(written()[0]?.style?.["fontSize"]).toBeUndefined();
  });

  it("refuses zero, negative, NaN and Infinity without writing", () => {
    const { target, written } = targetWith(PLAIN);
    for (const value of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(writeRunStyle(target, 0, "fontSize", value)).toBe(false);
      expect(styleValue(written(), "fontSize")).toBeUndefined();
    }
  });
});
