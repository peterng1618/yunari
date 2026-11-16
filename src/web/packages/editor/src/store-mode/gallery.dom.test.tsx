// @vitest-environment jsdom
/**
 * The gallery's cells: what one cell draws, and what its actions report.
 *
 * **What this file owns.** The plan's own case — a theme with no picture is
 * filled from its own artboard rather than left empty — plus the claims the
 * brief's rulings add: the picture a theme does not have is dropped rather than
 * left broken and a replaced address draws again, the four actions travel
 * through the one `onAction` callback, publishing is offered only on a theme
 * with no store record, and the byline is fixed.
 *
 * **What it deliberately does not measure.** jsdom lays nothing out, so the
 * row's flush edges and the density's effect on card size are declarations read
 * off the style lists rather than a reflow; the layout fixes them and DESIGN.md's
 * Layout section carries the rule. The browser case that measures the packing is
 * `tests/e2e/editor-rail.spec.ts`.
 */
import type {
  CatalogueOrigin,
  FabricThemeEnvelope,
} from "@yunari/renderer-core";
import { DASHBOARD_THEME_KIND, facetRecordOf } from "@yunari/renderer-core";
import { act, type ReactElement, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type { StoreCard } from "../library-mode/cards.js";
import { uiCopy } from "../ui-copy.js";
import { Gallery } from "./gallery.js";
import type { InstallControl } from "./install-item.js";
import { installStateOf } from "./install-state.js";
import type { CatalogueFacts, ItemSource, StoreItem } from "./local-source.js";
import { useInstall } from "./use-install.js";
import type { SubmitControl } from "./use-submit.js";

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
  vi.unstubAllGlobals();
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
  schemaVersion: "3.0.0",
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
    members: [
      { id: "living-room", kind: DASHBOARD_THEME_KIND, name: "Living room" },
    ],
    facets: facetRecordOf(DOCUMENT),
    ...overrides,
  };
}

/** Where a theme came from, as the host records it: the catalogue item and the
 *  version this copy was installed from. */
const ORIGIN: CatalogueOrigin = {
  kind: DASHBOARD_THEME_KIND,
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
  held: undefined,
  onApproveUpdate: () => undefined,
  onDismissUpdate: () => undefined,
};

/** The submission control a gallery mount that is not about publishing hands
 *  down: idle, and belonging to no item. */
const NO_SUBMIT: SubmitControl = {
  onSubmit: () => undefined,
  itemId: undefined,
  state: "idle",
  inFlight: false,
  url: undefined,
  version: undefined,
  refusal: undefined,
  status: undefined,
};

/** The cell's picture box, which every case here reads through. */
function pictureBox(container: HTMLElement): HTMLElement {
  return must(
    container.querySelector<HTMLElement>("[data-yunari-store-picture]"),
    "picture box",
  );
}

/** jsdom lays nothing out and reports every `clientWidth` as 0, so a case that
 *  reads the gallery's measurement supplies one for the mount. */
async function withClientWidth<T>(
  width: number,
  run: () => Promise<T>,
): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth",
  );
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => width,
  });
  try {
    return await run();
  } finally {
    if (descriptor === undefined) {
      Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
    } else {
      Object.defineProperty(HTMLElement.prototype, "clientWidth", descriptor);
    }
  }
}

/**
 * The card contains the theme's picture rather than cropping it. A theme whose
 * ratio is not the band's must show whole: a card is the advertisement of a
 * theme, and one that crops it advertises a composition nobody drew.
 */
it("contains the theme's picture in the card's band", async () => {
  const container = await mount(
    <Gallery
      items={[item()]}
      onAction={() => undefined}
      onOpenItem={() => undefined}
      density="comfortable"
      install={NO_INSTALL}
    />,
  );

  const img = must(
    pictureBox(container).querySelector("img"),
    "the cell's picture",
  );
  expect(
    img.className,
    "the picture is cropped into the band instead of contained by it",
  ).toContain("object-contain");
});

/**
 * **A card's track weight is its own ratio.** The picture box carries that
 * ratio, and the row's tracks are weighted by it, so a portrait card is a
 * narrow track beside a landscape one instead of a square that reserves as much
 * area as any other card — and equal weights-per-ratio make the row's picture
 * heights agree.
 *
 * jsdom measures nothing, so the pane reports no width and the packing falls
 * back to one card per row at the density's target height.
 */
it("weights each card's track by its own ratio", async () => {
  const portrait = facetRecordOf({
    ...DOCUMENT,
    artboard: { width: 1080, height: 1920 },
  });
  const container = await mount(
    <Gallery
      items={[
        item(),
        item({
          id: "workshop-bench",
          name: "Workshop bench",
          facets: portrait,
        }),
      ]}
      onAction={() => undefined}
      onOpenItem={() => undefined}
      density="comfortable"
      install={NO_INSTALL}
    />,
  );

  const pictures = Array.from(
    container.querySelectorAll<HTMLElement>("[data-yunari-store-picture]"),
    (box) => Number.parseFloat(box.style.aspectRatio),
  );
  expect(pictures[0], "the landscape box is not 16:9").toBeCloseTo(16 / 9);
  expect(pictures[1], "the portrait box is not 9:16").toBeCloseTo(9 / 16);
  const rows = Array.from(
    container.querySelectorAll<HTMLElement>("[data-yunari-store-row]"),
  );
  expect(
    rows,
    "the no-width fallback did not give each card its own row",
  ).toHaveLength(2);
  expect(
    rows.map((row) => Number.parseFloat(row.style.gridTemplateColumns)),
    "a card's track is not weighted by its own ratio",
  ).toEqual(pictures);
});

/**
 * **A row is one grid of ratio-weighted tracks, not a wrap.** A wide theme gets
 * a wide track and the portrait theme beside it a narrow one; the tracks are
 * fractions of the row, so the row reaches both edges without the packing's
 * pixel arithmetic having to survive a resize.
 *
 * jsdom reports no width, so this case supplies the pane's measurement for the
 * mount. The packing's own arithmetic is proved in `justified-rows.test.ts`;
 * what this case adds is that the measured width reaches it.
 */
it("packs wide and portrait cards into one ratio-weighted row", async () => {
  const PANE = 1352;
  const container = await withClientWidth(PANE, () =>
    mount(
      <Gallery
        items={[
          item({
            facets: { ...facetRecordOf(DOCUMENT), width: 3840, height: 1080 },
          }),
          item({
            id: "portrait",
            facets: { ...facetRecordOf(DOCUMENT), width: 1080, height: 1920 },
          }),
        ]}
        density="roomy"
        onAction={() => undefined}
        onOpenItem={() => undefined}
        install={NO_INSTALL}
      />,
    ),
  );

  const cells = Array.from(
    container.querySelectorAll<HTMLElement>("[data-yunari-store-cell]"),
  );
  expect(cells, "the two cards did not pack into one row").toHaveLength(2);
  const row = must(
    container.querySelector<HTMLElement>("[data-yunari-store-row]"),
    "the row the packing gave the two cards",
  );
  expect(
    container.querySelectorAll("[data-yunari-store-row]"),
    "the cards did not share the one row the packing gave them",
  ).toHaveLength(1);
  const tracks = row.style.gridTemplateColumns
    .split(" ")
    .map((track) => Number.parseFloat(track));
  expect(tracks[0], "the wide theme's track is not its own ratio").toBeCloseTo(
    3840 / 1080,
  );
  expect(
    tracks[1],
    "the portrait theme's track is not its own ratio",
  ).toBeCloseTo(1080 / 1920);
  expect(
    row.style.maxWidth,
    "a full row carries a maximum width and cannot reach the far edge",
  ).toBe("");
});

/**
 * **A picture is fetched as it enters the scroller.** The grid mounts a whole
 * batch at once, and a `loading="lazy"` image lets the browser hold the ones
 * below the fold until the reader reaches them.
 */
it("loads each card's picture lazily", async () => {
  const container = await mount(
    <Gallery
      items={[item()]}
      density="comfortable"
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={NO_INSTALL}
    />,
  );

  expect(
    must(pictureBox(container).querySelector("img"), "picture").getAttribute(
      "loading",
    ),
  ).toBe("lazy");
});

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
      density="comfortable"
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
      density="comfortable"
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
      density="comfortable"
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
      density="comfortable"
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
      density="comfortable"
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
      density="comfortable"
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
      density="comfortable"
      install={NO_INSTALL}
    />,
  );

  expect(
    must(box.querySelector("img"), "picture").getAttribute("src"),
    "the cell kept hiding the picture a save had stored",
  ).toBe("/api/themes/living-room/thumbnail");
});

/**
 * The four actions are drawn, the three a build runs report through the one
 * callback, and **the one it does not run is not actionable** (R164).
 *
 * The surface gives every cell four actions, so all four stay drawn; Export
 * package has no phase and is disabled and states why, because a control that
 * looks live and answers a press with nothing is the defect the ruling answers.
 * The cell draws four, so `onAction` carries which one as well as which item —
 * the plan's `onOpen(id)` could not express the other three, and four separate
 * props would be four a caller can half-wire.
 *
 * **Every button is read through `must`**, so a locator that matched nothing
 * fails rather than passing by absence, and all four are pressed in the same
 * pass.
 */
it("draws its four actions and runs all four", async () => {
  const onAction = vi.fn();
  const container = await mount(
    <Gallery
      items={[item()]}
      onAction={onAction}
      onOpenItem={() => undefined}
      density="comfortable"
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

  const actions = ["assign", "open", "export", "delete"] as const;
  const buttons = actions.map(actionButton);
  expect(
    buttons.map((button) => button.getAttribute("aria-label")),
    "the cell does not name its four actions in the order",
  ).toEqual([
    uiCopy.store.cell.actions.assign,
    uiCopy.store.cell.actions.open,
    uiCopy.store.cell.actions.export,
    uiCopy.store.cell.actions.delete,
  ]);

  for (const button of buttons) {
    await act(async () => button.click());
  }

  expect(
    onAction.mock.calls.map(([action, card]) => [
      action,
      (card as { readonly listing: { readonly id: string } }).listing.id,
    ]),
    "the four actions did not all report",
  ).toEqual([
    ["assign", "living-room"],
    ["open", "living-room"],
    ["export", "living-room"],
    ["delete", "living-room"],
  ]);
});

/**
 * **Opening a one-member listing opens at that member.** The card a person
 * presses carries the member, so a widget pack with one widget opens the
 * widget's detail rather than the package's.
 */
it("opens a one-member listing as that member", async () => {
  const opened: StoreCard[] = [];
  const widget = item({
    id: "solo-widget",
    kind: "widget-pack",
    name: "Solo widget",
    members: [{ id: "cpu", kind: "widget", name: "CPU gauge" }],
  });
  const container = await mount(
    <Gallery
      items={[widget]}
      onAction={() => undefined}
      onOpenItem={(card) => opened.push(card)}
      density="comfortable"
      install={NO_INSTALL}
    />,
  );
  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-store-cell-name-press]",
      ),
      "name press",
    ).click(),
  );

  expect(opened, "the name press did not open the item").toHaveLength(1);
  expect(opened[0]?.listing.id, "the press does not name the package").toBe(
    "solo-widget",
  );
  expect(
    opened[0]?.member?.id,
    "the press dropped the member the card draws",
  ).toBe("cpu");
});

/**
 * **Publishing is offered only where there is nothing in the store yet.** A
 * theme the host holds no origin record of was made here, so the press belongs
 * to its cell; an installed copy already came from the catalogue and has no
 * publish control. The press reports the item, which is what the region's
 * submission flow acts on.
 */
it("offers publish on a local-only theme and not on one from the store", async () => {
  const onSubmit = vi.fn();
  const container = await mount(
    <Gallery
      items={[
        item({ id: "made-here" }),
        item({ id: "installed", origin: ORIGIN }),
      ]}
      onAction={() => undefined}
      onOpenItem={() => undefined}
      density="comfortable"
      install={NO_INSTALL}
      submit={{ ...NO_SUBMIT, onSubmit }}
    />,
  );

  const publish = container.querySelectorAll<HTMLButtonElement>(
    '[data-yunari-store-cell-action="publish"]',
  );
  expect(
    publish,
    "publish is not offered on exactly the local-only cell",
  ).toHaveLength(1);
  expect(
    must(
      publish[0]?.closest("[data-yunari-store-cell]") as HTMLElement | null,
      "the cell holding the publish control",
    ).getAttribute("data-yunari-store-cell"),
    "publish was offered on the installed copy",
  ).toBe("made-here");

  // The card's order: Assign, Edit, Publish, Export, Delete — and the
  // installed copy draws the same four without the author's extra.
  const order = (id: string): (string | null)[] =>
    [
      ...(container
        .querySelector<HTMLElement>(`[data-yunari-store-cell="${id}"]`)
        ?.querySelectorAll("[data-yunari-store-cell-action]") ?? []),
    ].map((control) => control.getAttribute("data-yunari-store-cell-action"));
  expect(order("made-here"), "publish is not between Edit and Export").toEqual([
    "assign",
    "open",
    "publish",
    "export",
    "delete",
  ]);
  expect(order("installed")).toEqual(["assign", "open", "export", "delete"]);

  await act(async () => publish[0]?.click());
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ id: "made-here" }),
  );
});

/**
 * **The cell's own surface is what opens the item's**, and it is not one of the
 * four actions: the facts band draws those, and `open` among them
 * names the library operation its own label prints.
 *
 * It is a button rather than a handler on the `li`, because a cell a person can
 * only reach with a mouse is a control the keyboard cannot use (the keyboard
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
      density="comfortable"
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
    onOpenItem.mock.calls.map(([card]) => [
      (card as StoreCard).listing.id,
      (card as StoreCard).member?.id,
    ]),
    "the cell's own surface did not open the item and its member",
  ).toEqual([["living-room", "living-room"]]);
  expect(
    onAction,
    "the cell's own surface ran one of the four actions as well",
  ).not.toHaveBeenCalled();
});

/**
 * The card's name row keeps the updated day at its right; the author moves to
 * the hover chip, where it is `© name`, or the no-author word where the document
 * declares none — a fact about the theme rather than a missing reading.
 */
it("keeps the updated date in the name row and the author in the hover chip", async () => {
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
      density="comfortable"
      install={NO_INSTALL}
    />,
  );

  const bylines = Array.from(
    container.querySelectorAll<HTMLElement>("[data-yunari-store-cell-byline]"),
    (byline) => byline.textContent,
  );
  expect(bylines).toEqual(["2026-10-15", "2026-10-15"]);
  const authors = Array.from(
    container.querySelectorAll<HTMLElement>("[data-yunari-store-cell-author]"),
    (chip) => chip.textContent,
  );
  expect(authors).toEqual(["© mira-k", uiCopy.store.cell.noAuthor]);
});

/**
 * **The badge says where the theme came from**, and it is drawn only where the
 * host holds a record. The two cells are mounted together,
 * so the badge's absence on the second is a reading of that cell rather than a
 * case that never drew anything — a cell badging every theme, or one badging
 * none, fails here either way.
 *
 * **The query is scoped to the facts band**, because the band is the
 * whole reason for the badge's position: beside the name it would make this
 * half's cells taller than the online half's, and the cell is one cell shared by
 * both halves. A badge that merely exists somewhere in the cell is not the
 * badge.
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
      density="comfortable"
      install={NO_INSTALL}
    />,
  );

  /** One cell, by the id it draws. */
  function cellOf(id: string): HTMLElement {
    return must(
      container.querySelector<HTMLElement>(`[data-yunari-store-cell="${id}"]`),
      `${id}'s cell`,
    );
  }

  expect(
    must(
      cellOf("living-room").querySelector<HTMLElement>(
        "[data-yunari-store-cell-band] [data-yunari-store-cell-origin]",
      ),
      "origin badge in the facts band",
    ).textContent,
    "the badge is not the copy table's word for where a theme came from",
  ).toBe(uiCopy.store.fromStore);
  expect(
    cellOf("workshop-bench").querySelector("[data-yunari-store-cell-band]"),
    "a theme with no fact beyond its name drew a facts band anyway",
  ).toBeNull();
});

/**
 * **The online half's left slot is fixed, in the same band**: the kind
 * badge and the download count. The count is pinned as the
 * literal `1,204` because the thousands separator is the assertion — a bare
 * `1204` would pass on any locale and is what the red proof breaks — and the
 * badge as the `Theme`, which is also the copy case's value.
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
      density="comfortable"
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
    "the badge is not the word for the kind",
  ).toBe("Theme");
  const downloads = must(
    band("living-room").querySelector<HTMLElement>(
      "[data-yunari-store-cell-downloads]",
    ),
    "download count",
  );
  expect(
    visibleText(downloads),
    "the count is not the thousand-separated reading",
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

  const library = must(
    container.querySelector<HTMLElement>(
      '[data-yunari-store-cell="workshop-bench"]',
    ),
    "the library cell",
  );
  expect(
    library.querySelector("[data-yunari-store-cell-kind]"),
    "the library cell drew a catalogue kind",
  ).toBeNull();
  expect(
    library.querySelector("[data-yunari-store-cell-downloads]"),
    "the library cell drew a catalogue count",
  ).toBeNull();
  expect(
    library.querySelector("[data-yunari-store-cell-band]"),
    "a library theme with no fact beyond its name drew a facts band",
  ).toBeNull();
});

/**
 * **A kind this build does not know prints its identifier** — the rule
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
      density="comfortable"
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
 * **One owner of the decision**, and the cases the word *newer* makes.
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
 * disabled button here would be a control drawn where the surface draws none.
 */
it("marks an installed online item without drawing a control", async () => {
  const container = await mount(
    <Gallery
      items={[item({ catalogue: catalogue({ installedVersion: "1.4.0" }) })]}
      onAction={() => undefined}
      onOpenItem={() => undefined}
      density="comfortable"
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
    "the mark is not the word for an installed item",
  ).toBe(uiCopy.store.cell.installStates.installed);
  expect(
    mark.className,
    "the mark's word is not drawn in the muted colour",
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
 * The three states are read together: `installed` is the mark the surface draws
 * and reports nothing, and the other two carry the words and reach
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
      density="comfortable"
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
    expect(button.textContent, `${state} is not the word`).toBe(
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
 * the signal rather than a colour. `pending` is drawn here; `published`
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
      density="comfortable"
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
      container.querySelector<HTMLElement>(
        "[data-yunari-store-cell-name-press]",
      ),
      "the cell's name press",
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
      density="comfortable"
      install={NO_INSTALL}
    />,
  );

  expect(
    container.querySelector("[data-yunari-store-status]"),
    "a published item drew a state badge",
  ).toBeNull();
});

/**
 * A package with more than one unit: one pack card, whose members open in
 * place. The listing keeps its own name and picture; the member line beneath
 * says what the package contains.
 */
function packItem(overrides: Partial<StoreItem> = {}): StoreItem {
  return item({
    id: "ops-pack",
    kind: "widget-pack",
    name: "Ops pack",
    members: [
      { id: "clock", kind: "widget", name: "Clock" },
      { id: "fan", kind: "widget", name: "Fan" },
    ],
    ...overrides,
  });
}

/** The catalogue ids a collection installs, in the order it installs them. */
const INCLUDED_IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
] as const;

/** What the register records for an included listing. */
function originOf(catalogueId: string): CatalogueOrigin {
  return {
    kind: DASHBOARD_THEME_KIND,
    catalogueId,
    version: "1.0.0",
    installedAt: "2026-10-01T00:00:00.000Z",
  };
}

/** A collection listing: no members of its own, four includes. Its action is
 *  the register's answer, never a fabricated `installedVersion` — a collection
 *  has no origin of its own. */
function collectionItem(overrides: Partial<StoreItem> = {}): StoreItem {
  return item({
    id: "ops-collection",
    kind: "collection",
    name: "Ops collection",
    members: [],
    includes: [...INCLUDED_IDS],
    version: "1.2.0",
    catalogue: catalogue({ id: "ops-collection" }),
    ...overrides,
  });
}

/** One cell, by the listing id it draws. */
function cellOf(container: HTMLElement, id: string): HTMLElement {
  return must(
    container.querySelector<HTMLElement>(`[data-yunari-store-cell="${id}"]`),
    `${id}'s cell`,
  );
}

/**
 * **A one-member listing is drawn as its member.** A pack with a single unit
 * carries that unit's name and kind beside the package it belongs to, which is
 * what the person is actually shopping for; the listing's own picture stays.
 */
it("draws a single-member listing as a member card", async () => {
  const container = await mount(
    <Gallery
      items={[
        packItem({
          members: [{ id: "clock", kind: "widget", name: "Clock" }],
          catalogue: catalogue({ id: "ops-pack", publisher: "acme" }),
        }),
      ]}
      density="comfortable"
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={NO_INSTALL}
    />,
  );

  const cell = cellOf(container, "ops-pack");
  expect(
    must(
      cell.querySelector<HTMLElement>("[data-yunari-store-cell-member-name]"),
      "the member's name",
    ).textContent,
    "the card does not name the member the listing holds",
  ).toBe("Clock");
  expect(
    must(
      cell.querySelector<HTMLElement>("[data-yunari-store-cell-member-kind]"),
      "the member's kind badge",
    ).textContent,
    "the member's kind is not the word for it",
  ).toBe(uiCopy.store.cell.memberKinds.widget);
  expect(
    must(
      cell.querySelector<HTMLElement>("[data-yunari-store-cell-publisher]"),
      "the member card's publisher",
    ).textContent,
    "the member card does not name the listing's publisher",
  ).toBe("acme");
  expect(
    pictureBox(container).querySelector("img"),
    "the member card lost the listing's picture",
  ).not.toBeNull();
});

/**
 * **A package of several members is one card with its count**, not one card per
 * member until asked: the member count is readable text and the control that
 * opens it carries the expanded state.
 */
it("draws a multi-member listing as a pack card with its member count", async () => {
  const container = await mount(
    <Gallery
      items={[packItem()]}
      density="comfortable"
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={NO_INSTALL}
      expanded={new Set()}
      onExpand={() => undefined}
    />,
  );

  const cell = cellOf(container, "ops-pack");
  expect(
    must(
      cell.querySelector<HTMLElement>("[data-yunari-store-cell-members]"),
      "the pack's member count",
    ).textContent,
    "the pack does not state how many members it holds",
  ).toBe(uiCopy.store.cell.pack.members(2));
  const twisty = must(
    cell.querySelector<HTMLButtonElement>("[data-yunari-store-cell-expand]"),
    "the expand control",
  );
  expect(twisty.tagName, "the expand control is not a button").toBe("BUTTON");
  expect(
    twisty.getAttribute("aria-expanded"),
    "the pack starts expanded or states nothing",
  ).toBe("false");
  expect(
    twisty.textContent,
    "the expand control does not name the package it opens",
  ).toContain("Ops pack");
  expect(
    must(
      cell.querySelector<HTMLElement>("[data-yunari-store-members]"),
      "panel",
    ).hidden,
    "a collapsed pack draws its member panel",
  ).toBe(true);
});

/**
 * **The pack opens in place.** The twisty is a real button whose
 * `aria-expanded` flips, it controls a labeled panel, and collapsing puts the
 * member rows away again.
 */
it("expands a pack into its member cards and collapses it again", async () => {
  const onlinePack = packItem({
    catalogue: catalogue({ id: "ops-pack", publisher: "acme" }),
  });
  const container = await mount(
    <Gallery
      items={[onlinePack]}
      density="comfortable"
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={NO_INSTALL}
      expanded={new Set()}
      onExpand={() => undefined}
    />,
  );

  const panel = must(
    cellOf(container, "ops-pack").querySelector<HTMLElement>(
      "[data-yunari-store-members]",
    ),
    "member panel",
  );
  expect(panel.getAttribute("role"), "the panel has no group role").toBe(
    "group",
  );
  expect(
    panel.getAttribute("aria-label"),
    "the panel is not named by the package it belongs to",
  ).toBe(uiCopy.store.cell.pack.panel("Ops pack"));

  await rerender(
    <Gallery
      items={[onlinePack]}
      density="comfortable"
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={NO_INSTALL}
      expanded={new Set(["ops-pack"])}
      onExpand={() => undefined}
    />,
  );

  const twisty = must(
    container.querySelector<HTMLButtonElement>(
      "[data-yunari-store-cell-expand]",
    ),
    "expand control",
  );
  expect(
    twisty.getAttribute("aria-expanded"),
    "the expanded pack does not say it is open",
  ).toBe("true");
  expect(
    twisty.getAttribute("aria-controls"),
    "the control does not name the panel it opens",
  ).toBe(panel.id);
  expect(panel.hidden, "the open pack still hides its members").toBe(false);
  const names = [
    ...container.querySelectorAll<HTMLElement>(
      "[data-yunari-store-member-name]",
    ),
  ].map((name) => name.textContent);
  expect(names, "the open pack does not draw its member cards").toEqual([
    "Clock",
    "Fan",
  ]);
  const clockCard = must(
    container.querySelector<HTMLElement>(
      '[data-yunari-store-member-card="ops-pack#0:widget/clock"]',
    ),
    "the clock's member card",
  );
  expect(
    clockCard.querySelector("[data-yunari-store-picture]"),
    "a member card drew no picture or ground",
  ).not.toBeNull();
  expect(
    must(
      clockCard.querySelector<HTMLElement>(
        "[data-yunari-store-member-publisher]",
      ),
      "the member card's publisher",
    ).textContent,
    "a member card does not name the listing's publisher",
  ).toBe("acme");
  expect(
    must(
      clockCard.querySelector<HTMLElement>("[data-yunari-store-member-kind]"),
      "the member card's kind badge",
    ).textContent,
    "a member card does not badge the member's kind",
  ).toBe(uiCopy.store.cell.memberKinds.widget);

  await rerender(
    <Gallery
      items={[onlinePack]}
      density="comfortable"
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={NO_INSTALL}
      expanded={new Set()}
      onExpand={() => undefined}
    />,
  );

  expect(
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-store-cell-expand]",
      ),
      "expand control",
    ).getAttribute("aria-expanded"),
    "the pack did not collapse",
  ).toBe("false");
  expect(
    must(
      container.querySelector<HTMLElement>("[data-yunari-store-members]"),
      "member panel",
    ).hidden,
    "the collapsed pack kept its member rows on screen",
  ).toBe(true);
});

/** A gallery that installs through the real control, so the press's guard is
 *  the hook's rather than a fixture's. */
function InstallingGallery(): React.JSX.Element {
  const source = useMemo<ItemSource>(
    () => ({ kind: "widget-pack", list: async () => [] }),
    [],
  );
  const install = useInstall({ source, onListed: () => undefined });
  return (
    <Gallery
      items={[packItem({ catalogue: catalogue({ id: "ops-pack" }) })]}
      density="comfortable"
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={install.control}
      expanded={new Set(["ops-pack"])}
      onExpand={() => undefined}
    />
  );
}

/**
 * **Install acts on the listing, not the member.** A member row's press posts
 * the package once; while it is in flight the same press is refused, so a
 * double press cannot install twice.
 */
it("installs the listing when a member card's Install is pressed", async () => {
  const pending = vi.fn(
    (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Promise<Response>(() => undefined),
  );
  vi.stubGlobal("fetch", pending);
  const container = await mount(<InstallingGallery />);

  // **The pack card is cover, count and expand only**: the two install controls
  // belong to the two member cards, and none sits on the package's own card.
  expect(
    cellOf(container, "ops-pack").querySelectorAll(
      "[data-yunari-store-cell-install]",
    ),
    "the pack card drew an install control of its own",
  ).toHaveLength(2);

  const memberInstall = must(
    container.querySelector<HTMLButtonElement>(
      '[data-yunari-store-member-card="ops-pack#0:widget/clock"] button[data-yunari-store-cell-install]',
    ),
    "the member row's install control",
  );
  await act(async () => memberInstall.click());

  expect(pending, "the press did not post the listing").toHaveBeenCalledTimes(
    1,
  );
  const init = pending.mock.calls[0]?.[1] as RequestInit | undefined;
  expect(
    JSON.parse(String(init?.body)) as { catalogueId: string },
    "the press did not name the listing it installs",
  ).toMatchObject({ catalogueId: "ops-pack" });

  const inFlight = must(
    container.querySelector<HTMLButtonElement>(
      '[data-yunari-store-member-card="ops-pack#0:widget/clock"] button[data-yunari-store-cell-install]',
    ),
    "the in-flight install control",
  );
  expect(inFlight.disabled, "a second press in flight was not refused").toBe(
    true,
  );
  await act(async () => inFlight.click());
  expect(
    pending,
    "the refused press posted a second install",
  ).toHaveBeenCalledTimes(1);
});

/** **The three readings come from the origin's version**, in the same order the
 *  copy and the catalogue report them. */
it("shows Installed, Update or Install from the origin version", async () => {
  const container = await mount(
    <Gallery
      items={[
        item({ catalogue: catalogue({ installedVersion: "1.4.0" }) }),
        item({
          id: "office-wall",
          name: "Office wall",
          catalogue: catalogue({ installedVersion: "1.3.0" }),
        }),
        item({
          id: "workshop-bench",
          name: "Workshop bench",
          catalogue: catalogue(),
        }),
      ]}
      density="comfortable"
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={NO_INSTALL}
    />,
  );

  const stateWord = (id: string, state: string): string | null =>
    must(
      cellOf(container, id).querySelector<HTMLElement>(
        `[data-yunari-store-cell-install="${state}"]`,
      ),
      `${id}'s ${state} reading`,
    ).textContent;
  expect(stateWord("living-room", "installed")).toBe(
    uiCopy.store.cell.installStates.installed,
  );
  expect(stateWord("office-wall", "update")).toBe(
    uiCopy.store.cell.installStates.update,
  );
  expect(stateWord("workshop-bench", "install")).toBe(
    uiCopy.store.cell.installStates.install,
  );
});

/**
 * **A collection counts the includes this PC already holds**, and its action
 * follows that count: partial reads *Update*, every include held reads
 * *Installed*, none held reads *Install*. The count is the origin register's
 * answer rather than a fetch of each member's package, and no `installedVersion`
 * is involved — a collection never has an origin row of its own.
 */
it("reads a partially installed collection as N of M installed", async () => {
  const fetched = vi.fn(() => new Promise<Response>(() => undefined));
  vi.stubGlobal("fetch", fetched);
  const container = await mount(
    <Gallery
      items={[collectionItem()]}
      density="comfortable"
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={NO_INSTALL}
      origins={[originOf(INCLUDED_IDS[0]), originOf(INCLUDED_IDS[1])]}
    />,
  );

  const cell = cellOf(container, "ops-collection");
  expect(
    must(
      cell.querySelector<HTMLElement>("[data-yunari-store-cell-members]"),
      "the collection's installed count",
    ).textContent,
    "the collection does not count the includes the register names",
  ).toBe(uiCopy.store.cell.pack.installed(2, 4));
  expect(
    must(
      cell.querySelector<HTMLElement>(
        '[data-yunari-store-cell-install="update"]',
      ),
      "the collection's install reading",
    ).textContent,
    "a partial collection's action is not Update",
  ).toBe(uiCopy.store.cell.installStates.update);
  expect(
    fetched,
    "drawing a collection card fetched member packages",
  ).not.toHaveBeenCalled();
});

/** **Every include held is installed**, and the card draws the mark the online
 *  half draws for an installed item rather than an install control. */
it("marks a collection whose every include is installed", async () => {
  const container = await mount(
    <Gallery
      items={[collectionItem()]}
      density="comfortable"
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={NO_INSTALL}
      origins={INCLUDED_IDS.map(originOf)}
    />,
  );

  const cell = cellOf(container, "ops-collection");
  expect(
    must(
      cell.querySelector<HTMLElement>("[data-yunari-store-cell-members]"),
      "the collection's installed count",
    ).textContent,
    "a fully installed collection does not read 4 of 4 installed",
  ).toBe(uiCopy.store.cell.pack.installed(4, 4));
  const mark = must(
    cell.querySelector<HTMLElement>(
      '[data-yunari-store-cell-install="installed"]',
    ),
    "the collection's installed mark",
  );
  expect(mark.tagName, "an installed collection drew a control").toBe("SPAN");
  expect(mark.textContent).toBe(uiCopy.store.cell.installStates.installed);
});

/** **Nothing held is absent**, so the card offers Install and says `0 of 4`. */
it("offers Install for a collection with no include installed", async () => {
  const container = await mount(
    <Gallery
      items={[collectionItem()]}
      density="comfortable"
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={NO_INSTALL}
      origins={[]}
    />,
  );

  const cell = cellOf(container, "ops-collection");
  expect(
    must(
      cell.querySelector<HTMLElement>("[data-yunari-store-cell-members]"),
      "the collection's installed count",
    ).textContent,
  ).toBe(uiCopy.store.cell.pack.installed(0, 4));
  expect(
    must(
      cell.querySelector<HTMLElement>(
        '[data-yunari-store-cell-install="install"]',
      ),
      "the collection's install control",
    ).textContent,
    "an absent collection's action is not Install",
  ).toBe(uiCopy.store.cell.installStates.install);
});

/** **An unread register states nothing**, rather than drawing every include as
 *  missing: "0 of 4 installed" and an action are claims the card cannot make
 *  before the read answers, and the surface states the failure beside the grid. */
it("draws no installed count before the origin register answers", async () => {
  const container = await mount(
    <Gallery
      items={[collectionItem()]}
      density="comfortable"
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={NO_INSTALL}
    />,
  );

  const cell = cellOf(container, "ops-collection");
  expect(
    cell.querySelector("[data-yunari-store-cell-members]"),
    "an unread register was drawn as zero installed",
  ).toBeNull();
  expect(
    cell.querySelector("[data-yunari-store-cell-install]"),
    "an unread register still drew an install action",
  ).toBeNull();
});

/** **A count with no way to open the pack is noise**, so a surface that hands
 *  down no expand handler draws neither the count nor the control. */
it("states no member count where the surface cannot expand the pack", async () => {
  const container = await mount(
    <Gallery
      items={[packItem()]}
      density="comfortable"
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={NO_INSTALL}
    />,
  );

  const cell = cellOf(container, "ops-pack");
  expect(
    cell.querySelector("[data-yunari-store-cell-members]"),
    "a count was drawn with no way to open the pack",
  ).toBeNull();
  expect(
    cell.querySelector("[data-yunari-store-cell-expand]"),
    "an expand control was drawn with no handler",
  ).toBeNull();
});

/**
 * **A pack the surface cannot expand keeps its own install.** The member cards
 * live in a panel nothing can open, so the pack card is the only reachable
 * control: without it the package could not be installed from that surface.
 */
it("offers install on a pack the surface cannot expand", async () => {
  const onInstall = vi.fn();
  const container = await mount(
    <Gallery
      items={[packItem({ catalogue: catalogue({ id: "ops-pack" }) })]}
      density="comfortable"
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={{ ...NO_INSTALL, onInstall }}
    />,
  );

  const cell = cellOf(container, "ops-pack");
  // The member cards sit in the closed panel; the pack card's own control is
  // the one outside it.
  const own = [
    ...cell.querySelectorAll<HTMLButtonElement>(
      '[data-yunari-store-cell-install="install"]',
    ),
  ].filter(
    (control) => control.closest("[data-yunari-store-members]") === null,
  );
  expect(own, "the pack card drew no install of its own").toHaveLength(1);
  const button = must(own[0] ?? null, "the pack's install control");
  await act(async () => button.click());
  expect(
    onInstall.mock.calls.map(([pressed]) => pressed.id),
    "the pack's install control did not report the listing",
  ).toEqual(["ops-pack"]);
});

/** **Two packs do not produce two identical controls**: each expand button
 *  names the listing whose members it opens. */
it("names each pack's expand control by its listing", async () => {
  const container = await mount(
    <Gallery
      items={[packItem(), packItem({ id: "fan-pack", name: "Fan pack" })]}
      density="comfortable"
      onAction={() => undefined}
      onOpenItem={() => undefined}
      install={NO_INSTALL}
      expanded={new Set()}
      onExpand={() => undefined}
    />,
  );

  const names = [
    ...container.querySelectorAll<HTMLElement>(
      "[data-yunari-store-cell-expand]",
    ),
  ].map((control) => control.textContent);
  expect(names, "the expand controls do not name their packages").toEqual([
    `${uiCopy.store.cell.pack.expand}: Ops pack`,
    `${uiCopy.store.cell.pack.expand}: Fan pack`,
  ]);
});
