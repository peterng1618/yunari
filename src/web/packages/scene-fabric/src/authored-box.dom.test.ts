// @vitest-environment jsdom

import type {
  PlanBox,
  PlanNode,
  PlanTextSegment,
  TextRun,
} from "@yunari/renderer-core";
import { Rect, StaticCanvas, Textbox } from "fabric/es";
import { describe, expect, it } from "vitest";
import {
  applyAuthoredText,
  buildText,
  refreshBoundText,
  YUNARI_TEXT_PROPERTY,
} from "./fabric-text.js";
import { reviveScene, serialiseScene } from "./persist.js";

/**
 * The author's box, measured.
 *
 * `Textbox.initDimensions` widens to its longest unbreakable run and never
 * narrows (`fabric/dist/index.mjs:18453`), and `width` is one of its
 * `textLayoutProperties` (`:18760`), so every width write re-enters it. The
 * starter's `ram-value` is authored 180 wide and its authoring token
 * `@ram.used.percent%` measures 566.9, which is the width that survives a save.
 *
 * What is asserted is the property — the box stays the box, and the clip and
 * both alignments follow it — never a pixel count a different font stack would
 * change. The token is chosen to be unambiguously wider than the box at this
 * size, so the assertions below cannot pass for free.
 */

const BOX = { x: 40, y: 30, width: 180, height: 72 };
const TOKEN = "@ram.used.percent%";

/**
 * How wide the token is, measured off its own object.
 *
 * The premise every assertion here rests on. It cannot be read off the object
 * under test, because a restored box is exactly what the fix produces.
 */
function tokenWidth(): number {
  return new Textbox(TOKEN, { fontSize: 32 }).calcTextWidth();
}

/** Wider than `BOX` at this size, and unbreakable, so `dynamicMinWidth` wins. */
function tokenOverflowsBox(): boolean {
  return tokenWidth() > BOX.width;
}

function runs(): readonly TextRun[] {
  return [
    { kind: "literal", text: "MEM ", typeToken: "typeTokens.body" },
    {
      kind: "value",
      bindingId: "m",
      precision: 0,
      unitDisplay: "none",
      typeToken: "typeTokens.body",
    },
    { kind: "literal", text: " %", typeToken: "typeTokens.body" },
  ];
}

/** The token for every value run, as the editor's authoring view paints it. */
function asTokens(
  segments: readonly PlanTextSegment[],
): readonly PlanTextSegment[] {
  return segments.map((segment, index) =>
    runs()[index]?.kind === "value" ? { ...segment, text: TOKEN } : segment,
  );
}

function reading(
  layout: Readonly<Record<string, unknown>> = {},
  box: { width: number; height: number } = {
    width: BOX.width,
    height: BOX.height,
  },
): Textbox {
  const object = new Textbox("MEM 61 %", {
    id: "ram-value",
    left: BOX.x,
    top: BOX.y,
    width: box.width,
    fontSize: 32,
    // Zero so a bounding rect is the box: Fabric pads `aCoords` by half a
    // stroke each side (`:5377`), which would make every reading below one
    // point wider than the box and hide the difference this file is about.
    strokeWidth: 0,
    originX: "left",
    originY: "top",
  });
  object.set(YUNARI_TEXT_PROPERTY, {
    overflow: "ellipsis",
    ...layout,
    box,
    runs: runs(),
  });
  return object;
}

function canvasOf(object: Textbox): StaticCanvas {
  const canvas = new StaticCanvas(undefined, { width: 600, height: 400 });
  canvas.add(object);
  return canvas;
}

function paint(canvas: StaticCanvas): void {
  applyAuthoredText(canvas, undefined, {
    bindings: { "ram-value": [{ id: "m", semanticKey: "ram.used.percent" }] },
    transform: asTokens,
  });
}

describe("the authored box outlives a token wider than it", () => {
  it("keeps the box width the author wrote, after the token is painted", () => {
    const object = reading();
    const canvas = canvasOf(object);

    paint(canvas);

    // The premise, so a pass that cannot fail is not reported as a pass. The
    // token is wider than the box, so it is *marked* rather than shown whole —
    // that is the ellipsis test's subject, not this one's.
    expect(tokenOverflowsBox()).toBe(true);
    expect(object.width).toBe(BOX.width);
  });

  it("holds the box across every refresh rather than only the first", () => {
    const object = reading();
    const canvas = canvasOf(object);

    for (let pass = 0; pass < 25; pass += 1) paint(canvas);

    expect(object.width).toBe(BOX.width);
  });

  it("clips to the box, so the token cannot paint over the next card", () => {
    const object = reading();
    const canvas = canvasOf(object);

    paint(canvas);

    expect(object.clipPath).toBeInstanceOf(Rect);
    expect(object.clipPath?.width).toBe(BOX.width);
    expect(object.clipPath?.height).toBe(BOX.height);
  });

  it("keeps the box through a save and a reload", async () => {
    const object = reading();
    const canvas = canvasOf(object);
    paint(canvas);

    const saved = serialiseScene(canvas);
    expect(JSON.stringify(saved)).toContain('"box"');

    const reloaded = new StaticCanvas(undefined, { width: 600, height: 400 });
    await reviveScene(reloaded, saved);
    const revived = reloaded
      .getObjects()
      .find((candidate) => candidate.get("id") === "ram-value");
    paint(reloaded);

    expect(revived).toBeDefined();
    expect((revived as Textbox).width).toBe(BOX.width);
    expect((revived as Textbox).clipPath?.width).toBe(BOX.width);
  });

  it("carries a height the author dragged through a save and a reload", async () => {
    // vg-089's fix is a gesture, and a gesture has to survive the file. The
    // box is the owner, so the height travels in it and comes back at both the
    // object and the clip — with the object's own `height` left out of the save
    // and re-derived by the first pass, which is what stops the reload reading
    // as an edit.
    const box = { width: BOX.width, height: 140 };
    const object = reading({}, box);
    const canvas = canvasOf(object);
    paint(canvas);

    const reloaded = new StaticCanvas(undefined, { width: 600, height: 400 });
    await reviveScene(reloaded, serialiseScene(canvas));
    const revived = reloaded
      .getObjects()
      .find((candidate) => candidate.get("id") === "ram-value") as
      | Textbox
      | undefined;
    paint(reloaded);

    expect(revived).toBeDefined();
    expect(revived?.height).toBe(140);
    expect(revived?.clipPath?.height).toBe(140);
  });

  it("leaves a document with no authored box on the measured behaviour", () => {
    // The migration: a theme saved before this change carries no box, and must
    // not be repaired by a guess.
    const object = reading();
    object.set(YUNARI_TEXT_PROPERTY, { runs: runs() });
    const canvas = canvasOf(object);

    paint(canvas);

    // The premise, then the behaviour: with no authored box the object measures
    // its own, so the token widens it exactly as it always did. Asserting the
    // premise alone would pass whatever the code did.
    expect(tokenOverflowsBox()).toBe(true);
    expect(object.width).toBeGreaterThan(BOX.width);
    expect(object.clipPath?.width).toBe(object.width);
  });
});

describe("a width the author dragged stays dragged", () => {
  it("keeps a width set through Fabric's own `set`", () => {
    // The same statement `changeWidth` executes at `index.mjs:6737`:
    // `target.set(dimension, Math.max(newWidth, 1))`.
    const object = reading();
    const canvas = canvasOf(object);
    paint(canvas);

    object.set("width", 90);

    expect(object.width).toBe(90);
  });

  it("keeps a width set below the longest run, which Fabric would widen", () => {
    // 90 is narrower than the token, so `dynamicMinWidth` is the larger of the
    // two and Fabric's own contract says the box becomes that. The authored box
    // outranks it, and the clip is what tells the author the text does not fit.
    const object = reading();
    const canvas = canvasOf(object);
    paint(canvas);

    object.set("width", 90);

    expect(object.width).toBe(90);

    // And once the box records it — which the editor's resize capture does, and
    // which this stands in for — every later refresh holds it, rather than the
    // pass restoring the box the author just left.
    object.set(YUNARI_TEXT_PROPERTY, {
      ...(object.get(YUNARI_TEXT_PROPERTY) as Record<string, unknown>),
      box: { width: 90, height: BOX.height },
    });
    paint(canvas);

    expect(object.width).toBe(90);
    expect(object.clipPath?.width).toBe(90);
  });

  it("keeps a width the editor's own resize helper applies", () => {
    // `applyTextboxWidth` in `snap-manager/scaling/text-width-resize-measurer.ts`
    // is a second statement of the same thing.
    const object = reading();
    const canvas = canvasOf(object);
    paint(canvas);

    object.set({ width: 140 });

    expect(object.width).toBe(140);
  });
});

describe("a height the author wrote is the height the object has", () => {
  /**
   * Fabric derives `height` from the wrapped text on every `initDimensions`
   * (`fabric/dist/index.mjs:18452`), and `guardBoxWidth`'s width is the mirror
   * case. An author who writes a height in the Size field, or drags the
   * vertical edge, writes the box — so the pass has to put the object back at
   * the box afterwards or the two disagree and the glyphs are cut against a box
   * the object no longer has.
   */
  it("reports the box height after a pass, not Fabric's derivation", () => {
    const object = reading();
    const canvas = canvasOf(object);
    paint(canvas);

    expect(object.height).toBe(BOX.height);
    expect(object.clipPath?.height).toBe(BOX.height);
  });

  it("holds a taller box over a run measured taller than it", () => {
    // vg-089: the box is 27 and the glyphs are 90, so Fabric's own height is
    // ~101 and the authored 27 clips the leading glyph off. The author drags the
    // vertical edge to 140, which is a statement about the box and nothing else.
    const box = { width: BOX.width, height: 140 };
    const object = reading({}, box);
    const canvas = canvasOf(object);

    paint(canvas);

    expect(object.height).toBe(140);
    expect(object.clipPath?.height).toBe(140);
  });

  it("keeps the box height under a scaled object, and the clip on it", () => {
    // `yunariText.box` is the number the object measures against and
    // `boxFrom` puts the scale back on for the clip, so a 1.5x object built at
    // 140 is still 140 in its own space — 210 on the artboard, which is what a
    // corner drag of a 1.5x object produces. Reading one as the other grows the
    // box by the scale on every pass.
    const box = { width: BOX.width, height: 140 };
    const object = reading({}, box);
    object.set({ scaleY: 1.5 });
    const canvas = canvasOf(object);

    paint(canvas);

    expect(object.height).toBe(140);
    expect(object.clipPath?.height).toBe(140);
  });
});

describe("alignment acts inside the authored box", () => {
  /** The painted ink's edges, in parent space. */
  function edgesOf(object: Textbox): { left: number; right: number } {
    return { left: object.left, right: object.left + object.width };
  }

  it("holds a centre-aligned run on the box centre", () => {
    const object = reading({ align: "center" });
    const canvas = canvasOf(object);

    paint(canvas);

    const { left, right } = edgesOf(object);
    expect((left + right) / 2).toBeCloseTo(BOX.x + BOX.width / 2, 6);
  });

  it("holds a right-aligned run on the authored right edge", () => {
    const object = reading({ align: "right" });
    const canvas = canvasOf(object);

    paint(canvas);

    expect(edgesOf(object).right).toBeCloseTo(BOX.x + BOX.width, 6);
  });

  it("puts a bottom-aligned run against the authored bottom edge", () => {
    // The run is one line and the box is taller, so bottom alignment has real
    // work to do — this cannot pass by accident.
    const object = reading({ verticalAlign: "bottom", overflow: "visible" });
    const canvas = canvasOf(object);

    paint(canvas);

    expect(object.top + object.height).toBeCloseTo(BOX.y + BOX.height, 6);
  });

  it("puts a middle-aligned run on the authored vertical centre", () => {
    const object = reading({ verticalAlign: "middle", overflow: "visible" });
    const canvas = canvasOf(object);

    paint(canvas);

    expect(object.top + object.height / 2).toBeCloseTo(
      BOX.y + BOX.height / 2,
      6,
    );
  });

  it("moves a fixed-height box's lines, not the box, for vertical align", () => {
    // A `Textbox` here *is* its authored box on both axes, so `placeInBox` has
    // no height slack to move the text through and Fabric's renderer would
    // otherwise draw every line from the box's top. The line origin is where
    // Fabric asks (`_getTopOffset`), so that is where the alignment has to be.
    const middle = reading({ verticalAlign: "middle" });
    const middleCanvas = canvasOf(middle);
    paint(middleCanvas);

    const middleText = middle.calcTextHeight();
    const middleSlack = BOX.height - middleText;
    const topOffsetOf = (object: Textbox): number =>
      (object as unknown as { _getTopOffset(): number })._getTopOffset();

    expect(middle.height).toBe(BOX.height);
    expect(topOffsetOf(middle)).toBeCloseTo(
      -BOX.height / 2 + middleSlack / 2,
      6,
    );

    const bottom = reading({ verticalAlign: "bottom" });
    const bottomCanvas = canvasOf(bottom);
    paint(bottomCanvas);

    const bottomSlack = BOX.height - bottom.calcTextHeight();
    expect(topOffsetOf(bottom)).toBeCloseTo(-BOX.height / 2 + bottomSlack, 6);
  });

  it("re-reads the authored box rather than the pass cache", () => {
    // `buildText` caches the box it first laid out with, and a later author
    // write (`writeAuthoredBoxDimension`, a Size field, a dragged handle) only
    // rewrites `yunariText`. A cache that kept serving its own box would undo
    // every resize on the next repaint.
    const object = reading({}, { width: 120, height: BOX.height });
    const canvas = canvasOf(object);
    paint(canvas);
    expect(object.width).toBe(120);

    // The cache `buildText` leaves behind: the box it measured at construction.
    object.set("yunariTextLayout", {
      box: { width: 120, height: BOX.height },
      layout: {
        wrap: true,
        overflow: "clip",
        align: "left",
        verticalAlign: "top",
      },
      style: {},
    });

    object.set(YUNARI_TEXT_PROPERTY, {
      runs: runs(),
      box: { width: 240, height: BOX.height },
    });
    paint(canvas);

    expect(object.width).toBe(240);
    expect(Object.hasOwn(object, "yunariTextLayout")).toBe(true);
  });

  it("keeps both edges when a reading grows a digit", () => {
    // The §89 requirement: a sensor box does not move when its reading
    // changes. The reading really does get wider, and the box is the clip, so
    // a fixed box and a growing reading are what has to hold.
    const object = reading({ align: "center", overflow: "ellipsis" });
    const canvas = canvasOf(object);
    const source = (value: number) => ({
      revision: 0,
      latest: (key: string) =>
        key === "ram.used.percent"
          ? {
              sensorId: key,
              timestamp: "2026-09-20T00:00:00.000Z",
              status: "ok" as const,
              value,
            }
          : undefined,
      history: () => [],
    });
    const bindings = {
      "ram-value": [{ id: "m", semanticKey: "ram.used.percent" }],
    };

    // The production sequence: the editor paints the reading first, and a
    // sample arrives afterwards.
    paint(canvas);
    expect(tokenOverflowsBox()).toBe(true);

    refreshBoundText(canvas, bindings, source(9), undefined);
    const one = { ...edgesOf(object), width: object.width, clip: 0 };
    one.clip = object.clipPath?.width ?? -1;
    refreshBoundText(canvas, bindings, source(100), undefined);
    const two = { ...edgesOf(object), width: object.width, clip: 0 };
    two.clip = object.clipPath?.width ?? -1;

    // The clip is the box, not the run: without the authored box the clip is
    // rebuilt from whatever the reading happens to measure, so it moves.
    expect(one.clip).toBe(BOX.width);
    expect(two).toEqual(one);
    expect(one.width).toBe(BOX.width);
    expect(one.left).toBe(BOX.x);
    expect(one.right).toBe(BOX.x + BOX.width);
  });
});

describe("the clip lands on the box whatever origin the object uses", () => {
  it("puts a left/top-origin object's clip on its own box", () => {
    // The starter authors every text object at a corner with
    // `originX: "left"`, `originY: "top"`, so `object.left` is the box's left
    // edge rather than its centre. A clip placed as though it were a centre
    // origin lands half a box away and cuts the text in half.
    const object = reading({ overflow: "clip" });
    const canvas = canvasOf(object);

    paint(canvas);

    const clip = object.clipPath as Rect;
    expect(clip.width).toBe(BOX.width);
    // The clip's centre in parent space is the box's centre.
    const centreX = object.left + object.width / 2 + clip.left * object.scaleX;
    const centreY = object.top + object.height / 2 + clip.top * object.scaleY;
    expect(centreX).toBeCloseTo(BOX.x + BOX.width / 2, 6);
    expect(centreY).toBeCloseTo(BOX.y + BOX.height / 2, 6);
  });

  it("puts a centred-origin object's clip on the same box", () => {
    // The counter-case: the plan path's objects are centred, and the two must
    // agree or the same authored box would clip in two different places.
    const object = reading({ overflow: "clip" });
    object.set({ originX: "center", originY: "center" });
    object.left += BOX.width / 2;
    object.top += BOX.height / 2;
    const canvas = canvasOf(object);

    paint(canvas);

    const clip = object.clipPath as Rect;
    const centreX = object.left + clip.left * object.scaleX;
    const centreY = object.top + clip.top * object.scaleY;
    expect(centreX).toBeCloseTo(BOX.x + BOX.width / 2, 6);
    expect(centreY).toBeCloseTo(BOX.y + BOX.height / 2, 6);
  });
});

describe("the clip is a cache, not saved state", () => {
  it("keeps a stale clip out of the save", () => {
    // An unbound label is never re-resolved by a refresh, so a clip carried in
    // the file is the only thing clipping it — and it would be a rect computed
    // against an older layout, not against `yunariText.box`.
    const object = reading();
    const canvas = canvasOf(object);
    paint(canvas);
    expect(object.clipPath).toBeInstanceOf(Rect);

    const saved = serialiseScene(canvas);
    const entry = saved.objects.find(
      (candidate) => candidate["id"] === "ram-value",
    ) as Record<string, unknown>;

    expect(entry["clipPath"]).toBeUndefined();
    expect((entry[YUNARI_TEXT_PROPERTY] as { box?: unknown }).box).toEqual({
      width: BOX.width,
      height: BOX.height,
    });
  });

  it("keeps the object's own height out of the save, as it keeps the clip", () => {
    // `height` is a Fabric core property, so it serialises — and it is the one
    // number on a text object that changes under a pass with no edit: Fabric
    // derives it from the wrapped text on construction, and the pass puts it
    // back at the box. Carried in the file it would make every opening read as
    // an edit the author made (§67), which is what the dirty guard is for.
    const object = reading();
    const canvas = canvasOf(object);
    paint(canvas);
    expect(object.height).toBe(BOX.height);

    const saved = serialiseScene(canvas);
    const entry = saved.objects.find(
      (candidate) => candidate["id"] === "ram-value",
    ) as Record<string, unknown>;

    expect(entry["height"]).toBeUndefined();
    // The box is the owner, and it is what the reload reads.
    expect((entry[YUNARI_TEXT_PROPERTY] as { box?: unknown }).box).toEqual({
      width: BOX.width,
      height: BOX.height,
    });
  });
});

describe("an object with no authored box", () => {
  it("stays where its author put it", () => {
    // A theme written before fixed boxes, or an object an author placed by
    // hand: the fallback measures the object's own edges, and reading those
    // through a centre origin moves a corner-anchored object off its corner by
    // half its own size.
    const object = reading();
    object.set(YUNARI_TEXT_PROPERTY, { runs: runs() });
    const canvas = canvasOf(object);
    const left = object.left;
    const top = object.top;

    paint(canvas);

    expect(object.left).toBe(left);
    expect(object.top).toBe(top);
  });

  it("still holds its own edges when it is centred-origin", () => {
    // The counter-case, so the test above cannot pass by leaving the fallback
    // alone.
    const object = reading();
    object.set(YUNARI_TEXT_PROPERTY, { runs: runs() });
    object.set({ originX: "center", originY: "center" });
    object.left += BOX.width / 2;
    object.top += BOX.height / 2;
    const canvas = canvasOf(object);
    const left = object.left;
    const top = object.top;

    paint(canvas);

    expect(object.left).toBeCloseTo(left, 6);
    expect(object.top).toBeCloseTo(top, 6);
  });
});

describe("the canvas's own idea of the box", () => {
  /**
   * Fabric keeps a second cache of where an object is: `getBoundingRect()` is
   * `makeBoundingBoxFromPoints(this.getCoords())`
   * (`fabric/dist/index.mjs:5281`) and `getCoords()` reads `aCoords` (`:5198`).
   * Putting the box back is a direct assignment, so the pass never refreshes
   * it — and everything that reads a box through the canvas, which is the
   * selection frame the author drags by, the snap guides and `arrange`, reads
   * the size Fabric widened to inside the pass rather than the box.
   *
   * So every assertion here is on `getBoundingRect()`, never on `width`: the
   * field has read correctly since the box became a cache, and a test on it
   * passed for as long as this defect was open.
   */
  function drawn(object: Textbox): { width: number; height: number } {
    const rect = object.getBoundingRect();
    return {
      width: rect.width / object.scaleX,
      height: rect.height / object.scaleY,
    };
  }

  it("has the coordinates describe the box the pass wrote", () => {
    // The premise: the token is wider and taller than the box, so the pass has
    // a real restoration to do and a stale cache to leave behind.
    const object = reading({}, { width: BOX.width, height: 140 });
    const canvas = canvasOf(object);
    expect(tokenWidth()).toBeGreaterThan(BOX.width);

    paint(canvas);

    expect(drawn(object)).toEqual({ width: BOX.width, height: 140 });
  });

  it("holds the coordinates across repeated passes, not only the first", () => {
    const object = reading({}, { width: BOX.width, height: 140 });
    const canvas = canvasOf(object);

    paint(canvas);
    for (let pass = 0; pass < 25; pass += 1) paint(canvas);

    expect(drawn(object)).toEqual({ width: BOX.width, height: 140 });
  });

  it("has the coordinates describe the box after a bound refresh", () => {
    // The second caller of the same pass. A sample arrives, the run changes,
    // and the box is written again by the same three statements.
    const object = reading({}, { width: BOX.width, height: 140 });
    const canvas = canvasOf(object);
    paint(canvas);

    refreshBoundText(
      canvas,
      { "ram-value": [{ id: "m", semanticKey: "ram.used.percent" }] },
      {
        revision: 0,
        latest: () => ({
          sensorId: "ram.used.percent",
          timestamp: "2026-10-01T00:00:00.000Z",
          status: "ok" as const,
          value: 61,
        }),
        history: () => [],
      },
      undefined,
    );

    expect(drawn(object)).toEqual({ width: BOX.width, height: 140 });
  });

  it("has the coordinates describe the box after a save and a revive", async () => {
    // The history path. The revived objects are new, so their caches start
    // honest — for the box Fabric measured them at, not the authored one, since
    // no pass has run. The first pass over them is what has to make both agree.
    const object = reading({}, { width: BOX.width, height: 140 });
    const canvas = canvasOf(object);
    paint(canvas);

    const reloaded = new StaticCanvas(undefined, { width: 600, height: 400 });
    await reviveScene(reloaded, serialiseScene(canvas));
    const revived = reloaded
      .getObjects()
      .find((candidate) => candidate.get("id") === "ram-value") as
      | Textbox
      | undefined;
    expect(revived).toBeDefined();

    // The premise: the revive is honest before any pass, so what follows is the
    // pass doing the work rather than the revive having got it right.
    const before = drawn(revived as Textbox);
    expect(before.width).toBeCloseTo(revived?.width ?? -1, 6);
    expect(before.height).toBeCloseTo(revived?.height ?? -1, 6);

    paint(reloaded);

    expect(drawn(revived as Textbox)).toEqual({
      width: BOX.width,
      height: 140,
    });
  });

  it("has the coordinates describe a width written through `set`", () => {
    // `guardBoxWidth` is the third write: it restores the width after Fabric's
    // own `set` has re-measured, so it inherits the same stale cache.
    const object = reading();
    const canvas = canvasOf(object);
    paint(canvas);

    object.set("width", 90);

    expect(object.width).toBe(90);
    expect(drawn(object).width).toBe(90);
  });

  it("has the coordinates agree with the object on the plan path", () => {
    // The fourth writer, and the counter-case: `buildText` and `updateText`
    // write the box through `set`, so Fabric refreshes `aCoords` itself and
    // there is nothing to restore. The plan path's own width is the widened
    // measurement rather than the box — a separate question, and one the first
    // authoring pass settles — but the canvas must still report what the object
    // says it is, or every reader here is reading a cache nothing maintains.
    const target = box();
    const object = buildText(
      {
        id: "label",
        style: {},
        content: {
          kind: "text",
          segments: [
            {
              text: TOKEN,
              style: { fontSize: 32, fill: "#fff" },
            },
          ],
          layout: {
            wrap: true,
            overflow: "clip",
            align: "left",
            verticalAlign: "top",
          },
          authored: { runs: [{ kind: "literal", text: TOKEN }] },
        },
      } as unknown as PlanNode,
      target,
    ) as Textbox;

    expect(drawn(object)).toEqual({
      width: object.width,
      height: object.height,
    });
  });
});

function box(overrides: Partial<PlanBox> = {}): PlanBox {
  return {
    x: BOX.x,
    y: BOX.y,
    width: BOX.width,
    height: 140,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    ...overrides,
  };
}

describe("an ellipsis on wrapped text inside a fixed box", () => {
  /** A box one line tall, so a second line cannot fit. */
  function oneLineBox(
    layout: Readonly<Record<string, unknown>>,
    text: string,
  ): Textbox {
    const object = new Textbox(text, {
      id: "ram-value",
      left: BOX.x,
      top: BOX.y,
      width: BOX.width,
      fontSize: 32,
      lineHeight: 1.18,
      originX: "left",
      originY: "top",
    });
    object.set(YUNARI_TEXT_PROPERTY, {
      overflow: "ellipsis",
      align: "center",
      box: { width: BOX.width, height: 0 },
      ...layout,
      runs: [{ kind: "literal", text }],
    });
    // The authored height is one line, so `maxLines` has something to derive.
    object.set(YUNARI_TEXT_PROPERTY, {
      ...(object.get(YUNARI_TEXT_PROPERTY) as Record<string, unknown>),
      box: { width: BOX.width, height: object.getHeightOfLine(0) },
    });
    return object;
  }

  it("marks a run that needs more lines than the box has", () => {
    const object = oneLineBox({}, "MEM 61 GB of 32 GB used");
    const canvas = canvasOf(object);
    // The premise, read before the pass: the text really does need more than
    // the one line this box has room for.
    const needed = object.textLines.length;

    paint(canvas);

    expect(needed).toBeGreaterThan(1);
    expect(object.text.endsWith("…")).toBe(true);
    expect(object.textLines.length).toBe(1);
    expect(object.text).not.toBe("MEM 61 GB of 32 GB used");
  });

  it("leaves a run that already fits alone", () => {
    // The counter-case, without which the test above says nothing: the default
    // `maxLines === undefined` must not ellipsise every box.
    const object = oneLineBox({}, "ok");
    const canvas = canvasOf(object);

    paint(canvas);

    expect(object.text).toBe("ok");
    expect(object.text).not.toContain("…");
  });

  it("still clips when the box is too short for even one line", () => {
    // A box shorter than its own line height has no line to show, and the clip
    // is what keeps the remainder off whatever is beside it.
    const object = oneLineBox({}, "MEM 61 GB of 32 GB used");
    object.set(YUNARI_TEXT_PROPERTY, {
      ...(object.get(YUNARI_TEXT_PROPERTY) as Record<string, unknown>),
      box: { width: BOX.width, height: 1 },
    });
    const canvas = canvasOf(object);

    paint(canvas);

    expect(object.clipPath).toBeInstanceOf(Rect);
  });
});
