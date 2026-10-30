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

  it("keeps a scaled text box at its authored width", () => {
    // Review finding 6, pinned: a corner drag can widen a Textbox, and the
    // commit writes sizes and resets scales only — the authored box wins the
    // repaint. Whether a corner drag should scale the box is a product decision
    // (vg-761); until then this is deliberate, not accidental.
    const box = { width: 180, height: 72 };
    const object = new Textbox("CPU 48%", {
      id: "boxed",
      left: 20,
      top: 20,
      width: box.width,
      height: box.height,
    }) as unknown as IText;
    object.set(YUNARI_TEXT_PROPERTY, {
      runs: [SIZED],
      box,
    } satisfies TextContent);
    const canvas = scene(object);
    const manager = createTextManager(canvas, vi.fn());
    manager.setRepaint((target) =>
      applyAuthoredText(canvas, undefined, {
        only: (candidate) => candidate === target,
      }),
    );

    object.set({ width: 300, scaleX: 1.5, scaleY: 1.5 });
    canvas.fire("object:modified", { target: object } as never);

    expect(sizeOf(object)).toEqual({ value: 69 });
    expect([object.scaleX, object.scaleY]).toEqual([1, 1]);
    expect(object.width).toBe(box.width);
    expect(
      (object.get(YUNARI_TEXT_PROPERTY) as { box?: { width: number } }).box
        ?.width,
    ).toBe(box.width);
    manager.destroy();
  });
});
