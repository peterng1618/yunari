import { describe, expect, it } from "vitest";
import {
  type ArtboardSize,
  outsideCount,
  type SceneBox,
  sceneBoxesOf,
} from "./artboard-crop.js";

/**
 * What the artboard does not contain.
 *
 * The counting is a fact about the scene rather than about a surface, and the
 * editor's artboard panel is its only reader: it takes `outsideCount`.
 *
 * The cases are asserted on the shared predicate rather than once per surface:
 * a per-surface test would still pass if the other surface were reading a
 * different name.
 *
 * Every overhang counts: nothing marks a crop as deliberate, which is why no
 * case below mentions one.
 */

const ARTBOARD: ArtboardSize = { width: 1000, height: 1000 };

function box(over: Partial<SceneBox> = {}): SceneBox {
  return {
    visible: true,
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    depth: 0,
    ...over,
  };
}

/** A group's box at depth 0 followed by its own children at depth 1, the order
 *  `sceneBoxesOf` emits. */
function group(
  over: Partial<SceneBox> = {},
  children: readonly SceneBox[] = [],
): readonly SceneBox[] {
  return [
    box({ depth: 0, ...over }),
    ...children.map((c) => ({ ...c, depth: 1 })),
  ];
}

/** Straddling the right edge: visible on the artboard, running off it. */
const STRADDLING = { left: 950, top: 100, width: 100, height: 100 };

describe("what counts as cropped", () => {
  it("counts a straddling object", () => {
    expect(outsideCount([box(STRADDLING)], ARTBOARD)).toEqual({
      outside: 1,
      counted: 1,
    });
  });

  it("does not count an object the author hid", () => {
    // The author's own doing, so it is neither a fault to report nor part of
    // the population the proportion is taken over.
    expect(
      outsideCount([box({ ...STRADDLING, visible: false }), box()], ARTBOARD),
    ).toEqual({ outside: 0, counted: 1 });
  });

  it("does not count an object with no area", () => {
    expect(outsideCount([box({ ...STRADDLING, width: 0 })], ARTBOARD)).toEqual({
      outside: 0,
      counted: 0,
    });
  });
});

describe("the slack at an edge", () => {
  it("forgives a panel flush against the edge, and one a fraction past it", () => {
    // Fabric's coordinates are fractional, so a panel the author placed at the
    // edge must not read as cropped over a rounding error.
    //
    // The three arms are **absolute** distances, not fractions of the tolerance:
    // an arm written as `EDGE_TOLERANCE ± 0.5` moves with the constant and
    // passes at a tolerance of zero, which is the state this case exists to
    // tell apart. Half a unit past the edge is forgiven and one and a half is
    // not, so the slack is bounded on both sides without being hard-coded.
    const flush = box({ left: ARTBOARD.width - 100, width: 100, height: 40 });
    const rounding = box({
      left: ARTBOARD.width - 100,
      width: 100.5,
      height: 40,
    });
    const overhang = box({
      left: ARTBOARD.width - 100,
      width: 101.5,
      height: 40,
    });

    expect(outsideCount([flush], ARTBOARD)).toEqual({ outside: 0, counted: 1 });
    expect(outsideCount([rounding], ARTBOARD)).toEqual({
      outside: 0,
      counted: 1,
    });
    expect(outsideCount([overhang], ARTBOARD)).toEqual({
      outside: 1,
      counted: 1,
    });
  });
});

describe("a group and its parts", () => {
  it("reports a part that runs off on its own inside a group the artboard contains", () => {
    // The group is inside, so the walk descends into it and the child that left
    // the artboard is the thing reported — the denominator is every countable
    // object, exactly as it was before cards were groups.
    expect(
      outsideCount(
        group({ left: 10, top: 10, width: 200, height: 100 }, [
          box({ left: 10, top: 10, width: 200, height: 100 }),
          box({ left: 990, top: 10, width: 100, height: 40 }),
        ]),
        ARTBOARD,
      ),
    ).toEqual({ outside: 1, counted: 3 });
  });

  it("reports a group the artboard does not contain once, not once per part", () => {
    // What a display loses is the card, not the boxes inside it: a starter
    // whose cards are groups would otherwise report one cropped card eight
    // times, which destroys the number's only job.
    expect(
      outsideCount(
        group(STRADDLING, [
          box(STRADDLING),
          box({ left: 960, top: 110, width: 80, height: 80 }),
        ]),
        ARTBOARD,
      ),
    ).toEqual({ outside: 1, counted: 1 });
  });
});

describe("sceneBoxesOf reads the object", () => {
  /** The smallest thing Fabric-shaped: `getBoundingRect` is what the box is
   *  built from, and `visible` is the object's own field. */
  function fabricish(
    rect: { left: number; top: number; width: number; height: number },
    visible = true,
  ): {
    visible: boolean;
    get(name: string): unknown;
    getBoundingRect(): typeof rect;
  } {
    return { visible, get: () => undefined, getBoundingRect: () => rect };
  }

  it("builds a box from the object's own rect and visibility", () => {
    expect(sceneBoxesOf([fabricish(STRADDLING) as never])).toEqual([
      { ...STRADDLING, visible: true, depth: 0 },
    ]);
    expect(sceneBoxesOf([fabricish(STRADDLING, false) as never])).toEqual([
      { ...STRADDLING, visible: false, depth: 0 },
    ]);
  });
});
