// @vitest-environment jsdom
/**
 * The copy net over the landed React surfaces: every word they show comes from
 * `uiCopy`, or is data — a token's name, a locale's, an asset's, a preset's.
 *
 * **What this half reads.** The shell is mounted whole with a bridge and a
 * selection, so the chrome it prints only then is in the tree at all; Settings is
 * read on its Appearance, Keyboard and About tabs; the colour picker is mounted
 * open; the selection column is mounted on a text object and a shape; the three
 * menubar menus and the canvas context menu are opened and read in turn; and the
 * `?` sheet, the publish popover and the library and new-document dialogs are
 * each mounted (`vg-418` — the header once said these four were not mounted, and
 * a header owns nothing). **The popover is the one read only in part**, and the
 * limit is stated rather than implied: its own warning is a bare `<span>`, which
 * no reader in this vocabulary reads, and its trigger carries the
 * `aria-controls` the button rule skips, so neither word is owned by anything.
 * That gap is the row's, not this walk's.
 *
 * **What it deliberately does not read, and why.** Three owners of words are
 * carved out by name, because the words are theirs and not this table's:
 * `shellPalettes`' stored ids (`isStoredName`), the preview catalogue's derived
 * lens ids (`isLensId`) and the shortcut reference's action words
 * (`isShortcutWord`). Paragraphs are not read at all: the
 * inspector, the picker and the panes print data in paragraphs of their own —
 * a run's binding id, a colour's reading — which is the same carve-out the panel
 * net makes for a select's trigger, and the shell now carries none of its own.
 *
 * The table's own rules are `ui-copy.test.ts`, and the imperative panels and
 * the picker they mount are `ui-copy-panels.test.ts`.
 *
 * **The store mode is read in its own case, through the shell's mode switch**
 * (A.6's fix round 1): the walks below mount the shell in the editor mode, where
 * `StoreModeRegion` does not render, so its words were outside every net until
 * that case landed. The mode is switched with the shell's own control rather
 * than by mounting the region directly, because what a walk can read is what the
 * product mounts. **A facet popover is opened there too** (fix round 2): it
 * portals to `body`, so its sentence and its group headings were outside the net
 * as well, and a literal in either stayed green.
 */
import type { FacetRecord } from "@yunari/renderer-core";
import { Canvas, type FabricObject, Rect, Textbox } from "fabric/es";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { expect, it } from "vitest";
import { ColourPicker } from "./components/ui/colour-picker.js";
import type { ModalSettle } from "./components/ui/modal-host.js";
import { activePreviewLenses } from "./display-lens.js";
import type { EditorShellBridge } from "./editor-shell/bridge.js";
import { CanvasContextMenu } from "./editor-shell/canvas-context-menu.js";
import type {
  HostingSnapshot,
  HostingStore,
} from "./editor-shell/hosting-store.js";
import {
  DEFAULT_SHELL_PALETTE,
  shellPalettes,
} from "./editor-shell/palette.js";
import { PublishControl } from "./editor-shell/publish-control.js";
import { Settings } from "./editor-shell/settings.js";
import { createShellLayout } from "./editor-shell/shell-layout.js";
import type { PublishSurfaceStore } from "./editor-shell/shell-stores.js";
import { ShortcutReference } from "./editor-shell/shortcut-reference.js";
import { NewDocumentChooser } from "./new-document-chooser.js";
import { STARTER_TEMPLATE } from "./new-fabric-theme.js";
import { createSelectionInspector } from "./selection-inspector/index.js";
// The reference table owns the words for actions no menu prints, so the walk
// reads the Keyboard tab through its carve-out rather than demanding the copy
// table own the shortcut registry.
import { SHORTCUT_LABELS } from "./shortcut-manager/reference.js";
import type { ThemeLibraryEntry } from "./theme-library-client.js";
import { ThemeLibraryChooser } from "./theme-library-dialog.js";
import { uiCopy } from "./ui-copy.js";
import { copy, paragraphsOf, saidIn, spokenIn } from "./ui-copy-readers.js";

/**
 * The React surfaces plans 1–5 landed say no word the table does not hold.
 *
 * The three panels are imperative and are read for their own DOM by
 * `ui-copy-panels.test.ts`; these are the shell, the Settings modal, the colour
 * picker and the selection column, which that net never reached. A literal in a
 * React surface is invisible to a reviewer reading `ui-copy.ts` and to the
 * pictograph rule, exactly as one in a panel is — and the cost is the same: a
 * word an author reads has no owner, so a rename fixes one surface and silently
 * misses the other.
 *
 * **The list below is the coverage, and every surface is asserted non-empty by
 * its own selector.** A surface that failed to mount contributes nothing and
 * would satisfy the walk by being absent (Review Focus 3), so absence is made a
 * failure rather than a pass.
 */
it("leaves the React surfaces with no copy of their own", async () => {
  const { root, shell, destroy } = await mountLandedSurfaces();
  const owned = new Set(copy());
  expect(
    spokenIn(root).filter(
      (text) => !owned.has(text) && !isStoredName(text) && !isLensId(text),
    ),
  ).toEqual([]);
  for (const surface of LANDED_SURFACES) {
    const found = root.querySelector(surface);
    if (found === null) throw new Error(`no ${surface} surface rendered`);
    expect(spokenIn(found), surface).not.toEqual([]);
  }
  // The shell's hint paragraph is gone (`vg-338` was its net); what remains is
  // chrome whose words `spokenIn` reads, so there is nothing left to walk here.
  expect(paragraphsOf(shell)).toEqual([]);
  destroy();
});

/**
 * The surfaces `vg-335` found reachable but unread say no word the table does
 * not hold: an opened menu popup, the Settings Keyboard and About tabs, and the
 * canvas context menu. `spokenIn` read the closed chrome, so a literal written
 * into any of the four had no net at all — and each is opened here, read for
 * its own words, and asserted non-empty first, so a surface that failed to open
 * is a failure rather than a walk that agreed with nothing.
 *
 * The menu read pays no stall: `vg-135`'s 50-90 s per open is jsdom's
 * unanswerable `:modal`/`:popover-open` selectors, and `ui-copy-readers.ts`
 * patches them on import for exactly that reason.
 */
it("reads the opened menus, the Settings tabs and the canvas context menu", async () => {
  const { root, destroy } = await mountLandedSurfaces();
  const owned = new Set(copy());

  for (const menu of [
    uiCopy.menus.file,
    uiCopy.menus.edit,
    uiCopy.menus.view,
  ]) {
    menubarEntry(root, menu).click();
    await Promise.resolve();
    const popup = root.querySelector<HTMLElement>(
      ".editor-shell-menu-popup[data-open]",
    );
    if (popup === null) throw new Error(`the ${menu} menu opened no popup`);
    expect(spokenIn(popup), menu).not.toEqual([]);
    expect(
      spokenIn(popup).filter((text) => !owned.has(text)),
      menu,
    ).toEqual([]);
  }

  const { keyboard, about } = uiCopy.settings;
  for (const tab of [keyboard, about]) {
    const panel = openSettingsTab(tab);
    const said = saidIn(panel);
    expect(said, tab).not.toEqual([]);
    expect(
      said.filter(
        (text) =>
          !owned.has(text) &&
          !isShortcutWord(text) &&
          !isStoredName(text) &&
          !isLensId(text),
      ),
      tab,
    ).toEqual([]);
  }
  destroy();

  // The canvas context menu, which mounts on a bridge of its own rather than
  // inside the shell — the shell's own copy of it renders no rows until a
  // right-click arrives on a real upper canvas.
  const bridge = selectionBridge();
  const host = document.createElement("div");
  document.body.append(host);
  const menuRoot = createRoot(host);
  menuRoot.render(createElement(CanvasContextMenu, { bridge }));
  await flushTasks();
  const upper = bridge.editor.canvas.upperCanvasEl as unknown as HTMLElement;
  upper.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 90,
    }),
  );
  await flushTasks();
  const items = Array.from(
    document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  );
  // Without this the read below passes on a menu that rendered nothing.
  expect(items.length).toBeGreaterThan(0);
  const spoken = spokenIn(document.body);
  expect(spoken).not.toEqual([]);
  expect(
    spoken.filter(
      (text) => !owned.has(text) && !isStoredName(text) && !isLensId(text),
    ),
  ).toEqual([]);
  await act(async () => menuRoot.unmount());
  document.body.replaceChildren();
});

/**
 * `vg-418`: the four surfaces the walk did not mount — the `?` sheet, the
 * publish popover and the two dialogs. Each renders words an author reads, and
 * a literal in one of them was read by no net: the header stated these four
 * were not mounted, and a comment owns nothing.
 *
 * Each is mounted and read — the header names the one read only in part — and
 * asserted non-empty first, so a surface that failed to mount is a failure
 * rather than a walk that agreed with nothing. The popover is mounted open and
 * each dialog at its first question, because a closed surface renders nothing
 * and would pass the walk by being absent.
 */
it("reads the shortcut sheet, the publish popover and the two dialogs", async () => {
  // The list is the coverage, and a surface dropped from it takes its read with
  // it, so the count is guarded rather than left to the length of the loop —
  // the same shape the menu rows' count takes in `ui-copy.test.ts`.
  expect(READ_SURFACES).toHaveLength(4);
  const owned = new Set(copy());
  for (const surface of READ_SURFACES) {
    const { root, destroy } = await surface.mount();
    const said = saidIn(root);
    expect(said, surface.name).not.toEqual([]);
    expect(
      said.filter(
        (text) =>
          !owned.has(text) &&
          !isStoredName(text) &&
          !isLensId(text) &&
          !isShortcutWord(text),
      ),
      surface.name,
    ).toEqual([]);
    destroy();
  }
});

/** One surface this walk reads, and the mount that puts it in the tree. */
interface ReadSurface {
  readonly name: string;
  readonly mount: () => Promise<{
    readonly root: HTMLElement;
    readonly destroy: () => void;
  }>;
}

/** The record the host derives for every listed theme. The walk reads words and
 *  never the record, so one value stands in for all of them. */
const FACETS: FacetRecord = {
  author: undefined,
  colourMode: "unclassified",
  sensors: [],
  tags: [],
  orientation: "landscape",
  aspect: "16:9",
  width: 1920,
  height: 1080,
};

/** The four surfaces `vg-418` found unmounted, each mounted here. They portal to
 *  `body` — a `Dialog` and a `Popover` both do — so the read is over `body`
 *  rather than the mount point, which holds none of the words. */
const READ_SURFACES: readonly ReadSurface[] = [
  {
    name: "the shortcut sheet",
    mount: async () => {
      const root = createRoot(host());
      await act(async () =>
        root.render(
          createElement(ShortcutReference, {
            open: true,
            onOpenChange: () => undefined,
          }),
        ),
      );
      return { root: document.body, destroy: () => close(root) };
    },
  },
  {
    name: "the publish popover",
    mount: async () => {
      const root = createRoot(host());
      await act(async () =>
        root.render(
          createElement(PublishControl, {
            hosting: hostingServing(),
            surface: surfaceShown(),
          }),
        ),
      );
      await flushTasks();
      return { root: document.body, destroy: () => close(root) };
    },
  },
  {
    name: "the library dialog",
    mount: async () => {
      const root = createRoot(host());
      await act(async () =>
        root.render(
          createElement(ThemeLibraryChooser, {
            themes: [{ id: "mine", name: "My theme", facets: FACETS }],
            templates: [STARTER_TEMPLATE],
            settle: answeringSettle(),
          }),
        ),
      );
      return { root: document.body, destroy: () => close(root) };
    },
  },
  {
    name: "the new-document dialog",
    mount: async () => {
      const root = createRoot(host());
      await act(async () =>
        root.render(
          createElement(NewDocumentChooser, { settle: answeringSettle() }),
        ),
      );
      return { root: document.body, destroy: () => close(root) };
    },
  },
];

/**
 * **The store mode's own words, which this net did not reach** (A.6's fix
 * round 1). The walk above mounts the shell through `createShellLayout`, whose
 * mode starts as `"editor"`, and `StoreModeRegion` renders only when the mode is
 * not — so every word A.6 wrote was outside the net: a literal in `region.tsx`
 * or `item-modal.tsx` left this file green while `region.dom.test.tsx` went red,
 * and the dom cases compare against `uiCopy` values, which a hardcoded string
 * equal to the table also satisfies.
 *
 * **The mode is switched through the shell's own control**, not by mounting the
 * region directly, because what a walk can read is what the product mounts. The
 * listing is stubbed at `fetch` — the one thing the region asks the host for —
 * so the gallery, the item's own surface and the two empty sentences are all
 * reachable, and the walk reads each of them.
 *
 * **The item's own name is data, not copy**: the modal is named by the item it
 * shows (`aria-label`), exactly as a token's name or a shortcut's action word is
 * data elsewhere in this file, so it is carved out by the fixture's own values.
 */
it("reads the store mode's words, which the editor's walk never reached", async () => {
  const owned = new Set(copy());
  const itemName = "Living room";

  const withOne = await mountStoreShell([
    { id: "living-room", name: itemName, facets: FACETS },
  ]);
  try {
    const said = saidIn(withOne.region());
    expect(said, "the store mode said nothing at all").not.toEqual([]);
    expect(
      said.filter(
        (text) => !owned.has(text) && !isItemWord(text) && !isLensId(text),
      ),
      "the store region",
    ).toEqual([]);

    // The item's own surface, opened from the cell the way a person opens it:
    // the modal portals to `body`, so it is read there.
    withOne.openItem();
    if (document.querySelector("[data-yunari-store-item]") === null) {
      throw new Error("the item's own surface did not open");
    }
    const modal = saidIn(document.body);
    expect(modal, "the item's own surface said nothing").not.toEqual([]);
    // The modal's own words are in the read rather than only the region's
    // behind it: without this the case would pass on a modal that never opened.
    expect(modal, "the item's own surface is not in the read at all").toContain(
      uiCopy.store.item.close,
    );
    expect(
      modal.filter(
        (text) => !owned.has(text) && !isItemWord(text) && !isLensId(text),
      ),
      "the item's own surface",
    ).toEqual([]);

    // **The popover, which portals outside the region** (A.6's fix round 2).
    // `Popover.Portal` renders the popup on `body`, so a walk that reads only
    // the region never meets its sentence or its group headings — both copy, and
    // both stayed green while a literal stood in for them. The popover's option
    // *rows* are carved out of the shared reader instead (`ui-copy-readers.ts`):
    // a row prints a value beside a count, neither of which is this table's.
    withOne.openFacet("shape");
    const opened = saidIn(withOne.popover());
    expect(opened, "the Shape popover said nothing at all").not.toEqual([]);
    expect(opened, "the Shape popover's sentence is not in the read").toContain(
      uiCopy.store.facets.shapeHint,
    );
    expect(
      opened,
      "the Shape popover's group headings are not in the read",
    ).toContain(uiCopy.store.facets.shapeGroups.orientation);
    expect(
      opened.filter(
        (text) => !owned.has(text) && !isItemWord(text) && !isLensId(text),
      ),
      "the Shape popover",
    ).toEqual([]);
  } finally {
    withOne.destroy();
  }

  // The first-run sentence, which only a library with nothing in it draws — and
  // which the region deliberately does not draw before its listing arrives.
  const withNone = await mountStoreShell([]);
  try {
    const said = saidIn(withNone.region());
    expect(said, "an empty library said nothing").not.toEqual([]);
    expect(
      said.filter(
        (text) => !owned.has(text) && !isItemWord(text) && !isLensId(text),
      ),
      "the empty library",
    ).toEqual([]);
  } finally {
    withNone.destroy();
  }
});

/** A theme's own words — its name — are the listing's data rather than the
 *  table's, the way a shell palette's name and a shortcut's action word are. */
function isItemWord(text: string): boolean {
  return STORE_ITEM_NAMES.includes(text);
}

/** The names this walk's stub lists, so the carve-out above is over values the
 *  walk really met rather than over a list that happens to be empty. */
const STORE_ITEM_NAMES: readonly string[] = ["Living room"];

/** A shell mounted in the store mode over a stubbed listing. */
async function mountStoreShell(themes: readonly ThemeLibraryEntry[]): Promise<{
  readonly region: () => HTMLElement;
  readonly openItem: () => void;
  /** Open one facet's popover, and read it where it landed — `body`, not the
   *  region, because `Popover.Portal` puts it there. */
  readonly openFacet: (facetId: string) => void;
  readonly popover: () => HTMLElement;
  readonly destroy: () => void;
}> {
  // **The one request the region makes.** `createThemeLibraryClient` binds
  // `globalThis.fetch` when the region builds it, so the stub has to be in place
  // before the mode switch mounts the region. Every other path is left to the
  // fetch that was already there, so this walk's other surfaces behave exactly
  // as they did.
  const original = globalThis.fetch;
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.includes("/api/themes")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ themes }),
      } as unknown as Response;
    }
    return original(input, init);
  }) as typeof fetch;

  const root = document.createElement("div");
  document.body.append(root);
  const layout = createShellLayout(root);
  layout.setBridge(selectionBridge(), undefined);

  const segment = Array.from(
    root.querySelectorAll<HTMLButtonElement>(
      ".editor-shell-mode-switch button",
    ),
  ).find((button) => button.textContent?.trim() === uiCopy.modes.themes);
  if (segment === undefined) {
    throw new Error("the shell draws no Themes segment to switch with");
  }
  await act(async () => segment.click());
  await flushTasks();

  return {
    region: () => {
      const found = document.querySelector<HTMLElement>(
        "[data-yunari-mode-region='themes']",
      );
      if (found === null) throw new Error("the store mode rendered no region");
      return found;
    },
    openItem: () => {
      // The cell's own surface: the `open` action loads a document rather than
      // opening this modal, so the walk reaches the item the way a person does.
      const open = document.querySelector<HTMLButtonElement>(
        "[data-yunari-store-cell-surface]",
      );
      if (open === null) throw new Error("the gallery drew no cell to open");
      act(() => open.click());
    },
    openFacet: (facetId: string) => {
      const trigger = document.querySelector<HTMLButtonElement>(
        `[data-yunari-facet='${facetId}']`,
      );
      if (trigger === null)
        throw new Error(`the region drew no ${facetId} facet`);
      act(() => trigger.click());
    },
    popover: () => {
      const found = document.querySelector<HTMLElement>(
        "[data-yunari-facet-popup]",
      );
      if (found === null) throw new Error("no facet popover is open");
      return found;
    },
    destroy: () => {
      globalThis.fetch = original;
      layout.destroy();
      document.body.replaceChildren();
    },
  };
}

/** A mount point on `body`, which is where a portalled surface is read. */
function host(): HTMLElement {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
}

/** Unmount a surface and clear what it portalled, so the next mount's read is
 *  its own words rather than this one's. */
function close(root: Root): void {
  act(() => root.unmount());
  document.body.replaceChildren();
}

/** A host that has answered, so the popover draws the surface rather than the
 *  nothing an unread host says. No pairing is there, so it prints no address
 *  and no expiry — the two readings a copy walk must not demand an owner for. */
function hostingServing(): HostingStore {
  // One snapshot, not one per read: `useSyncExternalStore` compares the answer
  // by identity and re-renders forever on a fresh object each call.
  const answer: HostingSnapshot = {
    kind: "known",
    answer: { lan: true, address: "192.168.1.5", port: 4174, refusal: null },
    pairing: undefined,
    reason: undefined,
    pending: undefined,
  };
  return {
    subscribe: () => () => undefined,
    get: () => answer,
  } as unknown as HostingStore;
}

/** The header's open flag, already set: a closed popover renders no popup. */
function surfaceShown(): PublishSurfaceStore {
  return {
    subscribe: () => () => undefined,
    get: () => true,
    set: () => undefined,
  } as unknown as PublishSurfaceStore;
}

/** What a modal surface calls to answer. This walk reads words, so neither
 *  answer is ever taken. */
function answeringSettle<T>(): ModalSettle<T> {
  return { close: () => undefined, dismiss: () => undefined };
}

/** The menubar trigger for a menu, found by the text it carries. */
function menubarEntry(root: HTMLElement, label: string): HTMLButtonElement {
  const entry = Array.from(
    root.querySelectorAll<HTMLButtonElement>(".editor-shell-menubar button"),
  ).find((button) => button.textContent === label);
  if (entry === undefined) throw new Error(`No "${label}" menu.`);
  return entry;
}

/** The Settings modal's tab named `label`, clicked the way a reader opens it,
 *  returning the panel the tab points at — not the first `tabpanel`, which is
 *  the Appearance tab's while Base UI still holds it. */
function openSettingsTab(label: string): HTMLElement {
  const tab = Array.from(
    document.querySelectorAll<HTMLElement>('[role="tab"]'),
  ).find((element) => element.textContent?.trim() === label);
  if (tab === undefined) throw new Error(`No "${label}" tab in the modal.`);
  act(() => {
    tab.click();
  });
  const controlled = tab.getAttribute("aria-controls");
  const panel =
    controlled === null ? null : document.getElementById(controlled);
  if (panel === null) throw new Error(`the ${label} tab points at no panel`);
  return panel;
}

/** React schedules outside `act` and floating-ui's measurement never settles
 *  inside one, so a popup is flushed with macrotasks instead. */
async function flushTasks(): Promise<void> {
  for (let round = 0; round < 3; round += 1)
    await new Promise((resolve) => setTimeout(resolve, 0));
}

/** The shell's chrome, in the surfaces the walk reads. Each is a selector the
 *  mounted tree answers, so a surface dropped from `mountLandedSurfaces` is the
 *  `null` this file already fails on rather than a silent gap. */
const LANDED_SURFACES = [
  ".editor-shell-menubar",
  ".editor-shell-stage",
  ".editor-shell-rail",
  "[data-yunari-canvas-toolbar]",
  ".editor-shell-panel",
  ".editor-shell-settings",
  "[data-yunari-section]",
  '[data-testid="colour-picker"]',
] as const;

/** A shell palette's name is the id `shellPalettes` stores — the same string
 *  the swatch's `data-shell-palette` carries — so it is a preset's own name,
 *  the data the carve-out above deliberately leaves out of the table. */
function isStoredName(text: string): boolean {
  return (shellPalettes as readonly string[]).includes(text);
}

/** A preview is named by the id its stored ratio derives — the author's list,
 *  not this table's. The display menu and the chooser both print that id, and a
 *  ratio added in Settings must need no copy change. */
function isLensId(text: string): boolean {
  return activePreviewLenses().some((lens) => lens.id === text);
}

/** A shortcut's action word is the reference table's. `SHORTCUT_LABELS` reuses
 *  `uiCopy`'s names and owns the five no menu prints (`Select all` and the four
 *  nudges), so the Keyboard tab names its rows from there and the copy table is
 *  not their owner. */
function isShortcutWord(text: string): boolean {
  return (Object.values(SHORTCUT_LABELS) as readonly string[]).includes(text);
}

/**
 * The shell's bridge, cut to what a mounted shell reaches.
 *
 * A walk that reads words mounts the shell whole, and the shell mounts the
 * composition pane, so the pane's reads are here too. It reports a selection
 * because the shell prints some of its chrome only then — `vg-338`'s hint
 * paragraph among it, which no net could read while the shell mounted with no
 * selection at all. Everything answers empty: this file reads copy, not state.
 */
function selectionBridge(): EditorShellBridge {
  const noop = (): undefined => undefined;
  return {
    snapshot: () => ({
      selectedCount: 1,
      locked: false,
      activeKind: "text",
      documentName: undefined,
      selectionPresetId: undefined,
    }),
    capture: noop,
    target: () => ({
      kind: "text",
      locked: false,
      memberCount: 1,
      isGroup: false,
    }),
    can: () => false,
    canArrange: () => false,
    layers: () => [],
    groupContext: () => [],
    selectLayer: noop,
    enterGroup: noop,
    exitGroup: noop,
    setLayerVisible: noop,
    setLayerLocked: noop,
    setCollapsed: noop,
    renameLayer: noop,
    layerDrop: () => undefined,
    moveLayer: () => false,
    subscribe: () => () => undefined,
    run: noop,
    destroy: noop,
    session: {
      newDocument: noop,
      newFromStarter: noop,
      importPackage: noop,
      openLibraryTheme: noop,
      savePackage: noop,
      releasePackage: noop,
      openLibrary: noop,
      saveLibrary: noop,
      addText: noop,
      addShape: noop,
      addChart: noop,
      insertCard: noop,
      arrange: () => true,
      canArrange: () => true,
      undo: noop,
      redo: noop,
      copy: noop,
      cut: noop,
      deleteActive: noop,
      duplicate: noop,
      group: noop,
      ungroup: noop,
      isDirty: () => false,
      publishableDocument: () => undefined,
      subscribeDocumentChange: () => () => undefined,
    },
    editor: {
      artboard: () => ({ width: 1280, height: 720 }),
      viewport: {
        zoom: () => 1,
        display: () => undefined,
        isFitted: () => false,
        onChange: () => () => undefined,
      },
      canvas: {
        upperCanvasEl: document.createElement("canvas"),
        findTarget: () => ({ target: undefined }),
        on: noop,
        off: noop,
      },
    },
  } as unknown as EditorShellBridge;
}

/**
 * The React surfaces plans 1–5 landed, mounted at once.
 *
 * The shell is assembled whole (`createShellLayout`) rather than piece by piece,
 * because three of the strings this net exists to catch — the menubar's name,
 * the stage's name and the canvas toolbar — are the shell's own markup; the
 * Settings modal and the colour picker are mounted open, because a closed modal
 * and an unopened popover render nothing and would pass the walk by being
 * absent. The selection column is mounted on a text object and a shape, the two
 * disjoint field sets. The shell is given a bridge, so the chrome it prints
 * only for a selection is in the tree rather than absent.
 */
async function mountLandedSurfaces(): Promise<{
  readonly root: HTMLElement;
  readonly shell: HTMLElement;
  readonly destroy: () => void;
}> {
  const shellRoot = document.createElement("div");
  document.body.append(shellRoot);
  const layout = createShellLayout(shellRoot);
  layout.setBridge(selectionBridge(), undefined);

  const settingsHost = document.createElement("div");
  document.body.append(settingsHost);
  const settingsRoot = createRoot(settingsHost);
  await act(async () => {
    settingsRoot.render(
      createElement(Settings, {
        open: true,
        onOpenChange: () => undefined,
        storage: undefined,
        palette: DEFAULT_SHELL_PALETTE,
        following: true,
        onPalette: () => undefined,
        onFollowing: () => undefined,
        overrides: {},
        onOverrides: () => undefined,
        releaseVersion: undefined,
      }),
    );
  });

  const pickerHost = document.createElement("div");
  document.body.append(pickerHost);
  const pickerRoot: Root = createRoot(pickerHost);
  await act(async () => {
    pickerRoot.render(
      createElement(ColourPicker, {
        value: "#123456",
        onValueChange: () => undefined,
        onValueCommit: () => undefined,
        label: uiCopy.panels.colour,
      }),
    );
  });
  const trigger = pickerHost.querySelector<HTMLElement>(
    '[data-testid="picker-trigger"]',
  );
  if (trigger === null)
    throw new Error("the colour picker rendered no trigger");
  await act(async () => trigger.click());

  // Plan 3's selection column. A text object whose run reads a clock is the
  // richest selection, and a shape renders the other half of the field set.
  for (const selection of [
    new Textbox("", { id: "clock-label" }) as FabricObject,
    new Rect({ left: 0, top: 0, width: 40, height: 20 }) as FabricObject,
  ]) {
    selection.set("yunariText", {
      align: "centre",
      runs: [{ kind: "value", bindingId: "clock-time" }],
    });
    selection.set("yunariGlass", { blurRadius: 16 });
    const canvas = new Canvas(document.createElement("canvas"));
    canvas.add(selection);
    canvas.setActiveObject(selection);
    const host = document.createElement("div");
    document.body.append(host);
    createSelectionInspector(host, {
      editor: {
        canvas,
        historyManager: { attachGlobals: () => {}, saveState: () => undefined },
        errorManager: { warn: () => undefined, error: () => undefined },
        cropManager: { active: false, target: undefined },
      } as never,
      globals: {
        palette: {
          ink: { name: "Ink", value: { kind: "solid", color: "#ffffff" } },
        },
        typePresets: {
          body: { name: "Body", value: { family: "Inter", size: 16 } },
        },
      } as never,
      nodeBindings: () => [{ id: "clock-time", semanticKey: "date.today" }],
      refreshGlass: () => undefined,
      // The face field is projected only when an owner that can write one is
      // mounted, so the catalogue browser is only in this walk's tree when these
      // are handed over — and a surface the walk does not mount is a surface it
      // cannot read.
      fontActions: {
        applyFace: async () => undefined,
        applyTrio: async () => undefined,
      },
      favoritesClient: {
        list: async () => [],
        save: async (ids: readonly string[]) => ids,
      },
    });
  }

  return {
    root: document.body,
    shell: shellRoot,
    destroy: () => {
      layout.destroy();
      act(() => pickerRoot.unmount());
      act(() => settingsRoot.unmount());
      document.body.replaceChildren();
    },
  };
}
