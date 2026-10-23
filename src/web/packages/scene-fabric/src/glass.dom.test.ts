// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { mountBackgroundMedia } from "./background-media.js";
import {
  bars,
  Group,
  Point,
  panel,
  Rect,
  StaticCanvas,
  stage,
} from "./glass-test-stage.js";

describe("glass composition", () => {
  it("samples the backdrop, not the panel's own already-painted fill", () => {
    const withGlass = stage({});
    const without = stage({});
    for (const s of [withGlass, without]) {
      s.canvas.add(
        new Rect({
          left: 0,
          top: 0,
          width: 200,
          height: 200,
          originX: "left",
          originY: "top",
          fill: "#000000",
          selectable: false,
          evented: false,
        }),
      );
    }
    const glassed = panel();
    withGlass.canvas.add(glassed);
    without.canvas.add(panel());
    withGlass.canvas.renderAll();
    without.canvas.renderAll();

    // Prove the probe is where it is meant to be: inside the panel, on the
    // uniform black plate, and away from its edges.
    expect(glassed.containsPoint(new Point(100, 100))).toBe(true);
    const withValue = withGlass.pixel(100, 100);
    const plain = without.pixel(100, 100);
    // 50% white over black is 127 either way, so a *uniform* plate cannot tell
    // a correct sample from a self-sampled one. What separates them is the
    // clip: with the clip the panel returns to exactly the untinted value, and
    // a self-sampled panel would come back lighter, because the sampled region
    // would already carry the fill.
    expect(plain[0]).toBeGreaterThan(120);
    expect(plain[0]).toBeLessThan(135);
    expect(withValue).toEqual(plain);
    expect(withGlass.draws).toHaveLength(1);
  });

  it("leaves an object painted after the panel bit-for-bit unchanged", () => {
    const withGlass = stage({});
    const without = stage({});
    for (const s of [withGlass, without]) {
      s.canvas.add(panel());
      s.canvas.add(
        new Rect({
          left: 84,
          top: 84,
          width: 4,
          height: 32,
          originX: "left",
          originY: "top",
          fill: "#ff0000",
          selectable: false,
          evented: false,
        }),
      );
    }
    withGlass.canvas.renderAll();
    without.canvas.renderAll();

    // Prove the bar is really there before claiming it survived.
    expect(without.pixel(86, 100)[0]).toBe(255);
    expect(without.pixel(86, 100)[1]).toBe(0);
    for (const y of [90, 100, 110])
      expect(withGlass.pixel(86, y)).toEqual(without.pixel(86, y));
  });

  it("lets an overlapping panel sample the earlier one that is already painted", () => {
    const withGlass = stage({});
    const without = stage({});
    const probe = { x: 110, y: 100 };
    // The earlier panel covers 60..120; the glass panel 80..140, so the
    // intersection is 80..120 x 80..120 and the probe sits inside it.
    const earlierAt = (): Rect =>
      new Rect({
        left: 60,
        top: 80,
        width: 60,
        height: 40,
        originX: "left",
        originY: "top",
        fill: "#00ff00",
        selectable: false,
        evented: false,
      });
    for (const s of [withGlass, without]) {
      s.canvas.add(earlierAt());
      s.canvas.add(panel({ width: 60, height: 40 }));
    }
    withGlass.canvas.renderAll();
    without.canvas.renderAll();

    // Match set first: the probe must be inside the earlier panel AND inside
    // the glass panel, or the assertion below would pass for the wrong reason.
    const glassed = without.canvas.getObjects()[
      bars(200, 200, 8, "#fff", "#000").length + 1
    ] as Rect;
    expect(glassed).toBeInstanceOf(Rect);
    expect(earlierAt().containsPoint(new Point(probe.x, probe.y))).toBe(true);
    expect(glassed.containsPoint(new Point(probe.x, probe.y))).toBe(true);
    // And the overlap is real: green shows through where the glass sits.
    const overlap = without.pixel(probe.x, probe.y);
    expect(overlap[1]).toBeGreaterThan(overlap[0] + 40);

    // The glass panel covers the same pixels, so if its sample missed the
    // earlier panel the artboard behind it would show instead of green.
    const under = withGlass.pixel(probe.x, probe.y);
    expect(under[1]).toBeGreaterThan(under[0] + 40);
  });

  it("composites a grouped panel the same as a flattened one and stays in bounds", () => {
    const grouped = stage({ backdrop: () => ({ paint: () => true }) });
    const flat = stage({ backdrop: () => ({ paint: () => true }) });
    const inside = new Group([panel({ left: -20, top: -20 })], {
      left: 140,
      top: 140,
      angle: 30,
      objectCaching: false,
    });
    grouped.canvas.add(inside);
    flat.canvas.add(panel({ left: 120, top: 120 }));
    grouped.canvas.renderAll();
    flat.canvas.renderAll();

    // Both panels are centred on the same point over the same backdrop.
    const centre = { x: 140, y: 140 };
    const child = inside.getObjects()[0] as Rect;
    expect(child.getCenterPoint().x).toBeCloseTo(centre.x, 5);
    expect(child.getCenterPoint().y).toBeCloseTo(centre.y, 5);
    expect(grouped.pixel(centre.x, centre.y)).toEqual(
      flat.pixel(centre.x, centre.y),
    );
    expect(flat.pixel(centre.x, centre.y)[0]).toBeGreaterThan(120);

    // The rotated group samples a strictly larger box than the flat panel, and
    // that box is still inside the surface — the probe's out-of-bounds case.
    const rotated = grouped.regions[0];
    const axisAligned = flat.regions[0];
    expect(rotated).toBeDefined();
    expect(axisAligned).toBeDefined();
    expect(rotated?.width ?? 0).toBeGreaterThan(axisAligned?.width ?? 0);
    expect(rotated?.left ?? -1).toBeGreaterThanOrEqual(0);
    expect(rotated?.top ?? -1).toBeGreaterThanOrEqual(0);
    expect((rotated?.left ?? 0) + (rotated?.width ?? 0)).toBeLessThanOrEqual(
      200,
    );
    expect((rotated?.top ?? 0) + (rotated?.height ?? 0)).toBeLessThanOrEqual(
      200,
    );
  });

  it("gives the surface a grain, and gives it to the surface only", () => {
    // A flat backdrop, so every variation inside the panel is the grain and
    // nothing else. The panel's own fill is cleared, or it would cover the very
    // pixels this reads.
    const flat = stage({
      texture: false,
      backdrop: () => ({
        paint: (ctx, region) => {
          ctx.fillStyle = "#404040";
          ctx.fillRect(0, 0, region.width, region.height);
          return true;
        },
      }),
    });
    flat.canvas.add(panel({ fill: "transparent" }));
    flat.canvas.renderAll();

    /** The spread of a horizontal run, which a flat surface cannot have. */
    const run = (s: typeof flat, from: number, to: number): number => {
      let low = 255;
      let high = 0;
      for (let x = from; x < to; x += 1) {
        const [r = 0] = s.pixel(x, 100);
        low = Math.min(low, r);
        high = Math.max(high, r);
      }
      return high - low;
    };

    // **Inside the panel** (80..120) the surface is not one value. This is the
    // assertion that fails outright if the grain is removed, which is what makes
    // it the regression rather than a description.
    const inside = run(flat, 86, 114);
    expect(inside, "the panel's surface is grained").toBeGreaterThan(0);
    // **And it is still the backdrop.** Grain is a texture on the glass, not a
    // grey haze laid over it: the run stays in the backdrop's own neighbourhood
    // rather than drifting towards mid-grey.
    expect(
      Math.abs(flat.pixel(100, 100)[0]! - 0x40),
      "the grain does not wash the backdrop towards grey",
    ).toBeLessThan(24);

    // **Outside the panel** (120..) the same run is the flat media, untouched:
    // the grain rides the glass and is not a filter over the whole surface.
    expect(run(flat, 124, 160), "no grain outside the panel").toBe(0);
  });

  it("paints the same grain twice, so the surface does not crawl", () => {
    // An unseeded tile is a different texture on every frame, which reads as
    // static rather than as a material. Two identical renders are the claim.
    const render = (): number[] => {
      const s = stage({
        texture: false,
        backdrop: () => ({
          paint: (ctx, region) => {
            ctx.fillStyle = "#404040";
            ctx.fillRect(0, 0, region.width, region.height);
            return true;
          },
        }),
      });
      s.canvas.add(panel({ fill: "transparent" }));
      s.canvas.renderAll();
      return Array.from(
        { length: 12 },
        (_, index) => s.pixel(88 + index, 100)[0]!,
      );
    };
    expect(render()).toEqual(render());
  });

  it("clips to the rounded path and samples a padded box", () => {
    // A solid magenta backdrop over a transparent canvas makes the clip
    // observable: the media is the only thing there, so an unclipped draw would
    // repaint the rounded-off corner too.
    const magenta = stage({
      texture: false,
      backdrop: () => ({
        paint: (ctx, region) => {
          ctx.fillStyle = "#ff00ff";
          ctx.fillRect(0, 0, region.width, region.height);
          return true;
        },
      }),
    });
    const without = stage({ texture: false });
    for (const s of [magenta, without])
      s.canvas.add(panel({ rx: 20, ry: 20, width: 60, height: 60 }));
    magenta.canvas.renderAll();
    without.canvas.renderAll();

    // Match set, derived rather than assumed. The panel spans 80..140 with a
    // 20px corner, so the top-left arc is centred at (100,100) with radii 20.
    const corner = { x: 84, y: 84 };
    expect(
      ((corner.x - 100) / 20) ** 2 + ((corner.y - 100) / 20) ** 2,
    ).toBeGreaterThan(1);
    // It is inside the bounding box, so only the rounding can exclude it.
    expect(corner.x).toBeGreaterThan(80);
    expect(corner.y).toBeGreaterThan(80);

    // The corner is outside the clip, so glass leaves it exactly as it was:
    // the panel's own 50% white over nothing.
    expect(magenta.pixel(corner.x, corner.y)).toEqual(
      without.pixel(corner.x, corner.y),
    );
    // The centre is inside: the media is opaque there, where without glass the
    // canvas is transparent under the panel's 50% white.
    const inside = magenta.pixel(110, 110);
    const bare = without.pixel(110, 110);
    expect(bare[3]).toBeGreaterThan(100);
    expect(bare[3]).toBeLessThan(160);
    expect(inside[3]).toBe(255);
    // Magenta has no green, and the panel's white adds a little back.
    expect(inside[1]).toBeLessThan(bare[1] - 80);
    expect(inside[0]).toBe(255);
    expect(inside[2]).toBe(255);

    // Padding: the sample must reach at least a full blur radius past the
    // panel on every side, or the blur eats its own edge and the panel shows a
    // dark rim where the kernel had nothing to sample.
    const bounds = magenta.canvas.getObjects()[0] as Rect;
    bounds.setCoords();
    const box = bounds.getBoundingRect();
    const region = magenta.regions[0];
    expect(region).toBeDefined();
    expect(region?.left ?? 0).toBeLessThanOrEqual(box.left - 24);
    expect(region?.top ?? 0).toBeLessThanOrEqual(box.top - 24);
    expect((region?.left ?? 0) + (region?.width ?? 0)).toBeGreaterThanOrEqual(
      box.left + box.width + 24,
    );
  });

  it("resolves a moved panel's bounds fresh rather than from the last setCoords", () => {
    const s = stage({ backdrop: () => ({ paint: () => true }) });
    const object = panel();
    s.canvas.add(object);
    s.canvas.renderAll();
    const first = { ...s.regions[0] };

    // A programmatic move does not go through Fabric's gesture handlers, which
    // are what normally refresh the memoised bounds.
    object.set({ left: 120, top: 60 });
    s.canvas.renderAll();
    const second = s.regions[1];

    expect(second?.left ?? 0).toBeGreaterThan(first.left ?? 0);
    expect(second?.top ?? 0).toBeLessThan(first.top ?? 0);
    // The sample followed the panel by exactly the distance it moved, padding
    // included; a stale bound would leave it where the panel used to be.
    expect((second?.left ?? 0) - (first.left ?? 0)).toBe(40);
    expect((first.top ?? 0) - (second?.top ?? 0)).toBe(20);
  });

  it("hands the media the artboard rect in device pixels, not the camera zoom", () => {
    // The media layer is positioned in CSS pixels, so the plane scale used to
    // convert its bounds would apply the camera zoom a second time. Carrying the
    // artboard rect instead makes it right at any zoom, and the zoom is what
    // this case exists to vary: a fit camera is not 1:1.
    const s = stage({ artboard: { width: 200, height: 200 } });
    s.canvas.setViewportTransform([0.5, 0, 0, 0.5, 40, 20]);
    s.canvas.add(panel({ yunariGlass: { blurRadius: 8 } }));
    s.canvas.renderAll();

    expect(s.paints).toHaveLength(1);
    const device = s.paints[0]?.device;
    // 200 artboard units through a 0.5 viewport at offset (40, 20): 100x100 at
    // (40, 20). The old derivation produced 200x200 at (80, 40).
    expect(device).toEqual({ left: 40, top: 20, width: 100, height: 100 });
    // And the panel's own region still follows the same matrix.
    expect(s.regions[0]?.left).toBeGreaterThanOrEqual(0);
    expect(s.regions[0]?.top).toBeGreaterThanOrEqual(0);
  });

  it("maps a display-filled backdrop's own rect, not the artboard, onto the surface", () => {
    // 0075's case, and the one nothing else here reaches: under
    // `bounds: "display"` the layer covers the display box, which is larger
    // than the artboard and starts outside it, so `media.rect.left`/`top` are
    // non-zero. Every other case on this stage builds a theme rect
    // (`{0, 0, artboard}`), which exercises those two terms at zero and would
    // not notice them dropped.
    const s = stage({
      // Big enough for the panel once the viewport transform has moved it.
      size: 400,
      artboard: { width: 400, height: 200 },
      backdropRect: { left: -5, top: -10, width: 600, height: 250 },
    });
    s.canvas.setViewportTransform([2, 0, 0, 2, 40, 60]);
    s.canvas.add(panel({ yunariGlass: { blurRadius: 8 } }));
    s.canvas.renderAll();

    // The same plane the artboard goes through: 40 + (-5 * 2) = 30, 60 + (-10 *
    // 2) = 40, 600 * 2 = 1200, 250 * 2 = 500. The theme rect would give
    // {40, 60, 800, 400} — the board, not the layer.
    expect(s.paints[0]?.device).toEqual({
      left: 30,
      top: 40,
      width: 1200,
      height: 500,
    });
  });

  it("walks a display-filled layer from its own box to the device rect", () => {
    // 0075's three numbers in one place: the box the layer sits on, the rect the
    // media reports for it in artboard units, and the device rect the sampler
    // computes from that rect. Each half is asserted elsewhere — the box and the
    // rect in `background-media.dom.test.ts`, rect→device above with a hand-made
    // rect — and neither of those would notice the two disagreeing. This is the
    // join, and it is what makes a wrong rect visible rather than plausible.
    const host = document.createElement("div");
    const media = mountBackgroundMedia({
      host,
      artboard: { width: 400, height: 200 },
      background: { media: { assetId: "hero", bounds: "display" } },
      assets: [{ id: "hero", kind: "image", path: "assets/hero.png" }],
      resolveAsset: () => ({ url: "blob:hero" }),
    });
    // The plane the scene sets for this artboard: 2x at (40, 60), so the board's
    // own box is 800x400 and the display's is the host's 1200x500.
    media.setBounds({
      artboard: { left: 40, top: 60, width: 800, height: 400 },
      display: { left: 0, top: 0, width: 1200, height: 500 },
    });
    const layer = host.querySelector<HTMLElement>(
      "[data-yunari-background-media]",
    );

    expect([
      layer?.style.left,
      layer?.style.top,
      layer?.style.width,
      layer?.style.height,
    ]).toEqual(["0px", "0px", "1200px", "500px"]);

    // Artboard units: the display box pulled back through the plane's scale and
    // origin — (0 - 40)/2, (0 - 60)/2, 1200/2, 500/2.
    const backdrop = media.backdrop();
    expect(backdrop?.rect).toEqual({
      left: -20,
      top: -30,
      width: 600,
      height: 250,
    });

    // And the sampler maps that rect forward through the same plane, landing on
    // the layer's own box.
    const s = stage({ size: 400, backdrop: () => backdrop });
    s.canvas.setViewportTransform([2, 0, 0, 2, 40, 60]);
    s.canvas.add(panel({ yunariGlass: { blurRadius: 8 } }));
    s.canvas.renderAll();

    expect(s.paints[0]?.device).toEqual({
      left: 0,
      top: 0,
      width: 1200,
      height: 500,
    });

    media.destroy();
    host.remove();
  });

  it("keeps the media rect through a capture multiplier at a zoom", () => {
    // Zoom 2, multiplier 3: the plane scale is 6. The old derivation multiplied
    // the already-fit CSS bounds by the plane scale, which at zoom 1 happens to
    // agree with the correct answer and only diverges from here.
    const s = stage({ artboard: { width: 200, height: 200 } });
    s.canvas.setViewportTransform([2, 0, 0, 2, 0, 0]);
    s.canvas.add(panel({ yunariGlass: { blurRadius: 8 } }));
    s.canvas.renderAll();
    s.paints.length = 0;
    s.canvas.toCanvasElement(3);
    expect(s.paints[0]?.device).toEqual({
      left: 0,
      top: 0,
      width: 1200,
      height: 1200,
    });
  });

  it("draws the backdrop at full alpha whatever the panel's own opacity is", () => {
    const s = stage({});
    s.canvas.add(panel({ opacity: 0.5 }));
    s.canvas.renderAll();

    expect(s.draws).toHaveLength(1);
    expect(s.draws[0]?.alpha).toBe(1);
    // The panel's fill is still composited by Fabric, over the backdrop.
    expect(s.pixel(100, 100)[0]).toBeGreaterThan(120);
  });

  it("converts the authored radius to device pixels through the real matrix", () => {
    const filterFor = (
      configure: (canvas: StaticCanvas) => void,
      radius = 24,
    ): string => {
      const s = stage({});
      s.canvas.add(panel({ yunariGlass: { blurRadius: radius } }));
      configure(s.canvas);
      s.canvas.renderAll();
      return s.draws[0]?.filter ?? "none";
    };

    // 1:1 at DPR 1 is the case where artboard units and device pixels coincide,
    // which is exactly why the distinction was invisible until now. The
    // saturation rides in the same filter list: one pass, not two.
    expect(filterFor(() => {})).toBe("blur(24px) saturate(1.6)");
    // **A radius of zero gets no filter at all**, not `saturate` on its own.
    // Saturation exists to put back what a blur averaged away; with nothing
    // diffused there is nothing to put back, and grading an undiffused
    // backdrop would make the blur-off control disagree with the photograph it
    // exists to be a control for.
    expect(filterFor(() => {}, 0)).toBe("none");
    // Zoom halves it.
    expect(
      filterFor((canvas) =>
        canvas.setViewportTransform([0.5, 0, 0, 0.5, 0, 0]),
      ),
    ).toBe("blur(12px) saturate(1.6)");
    // A panel's own scale multiplies it, exactly as its `rx` does.
    const scaled = stage({});
    scaled.canvas.add(panel({ scaleX: 2, scaleY: 2, left: 60, top: 60 }));
    scaled.canvas.renderAll();
    expect(scaled.draws[0]?.filter).toBe("blur(48px) saturate(1.6)");
    // **A non-uniform scale takes the equal-area factor of the two axes**, not
    // `scaleX` (`vg-515`, 0053). These two panels cover the same area — one
    // stretched horizontally, one vertically — so they must blur by the same
    // amount; before the ruling the first read 96 device px and the second 24.
    const wide = stage({});
    wide.canvas.add(panel({ scaleX: 4, scaleY: 1, left: 60, top: 60 }));
    wide.canvas.renderAll();
    expect(wide.draws[0]?.filter).toBe("blur(48px) saturate(1.6)");
    const tall = stage({});
    tall.canvas.add(panel({ scaleX: 1, scaleY: 4, left: 60, top: 60 }));
    tall.canvas.renderAll();
    expect(tall.draws[0]?.filter).toBe("blur(48px) saturate(1.6)");
    // The retina leg, which every other case here leaves at 1 — so both
    // `* retina` terms would otherwise be unexercised. The collaborator Fabric
    // reads the ratio through is stubbed rather than the global, which
    // jsdom pins at 1; a real high-DPI browser is the browser suite's job.
    const dense = stage({});
    dense.canvas.getRetinaScaling = () => 2;
    dense.canvas.add(panel());
    dense.canvas.renderAll();
    expect(dense.draws[0]?.filter).toBe("blur(48px) saturate(1.6)");
    // Zero is a valid treatment and must not be filtered away silently.
    const zero = stage({});
    zero.canvas.add(panel({ yunariGlass: { blurRadius: 0 } }));
    zero.canvas.renderAll();
    expect(zero.draws[0]?.filter).toBe("none");
  });

  it("clips the backdrop over the panel where a scaled viewport puts it", () => {
    // **The matrix has to compose in the object's order, not the transpose of
    // it.** The two agree while the viewport is an unscaled identity, which is
    // what every other case in this file renders at, so a transposed product
    // passed all of them: at zoom 2 this panel's centre belongs at device
    // (281, 281) and the transposed derivation puts it at (141, 141), drawing
    // the blur beside the panel rather than over it. The region's own geometry
    // was already right, which is how the two disagreed.
    const s = stage({ size: 600 });
    s.canvas.add(panel({ left: 120, top: 120, width: 40, height: 40 }));
    s.canvas.setViewportTransform([2, 0, 0, 2, 0, 0]);
    s.canvas.renderAll();

    expect(s.clips).toHaveLength(6);
    const [a, , , d, e, f] = s.clips;
    // The panel's own box is 40x40 at scene (120, 120); its centre is
    // (140.5, 140.5), because Fabric's own matrix carries half the default 1px
    // stroke. Twice that, through a 2x viewport, is 281.
    expect(a).toBeCloseTo(2, 6);
    expect(d).toBeCloseTo(2, 6);
    expect(e).toBeCloseTo(281, 6);
    expect(f).toBeCloseTo(281, 6);
  });

  it("reads the authored radius again after a control changes it in place", () => {
    const s = stage({});
    const glassed = panel({ yunariGlass: { blurRadius: 8 } });
    s.canvas.add(glassed);
    s.canvas.renderAll();
    // The attach's own composite, so the assertion below cannot be satisfied by
    // a draw that happened before the edit.
    s.draws.length = 0;

    // What the inspector's blur field does: the property changes on an object
    // that is already attached, and no add or remove follows it.
    glassed.set("yunariGlass", { blurRadius: 40 });
    s.canvas.renderAll();

    const filters = s.draws.map((draw) => draw.filter);
    expect(s.draws.length).toBeGreaterThan(0);
    expect(filters).toContain("blur(40px) saturate(1.6)");
    expect(filters).not.toContain("blur(8px)");
  });

  it("scales the sample with a toCanvasElement capture multiplier", () => {
    const s = stage({ backdrop: () => ({ paint: () => true }) });
    s.canvas.add(panel());
    s.canvas.renderAll();
    const live = s.regions[0];
    s.draws.length = 0;
    s.regions.length = 0;

    const capture = s.canvas.toCanvasElement(2);
    const doubled = s.regions[0];

    expect(capture.width).toBe(400);
    expect(live?.width).toBeGreaterThan(0);
    // The same panel, twice the pixels. The blur padding is a fixed device-pixel
    // allowance rather than a proportional one, so it does not double exactly.
    expect(doubled?.width ?? 0).toBeGreaterThan(live?.width ?? 0);
    expect(doubled?.width ?? 0).toBeLessThanOrEqual((live?.width ?? 0) * 2 + 8);
    // The composite lands on the capture's own context, not the live one, so
    // the live recorder stays empty; the region is what proves the device scale.
    expect(s.draws).toHaveLength(0);
  });

  it("refuses a sample larger than the bound and still samples a smaller one", () => {
    const big = stage({ size: 3000 });
    big.canvas.backgroundColor = "#000000";
    const wide = new Rect({
      left: 0,
      top: 0,
      width: 3000,
      height: 1500,
      originX: "left",
      originY: "top",
      yunariGlass: { blurRadius: 48 },
    });
    big.canvas.add(wide);
    big.canvas.renderAll();

    // Match set: the panel is on the surface and covers it, and 3000x1500 is
    // past the 4,194,304 px bound, so the refusal is about extent and nothing else.
    expect(wide.isOnScreen()).toBe(true);
    expect(3000 * 1500).toBeGreaterThan(4_194_304);
    expect(big.errors[0]).toContain("too large to sample");
    expect(big.glass.liveSurfaces()).toBe(0);
    expect(big.draws).toHaveLength(0);

    const small = stage({ size: 3000 });
    small.canvas.backgroundColor = "#000000";
    small.canvas.add(panel({ left: 100, top: 100 }));
    small.canvas.renderAll();
    expect(small.errors).toEqual([]);
    expect(small.glass.liveSurfaces()).toBe(1);
    expect(small.draws).toHaveLength(1);
  });

  it("reports a tainted or otherwise failing backdrop instead of throwing mid-render", () => {
    // Cross-origin media taints the scratch, and the next draw throws
    // `SecurityError`. A panel must not take the frame down with it.
    const s = stage({
      backdrop: () => ({
        paint: () => {
          throw new Error(
            "SecurityError: tainted canvases may not be exported",
          );
        },
      }),
    });
    s.canvas.add(panel());
    expect(() => s.canvas.renderAll()).not.toThrow();
    expect(s.errors).toHaveLength(1);
    expect(s.errors[0]).toContain("tainted canvases may not be exported");
    expect(s.errors[0]).toContain("failed");

    // A second frame is the same failure, and must not flood the host.
    s.canvas.renderAll();
    expect(s.errors).toHaveLength(1);
  });

  it("composites without media, and without a report, when the source has no pixels", () => {
    const absent = stage({});
    absent.canvas.add(panel());
    absent.canvas.renderAll();
    expect(absent.draws).toHaveLength(1);
    expect(absent.errors).toEqual([]);

    const empty = stage({ backdrop: () => ({ paint: () => false }) });
    empty.canvas.add(panel());
    empty.canvas.renderAll();
    expect(empty.draws).toHaveLength(1);
    expect(empty.regions).toHaveLength(1);
    expect(empty.errors).toEqual([]);
  });

  it("never samples an ancestor group's own cache", () => {
    const s = stage({ backdrop: () => ({ paint: () => true }) });
    const group = new Group([panel()], {
      left: 100,
      top: 100,
      objectCaching: false,
    });
    s.canvas.add(group);
    s.canvas.renderAll();
    expect(s.draws).toHaveLength(1);
    expect(s.errors).toEqual([]);

    // Force caching back on after attach: the child now paints into the
    // group's cache, whose backdrop is the panel's own already-painted pixels.
    group.objectCaching = true;
    s.draws.length = 0;
    s.errors.length = 0;
    s.canvas.renderAll();
    expect(s.draws).toHaveLength(0);
    expect(s.errors[0]).toContain("caches its children");
  });

  it("refuses a group, which Fabric gives no render boundary", () => {
    const s = stage({});
    s.canvas.add(
      new Group(
        [
          new Rect({
            left: 80,
            top: 80,
            width: 40,
            height: 40,
            originX: "left",
            originY: "top",
            fill: "rgba(255, 255, 255, 0.5)",
          }),
        ],
        { left: 100, top: 100, yunariGlass: { blurRadius: 24 } } as Record<
          string,
          unknown
        >,
      ),
    );
    s.canvas.renderAll();
    expect(s.draws).toHaveLength(0);
    expect(s.errors[0]).toContain("no render boundary");
  });

  it("re-attaches after revival replaces object identity", async () => {
    const s = stage({});
    s.canvas.add(panel());
    s.canvas.renderAll();
    expect(s.draws).toHaveLength(1);

    await s.canvas.loadFromJSON({
      version: "7.4.0",
      objects: [
        {
          type: "Rect",
          id: "revived",
          left: 80,
          top: 80,
          width: 40,
          height: 40,
          fill: "rgba(255, 255, 255, 0.5)",
          yunariGlass: { blurRadius: 24 },
        },
      ],
    });
    s.draws.length = 0;
    s.canvas.renderAll();

    expect(s.draws).toHaveLength(1);
    expect(s.glass.liveSurfaces()).toBe(1);
  });

  it("restores the context when the composite throws mid-draw", () => {
    // A tainting draw throws after the handler has clipped to the panel's path
    // and put the identity transform in place for the final draw. Fabric's own
    // save/restore wraps the whole object, but not the state left between the
    // throw and the object's own paint.
    //
    // The leak that matters is the **clip**, not the alpha or the shadow: the
    // path was built centred on the object's local origin, so under the identity
    // transform the panel's fill lands at (-20,-20)-(20,20) - outside the clip it
    // left behind at (80,80)-(120,120) - and is discarded. The sample then reads
    // the black plate. A leaked alpha of 1 would only make the fill brighter.
    const withGlass = stage({});
    const without = stage({});
    for (const stageUnderTest of [withGlass, without]) {
      stageUnderTest.canvas.add(
        new Rect({
          left: 0,
          top: 0,
          width: 200,
          height: 200,
          originX: "left",
          originY: "top",
          fill: "#000000",
          selectable: false,
          evented: false,
        }),
      );
      stageUnderTest.canvas.add(panel({ opacity: 0.5 }));
    }
    withGlass.failNextComposite = true;
    withGlass.canvas.renderAll();
    without.canvas.renderAll();

    // The composite was abandoned, so the panel must paint exactly as it would
    // with no glass at all: 0.5 object opacity over a 0.5 white fill over black
    // is 63, not 127 - the 127 is a half-opacity white on its own. Removing the
    // `finally` makes the panel read black instead, because the fill is clipped
    // away. That is the whole point of restoring the context.
    expect(withGlass.errors[0]).toContain("tainted canvases");
    expect(withGlass.pixel(100, 100)).toEqual(without.pixel(100, 100));
  });

  it("asks once whether the browser can filter, however many panels", () => {
    const s = stage({});
    s.canvas.add(panel());
    s.canvas.add(panel({ left: 120, top: 120 }));
    s.canvas.renderAll();
    expect(s.filterProbes, "one probe for the whole frame").toBe(1);

    s.canvas.renderAll();
    expect(s.filterProbes, "and none on the next frame").toBe(1);
  });

  it("does not publish a scratch surface it could not get a context for", () => {
    const created = document.createElement.bind(document);
    const opened: HTMLCanvasElement[] = [];
    // Armed only once the stage exists, so Fabric's own canvas still resolves.
    const armed = { now: false };
    (document as unknown as { createElement: typeof created }).createElement =
      ((name: string, options?: ElementCreationOptions) => {
        const element = created(name, options) as HTMLElement;
        if (name === "canvas" && armed.now) {
          // A canvas that refuses a context is the failure this guards: the panel
          // has to fall back to no sample rather than report a live surface it
          // cannot draw into.
          Object.defineProperty(element, "getContext", { value: () => null });
          opened.push(element as HTMLCanvasElement);
        }
        return element;
      }) as typeof created;
    try {
      const s = stage({ texture: false });
      armed.now = true;
      s.canvas.add(panel());
      s.canvas.renderAll();
      expect(opened.length, "a surface was tried").toBeGreaterThan(0);
      expect(s.glass.liveSurfaces(), "but none is live").toBe(0);
      expect(s.draws).toHaveLength(0);
    } finally {
      (document as unknown as { createElement: typeof created }).createElement =
        created;
    }
  });

  it("refuses an unusable corner radius rather than clipping to a square", () => {
    const s = stage({});
    // Present and not a number: reading it as 0 would silently clip to a square
    // nobody authored, which is a different panel from the one asked for.
    s.canvas.add(
      panel({
        rx: "wide" as unknown as number,
        ry: "wide" as unknown as number,
      }),
    );
    s.canvas.renderAll();
    expect(s.draws).toHaveLength(0);
    expect(s.errors[0]).toContain("no closed path to clip");

    // A following, well-formed panel is unaffected: the failed one left no
    // clipped context behind for it.
    s.errors.length = 0;
    s.canvas.add(panel({ left: 120, top: 120 }));
    s.canvas.renderAll();
    expect(s.draws).toHaveLength(1);
    expect(s.errors).toEqual([]);
  });
});
