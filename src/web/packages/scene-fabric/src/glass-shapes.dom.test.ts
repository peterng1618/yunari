// @vitest-environment jsdom

/**
 * The frosted treatment on the shapes that joined it: Circle, Ellipse, Triangle
 * and Polygon. What is proved here is **the clip path**, not the blur —
 * `node-canvas` accepts `ctx.filter` and ignores it — so every case asks whether
 * the frosted surface is confined to the shape's own geometry.
 *
 * The probe is the same each time: a point **inside the object's bounding box
 * and outside the shape**. A clip built from the bounding box reaches it; a clip
 * built from the shape's own geometry does not. That is what makes this a
 * rendering test rather than a check that a treatment exists, and it is why the
 * file is separate from `glass.dom.test.ts` rather than inside it.
 *
 * Every point is chosen with margin. A probe one pixel outside a shape lands on
 * the clip's antialiased edge and reads a faint wash instead of nothing, which
 * is a test that passes for the wrong reason.
 */

import {
  Circle,
  Ellipse,
  type FabricObject,
  Point,
  Polygon,
  Polyline,
  Rect,
  Triangle,
} from "fabric/es";
import { describe, expect, it } from "vitest";
import { type Stage, stage } from "./glass-test-stage.js";
import { Arc, Wedge } from "./sector-object.js";

/** A solid magenta backdrop, so the frosted region is unmistakable. */
function magenta(): Stage {
  return stage({
    texture: false,
    backdrop: () => ({
      paint: (ctx, region) => {
        ctx.fillStyle = "#ff00ff";
        ctx.fillRect(0, 0, region.width, region.height);
        return true;
      },
    }),
  });
}

interface Frosted {
  /** The same scene with the treatment on. */
  readonly s: Stage;
  /** The same scene without it, which is what an unclipped probe still reads. */
  readonly without: Stage;
}

/**
 * Renders `make()` twice, once carrying the treatment and once not. Glass leaves
 * a point it does not cover exactly as it found it, so the pair proves both
 * halves at once: equal outside the shape, magenta inside it.
 */
function frosted(make: (withGlass: boolean) => FabricObject): Frosted {
  const s = magenta();
  const without = magenta();
  s.canvas.add(make(true));
  without.canvas.add(make(false));
  s.canvas.renderAll();
  without.canvas.renderAll();
  return { s, without };
}

/** The treatment, applied only when asked for. */
const GLASS = { yunariGlass: { blurRadius: 24 } };

describe("glass on the closed shapes", () => {
  it("clips a circle to the disc, not to the box around it", () => {
    // radius 20 at (100,100): the bounding box runs 80..120, and (82, 82) is
    // 25.5 from the centre — 5.5px clear of the disc, well inside the square.
    const { s, without } = frosted(
      (withGlass) =>
        new Circle({
          left: 100,
          top: 100,
          radius: 20,
          fill: "transparent",
          ...(withGlass ? GLASS : {}),
        }),
    );
    expect(s.errors).toEqual([]);
    expect(s.draws, "the circle composites").toHaveLength(1);

    // Outside the disc: the media never arrives, so the two agree.
    expect(s.pixel(82, 82)).toEqual(without.pixel(82, 82));
    expect(without.pixel(82, 82)[3], "and there is nothing to agree with").toBe(
      0,
    );
    // Inside: opaque magenta, where without glass the canvas is clear.
    expect(s.pixel(100, 100)[3]).toBe(255);
    expect(without.pixel(100, 100)[3]).toBeLessThan(255);
  });

  it("clips an ellipse to its own radii, which a square would exceed", () => {
    // rx 30, ry 12: the box runs 70..130 by 88..112, and (72, 90) is inside
    // that box while (28/30)² + (10/12)² = 1.57 puts it outside the ellipse.
    const { s, without } = frosted(
      (withGlass) =>
        new Ellipse({
          left: 100,
          top: 100,
          rx: 30,
          ry: 12,
          fill: "transparent",
          ...(withGlass ? GLASS : {}),
        }),
    );
    expect(s.errors).toEqual([]);
    expect(s.draws).toHaveLength(1);

    expect(s.pixel(72, 90)).toEqual(without.pixel(72, 90));
    expect(without.pixel(72, 90)[3]).toBe(0);
    expect(s.pixel(100, 100)[3]).toBe(255);
  });

  it("clips a triangle to its three corners, not to the box around them", () => {
    // 40x40 at (100,100), so the vertices are (80,120), (100,80) and (120,120).
    // The left edge runs from (80,120) up to (100,80), reaching x=98 at y=84 —
    // so (84, 84) is 14px clear of the hypotenuse and only 4px inside the box.
    const { s, without } = frosted(
      (withGlass) =>
        new Triangle({
          left: 100,
          top: 100,
          width: 40,
          height: 40,
          fill: "transparent",
          ...(withGlass ? GLASS : {}),
        }),
    );
    expect(s.errors).toEqual([]);
    expect(s.draws).toHaveLength(1);

    expect(s.pixel(84, 84)).toEqual(without.pixel(84, 84));
    expect(without.pixel(84, 84)[3]).toBe(0);
    // On the centre line, 10px clear of each sloping edge.
    expect(s.pixel(100, 100)[3]).toBe(255);
  });

  it("clips a polygon to its own points, about its own pathOffset", () => {
    // A diamond. Fabric centres the points on `pathOffset` before painting, and
    // the clip has to use the same frame or the frost lands beside the shape.
    // (80, 80) is 40 (L1) from the centre, against a 25 radius, and sits in the
    // corner of the 75..125 bounding box.
    const { s, without } = frosted(
      (withGlass) =>
        new Polygon(
          [
            new Point(0, -25),
            new Point(25, 0),
            new Point(0, 25),
            new Point(-25, 0),
          ],
          {
            left: 100,
            top: 100,
            fill: "transparent",
            ...(withGlass ? GLASS : {}),
          },
        ),
    );
    expect(s.errors).toEqual([]);
    expect(s.draws).toHaveLength(1);

    expect(s.pixel(80, 80)).toEqual(without.pixel(80, 80));
    expect(without.pixel(80, 80)[3]).toBe(0);
    expect(s.pixel(100, 100)[3]).toBe(255);
  });

  it("samples a region that covers every shape's own geometry, not only the rect's", () => {
    /**
     * The coverage half of "the circle reads stronger".
     *
     * A frosted surface whose sampled region stops short of the clipped shape
     * carries the material with no backdrop behind it, which reads denser than
     * the same material over a real blur. The probe above cannot see that: it
     * only asks whether the clip is too *large*. This asks the other way —
     * whether the region the sampler takes is large enough to cover what the
     * clip confines the material to — and it asks it of all five shapes,
     * because a region derived from a shape's own box covers any shape, while
     * one derived from a rect's would not.
     *
     * The two are read from the same frame: `clips` holds the transform in
     * force at each `ctx.clip()`, which maps the shape's local units onto the
     * surface, and `regions` holds the rect the sampler took. A shape's own
     * local box pushed through the clip's transform is the area the material
     * is confined to, so the region has to contain it.
     */
    const PAD = 50; // ceil(blurRadius * 2) + 2, at the treatment's radius 24.
    const cases: readonly {
      readonly kind: string;
      readonly make: () => FabricObject;
      /** The shape's own local box, origin at the centre as `localPath` has it. */
      readonly local: readonly [number, number, number, number];
    }[] = [
      {
        kind: "Rect",
        make: () =>
          new Rect({ left: 100, top: 100, width: 40, height: 40, ...GLASS }),
        local: [-20, -20, 20, 20],
      },
      {
        kind: "Circle",
        make: () => new Circle({ left: 100, top: 100, radius: 20, ...GLASS }),
        local: [-20, -20, 20, 20],
      },
      {
        kind: "Ellipse",
        make: () =>
          new Ellipse({ left: 100, top: 100, rx: 30, ry: 12, ...GLASS }),
        local: [-30, -12, 30, 12],
      },
      {
        kind: "Triangle",
        make: () =>
          new Triangle({
            left: 100,
            top: 100,
            width: 40,
            height: 40,
            ...GLASS,
          }),
        local: [-20, -20, 20, 20],
      },
      {
        kind: "Polygon",
        make: () =>
          new Polygon(
            [
              new Point(0, -25),
              new Point(25, 0),
              new Point(0, 25),
              new Point(-25, 0),
            ],
            { left: 100, top: 100, ...GLASS },
          ),
        local: [-25, -25, 25, 25],
      },
    ];

    for (const { kind, make, local } of cases) {
      const s = magenta();
      s.canvas.add(make());
      s.canvas.renderAll();
      expect(s.errors, `${kind} composites`).toEqual([]);

      const region = s.regions[0];
      const clip = s.clips.slice(0, 6);
      expect(region, `${kind} sampled a region`).toBeDefined();
      expect(clip, `${kind} clipped under its own transform`).toHaveLength(6);
      // The stage's clips are an axis-aligned device transform, so only the
      // scale and the translation are read; `b` and `c` would be the shear.
      const [a = 0, , , d = 0, e = 0, f = 0] = clip;
      // The shape's own box, through the transform the clip was set under.
      const [lx, ly, rx2, ry2] = local;
      const xs = [lx ?? 0, rx2 ?? 0].map((x) => a * x + e);
      const ys = [ly ?? 0, ry2 ?? 0].map((y) => d * y + f);
      const left = Math.min(...xs);
      const right = Math.max(...xs);
      const top = Math.min(...ys);
      const bottom = Math.max(...ys);

      // A full blur radius of slack on every side, which is what the blur needs
      // to have real pixels at the shape's own edge.
      expect(
        region?.left ?? 0,
        `${kind}: the region covers its left`,
      ).toBeLessThanOrEqual(left - PAD);
      expect(
        region?.top ?? 0,
        `${kind}: the region covers its top`,
      ).toBeLessThanOrEqual(top - PAD);
      expect(
        (region?.left ?? 0) + (region?.width ?? 0),
        `${kind}: the region covers its right`,
      ).toBeGreaterThanOrEqual(right + PAD);
      expect(
        (region?.top ?? 0) + (region?.height ?? 0),
        `${kind}: the region covers its bottom`,
      ).toBeGreaterThanOrEqual(bottom + PAD);
    }
  });

  it("samples one region per box, whatever shape the box belongs to", () => {
    /**
     * `sampleRegion` pads a shape's **bounding rect** by a fixed
     * `ceil(blurRadius * 2) + 2` on every side. It never looks at the outline,
     * so two shapes with the same box take the same region — which is the claim
     * that a circle's frost reads stronger for want of backdrop is *not* built
     * on. A number once said otherwise: 127,449 px for a circle against
     * 156,009 for a rect, which a fixed pad cannot produce. It could, if the
     * circle had been authored smaller — 160 across inside a 240-wide box, as
     * the cost sweep that recorded it had — and 356/436 = 0.8165 predicts the
     * 0.81691 that was measured.
     *
     * So this pins the invariant that killed it: at one box, one region. The
     * coverage case above asks the other question, whether the region is big
     * enough for the shape; this one asks whether it varies with the shape at
     * all, which is the question that was open.
     */
    const BOX = 40;
    const make = (
      kind: "Rect" | "Circle" | "Ellipse" | "Triangle" | "Polygon",
    ) => {
      const common = { left: 100, top: 100, ...GLASS };
      switch (kind) {
        case "Rect":
          return new Rect({ ...common, width: BOX, height: BOX, rx: 0, ry: 0 });
        case "Circle":
          return new Circle({ ...common, radius: BOX / 2 });
        case "Ellipse":
          return new Ellipse({ ...common, rx: BOX / 2, ry: BOX / 2 });
        case "Triangle":
          return new Triangle({ ...common, width: BOX, height: BOX });
        case "Polygon":
          return new Polygon(
            [
              new Point(-BOX / 2, -BOX / 2),
              new Point(BOX / 2, -BOX / 2),
              new Point(BOX / 2, BOX / 2),
              new Point(-BOX / 2, BOX / 2),
            ],
            common,
          );
      }
    };
    const kinds = ["Rect", "Circle", "Ellipse", "Triangle", "Polygon"] as const;

    /** The region each kind takes, plus the box it took it from. */
    const taken: {
      readonly region: {
        left: number;
        top: number;
        width: number;
        height: number;
      };
      readonly bounds: {
        left: number;
        top: number;
        width: number;
        height: number;
      };
    }[] = [];
    for (const kind of kinds) {
      const s = magenta();
      const object = make(kind);
      s.canvas.add(object);
      s.canvas.renderAll();
      expect(s.errors, `${kind} composites`).toEqual([]);
      const region = s.regions[0];
      expect(region, `${kind} sampled a region`).toBeDefined();
      taken.push({
        region: region ?? { left: 0, top: 0, width: 0, height: 0 },
        bounds: object.getBoundingRect(),
      });
    }

    // Every box is the box; the first is the baseline and each of the rest has
    // to match it exactly, which is what "the pad never sees the outline" is.
    const base = taken[0];
    if (base === undefined) return;
    for (const [index, { region, bounds }] of taken.entries()) {
      const kind = kinds[index];
      expect(bounds.width, `${kind} shares the box`).toBe(base.bounds.width);
      expect(bounds.height, `${kind} shares the box`).toBe(base.bounds.height);
      expect(region, `${kind} samples the same region`).toEqual(base.region);
    }
  });

  it("refuses an open path rather than clipping it to its box", () => {
    // The exclusion, proved where the renderer can still be handed one. A
    // validated theme never gets this far — `renderer-core` refuses the
    // treatment on a `Polyline` at import — so this is the hand-edited scene
    // and the check that it degrades into a report rather than into a frosted
    // box around a shape with no interior.
    const s = magenta();
    s.canvas.add(
      new Polyline([new Point(0, -25), new Point(25, 25), new Point(-25, 25)], {
        left: 100,
        top: 100,
        fill: "transparent",
        ...GLASS,
      }),
    );
    s.canvas.renderAll();

    expect(s.draws, "nothing composites").toHaveLength(0);
    expect(s.errors[0]).toContain("no closed path to clip");
    // The proof that this is the geometry and not the class name: a `Polyline`
    // is a sibling of `Polygon` here, not a parent, so nothing about the
    // instance hierarchy could have made the test pass by accident.
    const polyline = s.canvas.getObjects()[0] as Polyline;
    expect(polyline).toBeInstanceOf(Polyline);
    expect(polyline).not.toBeInstanceOf(Polygon);
  });

  /**
   * The probe that only a **sector** clip passes.
   *
   * A `Wedge` extends `Circle`, so the circle's clip path — `ctx.ellipse` from
   * `startAngle` to `endAngle` — is inherited for free, and as a clip path that
   * arc is closed by its **chord**, not by the two radii. The chord cuts the
   * sector's own area in half: a 90° sweep of radius 30 is 707 units² as a
   * sector and 257 as the segment that chord encloses. So the frost would cover
   * the crescent along the arc while the triangle beside the centre — most of
   * what a wedge paints — stayed sharp.
   *
   * The probe is therefore inside the sector and on the **centre side of the
   * chord**, which is the region the inherited clip excludes. A point merely
   * inside the sweep cannot tell the two apart: both clips cover it, which is
   * why this one is placed and not chosen by eye.
   */
  it("clips a wedge to the sector, not to the chord its parent would clip", () => {
    // radius 30 at (100,100), swept 0..90. The chord joins (130,100) to
    // (100,130), so it is the line x + y = 230. (112,112) is 17.0 from the
    // centre — well inside the disc — and x + y = 224, so it sits on the centre
    // side of the chord, inside the sector and outside the segment.
    const { s, without } = frosted(
      (withGlass) =>
        new Wedge({
          left: 100,
          top: 100,
          radius: 30,
          startAngle: 0,
          endAngle: 90,
          fill: "transparent",
          ...(withGlass ? GLASS : {}),
        }),
    );
    expect(s.errors).toEqual([]);
    expect(s.draws, "the wedge composites").toHaveLength(1);

    // The half that fails without the sector branch: inside the wedge, so the
    // backdrop has to reach it. The inherited chord clip leaves it clear.
    expect(s.pixel(112, 112)[3], "inside the sector").toBe(255);
    expect(without.pixel(112, 112)[3]).toBeLessThan(255);

    // And the other half, so the fix is not "clip to the whole box": (78,78) is
    // 31.1 from the centre, outside the disc and so outside any sweep of it.
    expect(s.pixel(78, 78)).toEqual(without.pixel(78, 78));
    expect(without.pixel(78, 78)[3]).toBe(0);
  });
});

/**
 * What the two surfaces do with a sweep, and what these cases can show about it.
 *
 * The sector path is one function called by the wedge's own `_render` and by the
 * frost's clip, because two copies is two chances to spell the angle conversion
 * differently and the two already differed once — `glass.ts` had a `radians()`
 * helper while the shape inlined the multiply. When they drift, the frost clips
 * to a region the shape does not paint: wrong, and silent.
 *
 * **These cases show agreement, not sharing.** A duplicated copy that happens to
 * agree would pass them, so what is pinned is that the two surfaces cover the same
 * region — which is the property that actually matters and the one a drifted copy
 * breaks. Sharing is settled by reading `sector-object.ts`, not by a test: no
 * rendered output can distinguish one call from two that agree.
 */
describe("the two surfaces of a sweep", () => {
  it("refuses an arc rather than clipping it to a region it has no interior for", () => {
    // An arc paints a curve, so there is nothing to sample the backdrop through.
    // `localPath` says so itself rather than letting the `Circle` arm it extends
    // stand in, and the composite is the observable: nothing is drawn at all.
    const stage = magenta();
    const options = {
      left: 100,
      top: 100,
      radius: 30,
      startAngle: 0,
      endAngle: 90,
      fill: "transparent",
    };
    stage.canvas.add(new Arc({ ...options, ...GLASS }));
    stage.canvas.renderAll();

    expect(stage.draws, "nothing composites").toHaveLength(0);
    expect(stage.errors[0]).toContain("no closed path to clip");
  });
});
