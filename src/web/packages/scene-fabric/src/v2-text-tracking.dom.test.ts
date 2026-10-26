// @vitest-environment jsdom
import {
  emptySampleSource,
  type FabricGlobals,
  type Globals,
  resolveTextSegments,
} from "@yunari/renderer-core";
import { type FabricObject, StaticCanvas, Textbox } from "fabric/es";
import { describe, expect, it } from "vitest";
import {
  applyAuthoredText,
  refreshBoundText,
  YUNARI_TEXT_PROPERTY,
} from "./fabric-text.js";
import { applyObjectTypeTokens } from "./object-type.js";
import { reviveScene, serialiseScene } from "./persist.js";
import { textShapeFor } from "./text-runs.js";

/**
 * Tracked text through the v2 revival and refresh path.
 *
 * `refreshBoundText` and `applyAuthoredText` rewrite a text object's content
 * from its authored runs, so they are where a runtime change can quietly undo
 * what the preset applied. Objects are measured in real glyph metrics, so what
 * is asserted is a box the text stays inside and an edge it stays against — the
 * properties, not a pixel count a different font stack would change.
 *
 * Unwrapped objects are `FabricText`, whose `width` is the measured run. A
 * `Textbox`'s width is its authored box, which would make a "the reading got
 * wider" assertion vacuous — the failure mode this file exists to avoid.
 */

const NOW = new Date("2026-09-20T00:00:00.000Z");

const BOX = { left: 40, top: 40, width: 200, height: 60 };

function instant(key: string, iso: string) {
  return {
    revision: 0,
    latest: (semanticKey: string) =>
      semanticKey === key
        ? {
            sensorId: key,
            timestamp: NOW.toISOString(),
            status: "ok" as const,
            textValue: iso,
          }
        : undefined,
    history: () => [],
  };
}

function number(key: string, value: number, unit?: string) {
  return {
    revision: 0,
    latest: (semanticKey: string) =>
      semanticKey === key
        ? {
            sensorId: key,
            timestamp: NOW.toISOString(),
            status: "ok" as const,
            value,
            ...(unit === undefined ? {} : { unit }),
          }
        : undefined,
    history: () => [],
  };
}

/**
 * A tracked run, in the shape the v2 path reads it: the token names the face
 * and the run's own style carries the size and the tracking. `FabricGlobals` is
 * the narrower type the text functions take; `applyObjectTypeTokens` accepts it.
 */
const TRACKED_STYLE = {
  fontSize: { value: 32 },
  letterSpacing: { value: 0.8 },
} as const;

function globalsWith(...ids: readonly string[]): FabricGlobals {
  const names = ids.length === 0 ? ["tracked"] : ids;
  return {
    typeTokens: Object.fromEntries(
      names.map((id) => [id, { family: "Inter" }]),
    ) as FabricGlobals["typeTokens"],
  };
}

/** The tracking the fixtures author, on every run. */
function tracked(
  runs: readonly Readonly<Record<string, unknown>>[],
): readonly Readonly<Record<string, unknown>>[] {
  return runs.map((run) => ({
    ...run,
    style: { ...TRACKED_STYLE, ...(run["style"] as object | undefined) },
  }));
}

function canvasOf(objects: readonly FabricObject[]): StaticCanvas {
  const canvas = new StaticCanvas(undefined, { width: 400, height: 300 });
  canvas.add(...objects);
  return canvas;
}

/**
 * A fixed-box reading. The class is the width mode: a `Textbox` wraps inside its
 * authored box, so a runtime reading reflows rather than moving its edges.
 */
function reading(
  id: string,
  runs: readonly Readonly<Record<string, unknown>>[],
  layout: Readonly<Record<string, unknown>> = {},
  box: { left: number; top: number; width: number; height: number } = BOX,
): Textbox {
  const object = new Textbox("—", {
    id,
    left: box.left + box.width / 2,
    top: box.top + box.height / 2,
    width: box.width,
    fontSize: 32,
  });
  object.set(YUNARI_TEXT_PROPERTY, {
    box: { width: box.width, height: box.height },
    ...layout,
    runs: tracked(runs),
  });
  return object;
}

function textbox(
  id: string,
  runs: readonly Readonly<Record<string, unknown>>[],
  layout: Readonly<Record<string, unknown>> = {},
): Textbox {
  const object = new Textbox("—", { id, width: BOX.width, fontSize: 32 });
  object.set(YUNARI_TEXT_PROPERTY, { runs: tracked(runs), ...layout });
  return object;
}

function clipWidthOf(object: { clipPath?: unknown }): number | undefined {
  return (object.clipPath as { width: number } | undefined)?.width;
}

describe("the v2 path applies tracking", () => {
  it("tracks a revived object from its persisted runs", async () => {
    const source = textbox("metric", [
      { kind: "literal", text: "CPU", typeToken: "typeTokens.tracked" },
    ]);
    const canvas = canvasOf([source]);
    applyAuthoredText(canvas, globalsWith(), { bindings: {} });

    const scene = serialiseScene(canvas);
    const revived = new StaticCanvas(undefined, { width: 400, height: 300 });
    await reviveScene(revived, scene);

    // Tracking is a whole-object property, so the editor paints it onto the
    // object and the saved scene is where the display reads it.
    expect((revived.getObjects()[0] as Textbox).charSpacing).toBeCloseTo(25, 6);
  });

  it("keeps tracking through a live content refresh", () => {
    // `refreshBoundText` rewrites text and styles from the runs. If it reset the
    // object's own type, tracking would vanish on the first sample.
    const object = textbox("clock", [
      { kind: "value", bindingId: "t", typeToken: "typeTokens.tracked" },
    ]);
    const canvas = canvasOf([object]);
    const globals = globalsWith();
    applyObjectTypeTokens(canvas, globals);

    refreshBoundText(
      canvas,
      { clock: [{ id: "t", semanticKey: "time.now" }] },
      instant("time.now", "2026-09-20T09:41:00.000Z"),
      globals,
      undefined,
      "en",
    );

    expect(object.text).toBe("09:41");
    expect(object.charSpacing).toBeCloseTo(25, 6);
  });

  it("keeps tracking when the editor repaints authored text", () => {
    const object = textbox("wordmark", [
      { kind: "literal", text: "YUNARI", typeToken: "typeTokens.tracked" },
    ]);
    const canvas = canvasOf([object]);
    const globals = globalsWith();
    applyObjectTypeTokens(canvas, globals);

    applyAuthoredText(canvas, globals, { bindings: {} });

    expect(object.text).toBe("YUNARI");
    expect(object.charSpacing).toBeCloseTo(25, 6);
  });
});

describe("fixed boxes survive a changing reading", () => {
  it("holds a centre-aligned label on its box as the reading widens", () => {
    // The hard case the brief names: a capacity label whose text grows a digit
    // when a value crosses a boundary. Centred means its centre must not move.
    const object = reading(
      "capacity",
      [
        { kind: "literal", text: "MEM ", typeToken: "typeTokens.tracked" },
        { kind: "value", bindingId: "m", typeToken: "typeTokens.tracked" },
      ],
      { align: "center", overflow: "ellipsis" },
    );
    const canvas = canvasOf([object]);
    const globals = globalsWith();
    applyObjectTypeTokens(canvas, globals);
    const bindings = { capacity: [{ id: "m", semanticKey: "ram.used" }] };

    const after = (used: number): { centre: number; width: number } => {
      refreshBoundText(
        canvas,
        bindings,
        number("ram.used", used, "GB"),
        globals,
      );
      return { centre: object.left, width: object.width * object.scaleX };
    };

    const one = after(9);
    const two = after(10);

    // Each assertion is load-bearing: without tracking in effect the type would
    // not be re-measured, and a centre-aligned box would drift when it was.
    expect(object.charSpacing).toBeCloseTo(25, 6);
    // The class decides the width, so a wider reading cannot widen the box.
    expect(two.width).toBe(BOX.width);
    expect(two.centre).toBeCloseTo(one.centre, 6);
    expect(two.centre).toBeCloseTo(BOX.left + BOX.width / 2, 6);
    expect(clipWidthOf(object)).toBe(BOX.width);
  });

  it("keeps a right-aligned reading against its authored right edge", () => {
    const object = reading(
      "reading",
      [{ kind: "value", bindingId: "m", typeToken: "typeTokens.tracked" }],
      { align: "right", overflow: "ellipsis" },
    );
    const canvas = canvasOf([object]);
    const globals = globalsWith();
    applyObjectTypeTokens(canvas, globals);
    const bindings = { reading: [{ id: "m", semanticKey: "ram.used" }] };

    const rightAfter = (used: number): { right: number; width: number } => {
      refreshBoundText(
        canvas,
        bindings,
        number("ram.used", used, "GB"),
        globals,
      );
      const width = object.width * object.scaleX;
      return { right: object.left + width / 2, width };
    };

    const one = rightAfter(9);
    const two = rightAfter(10);

    // The reading really did get tracked and re-measured; a right-aligned box
    // keeps its right edge even as the text inside it changes.
    expect(object.charSpacing).toBeCloseTo(25, 6);
    expect(two.width).toBe(BOX.width);
    expect(two.right).toBeCloseTo(one.right, 6);
    expect(two.right).toBeCloseTo(BOX.left + BOX.width, 6);
  });

  it("ellipsises a tracked reading that outgrows its box instead of spilling", () => {
    const object = reading(
      "reading",
      [{ kind: "value", bindingId: "m", typeToken: "typeTokens.tracked" }],
      { align: "right", overflow: "ellipsis" },
      { ...BOX, width: 90 },
    );
    const canvas = canvasOf([object]);
    const globals = globalsWith();
    applyObjectTypeTokens(canvas, globals);

    refreshBoundText(
      canvas,
      { reading: [{ id: "m", semanticKey: "ram.used" }] },
      number("ram.used", 123456, "GB"),
      globals,
    );

    expect(object.charSpacing).toBeCloseTo(25, 6);
    expect(object.text).toContain("…");
    expect(object.width * object.scaleX).toBeLessThanOrEqual(90);
    expect(clipWidthOf(object)).toBe(90);
  });

  it("keeps a date in its box when the locale changes the month name", () => {
    // Locale-dependent length is the other variable-width case: the string the
    // author previewed in English is not the string the display paints.
    const object = reading(
      "date",
      [{ kind: "value", bindingId: "d", typeToken: "typeTokens.tracked" }],
      { align: "center", overflow: "ellipsis" },
    );
    const canvas = canvasOf([object]);
    const globals = globalsWith();
    applyObjectTypeTokens(canvas, globals);
    const bindings = {
      date: [{ id: "d", semanticKey: "date.today", format: "DD MMMM" }],
    };
    const stamp = "2026-09-20T00:00:00.000Z";
    const inLocale = (locale: string): string => {
      refreshBoundText(
        canvas,
        bindings,
        instant("date.today", stamp),
        globals,
        undefined,
        locale,
      );
      return object.text;
    };

    const english = inLocale("en");
    const french = inLocale("fr");

    expect(object.charSpacing).toBeCloseTo(25, 6);
    expect(french).not.toBe(english);
    // The class holds the width; the locale changes the content inside it.
    expect(object.width * object.scaleX).toBe(BOX.width);
    expect(object.left).toBeCloseTo(BOX.left + BOX.width / 2, 6);
    expect(clipWidthOf(object)).toBe(BOX.width);
  });
});

describe("the mixed-run limit", () => {
  it("shows one run's tracking, and can still tell the runs apart", () => {
    // Two halves of one claim, because they are one behaviour. Fabric's
    // `charSpacing` is a whole-object property in 1/1000 em and per-character
    // spacing is not something it measures, so a second run's value cannot
    // reach the screen — the object keeps the first run's. But the *difference*
    // has to stay detectable, or an author who tracks a second run has no way
    // to learn their choice did nothing: the run editor's disclosure reads
    // exactly these two values to decide whether to warn.
    const globals: Globals = {
      typeTokens: {
        tracked: { family: "Inter" },
        other: { family: "Inter" },
      },
    };
    const runs = [
      {
        kind: "literal",
        text: "CPU ",
        typeToken: "typeTokens.tracked",
        style: { fontSize: { value: 32 }, letterSpacing: { value: 0.8 } },
      },
      {
        kind: "literal",
        text: "42%",
        typeToken: "typeTokens.other",
        style: { fontSize: { value: 32 }, letterSpacing: { value: 4 } },
      },
    ] as const;

    // Detectable: both values resolve, and the difference is reported.
    const segments = resolveTextSegments(
      "mixed",
      runs,
      [],
      { source: emptySampleSource },
      globals,
      [],
    );
    expect(segments[0]?.style["letterSpacing"]).toBe(0.8);
    expect(segments[1]?.style["letterSpacing"]).toBe(4);
    expect(
      textShapeFor(segments, {}, (value) => [...value]).unsupported,
    ).toContain("letterSpacing");

    // And only one reaches Fabric: the first run's. Fabric measures spacing
    // once from the object, so the second run's value is reported above rather
    // than painted.
    const object = textbox("mixed", [...runs]);
    applyAuthoredText(canvasOf([object]), globalsWith("tracked", "other"), {
      bindings: {},
    });
    expect(object.charSpacing).toBeCloseTo(25, 6);
  });
});
