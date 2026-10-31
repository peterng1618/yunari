import { describe, expect, it } from "vitest";
import { insertGroups } from "./new-object-panel.js";
import {
  type ActionGate,
  arrangeActions,
  CONSTRUCTION_ACTIONS,
  constructedShape,
  destructiveMarker,
  isConstructionAction,
  OBJECT_ACTIONS,
  type ObjectActionId,
  type ObjectTarget,
  objectAction,
  objectActionsFor,
} from "./object-actions.js";
import { productShortcutIds } from "./shortcut-manager/index.js";

function target(overrides: Partial<ObjectTarget> = {}): ObjectTarget {
  return {
    kind: "object",
    locked: false,
    memberCount: 1,
    isGroup: false,
    ...overrides,
  };
}

describe("object action registry", () => {
  it("answers eligibility from the projection alone", () => {
    const deleteAction = objectAction("delete");
    expect(deleteAction.eligible(target())).toBe(true);
    expect(deleteAction.eligible(target({ kind: "none" }))).toBe(false);
    expect(deleteAction.eligible(target({ locked: true }))).toBe(false);
  });

  it("reports every action exactly once", () => {
    const ids = OBJECT_ACTIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carries the whole inventory, so a dropped action fails here", () => {
    expect(OBJECT_ACTIONS.map((action) => action.id)).toEqual([
      "duplicate",
      "copy",
      "cut",
      "front",
      "bring-forward",
      "send-backward",
      "back",
      "lock",
      "unlock",
      "group",
      "ungroup",
      "outline-text",
      "delete",
    ]);
  });

  it("marks delete, and only delete, destructive — the registry's own fact", () => {
    // the palette: `--hot` marks destructive affordances, and delete is the only one. The
    // owner is this entry, not a second list inside a surface: the surfaces read
    // this flag through `destructiveMarker`, so a surface cannot re-decide it.
    const destructive = [...OBJECT_ACTIONS, ...arrangeActions()]
      .filter((action) => action.destructive === true)
      .map((action) => action.id);
    expect(destructive).toEqual(["delete"]);
    expect(destructiveMarker(objectAction("delete"))).toEqual({
      "data-yunari-destructive": "",
    });
    expect(destructiveMarker(objectAction("copy"))).toEqual({});
  });

  it("offers group only for a real multi-selection", () => {
    expect(
      objectAction("group").eligible(target({ kind: "group", memberCount: 1 })),
    ).toBe(false);
    expect(
      objectAction("group").eligible(target({ kind: "group", memberCount: 2 })),
    ).toBe(true);
  });

  it("offers the conversion only for one unlocked text object", () => {
    const outline = objectAction("outline-text");
    expect(outline.eligible(target({ text: true }))).toBe(true);
    expect(outline.eligible(target())).toBe(false);
    expect(outline.eligible(target({ text: true, locked: true }))).toBe(false);
  });

  it("refuses arrange for a locked multi-selection, as canArrange does", () => {
    const align = objectAction("arrange:align-left");
    expect(align.eligible(target({ memberCount: 2 }))).toBe(true);
    expect(align.eligible(target({ memberCount: 2, locked: true }))).toBe(
      false,
    );
  });

  it("filters to exactly the actions a gate can run, so a surface cannot re-decide", () => {
    // The gate the dock, the context menu, the pane footer and the layer panel
    // all read. A surface that filtered with its own predicate would agree
    // until the next action joined the registry, so this is the one filter.
    const none: ActionGate = {
      target: () => target({ kind: "none" }),
      canArrange: () => false,
    };
    expect(objectActionsFor(none)).toEqual([]);

    // A single unlocked object: the object actions that apply to it, in
    // registry order, and never an arrange action — those grey rather than
    // disappear, so they are `arrangeActions()`, not this.
    const one: ActionGate = { target: () => target(), canArrange: () => true };
    const ids = objectActionsFor(one).map((action) => action.id);
    expect(ids).toEqual([
      "duplicate",
      "copy",
      "cut",
      "front",
      "bring-forward",
      "send-backward",
      "back",
      "lock",
      "delete",
    ]);
    expect(ids.some((id) => id.startsWith("arrange:"))).toBe(false);

    // A locked object, so the expectation is not only about the two ends of the
    // boundary: a filter that answered "is anything selected" would pass both
    // cases above and fail this one. `unlock` replaces `lock`, and the five
    // actions whose managers refuse a locked object are gone from the middle.
    const locked: ActionGate = {
      target: () => target({ locked: true }),
      canArrange: () => false,
    };
    expect(objectActionsFor(locked).map((action) => action.id)).toEqual([
      "front",
      "bring-forward",
      "send-backward",
      "back",
      "unlock",
    ]);
  });
});

describe("the constructions", () => {
  it("is the Add pane's own primitives, in its own order and its own words", () => {
    // The one thing that could silently drift: two spellings of one kind, or a
    // primitive the Add pane offers and the registry cannot name. Read off
    // `insertGroups` — the Add pane's one owner of the list — rather than written
    // out here, so a primitive added to the pane fails this until the registry's
    // ids carry it too. No surface draws the registry (`vg-570`); the agreement is
    // what makes a construction id's word the pane's own.
    const primitives = insertGroups()
      .flatMap((group) => group.objects)
      .filter((object) => object.kind === "text" || object.kind === "shape");
    expect(primitives.map((object) => object.label)).toEqual(
      CONSTRUCTION_ACTIONS.map((action) => action.label),
    );

    // And the id's tail is the primitive itself, not a word from a list: the one
    // thing `constructedShape` reads, checked against the object the Add pane
    // would have inserted.
    for (const shape of primitives.filter(
      (object) => object.kind === "shape",
    )) {
      const entry = CONSTRUCTION_ACTIONS.find(
        (action) => action.label === shape.label,
      );
      expect(entry?.id).toBe(`new-shape:${shape.shape}`);
    }
    // Text is the arm with no kind, and `undefined` is that fact rather than an
    // empty string a caller would have to test for itself.
    expect(constructedShape("new-text")).toBeUndefined();
  });

  it("keeps constructions out of the commands, so neither filter sees the other", () => {
    // A construction has no selection to be eligible against, which is why it is
    // a second list rather than an entry with an always-true rule: `actionEnabled`
    // takes a `ObjectCommandId`, and a construction's id would not typecheck
    // there. The runtime half of the same fact: the command filter never returns
    // one, whatever the gate says.
    const ids = CONSTRUCTION_ACTIONS.map((action) => action.id);
    expect(ids.every((id) => isConstructionAction(id))).toBe(true);
    // The two families are disjoint, and the accessor both can be handed says
    // which side the id is on rather than answering with the wrong one: a
    // surface that reached a construction through the command lookup would
    // otherwise draw a command's label and glyph under a construction's id.
    for (const id of ids)
      expect(() => objectAction(id)).toThrow(
        "is a construction, not a command",
      );
    const oneAndOnly: ActionGate = {
      target: () => target(),
      canArrange: () => true,
    };
    expect(
      objectActionsFor(oneAndOnly).some((action) =>
        isConstructionAction(action.id),
      ),
    ).toBe(false);
    // And the predicate is not "everything unknown": a command is not one.
    for (const id of ["delete", "arrange:align-left"] as ObjectActionId[])
      expect(isConstructionAction(id)).toBe(false);
  });

  it("reports every construction exactly once", () => {
    const ids = CONSTRUCTION_ACTIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("new-text");
  });
});

describe("object actions and the shortcut table", () => {
  it("references chords the table actually binds", () => {
    const bound = new Set(productShortcutIds());
    for (const action of [...OBJECT_ACTIONS, ...arrangeActions()]) {
      if (action.shortcut === undefined) continue;
      // A shortcut id the table does not bind renders the empty string, so the
      // tooltip would silently say nothing. This is the assertion that stops it.
      expect(bound.has(action.shortcut)).toBe(true);
    }
  });

  it("names the eight chords the canvas offers", () => {
    const named = OBJECT_ACTIONS.filter(
      (action) => action.shortcut !== undefined,
    )
      .map((action) => action.id)
      .sort();
    // Written out rather than counted: eight today, and `arrangeActions()` is
    // deliberately absent from this list because the product binds none of them.
    expect(named).toEqual([
      "back",
      "copy",
      "cut",
      "delete",
      "duplicate",
      "front",
      "group",
      "ungroup",
    ]);
  });
});
