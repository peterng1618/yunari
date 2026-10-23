// @vitest-environment jsdom

import { MAX_OBJECT_NAME_LENGTH } from "@yunari/renderer-core";
import { createSceneAdapter, YunariChart } from "@yunari/scene-fabric";
import {
  ActiveSelection,
  Canvas,
  FabricObject,
  Group,
  IText,
  Rect,
} from "fabric/es";
import { beforeEach, expect, it, vi } from "vitest";
import { objectAction } from "../object-actions.js";
import {
  createEditorShellBridge,
  documentNameOf,
  openedStatusText,
} from "./bridge.js";
import type { EditorActionFacade } from "./session-facade.js";

// A real applyArrange needs a live Fabric canvas; spying on it asserts the
// dispatch itself, which `can` alone cannot.
const applyArrange = vi.hoisted(() => vi.fn(() => true));
vi.mock("../arrange.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../arrange.js")>()),
  applyArrange,
}));

beforeEach(() => applyArrange.mockClear());

function facadeStub(): EditorActionFacade {
  return {
    newDocument: vi.fn(async () => undefined),
    newFromStarter: vi.fn(async () => undefined),
    importPackage: vi.fn(),
    openLibraryTheme: vi.fn(async () => undefined),
    savePackage: vi.fn(async () => undefined),
    releasePackage: vi.fn(async () => undefined),
    openLibrary: vi.fn(async () => undefined),
    saveLibrary: vi.fn(async () => undefined),
    addText: vi.fn(),
    addShape: vi.fn(),
    addChart: vi.fn(),
    insertCard: vi.fn(),
    arrange: vi.fn(() => true),
    canArrange: vi.fn(() => false),
    undo: vi.fn(),
    redo: vi.fn(),
    copy: vi.fn(),
    cut: vi.fn(),
    deleteActive: vi.fn(),
    duplicate: vi.fn(),
    group: vi.fn(),
    ungroup: vi.fn(),
    isDirty: vi.fn(() => false),
    publishableDocument: vi.fn(() => undefined),
    subscribeDocumentChange: vi.fn(() => () => undefined),
  };
}

function bridgeFor(
  active: unknown,
  extra: Record<string, unknown> = {},
  sessionExtra: Record<string, unknown> = {},
  canvasExtra: Record<string, unknown> = {},
  bridgeExtra: Record<string, unknown> = {},
) {
  const listeners = new Map<string, () => void>();
  const objects = active === undefined ? [] : [active];
  const canvas = {
    getActiveObject: () => active,
    getObjects: () => objects,
    // Fabric's own add/remove, so a test that deletes or inserts is projecting
    // from the same array the canvas reports. A stub that only answered
    // `getObjects` would make every staleness test pass for the wrong reason.
    add: (object: NonNullable<typeof active>) => objects.push(object),
    remove: (object: NonNullable<typeof active>) => {
      const index = objects.indexOf(object);
      return index < 0 ? [] : objects.splice(index, 1);
    },
    requestRenderAll: vi.fn(),
    on: vi.fn((name: string, listener: () => void) =>
      listeners.set(name, listener),
    ),
    off: vi.fn(),
    // Fabric's own event bus, reduced to what the bridge subscribes to; the
    // options argument is carried so a caller reads as it does on the canvas.
    fire: (name: string, ..._options: readonly unknown[]) =>
      listeners.get(name)?.(),
    ...canvasExtra,
  };
  const editor = {
    canvas,
    // Real editors always carry the grouping manager; the empty context is the
    // default so a test that enters a group overrides only this one member.
    groupingManager: { groupContext: () => [] as readonly unknown[] },
    // Every committed layer command records exactly one history entry, so the
    // stub carries the manager they all go through.
    historyManager: { saveState: vi.fn() },
    ...extra,
  };
  const session = { ...facadeStub(), ...sessionExtra };
  return {
    bridge: createEditorShellBridge({
      editor,
      session,
      ...bridgeExtra,
    } as never),
    canvas,
    session,
    editor,
  };
}

it("reports selection changes and removes its canvas listeners", () => {
  const { bridge, canvas } = bridgeFor(new Rect());

  expect(bridge.snapshot().selectedCount).toBe(1);
  expect(bridge.snapshot().activeKind).toBe("object");

  bridge.destroy();
  expect(canvas.off).toHaveBeenCalled();
});

it("carries the library key the selection's own first run is set in", () => {
  // The Tokens pane's chooser opens on this rather than on
  // `Object.keys(presets)[0]`, which is a default masquerading as an answer
  // (`vg-094`). The reference is `typePresetOf`'s — the pane's keys are its
  // tail — so the field is the key, not the `typePresets.` reference.
  const text = new IText("Hi", { left: 0, top: 0 });
  text.set({
    yunariText: {
      runs: [{ kind: "literal", text: "Hi", typePreset: "typePresets.24-400" }],
    },
  });
  const { bridge } = bridgeFor(text);

  expect(bridge.snapshot().selectionPresetId).toBe("24-400");
});

it("reports no preset for a selection that is set in none, and none for a group", () => {
  // A shape carries no run to read, and a multi-selection is a group rather
  // than the text inside it — both are "carries none", never the first declared
  // preset the pane used to fall back to.
  const shape = bridgeFor(new Rect());
  expect(shape.bridge.snapshot().selectionPresetId).toBeUndefined();

  const text = new IText("Hi", { left: 0, top: 0 });
  text.set({
    yunariText: { runs: [{ kind: "literal", text: "Hi" }] },
  });
  const bare = bridgeFor(text);
  expect(bare.bridge.snapshot().selectionPresetId).toBeUndefined();

  const { bridge: multi } = bridgeFor(
    new ActiveSelection([new IText("a"), new IText("b")]),
  );
  expect(multi.snapshot().selectedCount).toBe(2);
  expect(multi.snapshot().selectionPresetId).toBeUndefined();
});

it("republishes the layer rows when an object changes, not only on selection", () => {
  // A row prints the display name, which lives on the object, so a rename that
  // moves no selection still has to reach the panel — otherwise the layer list
  // and the inspector that changed it disagree.
  const rect = new Rect({ id: "header", width: 10, height: 10 });
  const { bridge, canvas } = bridgeFor(rect);
  const listener = vi.fn();
  bridge.subscribe(listener);

  canvas.fire("object:modified", { target: rect });

  expect(listener).toHaveBeenCalled();
});

it("carries the document's name, and republishes it when the theme is renamed", () => {
  // A rename moves no object, so no canvas event fires for it. Without the
  // session's own document change the snapshot would keep the name the bridge
  // was built with, and the stage's identity chip would show a stale one —
  // which is what the `heard` assertion below is for: the snapshot pulls the
  // name on demand, so only the notification proves the cluster was told.
  let name = "System dashboard";
  const documentListeners: (() => void)[] = [];
  const { bridge } = bridgeFor(
    undefined,
    {},
    {
      subscribeDocumentChange: (listener: () => void) => {
        documentListeners.push(listener);
        return () => undefined;
      },
    },
    {},
    { documentIdentity: () => ({ name, id: "theme-id" }) },
  );
  const heard = vi.fn();
  bridge.subscribe(heard);

  expect(bridge.snapshot().documentName).toBe("System dashboard");

  name = "Kitchen";
  for (const listener of documentListeners) listener();

  expect(heard).toHaveBeenCalled();
  expect(bridge.snapshot().documentName).toBe("Kitchen");
});

it("names a document that reports no name by its id, never by nothing", () => {
  // The field's contract says `documentName` is never `""` — a chip rendering
  // an empty name is the nameless claim §9 forbids, and `DocumentIdentity`
  // hides only on `undefined`, so `""` would render one. An envelope can still
  // hold one: the schema refuses an empty `metadata.name` and the loader
  // supplies the id (`vg-221`), but this reads whatever the document holds,
  // while the `stableId` behind it requires 1–64 characters. `??` alone would
  // pass the empty string straight through, which is the defect this pins.
  const { bridge } = bridgeFor(
    undefined,
    {},
    {},
    {},
    {
      documentIdentity: () => ({ name: "", id: "theme-id" }),
    },
  );
  expect(bridge.snapshot().documentName).toBe("theme-id");

  // A document with no name at all takes the same fallback.
  const { bridge: anonymous } = bridgeFor(
    undefined,
    {},
    {},
    {},
    {
      documentIdentity: () => ({ name: undefined, id: "theme-id" }),
    },
  );
  expect(anonymous.snapshot().documentName).toBe("theme-id");

  // And no document open is still the one case that renders nothing.
  const { bridge: closed } = bridgeFor(undefined);
  expect(closed.snapshot().documentName).toBeUndefined();
});

it("names the document once, so the status line and the chip cannot disagree", () => {
  // vg-218. The reading was spelled three times — twice in `editor-main.ts` for
  // the status line and once in the bridge's projection — and the two spellings
  // had already drifted: the chip took the fallback on an empty
  // `metadata.name` and the status line did not, so an unnamed theme showed its
  // id in the chip and a blank `Opened ` in the status line. Both callers take
  // this one reading now, and the status line's own wording had no test at all
  // — which is what the second half pins.
  expect(documentNameOf({ name: undefined, id: "theme-id" })).toBe("theme-id");
  expect(documentNameOf({ name: "", id: "theme-id" })).toBe("theme-id");
  expect(documentNameOf({ name: "Kitchen", id: "theme-id" })).toBe("Kitchen");

  expect(openedStatusText({ name: "", id: "theme-id" })).toBe(
    "Opened theme-id",
  );
  expect(openedStatusText({ name: "Kitchen", id: "theme-id" })).toBe(
    "Opened Kitchen",
  );
});

it("routes selection kind for menus, groups and charts", () => {
  const { bridge: none } = bridgeFor(undefined);
  expect(none.snapshot().activeKind).toBe("none");

  const { bridge: group } = bridgeFor(new Group([]));
  expect(group.snapshot().activeKind).toBe("group");

  const { bridge: charted } = bridgeFor(
    // A chart instance without a live ECharts backing.
    Object.create(YunariChart.prototype) as YunariChart,
  );
  expect(charted.snapshot().activeKind).toBe("chart");
});

it("delegates layer commands to the editor manager", () => {
  const bringToFront = vi.fn();
  const { bridge } = bridgeFor(new Rect(), { layerManager: { bringToFront } });

  bridge.run("front");

  expect(bringToFront).toHaveBeenCalled();
});

it("runs arrange through the editor owner, not a duplicated implementation", () => {
  const { bridge } = bridgeFor(
    new ActiveSelection([
      new Rect({ left: 0, top: 0, width: 10, height: 10 }),
      new Rect({ left: 20, top: 0, width: 10, height: 10 }),
    ]),
  );

  bridge.run("arrange:align-left");

  // Assert the dispatch: `can` alone would pass without running anything.
  expect(applyArrange).toHaveBeenCalledWith(expect.anything(), "align-left");
});

it("reports a Fabric-free target for the action registry", () => {
  const selection = new ActiveSelection([
    new Rect({ left: 0, top: 0, width: 10, height: 10 }),
    new Rect({ left: 20, top: 0, width: 10, height: 10 }),
  ]);
  const { bridge } = bridgeFor(selection);
  expect(bridge.target()).toEqual({
    kind: "group",
    locked: false,
    memberCount: 2,
    // ActiveSelection extends Group, but it is not a Group for ungrouping.
    isGroup: false,
  });
});

it("agrees with the registry about eligibility", () => {
  const { bridge } = bridgeFor(
    new Group([new Rect({ width: 10, height: 10 })]),
  );
  expect(bridge.can("ungroup")).toBe(true);
  expect(objectAction("ungroup").eligible(bridge.target())).toBe(true);
  // The refusal side matters too: without it an always-true `can` would pass.
  expect(bridge.can("group")).toBe(false);
  expect(objectAction("group").eligible(bridge.target())).toBe(false);
});

it("does not advertise actions a locked selection cannot run", () => {
  const selected = new Rect();
  selected.set("locked", true);
  const { bridge } = bridgeFor(selected);

  expect(bridge.can("delete")).toBe(false);
  expect(bridge.can("lock")).toBe(false);
  expect(bridge.can("unlock")).toBe(true);
  expect(bridge.can("arrange:align-left")).toBe(false);
});

it("gates ungroup on a real Group selection", () => {
  const grouped = new Group([new Rect()]);
  const { bridge } = bridgeFor(grouped);

  expect(bridge.can("ungroup")).toBe(true);
  expect(bridge.can("group")).toBe(false);
});

it("offers its constructions with nothing selected, and runs them through the façade", () => {
  // vg-460: the footer was present and empty until a layer was, because every
  // object command needs a subject. A construction does not, so `can` answers
  // true with no active object at all — the one exemption from the selection
  // gate — and the dispatch is the façade's own route, which pulls the
  // document's theme. A second, editor-only construction here would build a
  // poorer object than the Add pane one gesture away.
  const { bridge, session } = bridgeFor(undefined);
  expect(bridge.snapshot().activeKind).toBe("none");
  expect(bridge.can("new-text")).toBe(true);
  expect(bridge.can("new-shape:ellipse")).toBe(true);
  // The gate still holds for everything that has a subject.
  expect(bridge.can("delete")).toBe(false);
  expect(bridge.can("arrange:align-left")).toBe(false);

  bridge.run("new-text");
  expect(session.addText).toHaveBeenCalledTimes(1);
  bridge.run("new-shape:ellipse");
  expect(session.addShape).toHaveBeenCalledWith("ellipse");
});

it("republishes when an object is deleted, so the row goes with it", () => {
  // A deletion fires no selection event — the active object is discarded
  // first — so the projection was never re-read and the layer list kept a row
  // for something the canvas no longer had. The layer list, the canvas and the
  // inspector disagreed about what the document contained.
  const rect = new Rect({ id: "header", width: 10, height: 10 });
  const { bridge, canvas } = bridgeFor(rect);
  const heard = vi.fn();
  bridge.subscribe(heard);

  canvas.remove(rect);
  canvas.fire("object:removed", { target: rect });
  expect(heard).toHaveBeenCalled();
  expect(bridge.layers().map((row) => row.id)).not.toContain("header");
});

it("republishes when an object is added", () => {
  const { bridge, canvas } = bridgeFor(undefined);
  const heard = vi.fn();
  bridge.subscribe(heard);

  const added = new Rect({ id: "footer", width: 10, height: 10 });
  canvas.add(added);
  canvas.fire("object:added", { target: added });
  expect(heard).toHaveBeenCalled();
  expect(bridge.layers().map((row) => row.id)).toContain("footer");
});

it("carries the object's display name into the projection and back out again", () => {
  const rect = new Rect({
    id: "header",
    width: 10,
    height: 10,
    name: "Header rule",
  });
  const { bridge } = bridgeFor(rect);
  expect(bridge.layers()[0]?.name).toBe("Header rule");

  bridge.renameLayer("header", "Top rule");
  // The name rides on the object, so the next projection reads the write
  // straight back rather than from a second store that could disagree.
  expect(rect.get("name")).toBe("Top rule");
  expect(bridge.layers()[0]?.name).toBe("Top rule");
});

it("clears the stored name when a rename is blank", () => {
  const rect = new Rect({
    id: "header",
    width: 10,
    height: 10,
    name: "Header rule",
  });
  const { bridge } = bridgeFor(rect);
  bridge.renameLayer("header", "   ");
  // Removing the key, not storing whitespace: the projection falls back to the
  // id for an object with no name, which is what a cleared name should show.
  expect(rect.get("name")).toBeUndefined();
  expect(bridge.layers()[0]?.name).toBe("header");
});

it("refuses a rename past the published bound rather than clearing the name", () => {
  // Clearing here would make the author's typing vanish; the panel re-reads the
  // projection, so a refused rename leaves the row showing what it carried.
  const rect = new Rect({
    id: "header",
    width: 10,
    height: 10,
    name: "Header rule",
  });
  const { bridge, editor } = bridgeFor(rect);
  bridge.renameLayer("header", "x".repeat(MAX_OBJECT_NAME_LENGTH + 1));
  expect(rect.get("name")).toBe("Header rule");
  expect(editor.historyManager.saveState).not.toHaveBeenCalled();
});

it("saves one history entry per rename", () => {
  // The name is authored document state now, so it is undoable like any other
  // committed edit (§67) — the editor-only side map it replaces deliberately
  // was not, which is why it could never be what a save carried.
  const rect = new Rect({ id: "header", width: 10, height: 10 });
  const { bridge, editor } = bridgeFor(rect);
  bridge.renameLayer("header", "Top rule");
  expect(editor.historyManager.saveState).toHaveBeenCalledTimes(1);
});

it("selects a group child through its owning group, not the child", () => {
  const child = new Rect({ id: "child", width: 10, height: 10 });
  const group = new Group([child]);
  group.set("id", "group");
  const setActiveObject = vi.fn();
  const { bridge } = bridgeFor(group, {}, {}, { setActiveObject });
  // bridgeFor puts the group on the canvas, so its child is reachable by id.
  bridge.selectLayer("child");
  expect(setActiveObject).toHaveBeenCalledWith(group);
});

it("selects the child itself when its group is the entered context", () => {
  const child = new Rect({ id: "child", width: 10, height: 10 });
  const group = new Group([child]);
  group.set("id", "group");
  const setActiveObject = vi.fn();
  const { bridge } = bridgeFor(
    group,
    { groupingManager: { groupContext: () => [group] } },
    {},
    { setActiveObject },
  );
  // Entering a group is exactly what makes its children reachable on their own,
  // so the tree click must reach the child rather than the group.
  bridge.selectLayer("child");
  expect(setActiveObject).toHaveBeenCalledWith(child);
});

it("resolves a range across one group's children to a single member", () => {
  // The panel opens a group with its own twisty *without* entering it, so two
  // of its rows are clickable while both still resolve through the group that
  // owns them — and a shift-click across those two rows is the only gesture
  // that reaches `selectLayers`'s dedupe (12.4a's own case runs with every card
  // shut, so no two rows ever fold onto one group). Without the dedupe the same
  // object enters the `ActiveSelection` twice.
  const first = new Rect({ id: "first", width: 10, height: 10 });
  const second = new Rect({ id: "second", width: 10, height: 10 });
  const group = new Group([first, second]);
  group.set("id", "group");
  const setActiveObject = vi.fn();
  const { bridge } = bridgeFor(group, {}, {}, { setActiveObject });

  bridge.selectLayers(["first", "second"]);

  // One member, so the group itself — not an `ActiveSelection` holding it twice.
  expect(setActiveObject).toHaveBeenCalledWith(group);
});

it("carries the scene's object total beside the selection", () => {
  // §7.6's left readout, and the one fact the strip carries that is not a
  // message. Counted off the canvas, so it is the scene the layer list projects
  // from rather than a second tally that could drift from it.
  const rect = new Rect({ id: "header", width: 10, height: 10 });
  const { bridge } = bridgeFor(rect);
  expect(bridge.snapshot().objectCount).toBe(1);
  expect(bridge.snapshot().selectedCount).toBe(1);
});

it("counts a scene that holds nothing as zero, and follows it as it changes", () => {
  // `0` is a reading a blank document really has — the starter's composition
  // taken out — and it is a different answer from having no scene to count,
  // which the bridge never reports because it only exists over a mounted one.
  const { bridge, canvas } = bridgeFor(undefined);
  expect(bridge.snapshot().objectCount).toBe(0);

  const added = new Rect({ id: "added", width: 10, height: 10 });
  canvas.add(added);
  canvas.fire("object:added", { target: added });
  expect(bridge.snapshot().objectCount).toBe(1);
});

it("counts the theme's paints, and leaves the reserved `none` out of the count", () => {
  // §7.3's Tokens count. The membership rule is `paletteTokenIds` — the module
  // `PaintList` draws its rows from — so the number beside the title is the
  // number of rows under it: `none` is a reassignment target with no row of its
  // own, and counting it would put the title one above the list it names.
  const palette = {
    none: { name: "None", value: { kind: "solid", color: "#00000000" } },
    cpu: { name: "CPU", value: { kind: "solid", color: "#ff0000" } },
    panel: { name: "Panel", value: { kind: "solid", color: "#111111" } },
  };
  const { bridge } = bridgeFor(
    undefined,
    {},
    {},
    {},
    {
      palette: () => palette,
    },
  );

  expect(bridge.snapshot().tokenCount).toBe(2);
});

it("reads the palette at each snapshot, so a token added moves the count", () => {
  // Pulled, not copied: the session owns the document, so a count frozen at
  // construction would leave the title bar naming a palette the author has
  // since edited — and a document whose globals declare no palette really holds
  // none, which is `0` rather than an absence.
  let palette: Record<string, unknown> = {
    none: { name: "None", value: { kind: "solid", color: "#00000000" } },
  };
  const { bridge } = bridgeFor(
    undefined,
    {},
    {},
    {},
    {
      palette: () => palette,
    },
  );

  expect(bridge.snapshot().tokenCount).toBe(0);

  palette = {
    ...palette,
    cpu: { name: "CPU", value: { kind: "solid", color: "#ff0000" } },
  };
  expect(bridge.snapshot().tokenCount).toBe(1);
});

it("projects the entered group's context as ids, never Fabric objects", () => {
  const child = new Rect({ id: "child", width: 10, height: 10 });
  const group = new Group([child]);
  group.set("id", "group");
  // An anonymous object has no row to mark, so it must not appear as an id.
  const anonymous = new Rect({ width: 10, height: 10 });
  const { bridge } = bridgeFor(group, {
    groupingManager: { groupContext: () => [group, anonymous] },
  });
  expect(bridge.groupContext()).toEqual(["group"]);
});

it("expands the entered group in the projection, so the panel agrees with the canvas", () => {
  // An author who has entered a card is inside it, and a tree still showing
  // that card shut — with an *Expand* button and no row for the part they are
  // editing — is telling them they are somewhere they are not. This is the only
  // place the two surfaces could contradict each other outright, and the
  // projection is where it is answered: the canvas entry and the panel read the
  // same context, rather than the panel being told to expand by a second path.
  const child = new Rect({ id: "child", width: 10, height: 10 });
  const group = new Group([child]);
  group.set("id", "group");
  let entered: readonly unknown[] = [];
  const { bridge } = bridgeFor(group, {
    groupingManager: { groupContext: () => entered },
  });

  // The background row is appended to every projection, so the group's rows
  // are the ones before it.
  const ids = (): readonly string[] =>
    bridge.layers().map((row: { id: string }) => row.id);
  expect(ids()).toEqual(["group", "$background"]);

  entered = [group];
  expect(ids()).toEqual(["group", "child", "$background"]);
  expect(
    bridge.layers().find((row: { id: string }) => row.id === "group")
      ?.collapsed,
  ).toBe(false);

  // Leaving collapses it again, because the context no longer names it — and it
  // is derived, not recorded, so a group the author had opened themselves is
  // still open when they come back out of some *other* group.
  entered = [];
  expect(ids()).toEqual(["group", "$background"]);
});

it("enters the group a row names, so its children become the reachable rows", () => {
  const child = new Rect({ id: "child", width: 10, height: 10 });
  const group = new Group([child]);
  group.set("id", "group");
  // The manager records the entry and answers the context with it, which is what
  // the panel dims and expands from; the stub mirrors that rather than the
  // bridge being told what to think.
  let entered: readonly FabricObject[] = [];
  const enterGroup = vi.fn((options: { object: FabricObject }) => {
    entered = [options.object];
  });
  const { bridge } = bridgeFor(group, {
    groupingManager: { groupContext: () => entered, enterGroup },
  });

  // Shut until entered, because a group is the default view state (§67).
  expect(bridge.layers().map((row) => row.id)).toEqual([
    "group",
    "$background",
  ]);
  bridge.enterGroup("group");

  expect(enterGroup).toHaveBeenCalledWith({ object: group });
  // Asserted through the projection the panel reads, not through the manager:
  // the part the author is inside is a row now, on one click from the tree.
  expect(bridge.groupContext()).toEqual(["group"]);
  expect(bridge.layers().map((row) => row.id)).toEqual([
    "group",
    "child",
    "$background",
  ]);
});

it("enters the group a nested row names, not the group that owns it", () => {
  // `enterGroup` enters the group *around* the object it is handed, one hop up
  // `ownerGroup` — so handing it the nested group itself would enter `outer`,
  // dimming the rows around the parent the author never pressed while the row
  // they did press named `inner`. The nested group is reached through one of its
  // own children instead, which is the same one hop pointing the other way.
  const leaf = new Rect({ id: "leaf", width: 10, height: 10 });
  const inner = new Group([leaf]);
  inner.set("id", "inner");
  const outer = new Group([inner]);
  outer.set("id", "outer");
  let entered: readonly FabricObject[] = [];
  const enterGroup = vi.fn((options: { object: FabricObject }) => {
    // The manager's own rule, in the test's hands: this is what the entry turns
    // into, so the context below is the one the panel would be shown.
    const owner = options.object.parent;
    entered = [owner instanceof Group ? owner : options.object];
  });
  const { bridge } = bridgeFor(outer, {
    groupingManager: { groupContext: () => entered, enterGroup },
  });

  bridge.enterGroup("inner");

  expect(enterGroup).toHaveBeenCalledTimes(1);
  // The consequence first: what the panel would dim is the group the author is
  // inside, and the trap shows up here as `["outer"]`.
  expect(bridge.groupContext()).toEqual(["inner"]);
  expect(enterGroup).toHaveBeenCalledWith({ object: leaf });
});

it("enters nothing for an id the tree no longer holds", () => {
  // Review Focus 3: the row was painted from a projection taken before the undo,
  // delete or ungroup that rebuilt the scene, so the id names nothing the canvas
  // has. A verb that handed the id straight on would give the manager no object,
  // and the manager falls back to the *active* object — entering a group nobody
  // asked for, from a row for something that is gone.
  const child = new Rect({ id: "child", width: 10, height: 10 });
  const group = new Group([child]);
  group.set("id", "group");
  let entered: readonly FabricObject[] = [];
  const enterGroup = vi.fn((options?: { object?: FabricObject }) => {
    // The manager's own fallback, `options?.object ?? canvas.getActiveObject()`,
    // with the group standing in for what is active.
    entered = [options?.object ?? group];
  });
  const { bridge } = bridgeFor(group, {
    groupingManager: { groupContext: () => entered, enterGroup },
  });

  expect(() => bridge.enterGroup("deleted")).not.toThrow();

  expect(enterGroup).not.toHaveBeenCalled();
  expect(bridge.groupContext()).toEqual([]);
  expect(bridge.layers().map((row) => row.id)).toEqual([
    "group",
    "$background",
  ]);
});

it("enters nothing for a row that is not a group", () => {
  const child = new Rect({ id: "child", width: 10, height: 10 });
  const group = new Group([child]);
  group.set("id", "group");
  const enterGroup = vi.fn();
  const { bridge } = bridgeFor(group, {
    groupingManager: { groupContext: () => [], enterGroup },
  });

  // The row names something to select, not somewhere to go: handed on, the
  // manager would resolve it to `group`, an entry the author never asked for.
  bridge.enterGroup("child");
  expect(enterGroup).not.toHaveBeenCalled();
});

it("republishes on entry even when the entered context already agreed", () => {
  const child = new Rect({ id: "child", width: 10, height: 10 });
  const group = new Group([child]);
  group.set("id", "group");
  const { bridge } = bridgeFor(group, {
    // Already entered, so the manager fires no context event for the same entry
    // again — and a verb leaning on that event alone would repaint nothing.
    groupingManager: { groupContext: () => [group], enterGroup: vi.fn() },
  });
  const heard = vi.fn();
  bridge.subscribe(heard);

  bridge.enterGroup("group");

  expect(heard).toHaveBeenCalled();
});

it("leaves the entered group, and leaves an empty context alone", () => {
  const child = new Rect({ id: "child", width: 10, height: 10 });
  const group = new Group([child]);
  group.set("id", "group");
  let entered: readonly FabricObject[] = [];
  const exitGroup = vi.fn(() => {
    const before = [...entered];
    entered = before.slice(0, -1);
    return before;
  });
  const { bridge } = bridgeFor(group, {
    groupingManager: { groupContext: () => entered, exitGroup },
  });
  const rows = (): readonly string[] => bridge.layers().map((row) => row.id);

  // Nothing entered: the manager refuses and no row moves. The bridge still
  // republishes, as `selectLayer` does for a selection it refused.
  bridge.exitGroup();
  expect(bridge.groupContext()).toEqual([]);
  expect(rows()).toEqual(["group", "$background"]);

  entered = [group];
  expect(rows()).toEqual(["group", "child", "$background"]);
  bridge.exitGroup();

  expect(exitGroup).toHaveBeenCalledTimes(2);
  expect(bridge.groupContext()).toEqual([]);
  expect(rows()).toEqual(["group", "$background"]);
});

it("reveals a hidden ancestor path but hides only the requested object", () => {
  const child = new Rect({ id: "child", width: 10, height: 10 });
  // The sibling is hidden on its own account: revealing the child must not
  // reveal it, or "show" would mean "show everything under this group".
  const sibling = new Rect({ id: "sibling", width: 10, height: 10 });
  sibling.set("visible", false);
  const group = new Group([child, sibling], { visible: false });
  group.set("id", "group");
  const saveState = vi.fn();
  const { bridge } = bridgeFor(
    group,
    { historyManager: { saveState } },
    {},
    { requestRenderAll: vi.fn() },
  );

  bridge.setLayerVisible("child", true);
  expect(group.visible).toBe(true);
  expect(child.visible).toBe(true);
  expect(sibling.visible).toBe(false);
  expect(saveState).toHaveBeenCalledTimes(1);

  bridge.setLayerVisible("child", false);
  expect(child.visible).toBe(false);
  expect(group.visible).toBe(true);
});

it("locks through the owning group so a group child stays protected", () => {
  const child = new Rect({ id: "child", width: 10, height: 10 });
  const group = new Group([child]);
  group.set("id", "group");
  const lockObject = vi.fn();
  const unlockObject = vi.fn();
  const { bridge } = bridgeFor(group, {
    objectLockManager: { lockObject, unlockObject },
  });

  bridge.setLayerLocked("child", true);
  expect(lockObject).toHaveBeenCalledWith({ object: group });
  bridge.setLayerLocked("child", false);
  expect(unlockObject).toHaveBeenCalledWith({ object: group });
});

it("keeps collapse in the bridge, and opens a group shut to begin with", () => {
  const child = new Rect({ id: "child", width: 10, height: 10 });
  const group = new Group([child]);
  group.set("id", "group");
  const { bridge } = bridgeFor(group);

  // Shut on open, because a group is the default rather than a state the shell
  // has to record (§67). The flag still lives here, so a remount keeps what the
  // author opened rather than re-asking them.
  expect(bridge.layers().map((row) => row.id)).toEqual([
    "group",
    "$background",
  ]);
  expect(bridge.layers()[0]?.collapsed).toBe(true);
  bridge.setCollapsed("group", false);
  expect(bridge.layers().map((row) => row.id)).toEqual([
    "group",
    "child",
    "$background",
  ]);
  bridge.setCollapsed("group", true);
  expect(bridge.layers().map((row) => row.id)).toEqual([
    "group",
    "$background",
  ]);
});

it("notifies subscribers when a layer command changes the projection", () => {
  const child = new Rect({ id: "child", width: 10, height: 10 });
  const group = new Group([child]);
  group.set("id", "group");
  const { bridge } = bridgeFor(group);
  const seen = vi.fn();
  bridge.subscribe(seen);

  bridge.setCollapsed("group", true);
  expect(seen).toHaveBeenCalled();
});

it("ignores a layer command aimed at an id the tree does not have", () => {
  const setActiveObject = vi.fn();
  const saveState = vi.fn();
  const { bridge } = bridgeFor(
    new Rect({ id: "only" }),
    { historyManager: { saveState } },
    {},
    { setActiveObject, requestRenderAll: vi.fn() },
  );

  bridge.selectLayer("missing");
  bridge.setLayerVisible("missing", true);
  bridge.setLayerLocked("missing", true);
  // A refusal that still did any of this would corrupt unrelated state.
  expect(setActiveObject).not.toHaveBeenCalled();
  expect(saveState).not.toHaveBeenCalled();
});

it("reorders within one parent and reports the move", () => {
  const canvas = new Canvas(document.createElement("canvas"));
  const alpha = new Rect({ left: 0, top: 0, width: 10, height: 10 });
  const beta = new Rect({ left: 20, top: 0, width: 10, height: 10 });
  alpha.set("id", "alpha");
  beta.set("id", "beta");
  canvas.add(alpha, beta);
  const saveState = vi.fn();
  const { bridge } = bridgeFor(undefined, {
    canvas,
    historyManager: { saveState },
  });

  const order = (): unknown[] =>
    canvas.getObjects().map((object) => object.get("id"));

  // Paint order is bottom-first; the panel reverses it for display.
  expect(order()).toEqual(["alpha", "beta"]);
  expect(bridge.moveLayer("alpha", "beta")).toBe(true);
  expect(order()).toEqual(["beta", "alpha"]);
  // Reordering is authored state: without this the drop would not reach the
  // saved envelope, and the browser test below is the only other thing that
  // would notice.
  expect(saveState).toHaveBeenCalledTimes(1);
});

it("moves a layer across a group boundary, in and out", () => {
  // vg-461: the refusal was by construction rather than by a rule. The anchor
  // names the container — its own parent — so one operation covers both
  // directions, and what the author gets is the object in a different place in
  // the tree: 0044's rung 6 measured that nothing moves on the screen either
  // way, because the transform bake is Fabric's own.
  const canvas = new Canvas(document.createElement("canvas"));
  const child = new Rect({ left: 0, top: 0, width: 10, height: 10 });
  const loose = new Rect({ left: 60, top: 0, width: 10, height: 10 });
  child.set("id", "child");
  loose.set("id", "loose");
  const group = new Group([child]);
  group.set("id", "grp");
  canvas.add(group, loose);
  const saveState = vi.fn();
  const { bridge } = bridgeFor(undefined, {
    canvas,
    historyManager: { saveState },
  });
  const ids = (objects: readonly { get(key: string): unknown }[]): unknown[] =>
    objects.map((object) => object.get("id"));

  // In, above the group's only child: the anchor is inside, so the container is
  // the group. The panel paints topmost-first, so `loose` now has a row above
  // `child`'s and no row of its own at the root.
  expect(bridge.layerDrop("loose", "child")).toEqual({
    kind: "slot",
    before: "child",
  });
  expect(bridge.moveLayer("loose", "child")).toBe(true);
  expect(ids(canvas.getObjects())).toEqual(["grp"]);
  expect(ids(group.getObjects())).toEqual(["child", "loose"]);
  expect(loose.parent).toBe(group);

  // And back out, above the group itself: the anchor is at the root, so that is
  // the container the drop enters.
  expect(bridge.layerDrop("loose", "grp")).toEqual({
    kind: "slot",
    before: "grp",
  });
  expect(bridge.moveLayer("loose", "grp")).toBe(true);
  expect(ids(canvas.getObjects())).toEqual(["grp", "loose"]);
  expect(ids(group.getObjects())).toEqual(["child"]);
  expect(loose.parent).toBeUndefined();
  expect(saveState).toHaveBeenCalledTimes(2);
});

it("refuses a cycle, before the drop rather than after it", () => {
  // Fabric's own `canEnterGroup` refuses this by *logging* the refusal, so the
  // add would be dropped and the move would silently do nothing. The refusal is
  // made here, in the tree's own terms, which is also what lets the panel mark
  // the row refused rather than promising a slot it cannot take.
  const canvas = new Canvas(document.createElement("canvas"));
  const child = new Rect({ left: 0, top: 0, width: 10, height: 10 });
  child.set("id", "child");
  const group = new Group([child]);
  group.set("id", "grp");
  canvas.add(group);
  const { bridge } = bridgeFor(undefined, {
    canvas,
    historyManager: { saveState: vi.fn() },
  });
  const ids = (objects: readonly { get(key: string): unknown }[]): unknown[] =>
    objects.map((object) => object.get("id"));

  expect(bridge.layerDrop("grp", "child")).toBeUndefined();
  expect(bridge.moveLayer("grp", "child")).toBe(false);
  expect(ids(canvas.getObjects())).toEqual(["grp"]);
  expect(ids(group.getObjects())).toEqual(["child"]);
  // A row dropped on itself is neither a slot nor a refusal: there is nothing
  // to move, and the panel answers with neither mark.
  expect(bridge.layerDrop("child", "child")).toBeUndefined();
});

it("leaves a reparented object alive in the scene the adapter is drawing", async () => {
  // The reviewer's P1, as a case: with the scene adapter installed,
  // `canvas.remove` fires `object:removed`, which the adapter reads as "this node
  // left the scene" and disposes (`scene-fabric/src/adapter.ts:62`). The chart
  // still serializes afterwards, so a save that looks right reloads wrong — and
  // the drag tests that omit the adapter cannot see it, which is why this one
  // installs it. A chart rather than a rect: dispose is what releases its ECharts
  // instance and backing pixels, and a plain Rect makes the defect invisible.
  const canvas = new Canvas(document.createElement("canvas"));
  const child = new Rect({ left: 0, top: 0, width: 10, height: 10 });
  child.set("id", "child");
  const group = new Group([child]);
  group.set("id", "grp");
  const chart = new YunariChart({
    id: "chart",
    width: 100,
    height: 60,
    family: "bar",
    settings: {},
  } as never);
  canvas.add(group, chart);
  const adapter = createSceneAdapter({ canvas });
  const { bridge } = bridgeFor(undefined, {
    canvas,
    historyManager: { saveState: vi.fn() },
  });

  expect(chart.disposed).toBe(false);
  expect(bridge.moveLayer("chart", "child")).toBe(true);
  // In the group, and still the object it was.
  expect(group.getObjects()).toEqual([child, chart]);
  expect(chart.disposed).toBe(false);
  // And in the scene once: the root array let it go, so the group is not a
  // second place it is painted from or serialized by.
  expect(canvas.getObjects()).toEqual([group]);
  expect(JSON.stringify(canvas.toObject(["id"]))).toContain('"chart"');
  expect(
    JSON.stringify(canvas.toObject(["id"])).match(/"chart"/g),
  ).toHaveLength(1);
  adapter.dispose();
  await canvas.dispose();
});

it("refreshes the cached boxes a reparent moves", async () => {
  // The reviewer's second finding, as a case. `FitContentLayout` always commits
  // a layout, so inserting beside a child rebases every member's `left`/`top` —
  // but a cached box is not recomputed by that, and `Group.setCoords` only
  // cascades while `subTargetCheck` is on (a default group's is off). Left
  // alone, the cached box disagrees with the transform it belongs to and
  // `sceneBoxesOf` reports a box nothing moved.
  const canvas = new Canvas(document.createElement("canvas"));
  const a = new Rect({ left: 0, top: 0, width: 20, height: 20 });
  const b = new Rect({ left: 80, top: 0, width: 20, height: 20 });
  const loose = new Rect({ left: 300, top: 170, width: 20, height: 20 });
  a.set("id", "a");
  b.set("id", "b");
  loose.set("id", "loose");
  const group = new Group([a, b], { angle: 24, scaleX: 1.4 });
  group.set("id", "grp");
  canvas.add(group, loose);
  // Every cache populated before the move, as a live editor's would be after
  // one paint: without this `getBoundingRect` has nothing cached to read and
  // recomputes, so a stale box could not be observed at all — the case would
  // pass for the wrong reason.
  for (const object of [a, b, loose, group]) object.setCoords();
  const { bridge } = bridgeFor(undefined, {
    canvas,
    historyManager: { saveState: vi.fn() },
  });

  expect(bridge.moveLayer("loose", "a")).toBe(true);
  // Read the cache first, then let Fabric recompute it: the two must agree, or
  // the box a reader consumed was stale.
  const stale = [a, b, loose, group].filter((object) => {
    const cached = object.getBoundingRect();
    const refreshed = (object.setCoords(), object.getBoundingRect());
    return Math.abs(cached.left - refreshed.left) > 1e-6;
  });
  expect(stale.map((object) => object.get("id"))).toEqual([]);

  await canvas.dispose();
});

it("leaves the canvas in the state a removal leaves, except the object itself", async () => {
  // P1's second half, and the shape the acceptance asks for: parity with the
  // removal this path stands in for, measured, rather than "the two fields are
  // cleared" — a case asserting only the fields its author knew about is what
  // let the disposal through four green tests. `canvas.remove` runs
  // `Canvas._onObjectRemoved` (`fabric/src/canvas/SelectableCanvas.ts:356`),
  // which releases the canvas's active object and its hovered target as well as
  // the render list. The hand-written detach reproduced the render list alone,
  // so a moved object stayed the canvas's active *and* hovered target — a state
  // `selectLayer`'s own rule forbids, and one the next transform gesture would
  // write from, against a plane the object has left.
  const build = () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const child = new Rect({ left: 0, top: 0, width: 10, height: 10 });
    child.set("id", "child");
    const group = new Group([child]);
    group.set("id", "grp");
    const chart = new YunariChart({
      id: "chart",
      width: 100,
      height: 60,
      family: "bar",
      settings: {},
    } as never);
    canvas.add(group, chart);
    const adapter = createSceneAdapter({ canvas });
    // What a live editor holds mid-drag: the row being moved is selected and is
    // whatever the pointer last hovered. All three fields, because that is what
    // a real hover writes (`fabric/src/canvas/Canvas.ts:1236`) — and leaving
    // `_hoveredActualTarget` out of the fixture is what made this case blind to
    // the one field the removal hook does *not* clear (`vg-487`, Fabric's side,
    // not fixed here).
    canvas.setActiveObject(chart);
    canvas._hoveredTarget = chart;
    canvas._hoveredTargets = [chart];
    canvas._hoveredActualTarget = chart;
    const { bridge } = bridgeFor(undefined, {
      canvas,
      historyManager: { saveState: vi.fn() },
    });
    return { canvas, group, chart, bridge, adapter };
  };
  // The state is projected by *shape*, not by a list of names. A removal
  // changes a canvas in one of three shapes — a reference to an object, a list
  // of them, or a field the hook clears — and everything else on a canvas is
  // either binder plumbing (contexts, elements, options, a rAF handle) or a
  // derived cache the object rebuilds, and both differ between two canvases for
  // reasons a move has nothing to do with. A list of
  // names is what let this case miss `_hoveredActualTarget`, which
  // `_onObjectRemoved` does *not* clear and no reader would have thought to
  // write down; projected by shape it is in the state, and so is any field a
  // future Fabric clears that this fix would have to clear too.
  const stateOf = (scene: ReturnType<typeof build>) => {
    const entry = (value: unknown): string | undefined => {
      if (value === scene.canvas) return "this canvas";
      if (value instanceof FabricObject)
        return `object ${String(value.get("id"))}`;
      return undefined;
    };
    const state: Record<string, string | string[] | boolean> = {
      // The one expected difference, named here so the assertion can exclude it
      // by name rather than by leaving it out of a list.
      "chart.disposed": scene.chart.disposed,
    };
    for (const source of [scene.canvas, scene.chart]) {
      for (const key of Object.keys(source)) {
        const value = (source as unknown as Record<string, unknown>)[key];
        const single = entry(value);
        if (single !== undefined) state[key] = single;
        else if (
          Array.isArray(value) &&
          value.every((item) => item instanceof FabricObject)
        )
          state[key] = value.map((item) => `object ${String(item.get("id"))}`);
      }
    }
    return state;
  };
  const differences = (
    left: Record<string, unknown>,
    right: Record<string, unknown>,
  ): string[] =>
    [...new Set([...Object.keys(left), ...Object.keys(right)])]
      .filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]))
      .sort();

  // The reference: what a deletion leaves, which is the path `moveLayer` took
  // before `detachFromRoot` existed. The dispose is the remover's own since
  // `vg-486` (ADR-0052) — the scene adapter used to dispose whatever anyone
  // removed, and no longer does — so a bare `canvas.remove` is now the *detach*
  // half of a deletion and the deleting owner says the other half.
  const removed = build();
  removed.canvas.remove(removed.chart);
  removed.chart.dispose();
  removed.group.insertAt(1, removed.chart);
  removed.canvas.requestRenderAll();

  const moved = build();
  expect(moved.bridge.moveLayer("chart", "child")).toBe(true);

  // The reference disposes and the fixed path does not, which is the one
  // difference this fix exists for; everything else must match it exactly —
  // and the difference is asserted, not assumed: any other key that diverges,
  // including one this case was never told about, joins the list and fails it.
  expect(stateOf(removed)["chart.disposed"]).toBe(true);
  expect(stateOf(moved)["chart.disposed"]).toBe(false);
  // Coverage, so a projection that quietly dropped a field cannot pass: these
  // are the reference-shaped fields the fixture sets that survive the move, and
  // `_hoveredActualTarget` among them is the point — it is the field the removal
  // hook does not clear, and a set that never held it could not report a
  // divergence in it. The cleared ones (`_activeObject`, `_hoveredTarget`) are
  // absent from both projections, which is the parity being asserted.
  expect(Object.keys(stateOf(moved))).toEqual(
    expect.arrayContaining([
      "_hoveredActualTarget",
      "_hoveredTargets",
      "_objects",
      "canvas",
      "group",
    ]),
  );
  expect(differences(stateOf(removed), stateOf(moved))).toEqual([
    "chart.disposed",
  ]);
  expect(differences(stateOf(moved), stateOf(removed))).toEqual([
    "chart.disposed",
  ]);

  removed.adapter.dispose();
  moved.adapter.dispose();
  await removed.canvas.dispose();
  await moved.canvas.dispose();
});

it("refreshes the caches beside a nested destination, not only those the drop names", async () => {
  // Finding 2: the refresh ran on the destination and on the source collection
  // only when the source was not the root, so a drag that *started* at the root
  // never refreshed the root. A reparent's blast radius is a question about
  // nesting — a container's box is the fit of its subtree, and its other
  // children read their box through its matrix — so `outer[inner[a, b], peer]`
  // with a root `loose` dropped on `a` names `inner` and leaves `peer` stale,
  // even though no collection this path named contains it.
  const canvas = new Canvas(document.createElement("canvas"));
  const a = new Rect({ left: 0, top: 0, width: 20, height: 20 });
  const b = new Rect({ left: 80, top: 0, width: 20, height: 20 });
  const peer = new Rect({ left: 0, top: 200, width: 20, height: 20 });
  const loose = new Rect({ left: 400, top: 170, width: 20, height: 20 });
  const named: readonly (readonly [FabricObject, string])[] = [
    [a, "a"],
    [b, "b"],
    [peer, "peer"],
    [loose, "loose"],
  ];
  for (const [object, id] of named) object.set("id", id);
  const inner = new Group([a, b], { angle: 24, scaleX: 1.4 });
  inner.set("id", "inner");
  const outer = new Group([inner, peer]);
  outer.set("id", "outer");
  canvas.add(outer, loose);
  const scene = [outer, inner, a, b, peer, loose];
  // Every cache populated, for the reason the flat case states: an unprimed box
  // is recomputed rather than read, so staleness would be unobservable.
  for (const object of scene) object.setCoords();
  const { bridge } = bridgeFor(undefined, {
    canvas,
    historyManager: { saveState: vi.fn() },
  });

  expect(bridge.moveLayer("loose", "a")).toBe(true);
  const stale = scene.filter((object) => {
    const cached = object.getBoundingRect();
    const refreshed = (object.setCoords(), object.getBoundingRect());
    return Math.abs(cached.left - refreshed.left) > 1e-6;
  });
  expect(stale.map((object) => object.get("id"))).toEqual([]);

  await canvas.dispose();
});

it("fills a group that has nothing in it, and refills one a drag emptied", async () => {
  // The reviewer's third finding. The destination is the anchor's *parent*, so
  // dropping on a group row lands beside the group and entering it requires
  // targeting a child row — which a group with no children does not have, so a
  // group emptied by dragging its last child out could never be refilled.
  const canvas = new Canvas(document.createElement("canvas"));
  const child = new Rect({ left: 0, top: 0, width: 10, height: 10 });
  const other = new Rect({ left: 40, top: 0, width: 10, height: 10 });
  child.set("id", "child");
  other.set("id", "other");
  const group = new Group([child]);
  group.set("id", "grp");
  canvas.add(group, other);
  const { bridge } = bridgeFor(undefined, {
    canvas,
    historyManager: { saveState: vi.fn() },
  });
  const ids = (objects: readonly { get(key: string): unknown }[]): unknown[] =>
    objects.map((object) => object.get("id"));

  // Out of the group, onto a root sibling, which leaves the group empty.
  expect(bridge.layerDrop("child", "other")).toEqual({
    kind: "slot",
    before: "other",
  });
  expect(bridge.moveLayer("child", "other")).toBe(true);
  expect(ids(group.getObjects())).toEqual([]);

  // And back in, on the group's own row — the one row left that can name it.
  expect(bridge.layerDrop("child", "grp")).toEqual({
    kind: "into",
    container: "grp",
  });
  expect(bridge.moveLayer("child", "grp")).toBe(true);
  expect(ids(group.getObjects())).toEqual(["child"]);
  expect(child.parent).toBe(group);

  // A group with children keeps its row as a *slot*: that is what makes
  // dragging a row out of a group work, and its interior is reachable through
  // the child rows it draws.
  expect(bridge.layerDrop("other", "grp")).toEqual({
    kind: "slot",
    before: "grp",
  });

  await canvas.dispose();
});

it("refuses an unknown id instead of moving something else", () => {
  const canvas = new Canvas(document.createElement("canvas"));
  const alpha = new Rect();
  const beta = new Rect();
  alpha.set("id", "alpha");
  beta.set("id", "beta");
  canvas.add(alpha, beta);
  const { bridge } = bridgeFor(undefined, {
    canvas,
    historyManager: { saveState: vi.fn() },
  });

  const before = canvas.getObjects().map((object) => object.get("id"));
  expect(bridge.moveLayer("nope", "beta")).toBe(false);
  expect(bridge.moveLayer("alpha", "nope")).toBe(false);
  expect(canvas.getObjects().map((object) => object.get("id"))).toEqual(before);
});

it("reorders inside a group without lifting the child out of it", () => {
  // The regression this test exists for: `siblings` is the group's array while
  // the move was issued on the canvas, so the child landed in the canvas root
  // *and* stayed in the group. `canvas.getObjects()` is the assertion that
  // catches it — the same-parent test above cannot, because its siblings are
  // canvas-root and the two arrays happen to be the same one.
  const canvas = new Canvas(document.createElement("canvas"));
  const child = new Rect({ left: 0, top: 0, width: 10, height: 10 });
  const peer = new Rect({ left: 20, top: 0, width: 10, height: 10 });
  child.set("id", "child");
  peer.set("id", "peer");
  const group = new Group([child, peer]);
  group.set("id", "grp");
  canvas.add(group);
  const saveState = vi.fn();
  const { bridge } = bridgeFor(undefined, {
    canvas,
    historyManager: { saveState },
  });

  const ids = (objects: readonly { get(key: string): unknown }[]): unknown[] =>
    objects.map((object) => object.get("id"));

  expect(ids(canvas.getObjects())).toEqual(["grp"]);
  expect(ids(group.getObjects())).toEqual(["child", "peer"]);
  expect(bridge.moveLayer("child", "peer")).toBe(true);
  // The group is still the only canvas-root object, and the child is still in it.
  expect(ids(canvas.getObjects())).toEqual(["grp"]);
  expect(ids(group.getObjects())).toEqual(["peer", "child"]);
  expect(child.group).toBe(group);
  expect(saveState).toHaveBeenCalledTimes(1);
});

/** A canvas stub whose active object actually moves, so selecting the
 *  background has to clear it rather than merely not set it. */
function selectionCanvas(initial: FabricObject | undefined): {
  readonly canvas: Record<string, unknown>;
  readonly active: () => FabricObject | undefined;
} {
  let active = initial;
  return {
    canvas: {
      getActiveObject: () => active,
      setActiveObject: (object: FabricObject) => {
        active = object;
      },
      discardActiveObject: () => {
        active = undefined;
      },
    },
    active: () => active,
  };
}

it("selecting the background clears the Fabric selection", () => {
  const rect = new Rect({ id: "rect", width: 10, height: 10 });
  const { canvas: stub, active } = selectionCanvas(rect);
  const { bridge } = bridgeFor(rect, {}, {}, stub as Record<string, unknown>);

  bridge.selectLayer("$background");

  expect(active()).toBeUndefined();
  expect(bridge.backgroundSelected()).toBe(true);
  expect(bridge.snapshot().activeKind).toBe("background");
  expect(bridge.snapshot().selectedCount).toBe(1);
  expect(bridge.snapshot().locked).toBe(false);
  // There is no Fabric subject behind the background, so the action gate sees
  // no selection rather than a selection it cannot act on.
  expect(bridge.target().kind).toBe("none");
  expect(bridge.layers().at(-1)?.id).toBe("$background");
  expect(bridge.layers().at(-1)?.selected).toBe(true);
  // The row is not a scene object, so the object total does not move.
  expect(bridge.snapshot().objectCount).toBe(1);
});

it("any object selection clears the background", () => {
  const rect = new Rect({ id: "rect", width: 10, height: 10 });
  const { canvas: stub, active } = selectionCanvas(rect);
  const { bridge } = bridgeFor(rect, {}, {}, stub as Record<string, unknown>);

  bridge.selectLayer("$background");
  bridge.selectLayer("rect");

  expect(bridge.backgroundSelected()).toBe(false);
  expect(active()).toBe(rect);
  expect(bridge.snapshot().activeKind).toBe("object");
  expect(bridge.layers().at(-1)?.selected).toBe(false);
});

it("cannot be mixed into a multi-selection", () => {
  const rect = new Rect({ id: "rect", width: 10, height: 10 });
  const { canvas: stub, active } = selectionCanvas(rect);
  let setActiveObject = 0;
  const { bridge } = bridgeFor(
    rect,
    {},
    {},
    {
      ...stub,
      setActiveObject: (object: FabricObject) => {
        setActiveObject += 1;
        (stub.setActiveObject as (object: FabricObject) => void)(object);
      },
    },
  );

  bridge.selectLayers(["rect", "$background"]);

  expect(bridge.backgroundSelected()).toBe(true);
  expect(active()).toBeUndefined();
  // The background alone, not a set: a gesture naming it never selects a
  // Fabric object beside it.
  expect(setActiveObject).toBe(0);
  expect(bridge.snapshot().selectedCount).toBe(1);
});

it("a Fabric selection event clears the background", () => {
  const { canvas: stub } = selectionCanvas(undefined);
  const { bridge, canvas } = bridgeFor(
    undefined,
    {},
    {},
    stub as Record<string, unknown>,
  );
  bridge.selectLayer("$background");
  expect(bridge.backgroundSelected()).toBe(true);

  // A canvas drag or a programmatic selection is Fabric's own event, not a
  // `selectLayers` call, and it clears the flag the same way.
  canvas.fire("selection:created");
  expect(bridge.backgroundSelected()).toBe(false);
  expect(bridge.snapshot().activeKind).toBe("none");
});
