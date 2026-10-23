// @vitest-environment jsdom
import { ActiveSelection, Canvas, Group, Rect } from "fabric/es";
import { describe, expect, it, vi } from "vitest";
import { applyArrange, canArrange } from "./arrange.js";
import type { EditorInteraction } from "./editor-interaction.js";

describe("selection-relative arrange actions", () => {
  it("aligns rendered left edges and preserves the active selection", () => {
    const first = rectangle(80, 20, 20, 10);
    const rotated = rectangle(10, 30, 20, 10, 45);
    const last = rectangle(140, 40, 10, 20);
    const { editor, selection, historyManager } = editorFor(
      first,
      rotated,
      last,
    );
    const selected = selection.getObjects();

    expect(applyArrange(editor, "align-left")).toBe(true);
    const anchorLeft = first.getBoundingRect().left;
    expect(
      [first, rotated, last].map((object) => object.getBoundingRect().left),
    ).toEqual([anchorLeft, anchorLeft, anchorLeft]);
    expect(
      (editor.canvas.getActiveObject() as ActiveSelection).getObjects(),
    ).toEqual(selected);
    expect(
      (editor.canvas.getActiveObject() as ActiveSelection)
        .multiSelectionStacking,
    ).toBe("selection-order");
    expect(historyManager.saveState).toHaveBeenCalledTimes(1);
  });

  it("requires three unlocked objects for distribution without creating history for rejection", () => {
    const two = editorFor(rectangle(0, 0, 10, 10), rectangle(50, 0, 10, 10));
    expect(canArrange(two.editor, "align-left")).toBe(true);
    expect(canArrange(two.editor, "distribute-x")).toBe(false);
    expect(applyArrange(two.editor, "distribute-x")).toBe(false);
    expect(two.historyManager.saveState).not.toHaveBeenCalled();

    const locked = rectangle(0, 0, 10, 10);
    Object.assign(locked, { locked: true });
    const lockedSelection = editorFor(locked, rectangle(50, 0, 10, 10));
    expect(canArrange(lockedSelection.editor, "align-top")).toBe(false);
    expect(applyArrange(lockedSelection.editor, "align-top")).toBe(false);
    expect(lockedSelection.historyManager.saveState).not.toHaveBeenCalled();
  });

  it("keeps distribution endpoints fixed and equalizes intermediate gaps", () => {
    const first = rectangle(0, 0, 10, 10);
    const middle = rectangle(50, 0, 20, 10);
    const last = rectangle(100, 0, 30, 10);
    const { editor, historyManager } = editorFor(first, middle, last);
    const firstLeft = first.getBoundingRect().left;
    const lastRight =
      last.getBoundingRect().left + last.getBoundingRect().width;

    expect(applyArrange(editor, "distribute-x")).toBe(true);

    const firstRight =
      first.getBoundingRect().left + first.getBoundingRect().width;
    const middleLeft = middle.getBoundingRect().left;
    const middleRight = middleLeft + middle.getBoundingRect().width;
    expect(first.getBoundingRect().left).toBe(firstLeft);
    expect(last.getBoundingRect().left + last.getBoundingRect().width).toBe(
      lastRight,
    );
    expect(middleLeft - firstRight).toBe(
      middleRight <= last.getBoundingRect().left
        ? last.getBoundingRect().left - middleRight
        : NaN,
    );
    expect(historyManager.saveState).toHaveBeenCalledTimes(1);
  });

  it("moves selected objects in canvas coordinates instead of the active-selection frame", () => {
    const canvas = new Canvas(document.createElement("canvas"), {
      width: 320,
      height: 180,
    });
    const anchor = rectangle(220, 20, 30, 20);
    const other = rectangle(20, 40, 30, 20);
    canvas.add(anchor, other);
    const selection = new ActiveSelection([anchor, other], { canvas });
    canvas.setActiveObject(selection);
    const editor = {
      canvas,
      historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
    } as unknown as EditorInteraction;

    expect(applyArrange(editor, "align-left")).toBe(true);
    expect(anchor.getBoundingRect().left).toBeCloseTo(220, 3);
    expect(other.getBoundingRect().left).toBeCloseTo(220, 3);
    expect(
      other.getBoundingRect().left + other.getBoundingRect().width,
    ).toBeLessThanOrEqual(320);
  });

  it("aligns a grouped selection's members inside their group, not off the canvas", () => {
    const canvas = new Canvas(document.createElement("canvas"), {
      width: 320,
      height: 180,
    });
    const anchor = rectangle(20, 20, 30, 20);
    const other = rectangle(120, 40, 30, 20);
    const group = new Group([anchor, other]);
    canvas.add(group);
    // A group away from the origin is what separates the two coordinate
    // planes: a child's `left`/`top` are group-local while `getBoundingRect`
    // and `getCenterPoint` are canvas coordinates.
    group.set({ left: 500, top: 300 });
    group.setCoords();
    const beforeAnchorLeft = anchor.getBoundingRect().left;
    const beforeOtherTop = other.getBoundingRect().top;

    const selection = new ActiveSelection([anchor, other], { canvas });
    canvas.setActiveObject(selection);
    const editor = {
      canvas,
      historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
    } as unknown as EditorInteraction;

    expect(applyArrange(editor, "align-left")).toBe(true);

    // Aligned, and the anchor's own edge did not move.
    expect(other.getBoundingRect().left).toBeCloseTo(beforeAnchorLeft, 3);
    expect(anchor.getBoundingRect().left).toBeCloseTo(beforeAnchorLeft, 3);
    // The group's translation is not applied a second time.
    expect(anchor.getBoundingRect().top).toBeCloseTo(beforeOtherTop - 20, 3);
    expect(anchor.parent).toBe(group);
    expect(other.parent).toBe(group);
  });

  it("distributes a grouped selection's members inside their group", () => {
    const canvas = new Canvas(document.createElement("canvas"), {
      width: 320,
      height: 180,
    });
    const first = rectangle(0, 0, 10, 10);
    const middle = rectangle(50, 0, 20, 10);
    const last = rectangle(100, 0, 30, 10);
    const group = new Group([first, middle, last]);
    canvas.add(group);
    group.set({ left: 500, top: 300 });
    group.setCoords();
    const beforeFirst = first.getBoundingRect().left;
    const beforeLastRight =
      last.getBoundingRect().left + last.getBoundingRect().width;

    const selection = new ActiveSelection([first, middle, last], { canvas });
    canvas.setActiveObject(selection);
    const editor = {
      canvas,
      historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
    } as unknown as EditorInteraction;

    expect(applyArrange(editor, "distribute-x")).toBe(true);

    const firstRight =
      first.getBoundingRect().left + first.getBoundingRect().width;
    const middleLeft = middle.getBoundingRect().left;
    const middleRight = middleLeft + middle.getBoundingRect().width;
    // Endpoints unmoved, and in canvas coordinates rather than the group's.
    expect(first.getBoundingRect().left).toBeCloseTo(beforeFirst, 3);
    expect(
      last.getBoundingRect().left + last.getBoundingRect().width,
    ).toBeCloseTo(beforeLastRight, 3);
    expect(middleLeft - firstRight).toBeCloseTo(
      last.getBoundingRect().left - middleRight,
      3,
    );
  });
});

function rectangle(
  left: number,
  top: number,
  width: number,
  height: number,
  angle = 0,
): Rect {
  return new Rect({
    left,
    top,
    width,
    height,
    angle,
    originX: "left",
    originY: "top",
  });
}

function editorFor(...objects: readonly Rect[]) {
  const selection = new ActiveSelection([...objects]);
  const historyManager = { saveState: vi.fn() };
  const canvas = {
    getActiveObject: vi.fn(() => selection),
    discardActiveObject: vi.fn(() => selection.removeAll()),
    fire: vi.fn(),
    setActiveObject: vi.fn((next) => {
      canvas.getActiveObject.mockReturnValue(next);
    }),
    requestRenderAll: vi.fn(),
  };
  const editor = { canvas, historyManager } as unknown as EditorInteraction;
  return { editor, selection, historyManager };
}
