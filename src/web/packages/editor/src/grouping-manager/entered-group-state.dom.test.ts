// @vitest-environment jsdom
import { serialiseScene } from "@yunari/scene-fabric";
import {
  Canvas,
  FabricImage,
  type FabricObject,
  Group,
  Rect,
  Textbox,
} from "fabric/es";
import { describe, expect, it, vi } from "vitest";
import { createGroupingManager } from "./index.js";

/** The state the manager applies to the canvas while a group is entered. */
const reachable = (canvas: Canvas): Record<string, boolean> =>
  Object.fromEntries(
    canvas
      .getObjects()
      .map((object) => [
        (object as { id?: string }).id ?? object.type,
        object.selectable === true,
      ]),
  );

/**
 * The alpha one object's own paint carries, as Fabric hands the context to
 * `before:render`.
 *
 * The event is the only place the dim can be read: the manager is forbidden from
 * writing it to the object, so there is no property to assert instead. `from` is
 * what an enclosing render has already put on the context — Fabric multiplies
 * each object's own opacity in before the event fires.
 */
const paintedAt = (object: FabricObject, from = 1): number => {
  const ctx = contextAt(from);
  object.fire("before:render", { ctx });
  return ctx.globalAlpha;
};

/** A context stand-in carrying only what the dim reads or writes. */
const contextAt = (alpha = 1): CanvasRenderingContext2D =>
  ({ globalAlpha: alpha }) as unknown as CanvasRenderingContext2D;

function scene(): {
  canvas: Canvas;
  group: Group;
  outsider: Rect;
  text: Textbox;
} {
  const canvas = new Canvas(document.createElement("canvas"));
  const child = new Rect({ id: "child", width: 10, height: 10 });
  const group = new Group([child]);
  group.set("id", "group");
  const outsider = new Rect({ id: "outsider", width: 10, height: 10 });
  const text = new Textbox("hello", { id: "text", width: 40, height: 20 });
  canvas.add(group, outsider, text);
  return { canvas, group, outsider, text };
}

const manager = (canvas: Canvas) =>
  createGroupingManager({
    canvas,
    save: vi.fn(),
    suspend: () => () => undefined,
  });

describe("entering a group", () => {
  it("makes every object outside the entered group unreachable on the artboard", () => {
    const { canvas, group, outsider } = scene();
    const grouping = manager(canvas);

    grouping.enterGroup({ object: group });

    // U6: the layer panel already says only the group's own layers are reachable.
    // The artboard has to agree, or the panel is describing a fiction.
    expect(reachable(canvas)).toEqual({
      group: true,
      outsider: false,
      text: false,
    });
    expect(outsider.selectable).toBe(false);
    expect(outsider.evented).toBe(false);
    // The group's own children are the point of entering it, so they are untouched.
    expect((group.getObjects()[0] as Rect).selectable).toBe(true);

    grouping.exitGroup();

    expect(reachable(canvas)).toEqual({
      group: true,
      outsider: true,
      text: true,
    });
  });

  it("restores an author's own flags rather than assuming the defaults", () => {
    const { canvas, group, outsider } = scene();
    // A locked layer stays locked on the way out; the manager never owned it.
    outsider.set("selectable", false);
    outsider.set("evented", false);
    const grouping = manager(canvas);

    grouping.enterGroup({ object: group });
    grouping.exitGroup();

    expect(outsider.selectable).toBe(false);
    expect(outsider.evented).toBe(false);
  });

  it("records no context for a double-click that is not a group", () => {
    // U7: a text box's double-click enters inline editing, and `editor-shell`
    // routes every double-click here. Recording that as a group entry left the
    // panel dimmed for every other layer until Escape.
    const { canvas, text } = scene();
    const grouping = manager(canvas);

    grouping.enterGroup({ object: text });

    expect(grouping.groupContext()).toEqual([]);
    expect(reachable(canvas)).toEqual({
      group: true,
      outsider: true,
      text: true,
    });
  });

  it("records no context for an image that is not a group", () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const image = new FabricImage(document.createElement("img"), {
      id: "image-1",
    });
    canvas.add(image);
    const grouping = manager(canvas);

    grouping.enterGroup({ object: image });

    expect(grouping.groupContext()).toEqual([]);
  });

  it("leaves one level when the same group is entered again", () => {
    const { canvas, group } = scene();
    const grouping = manager(canvas);

    grouping.enterGroup({ object: group });
    expect(grouping.groupContext()).toEqual([group]);
    // A second double-click inside the entered group must not stack a context
    // the panel would then treat as two levels of "reachable".
    grouping.enterGroup({ object: group });

    expect(grouping.groupContext()).toEqual([group]);
  });

  it("leaves the previous group when a different one is entered", () => {
    const { canvas, group, outsider } = scene();
    const second = new Group([
      new Rect({ id: "child-2", width: 10, height: 10 }),
    ]);
    second.set("id", "group-2");
    canvas.add(second);
    const grouping = manager(canvas);

    grouping.enterGroup({ object: group });
    grouping.enterGroup({ object: second });

    expect(grouping.groupContext()).toEqual([second]);
    expect(outsider.selectable).toBe(false);
    expect(second.selectable).toBe(true);
  });

  it("re-applies the state to a group rebuilt by history", () => {
    const { canvas, group, outsider } = scene();
    const grouping = manager(canvas);
    grouping.enterGroup({ object: group });

    // `loadFromJSON` rebuilds the scene, so the manager's group instance is gone.
    const revived = new Group([
      new Rect({ id: "child", width: 10, height: 10 }),
    ]);
    revived.set("id", "group");
    canvas.remove(group);
    canvas.add(revived);
    canvas.fire("editor:history-state-loaded" as never);

    expect(grouping.groupContext()).toEqual([revived]);
    expect(outsider.selectable).toBe(false);
    expect(revived.subTargetCheck).toBe(true);
  });

  it("restores the artboard when the entered group is ungrouped", () => {
    const { canvas, group, outsider } = scene();
    const grouping = manager(canvas);
    grouping.enterGroup({ object: group });
    canvas.setActiveObject(group);

    grouping.ungroup();

    expect(grouping.groupContext()).toEqual([]);
    expect(outsider.selectable).toBe(true);
  });

  it("applies the state to a child that arrives after entry", () => {
    const { canvas, group } = scene();
    const grouping = manager(canvas);
    grouping.enterGroup({ object: group });

    // Duplicating inside a group can add a sibling to the canvas root before it
    // is taken into the group; it must not stay reachable behind the author's back.
    const late = new Rect({ id: "late", width: 4, height: 4 });
    canvas.add(late);

    expect(late.selectable).toBe(false);
    expect(paintedAt(late)).toBeCloseTo(0.45, 5);
    grouping.exitGroup();
    expect(late.selectable).toBe(true);
    expect(paintedAt(late)).toBe(1);
  });

  it("dims the artboard outside the entered group at the list's own value", () => {
    const { canvas, group, outsider, text } = scene();
    const grouping = manager(canvas);

    grouping.enterGroup({ object: group });

    // 0.45 is `.yunari-layer-row[data-context="false"]`'s opacity, so the two
    // surfaces say the same thing about what the author can currently reach.
    expect(paintedAt(outsider)).toBeCloseTo(0.45, 5);
    expect(paintedAt(text)).toBeCloseTo(0.45, 5);
    // The positive half: the group's own child is what entering the group is
    // for, so a rule that dimmed every object on the canvas could not pass.
    expect(paintedAt(group.getObjects()[0] as Rect)).toBe(1);
    // A dim that reached the object rather than the frame would be persisted.
    expect(outsider.get("opacity")).toBe(1);

    grouping.exitGroup();

    expect(paintedAt(outsider)).toBe(1);
    expect(paintedAt(text)).toBe(1);
  });

  it("lifts the dim for a capture and puts it back", () => {
    // A capture reads the document, not the screen (`vg-527`): a package
    // saved from inside an entered group ships a thumbnail, and a view state
    // must not reach an artifact that outlives the session.
    const { canvas, group, outsider } = scene();
    const grouping = manager(canvas);
    grouping.enterGroup({ object: group });
    expect(paintedAt(outsider)).toBeCloseTo(0.45, 5);

    const release = grouping.suspendDim();

    expect(paintedAt(outsider)).toBe(1);

    release();

    // The screen is what the author was looking at, so the dim is back rather
    // than merely unsubscribed.
    expect(paintedAt(outsider)).toBeCloseTo(0.45, 5);
    expect(grouping.groupContext()).toEqual([group]);
  });

  it("dims an object under an outside group once, not once per group", () => {
    // The layer list's own rule: an object *under* an outside group is outside,
    // and the two dims do not stack on each other.
    const canvas = new Canvas(document.createElement("canvas"));
    const part = new Rect({ id: "part", width: 10, height: 10 });
    const outer = new Group([part]);
    outer.set("id", "outer");
    const entered = new Group([
      new Rect({ id: "inner", width: 10, height: 10 }),
    ]);
    entered.set("id", "entered");
    canvas.add(outer, entered);
    const grouping = manager(canvas);

    grouping.enterGroup({ object: entered });

    expect(paintedAt(part)).toBeCloseTo(0.45, 5);
    // A group paints nothing of its own, so it carries no second multiplication
    // that would leave the part at 0.2.
    expect(paintedAt(outer)).toBe(1);
  });

  it("sets a cache to the dim once, and gives the cache back on the way out", () => {
    const { canvas, group, outsider } = scene();
    const grouping = manager(canvas);

    // What an object that Fabric keeps cached fires with — `clipPath` objects
    // are the ones `needsItsOwnCache` forces this for. Fabric neither brackets
    // nor clears that context between repaints, so a multiplication there would
    // compound on every frame and would outlive leaving the group.
    const cache = contextAt();
    (outsider as { _cacheContext?: unknown })._cacheContext = cache;

    grouping.enterGroup({ object: group });
    expect(outsider.dirty, "the repaint that carries the dim").toBe(true);
    outsider.fire("before:render", { ctx: cache });
    outsider.fire("before:render", { ctx: cache });
    expect(cache.globalAlpha).toBeCloseTo(0.45, 5);

    grouping.exitGroup();

    expect(cache.globalAlpha).toBe(1);
  });

  it("leaves the scene byte-identical across the round trip", () => {
    const { canvas, group } = scene();
    const grouping = manager(canvas);
    const before = JSON.stringify(serialiseScene(canvas));

    grouping.enterGroup({ object: group });
    grouping.exitGroup();

    // The dim is a view state drawn on the frame, so entering and leaving it
    // writes nothing a save would carry. This is the assertion the ruling rests
    // on: a dim that had reached the objects would serialise as `opacity`.
    expect(JSON.stringify(serialiseScene(canvas))).toBe(before);
  });
});
