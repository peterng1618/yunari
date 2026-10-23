// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Canvas, Group, Rect } from "fabric/es";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { createGroupingManager } from "../grouping-manager/index.js";
import {
  CompositionPane,
  LAYER_ROW_INDENT,
  ROW_HEIGHT,
} from "../panes/composition/composition-pane.js";
import { uiCopy } from "../ui-copy.js";
import {
  createEditorShellBridge,
  type EditorShellBridge,
  type LayerDrop,
} from "./bridge.js";
import type {
  LayerKind,
  LayerMark,
  LayerRole,
  LayerRow,
} from "./layer-tree.js";

/** The mark a fixture gets unless it names its own: the kind's own glyph, and
 *  for the two kinds whose glyph names something more, a primitive and a family
 *  a real document could hold. */
function markFor(kind: LayerKind): LayerMark {
  switch (kind) {
    case "chart":
      return { kind, family: "bar" };
    case "shape":
      return { kind, shape: "rect" };
    case "text":
    case "image":
    case "group":
    case "background":
      return { kind };
  }
}

/** The role a fixture gets unless it names its own: the bare arm for its kind.
 *  A chart's family and series count come from a document, so a fixture whose
 *  case is about either fills them in. */
function roleFor(kind: LayerKind): LayerRole {
  switch (kind) {
    case "chart":
      return { kind, family: undefined, series: 1 };
    case "group":
      return { kind, unit: undefined };
    case "text":
    case "shape":
    case "image":
    case "background":
      return { kind };
  }
}

/** A row as the projection emits it, from the parts a test cares about.
 *
 * The mark, the role and the bound key are required by the projection, so a
 * fixture that left them out would crash the panel before the assertion under
 * test ran. Filling them here keeps twenty fixtures that are about selection
 * from each restating a treatment none of them is looking at. */
function layerRow(
  parts: Partial<Omit<LayerRow, "mark">> & { readonly mark?: LayerMark } = {},
): LayerRow {
  const kind = parts.kind ?? "text";
  return {
    id: "layer",
    name: "Layer",
    kind,
    mark: markFor(kind),
    role: roleFor(kind),
    bound: [],
    depth: 0,
    parentId: undefined,
    hasChildren: false,
    collapsed: false,
    visible: true,
    locked: false,
    selected: false,
    ...parts,
  };
}

function bridge(rows: readonly LayerRow[], overrides = {}): EditorShellBridge {
  return {
    snapshot: () => ({
      objectCount: rows.length,
      tokenCount: 0,
      selectedCount: 1,
      locked: false,
      activeKind: "object",
      documentName: undefined,
      selectionPresetId: undefined,
    }),
    capture: () => undefined,
    can: () => true,
    target: () => ({
      kind: "object",
      locked: false,
      memberCount: 1,
      isGroup: false,
    }),
    canArrange: () => false,
    // Completed here rather than in twenty fixtures: `layerRow` fills only what
    // a fixture left out, so a row that names its own treatment still has it.
    layers: () => rows.map((row) => layerRow(row)) as never,
    backgroundSelected: () => false,
    groupContext: () => [],
    selectLayers: vi.fn(),
    selectLayer: vi.fn(),
    enterGroup: vi.fn(),
    exitGroup: vi.fn(),
    setLayerVisible: vi.fn(),
    setLayerLocked: vi.fn(),
    renameLayer: vi.fn(),
    setCollapsed: vi.fn(),
    layerDrop: () => undefined,
    moveLayer: () => false,
    subscribe: () => () => undefined,
    run: vi.fn(),
    session: { savePackage: vi.fn() } as never,
    editor: {} as never,
    destroy: vi.fn(),
    ...overrides,
  } as EditorShellBridge;
}

it("titles a row with what it says rather than the key behind it", async () => {
  // A tooltip printing the raw uuid told the author nothing the row did not,
  // and the name is what every other surface shows for this object.
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <CompositionPane bridge={bridge([{ ...textRow, name: "Brand mark" }])} />,
    ),
  );

  const row = host.querySelector<HTMLElement>('[data-yunari-layer="wordmark"]');
  expect(row?.title).toBe("Brand mark");
});

it("indents a group child and carries the row's controls once it is selected", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <CompositionPane
        bridge={bridge([
          layerRow({
            id: "group",
            name: "Group",
            kind: "group",
            hasChildren: true,
          }),
          layerRow({
            id: "child",
            name: "Child",
            kind: "text",
            depth: 1,
            parentId: "group",
            locked: true,
            selected: true,
          }),
        ])}
      />,
    ),
  );

  const rows = host.querySelectorAll<HTMLElement>("[data-yunari-layer]");
  expect(rows).toHaveLength(2);
  // One dense line, plus the two state indicators — not six text buttons, and
  // no pen beside the name (`vg-462`).
  expect(rows[1]?.style.getPropertyValue("--layer-depth")).toBe("1");
  expect(rows[1]?.querySelectorAll("button")).toHaveLength(2);
  expect(rows[1]?.querySelector('[aria-label="Unlock"]')).not.toBeNull();
  // The group row is marked as a group for the stylesheet, which bolds its name,
  // and it carries the generic stack glyph the kind arm draws (§5.1).
  expect(rows[0]?.getAttribute("data-kind")).toBe("group");
  expect(
    rows[0]?.querySelector('[data-yunari-layer-mark="group"]'),
  ).not.toBeNull();
});

/** The rename field is seeded with `defaultValue`, which React tracks on the
 * DOM node, so assigning `.value` directly is swallowed. Go through the
 * prototype setter and fire the event React listens for. */
function typeInto(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const textRow = layerRow({ id: "wordmark", name: "wordmark", kind: "text" });

async function renderPanel(
  rows: readonly LayerRow[],
  overrides = {},
): Promise<HTMLElement> {
  const host = document.createElement("div");
  await act(async () =>
    (await Promise.resolve(createRoot(host))).render(
      <CompositionPane bridge={bridge(rows, overrides)} />,
    ),
  );
  return host;
}

function renameField(host: HTMLElement): HTMLInputElement {
  return host.querySelector<HTMLInputElement>(
    '[aria-label="Rename wordmark"]',
  )!;
}

/** The one answer the panel asks the bridge about before a drop, keyed by the
 *  fixture's own `parentId`s: a row may not land inside a subtree it contains,
 *  and a container with nothing in it can only be named as a destination by its
 *  own row. Each drag case below wires this rather than re-spelling the rule, so
 *  the cases differ in the tree they drag and not in the refusal they assume. */
function moveRule(
  rows: readonly LayerRow[],
): (from: string, anchor: string) => LayerDrop | undefined {
  const parentOf = new Map(rows.map((row) => [row.id, row.parentId]));
  const hollow = new Set(
    rows
      .filter((row) => row.kind === "group" && !row.hasChildren)
      .map((r) => r.id),
  );
  const contains = (ancestor: string, id: string): boolean => {
    for (let at = parentOf.get(id); at !== undefined; at = parentOf.get(at)) {
      if (at === ancestor) return true;
    }
    return false;
  };
  return (from, anchor) => {
    if (from === anchor || contains(from, anchor)) return undefined;
    return hollow.has(anchor)
      ? { kind: "into", container: anchor }
      : { kind: "slot", before: anchor };
  };
}

/** A key press on the focused row, awaited so React flushes a focus move. */
async function pressOnFocused(host: HTMLElement, key: string): Promise<void> {
  await act(async () => {
    host.ownerDocument.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true }),
    );
    await Promise.resolve();
  });
}

it("commits a rename typed into the field on Enter", async () => {
  const renameLayer = vi.fn();
  const host = await renderPanel([textRow], { renameLayer });
  await act(async () =>
    host
      .querySelector<HTMLElement>('[data-yunari-layer="wordmark"]')
      ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
  );
  const input = renameField(host);
  await act(async () => {
    typeInto(input, "Brand mark");
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
  expect(renameLayer).toHaveBeenCalledWith("wordmark", "Brand mark");
});

it("does not commit a rename cancelled with Escape", async () => {
  const renameLayer = vi.fn();
  const host = await renderPanel([textRow], { renameLayer });
  await act(async () =>
    host
      .querySelector<HTMLElement>('[data-yunari-layer="wordmark"]')
      ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
  );
  const input = renameField(host);
  await act(async () => {
    typeInto(input, "Discarded");
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  // The field must actually close, or the negative below would pass on a
  // component that swallowed Escape entirely.
  expect(host.querySelector('[aria-label="Rename wordmark"]')).toBeNull();
  expect(renameLayer).not.toHaveBeenCalled();
});

it("does not commit when the cancelled field unmounts and blurs", async () => {
  const renameLayer = vi.fn();
  const host = await renderPanel([textRow], { renameLayer });
  await act(async () =>
    host
      .querySelector<HTMLElement>('[data-yunari-layer="wordmark"]')
      ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
  );
  const input = renameField(host);
  // Escape and the focus loss it causes are driven in one act block, because
  // the guard being tested is exactly the ordering between them. React 19 maps
  // `onBlur` onto the non-bubbling `focusout`, so that is the event to send.
  await act(async () => {
    typeInto(input, "Discarded");
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
  expect(renameLayer).not.toHaveBeenCalled();
});

it("opens the rename field from the keyboard and keeps the row's role", async () => {
  const host = await renderPanel([textRow]);
  const row = host.querySelector<HTMLElement>(
    '[data-yunari-layer="wordmark"]',
  )!;
  await act(async () => {
    row.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F2", bubbles: true }),
    );
  });
  expect(renameField(host).closest('[role="treeitem"]')).toBe(row);
});

it("collapses and expands a group from its twisty", async () => {
  const setCollapsed = vi.fn();
  const rows = [
    layerRow({
      id: "group",
      name: "Group",
      kind: "group",
      depth: 0,
      parentId: undefined,
      hasChildren: true,
      visible: true,
      locked: false,
      selected: false,
    }),
  ];
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () =>
    root.render(<CompositionPane bridge={bridge(rows, { setCollapsed })} />),
  );
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[aria-label="Collapse Group"]')
      ?.click(),
  );
  expect(setCollapsed).toHaveBeenCalledWith("group", true);
});

it("draws the twisty as an icon, in both states", async () => {
  // The glyphs this replaces were markup rather than copy, so the copy table's
  // pictograph guard never reached them: `▸`/`▾` are announced as a word of
  // their own and cannot take a shell colour the way every icon beside them
  // does. A Lucide icon carries the state in its own shape, so the two states
  // must be distinguishable here and not only by the name.
  const host = await renderPanel([
    layerRow({
      id: "open",
      name: "Open",
      kind: "group",
      hasChildren: true,
      collapsed: false,
    }),
    layerRow({
      id: "shut",
      name: "Shut",
      kind: "group",
      hasChildren: true,
      collapsed: true,
    }),
  ]);
  const twisty = (name: string): SVGSVGElement | null =>
    host.querySelector(`[aria-label$=" ${name}"] svg`);
  expect(twisty("Open")?.getAttribute("class")).toContain(
    "lucide-chevron-down",
  );
  expect(twisty("Shut")?.getAttribute("class")).toContain(
    "lucide-chevron-right",
  );
  // The state the glyph used to draw is still said out loud, not only shown.
  expect(
    host
      .querySelector('[aria-label="Collapse Open"]')
      ?.getAttribute("aria-expanded"),
  ).toBe("true");
  expect(
    host
      .querySelector('[aria-label="Expand Shut"]')
      ?.getAttribute("aria-expanded"),
  ).toBe("false");
  expect(host.textContent).not.toMatch(/[▸▾]/u);
});

const rows = [
  layerRow({
    id: "group",
    name: "Group",
    kind: "group",
    depth: 0,
    parentId: undefined,
    hasChildren: true,
    visible: true,
    locked: false,
    selected: false,
  }),
  layerRow({
    id: "child",
    name: "Child",
    kind: "text",
    depth: 1,
    parentId: "group",
    hasChildren: false,
    visible: true,
    locked: true,
    selected: true,
  }),
];

/** Two groups, so the negative half of the assertion has a row to read. The
 * non-current group is what makes this a test of "dims the rest" rather than
 * of "sets an attribute somewhere". */
const contextRows = [
  layerRow({
    id: "group",
    name: "Group",
    kind: "group",
    depth: 0,
    parentId: undefined,
    hasChildren: true,
    visible: true,
    locked: false,
    selected: false,
  }),
  layerRow({
    id: "child",
    name: "Child",
    kind: "text",
    depth: 1,
    parentId: "group",
    hasChildren: false,
    visible: true,
    locked: false,
    selected: true,
  }),
  layerRow({
    id: "other",
    name: "Other",
    kind: "group",
    depth: 0,
    parentId: undefined,
    hasChildren: true,
    visible: true,
    locked: false,
    selected: false,
  }),
];

it("shows a shut group as one row offering to open, and no children", async () => {
  // What an author meets on opening the starter: the eight cards are rows, not
  // sixty. The projection decides that; what this pins is that the panel reads
  // it as "shut" — a twisty that says expand and points the other way — rather
  // than as an open group whose children are missing.
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <CompositionPane
        bridge={bridge([
          layerRow({
            id: "group",
            name: "CPU card",
            kind: "group",
            depth: 0,
            parentId: undefined,
            hasChildren: true,
            collapsed: true,
            visible: true,
            locked: false,
            selected: false,
          }),
          layerRow({
            id: "loose",
            name: "Wordmark",
            kind: "text",
            depth: 0,
            parentId: undefined,
            hasChildren: false,
            collapsed: false,
            visible: true,
            locked: false,
            selected: false,
          }),
        ])}
      />,
    ),
  );

  const rows = host.querySelectorAll("[data-yunari-layer]");
  expect(rows).toHaveLength(2);
  const twisty = host.querySelector('[aria-label="Expand CPU card"]');
  expect(twisty?.getAttribute("aria-expanded")).toBe("false");
  expect(twisty?.querySelector("svg")?.getAttribute("class")).toContain(
    "lucide-chevron-right",
  );
  // The loose object beside it has no twisty at all, so the two rows are not
  // offering the same affordance.
  expect(
    host.querySelector('[aria-label^="Expand"], [aria-label^="Collapse"]'),
  ).toBe(twisty);
});

it("opens a shut group from its twisty and closes it again", async () => {
  // Both directions, because the projection's default means the first press is
  // now the common one and a twisty that only ever closed would be useless.
  // The panel holds no state of its own — it re-reads the projection — so the
  // row is re-rendered from the bridge rather than mutated here.
  const setCollapsed = vi.fn();
  const row = layerRow({
    id: "group",
    name: "Group",
    kind: "group",
    hasChildren: true,
  });
  const host = document.createElement("div");
  const root = createRoot(host);
  const draw = async (collapsed: boolean) => {
    await act(async () =>
      root.render(
        <CompositionPane
          bridge={bridge([{ ...row, collapsed }], { setCollapsed })}
        />,
      ),
    );
  };
  await draw(true);
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[aria-label="Expand Group"]')
      ?.click(),
  );
  expect(setCollapsed).toHaveBeenLastCalledWith("group", false);
  await draw(false);
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[aria-label="Collapse Group"]')
      ?.click(),
  );
  expect(setCollapsed).toHaveBeenLastCalledWith("group", true);
});

it("marks the group whose children are current and dims the rest", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <CompositionPane
        bridge={bridge(contextRows, { groupContext: () => ["group"] })}
      />,
    ),
  );
  expect(
    host
      .querySelector('[data-yunari-layer="group"]')
      ?.getAttribute("data-context"),
  ).toBe("true");
  expect(
    host
      .querySelector('[data-yunari-layer="other"]')
      ?.getAttribute("data-context"),
  ).toBe("false");
  // The child inside the current context is selectable in its own right — the
  // half of the branch that Step 3 adds, and the reason the context is marked.
  expect(
    host
      .querySelector('[data-yunari-layer="child"]')
      ?.getAttribute("data-context"),
  ).toBe("true");
});

it("dims nothing when no group is entered", async () => {
  // With no group entered the context is empty, so the guard must keep the
  // attribute off the rows entirely. React writes a boolean `false` as the
  // *string* "false", which is exactly what the stylesheet rule dims on, and
  // with nothing entered every top-level layer is selectable on the canvas — a
  // tree greyed out on open would say the opposite. jsdom applies no stylesheet
  // (nothing imports `editor-main.ts` here), so what this pins is the guard that
  // makes the attribute honest: an attribute reading "false" on every row is the
  // state that rule turns into a fully dimmed tree.
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <CompositionPane
        bridge={bridge(contextRows, { groupContext: () => [] })}
      />,
    ),
  );
  for (const row of host.querySelectorAll(".yunari-layer-row"))
    expect(row.getAttribute("data-context")).toBeNull();
});

it("selects the row that was clicked, not the group it sits under", async () => {
  const selectLayer = vi.fn();
  const host = await renderPanel(contextRows, { selectLayer });
  // An indented child is the plausible mistake: the row carries its group in
  // `parentId`, and group-context work makes wiring that id to `selectLayer`
  // look reasonable. The wire must carry the clicked row's own id.
  await act(async () =>
    host.querySelector<HTMLElement>('[data-yunari-layer="child"]')?.click(),
  );
  expect(selectLayer.mock.calls).toEqual([["child"]]);
});

it("draws no action footer of its own, so the pane's toolbar is the only one", async () => {
  // The object actions are the Composition pane's footer toolbar now — a Pane
  // footer, so it stays put while the tree scrolls beneath it — and they are
  // asserted in `pane.dom.test.tsx`. The tree must not also render one: a
  // second row of the same actions is the defect the move removes.
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(<CompositionPane bridge={bridge(rows)} />));
  expect(host.querySelector("[data-yunari-layer-actions]")).toBeNull();
  expect(host.querySelector('[data-yunari-layer="child"]')).not.toBeNull();
});

it("marks a slot across a group boundary, a container for an empty group, and only the cycle as refused", async () => {
  const moveLayer = vi.fn(() => false);
  // A drop is a pointing gesture: without this the click that precedes the
  // drag would select the row the drop refused.
  const selectLayer = vi.fn();
  // Two children in one group, a sibling at the top level, and an empty group
  // whose row is the only thing that can name it as a destination. The boundary
  // that used to be the refusal is now a slot — that is `vg-461` — so what a row
  // can still be refused is a drop that would put a container inside itself.
  const tree = [
    layerRow({
      id: "group",
      name: "Group",
      kind: "group",
      depth: 0,
      parentId: undefined,
      hasChildren: true,
      visible: true,
      locked: false,
      selected: false,
    }),
    layerRow({
      id: "child",
      name: "Child",
      kind: "text",
      depth: 1,
      parentId: "group",
      hasChildren: false,
      visible: true,
      locked: false,
      selected: false,
    }),
    layerRow({
      id: "peer",
      name: "Peer",
      kind: "shape",
      depth: 1,
      parentId: "group",
      hasChildren: false,
      visible: true,
      locked: false,
      selected: false,
    }),
    layerRow({
      id: "sibling",
      name: "Sibling",
      kind: "shape",
      depth: 0,
      parentId: undefined,
      hasChildren: false,
      visible: true,
      locked: false,
      selected: false,
    }),
    layerRow({
      id: "hollow",
      name: "Hollow",
      kind: "group",
      depth: 0,
      parentId: undefined,
      hasChildren: false,
      visible: true,
      locked: false,
      selected: false,
    }),
  ];
  // The bridge's own rule, keyed by the tree above: an id may not be dropped
  // inside itself, and an empty group row is a container rather than a slot. A
  // stub that answered "same parent" instead would keep the old refusal green —
  // which is the drift this file's real-bridge case exists for.
  const inside = (ancestor: string, id: string): boolean =>
    id === "group" ? false : ancestor === "group";
  const host = await renderPanel(tree, {
    moveLayer,
    selectLayer,
    layerDrop: (from: string, anchor: string) =>
      from === anchor || inside(from, anchor)
        ? undefined
        : anchor === "hollow"
          ? ({ kind: "into", container: anchor } as const)
          : ({ kind: "slot", before: anchor } as const),
  });
  const row = (id: string): HTMLElement =>
    host.querySelector<HTMLElement>(`[data-yunari-layer="${id}"]`)!;
  const line = (): HTMLElement =>
    host.querySelector<HTMLElement>("[data-yunari-layer-dropline]")!;

  // The marker is permanent chrome, so "no drop" has to be its hidden state.
  expect(line().hidden).toBe(true);
  // jsdom has neither DragEvent nor DataTransfer: the handler only writes the
  // payload Chrome needs to start a drag, so a plain event with a stub on it
  // carries everything the component actually reads.
  const drag = (type: string): Event => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { setData: () => undefined },
    });
    return event;
  };

  // Out of the group and above a root sibling: the anchor is at the root, so
  // that is the container the drop enters. Unmarked before this task.
  await act(async () => row("child").dispatchEvent(drag("dragstart")));
  await act(async () => row("sibling").dispatchEvent(drag("dragover")));
  expect(line().hidden).toBe(false);
  // The units are the assertion, not the numbers: `top: 52` is an invalid
  // length, so the declaration is dropped, `top` falls back to `auto` and the
  // line sizes to zero. Measured on canvas — the line had never drawn. Both
  // figures are the panel's own arithmetic rather than a second copy of it: the
  // row's height times the slot's index, and the root indent.
  expect(line().style.getPropertyValue("--layer-dropline-top")).toBe(
    `${3 * ROW_HEIGHT}px`,
  );
  expect(line().style.getPropertyValue("--layer-dropline-left")).toBe(
    `${LAYER_ROW_INDENT}px`,
  );
  await act(async () => row("sibling").dispatchEvent(drag("drop")));
  expect(moveLayer).toHaveBeenCalledWith("child", "sibling");
  expect(selectLayer).not.toHaveBeenCalled();
  expect(line().hidden).toBe(true);

  // A container rather than a gap: the empty group's row is the destination, so
  // the row is marked and no line is drawn — there is no *between* for the line
  // to name, and an empty group could not be filled by drag at all otherwise.
  await act(async () => row("child").dispatchEvent(drag("dragstart")));
  await act(async () => row("hollow").dispatchEvent(drag("dragover")));
  expect(row("hollow").getAttribute("data-drop")).toBe("slot");
  expect(line().hidden).toBe(true);
  await act(async () => row("hollow").dispatchEvent(drag("drop")));
  expect(moveLayer).toHaveBeenLastCalledWith("child", "hollow");

  // And the refusal that is left: the group dropped inside its own child.
  await act(async () => row("group").dispatchEvent(drag("dragstart")));
  await act(async () => row("child").dispatchEvent(drag("dragover")));
  expect(line().hidden).toBe(true);
  expect(row("child").getAttribute("data-drop")).toBe("refused");
  await act(async () => row("child").dispatchEvent(drag("drop")));
  expect(moveLayer).toHaveBeenCalledTimes(2);
});

it("draws locked as a filled lock and unlocked as an outline one", async () => {
  // vg-024: at the row's icon size the two outline locks differ only by a gap
  // in the shackle, which the author could not tell apart. Filled versus outline
  // is a difference in weight the row can be read by at that size, and it comes
  // from the icon's own `fill` rather than from hand-picking a second glyph.
  //
  // Both rows are *selected*, because a default row now carries no lock at all
  // (see "keeps a default row quiet"). The negative half still has to be
  // measured on a row that draws the button, or it would pass on an absent
  // icon — which is exactly the vacuous assertion this treatment removed.
  const host = await renderPanel([
    layerRow({
      id: "shut",
      name: "Shut",
      kind: "shape",
      locked: true,
      selected: true,
    }),
    layerRow({
      id: "open",
      name: "Open",
      kind: "shape",
      locked: false,
      selected: true,
    }),
  ]);
  // Both state buttons carry `aria-pressed`, so the lock one is named rather
  // than positional: the visibility icon would satisfy a bare attribute match.
  const lock = (id: string): SVGSVGElement | null =>
    host
      .querySelector(
        `[data-yunari-layer="${id}"] button[aria-label="Lock"], [data-yunari-layer="${id}"] button[aria-label="Unlock"]`,
      )
      ?.querySelector("svg") ?? null;

  // Both rows must actually be drawing the button, or the two halves below say
  // nothing about the glyphs.
  expect(lock("shut")).not.toBeNull();
  expect(lock("open")).not.toBeNull();
  // Lucide's own default is `fill: none`; the locked row overrides it.
  expect(lock("shut")?.getAttribute("fill")).toBe("currentColor");
  // The other half of the contract: the unlocked row is untouched, so a fix
  // that filled everything would fail here rather than pass.
  expect(lock("open")?.getAttribute("fill")).toBe("none");
  // Same glyph family either way — the difference is the property, not a
  // different drawing.
  expect(lock("shut")?.getAttribute("class")).toContain("lucide-lock");
  expect(lock("open")?.getAttribute("class")).toContain("lucide-lock-open");
});

it("answers the keys a tree is defined by, and does not nudge", async () => {
  // The rows declare `role="treeitem"`, and a treeitem whose arrow keys do
  // nothing is a promise the panel does not keep. The nudge handler owns the
  // arrow keys on the canvas but defers only for a TEXT ENTRY, and a row is a
  // `div` — so without the row taking them, an unmodified arrow key navigated
  // nothing and moved the selected object instead.
  const renameLayer = vi.fn();
  const host = await renderPanel(
    [
      textRow,
      { ...textRow, id: "second", name: "second" },
      { ...textRow, id: "third", name: "third" },
    ],
    { renameLayer },
  );
  // Attached, because `focus()` on a detached subtree sets nothing.
  document.body.append(host);
  const rows = [...host.querySelectorAll<HTMLElement>('[role="treeitem"]')];
  expect(rows).toHaveLength(3);
  const first = rows[0]!;
  first.focus();
  expect(host.ownerDocument.activeElement).toBe(first);

  const press = async (key: string): Promise<number> => {
    await act(async () => {
      host.ownerDocument.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true }),
      );
      await Promise.resolve();
    });
    return rows.findIndex((row) => row === host.ownerDocument.activeElement);
  };

  expect(await press("ArrowDown")).toBe(1);
  expect(await press("ArrowDown")).toBe(2);
  // Clamped at the ends, the way a tree is.
  expect(await press("ArrowDown")).toBe(2);
  expect(await press("ArrowUp")).toBe(1);
  expect(await press("Home")).toBe(0);
  expect(await press("End")).toBe(2);
  host.remove();
});

it("expands a shut group on ArrowRight, and steps into an open one's first child", async () => {
  // vg-273: moveFocus's ArrowRight branch. On a shut group it opens the group
  // through the bridge; on an open one it moves focus into the first child.
  const shut = layerRow({
    id: "group",
    name: "Group",
    kind: "group",
    hasChildren: true,
    collapsed: true,
  });
  const child = layerRow({
    id: "child",
    name: "Child",
    kind: "text",
    depth: 1,
    parentId: "group",
  });

  const setCollapsed = vi.fn();
  const host = await renderPanel([shut, child], { setCollapsed });
  document.body.append(host);
  const [group] = host.querySelectorAll<HTMLElement>('[role="treeitem"]');
  group!.focus();
  await pressOnFocused(host, "ArrowRight");

  expect(setCollapsed).toHaveBeenLastCalledWith("group", false);
  // Opening the group keeps the author on it; focus moves only on a second press.
  expect(host.ownerDocument.activeElement).toBe(group);
  host.remove();

  const open = await renderPanel([{ ...shut, collapsed: false }, child]);
  document.body.append(open);
  const [openGroup, openChild] =
    open.querySelectorAll<HTMLElement>('[role="treeitem"]');
  openGroup!.focus();
  await pressOnFocused(open, "ArrowRight");

  expect(open.ownerDocument.activeElement).toBe(openChild);
  open.remove();
});

it("collapses an open group on ArrowLeft, and steps out to the parent otherwise", async () => {
  // vg-273: moveFocus's ArrowLeft branch. On an open group it shuts the group
  // through the bridge; on a child it walks out to the level above it.
  const group = layerRow({
    id: "group",
    name: "Group",
    kind: "group",
    hasChildren: true,
    collapsed: false,
  });
  const child = layerRow({
    id: "child",
    name: "Child",
    kind: "text",
    depth: 1,
    parentId: "group",
  });

  const setCollapsed = vi.fn();
  const host = await renderPanel([group, child], { setCollapsed });
  document.body.append(host);
  const [groupRow] = host.querySelectorAll<HTMLElement>('[role="treeitem"]');
  groupRow!.focus();
  await pressOnFocused(host, "ArrowLeft");

  expect(setCollapsed).toHaveBeenLastCalledWith("group", true);
  host.remove();

  const out = await renderPanel([group, child]);
  document.body.append(out);
  const [outGroup, outChild] =
    out.querySelectorAll<HTMLElement>('[role="treeitem"]');
  outChild!.focus();
  await pressOnFocused(out, "ArrowLeft");

  expect(out.ownerDocument.activeElement).toBe(outGroup);
  out.remove();
});

it("marks a hidden row so the list says what the canvas is doing", async () => {
  // Hiding a layer hides it on the canvas, and the row changed in exactly one
  // measurable way: the eye button's title. One property flip on a control the
  // author sets once and then forgets is not the same as the row looking hidden.
  // The attribute is what the stylesheet dims on, so it is the contract worth
  // pinning — jsdom applies no CSS, and a computed style here would be theatre.
  const renameLayer = vi.fn();
  const host = await renderPanel(
    [
      { ...textRow, id: "shown", name: "shown" },
      { ...textRow, id: "hidden-one", name: "hidden-one", visible: false },
    ],
    { renameLayer },
  );
  const shown = host.querySelector('[data-yunari-layer="shown"]')!;
  const hidden = host.querySelector('[data-yunari-layer="hidden-one"]')!;

  expect(shown.getAttribute("data-hidden")).toBe("false");
  expect(hidden.getAttribute("data-hidden")).toBe("true");
  host.remove();
});

it("selects the focused row with Space, so the list can be driven without a mouse", async () => {
  // vg-067 gave the list navigation and vg-074 is its residual: a treeitem you
  // can walk to but not pick is half a tree. Enter is already rename's, so
  // selection takes the key a list has always used for it.
  const selectLayer = vi.fn();
  const renameLayer = vi.fn();
  const host = await renderPanel(
    [
      { ...textRow, id: "first", name: "first" },
      { ...textRow, id: "second", name: "second" },
    ],
    { selectLayer, renameLayer },
  );
  document.body.append(host);
  const rows = [...host.querySelectorAll<HTMLElement>('[role="treeitem"]')];
  rows[1]!.focus();

  await act(async () => {
    host.ownerDocument.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );
    await Promise.resolve();
  });

  expect(selectLayer).toHaveBeenCalledWith("second");
  // And the row that was in rename's way is not selected by it.
  expect(renameLayer).not.toHaveBeenCalled();
  host.remove();
});

/** jsdom has neither `DragEvent` nor `DataTransfer`, so a drag is driven as the
 * three plain events the panel listens for. `cancelable` is what a real one
 * carries: `dragover` is only a valid drop target because the handler cancels
 * it, and `defaultPrevented` is how that cancellation is observable here. */
function dragEvent(type: string): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { setData: () => undefined },
  });
  return event;
}

/** vg-099: the refusal was silent, so an author dragging toward another group
 * saw the same row, the same cursor and the same list as a drop that lands.
 * What was missing is the panel saying so, so the state a row carries
 * mid-gesture is the thing pinned here: a slot, a refusal, or neither. The
 * refusal itself is the cycle now (`vg-461`), which is why the gesture below
 * picks a group up rather than a child. */
it("tells a refused drop target from one that would land, mid-gesture", async () => {
  const moveLayer = vi.fn(() => false);
  const tree = [
    layerRow({
      id: "group",
      name: "Group",
      kind: "group",
      depth: 0,
      parentId: undefined,
      hasChildren: true,
      visible: true,
      locked: false,
      selected: false,
    }),
    layerRow({
      id: "child",
      name: "Child",
      kind: "text",
      depth: 1,
      parentId: "group",
      hasChildren: false,
      visible: true,
      locked: false,
      selected: false,
    }),
    layerRow({
      id: "peer",
      name: "Peer",
      kind: "shape",
      depth: 1,
      parentId: "group",
      hasChildren: false,
      visible: true,
      locked: false,
      selected: false,
    }),
    layerRow({
      id: "sibling",
      name: "Sibling",
      kind: "shape",
      depth: 0,
      parentId: undefined,
      hasChildren: false,
      visible: true,
      locked: false,
      selected: false,
    }),
  ];
  // The bridge's rule, keyed by the tree above: nothing may land inside itself.
  const host = await renderPanel(tree, {
    moveLayer,
    layerDrop: moveRule(tree),
  });
  const row = (id: string): HTMLElement =>
    host.querySelector<HTMLElement>(`[data-yunari-layer="${id}"]`)!;
  const tree_ = (): HTMLElement =>
    host.querySelector<HTMLElement>('[role="tree"]')!;

  // Before any gesture nothing is marked, so an ordinary hover is untouched.
  expect(row("child").getAttribute("data-drop")).toBeNull();
  expect(tree_().getAttribute("data-dragging")).toBeNull();

  await act(async () => row("group").dispatchEvent(dragEvent("dragstart")));
  // The tree knows a gesture is in flight, which is what lets the stylesheet
  // dim every row that is not the slot — the refusal has to be visible
  // somewhere other than the row the pointer happens to be over.
  expect(tree_().getAttribute("data-dragging")).toBe("group");

  const refused = await act(async () => {
    const event = dragEvent("dragover");
    row("child").dispatchEvent(event);
    return event.defaultPrevented;
  });
  // The gesture is answered rather than swallowed: a refused row is not
  // cancelled, so the browser's own drag cursor joins in and says no too.
  expect(refused).toBe(false);
  expect(row("child").getAttribute("data-drop")).toBe("refused");
  // The source row is not a refusal — it is where the layer already is, which
  // is a third answer the panel must not confuse with either of the others.
  await act(async () => row("group").dispatchEvent(dragEvent("dragover")));
  expect(row("group").getAttribute("data-drop")).toBeNull();

  await act(async () => row("sibling").dispatchEvent(dragEvent("dragover")));
  expect(row("sibling").getAttribute("data-drop")).toBe("slot");
  // Only one row is ever marked, so a refusal cannot linger beside a slot.
  expect(row("child").getAttribute("data-drop")).toBeNull();

  // The mark is the drag's, so the gesture ending takes it with it.
  await act(async () => row("sibling").dispatchEvent(dragEvent("dragend")));
  expect(tree_().getAttribute("data-dragging")).toBeNull();
  expect(row("sibling").getAttribute("data-drop")).toBeNull();
});

it("takes the drop line away when the row under the pointer refuses it", async () => {
  // The line is the panel's promise of a landing slot. Found on canvas, not by
  // reading the handler: it is a single element for the whole tree, so a line
  // shown over a sibling is still lit while the pointer has moved a row further
  // to a refusal — offering the very drop that row has just said no to.
  //
  // The refusal left after `vg-461` is the cycle, so the gesture picks up the
  // group: a bar of line over a row the whole drag would have to land inside is
  // the same false promise in the other direction.
  const tree = [
    layerRow({
      id: "group",
      name: "Group",
      kind: "group",
      depth: 0,
      parentId: undefined,
      hasChildren: true,
      visible: true,
      locked: false,
      selected: false,
    }),
    layerRow({
      id: "child",
      name: "Child",
      kind: "text",
      depth: 1,
      parentId: "group",
      hasChildren: false,
      visible: true,
      locked: false,
      selected: false,
    }),
    layerRow({
      id: "peer",
      name: "Peer",
      kind: "shape",
      depth: 1,
      parentId: "group",
      hasChildren: false,
      visible: true,
      locked: false,
      selected: false,
    }),
    layerRow({
      id: "sibling",
      name: "Sibling",
      kind: "shape",
      depth: 0,
      parentId: undefined,
      hasChildren: false,
      visible: true,
      locked: false,
      selected: false,
    }),
  ];
  const host = await renderPanel(tree, { layerDrop: moveRule(tree) });
  const row = (id: string): HTMLElement =>
    host.querySelector<HTMLElement>(`[data-yunari-layer="${id}"]`)!;
  const line = (): HTMLElement =>
    host.querySelector<HTMLElement>("[data-yunari-layer-dropline]")!;

  await act(async () => row("group").dispatchEvent(dragEvent("dragstart")));
  await act(async () => row("sibling").dispatchEvent(dragEvent("dragover")));
  expect(line().hidden).toBe(false);

  // Into the group's own rows: the line must go with the slot.
  await act(async () => row("child").dispatchEvent(dragEvent("dragover")));
  expect(line().hidden).toBe(true);

  // And back again, so it is the row's answer that drives it rather than a
  // one-way latch.
  await act(async () => row("sibling").dispatchEvent(dragEvent("dragover")));
  expect(line().hidden).toBe(false);
});

it("still moves on a drop the panel marked, and refuses the one it did not", async () => {
  // The half of vg-099 that must not move: making a refusal visible is not a
  // reason to stop accepting a drop, and the two answers come from one gesture.
  // What the accepted half now moves is a *reparent* (`vg-460`), which is why
  // the row dropped on sits outside the dragged row's group.
  const moveLayer = vi.fn(() => true);
  const tree = [
    layerRow({ id: "group", name: "Group", kind: "group", hasChildren: true }),
    {
      ...textRow,
      id: "child",
      name: "Child",
      depth: 1,
      parentId: "group",
    },
    { ...textRow, id: "sibling", name: "Sibling", depth: 0 },
  ];
  const host = await renderPanel(tree, {
    moveLayer,
    layerDrop: moveRule(tree),
  });
  const row = (id: string): HTMLElement =>
    host.querySelector<HTMLElement>(`[data-yunari-layer="${id}"]`)!;

  // The cycle: the group dropped on its own child. Refused, so the drop does
  // not reach the bridge at all. The mark is read mid-gesture, because a drop
  // is the end of the gesture and takes the mark with it.
  await act(async () => row("group").dispatchEvent(dragEvent("dragstart")));
  await act(async () => row("child").dispatchEvent(dragEvent("dragover")));
  expect(row("child").getAttribute("data-drop")).toBe("refused");
  await act(async () => row("child").dispatchEvent(dragEvent("drop")));
  expect(moveLayer).not.toHaveBeenCalled();
  expect(row("child").getAttribute("data-drop")).toBeNull();

  // The slot: a child dropped on the loose row beside its group. The panel
  // passes the ids and nothing else — where the layer lands is the bridge's.
  await act(async () => row("child").dispatchEvent(dragEvent("dragstart")));
  await act(async () => row("sibling").dispatchEvent(dragEvent("dragover")));
  await act(async () => row("sibling").dispatchEvent(dragEvent("drop")));
  expect(moveLayer).toHaveBeenCalledWith("child", "sibling");
  expect(row("sibling").getAttribute("data-drop")).toBeNull();
  expect(
    host.querySelector('[role="tree"]')?.getAttribute("data-dragging"),
  ).toBeNull();
});

/** vg-087: the rows said `draggable` and nothing acted on it. Every earlier test
 * here drove the panel through a stub bridge, so a stub that answered
 * `layerDrop` and `moveLayer` the way the test wanted would keep them
 * green while the real bridge refused the same gesture. This one wires the real
 * `createEditorShellBridge` over a real Fabric canvas, so the drag has to land
 * in Fabric's own array — the thing the panel's markup promises.
 *
 * The assertion is the document, not a call count: what an author gets from a
 * drag is the layer list in a new order, and a stubbed call would pass even if
 * the move Fabric performed were a no-op. */
it("restacks the document when a row is dropped on another", async () => {
  const canvas = new Canvas(document.createElement("canvas"));
  const alpha = new Rect({ left: 0, top: 0, width: 10, height: 10 });
  const beta = new Rect({ left: 20, top: 0, width: 10, height: 10 });
  alpha.set("id", "alpha");
  beta.set("id", "beta");
  canvas.add(alpha, beta);
  const real = createEditorShellBridge({
    editor: {
      canvas,
      groupingManager: { groupContext: () => [] },
      historyManager: { saveState: vi.fn() },
    },
    // The bridge subscribes to the session's document change so a rename
    // reaches the snapshot; this test drives neither, so the stub only has to
    // answer the subscription it is given.
    session: { subscribeDocumentChange: () => () => undefined } as never,
    capture: () => undefined,
  } as never);

  const host = document.createElement("div");
  await act(async () =>
    (await Promise.resolve(createRoot(host))).render(
      <CompositionPane bridge={real} />,
    ),
  );
  const order = (): unknown[] =>
    canvas.getObjects().map((object) => object.get("id"));
  const row = (id: string): HTMLElement =>
    host.querySelector<HTMLElement>(`[data-yunari-layer="${id}"]`)!;
  const panelOrder = (): (string | null)[] =>
    [...host.querySelectorAll("[data-yunari-layer]")].map((element) =>
      element.getAttribute("data-yunari-layer"),
    );

  const before = order();
  expect(before).toEqual(["alpha", "beta"]);
  // The panel paints topmost-first, so `beta` is the row above `alpha`; the
  // background row is appended below both.
  expect(panelOrder()).toEqual(["beta", "alpha", "$background"]);

  await act(async () => row("alpha").dispatchEvent(dragEvent("dragstart")));
  const over = await act(async () => {
    const event = dragEvent("dragover");
    row("beta").dispatchEvent(event);
    return event.defaultPrevented;
  });
  // A refused dragover leaves the browser with no valid drop target, so the
  // `drop` that follows is never delivered. This is the half that made the
  // gesture inert while every attribute still read as though it worked.
  expect(over).toBe(true);

  await act(async () => row("beta").dispatchEvent(dragEvent("drop")));
  expect(order()).not.toEqual(before);
  // And the list the author reads followed the document, rather than the panel
  // re-rendering the order it was handed a moment earlier.
  expect(panelOrder()).toEqual(["alpha", "beta", "$background"]);

  host.remove();
});

/** vg-461: a row can be dragged into a group and back out again. The stub cases
 *  above pin the panel's half (which row is offered, what the bridge is handed);
 *  this one pins the document's, over Fabric's real group, because a reparent is
 *  the one move whose write is Fabric's own — `Group.add` and `Group.remove`
 *  bake the child into (and out of) the group's plane, so a list that agrees
 *  with the tree by accident is exactly the failure this would not see.
 *
 *  The reading is the panel's own nesting, taken as an author reads it: a row's
 *  `--layer-depth`, which is what the indentation is drawn from. The drop is
 *  driven straight at the handlers because a browser cannot be asked to perform
 *  a drag — and because the panel's half is already covered above. */
it("moves a row into a group and back out, and the panel shows where it landed", async () => {
  const canvas = new Canvas(document.createElement("canvas"));
  const inner = new Rect({ left: 0, top: 0, width: 10, height: 10 });
  const loose = new Rect({ left: 20, top: 0, width: 10, height: 10 });
  const group = new Group([inner]);
  inner.set("id", "inner");
  loose.set("id", "loose");
  group.set("id", "grp");
  canvas.add(group, loose);
  const real = createEditorShellBridge({
    editor: {
      canvas,
      groupingManager: { groupContext: () => [] },
      historyManager: { saveState: vi.fn() },
    },
    session: { subscribeDocumentChange: () => () => undefined } as never,
    capture: () => undefined,
  } as never);

  const host = document.createElement("div");
  await act(async () =>
    (await Promise.resolve(createRoot(host))).render(
      <CompositionPane bridge={real} />,
    ),
  );
  const row = (id: string): HTMLElement =>
    host.querySelector<HTMLElement>(`[data-yunari-layer="${id}"]`)!;
  const has = (id: string): boolean =>
    host.querySelector(`[data-yunari-layer="${id}"]`) !== null;
  /** Each visible row as the author sees it: the id, and the depth the
   *  indentation is computed from. */
  const read = (): string[] =>
    [...host.querySelectorAll<HTMLElement>("[data-yunari-layer]")].map(
      (element) =>
        `${element.getAttribute("data-yunari-layer")}@${element.style.getPropertyValue("--layer-depth")}`,
    );

  // A group is shut until it is opened, so the child is not a row yet. The
  // background row is always last.
  expect(read()).toEqual(["loose@0", "grp@0", "$background@0"]);
  // The twisty is the group row's own control: a row with children draws it and
  // a leaf draws a spacer, so this is the one button on that row.
  const twisty = row("grp").querySelector<HTMLButtonElement>("button");
  expect(twisty?.getAttribute("aria-label")).toContain(uiCopy.panels.expand);
  await act(async () => twisty?.click());
  expect(read()).toEqual(["loose@0", "grp@0", "inner@1", "$background@0"]);

  // Into the group: dropped on its first child, so the loose row lands beside
  // it inside the group's own plane.
  await act(async () => row("loose").dispatchEvent(dragEvent("dragstart")));
  await act(async () => row("inner").dispatchEvent(dragEvent("dragover")));
  await act(async () => row("inner").dispatchEvent(dragEvent("drop")));
  expect(group.getObjects()).toEqual([inner, loose]);
  expect(canvas.getObjects()).toEqual([group]);
  expect(loose.parent).toBe(group);
  // The rendered half: the row indented under the group it now belongs to, and
  // above the child it was dropped on — the panel paints topmost first.
  expect(read()).toEqual(["grp@0", "loose@1", "inner@1", "$background@0"]);

  // And back out, dropped on the group row itself — an anchor at the root puts
  // the row beside it there.
  await act(async () => row("loose").dispatchEvent(dragEvent("dragstart")));
  await act(async () => row("grp").dispatchEvent(dragEvent("dragover")));
  await act(async () => row("grp").dispatchEvent(dragEvent("drop")));
  expect(group.getObjects()).toEqual([inner]);
  expect(canvas.getObjects()).toEqual([group, loose]);
  expect(loose.parent).toBeUndefined();
  expect(read()).toEqual(["loose@0", "grp@0", "inner@1", "$background@0"]);
  // The group is left where it was, so the row that moved is the loose one and
  // nothing else in the document followed it.
  expect(has("grp")).toBe(true);

  host.remove();
});

// ── A row says what it is ────────────────────────────────────────────────────

it("prints the bound key the projection reported, and nothing where there is none", async () => {
  // The bound column is only worth a column if it is the document's key: a
  // panel that typed one in would still read correctly on the starter and be
  // wrong on every other theme.
  const host = await renderPanel([
    layerRow({ id: "gauge", name: "RAM ring", bound: ["ram.used.percent"] }),
    layerRow({
      id: "trends",
      name: "Trends",
      bound: ["cpu.load", "gpu.load", "ram.used.percent"],
    }),
    layerRow({ id: "panel", name: "Panel", bound: [] }),
  ]);
  const bound = (id: string): HTMLElement | null =>
    host.querySelector<HTMLElement>(
      `[data-yunari-layer="${id}"] .yunari-layer-bound`,
    );

  expect(bound("gauge")?.textContent).toBe("ram.used.percent");
  // Three keys, so the separator earns its place; the title keeps the full
  // list for the row that clips it.
  expect(bound("trends")?.textContent).toContain("cpu.load");
  expect(bound("trends")?.textContent).toContain("ram.used.percent");
  // A row bound to nothing carries nothing. A word printed here on every
  // unbound row would be repeated ink paid for out of the layer *name*, and an
  // unbound row must never claim a key it has not got.
  expect(bound("panel")).toBeNull();
});

// ── …and is quiet when nothing is wrong ─────────────────────────────────────

it("carries no state icon at all on a default row", async () => {
  // Every row said "visible, unlocked" before, and the noise grew with the row
  // count — which is precisely the case a card-heavy panel would hide. Two
  // flags that are both the default carry no information, so both are absent.
  const host = await renderPanel([
    layerRow({ id: "wordmark", name: "wordmark" }),
  ]);

  const row = host.querySelector<HTMLElement>(
    '[data-yunari-layer="wordmark"]',
  )!;
  expect(row.querySelectorAll("button")).toHaveLength(0);
  expect(row.querySelector('[aria-label="Hide"]')).toBeNull();
  expect(row.querySelector('[aria-label="Lock"]')).toBeNull();
});

it("shows the state icons on hover, on focus and on selection", async () => {
  // Three ways of saying "this is the row you are about to act on", and the
  // pointer is only one of them: a keyboard author has to reach the same
  // controls a pointer reaches.
  const host = await renderPanel([
    layerRow({ id: "wordmark", name: "wordmark" }),
  ]);
  document.body.append(host);
  const row = host.querySelector<HTMLElement>(
    '[data-yunari-layer="wordmark"]',
  )!;
  const icons = (): number => row.querySelectorAll("button").length;
  expect(icons()).toBe(0);

  // React attaches its listeners to the root container, so both events have to
  // bubble to reach them — a non-bubbling dispatch is delivered to the target
  // and then to nothing.
  await act(async () =>
    row.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
  );
  // The eye and the lock: the whole of what a row at rest withholds. The pen
  // used to be the third and is gone (`vg-462`).
  expect(icons()).toBe(2);

  await act(async () =>
    row.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })),
  );
  expect(icons()).toBe(0);

  // React's onFocus maps to focusin, which bubbles; a plain `focus` event does
  // not reach it.
  await act(async () =>
    row.dispatchEvent(new FocusEvent("focusin", { bubbles: true })),
  );
  expect(icons()).toBe(2);

  await act(async () =>
    row.dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
  );
  expect(icons()).toBe(0);
  host.remove();
});

it("keeps the icons on a row whose own state is not the default", async () => {
  // A hidden layer and a locked one are the two facts the panel exists to show,
  // so neither may wait for a hover to appear.
  const host = await renderPanel([
    layerRow({ id: "hidden-one", visible: false }),
    layerRow({ id: "locked-one", locked: true }),
  ]);
  const row = (id: string): HTMLElement =>
    host.querySelector<HTMLElement>(`[data-yunari-layer="${id}"]`)!;

  // Only the one that differs: a hidden row is still unlocked, so an unlocked
  // row's lock icon would be noise even here.
  expect(row("hidden-one").querySelector('[aria-label="Show"]')).not.toBeNull();
  expect(row("hidden-one").querySelector('[aria-label="Lock"]')).toBeNull();
  expect(
    row("locked-one").querySelector('[aria-label="Unlock"]'),
  ).not.toBeNull();
  expect(row("locked-one").querySelector('[aria-label="Hide"]')).toBeNull();
});

it("still hides and locks the row whose icons the author pressed", async () => {
  // The subtractions are allowed to remove ink, not the actions. Selecting a row
  // is what brings the buttons back, so the press has to reach the bridge.
  const setLayerVisible = vi.fn();
  const setLayerLocked = vi.fn();
  const host = await renderPanel(
    [layerRow({ id: "wordmark", selected: true })],
    {
      setLayerVisible,
      setLayerLocked,
    },
  );
  const press = async (label: string): Promise<void> => {
    await act(async () =>
      host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)?.click(),
    );
  };
  await press("Hide");
  await press("Lock");
  expect(setLayerVisible).toHaveBeenCalledWith("wordmark", false);
  expect(setLayerLocked).toHaveBeenCalledWith("wordmark", true);
});

it("keeps every row reachable in a scene with two hundred of them", async () => {
  // Review Focus 4, and the case the whole treatment has to survive: a theme
  // of loose shapes has no group anywhere, so every row is a top-level row and
  // none of them is a card. The treatment must read for a free shape, and the
  // panel must still be a panel at two hundred rows.
  const rows = Array.from({ length: 200 }, (_, at) =>
    layerRow({ id: `loose-${at}`, name: `loose-${at}`, kind: "shape" }),
  );
  const host = await renderPanel(rows);

  const rendered = host.querySelectorAll("[data-yunari-layer]");
  expect(rendered).toHaveLength(200);
  // Every row is still a row with a name and a mark — none is dropped, merged
  // or collapsed to make the treatment fit.
  for (const row of rendered) {
    expect(row.querySelector(".yunari-layer-name")?.textContent).not.toBe("");
    expect(row.querySelector("[data-yunari-layer-mark]")).not.toBeNull();
  }
  // And the whole tree is still two hundred quiet rows: the default state adds
  // nothing, so a scene that big opens without 400 icons of noise.
  expect(host.querySelectorAll("[data-yunari-layer] button")).toHaveLength(0);
});

it("selects any one of two hundred rows through the panel's own click", async () => {
  // The "selects" half of *"a theme of two hundred loose shapes opens, selects,
  // moves and styles every one of them"*. The test above proves every row
  // **renders**; this proves the click still reaches the bridge for a row deep
  // in a scene with no group anywhere, which is the case where a selection
  // quietly resolves to the wrong object — `bridge.selectLayer` deliberately
  // selects `owner ?? target`, and with no owner every row is its own owner.
  //
  // Sampled across the tree rather than at one depth, because a resolver that
  // only works near the top is not a resolver.
  const rows = Array.from({ length: 200 }, (_, at) =>
    layerRow({ id: `loose-${at}`, name: `loose-${at}`, kind: "shape" }),
  );
  const selectLayer = vi.fn();
  const host = await renderPanel(rows, { selectLayer });

  for (const at of [0, 57, 142, 199]) {
    const id = `loose-${at}`;
    await act(async () =>
      host.querySelector<HTMLElement>(`[data-yunari-layer="${id}"]`)?.click(),
    );
    // One call, naming that row and nothing else — a panel that answered every
    // click with the same id would satisfy a count-only assertion.
    expect(selectLayer.mock.calls).toEqual([[id]]);
    selectLayer.mockClear();
  }
});

// ── …and says what it is, to a screen reader as well as to an eye ───────────

function roleSpan(host: HTMLElement, id: string): HTMLElement | null {
  return host.querySelector<HTMLElement>(
    `[data-yunari-layer="${id}"] .yunari-layer-role`,
  );
}

/** The name a treeitem is announced under, read off the row's own columns: the
 *  text of everything inside it that is not `aria-hidden`.
 *
 *  jsdom computes no accessible name, so this is the floor the row's content
 *  puts under it rather than the whole platform algorithm — a browser also folds
 *  in an embedded control's own label. That is the point of reading content
 *  rather than an attribute: the role has to reach the name as *content*, and a
 *  row that carried the same words in an `aria-label` would be named twice. */
function nameFromContent(row: HTMLElement): string {
  const clone = row.cloneNode(true) as HTMLElement;
  for (const hidden of clone.querySelectorAll('[aria-hidden="true"]')) {
    hidden.remove();
  }
  return clone.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

it("draws a role on every row, in the vocabulary's own words", async () => {
  // Driven from a list of arms rather than from one example object, so an arm
  // that renders another arm's word — or nothing at all — is a failing case
  // rather than an unfilled field. The group with no unit, the chart with one
  // series and the chart whose family this build does not know are here because
  // a happy-path fixture reaches none of them, and the last must say `Chart`
  // rather than a neighbour's family the document never claimed.
  const cases: readonly { id: string; role: LayerRole; says: string }[] = [
    { id: "one", role: { kind: "text" }, says: "Text" },
    { id: "two", role: { kind: "shape" }, says: "Shape" },
    { id: "three", role: { kind: "image" }, says: "Image" },
    { id: "four", role: { kind: "group", unit: undefined }, says: "Group" },
    { id: "five", role: { kind: "group", unit: "CPU" }, says: "CPU" },
    {
      id: "six",
      role: { kind: "chart", family: undefined, series: 1 },
      says: "Chart",
    },
    {
      id: "seven",
      role: { kind: "chart", family: "line", series: 1 },
      says: "Line",
    },
    {
      id: "eight",
      role: { kind: "chart", family: "line", series: 3 },
      says: "Line ×3",
    },
  ];
  const host = await renderPanel(
    cases.map((one) => layerRow({ id: one.id, name: one.id, role: one.role })),
  );

  for (const one of cases) {
    const span = roleSpan(host, one.id);
    expect(span?.textContent).toBe(one.says);
    // The attribute names the arm that drew, so a browser case measures the
    // treatment rather than inferring it from a class — the idiom the mark uses.
    expect(span?.getAttribute("data-yunari-layer-role")).toBe(one.role.kind);
  }
});

it("names a chart row's family and a shape row's kind for a screen reader", async () => {
  // Review Focus 2, and the reason this task exists. A chart's icon, a shape's
  // swatch and an image's `alt=""` contribute nothing to a treeitem's name,
  // which is the concatenation of its own columns, and a group's glyph is a
  // wordless `aria-hidden` glyph — so before the role a chart row and a shape row
  // were the same row to a screen reader. The name is read off the row's own
  // content rather than off an attribute, because an `aria-label` on a row
  // already named from its columns is the second name this case exists to rule
  // out.
  const host = await renderPanel([
    layerRow({
      id: "trends",
      name: "Trends",
      kind: "chart",
      mark: { kind: "chart", family: "line" },
      role: { kind: "chart", family: "line", series: 3 },
    }),
    layerRow({
      id: "panel",
      name: "Panel",
      kind: "shape",
      mark: { kind: "shape", shape: "rect" },
      role: { kind: "shape" },
    }),
  ]);
  const row = (id: string): HTMLElement =>
    host.querySelector<HTMLElement>(`[data-yunari-layer="${id}"]`)!;

  const chart = nameFromContent(row("trends"));
  expect(chart).toContain("Trends");
  expect(chart).toContain("Line ×3");
  // The shape is the other half: its swatch is `aria-hidden`, so without the
  // role the row would announce its name and nothing about what it is.
  const shape = nameFromContent(row("panel"));
  expect(shape).toContain("Panel");
  expect(shape).toContain("Shape");
});

it("says a row's role once, outside the mark and outside a title", async () => {
  // The three ways this could be said twice or said where nobody reads it:
  // inside the mark, which `flex-basis`es a 28px slot and would clip it; in a
  // `title`, which a pointer hears and a keyboard author does not; and hidden,
  // which is text no screen reader reads at all.
  const host = await renderPanel([
    layerRow({
      id: "trends",
      name: "Trends",
      kind: "chart",
      bound: ["cpu.load"],
      mark: { kind: "chart", family: "line" },
      role: { kind: "chart", family: "line", series: 3 },
    }),
  ]);
  const row = host.querySelector<HTMLElement>('[data-yunari-layer="trends"]')!;

  expect(row.querySelectorAll(".yunari-layer-role")).toHaveLength(1);
  expect(row.querySelector(".yunari-layer-mark .yunari-layer-role")).toBeNull();
  const span = row.querySelector<HTMLElement>(".yunari-layer-role")!;
  expect(span.getAttribute("title")).toBeNull();
  expect(span.getAttribute("aria-hidden")).toBeNull();
  // The key beside it keeps its own tooltip: the role is visible text, and the
  // one column whose tooltip earns its place is the one that clips.
  expect(row.querySelector(".yunari-layer-bound")?.getAttribute("title")).toBe(
    "cpu.load",
  );
});

it("gives the role a fixed width and keeps the name the row's flexible column", async () => {
  // jsdom applies no stylesheet, so a computed style here would be theatre; the
  // declaration is exactly what the browser paints, and a browser case confirms
  // it — the same reading the specimen's own face gets above.
  const css = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "editor-shell.css"),
    "utf8",
  );
  const declarations = (selector: string): string => {
    const at = css.indexOf(`\n${selector} {`);
    expect(at, `${selector} is not in the stylesheet`).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf("}", at));
  };

  // The role gives up nothing: one that shrank or ellipsised would say nothing,
  // so it is never the row's flexible element.
  expect(declarations(".yunari-layer-role")).toMatch(/flex:\s*none/);
  expect(declarations(".yunari-layer-role")).not.toMatch(/flex:\s*1/);
  // …and the name keeps the growth, which is the whole of the row's width rule.
  expect(declarations(".yunari-layer-name")).toMatch(/flex:\s*1 1 auto/);
});

it("carries a role on every one of two hundred rows", async () => {
  // The scale the panel is judged at, with the group arm in it because a group's
  // mark is a bare `aria-hidden` glyph: the role is the only thing the row says
  // about its kind, so a row that skipped it would be identified by nothing.
  const rows = Array.from({ length: 200 }, (_, at) =>
    at % 20 === 19
      ? layerRow({
          id: `card-${at}`,
          name: `card-${at}`,
          kind: "group",
          hasChildren: true,
          role: { kind: "group", unit: undefined },
        })
      : layerRow({ id: `loose-${at}`, name: `loose-${at}`, kind: "shape" }),
  );
  const host = await renderPanel(rows);

  const rendered = [
    ...host.querySelectorAll<HTMLElement>("[data-yunari-layer]"),
  ];
  expect(rendered).toHaveLength(200);
  expect(host.querySelectorAll("[data-yunari-layer-role]")).toHaveLength(200);
  for (const row of rendered) {
    // Never the empty string, on any arm: a name that begins with a gap is a row
    // identified by nothing.
    expect(
      row.querySelector(".yunari-layer-role")?.textContent?.trim(),
    ).not.toBe("");
  }
  expect(roleSpan(host, "loose-0")?.textContent).toBe("Shape");
  expect(roleSpan(host, "card-19")?.textContent).toBe("Group");
  // The role is not a control, so a quiet panel stays quiet at two hundred rows.
  expect(host.querySelectorAll(".yunari-layer-role button")).toHaveLength(0);
});

// ── …and entering a group is an act of its own ──────────────────────────────

const card = layerRow({
  id: "card",
  name: "CPU card",
  kind: "group",
  hasChildren: true,
});
const trends = layerRow({
  id: "trends",
  name: "Trends",
  kind: "group",
  hasChildren: true,
});

/** A row's entry control, by its own attribute rather than by a label: an
 *  attended group row draws the twisty, the entry control and the three
 *  affordances, so `button[aria-label]` inside it matches several elements and
 *  a locator that resolved to the first would be measuring the twisty. */
function entryButton(host: HTMLElement, id: string): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>(
    `[data-yunari-layer="${id}"] [data-yunari-layer-entry]`,
  );
}

/** A pointer over one row, which is one of the three ways a row is attended. */
async function hover(host: HTMLElement, id: string): Promise<void> {
  await act(async () =>
    host
      .querySelector<HTMLElement>(`[data-yunari-layer="${id}"]`)
      ?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
  );
}

it("draws no enter control on a group row the author is not on", async () => {
  // The third control in a slot the panel keeps deliberately quiet, and the
  // group row is the case the first two never covered: a row with a twisty and
  // nothing else, exactly as it was before this control existed.
  const host = await renderPanel([card, trends]);

  expect(entryButton(host, "card")).toBeNull();
  expect(
    host.querySelectorAll<HTMLElement>('[data-yunari-layer="card"] button'),
  ).toHaveLength(1);
});

it("offers no entry on a row that is not a group or holds nothing", async () => {
  // Both rows are *selected* so the state slot is drawn and the absence is the
  // gate rather than the attention rule — a row that drew nothing because it
  // was quiet would satisfy a weaker version of this.
  const host = await renderPanel([
    layerRow({
      id: "wordmark",
      name: "Wordmark",
      kind: "text",
      selected: true,
    }),
    layerRow({
      id: "empty",
      name: "Empty",
      kind: "group",
      hasChildren: false,
      selected: true,
    }),
  ]);

  expect(entryButton(host, "wordmark")).toBeNull();
  expect(entryButton(host, "empty")).toBeNull();
});

it("enters the group its own row names, and no other", async () => {
  // The name is the whole of the assertion: three identical "Enter" buttons in
  // one tree are controls a reader cannot tell apart, so each carries the group
  // it opens — and the press carries that row's id, which a count alone would
  // not say.
  const enterGroup = vi.fn();
  const host = await renderPanel([card, trends], { enterGroup });
  document.body.append(host);

  await hover(host, "card");
  const label = entryButton(host, "card")?.getAttribute("aria-label");
  expect(label).toBe("Enter CPU card");
  await hover(host, "trends");
  const other = entryButton(host, "trends")?.getAttribute("aria-label");
  expect(other).toBe("Enter Trends");
  expect(label).not.toBe(other);

  // Hovering the other row withdrew the first one's control, so the press has
  // to come back to a control the panel is actually drawing.
  await hover(host, "card");
  await act(async () => entryButton(host, "card")?.click());
  expect(enterGroup.mock.calls).toEqual([["card"]]);
  host.remove();
});

it("leaves the entered group from its own row, in other words", async () => {
  // The entered group draws the control without being attended, because the way
  // out is the one thing a quiet row must not withhold — and it says a
  // different word, so the row the author is inside is distinguishable from the
  // rows they could go into.
  const exitGroup = vi.fn();
  const enterGroup = vi.fn();
  const host = await renderPanel([card, trends], {
    exitGroup,
    enterGroup,
    groupContext: () => ["card"],
  });
  document.body.append(host);

  const button = entryButton(host, "card")!;
  expect(button.getAttribute("aria-label")).toBe("Leave CPU card");
  await hover(host, "trends");
  expect(entryButton(host, "trends")?.getAttribute("aria-label")).toBe(
    "Enter Trends",
  );

  await act(async () => button.click());
  expect(exitGroup.mock.calls).toEqual([[]]);
  expect(enterGroup).not.toHaveBeenCalled();
  host.remove();
});

it("keeps expansion and entry as two acts on two controls", async () => {
  // Selection, expansion and entry are three acts, and this is where the first
  // two are told apart from the third: the twisty changes what is open and
  // never what is entered, and no key binding moves to make room for either.
  const setCollapsed = vi.fn();
  const enterGroup = vi.fn();
  const host = await renderPanel([card], { setCollapsed, enterGroup });

  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[aria-label="Collapse CPU card"]')
      ?.click(),
  );
  expect(setCollapsed.mock.calls).toEqual([["card", true]]);
  expect(enterGroup).not.toHaveBeenCalled();
});

it("makes a group's parts reachable once its control has entered it", async () => {
  // The capability the control buys, over the real bridge and the real grouping
  // manager rather than a stub: `selectLayer` takes `owner ?? target`, so with
  // the card shut a part's row click lands on the card, and inside the entered
  // context the same click lands on the part itself. A stub bridge would agree
  // with either answer.
  const canvas = new Canvas(document.createElement("canvas"));
  const part = new Rect({ id: "part", width: 10, height: 10 });
  const group = new Group([part]);
  group.set("id", "card");
  canvas.add(group);
  const real = createEditorShellBridge({
    editor: {
      canvas,
      groupingManager: createGroupingManager({
        canvas,
        save: () => undefined,
        suspend: () => () => undefined,
      }),
      historyManager: { saveState: () => undefined },
    },
    // The bridge subscribes to the session's document change so a rename
    // reaches the snapshot; this test drives neither, so the stub only has to
    // answer the subscription it is given.
    session: { subscribeDocumentChange: () => () => undefined } as never,
    capture: () => undefined,
  } as never);

  const host = document.createElement("div");
  await act(async () =>
    (await Promise.resolve(createRoot(host))).render(
      <CompositionPane bridge={real} />,
    ),
  );
  const row = (id: string): HTMLElement =>
    host.querySelector<HTMLElement>(`[data-yunari-layer="${id}"]`)!;
  const click = async (id: string): Promise<void> => {
    await act(async () =>
      row(id).dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
  };

  // A group's parts are rows only while it is open, so the part has to exist
  // before its row can be shown to select the wrong object.
  await act(async () =>
    row("card")
      .querySelector<HTMLButtonElement>("button[aria-expanded]")
      ?.click(),
  );
  expect(row("part")).not.toBeNull();

  await click("part");
  expect(canvas.getActiveObject()?.get("id")).toBe("card");

  await hover(host, "card");
  await act(async () => entryButton(host, "card")?.click());
  expect(real.groupContext()).toEqual(["card"]);

  await click("part");
  expect(canvas.getActiveObject()?.get("id")).toBe("part");
});

const backgroundRowFixture = (): LayerRow =>
  layerRow({
    id: "$background",
    name: uiCopy.panels.layerKinds.background,
    kind: "background",
  });

it("does not let the background row start a drag or open a rename", async () => {
  const host = await renderPanel([backgroundRowFixture()]);
  const row = host.querySelector<HTMLElement>(
    '[data-yunari-layer="$background"]',
  );
  expect(row).not.toBeNull();

  expect(row?.getAttribute("draggable")).toBe("false");
  await act(async () =>
    row?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
  );
  expect(row?.querySelector("input")).toBeNull();
  // No twisty, no enter, no visibility or lock: the background has no state
  // those controls could change.
  expect(row?.querySelectorAll("button")).toHaveLength(0);
});

it("selects the background with Space", async () => {
  const selectLayer = vi.fn();
  const host = await renderPanel([backgroundRowFixture()], { selectLayer });
  await act(async () =>
    host
      .querySelector<HTMLElement>('[data-yunari-layer="$background"]')
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true }),
      ),
  );
  expect(selectLayer).toHaveBeenCalledWith("$background");
});

it("keeps the background reachable while a group is entered", async () => {
  // It is not inside any group, so entering one must not dim it: the row stays
  // a target for the tree click that selects it.
  const host = await renderPanel(
    [
      layerRow({ id: "card", kind: "group", hasChildren: true }),
      layerRow({ id: "part", kind: "text", depth: 1, parentId: "card" }),
      backgroundRowFixture(),
    ],
    { groupContext: () => ["card"] },
  );
  const row = host.querySelector<HTMLElement>(
    '[data-yunari-layer="$background"]',
  );
  expect(row?.hasAttribute("data-context")).toBe(false);
});
