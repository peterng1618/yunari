import type { PlanBox } from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import { placementFor, withinGroup } from "./placement.js";

/**
 * The top-left → centre conversion.
 *
 * Small, and the most consequential arithmetic in the package: every object in
 * every scene goes through it, and getting it wrong displaces content by half
 * its own size — which looks like a layout bug in the document rather than a
 * renderer bug, and is why there is exactly one copy.
 */

function box(overrides: Partial<PlanBox> = {}): PlanBox {
  return {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    ...overrides,
  };
}

describe("placementFor", () => {
  it("moves the anchor from the top-left corner to the centre", () => {
    expect(placementFor(box({ x: 10, y: 20, width: 100, height: 50 }))).toEqual(
      {
        left: 60,
        top: 45,
        width: 100,
        height: 50,
        angle: 0,
        scaleX: 1,
        scaleY: 1,
      },
    );
  });

  it("leaves the centre alone when the node is scaled", () => {
    // CSS scaled about `transform-origin: 50% 50%` and Fabric scales about the
    // origin, which is the centre — so a scaled node keeps its centre and the
    // conversion is unaffected. If this ever changed, every scaled node would
    // drift by half its growth.
    const placement = placementFor(
      box({ x: 10, y: 20, width: 100, height: 50, scaleX: 2, scaleY: 3 }),
    );

    expect(placement).toMatchObject({
      left: 60,
      top: 45,
      scaleX: 2,
      scaleY: 3,
    });
  });

  it("carries rotation across as degrees, under Fabric’s name for it", () => {
    expect(
      placementFor(box({ width: 10, height: 10, rotation: 37 })).angle,
    ).toBe(37);
  });

  it("accepts a zero-sized box rather than inventing one", () => {
    // A node with no explicit size has no size — `plan.ts` is deliberate about
    // that, and defaulting here would put an invisible-in-the-document
    // rectangle on screen.
    expect(placementFor(box({ x: 5, y: 5 }))).toMatchObject({
      left: 5,
      top: 5,
      width: 0,
      height: 0,
    });
  });
});

describe("withinGroup", () => {
  it("re-expresses a child box relative to the group’s centre", () => {
    // A 200x200 group's centre is 100,100 into its own content space, so a
    // child authored at 10,10 sits at -90,-90 in the space Fabric keeps it in.
    expect(
      withinGroup(box({ x: 10, y: 10, width: 50, height: 50 }), {
        width: 200,
        height: 200,
      }),
    ).toMatchObject({ x: -90, y: -90, width: 50, height: 50 });
  });

  it("does not depend on where the group is", () => {
    // The whole reason moving a group needs no child arithmetic: the offset is
    // half the group's *size*, and its position never enters.
    const child = box({ x: 10, y: 10, width: 50, height: 50 });

    expect(withinGroup(child, { width: 200, height: 100 })).toEqual(
      withinGroup(child, { width: 200, height: 100 }),
    );
    expect(withinGroup(child, { width: 200, height: 100 }).y).toBe(-40);
  });
});
