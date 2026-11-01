// @vitest-environment jsdom
import { isLocked } from "@yunari/scene-fabric";
import { ActiveSelection, Canvas, Group, Rect } from "fabric/es";
import { describe, expect, it, vi } from "vitest";
import { type ArrangeAction, applyArrange, canArrange } from "./arrange.js";
import type { EditorInteraction } from "./editor-interaction.js";
import {
  type ActionGate,
  actionEnabled,
  arrangeActions,
  type ObjectTarget,
} from "./object-actions.js";

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
      historyManager: { attachEnvelope: () => {}, saveState: vi.fn() },
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
      historyManager: { attachEnvelope: () => {}, saveState: vi.fn() },
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
      historyManager: { attachEnvelope: () => {}, saveState: vi.fn() },
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

  it("aligns a scaled, rotated group's members in the scene the author sees", () => {
    const { editor, first, middle, last } = transformedGroupEditor();
    const group = first.parent as Group;
    const groupBox = group.getBoundingRect();

    expect(applyArrange(editor, "align-left")).toBe(true);

    // Agreeing with each other is not enough: they must agree in canvas
    // coordinates. A stale cached box makes the delta correct in a displaced
    // plane, so the members line up somewhere the author never selected.
    const left = first.getBoundingRect().left;
    expect(middle.getBoundingRect().left).toBeCloseTo(left, 3);
    expect(last.getBoundingRect().left).toBeCloseTo(left, 3);
    // The move happens inside the group, not by moving the group.
    expect(first.parent).toBe(group);
    expect(group.getBoundingRect().left).toBeCloseTo(groupBox.left, 3);
    expect(group.getBoundingRect().top).toBeCloseTo(groupBox.top, 3);
  });

  it("distributes a scaled, rotated group's members in canvas coordinates", () => {
    const { editor, first, middle, last } = transformedGroupEditor();

    expect(applyArrange(editor, "distribute-x")).toBe(true);

    const firstRight =
      first.getBoundingRect().left + first.getBoundingRect().width;
    const middleLeft = middle.getBoundingRect().left;
    const middleRight = middleLeft + middle.getBoundingRect().width;
    const lastLeft = last.getBoundingRect().left;
    expect(middleLeft - firstRight).toBeCloseTo(lastLeft - middleRight, 3);
    expect(first.parent).toBe(last.parent);
  });

  it("answers actionEnabled and canArrange identically for every refusal shape", () => {
    // Both surfaces used to decide arrange eligibility: the registry from the
    // target projection (its `locked` is the selection's own flag) and the gate
    // from `canArrange` (which reads the members). One owner now, so every shape
    // has one answer — including a selection whose own flag is set while its
    // members are free, which is exactly where the two disagreed.
    const lockedMember = rectangle(50, 0, 10, 10);
    Object.assign(lockedMember, { locked: true });
    const lockedSelection = editorFor(
      rectangle(0, 0, 10, 10),
      rectangle(50, 0, 10, 10),
    );
    Object.assign(lockedSelection.selection, { locked: true });

    const shapes: readonly (readonly [string, EditorInteraction])[] = [
      ["no selection", editorWithoutSelection()],
      ["one object", editorFor(rectangle(0, 0, 10, 10)).editor],
      [
        "two objects",
        editorFor(rectangle(0, 0, 10, 10), rectangle(50, 0, 10, 10)).editor,
      ],
      [
        "three objects",
        editorFor(
          rectangle(0, 0, 10, 10),
          rectangle(50, 0, 10, 10),
          rectangle(100, 0, 10, 10),
        ).editor,
      ],
      [
        "a locked member",
        editorFor(rectangle(0, 0, 10, 10), lockedMember).editor,
      ],
      ["the selection's own locked flag", lockedSelection.editor],
    ];

    for (const [name, editor] of shapes) {
      const gate = gateFor(editor);
      for (const action of arrangeActions()) {
        const verb = action.id.slice("arrange:".length) as ArrangeAction;
        expect(actionEnabled(gate, action.id), `${name}: ${action.id}`).toBe(
          canArrange(editor, verb),
        );
      }
    }
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

/** Three members of one group whose matrix rotates and scales, so a member's
 * own plane and the canvas plane cannot be confused for a translation. */
function transformedGroupEditor() {
  const canvas = new Canvas(document.createElement("canvas"), {
    width: 800,
    height: 600,
  });
  const first = rectangle(0, 0, 20, 10);
  const middle = rectangle(50, 20, 20, 10);
  const last = rectangle(120, 40, 20, 10);
  const group = new Group([first, middle, last], {
    left: 200,
    top: 120,
    scaleX: 1.5,
    scaleY: 1.5,
    angle: 30,
  });
  canvas.add(group);
  canvas.setActiveObject(
    new ActiveSelection([first, middle, last], { canvas }),
  );
  const editor = {
    canvas,
    historyManager: { attachEnvelope: () => {}, saveState: vi.fn() },
  } as unknown as EditorInteraction;
  return { editor, first, middle, last };
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

function editorWithoutSelection(): EditorInteraction {
  const canvas = { getActiveObject: vi.fn(() => undefined) };
  return {
    canvas,
    historyManager: { saveState: vi.fn() },
  } as unknown as EditorInteraction;
}

function gateFor(editor: EditorInteraction): ActionGate {
  return {
    target: () => targetFor(editor),
    canArrange: (action) => canArrange(editor, action),
  };
}

/** The bridge's projection, reduced to the fields the action gate reads. */
function targetFor(editor: EditorInteraction): ObjectTarget {
  const active = editor.canvas.getActiveObject();
  if (active === undefined)
    return { kind: "none", locked: false, memberCount: 0, isGroup: false };
  const inSelection = active instanceof ActiveSelection;
  return {
    kind: active instanceof Group ? "group" : "object",
    locked: isLocked(active),
    memberCount: inSelection ? active.getObjects().length : 1,
    isGroup: active instanceof Group && !inSelection,
  };
}
