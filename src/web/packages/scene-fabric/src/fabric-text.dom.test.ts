// @vitest-environment jsdom

import type {
  PlanBox,
  PlanNode,
  PlanTextLayout,
  PlanTextSegment,
  TextContent,
} from "@yunari/renderer-core";
import { Canvas, IText, Rect, Textbox } from "fabric/es";
import { describe, expect, it, vi } from "vitest";
import {
  applyAuthoredText,
  authoredAlignment,
  buildText,
  refreshBoundText,
  textGaps,
  YUNARI_TEXT_PROPERTY,
} from "./fabric-text.js";

/**
 * Text overflow, measured rather than asserted structurally.
 *
 * These need real glyph metrics: an ellipsis decision is "does this string fit
 * in this many pixels", and jsdom alone answers 0 for every width. The `canvas`
 * package supplies a genuine 2D context, which is what makes
 * `initDimensions()` mean anything here — and is why this file is `.dom` and
 * the arithmetic-only tests are not.
 *
 * **What is asserted is the property, not the string.** "Truncated to exactly
 * eleven characters" would pin this repo's font stack and its rasteriser, and
 * would fail on a machine with different metrics for a reason that has nothing
 * to do with the code. So: it ends with an ellipsis, it is shorter than the
 * original, and it measures inside the box — three things that are true of a
 * correct implementation on any font.
 */

const LONG =
  "A very long readout label that will not fit inside a narrow box at all";

function box(overrides: Partial<PlanBox> = {}): PlanBox {
  return {
    x: 0,
    y: 0,
    width: 200,
    height: 40,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    ...overrides,
  };
}

function textNode(
  segments: readonly PlanTextSegment[],
  layout: Partial<PlanTextLayout> = {},
  style: PlanNode["style"] = {},
): PlanNode {
  return {
    id: "label",
    box: box(),
    visible: true,
    style,
    children: [],
    content: {
      kind: "text",
      segments,
      layout: {
        wrap: false,
        overflow: "visible",
        align: "left",
        verticalAlign: "top",
        ...layout,
      },
    },
  } as unknown as PlanNode;
}

function segment(
  text: string,
  style: PlanTextSegment["style"] = {},
): PlanTextSegment {
  return { text, style };
}

describe("the Fabric class is the width mode", () => {
  it("keeps a Textbox wrapping when its authored content still carries wrap: false", async () => {
    // The legacy shape, kept as a raw object on purpose: `TextContent` no longer
    // has the key, and a document that still carries it must render as the
    // class says, not as the dead flag says.
    const object = new Textbox(LONG, { width: 120, fontSize: 32 });
    object.set("id", "label");
    object.set(YUNARI_TEXT_PROPERTY, {
      wrap: false,
      runs: [{ kind: "literal", text: LONG }],
    } as unknown as TextContent);
    const canvas = new Canvas(document.createElement("canvas"));
    canvas.add(object);

    applyAuthoredText(canvas, undefined, { bindings: {} });

    expect(
      authoredAlignment(object, {
        wrap: false,
        runs: [{ kind: "literal", text: LONG }],
      } as unknown as TextContent).wrap,
    ).toBe(true);
    expect(object.textLines.length).toBeGreaterThan(1);
    await canvas.dispose();
  });

  it("derives an IText as unwrapped and visible, ignoring the old authored values", () => {
    // The same legacy keys on the other class: a box control written before the
    // split must not survive on an auto text.
    const object = new IText("short");

    expect(
      authoredAlignment(object, {
        wrap: false,
        overflow: "clip",
        verticalAlign: "bottom",
        align: "right",
        runs: [{ kind: "literal", text: "short" }],
      } as unknown as TextContent),
    ).toEqual({
      wrap: false,
      overflow: "visible",
      align: "right",
      verticalAlign: "top",
    });
  });

  it("derives a Textbox as wrapped, with the authored overflow and alignment", () => {
    const object = new Textbox("short", { width: 120 });

    expect(
      authoredAlignment(object, {
        wrap: false,
        overflow: "ellipsis",
        verticalAlign: "middle",
        runs: [{ kind: "literal", text: "short" }],
      } as unknown as TextContent),
    ).toEqual({
      wrap: true,
      overflow: "ellipsis",
      align: "left",
      verticalAlign: "middle",
    });
  });

  it("builds IText for an auto text and Textbox for a fixed one", () => {
    const auto = buildText(textNode([segment("short")]), box());
    const fixed = buildText(
      textNode([segment("short")], { wrap: true, overflow: "clip" }),
      box(),
    );

    expect(auto).toBeInstanceOf(IText);
    expect(auto).not.toBeInstanceOf(Textbox);
    expect(fixed).toBeInstanceOf(Textbox);
  });
});

describe("clipping", () => {
  it("clips to the authored box for every mode but visible", () => {
    // Both non-visible modes clip, which is what the DOM path does on the outer
    // box — `overflow !== 'visible'` → hidden. Ellipsis is not an alternative
    // to clipping there and is not here either.
    for (const overflow of ["clip", "ellipsis"] as const) {
      const node = textNode([segment("short")], { overflow });
      const object = buildText(
        node,
        box({ x: 10, y: 20, width: 200, height: 40 }),
      );
      const clip = object.clipPath;

      expect(clip, overflow).toBeInstanceOf(Rect);
      expect(clip?.width, overflow).toBe(200);
      expect(clip?.height, overflow).toBe(40);
    }
  });

  it("places the clip on the box, not on the text, when alignment moves the object", () => {
    // The offset exists because left-aligned text is centred on its own glyphs
    // rather than on the box. Asserted through Fabric's own matrix rather than
    // by recomputing the arithmetic the code under test just did.
    const node = textNode([segment("short")], {
      overflow: "clip",
      align: "left",
    });
    const authored = box({ x: 10, y: 20, width: 200, height: 40 });
    const object = buildText(node, authored);
    const clip = object.clipPath;

    expect(clip).toBeDefined();
    // Clip centre, expressed back in the parent's space.
    expect(object.left + (clip?.left ?? 0)).toBeCloseTo(
      authored.x + authored.width / 2,
      6,
    );
    expect(object.top + (clip?.top ?? 0)).toBeCloseTo(
      authored.y + authored.height / 2,
      6,
    );
  });

  it("leaves visible text unclipped", () => {
    const object = buildText(
      textNode([segment("short")], { overflow: "visible" }),
      box(),
    );

    expect(object.clipPath).toBeUndefined();
  });
});

describe("ellipsis on a single line", () => {
  it("truncates text too wide for its box and marks it", () => {
    const narrow = box({ width: 120 });
    const object = buildText(
      textNode([segment(LONG)], { overflow: "ellipsis" }),
      narrow,
    );

    expect(object.text.length).toBeLessThan(LONG.length);
    expect(object.text.endsWith("…")).toBe(true);
    expect(object.width).toBeLessThanOrEqual(narrow.width);
  });

  it("leaves text that already fits completely alone", () => {
    // The counter-case, and the one that makes the test above mean something:
    // an implementation that always ellipsised would pass that and fail this.
    const object = buildText(
      textNode([segment("ok")], { overflow: "ellipsis" }),
      box(),
    );

    expect(object.text).toBe("ok");
    expect(object.text).not.toContain("…");
  });

  it("overflows rather than truncating when overflow is visible", () => {
    const narrow = box({ width: 120 });
    const object = buildText(
      textNode([segment(LONG)], { overflow: "visible" }),
      narrow,
    );

    expect(object.text).toBe(LONG);
    expect(object.width).toBeGreaterThan(narrow.width);
  });

  it("shows a clipped ellipsis rather than the whole string in an unusably narrow box", () => {
    // Bisection bottoms out at zero graphemes, which is the ellipsis alone. The
    // clip then keeps even that inside the box. Showing the full string would
    // paint it across whatever is next to it.
    const object = buildText(
      textNode([segment(LONG)], { overflow: "ellipsis" }),
      box({ width: 4 }),
    );

    expect(object.text).toBe("…");
  });
});

describe("the line clamp on wrapped text", () => {
  it("keeps wrapped text within the lines the plan computed", () => {
    const node = textNode([segment(LONG)], {
      wrap: true,
      overflow: "ellipsis",
      maxLines: 2,
    });
    const object = buildText(node, box({ width: 120, height: 40 }));

    expect(object).toBeInstanceOf(Textbox);
    expect(object.textLines.length).toBeLessThanOrEqual(2);
    expect(object.text.endsWith("…")).toBe(true);
  });

  it("does not clamp when the text already fits in the allowed lines", () => {
    const node = textNode([segment("ok")], {
      wrap: true,
      overflow: "ellipsis",
      maxLines: 4,
    });
    const object = buildText(node, box({ width: 200, height: 80 }));

    expect(object.text).toBe("ok");
  });

  it("reports a gap instead of guessing when the plan could not compute a clamp", () => {
    // `maxLines` is absent only when the type size did not resolve. Clamping on
    // a guessed line height hides text that would have fitted, so this is the
    // one overflow case still declared unsupported (§85).
    const node = textNode([segment(LONG)], {
      wrap: true,
      overflow: "ellipsis",
    });
    const object = buildText(node, box({ width: 120, height: 40 }));

    expect(textGaps(node)).toHaveLength(1);
    expect(textGaps(node)[0]).toContain("font size");
    // Still clipped, so it cannot paint over its neighbours while unsupported.
    expect(object.clipPath).toBeInstanceOf(Rect);
  });

  it("reports nothing once the clamp is computable", () => {
    const node = textNode([segment(LONG)], {
      wrap: true,
      overflow: "ellipsis",
      maxLines: 2,
    });

    expect(textGaps(node)).toEqual([]);
  });
});

describe("truncation and per-run styles", () => {
  it("keeps each surviving run styled as authored", () => {
    // The reason truncation cuts *segments* and rebuilds the shape rather than
    // slicing the concatenated string: `text-runs.ts` owns the grapheme-index
    // mapping, and a second implementation of it would disagree the first time
    // a cut landed inside a run. Here the cut lands inside the second run.
    const node = textNode(
      [segment("AAAA", { color: "#f00" }), segment(LONG, { color: "#0f0" })],
      { overflow: "ellipsis" },
      { color: "#fff" },
    );
    const object = buildText(node, box({ width: 400 }));
    const styles = object.styles as Record<
      number,
      Record<number, Record<string, unknown>>
    >;

    expect(object.text.startsWith("AAAA")).toBe(true);
    expect(object.text.endsWith("…")).toBe(true);
    expect(object.text.length).toBeLessThan(4 + LONG.length);

    // First run's graphemes keep the first run's colour...
    expect(styles[0]?.[0]?.["fill"]).toBe("#f00");
    expect(styles[0]?.[3]?.["fill"]).toBe("#f00");
    // ...and every surviving grapheme after them keeps the second run's, the
    // ellipsis included, with no entry left pointing past the end.
    for (let index = 4; index < object.text.length; index += 1) {
      expect(styles[0]?.[index]?.["fill"], `grapheme ${index}`).toBe("#0f0");
    }

    expect(Object.keys(styles[0] ?? {})).toHaveLength(object.text.length);
  });
});

describe("a layout change an author makes", () => {
  it("replaces the placement the cached runtime layout carries", async () => {
    // The editor's alignment controls work by rewriting the authored content and
    // calling `applyAuthoredText`, which is what puts the authored layout back on
    // the object. `runtimeLayout` returns the layout cached on the object at
    // construction, so a control that writes a *new* value into the authored
    // content has that value discarded and the object placed by the old one:
    // the control shows the author's choice and the canvas does not move.
    // Horizontal alignment is re-applied through `textAlign` below, which is why
    // only the axis `placeInBox` reads — vertical — was dead.
    const authored = box({ x: 0, y: 0, width: 200, height: 100 });
    const object = buildText(
      textNode([segment("short")], { wrap: true, overflow: "clip" }),
      authored,
    );
    object.set("id", "label");
    object.set(YUNARI_TEXT_PROPERTY, {
      runs: [{ kind: "literal", text: "short" }],
      verticalAlign: "top",
    });
    const canvas = new Canvas(document.createElement("canvas"));
    canvas.add(object);

    const top = object.top;

    object.set(YUNARI_TEXT_PROPERTY, {
      runs: [{ kind: "literal", text: "short" }],
      verticalAlign: "bottom",
    });
    applyAuthoredText(canvas, undefined, { bindings: {} });

    // The box is 100 tall and the text one line, so `bottom` has to move it.
    expect(object.top).toBeGreaterThan(top);
    await canvas.dispose();
  });
});

describe("what one text pass costs", () => {
  /**
   * Counts re-measures for the body of `body`, leaving the prototype alone.
   *
   * `Text.set` re-enters `initDimensions` itself for every `textLayoutProperties`
   * key (`fabric/dist/index.mjs:16279-16296`, list at `:4131`) — `text`,
   * `styles` and `textAlign` are all in it. So a pass that writes those and then
   * calls `initDimensions` again measures the same object twice, in the same
   * pass, with nothing changed in between. This is the count that decides it: a
   * percentage of a frame is not measurable on a machine of any given speed, and
   * this is.
   */
  function measures(body: () => void): number {
    const base = Textbox.prototype.initDimensions;
    let count = 0;
    Textbox.prototype.initDimensions = function (this: Textbox) {
      count += 1;
      base.call(this);
    };
    try {
      body();
    } finally {
      Textbox.prototype.initDimensions = base;
    }
    return count;
  }

  function stage(): { canvas: Canvas; object: Textbox } {
    // Wrapped, because that is what the Starter's text objects are and it is
    // the shape `initDimensions` re-measures most: it re-derives the line
    // capacity and the dynamic minimum width on every call.
    const object = buildText(
      textNode([segment("CPU 48%")], { wrap: true, overflow: "clip" }),
      box(),
    ) as Textbox;
    object.set("id", "label");
    object.set(YUNARI_TEXT_PROPERTY, {
      runs: [{ kind: "literal", text: "CPU 48%" }],
      align: "left",
    });
    const canvas = new Canvas(document.createElement("canvas"));
    canvas.add(object);
    return { canvas, object };
  }

  it("measures a bound object once in the authored pass, not twice", async () => {
    const { canvas, object } = stage();

    expect(
      measures(() => applyAuthoredText(canvas, undefined, { bindings: {} })),
    ).toBe(1);
    // The pass still did its job; the measure is not skipped to reach one.
    expect(object.width).toBeGreaterThan(0);
    await canvas.dispose();
  });

  /** A readout whose value run is bound to `cpu.load`. */
  function readout(): {
    canvas: Canvas;
    object: Textbox;
    bindings: { label: { id: string; semanticKey: string }[] };
    source: (value: number) => Parameters<typeof refreshBoundText>[2];
  } {
    const { canvas, object } = stage();
    object.set(YUNARI_TEXT_PROPERTY, {
      runs: [
        { kind: "literal", text: "CPU " },
        { kind: "value", bindingId: "load" },
      ],
      align: "left",
    });
    return {
      canvas,
      object,
      bindings: { label: [{ id: "load", semanticKey: "cpu.load" }] },
      source: (value) => ({
        revision: 0,
        latest: () => ({
          sensorId: "cpu.load",
          timestamp: "",
          status: "ok" as const,
          value,
        }),
        history: () => [],
      }),
    };
  }

  it("measures a bound object once in the sample pass, not twice", async () => {
    const { canvas, object, bindings, source } = readout();

    expect(
      measures(() => refreshBoundText(canvas, bindings, source(62), undefined)),
    ).toBe(1);
    expect(object.text).toBe("CPU 62");
    expect(object.width).toBeGreaterThan(0);
    await canvas.dispose();
  });

  it("does not repaint a reading whose text did not change", async () => {
    const { canvas, object, bindings, source } = readout();
    refreshBoundText(canvas, bindings, source(48), undefined);
    const render = vi.spyOn(canvas, "requestRenderAll");

    // A minutes clock is sampled every second; only its own string decides
    // whether it is painted again.
    const count = measures(() =>
      refreshBoundText(canvas, bindings, source(48), undefined),
    );

    expect(count, "an unchanged reading was re-measured").toBe(0);
    expect(render, "an unchanged reading repainted").not.toHaveBeenCalled();
    expect(object.text).toBe("CPU 48");
    await canvas.dispose();
  });

  it("repaints when the reading changes", async () => {
    const { canvas, object, bindings, source } = readout();
    refreshBoundText(canvas, bindings, source(48), undefined);
    const render = vi.spyOn(canvas, "requestRenderAll");

    refreshBoundText(canvas, bindings, source(55), undefined);

    expect(object.text).toBe("CPU 55");
    expect(render).toHaveBeenCalled();
    await canvas.dispose();
  });
});
