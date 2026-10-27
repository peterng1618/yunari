// @vitest-environment jsdom
import type { TextContent, TextRun } from "@yunari/renderer-core";
import { YUNARI_TEXT_PROPERTY } from "@yunari/scene-fabric";
import { Canvas, IText } from "fabric/es";
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

const SIZED: TextRun = {
  kind: "literal",
  text: "CPU",
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

    expect(runsOf(target)[0]?.style?.["fontSize"]).toEqual({ value: 69 });
    // A run with no size picks up the body default the canvas painted: 16 at
    // 1080, doubled by the gesture.
    expect(runsOf(target)[1]?.style?.["fontSize"]).toEqual({ value: 24 });
    expect([target.scaleX, target.scaleY]).toEqual([1, 1]);
    expect(JSON.stringify(sibling.get(YUNARI_TEXT_PROPERTY))).toBe(
      siblingBefore,
    );
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
    // The pre-gesture entry: an unscaled text with its authored size.
    history.reset();
    const manager = createTextManager(canvas, () => history.save());

    target.set({ scaleX: 1.5, scaleY: 1.5 });
    canvas.fire("object:modified", { target } as never);

    expect(runsOf(target)[0]?.style?.["fontSize"]).toEqual({ value: 69 });
    expect([target.scaleX, target.scaleY]).toEqual([1, 1]);

    await history.undo();

    expect(runsOf(target)[0]?.style?.["fontSize"]).toEqual({ value: 46 });
    expect([target.scaleX, target.scaleY]).toEqual([1, 1]);
    manager.destroy();
  });

  it("leaves a text with no authored runs alone, scale included", () => {
    const object = new IText("plain") as IText;
    const canvas = scene(object);
    const save = vi.fn();
    const manager = createTextManager(canvas, save);

    object.set({ scaleX: 2, scaleY: 2 });
    canvas.fire("object:modified", { target: object } as never);

    expect([object.scaleX, object.scaleY]).toEqual([2, 2]);
    expect(save).toHaveBeenCalledOnce();
    manager.destroy();
  });
});
