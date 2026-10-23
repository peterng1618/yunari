// @vitest-environment jsdom
import { serialiseScene } from "@yunari/scene-fabric";
import { ActiveSelection, Canvas, Rect } from "fabric/es";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorHistory } from "./index.js";

beforeEach(() => {
  const real = document.createElement("canvas").getContext("2d");
  if (real !== null) {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        new Proxy(real, {
          get(target, property) {
            if (property === "drawImage") return (): void => {};
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
          set(target, property, value) {
            if (property === "patternQuality") return true;
            return Reflect.set(target, property, value);
          },
        }) as unknown as CanvasRenderingContext2D,
    );
  }
});

function stageWith(ids: readonly string[]): Canvas {
  const canvas = new Canvas(document.createElement("canvas"), {
    width: 400,
    height: 300,
  });
  for (const id of ids) {
    canvas.add(new Rect({ id, left: 10, top: 10, width: 50, height: 50 }));
  }
  return canvas;
}

function historyFor(canvas: Canvas): EditorHistory {
  const history = new EditorHistory({
    canvas,
    serialize: serialiseScene,
    revive: async (target, scene) => {
      await target.loadFromJSON(scene);
    },
  });
  history.reset();
  return history;
}

const selectedIds = (canvas: Canvas): readonly string[] => {
  const active = canvas.getActiveObject();
  if (active === undefined) return [];
  const objects =
    active instanceof ActiveSelection ? active.getObjects() : [active];
  return objects.map((object) => object.get("id") as string);
};

describe("undo keeps the author's selection", () => {
  it("re-selects the object the author had selected", async () => {
    const canvas = stageWith(["first", "second"]);
    const history = historyFor(canvas);
    canvas.setActiveObject(canvas.item(0)!);

    canvas.item(1)!.set({ left: 300 });
    history.save();
    await history.undo();

    // The undo did the right thing to the scene; the editor forgetting what was
    // selected is what left the author unable to see that.
    expect(canvas.item(1)!.left).toBe(10);
    expect(selectedIds(canvas)).toEqual(["first"]);
  });

  it("re-selects a multi-selection by the ids it held", async () => {
    const canvas = stageWith(["first", "second", "third"]);
    const history = historyFor(canvas);
    canvas.setActiveObject(
      new ActiveSelection([canvas.item(0)!, canvas.item(1)!], { canvas }),
    );

    canvas.item(2)!.set({ left: 300 });
    history.save();
    await history.undo();

    expect([...selectedIds(canvas)].sort()).toEqual(["first", "second"]);
  });

  it("undoes a flip in one step", async () => {
    // The flip is a Fabric property the inspector writes through the ordinary
    // commit path, so it is one entry — one undo returns the object, not a
    // half-restored one.
    const canvas = stageWith(["picture"]);
    const history = historyFor(canvas);

    canvas.item(0)!.set({ flipX: true });
    history.save();
    await history.undo();

    expect(canvas.item(0)!.flipX).toBe(false);
  });

  it("leaves an undone deletion unselected, because Fabric cleared it", async () => {
    const canvas = stageWith(["first", "second"]);
    const history = historyFor(canvas);
    canvas.setActiveObject(canvas.item(0)!);

    canvas.remove(canvas.item(0)!);
    history.save();
    canvas.discardActiveObject();
    await history.undo();

    expect(
      canvas
        .getObjects()
        .map((object) => object.get("id"))
        .sort(),
    ).toEqual(["first", "second"]);
    expect(selectedIds(canvas)).toEqual([]);
  });
});
