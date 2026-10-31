// @vitest-environment jsdom
import { Canvas, Group, Rect } from "fabric/es";
import { describe, expect, it, vi } from "vitest";
import { IGNORED_IDS } from "./excluded-objects.js";
import { collectSnapSources, createSnapManager } from "./index.js";
import type { MovementSnapCandidateSource } from "./movement-snap-candidates.js";

function setup() {
  const canvas = new Canvas(document.createElement("canvas"));
  const logged = vi.fn();
  const snapping = createSnapManager({
    canvas,
    bounds: () => ({
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      centerX: 200,
      centerY: 150,
    }),
    errors: { error: logged, warn: vi.fn() } as never,
  });
  return { canvas, snapping, logged };
}

describe("SnapManager", () => {
  /** Fires one movement step; each step carries its own browser event, as a real pointermove does. */
  function move(canvas: Canvas, target: unknown, e: object = {}): void {
    canvas.fire("object:moving" as never, { target, e } as never);
  }

  it("nudges a dragged object onto a neighbour's edge", () => {
    const { canvas, snapping } = setup();
    const anchor = new Rect({
      id: "a",
      left: 100,
      top: 20,
      width: 40,
      height: 40,
    });
    const dragged = new Rect({
      id: "b",
      left: 98,
      top: 150,
      width: 40,
      height: 40,
    });
    canvas.add(anchor, dragged);
    canvas.setActiveObject(dragged);

    canvas.fire("mouse:down" as never, { target: dragged } as never);
    move(canvas, dragged);

    expect(dragged.left).toBe(100);
    snapping.destroy();
  });

  it("re-plans every movement step of one drag", () => {
    const { canvas, snapping } = setup();
    // A two-step drag with no neighbour near either step: only the second read
    // can tell a re-planning step from a cached one.
    const anchor = new Rect({
      id: "a",
      left: 100,
      top: 20,
      width: 40,
      height: 40,
    });
    const dragged = new Rect({
      id: "b",
      left: 200,
      top: 150,
      width: 40,
      height: 40,
    });
    canvas.add(anchor, dragged);
    canvas.setActiveObject(dragged);

    canvas.fire("mouse:down" as never, { target: dragged } as never);
    dragged.set({ left: 120, top: 150 });
    move(canvas, dragged);
    dragged.set({ left: 99, top: 150 });
    move(canvas, dragged);

    expect(dragged.left).toBe(100);
    snapping.destroy();
  });

  it("leaves the raw position alone while Ctrl is held", () => {
    const { canvas, snapping } = setup();
    const anchor = new Rect({
      id: "a",
      left: 100,
      top: 20,
      width: 40,
      height: 40,
    });
    const dragged = new Rect({
      id: "b",
      left: 98.4,
      top: 150,
      width: 40,
      height: 40,
    });
    canvas.add(anchor, dragged);
    canvas.setActiveObject(dragged);

    canvas.fire("mouse:down" as never, { target: dragged } as never);
    move(canvas, dragged, { ctrlKey: true });

    expect(dragged.left).toBe(98.4);
    snapping.destroy();
  });

  it("leaves an object alone when no neighbour is within the threshold", () => {
    const { canvas, snapping } = setup();
    const anchor = new Rect({
      id: "a",
      left: 0,
      top: 20,
      width: 40,
      height: 40,
    });
    const dragged = new Rect({
      id: "b",
      left: 250,
      top: 150,
      width: 40,
      height: 40,
    });
    canvas.add(anchor, dragged);
    canvas.setActiveObject(dragged);

    canvas.fire("mouse:down" as never, { target: dragged } as never);
    move(canvas, dragged);

    expect(dragged.left).toBe(250);
    snapping.destroy();
  });

  it("aligns to a locked neighbour, which lock must not prevent", () => {
    const { canvas, snapping } = setup();
    const locked = new Rect({
      id: "a",
      left: 100,
      top: 20,
      width: 40,
      height: 40,
      locked: true,
      selectable: false,
      evented: false,
    });
    // Deliberately narrow: the dragged rect's right edge (110) must stay far from
    // the neighbour's right edge (140), or that 30-wide gap competes with the
    // 2-wide left-edge gap and the drag resolves to the wrong anchor.
    const dragged = new Rect({
      id: "b",
      left: 98,
      top: 150,
      width: 12,
      height: 40,
    });
    canvas.add(locked, dragged);
    canvas.setActiveObject(dragged);

    canvas.fire("mouse:down" as never, { target: dragged } as never);
    move(canvas, dragged);

    // Only the neighbour's left edge is in range: 100 - 98 = 2 <= SNAP_THRESHOLD.
    expect(dragged.left).toBe(100);
    snapping.destroy();
  });

  it("ignores the artboard plate even though it is large and centrally placed", () => {
    const { canvas, snapping } = setup();
    // `IGNORED_IDS` is the authority on which id is the plate, and the rule
    // still holds for a plate an author draws: the starter no longer authors
    // one (its backdrop is packaged media below the canvas), so this
    // can no longer be derived from the starter's own scene.
    const plateId = IGNORED_IDS[0];
    expect(plateId).toBeTypeOf("string");
    // The plate spans most of the artboard, so its centre would otherwise be a
    // candidate for anything placed near it. Its geometry is deliberately
    // off-centre from the artboard: a plate centred at the artboard's own centre
    // (200, 150) would be indistinguishable from the artboard's
    // domain-boundary guide. The real plate is also `selectable: false`, which
    // this fixture omits so that the id, not selectability, is what excludes it.
    const plate = new Rect({
      id: plateId,
      left: 40,
      top: 30,
      width: 240,
      height: 180,
      evented: false,
    });
    const dragged = new Rect({
      id: "b",
      left: 158,
      top: 40,
      width: 20,
      height: 20,
    });
    canvas.add(plate, dragged);
    canvas.setActiveObject(dragged);

    canvas.fire("mouse:down" as never, { target: dragged } as never);
    move(canvas, dragged);

    // The plate's centreX is 160, so the dragged rect's left bounds edge (157.5,
    // stroke included) is 2.5 away — inside SNAP_THRESHOLD. Without the id
    // exclusion the drag would resolve to left 160.5. Ignored ids never
    // contribute a candidate, so it stays put.
    expect(dragged.left).toBe(158);
    snapping.destroy();
  });

  it("still ignores a hidden neighbour", () => {
    // A regression guard, not a new behaviour: `visible === false` is already
    // handled by `shouldIgnoreObject` and this step does not change it. It passes
    // before this task's change and after it, which is the point.
    const { canvas, snapping } = setup();
    const hidden = new Rect({
      id: "a",
      left: 100,
      top: 20,
      width: 40,
      height: 40,
      visible: false,
    });
    const dragged = new Rect({
      id: "b",
      left: 98,
      top: 150,
      width: 40,
      height: 40,
    });
    canvas.add(hidden, dragged);
    canvas.setActiveObject(dragged);

    canvas.fire("mouse:down" as never, { target: dragged } as never);
    move(canvas, dragged);

    expect(dragged.left).toBe(98);
    snapping.destroy();
  });

  it("snaps a rectangle inside an entered group at the root distance", () => {
    // The same rectangle, dragged the same two units short of the same
    // neighbour, once at the root and once inside the group it was entered
    // through. A group member's `left`/`top` are group-local, so the movement
    // plan must be stated in the canvas plane and converted back to the group's
    // plane on the way in; otherwise the raw intent is refused as a
    // non-translation and the drag lands raw.
    const drag = (
      wrapped: boolean,
    ): { left: number; top: number; anchorLeft: number } => {
      const { canvas, snapping, logged } = setup();
      const anchor = new Rect({
        id: "a",
        left: 100,
        top: 20,
        width: 40,
        height: 40,
      });
      const dragged = new Rect({
        id: "b",
        left: 98,
        top: 150,
        width: 40,
        height: 40,
      });
      if (wrapped) {
        // `subTargetCheck`/`interactive` are what entering a group sets; without
        // them Fabric's layout does not refresh the children's cached coords.
        const group = new Group([dragged], {
          subTargetCheck: true,
          interactive: true,
        });
        canvas.add(anchor, group);
      } else {
        canvas.add(anchor, dragged);
      }
      canvas.setActiveObject(dragged);

      canvas.fire("mouse:down" as never, { target: dragged } as never);
      move(canvas, dragged);
      // Fabric fires the group's layout after the canvas handler; do the same,
      // so the assertion is the geometry the author is left looking at.
      dragged.fire("moving" as never, {} as never);

      expect(logged).not.toHaveBeenCalled();
      const bounds = dragged.getBoundingRect();
      const anchorLeft = anchor.getBoundingRect().left;
      snapping.destroy();
      return { left: bounds.left, top: bounds.top, anchorLeft };
    };

    const root = drag(false);
    const grouped = drag(true);

    // Both land on the neighbour's edge, at the same distance from the raw aim.
    expect(root.left).toBe(root.anchorLeft);
    expect(grouped.left).toBe(grouped.anchorLeft);
    expect({ left: grouped.left, top: grouped.top }).toEqual({
      left: root.left,
      top: root.top,
    });
  });

  it("detaches every listener on destroy", () => {
    const { canvas, snapping } = setup();
    const dragged = new Rect({
      id: "b",
      left: 98,
      top: 150,
      width: 40,
      height: 40,
    });
    canvas.add(
      new Rect({ id: "a", left: 100, top: 20, width: 40, height: 40 }),
      dragged,
    );
    canvas.setActiveObject(dragged);

    snapping.destroy();
    canvas.fire("mouse:down" as never, { target: dragged } as never);
    move(canvas, dragged);

    expect(dragged.left).toBe(98);
  });

  it("survives a whole-pixel drag step that resolves to a zero delta", () => {
    const { canvas, snapping, logged } = setup();
    // Far from every neighbour and the artboard edge: the resolver returns the
    // dragged position itself, so the first step is a zero-delta plan.
    const dragged = new Rect({
      id: "b",
      left: 98,
      top: 150,
      width: 40,
      height: 40,
    });
    canvas.add(
      new Rect({ id: "a", left: 250, top: 20, width: 40, height: 40 }),
      dragged,
    );
    canvas.setActiveObject(dragged);

    canvas.fire("mouse:down" as never, { target: dragged } as never);
    // Whole-pixel drag: the resolver's pixel rounding returns a zero-delta
    // plan. The pending token must still be verified so the next step runs.
    dragged.set({ left: 99, top: 151 });
    move(canvas, dragged);
    dragged.set({ left: 120, top: 160 });
    move(canvas, dragged);

    expect(dragged.left).toBe(120);
    expect(logged).not.toHaveBeenCalled();
    snapping.destroy();
  });
});

/**
 * `vg-123`: which objects one gesture may align to. **RULED 2026-10-14 — parts
 * snap to parts**, so the candidate set is the whole scene rather than its
 * roots. The collected set is the pure decision and belongs here; the landing
 * and the guide it draws are browser facts and live in
 * `tests/e2e/snapping.spec.ts`.
 */
describe("collectSnapSources", () => {
  const artboard = () => ({
    left: 0,
    top: 0,
    right: 1200,
    bottom: 900,
    centerX: 600,
    centerY: 450,
  });

  function candidateIds(
    sources: readonly MovementSnapCandidateSource[],
  ): string[] {
    return sources.map(({ id }) => id);
  }

  /** A card holding `part` and a second shape, so the group's box is the
   * second shape's and the part's own lines are strictly inside it. */
  function cardHolding(part: Rect): Group {
    const card = new Group([
      new Rect({ id: "card-body", left: 0, top: 0, width: 300, height: 200 }),
      part,
    ]);
    // `id` is Yunari's own persisted property, not a Fabric GroupProps key.
    card.set("id", "card");
    return card;
  }

  it("offers a group's own parts beside the group itself", () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const part = new Rect({
      id: "card-part",
      left: 60,
      top: 40,
      width: 60,
      height: 60,
    });
    const card = cardHolding(part);
    const mover = new Rect({
      id: "mover",
      left: 900,
      top: 700,
      width: 40,
      height: 40,
    });
    canvas.add(card, mover);

    const sources = collectSnapSources({
      canvas,
      bounds: artboard,
      activeObject: mover,
    });
    part.setCoords();
    const partEdge = sources.find(({ id }) => id === "card-part")?.bounds.left;

    expect(candidateIds(sources)).toContain("card");
    // The part's own world edge, which the group's box does not already offer:
    // the body the group was laid out around starts elsewhere.
    expect(partEdge).toBe(part.getBoundingRect().left);
  });

  it("offers neither the card a dragged part sits in nor the part itself", () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const dragged = new Rect({
      id: "dragged-part",
      left: 60,
      top: 40,
      width: 60,
      height: 60,
    });
    const card = new Group([
      new Rect({ id: "card-body", left: 0, top: 0, width: 300, height: 200 }),
      dragged,
      new Rect({
        id: "sibling-part",
        left: 200,
        top: 40,
        width: 60,
        height: 60,
      }),
    ]);
    card.set("id", "card");
    const neighbour = new Rect({
      id: "neighbour",
      left: 900,
      top: 40,
      width: 60,
      height: 60,
    });
    canvas.add(card, neighbour);
    canvas.setActiveObject(dragged);

    const ids = candidateIds(
      collectSnapSources({ canvas, bounds: artboard, activeObject: dragged }),
    );

    // A group's box is the box of the parts it holds, so the card the drag is
    // inside offers the dragged part its own lines back and would pin it.
    expect(ids).not.toContain("card");
    expect(ids).not.toContain("dragged-part");
    // A part beside it is a neighbour like any other shape on the artboard.
    expect(ids).toContain("sibling-part");
    expect(ids).toContain("neighbour");
  });

  it("offers a part repeating its group's own box once, as the group", () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const sole = new Rect({
      id: "sole-part",
      left: 0,
      top: 0,
      width: 80,
      height: 80,
    });
    const card = new Group([sole]);
    card.set("id", "card");
    const mover = new Rect({
      id: "mover",
      left: 900,
      top: 700,
      width: 40,
      height: 40,
    });
    canvas.add(card, mover);

    const ids = candidateIds(
      collectSnapSources({ canvas, bounds: artboard, activeObject: mover }),
    );

    expect(ids).toContain("card");
    // A group wrapped around one part has exactly that part's box, so every
    // line it offers is already offered: doubling them would weigh one edge
    // twice in the ranking and once again in the equal-spacing chain.
    expect(ids).not.toContain("sole-part");
  });
});
