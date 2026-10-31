// @vitest-environment jsdom
import type { FabricObject } from "fabric/es";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { insertGroups } from "../new-object-panel.js";
import { OBJECT_ACTIONS, type ObjectTarget } from "../object-actions.js";
import {
  resolveShortcuts,
  setActiveShortcuts,
} from "../shortcut-manager/bindings.js";
import { shortcutLabel } from "../shortcut-manager/display.js";
import {
  PRODUCT_SHORTCUTS,
  type ShortcutBinding,
} from "../shortcut-manager/index.js";
import { uiCopy } from "../ui-copy.js";
import type { EditorShellBridge } from "./bridge.js";
import { CanvasContextMenu } from "./canvas-context-menu.js";
import type { EditorActionFacade } from "./session-facade.js";

// jsdom's selector engine cannot answer `:modal`/`:popover-open`, and floating-ui
// asks for both on every position. Each unanswerable call costs ~0.5s of selector
// parsing, which turns one menu open into ~35s. Real browsers answer both.
beforeAll(() => {
  const matches = Element.prototype.matches;
  Element.prototype.matches = Object.assign(function (
    this: Element,
    selector: string,
  ): boolean {
    if (selector === ":modal" || selector === ":popover-open") return false;
    return matches.call(this, selector);
  }, matches);
});

afterEach(() => {
  // The live binding table is module state, so a case that rebinds puts it back.
  setActiveShortcuts(PRODUCT_SHORTCUTS);
});

const CHART_TARGET: ObjectTarget = {
  kind: "chart",
  locked: false,
  memberCount: 1,
  isGroup: false,
};

const NO_TARGET: ObjectTarget = {
  kind: "none",
  locked: false,
  memberCount: 0,
  isGroup: false,
};

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
    outlineText: vi.fn(),
    arrange: vi.fn(() => true),
    canArrange: vi.fn(() => true),
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

interface Opened {
  readonly items: readonly HTMLElement[];
  readonly labels: readonly (string | null)[];
  readonly groupLabels: readonly (string | null)[];
  readonly event: MouseEvent;
  readonly setActiveObject: ReturnType<typeof vi.fn>;
  readonly run: ReturnType<typeof vi.fn>;
  readonly session: EditorActionFacade;
  readonly root: Root;
  readonly close: () => Promise<void>;
}

/** React schedules outside `act`, and floating-ui's measurement never settles
 * inside one, so the menu is flushed with macrotasks instead. */
async function flush(): Promise<void> {
  for (let round = 0; round < 3; round += 1)
    await new Promise((resolve) => setTimeout(resolve, 0));
}

async function openMenu(options: {
  readonly hit?: FabricObject;
  readonly target: ObjectTarget;
}): Promise<Opened> {
  const host = document.createElement("div");
  document.body.append(host);
  const upper = document.createElement("canvas");
  upper.className = "upper-canvas";
  host.append(upper);

  const setActiveObject = vi.fn();
  const run = vi.fn();
  const session = facadeStub();
  const bridge = {
    target: () => options.target,
    canArrange: () => false,
    run,
    session,
    editor: {
      canvas: {
        upperCanvasEl: upper,
        findTarget: () => ({ target: options.hit }),
        setActiveObject,
        requestRenderAll: vi.fn(),
      },
    },
  } as unknown as EditorShellBridge;

  const root = createRoot(host);
  root.render(<CanvasContextMenu bridge={bridge} />);
  await flush();

  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: 120,
    clientY: 90,
  });
  upper.dispatchEvent(event);
  await flush();

  const items = Array.from(
    document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  );
  return {
    items,
    labels: items.map((item) => item.getAttribute("aria-label")),
    groupLabels: Array.from(
      document.body.querySelectorAll<HTMLElement>(".editor-shell-menu-label"),
      (label) => label.textContent,
    ),
    event,
    setActiveObject,
    run,
    session,
    root,
    close: async () => {
      root.unmount();
      host.remove();
      await flush();
    },
  };
}

/** The chord chip a row draws — the `.editor-shell-menu-key` span the Edit
 *  menu's own rows carry — or `undefined` where the row draws none. */
function chip(item: HTMLElement | undefined): string | undefined {
  return item?.querySelector("kbd")?.textContent ?? undefined;
}

it("renders exactly the registry's eligible entries for the object under the pointer", async () => {
  const chart = {} as unknown as FabricObject;
  const opened = await openMenu({ hit: chart, target: CHART_TARGET });

  // Derived from the registry's own predicate, not from `actionEnabled` — the
  // function the menu itself calls would make this assertion tautological.
  const expected = OBJECT_ACTIONS.filter((action) =>
    action.eligible(CHART_TARGET),
  ).map((action) => action.label);
  // Without this the assertion below passes on a menu that rendered nothing.
  expect(expected.length).toBeGreaterThan(0);
  expect(opened.labels).toEqual(expected);
  // A right-click changes no selection, so the hit has to be selected for the
  // entries above to describe it.
  expect(opened.setActiveObject).toHaveBeenCalledWith(chart);
  // The native menu is suppressed, and only here.
  expect(opened.event.defaultPrevented).toBe(true);
  await opened.close();
});

it("marks the registry's destructive entry, and only it", async () => {
  const opened = await openMenu({
    hit: {} as unknown as FabricObject,
    target: CHART_TARGET,
  });

  // The menu carries the same `data-*` mark the dock draws, from the registry's
  // own flag. Read off the rendered items, not the registry, so a menu that
  // dropped the mark reddens rather than agreeing with the source. Close before
  // asserting: a failed case must not leave an open menu for the file's other
  // cases — the portal is in `document.body`, and a leak cascades.
  const marked = opened.items
    .filter((item) => item.hasAttribute("data-yunari-destructive"))
    .map((item) => item.getAttribute("aria-label"));
  await opened.close();
  expect(marked).toEqual([uiCopy.actions.delete]);
});

/**
 * The chords, which the Edit menu has printed since the shortcut table became
 * one owner of a mark. This menu draws the same four — Copy, Cut, Duplicate,
 * Delete — and drew none of them, so the row a reader met first named no key.
 *
 * Every chip is compared with what the *table* renders for the action the row
 * runs, and the rows the registry binds nothing for are asserted to draw none:
 * a chord written into this file would agree with itself and redden on nothing.
 */
it("draws each bound row's own chord, and none on a row the table binds nothing for", async () => {
  const opened = await openMenu({
    hit: {} as unknown as FabricObject,
    target: CHART_TARGET,
  });
  const drawn = new Map(
    opened.items.map((item) => [
      item.getAttribute("aria-label"),
      item.querySelector("kbd")?.textContent ?? undefined,
    ]),
  );
  // The spoken name is `aria-label` on the chip, as it is on the Edit menu's:
  // a `kbd` reading `Ctrl+D` is a screen reader saying "control D" at best.
  const spoken = new Map(
    opened.items.map((item) => [
      item.getAttribute("aria-label"),
      item.querySelector("kbd")?.getAttribute("aria-label") ?? undefined,
    ]),
  );
  await opened.close();

  const eligible = OBJECT_ACTIONS.filter((action) =>
    action.eligible(CHART_TARGET),
  );
  // Without this the loop below passes on an eligible set with no bound row.
  expect(
    eligible.filter((action) => action.shortcut !== undefined).length,
    "the object menu has at least one bound row to draw",
  ).toBeGreaterThan(0);

  for (const action of eligible) {
    if (action.shortcut === undefined) {
      expect(drawn.get(action.label), `${action.label} binds nothing`).toBe(
        undefined,
      );
      continue;
    }
    expect(drawn.get(action.label), `${action.label}'s own chord`).toBe(
      shortcutLabel(action.shortcut),
    );
    expect(spoken.get(action.label), `${action.label} spoken`).toBeTruthy();
  }
});

it("re-reads the chord after a rebind rather than holding the one it drew with", async () => {
  // Review Focus 3 on this surface: the context menu is the third thing that
  // prints a chord. The chip is built from the table on the render that opens
  // the menu, so what this proves is that the row *reads* the table — a chord
  // restated here would keep naming a key that no longer runs the row.
  const first = await openMenu({
    hit: {} as unknown as FabricObject,
    target: CHART_TARGET,
  });
  const before = chip(
    first.items.find(
      (item) => item.getAttribute("aria-label") === uiCopy.actions.duplicate,
    ),
  );
  await first.close();
  expect(before).toBe(shortcutLabel("edit.duplicate"));

  const moved: ShortcutBinding = {
    key: "j",
    modifier: true,
    shift: false,
    action: "edit.duplicate",
  };
  await act(async () => {
    setActiveShortcuts(resolveShortcuts({ "edit.duplicate": moved }));
  });

  const second = await openMenu({
    hit: {} as unknown as FabricObject,
    target: CHART_TARGET,
  });
  const after = chip(
    second.items.find(
      (item) => item.getAttribute("aria-label") === uiCopy.actions.duplicate,
    ),
  );
  await second.close();

  // Compared with the rebound table rather than with a spelling of it: the
  // printed caps are the platform's, and `Ctrl+J` is not what a Mac prints.
  expect(after).toBe(shortcutLabel("edit.duplicate"));
  expect(after).not.toBe(before);
});

it("dispatches the clicked entry through the bridge's own run", async () => {
  const opened = await openMenu({
    hit: {} as unknown as FabricObject,
    target: CHART_TARGET,
  });
  const duplicate = opened.items.find(
    (item) => item.getAttribute("aria-label") === uiCopy.actions.duplicate,
  );
  expect(duplicate).toBeDefined();
  duplicate?.click();
  expect(opened.run).toHaveBeenCalledWith("duplicate");
  await opened.close();
});

it("offers the Add pane's own list on empty canvas, and no object actions", async () => {
  const opened = await openMenu({ target: NO_TARGET });

  // The pane's list, flattened — read from the owner rather than restated, so
  // a third copy of "what can be inserted" cannot take root here. The menu used
  // to hold exactly that: text and the four chart families, with no shapes and
  // no panel, which is a surface an author cannot insert half the things the
  // product offers.
  const expected = insertGroups().flatMap((group) => group.objects);
  expect(expected.length).toBeGreaterThan(0);
  expect(opened.labels).toEqual(expected.map((object) => object.label));

  // And in the pane's groups, so "Line" — a chart and a shape — is told apart
  // by the heading above it here as it is in the pane.
  expect(opened.groupLabels).toEqual(
    insertGroups()
      .map((group) => group.label)
      .filter((label): label is string => label !== undefined),
  );

  // The registry is the object menu's owner: nothing from it may appear here.
  expect(opened.labels).not.toContain(uiCopy.actions.duplicate);
  expect(opened.setActiveObject).not.toHaveBeenCalled();
  await opened.close();
});

it("routes every creation entry through the façade the way its kind says", async () => {
  const opened = await openMenu({ target: NO_TARGET });

  /** The entry `label` under the heading `group`, which is what tells the two
   *  "Line"s apart. Addressing one by its label alone finds whichever came
   *  first — which is the ambiguity the headings exist to remove. */
  const inGroup = (group: string, label: string): HTMLElement | undefined => {
    const heading = Array.from(
      document.body.querySelectorAll<HTMLElement>(".editor-shell-menu-label"),
    ).find((element) => element.textContent === group);
    return Array.from(
      heading?.parentElement?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]',
      ) ?? [],
    ).find((item) => item.getAttribute("aria-label") === label);
  };

  const text = opened.items.find(
    (item) => item.getAttribute("aria-label") === uiCopy.panels.text,
  );
  text?.click();
  expect(opened.session.addText).toHaveBeenCalled();

  // The two the old menu could not name at all.
  inGroup(uiCopy.panels.shapes, uiCopy.shapeKinds.line)?.click();
  expect(opened.session.addShape).toHaveBeenCalledWith("line");
  inGroup(uiCopy.panels.charts, uiCopy.chartFamilies.line)?.click();
  expect(opened.session.addChart).toHaveBeenCalledWith("line");

  inGroup(uiCopy.panels.charts, uiCopy.chartFamilies.gauge)?.click();
  expect(opened.session.addChart).toHaveBeenCalledWith("gauge");

  // The card arm, which this suite did not exercise at all: deleting
  // `case "card"` from this file's own switch left 175 tests passing, because
  // every façade here stubs `insertCard`. A right-click that offered six
  // shapes, four charts and no card would look identical in this file.
  inGroup(uiCopy.panels.cards, uiCopy.cardLibrary.cpu)?.click();
  expect(opened.session.insertCard).toHaveBeenCalledWith("group-cpu-card");

  await opened.close();
});

it("stays inert until a document mounts a bridge", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const upper = document.createElement("canvas");
  upper.className = "upper-canvas";
  host.append(upper);
  const root = createRoot(host);
  root.render(<CanvasContextMenu bridge={undefined} />);
  await flush();

  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
  });
  expect(() => upper.dispatchEvent(event)).not.toThrow();
  await flush();
  expect(document.body.querySelectorAll('[role="menuitem"]')).toHaveLength(0);
  // Nothing owns the canvas yet, so the native menu must still appear.
  expect(event.defaultPrevented).toBe(false);

  root.unmount();
  host.remove();
  await flush();
});
