// @vitest-environment jsdom

/**
 * The glass lifecycle: what the handle re-resolves as the scene changes, and
 * what it releases. The composition suite owns what a frame looks like.
 */

import { describe, expect, it } from "vitest";
import { Group, panel, Rect, stage } from "./glass-test-stage.js";

describe("glass lifecycle", () => {
  it("re-resolves on a group membership change, which the canvas never fires", () => {
    // `Group.add`/`Group.remove` are how grouping, ungrouping and a delete
    // inside a group re-parent an object, and neither reaches the canvas's
    // `object:added`/`object:removed`. Both directions matter and they are
    // different failures: a group that gains a panel must stop caching or the
    // panel samples that cache, and a group that loses its last panel must get
    // its caching back or an ordinary group is left permanently uncached.
    const s = stage({});
    const group = new Group([], { left: 0, top: 0 });
    s.canvas.add(group);
    const loose = panel();
    s.canvas.add(loose);
    s.canvas.renderAll();
    expect(loose.objectCaching, "a panel is uncached for itself").toBe(false);
    expect(group.objectCaching, "an empty group keeps its own caching").toBe(
      true,
    );

    // The join. Nothing but the group fires here.
    group.add(loose);
    expect(
      group.objectCaching,
      "the group is uncached once it holds a panel",
    ).toBe(false);
    s.canvas.renderAll();
    expect(s.errors).toEqual([]);

    // And the release: the group goes back to ordinary the moment it is empty.
    group.remove(loose);
    expect(
      group.objectCaching,
      "an empty group is handed its caching back",
    ).toBe(true);
  });

  it("re-samples the pixels a palette change repaints below the panel", () => {
    // A palette change is the editor's `applyObjectPalettePaints` rewriting the
    // fill of objects under the panel. Nothing about the panel moves, so a
    // stale backdrop is invisible in the region - it shows in the pixels the
    // panel was handed.
    const s = stage({ texture: false });
    s.canvas.add(
      new Rect({
        left: 0,
        top: 0,
        width: 200,
        height: 200,
        originX: "left",
        originY: "top",
        fill: "#0000ff",
        selectable: false,
        evented: false,
      }),
    );
    s.canvas.add(panel({ yunariGlass: { blurRadius: 8 } }));
    s.canvas.renderAll();
    const before = s.pixel(100, 100);

    (s.canvas.getObjects()[0] as Rect).set("fill", "#ff0000");
    s.canvas.renderAll();
    const after = s.pixel(100, 100);

    // Match set: the panel is still there and still sampling in both frames,
    // so the difference is the backdrop and not the panel going away. The
    // panel's own 50% white fill sits over the sample in both frames, so the
    // claim is on the channel's *movement*, not on an absolute.
    expect(s.draws.length, "the panel composited in both frames").toBe(2);
    expect(before[2], "the panel sampled the blue plate").toBeGreaterThan(200);
    expect(after[0], "the red plate reached the panel").toBeGreaterThan(200);
    expect(
      before[2] - after[2],
      "and the blue channel gave way to it",
    ).toBeGreaterThan(100);
  });

  it("widens the sample when the panel rotates, and doubles it when the camera does", () => {
    // Both change the panel's device box, and a stale read would keep the old
    // one. Asserted on the region, which is what the sampler hands the media.
    // A 600 px surface with the panel well inside it, so neither the 30 deg
    // rotation nor the 2x camera clamps the box against an edge. A clamp makes
    // the sample *smaller*, which would let this pass for the wrong reason -
    // measured, a 400 px surface with this panel clamps at 2x and reports 258
    // against an expected 282.
    const s = stage({ size: 600, backdrop: () => ({ paint: () => true }) });
    const subject = panel({ left: 200, top: 200 });
    s.canvas.add(subject);
    s.canvas.renderAll();
    const axisAligned = s.regions[0];
    expect(axisAligned?.width ?? 0).toBeGreaterThan(0);

    subject.set("angle", 30);
    s.canvas.renderAll();
    const rotated = s.regions[s.regions.length - 1];
    // A rotated square's axis-aligned box is larger, and the blur padding rides
    // on top of it, so the sample has to grow.
    expect(
      rotated?.width ?? 0,
      "a rotated panel samples a wider box",
    ).toBeGreaterThan(axisAligned?.width ?? 0);

    // Back to square, and out to 2x: the same artboard, a different camera.
    subject.set("angle", 0);
    s.canvas.setViewportTransform([2, 0, 0, 2, 0, 0]);
    s.canvas.renderAll();
    const zoomed = s.regions[s.regions.length - 1];
    // The padding is a fixed device-pixel allowance, so a doubled camera is
    // close to - and not exactly - double.
    expect(
      Math.abs((zoomed?.width ?? 0) - (axisAligned?.width ?? 0) * 2),
      "a doubled camera roughly doubles the sample",
    ).toBeLessThan(8);
  });

  it("leaves a refused panel's object exactly as the author set it", () => {
    // The ancestor walk switches caching off for whatever it is given, so
    // running it on something the renderer has already refused leaves that
    // object permanently uncached for a blur that is never drawn. A group is
    // the case: Fabric gives it no render boundary, so it is refused, and an
    // ordinary group must come back as an ordinary group.
    const s = stage({});
    const group = new Group(
      [
        new Rect({
          left: 0,
          top: 0,
          width: 40,
          height: 40,
          originX: "left",
          originY: "top",
          fill: "rgba(255, 255, 255, 0.5)",
        }),
      ],
      {
        left: 100,
        top: 100,
        yunariGlass: { blurRadius: 24 },
      } as Record<string, unknown>,
    );
    s.canvas.add(group);
    s.canvas.renderAll();

    expect(s.errors[0]).toContain("no render boundary");
    expect(group.objectCaching, "a refused group keeps its own caching").toBe(
      true,
    );
    expect(s.draws, "and nothing was composited").toHaveLength(0);
  });

  it("keeps a shared group uncached until its last panel leaves it", () => {
    const s = stage({});
    const first = panel();
    const second = panel({ left: 120, top: 120 });
    const group = new Group([first, second], { left: 0, top: 0 });
    s.canvas.add(group);
    s.canvas.renderAll();
    expect(group.objectCaching, "the group is uncached for the panels").toBe(
      false,
    );
    expect(s.draws).toHaveLength(2);

    // The first to leave recorded the group and is the one that could hand it
    // back too early, stranding the panel that is still sampling it.
    group.remove(first);
    s.canvas.renderAll();
    expect(
      group.objectCaching,
      "the surviving panel still needs the group uncached",
    ).toBe(false);
    expect(s.errors).toEqual([]);
    expect(s.draws).toHaveLength(3);

    // And once the last one goes, the group is an ordinary group again.
    group.remove(second);
    s.canvas.renderAll();
    expect(group.objectCaching).toBe(true);
  });

  it("keeps an ancestor's opacity on the backdrop and drops only the panel's", () => {
    // The rule: a group's opacity belongs to its whole subtree, and the backdrop
    // is part of that subtree, so it keeps it. The panel's own opacity is the
    // one factor excluded, because Fabric applies that to the panel's fill
    // immediately after this event and the backdrop is the scene rather than
    // the panel - applying it to both would fade the blur twice.
    //
    // A **real** group, because the alpha this asserts is Fabric's, and a
    // hand-fed one would pass even if Fabric stopped multiplying ancestor
    // opacity into the context. `stage` records what the composite wrote, on
    // the surface it painted on.
    //
    // This is only observable at all because the glass handle keeps the chain
    // uncached: a panel left cached renders into its *own* cache, whose context
    // carries no ancestor alpha at all, and the composite would divide by the
    // panel's own against a standing 1. That dependency is asserted below.
    const compositeWith = (
      ancestor: number,
      own: number,
    ): { alpha: number; panel: Rect } => {
      const s = stage({ texture: false });
      const subject = panel({ yunariGlass: { blurRadius: 8 }, opacity: own });
      s.canvas.add(
        new Group([subject], { left: 100, top: 100, opacity: ancestor }),
      );
      s.canvas.renderAll();
      return { alpha: s.draws[0]?.alpha ?? -1, panel: subject };
    };

    // Every case lands on the ancestor's own fade, whatever the panel's is:
    // that is the whole rule in one line.
    expect(compositeWith(0.5, 1).alpha, "a half-opacity ancestor").toBe(0.5);
    expect(
      compositeWith(0.5, 0.5).alpha,
      "and a half-opacity panel inside it",
    ).toBe(0.5);
    expect(
      compositeWith(0.25, 0.5).alpha,
      "quarter-opacity ancestor, half-opacity panel",
    ).toBe(0.25);
    expect(compositeWith(1, 1).alpha, "no ancestor and no panel fade").toBe(1);
    expect(
      compositeWith(1, 0.25).alpha,
      "a panel fade alone leaves the backdrop at full strength",
    ).toBe(1);

    // A **premise check**, not a second behaviour: it states the condition
    // under which the readings above mean anything, and would catch the
    // uncaching regressing. It does not exercise a cached panel - a cached
    // *group* is refused by the cache-context guard, and a cached *panel*
    // never reaches the composite at all, so there is no "reads 2" case here.
    const reading = compositeWith(0.5, 0.5);
    expect(reading.panel.objectCaching, "the panel is not cached").toBe(false);
    expect(reading.alpha, "and the reading above used that").toBe(0.5);
  });

  it("refuses a panel whose own opacity cannot be divided out", () => {
    // A zero opacity never reaches here - Fabric's `isNotVisible()` is exactly
    // `opacity === 0` - so a hand-edited negative is what actually exercises
    // the guard, and dividing by it would put a negative into the frame.
    const s = stage({ texture: false });
    s.canvas.add(
      panel({
        yunariGlass: { blurRadius: 8 },
        opacity: -0.5,
      }),
    );
    s.canvas.renderAll();

    expect(s.draws, "no backdrop is drawn").toHaveLength(0);
    expect(s.errors[0]).toContain("unusable opacity");
  });

  it("releases every scratch surface and listener on dispose", () => {
    const created: HTMLCanvasElement[] = [];
    const original = document.createElement.bind(document);
    (document as unknown as { createElement: typeof original }).createElement =
      ((name: string, options?: ElementCreationOptions) => {
        const element = original(name, options);
        if (name === "canvas") created.push(element as HTMLCanvasElement);
        return element;
      }) as typeof original;

    const perCycle: number[] = [];
    const stillHolding: number[] = [];
    try {
      for (let cycle = 0; cycle < 3; cycle += 1) {
        // No texture: the only canvas this cycle allocates besides Fabric's own
        // is the glass scratch, so the release contract is what is measured.
        const s = stage({ texture: false });
        const before = created.length;
        const mine = s.canvas.lowerCanvasEl;
        s.canvas.add(panel());
        s.canvas.add(panel({ left: 120, top: 120 }));
        s.canvas.renderAll();
        expect(s.glass.liveSurfaces()).toBe(2);
        s.glass.dispose();
        expect(s.glass.liveSurfaces()).toBe(0);

        const scratch = created.slice(before).filter((e) => e !== mine);
        perCycle.push(scratch.length);
        // Backing store still allocated by this cycle's scratch surfaces.
        // Task 1 measured this growing without an explicit release.
        stillHolding.push(scratch.filter((e) => e.width > 0).length);

        // Disposal must stop the panels compositing, not just release memory.
        s.draws.length = 0;
        s.canvas.renderAll();
        expect(s.draws).toHaveLength(0);
        // And it must hand the panels' own caching back, so an ordinary panel
        // is not left permanently uncached because it once carried glass.
        expect(s.canvas.getObjects().every((o) => o.objectCaching)).toBe(true);
      }
    } finally {
      (
        document as unknown as { createElement: typeof original }
      ).createElement = original;
    }

    // Same work each cycle, same allocation each cycle, and every scratch
    // surface left with no backing store behind it.
    expect(new Set(perCycle).size).toBe(1);
    expect(perCycle[0]).toBeGreaterThanOrEqual(2);
    expect(new Set(stillHolding).size).toBe(1);
    expect(stillHolding[0]).toBe(0);
  });

  it("keeps the last backdrop across a frame the media cannot paint", () => {
    // A looping video's `readyState` drops below `HAVE_CURRENT_DATA` at every
    // wrap and `drawImage` refuses it there, so the media paints nothing for
    // 20-35 ms every few seconds (measured). Clearing the scratch first
    // would composite the panel over transparency for that frame - and because
    // the media is a DOM sibling *below* the canvas, the reader sees the raw
    // video through the tint where they normally see the blurred one.
    let canPaint = true;
    const s = stage({
      texture: false,
      backdrop: () => ({
        paint: (ctx, region) => {
          if (!canPaint) return false;
          ctx.fillStyle = "#ff00ff";
          ctx.fillRect(0, 0, region.width, region.height);
          return true;
        },
      }),
    });
    s.canvas.add(panel({ width: 60, height: 60 }));
    s.canvas.renderAll();
    const painted = s.pixel(110, 110);
    expect(painted[0], "the media reached the panel").toBe(255);
    expect(painted[2]).toBe(255);
    expect(painted[3], "and it is opaque there").toBe(255);

    // The seam: the media is asked again and refuses, which is what a video
    // below HAVE_CURRENT_DATA does.
    const asked = s.regions.length;
    canPaint = false;
    s.canvas.renderAll();
    expect(
      s.regions.length,
      "the media was asked again, so the refusal was exercised",
    ).toBeGreaterThan(asked);

    expect(
      s.pixel(110, 110),
      "the frame that could not paint shows what the last one did",
    ).toEqual(painted);

    // A region that moved is the one case that must NOT reuse it: the kept
    // pixels would sit at the wrong offset, which is worse than having none.
    (s.canvas.getObjects()[0] as Rect).set({ left: 40, top: 40 });
    s.canvas.renderAll();
    expect(
      s.pixel(70, 70),
      "a moved panel does not reuse a backdrop from the old offset",
    ).not.toEqual(painted);
  });

  it("releases the kept backdrop with the scratch", () => {
    // The backdrop is a second surface per panel, so it is held to the
    // same release contract: a reference dropped without zeroing leaves its
    // backing store alive until the element is collected.
    const created: HTMLCanvasElement[] = [];
    const original = document.createElement.bind(document);
    (document as unknown as { createElement: typeof original }).createElement =
      ((name: string, options?: ElementCreationOptions) => {
        const element = original(name, options);
        if (name === "canvas") created.push(element as HTMLCanvasElement);
        return element;
      }) as typeof original;
    try {
      const s = stage({
        texture: false,
        backdrop: () => ({ paint: () => true }),
      });
      const before = created.length;
      const mine = s.canvas.lowerCanvasEl;
      s.canvas.add(panel());
      s.canvas.renderAll();

      const surfaces = created.slice(before).filter((e) => e !== mine);
      // The scratch and the kept backdrop, both with a backing store.
      expect(surfaces.length).toBeGreaterThanOrEqual(2);
      expect(surfaces.filter((e) => e.width > 0).length).toBeGreaterThanOrEqual(
        2,
      );

      s.glass.dispose();
      expect(
        surfaces.filter((e) => e.width > 0),
        "dispose releases the backdrop's backing store too",
      ).toHaveLength(0);
    } finally {
      (
        document as unknown as { createElement: typeof original }
      ).createElement = original;
    }
  });
});
