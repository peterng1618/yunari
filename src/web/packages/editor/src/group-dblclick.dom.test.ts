// @vitest-environment jsdom
import { type Canvas, type FabricObject, Group, Rect } from "fabric/es";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountEditorShell } from "./editor-shell.js";

// jsdom cannot drawImage an undecoded img inside Fabric's render pass; see
// `editor-shell.dom.test.ts` for why the proxy is needed.
beforeEach(() => {
  const real = document.createElement("canvas").getContext("2d");
  if (real === null) return;
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
});

const mountHost = async (): Promise<{
  readonly canvas: Canvas;
  readonly shell: Awaited<ReturnType<typeof mountEditorShell>>;
}> => {
  const host = document.createElement("div");
  Object.defineProperties(host, {
    clientWidth: { value: 400 },
    clientHeight: { value: 300 },
  });
  const shell = await mountEditorShell({
    host,
    artboard: { width: 100, height: 100 },
  });
  return { canvas: shell.editor.canvas, shell };
};

/** The gesture as Fabric delivers it: a scene point, and the object its own
 * hit test resolved — which is `undefined` when nothing is under the pointer. */
const dblclick = (canvas: Canvas, target: FabricObject | undefined): void => {
  canvas.fire(
    "mouse:dblclick" as never,
    {
      target,
      scenePoint: { x: 0, y: 0 },
    } as never,
  );
};

describe("double-click group entry and exit", () => {
  it("enters a group on a double-click and leaves it on one outside", async () => {
    const { canvas, shell } = await mountHost();
    const child = new Rect({ width: 10, height: 10, left: 10, top: 10 });
    child.set("id", "child");
    const group = new Group([child]);
    group.set("id", "group");
    const outside = new Rect({ width: 10, height: 10, left: 60, top: 60 });
    outside.set("id", "outside");
    canvas.add(group, outside);

    dblclick(canvas, group);
    expect(shell.editor.groupingManager.groupContext()).toEqual([group]);

    // Everything outside an entered group is `evented: false`, so Fabric
    // resolves a double-click out there to nothing at all. No target *is* the
    // outside, and it is the case that used to be silent.
    dblclick(canvas, undefined);

    expect(shell.editor.groupingManager.groupContext()).toEqual([]);
    shell.destroy();
  });

  it("leaves the group when the double-click resolves to an object outside it", async () => {
    const { canvas, shell } = await mountHost();
    const child = new Rect({ width: 10, height: 10 });
    const group = new Group([child]);
    const outside = new Rect({ width: 10, height: 10, left: 60, top: 60 });
    canvas.add(group, outside);

    dblclick(canvas, group);
    expect(shell.editor.groupingManager.groupContext()).toHaveLength(1);

    dblclick(canvas, outside);

    expect(shell.editor.groupingManager.groupContext()).toEqual([]);
    shell.destroy();
  });

  it("stays in the group when the double-click resolves inside it", async () => {
    // The other half of the same gesture: exiting must not fire for a
    // double-click *within* the entered group, which is how a nested group is
    // entered in the first place.
    const { canvas, shell } = await mountHost();
    const child = new Rect({ width: 10, height: 10 });
    const group = new Group([child]);
    canvas.add(group);

    dblclick(canvas, group);
    dblclick(canvas, child);

    expect(shell.editor.groupingManager.groupContext()).toEqual([group]);
    shell.destroy();
  });

  it("still leaves on the Escape route", async () => {
    // The gesture is additive: it does not replace the conventional one.
    const { canvas, shell } = await mountHost();
    const child = new Rect({ width: 10, height: 10 });
    const group = new Group([child]);
    canvas.add(group);

    dblclick(canvas, group);
    expect(shell.editor.groupingManager.groupContext()).toHaveLength(1);

    shell.editor.groupingManager.exitGroup();

    expect(shell.editor.groupingManager.groupContext()).toEqual([]);
    shell.destroy();
  });

  it("does not invent a context from a double-click when no group is entered", async () => {
    // 56af977: a text box is also what a double-click edits, and recording one
    // as a group entry dimmed every other layer until Escape. The exit branch
    // must not reopen that.
    const { canvas, shell } = await mountHost();
    const text = new Rect({ width: 10, height: 10 });
    canvas.add(text);

    dblclick(canvas, text);
    expect(shell.editor.groupingManager.groupContext()).toEqual([]);

    dblclick(canvas, undefined);
    expect(shell.editor.groupingManager.groupContext()).toEqual([]);
    shell.destroy();
  });

  it("stops listening on destroy", async () => {
    const { canvas, shell } = await mountHost();
    const child = new Rect({ width: 10, height: 10 });
    const group = new Group([child]);
    canvas.add(group);
    dblclick(canvas, group);
    shell.destroy();

    // A double-click listener outliving the canvas would enter a group into a
    // torn-down editor.
    expect(() => dblclick(canvas, undefined)).not.toThrow();
  });
});
