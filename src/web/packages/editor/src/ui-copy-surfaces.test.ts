// @vitest-environment jsdom
/**
 * The copy net over the landed React surfaces: every word they show comes from
 * `uiCopy`, or is data — a token's name, a locale's, an asset's, a preset's.
 *
 * **What this half reads.** The shell is mounted whole with a bridge and a
 * selection, so the chrome it prints only then is in the tree at all; Settings is
 * read on its Appearance, Keyboard and About tabs; the colour picker is mounted
 * open; the selection column is mounted on a text object and a shape; the header
 * toolbar and the canvas context menu are read in turn; and the `?` sheet, the
 * publish dialog and the library and new-document dialogs are each mounted.
 * **The publish dialog is read whole**: its warning is a bare
 * `<span>` marked `data-yunari-copy`, and its trigger carries `aria-controls`
 * without a `data-yunari-value`, so the button rule reads the word it prints
 * instead of skipping it as a chosen value.
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
 */
import type { FacetRecord } from "@yunari/renderer-core";
import { Canvas, type FabricObject, Rect, Textbox } from "fabric/es";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { expect, it, vi } from "vitest";
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
import { createShellLayout } from "./editor-shell/shell-layout.js";
import type { PublishSurfaceStore } from "./editor-shell/shell-stores.js";
import { ShortcutReference } from "./editor-shell/shortcut-reference.js";
import { LibraryRegion } from "./library-mode/region.js";
import { NewDocumentChooser } from "./new-document-chooser.js";
import { STARTER_TEMPLATE } from "./new-fabric-theme.js";
import { createSelectionInspector } from "./selection-inspector/index.js";
import { AboutPage } from "./settings-mode/pages/about-page.js";
import { AppearancePage } from "./settings-mode/pages/appearance-page.js";
import { KeyboardPage } from "./settings-mode/pages/keyboard-page.js";
// The reference table owns the words for actions no menu prints, so the walk
// reads the Keyboard tab through its carve-out rather than demanding the copy
// table own the shortcut registry.
import { shortcutSpokenLabel } from "./shortcut-manager/display.js";
import { PRODUCT_SHORTCUTS } from "./shortcut-manager/index.js";
import { SHORTCUT_LABELS } from "./shortcut-manager/reference.js";
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
      (text) =>
        !owned.has(text) &&
        !isStoredName(text) &&
        !isLensId(text) &&
        !isPreviewRatioSentence(text) &&
        !isShortcutWord(text) &&
        !isPreviewRemoveLabel(text),
    ),
  ).toEqual([]);
  for (const surface of LANDED_SURFACES) {
    const found = root.querySelector(surface);
    if (found === null) throw new Error(`no ${surface} surface rendered`);
    expect(spokenIn(found), surface).not.toEqual([]);
  }
  // The shell has no hint paragraph; what remains is
  // chrome whose words `spokenIn` reads, so there is nothing left to walk here.
  expect(paragraphsOf(shell)).toEqual([]);
  destroy();
});

/**
 * The surfaces reachable but unread say no word the table does
 * not hold: the Settings Keyboard and About tabs and the canvas context menu.
 * `spokenIn` reads the closed chrome, so a literal written into any of the
 * three would have no net at all — and each is opened here, read for its own
 * words, and asserted non-empty first, so a surface that failed to open is a
 * failure rather than a walk that agreed with nothing.
 */
it("reads the Settings tabs and the canvas context menu", async () => {
  const { destroy } = await mountLandedSurfaces();
  const owned = new Set(copy());

  for (const page of ["keyboard", "about"] as const) {
    const tab = uiCopy.settings.pages[page];
    const panel = document.querySelector<HTMLElement>(
      `[data-yunari-settings-page="${page}"]`,
    );
    if (panel === null) throw new Error(`no ${tab} page rendered`);
    const said = saidIn(panel);
    expect(said, tab).not.toEqual([]);
    expect(
      said.filter(
        (text) =>
          !owned.has(text) &&
          !isShortcutWord(text) &&
          !isStoredName(text) &&
          !isLensId(text) &&
          !isPreviewRatioSentence(text) &&
          !isPreviewRemoveLabel(text),
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
      (text) =>
        !owned.has(text) &&
        !isStoredName(text) &&
        !isLensId(text) &&
        !isPreviewRatioSentence(text),
    ),
  ).toEqual([]);
  await act(async () => menuRoot.unmount());
  document.body.replaceChildren();
});

/**
 * The four surfaces the walk must mount — the `?` sheet, the
 * publish popover and the two dialogs. Each renders words an author reads, and
 * a literal in one of them is read by no net unless the surface is mounted; a
 * header states coverage, not the read.
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
          !isPreviewRatioSentence(text) &&
          !isShortcutWord(text) &&
          !isOwnedChordTooltip(text, owned),
      ),
      surface.name,
    ).toEqual([]);
    destroy();
  }
});

/**
 * The Library mode's listing, its toolbar and an item's own surface.
 *
 * The library surfaces replaced the store's theme-only grid, so the words they
 * draw are read here: the toolbar's facet and sort names, the gallery's four
 * cell actions, and the modal the name press opens. The listed theme's own
 * name is data — the same carve-out a preset's name gets — so
 * `isListingName` drops it and nothing else.
 */
it("reads the Library listing, its toolbar and an item's surface", async () => {
  vi.stubGlobal("fetch", listingServing());
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(LibraryRegion, {
        page: "dashboard-themes",
        onPage: () => undefined,
        state: "all",
        onState: () => undefined,
      }),
    ),
  );
  await vi.waitFor(() =>
    expect(
      host.querySelector("[data-yunari-store-cell]"),
      "the Library listing drew no cell",
    ).not.toBeNull(),
  );

  const owned = new Set(copy());
  const region = host.querySelector("[data-yunari-library-region]");
  if (region === null) throw new Error("the Library rendered no region");
  expect(
    host.querySelector("[data-yunari-library-toolbar]"),
    "the listing drew no toolbar",
  ).not.toBeNull();
  const listingSaid = spokenIn(region);
  expect(listingSaid).not.toEqual([]);
  expect(
    listingSaid.filter((text) => !owned.has(text) && !isListingName(text)),
  ).toEqual([]);

  // The Shape popover is the only surface that prints the facet's hint and its
  // group headings, and it portals to `body`, so the region's own read never
  // reaches it. Opening it is what keeps a hardcoded heading or hint out of the
  // net.
  const shapeTrigger = host.querySelector<HTMLButtonElement>(
    '[data-yunari-facet="shape"]',
  );
  if (shapeTrigger === null) throw new Error("the toolbar drew no Shape facet");
  await act(async () => shapeTrigger.click());
  const facetPopup = await vi.waitFor(() => {
    const found = document.body.querySelector<HTMLElement>(
      '[data-yunari-facet-popup="shape"]',
    );
    if (found === null) throw new Error("the Shape facet opened no popover");
    return found;
  });
  const facetSaid = saidIn(facetPopup);
  expect(facetSaid, "the Shape popover said nothing").not.toEqual([]);
  expect(facetSaid.filter((text) => !owned.has(text))).toEqual([]);
  await act(async () => shapeTrigger.click());

  await act(async () =>
    (
      host.querySelector(
        "[data-yunari-store-cell-name-press]",
      ) as HTMLButtonElement | null
    )?.click(),
  );
  const modal = await vi.waitFor(() => {
    const found = document.body.querySelector("[data-yunari-store-item]");
    if (found === null) throw new Error("the item press opened no surface");
    return found;
  });
  const modalSaid = spokenIn(modal);
  expect(modalSaid).not.toEqual([]);
  expect(
    modalSaid.filter((text) => !owned.has(text) && !isListingName(text)),
  ).toEqual([]);

  await act(async () => root.unmount());
  document.body.replaceChildren();

  // A successful read that holds nothing is the other surface whose words the
  // retired store walk owned: the empty listing's two sentences are paragraphs,
  // so only `saidIn` reaches them.
  vi.stubGlobal("fetch", listingServing([]));
  const emptyHost = document.createElement("div");
  document.body.append(emptyHost);
  const emptyRoot = createRoot(emptyHost);
  await act(async () =>
    emptyRoot.render(
      createElement(LibraryRegion, {
        page: "dashboard-themes",
        onPage: () => undefined,
        state: "all",
        onState: () => undefined,
      }),
    ),
  );
  const empty = await vi.waitFor(() => {
    const found = emptyHost.querySelector("[data-yunari-library-empty]");
    if (found === null)
      throw new Error("the empty listing drew no empty state");
    return found;
  });
  const emptySaid = saidIn(empty);
  expect(emptySaid, "the empty state said nothing").not.toEqual([]);
  expect(emptySaid.filter((text) => !owned.has(text))).toEqual([]);

  await act(async () => emptyRoot.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** The listed theme's name, which a cell and the modal print as data. */
const LISTING_NAME = "Mira's wall";

/** The words a listing's own rows and cells say that are data, not copy. */
function isListingName(text: string): boolean {
  return text === LISTING_NAME;
}

/** A catalogue of one dashboard theme plus the host's empty listings, so the
 *  Library's two halves both answer. `entries` replaces the one-theme catalogue
 *  with the caller's rows — an empty list is how the walk reaches the empty
 *  state's own sentences. */
function listingServing(entries?: readonly unknown[]): typeof fetch {
  const theme = {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "dashboard-theme",
    name: LISTING_NAME,
    version: "1.0.0",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
    downloads: 0,
    favorites: 0,
    packageUrl: "https://store.test/theme.zip",
    thumbnail: "11111111-1111-4111-8111-111111111111/thumbnail.png",
    members: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        kind: "dashboard-theme",
        name: LISTING_NAME,
      },
    ],
    facets: FACETS,
  };
  const answer = (body: unknown): Response =>
    new Response(JSON.stringify(body), { status: 200 });
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/index.json")) {
      return answer({
        generatedAt: "2026-10-21T00:00:00.000Z",
        entries: entries ?? [theme],
      });
    }
    if (url.startsWith("/api/themes")) return answer({ themes: [] });
    if (url.startsWith("/api/store/origins")) return answer({ origins: [] });
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
}

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

/** The four portal-mounted surfaces, each mounted here. They portal to
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
    answer: {
      lan: true,
      address: "192.168.1.5",
      name: null,
      port: 4174,
      refusal: null,
    },
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
  "[data-yunari-theme-toolbar]",
  ".editor-shell-stage",
  ".editor-shell-rail",
  "[data-yunari-canvas-toolbar]",
  ".editor-shell-panel",
  '[data-yunari-settings-page="appearance"]',
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

/** The chooser's matched-ratio line — `Preview ratio: 16:9` — is the table's
 *  concept followed by the catalogue's own id, so it is owned by its prefix and
 *  the author's list. The offer's sentence (`Add 24:25 to preview ratios`) is
 *  not read here: the walk mounts the dialog on its opening size, which the
 *  default catalogue frames, so the offer is not drawn. */
function isPreviewRatioSentence(text: string): boolean {
  const prefix = uiCopy.newDocument.previewRatioMatched("");
  return text.startsWith(prefix) && isLensId(text.slice(prefix.length));
}

/** A preview row's Remove control is the copy word followed by the lens ids
 *  that token derives — `Remove preview ratio 16:9 9:16` — so the sentence is
 *  owned by its prefix and the author's ids, not by a literal in the page. */
function isPreviewRemoveLabel(text: string): boolean {
  const prefix = `${uiCopy.settings.previewRatioRemove} `;
  return (
    text.startsWith(prefix) &&
    text
      .slice(prefix.length)
      .split(" ")
      .every((token) => isLensId(token))
  );
}

/** A shortcut's action word is the reference table's. `SHORTCUT_LABELS` reuses
 *  `uiCopy`'s names and owns the five no menu prints (`Select all` and the four
 *  nudges), so the Keyboard tab names its rows from there and the copy table is
 *  not their owner. */
function isShortcutWord(text: string): boolean {
  return (Object.values(SHORTCUT_LABELS) as readonly string[]).includes(text);
}

/**
 * The publish trigger's tooltip is an owned word plus a live chord. Neither
 * half is a literal this table lacks, so the joined sentence is owned by its
 * parts; the chord is checked against the reference table's spoken labels rather
 * than accepted as free text.
 */
function isOwnedChordTooltip(text: string, owned: Set<string>): boolean {
  const match = /^(.+) \((.+)\)$/.exec(text);
  if (match === null) return false;
  return (
    owned.has(match[1] ?? "") &&
    PRODUCT_SHORTCUTS.some(
      (binding) => shortcutSpokenLabel(binding.action) === match[2],
    )
  );
}

/**
 * The shell's bridge, cut to what a mounted shell reaches.
 *
 * A walk that reads words mounts the shell whole, and the shell mounts the
 * composition pane, so the pane's reads are here too. It reports a selection
 * because the shell prints some of its chrome only then — a mount with no
 * selection at all reads less of it. Everything answers empty: this file reads
 * copy, not state.
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
    backgroundSelected: () => false,
    backgroundVideo: () => false,
    backgroundPlaying: () => false,
    setBackgroundPlaying: noop,
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
      downloadPackage: noop,
      exportTheme: noop,
      activate: noop,
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
 * because three of the strings this net exists to catch — the toolbar's name,
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
  // The walks mount the editor, which is no longer the URL-less default: a
  // session opens on Themes. The store case switches to its own mode.
  window.history.replaceState({}, "", "/?mode=editor");
  const layout = createShellLayout(shellRoot);
  layout.setBridge(selectionBridge(), undefined);

  /** The three editor-owned Settings pages, mounted together so the walk reads
   *  the surface the author reaches rather than a closed surface's chrome. The
   *  host pages are `region.dom.test.tsx`'s and are not part of this copy net. */
  const settingsHost = document.createElement("div");
  document.body.append(settingsHost);
  const settingsRoot = createRoot(settingsHost);
  await act(async () => {
    settingsRoot.render(
      createElement(
        Fragment,
        null,
        createElement(AppearancePage, {
          storage: undefined,
          palette: DEFAULT_SHELL_PALETTE,
          following: true,
          onPalette: () => undefined,
          onFollowing: () => undefined,
        }),
        createElement(KeyboardPage, {
          storage: undefined,
          overrides: {},
          onOverrides: () => undefined,
        }),
        createElement(AboutPage, { releaseVersion: undefined }),
      ),
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
        historyManager: {
          attachEnvelope: () => {},
          saveState: () => undefined,
        },
        errorManager: { warn: () => undefined, error: () => undefined },
        cropManager: { active: false, target: undefined },
        artboard: () => ({ width: 1920, height: 1080 }),
      } as never,
      globals: {
        palette: {
          ink: { name: "Ink", value: { kind: "solid", color: "#ffffff" } },
        },
        typeTokens: {
          body: { name: "Body", value: { family: "Inter", size: 16 } },
        },
      } as never,
      nodeBindings: () => [{ id: "clock-time", semanticKey: "date.today" }],
      refreshGlass: () => undefined,
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
