// @vitest-environment jsdom
import type { TextContent, TextRun } from "@yunari/renderer-core";
import { applyAuthoredText, YUNARI_TEXT_PROPERTY } from "@yunari/scene-fabric";
import { Canvas, IText, Textbox } from "fabric/es";
import { describe, expect, it, vi } from "vitest";
import { EditorHistory } from "../history-manager/index.js";
import { createTextManager } from "./index.js";

/** The artboard figure the manager reads is the canvas's own height. */
const ARTBOARD_HEIGHT = 1080;

function makeText(id: string, runs: readonly TextRun[]): IText {
  const object = new IText("CPU", { id, left: 20, top: 20 }) as IText;
  object.set(YUNARI_TEXT_PROPERTY, { runs } satisfies TextContent);
  return object;
}

function scene(...objects: readonly IText[]): Canvas {
  const canvas = new Canvas(document.createElement("canvas"), {
    height: ARTBOARD_HEIGHT,
  });
  for (const object of objects) canvas.add(object);
  return canvas;
}

function runsOf(object: IText): readonly TextRun[] {
  return (object.get(YUNARI_TEXT_PROPERTY) as TextContent).runs;
}

function sizeOf(object: IText, index = 0): unknown {
  return runsOf(object)[index]?.style?.["fontSize"];
}

const SIZED: TextRun = {
  kind: "literal",
  text: "CPU",
  typeToken: "typeTokens.body",
  style: { fontSize: { value: 46 } },
};

describe("committing a canvas scale", () => {
  it("writes only the scaled object's runs and resets its scale", () => {
    const target = makeText("target", [
      SIZED,
      { kind: "literal", text: "%", typeToken: "typeTokens.body" },
    ]);
    const sibling = makeText("sibling", [
      { kind: "literal", text: "RAM", typeToken: "typeTokens.body" },
    ]);
    const canvas = scene(target, sibling);
    const siblingBefore = JSON.stringify(sibling.get(YUNARI_TEXT_PROPERTY));
    const save = vi.fn();
    const manager = createTextManager(canvas, save);

    target.set({ scaleX: 1.5, scaleY: 1.5 });
    canvas.fire("object:modified", { target } as never);

    expect(sizeOf(target)).toEqual({ value: 69 });
    // A run with no size picks up the body default the canvas painted: 16 at
    // 1080, doubled by the gesture.
    expect(sizeOf(target, 1)).toEqual({ value: 24 });
    expect([target.scaleX, target.scaleY]).toEqual([1, 1]);
    expect(JSON.stringify(sibling.get(YUNARI_TEXT_PROPERTY))).toBe(
      siblingBefore,
    );
    expect(save).toHaveBeenCalledOnce();
    manager.destroy();
  });

  it("resets a horizontal-only scale without writing a size", () => {
    // The model has no stretched text: a scaleX of 2 alone would paint stretched
    // glyphs while the row reported the authored 46.
    const target = makeText("target", [SIZED]);
    const canvas = scene(target);
    const save = vi.fn();
    const manager = createTextManager(canvas, save);

    target.set({ scaleX: 2, scaleY: 1 });
    canvas.fire("object:modified", { target } as never);

    expect(sizeOf(target)).toEqual({ value: 46 });
    expect([target.scaleX, target.scaleY]).toEqual([1, 1]);
    expect(save).toHaveBeenCalledOnce();
    manager.destroy();
  });

  it("records one entry, so a single undo restores the sizes and the scale", async () => {
    const target = makeText("target", [SIZED]);
    const canvas = scene(target);
    const state = (): {
      runs: readonly TextRun[];
      scaleX: number;
      scaleY: number;
    } => ({
      runs: JSON.parse(JSON.stringify(runsOf(target))) as TextRun[],
      scaleX: target.scaleX,
      scaleY: target.scaleY,
    });
    const history = new EditorHistory({
      canvas: canvas as never,
      serialize: () => state() as never,
      revive: async (_canvas, captured) => {
        const restored = captured as unknown as ReturnType<typeof state>;
        target.set(YUNARI_TEXT_PROPERTY, {
          runs: restored.runs,
        });
        target.set({ scaleX: restored.scaleX, scaleY: restored.scaleY });
      },
    });
    // The pre-gesture entry is scaled, so the restore assertion cannot pass by
    // reading a scale that was 1 on both sides.
    target.set({ scaleX: 2, scaleY: 2 });
    history.reset();
    const manager = createTextManager(canvas, () => history.save());

    target.set({ scaleX: 1.5, scaleY: 1.5 });
    canvas.fire("object:modified", { target } as never);

    expect(sizeOf(target)).toEqual({ value: 69 });
    expect([target.scaleX, target.scaleY]).toEqual([1, 1]);

    // The shell's own `object:modified` listener saves again; history's dedupe
    // is what keeps that from being a second entry.
    history.save();

    await history.undo();

    expect(sizeOf(target)).toEqual({ value: 46 });
    expect([target.scaleX, target.scaleY]).toEqual([2, 2]);
    manager.destroy();
  });

  it.each([
    ["a missing property", undefined],
    ["an empty run list", { runs: [] }],
    ["a non-array runs value", { runs: "nope" }],
  ])("leaves a text with %s alone, scale included", (_label, authored) => {
    const object = new IText("plain") as IText;
    if (authored !== undefined) object.set(YUNARI_TEXT_PROPERTY, authored);
    const canvas = scene(object);
    const save = vi.fn();
    const manager = createTextManager(canvas, save);

    object.set({ scaleX: 2, scaleY: 2 });
    canvas.fire("object:modified", { target: object } as never);

    expect([object.scaleX, object.scaleY]).toEqual([2, 2]);
    expect(save).toHaveBeenCalledOnce();
    manager.destroy();
  });

  /**
   * A boxed text with the Fabric default centre origin, the state a corner
   * drag leaves it in, and the manager repainting from the authored runs.
   */
  function boxed(): {
    readonly object: IText;
    readonly canvas: Canvas;
    readonly manager: ReturnType<typeof createTextManager>;
  } {
    const object = new Textbox("CPU 48%", {
      id: "boxed",
      left: 60,
      top: 56,
      width: 180,
      height: 72,
      originX: "center",
      originY: "center",
    }) as unknown as IText;
    object.set(YUNARI_TEXT_PROPERTY, {
      runs: [SIZED],
      box: { width: 180, height: 72 },
    } satisfies TextContent);
    const canvas = scene(object);
    const manager = createTextManager(canvas, vi.fn());
    manager.setRepaint((target) =>
      applyAuthoredText(canvas, undefined, {
        only: (candidate) => candidate === target,
      }),
    );
    return { object, canvas, manager };
  }

  /** The visual left edge, which is what a corner drag must leave fixed. */
  function renderedLeft(object: IText): number {
    return object.left - (object.width * object.scaleX) / 2;
  }

  it("bakes a corner drag's scaled width into the authored box", () => {
    // vg-770's ruling: a corner drag widens the authored box instead of
    // letting the widened Textbox snap back when the handle scale resets.
    // Fabric's `width` is the box *before* `scaleX`, so the drawn width the
    // drag left is `width * scaleX`.
    const { object, canvas, manager } = boxed();
    const leftBefore = renderedLeft(object);

    // The statement a `br` corner drag leaves behind: the transform anchor is
    // the opposite corner, so the object's own centre moved with the scale.
    object.set({
      scaleX: 1.5,
      scaleY: 1,
      left: leftBefore + (object.width * 1.5) / 2,
    });
    canvas.fire("object:modified", { target: object } as never);

    const authored = object.get(YUNARI_TEXT_PROPERTY) as TextContent;
    expect(authored.box?.width).toBeCloseTo(270, 6);
    expect(object.scaleX).toBe(1);
    // The repaint reads the box, so Fabric's own width re-wrapped at it.
    expect(object.width).toBeCloseTo(270, 6);
    // The opposite corner did not move.
    expect(renderedLeft(object)).toBeCloseTo(leftBefore, 6);
    manager.destroy();
  });

  it("does not compound the bake across two corner drags", () => {
    // The stored box is unscaled once `scaleX` resets, so the next drag starts
    // from that number rather than from the scale it replaced (vg-233).
    const { object, canvas, manager } = boxed();
    object.set({
      scaleX: 1.5,
      scaleY: 1,
      left: renderedLeft(object) + (object.width * 1.5) / 2,
    });
    canvas.fire("object:modified", { target: object } as never);

    const leftBefore = renderedLeft(object);
    object.set({
      scaleX: 1.2,
      scaleY: 1,
      left: leftBefore + (object.width * 1.2) / 2,
    });
    canvas.fire("object:modified", { target: object } as never);

    const authored = object.get(YUNARI_TEXT_PROPERTY) as TextContent;
    expect(authored.box?.width).toBeCloseTo(324, 6);
    expect(object.width).toBeCloseTo(324, 6);
    expect(renderedLeft(object)).toBeCloseTo(leftBefore, 6);
    manager.destroy();
  });

  it("writes a side handle's width into the authored box", () => {
    // A side handle writes `width` rather than a scale, and the per-step
    // resize handler records it; the commit must not undo it.
    const { object, canvas, manager } = boxed();
    const leftBefore = renderedLeft(object);

    object.set("width", 240);
    // Fabric's own width change keeps the opposite (left) edge fixed, so the
    // centre origin moves out by half the added width.
    object.set({ left: leftBefore + 240 / 2 });
    canvas.fire("object:resizing", {
      transform: { target: object },
    } as never);
    canvas.fire("object:modified", { target: object } as never);

    const authored = object.get(YUNARI_TEXT_PROPERTY) as TextContent;
    expect(authored.box?.width).toBe(240);
    expect(object.scaleX).toBe(1);
    expect(object.width).toBeCloseTo(240, 6);
    expect(renderedLeft(object)).toBeCloseTo(leftBefore, 6);
    manager.destroy();
  });

  it("scales runs and leaves the authored width alone on a vertical drag", () => {
    const { object, canvas, manager } = boxed();
    object.set({ scaleX: 1, scaleY: 1.5 });
    canvas.fire("object:modified", { target: object } as never);

    expect(sizeOf(object)).toEqual({ value: 69 });
    expect(object.scaleY).toBe(1);
    expect(object.width).toBeCloseTo(180, 6);
    expect((object.get(YUNARI_TEXT_PROPERTY) as TextContent).box?.width).toBe(
      180,
    );
    manager.destroy();
  });
});
