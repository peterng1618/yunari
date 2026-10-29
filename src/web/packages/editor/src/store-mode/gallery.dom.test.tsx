// @vitest-environment jsdom
/**
 * The gallery's cells: what one cell draws, and what its actions report.
 *
 * **What this file owns.** The plan's own case — a theme with no picture is
 * filled from its own artboard rather than left empty — plus the claims the
 * brief's rulings add: the picture a theme does not have is dropped rather than
 * left broken and a replaced address draws again, the two actions a build runs
 * travel through the one `onAction` callback while the two it does not are drawn
 * disabled and say why (R164), and the byline is the drawing's.
 *
 * **What it deliberately does not measure.** jsdom lays nothing out, so the
 * grid's `272px` minimum and the picture's `2/1` are declarations read off the
 * class list rather than a reflow; the drawing fixes them and DESIGN.md's Layout
 * section carries the minimum. Nothing mounts this gallery until A.6 wires it
 * into the region, so there is no page to inspect in a browser and no browser
 * case here.
 */
import type { FabricThemeEnvelope } from "@yunari/renderer-core";
import { DASHBOARD_THEME_KIND, facetRecordOf } from "@yunari/renderer-core";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type { ThemeOrigin } from "../theme-library-client.js";
import { uiCopy } from "../ui-copy.js";
import { Gallery } from "./gallery.js";
import type { InstallControl } from "./install-item.js";
import { installStateOf } from "./install-state.js";
import type { CatalogueFacts, StoreItem } from "./local-source.js";

// Base UI's tooltip needs three browser APIs jsdom has none of: floating-ui
// observes its anchor, the popup waits for its own open transition, and it asks
// the selector engine for `:modal`/`:popover-open`, which jsdom parses slowly
// enough to dominate the file. Each test file that mounts a control supplies its
// own — there is no shared harness for it here.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as never;
Element.prototype.getAnimations ??= (): never[] => [];
window.PointerEvent ??= MouseEvent as never;

// React only flushes work scheduled inside `act` when it has been told it is in
// a test; without this, `act` warns and the update lands after the assertion.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  const mounted = root;
  root = undefined;
  host?.remove();
  host = undefined;
  if (mounted !== undefined) act(() => mounted.unmount());
});

async function mount(element: ReactElement): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  host = container;
  await act(async () => {
    mounted.render(element);
  });
  return container;
}

/** Render again into the mount, which is how a listing refresh reaches a cell
 *  that is already on screen. */
async function rerender(element: ReactElement): Promise<void> {
  const mounted = root;
  if (mounted === undefined) throw new Error("nothing is mounted");
  await act(async () => {
    mounted.render(element);
  });
}

/** A missing element is a defect this file names, rather than a `null` a later
 *  assertion reports as a wrong value. */
function must<T extends Element>(found: T | null, what: string): T {
  if (found === null) throw new Error(`the gallery drew no ${what}`);
  return found;
}

/** What the eye reads: the node's text with every `sr-only` noun removed. */
function visibleText(node: Element): string {
  const copy = node.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll(".sr-only")) hidden.remove();
  return copy.textContent?.trim() ?? "";
}

/** The reading a screen reader hears: the node's whole text, whitespace runs
 *  collapsed, so a missing figure–noun space cannot be trimmed away. */
function spokenText(node: Element): string {
  return (node.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The document an item describes, so the fixture's record is the derivation the
 * host would emit rather than a descriptor invented here — the trap A.4a's
 * review found in the e2e stub, where a hand-written `{label: "CPU", family:
 * "system"}` named a descriptor `describeSemanticKey` never produces.
 */
const DOCUMENT: FabricThemeEnvelope = {
  schemaVersion: "2.0.0",
  fabricVersion: "7.4.0",
  id: "living-room",
  artboard: { width: 1920, height: 1080 },
  metadata: { name: "Living room", themeLanguage: "en", author: "mira-k" },
  scene: { version: "7.4.0", objects: [] },
  bindings: { "cpu-label": [{ id: "cpu", semanticKey: "cpu.load" }] },
};

/** One item as the source hands it: a named theme with a stored picture and a
 *  ground. `midnightblue` rather than a hex, because a fixture in a gated file
 *  carries a colour *name* or a token value and never a literal. */
function item(overrides: Partial<StoreItem> = {}): StoreItem {
  return {
    id: "living-room",
    kind: DASHBOARD_THEME_KIND,
    name: "Living room",
    author: "mira-k",
    version: "1.4.0",
    updatedAt: "2026-10-15T09:31:00.000Z",
    thumbnailUrl: "/api/themes/living-room/thumbnail",
    ground: "midnightblue",
    origin: undefined,
    catalogue: undefined,
    facets: facetRecordOf(DOCUMENT),
    ...overrides,
  };
}

/** Where a theme came from, as the host records it: the catalogue item and the
 *  version this copy was installed from. */
const ORIGIN: ThemeOrigin = {
  catalogueId: "yunari/office-wall",
  version: "1.3.0",
  installedAt: "2026-10-14T00:00:00.000Z",
};

/** The catalogue's own facts about an item, with the one field the join fills
 *  left to each case: what this PC has installed. */
function catalogue(overrides: Partial<CatalogueFacts> = {}): CatalogueFacts {
  return {
    id: "living-room",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-15T09:31:00.000Z",
    downloads: 1204,
    favorites: 12,
    packageUrl: "https://example.invalid/living-room.vtheme",
    installedVersion: undefined,
    ...overrides,
  };
}

/** The install control a gallery mount that is not about installing hands
 *  down: nothing in flight and no refusal to draw. */
const NO_INSTALL: InstallControl = {
  onInstall: () => undefined,
  installingIds: new Set(),
  refusal: undefined,
};

/** The cell's picture box, which every case here reads through. */
function pictureBox(container: HTMLElement): HTMLElement {
  return must(
    container.querySelector<HTMLElement>("[data-yunari-store-picture]"),
    "picture box",
  );
}

/**
 * The cell's picture box, filled from the theme's own artboard.
 *
 * A theme the host has stored no picture for is answered by a `404` at the
 * thumbnail address, so the box cannot be left to the image: it carries the
 * ground the source resolved, and the image is what is optional.
 */
it("draws the theme's own ground when it has no thumbnail", async () => {
  const container = await mount(
    <Gallery
      items={[item({ thumbnailUrl: undefined })]}
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={NO_INSTALL}
    />,
  );

  const box = pictureBox(container);
  expect(
    box.querySelector("img"),
    "the cell drew a picture for a theme that has none",
  ).toBeNull();
  expect(
    box.style.background,
    "the cell left the box empty instead of drawing the theme's ground",
  ).toBe("midnightblue");
});

/**
 * The picture a theme does not have is **dropped**, not left showing a broken
 * mark: the box already carries the ground, so the image that fails is removed
 * and what is behind it is what the author sees.
 */
it("drops the picture a theme does not have, leaving its ground", async () => {
  const container = await mount(
    <Gallery
      items={[item()]}
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={NO_INSTALL}
    />,
  );
  const box = pictureBox(container);
  const picture = must(box.querySelector("img"), "picture");

  await act(async () => {
    picture.dispatchEvent(new Event("error"));
  });

  expect(
    box.querySelector("img"),
    "the cell kept the picture the host does not have",
  ).toBeNull();
  expect(box.style.background).toBe("midnightblue");
});

/**
 * What failed is the **address**, not the box: a cell whose picture is replaced
 * draws the new one. A latched flag would leave the neutral box on screen for as
 * long as the cell is mounted, however good the picture that arrived afterwards.
 */
it("draws a picture again when the address changes after a failure", async () => {
  const container = await mount(
    <Gallery
      items={[item()]}
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={NO_INSTALL}
    />,
  );
  const box = pictureBox(container);

  await act(async () => {
    must(box.querySelector("img"), "picture").dispatchEvent(new Event("error"));
  });
  expect(box.querySelector("img")).toBeNull();

  await rerender(
    <Gallery
      items={[item({ thumbnailUrl: "/api/themes/living-room/thumbnail-2" })]}
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={NO_INSTALL}
    />,
  );

  expect(
    must(box.querySelector("img"), "picture").getAttribute("src"),
    "the cell kept drawing the box the old address left behind",
  ).toBe("/api/themes/living-room/thumbnail-2");
});

/**
 * A save is what gives a theme its picture, and the address does not move when
 * one happens: the host builds it from the theme's id. So the failed state is
 * keyed by the theme's own time as well — the same address with a new
 * `updatedAt` asks again, and a re-listing that changed nothing does not.
 */
it("asks for the picture again only when the theme itself changed", async () => {
  const container = await mount(
    <Gallery
      items={[item()]}
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={NO_INSTALL}
    />,
  );
  const box = pictureBox(container);

  await act(async () => {
    must(box.querySelector("img"), "picture").dispatchEvent(new Event("error"));
  });
  expect(box.querySelector("img")).toBeNull();

  // Same address and same time, with a change the cell does draw — so this is a
  // real re-render rather than one React skipped, and the picture stays dropped.
  await rerender(
    <Gallery
      items={[item({ name: "Living room (renamed)" })]}
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={NO_INSTALL}
    />,
  );
  expect(
    must(
      container.querySelector<HTMLElement>("[data-yunari-store-cell-name]"),
      "cell name",
    ).textContent,
    "the cell did not re-render, so the case below proves nothing",
  ).toBe("Living room (renamed)");
  expect(
    box.querySelector("img"),
    "the cell asked again for a picture nothing had changed",
  ).toBeNull();

  await rerender(
    <Gallery
      items={[item({ updatedAt: "2026-10-16T11:02:00.000Z" })]}
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={NO_INSTALL}
    />,
  );

  expect(
    must(box.querySelector("img"), "picture").getAttribute("src"),
    "the cell kept hiding the picture a save had stored",
  ).toBe("/api/themes/living-room/thumbnail");
});

/**
 * The four actions are drawn, the two a build runs report through the one
 * callback, and **the two it does not run are not actionable** (R164).
 *
 * The drawing gives every cell four actions, so all four stay drawn; the two no
 * phase owns are disabled and state why, because a control that looks live and
 * answers a press with nothing is the defect the ruling answers. The cell draws
 * four, so `onAction` carries which one as well as which item — the plan's
 * `onOpen(id)` could not express the other three, and four separate props would
 * be four a caller can half-wire.
 *
 * **Every button is read through `must`**, so a locator that matched nothing
 * fails rather than passing by absence, and the two that run are pressed in the
 * same pass: the disabled pair's silence is then a reading rather than a harness
 * that never fired.
 */
it("draws its four actions, runs the two it has and disables the two it has not", async () => {
  const onAction = vi.fn();
  const container = await mount(
    <Gallery
      items={[item()]}
      onAction={onAction}
      onOpenItem={() => undefined}
      install={NO_INSTALL}
    />,
  );

  /** One of the cell's four actions, or a failure naming which is missing. */
  function actionButton(action: string): HTMLButtonElement {
    return must(
      container.querySelector<HTMLButtonElement>(
        `[data-yunari-store-cell-action="${action}"]`,
      ),
      `${action} action`,
    );
  }

  const actions = ["open", "assign", "export", "delete"] as const;
  const buttons = actions.map(actionButton);
  expect(
    buttons.map((button) => button.getAttribute("aria-label")),
    "the cell does not name its four actions in the drawing's order",
  ).toEqual([
    uiCopy.store.cell.actions.open,
    uiCopy.store.cell.actions.assign,
    uiCopy.store.cell.actions.export,
    uiCopy.store.cell.actions.delete,
  ]);

  for (const button of buttons) {
    await act(async () => button.click());
  }

  expect(
    onAction.mock.calls,
    "the two actions this build runs did not both report, so the disabled pair's silence would prove nothing",
  ).toEqual([
    ["open", "living-room"],
    ["assign", "living-room"],
  ]);

  // The pair that does not run. `disabled` is what makes a button unpressable,
  // so it is read off the control rather than inferred from a click that
  // changed nothing — and the reason is a node in the tree, not a tooltip a
  // person without a pointer cannot reach.
  for (const action of ["export", "delete"] as const) {
    const button = actionButton(action);
    expect(button.disabled, `${action} is drawn live`).toBe(true);
    const describedBy = button.getAttribute("aria-describedby") ?? "";
    expect(describedBy, `${action} states no reason`).not.toBe("");
    expect(
      must(
        container.querySelector<HTMLElement>(`#${describedBy}`),
        `${action}'s reason`,
      ).textContent,
      `${action}'s reason is not the copy table's`,
    ).toBe(uiCopy.store.cell.unavailable);
  }
});

/**
 * **The cell's own surface is what opens the item's**, and it is not one of the
 * four actions: the drawing's facts band draws those, and `open` among them
 * names the library operation its own label prints (spec, "The item's own
 * surface": *so a cell opens a modal*).
 *
 * It is a button rather than a handler on the `li`, because a cell a person can
 * only reach with a mouse is a control the keyboard cannot use (§5's keyboard
 * section), and a click on one of the four actions must not also open the item.
 */
it("opens the item from the cell's own surface rather than from an action", async () => {
  const onAction = vi.fn();
  const onOpenItem = vi.fn();
  const container = await mount(
    <Gallery
      items={[item()]}
      onAction={onAction}
      onOpenItem={onOpenItem}
      install={NO_INSTALL}
    />,
  );

  const surface = must(
    container.querySelector<HTMLButtonElement>(
      "[data-yunari-store-cell-surface]",
    ),
    "cell surface",
  );
  expect(
    surface.tagName,
    "the cell's own surface is not a control a keyboard can reach",
  ).toBe("BUTTON");

  await act(async () => surface.click());

  expect(
    onOpenItem.mock.calls,
    "the cell's own surface did not open the item",
  ).toEqual([["living-room"]]);
  expect(
    onAction,
    "the cell's own surface ran one of the four actions as well",
  ).not.toHaveBeenCalled();
});

/**
 * The byline is the drawing's mono line: the author with the `@`, the date, and
 * *No author* where the document declares none — a fact about the theme rather
 * than a missing reading.
 */
it("writes the byline the drawing draws, and says so when there is no author", async () => {
  const container = await mount(
    <Gallery
      items={[
        item(),
        item({
          id: "workshop-bench",
          name: "Workshop bench",
          author: undefined,
        }),
      ]}
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={NO_INSTALL}
    />,
  );

  const bylines = Array.from(
    container.querySelectorAll<HTMLElement>("[data-yunari-store-cell-byline]"),
    (byline) => byline.textContent,
  );
  expect(bylines).toEqual([
    "@mira-k · 2026-10-15",
    `${uiCopy.store.cell.noAuthor} · 2026-10-15`,
  ]);
});

/**
 * **The badge says where the theme came from**, and it is drawn only where the
 * host holds a record (spec, "Provenance"). The two cells are mounted together,
 * so the badge's absence on the second is a reading of that cell rather than a
 * case that never drew anything — a cell badging every theme, or one badging
 * none, fails here either way.
 *
 * **The query is scoped to the facts band**, because the band is the drawing's
 * whole reason for the badge's position: beside the name it would make this
 * half's cells taller than the online half's, and the cell is one cell shared by
 * both halves. A badge that merely exists somewhere in the cell is not the
 * drawing's badge.
 *
 * **The word is the local half's own**, *From the store*, and not the online
 * half's *Installed*: `uiCopy.store.fromStore` carries why.
 */
it("badges the cell whose theme came from the store, and leaves the other unbadged", async () => {
  const container = await mount(
    <Gallery
      items={[
        item({ origin: ORIGIN }),
        item({ id: "workshop-bench", name: "Workshop bench" }),
      ]}
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={NO_INSTALL}
    />,
  );

  /** One cell's facts band, which is where the drawing puts the badge. */
  function band(id: string): HTMLElement {
    return must(
      container.querySelector<HTMLElement>(
        `[data-yunari-store-cell="${id}"] [data-yunari-store-cell-band]`,
      ),
      `${id}'s facts band`,
    );
  }

  /** One cell's badge, or the `null` that says it drew none. */
  function badge(id: string): HTMLElement | null {
    return band(id).querySelector<HTMLElement>(
      "[data-yunari-store-cell-origin]",
    );
  }

  expect(
    must(badge("living-room"), "origin badge").textContent,
    "the badge is not the copy table's word for where a theme came from",
  ).toBe(uiCopy.store.fromStore);
  expect(
    badge("workshop-bench"),
    "the cell badged a theme the host has no origin for",
  ).toBeNull();
});

/**
 * **The online half's left slot is the drawing's, in the same band**: the kind
 * badge and the download count. The count is pinned as the
 * literal `1,204` because the thousands separator is the assertion — a bare
 * `1204` would pass on any locale and is what the red proof breaks — and the
 * badge as the drawing's `Theme`, which is also the copy case's value.
 *
 * The second cell is mounted in the same pass, so the absence of both is a
 * reading of that cell rather than a case that never drew anything: an item
 * without catalogue facts is a library item, and its left slot is the origin
 * pill's.
 */
it("draws the kind badge and the download count for an online item, and neither for a library item", async () => {
  const container = await mount(
    <Gallery
      items={[
        // A populated origin on the online item, so the absence below is the
        // guard's doing rather than a fixture that could never draw the pill.
        item({ catalogue: catalogue(), origin: ORIGIN }),
        item({ id: "workshop-bench", name: "Workshop bench" }),
      ]}
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={NO_INSTALL}
    />,
  );

  function band(id: string): HTMLElement {
    return must(
      container.querySelector<HTMLElement>(
        `[data-yunari-store-cell="${id}"] [data-yunari-store-cell-band]`,
      ),
      `${id}'s facts band`,
    );
  }

  expect(
    must(
      band("living-room").querySelector<HTMLElement>(
        "[data-yunari-store-cell-kind]",
      ),
      "kind badge",
    ).textContent,
    "the badge is not the drawing's word for the kind",
  ).toBe("Theme");
  const downloads = must(
    band("living-room").querySelector<HTMLElement>(
      "[data-yunari-store-cell-downloads]",
    ),
    "download count",
  );
  expect(
    visibleText(downloads),
    "the count is not the drawing's thousand-separated reading",
  ).toBe("1,204");
  // The figure is visible and its noun is read — see `uiCopy.store.counts` —
  // so the composed reading is figure, one space, noun.
  expect(
    spokenText(downloads),
    "the reading a screen reader hears is not the figure, a space, and its noun",
  ).toBe(`1,204 ${uiCopy.store.counts.downloads(1204)}`);
  expect(
    must(
      band("living-room").querySelector<HTMLElement>(
        "[data-yunari-store-cell-downloads] span.text-faint",
      ),
      "the count's faint glyph",
    ).textContent,
    "the count's number, not its glyph, wears the faint colour",
  ).toBe("");
  expect(
    band("living-room").querySelector("[data-yunari-store-cell-origin]"),
    "the online cell drew the local half's origin pill as well",
  ).toBeNull();

  expect(
    band("workshop-bench").querySelector("[data-yunari-store-cell-kind]"),
    "the library cell drew a catalogue kind",
  ).toBeNull();
  expect(
    band("workshop-bench").querySelector("[data-yunari-store-cell-downloads]"),
    "the library cell drew a catalogue count",
  ).toBeNull();
});

/**
 * **A kind this build does not know prints its identifier** — the spec's rule
 * for a client older than the kind, and the only case that proves the badge
 * falls through to the wire value instead of naming `Theme` for every kind.
 */
it("prints the identifier of a kind this build does not know", async () => {
  const container = await mount(
    <Gallery
      items={[
        item({
          id: "widget-preset",
          kind: "widget-preset",
          catalogue: catalogue(),
        }),
      ]}
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={NO_INSTALL}
    />,
  );

  expect(
    must(
      container.querySelector<HTMLElement>("[data-yunari-store-cell-kind]"),
      "kind badge",
    ).textContent,
    "an unknown kind was not printed as its own identifier",
  ).toBe("widget-preset");
});

/**
 * **One owner of the decision**, and the cases the spec's word *newer* makes.
 *
 * Update is offered only when the catalogue outranks the copy, so a held-newer
 * copy and a pair this file cannot order both read *Installed*: the press
 * overwrites with no undo and must not rest on a comparison that is not there.
 */
it("decides the install state from the catalogue and the item", () => {
  const cases: readonly {
    readonly name: string;
    readonly item: StoreItem;
    readonly state: ReturnType<typeof installStateOf>;
  }[] = [
    { name: "a library item", item: item(), state: "none" },
    {
      name: "the same version installed",
      item: item({ catalogue: catalogue({ installedVersion: "1.4.0" }) }),
      state: "installed",
    },
    {
      name: "an older version installed",
      item: item({ catalogue: catalogue({ installedVersion: "1.3.0" }) }),
      state: "update",
    },
    {
      name: "a numeric order, not a string one",
      item: item({
        version: "1.10.0",
        catalogue: catalogue({ installedVersion: "1.9.0" }),
      }),
      state: "update",
    },
    {
      name: "a held-newer copy",
      item: item({
        version: "1.3.0",
        catalogue: catalogue({ installedVersion: "1.4.0" }),
      }),
      state: "installed",
    },
    {
      name: "a prerelease of the installed version",
      item: item({
        version: "1.4.0",
        catalogue: catalogue({ installedVersion: "1.4.0-beta" }),
      }),
      state: "installed",
    },
    {
      name: "nothing installed",
      item: item({ catalogue: catalogue() }),
      state: "install",
    },
    {
      name: "installed at a version the item does not report",
      item: item({
        version: undefined,
        catalogue: catalogue({ installedVersion: "1.4.0" }),
      }),
      state: "installed",
    },
    {
      name: "versions this file cannot order",
      item: item({
        version: "nightly",
        catalogue: catalogue({ installedVersion: "1.4.0" }),
      }),
      state: "installed",
    },
  ];

  for (const { name, item: sample, state } of cases) {
    expect(installStateOf(sample), name).toBe(state);
  }
});

/**
 * **The installed state is a mark, not a control**: a check in `--accent` beside
 * the word in `--muted`, with no button, because there is nothing to do. A
 * disabled button here would be a control drawn where the drawing draws none.
 */
it("marks an installed online item without drawing a control", async () => {
  const container = await mount(
    <Gallery
      items={[item({ catalogue: catalogue({ installedVersion: "1.4.0" }) })]}
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={NO_INSTALL}
    />,
  );

  const mark = must(
    container.querySelector<HTMLElement>(
      '[data-yunari-store-cell-install="installed"]',
    ),
    "installed mark",
  );
  expect(mark.tagName, "the installed state is drawn as a control").toBe(
    "SPAN",
  );
  expect(
    mark.textContent,
    "the mark is not the drawing's word for an installed item",
  ).toBe(uiCopy.store.cell.installStates.installed);
  expect(
    mark.className,
    "the mark's word is not drawn in the drawing's muted colour",
  ).toContain("text-muted");
  expect(
    must(
      mark.querySelector<HTMLElement>("span.text-accent"),
      "the check's accent colour",
    ).textContent,
    "the accent is not on the check alone",
  ).toBe("");
  expect(
    mark.querySelector("button"),
    "the installed state drew a button it has no action for",
  ).toBeNull();
});

/**
 * **Install and Update are controls that report a press** — phase D owns the
 * install, so the cell hands the item up rather than deciding anything here.
 *
 * The three states are read together: `installed` is the mark the drawing draws
 * and reports nothing, and the other two carry the drawing's words and reach
 * `onInstall` with the item whose control was pressed.
 */
it("reports a press on Install and Update, and draws no control for an installed item", async () => {
  const onInstall = vi.fn();
  const container = await mount(
    <Gallery
      items={[
        item({ catalogue: catalogue() }),
        item({
          id: "office-wall",
          name: "Office wall",
          catalogue: catalogue({ installedVersion: "1.3.0" }),
        }),
        item({
          id: "living-room-2",
          name: "Living room 2",
          catalogue: catalogue({ installedVersion: "1.4.0" }),
        }),
      ]}
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={{ ...NO_INSTALL, onInstall }}
    />,
  );

  const expected = [
    { id: "living-room", state: "install" },
    { id: "office-wall", state: "update" },
  ] as const;

  for (const { id, state } of expected) {
    const button = must(
      container.querySelector<HTMLButtonElement>(
        `[data-yunari-store-cell="${id}"] [data-yunari-store-cell-install="${state}"]`,
      ),
      `${state} action`,
    );
    expect(button.tagName, `${state} is not a control`).toBe("BUTTON");
    expect(button.textContent, `${state} is not the drawing's word`).toBe(
      uiCopy.store.cell.installStates[state],
    );
    expect(button.disabled, `${state} is drawn live`).toBe(false);
    await act(async () => button.click());
  }

  expect(
    onInstall.mock.calls.map(([pressed]) => pressed.id),
    "the two controls did not report the item that was pressed",
  ).toEqual(["living-room", "office-wall"]);

  expect(
    container.querySelector('[data-yunari-store-cell-install="installed"]'),
    "the installed item draws no mark",
  ).not.toBeNull();
  expect(
    container.querySelector(
      '[data-yunari-store-cell="living-room-2"] button[data-yunari-store-cell-install]',
    ),
    "an installed item drew an install control it has no action for",
  ).toBeNull();
});

/**
 * **A Mine row carries its state as a word after its name**, and the word is
 * the signal rather than a colour (§5). `pending` is drawn here; `published`
 * draws none, because on the public surface being listed *is* the state.
 *
 * The band is read in the same case: a state is a fact about the author's own
 * row, not a fifth reading in the facts band, so the install decision is drawn
 * exactly as it is for any other online item.
 */
it("badges a Mine cell's state after its name without changing its actions", async () => {
  const container = await mount(
    <Gallery
      items={[item({ catalogue: catalogue(), status: "pending" })]}
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={NO_INSTALL}
    />,
  );

  const badge = must(
    container.querySelector<HTMLElement>("[data-yunari-store-status]"),
    "status badge",
  );
  expect(
    badge.getAttribute("data-yunari-store-status"),
    "the badge does not name the state it draws",
  ).toBe("pending");
  expect(
    badge.textContent,
    "the badge does not carry the copy's own word",
  ).toBe(uiCopy.store.status.pending);
  expect(
    must(
      container.querySelector<HTMLElement>("[data-yunari-store-cell-name]"),
      "cell name",
    ).nextElementSibling,
    "the badge is not the element after the name",
  ).toBe(badge);

  const install = must(
    container.querySelector<HTMLButtonElement>(
      "[data-yunari-store-cell-install]",
    ),
    "install control",
  );
  expect(
    install.textContent,
    "the status changed the band's public action",
  ).toBe(uiCopy.store.cell.installStates.install);
});

/**
 * **A published Mine row draws no badge**: the public listing is the badge, and
 * repeating it beside the author's own name would say the same fact twice.
 */
it("draws no badge for a published item", async () => {
  const container = await mount(
    <Gallery
      items={[item({ catalogue: catalogue(), status: "published" })]}
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={NO_INSTALL}
    />,
  );

  expect(
    container.querySelector("[data-yunari-store-status]"),
    "a published item drew a state badge",
  ).toBeNull();
});
