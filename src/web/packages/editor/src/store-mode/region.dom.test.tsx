// @vitest-environment jsdom
/**
 * The store mode's region: its own header row, and the facts about it that a
 * reader cannot get from the words alone.
 *
 * **What this file owns.** The two claims the plan makes in code — that the two
 * halves are a `Segmented` inside the region's *own* header row with nothing
 * above it, and that the facet row wraps rather than dropping a control — plus
 * the two wells and the five facet names. The facet popover is read here with
 * fixtures, because A.3 owns the record that derives the values and A.2 must not
 * reach into `renderer-core` for them.
 *
 * **What it deliberately does not measure.** jsdom lays nothing out: a narrow
 * width here is a declaration read off the class list, not a reflow. The wrap
 * is *proved* in the browser (`tests/e2e/editor-rail.spec.ts`), where the five
 * buttons are counted inside a really narrow region; what this file can say is
 * that no facet is conditionally rendered, so no width can drop one.
 */
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
  createThemeLibraryClient,
  type ThemedDisplay,
  type ThemeLibraryClient,
  type ThemeLibraryEntry,
  type ThemeOrigin,
} from "../theme-library-client.js";
import { uiCopy } from "../ui-copy.js";
import { type Facet, FacetRow, toggleFacet } from "./facet-row.js";
import {
  DARK_GROUND,
  type FixtureTheme,
  fixtureEntry,
  LIGHT_GROUND,
} from "./item-fixture.js";
import type { CellAction, FacetSelection } from "./local-source.js";
import { StoreModeRegion } from "./region.js";

// Base UI's popup needs three browser APIs jsdom has none of: floating-ui
// observes its anchor, the popup waits for its own open transition, and it asks
// the selector engine for `:modal`/`:popover-open`, which jsdom parses slowly
// enough (about 0.5s a call) to dominate the file. Each test file that mounts a
// primitive supplies its own — there is no shared harness for it here.
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

/** The mounted region and its host, taken down together: the item modal is
 *  portalled to `body`, so a root left mounted would leave a second surface in
 *  the tree for the next read to find. */
async function unmount(): Promise<void> {
  const mounted = root;
  root = undefined;
  host?.remove();
  host = undefined;
  if (mounted !== undefined) await act(async () => mounted.unmount());
}

afterEach(async () => {
  await unmount();
  // A case that drives the sign-in's poll installs fake timers; a timer left
  // faked would stop the next file's `settle` from ever running.
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  // The page size is the one thing this surface persists (`page-size.ts`), and
  // jsdom's storage outlives a test: without this, a case that chooses 48
  // changes how many pages the next one has.
  window.localStorage.clear();
  // The region reads the catalogue when it mounts, and a case whose subject is
  // the library must not reach the network for it: the default is a failed
  // read, which leaves the online half unset.
  vi.stubGlobal("fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
});

async function mount(element: ReactElement): Promise<HTMLDivElement> {
  await unmount();
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

/** A missing element is a defect this file names, rather than a `null` a later
 *  assertion reports as a wrong value. */
function must<T extends Element>(found: T | null, what: string): T {
  if (found === null) throw new Error(`the region rendered no ${what}`);
  return found;
}

/** The region's header row, which every case here reads through. */
function headerRow(container: HTMLElement): HTMLElement {
  return must(
    container.querySelector<HTMLElement>("[data-yunari-store-header]"),
    "header row",
  );
}

/** The halves' segments, in the order the row draws them. */
function halves(header: HTMLElement): readonly HTMLButtonElement[] {
  return Array.from(
    must(
      header.querySelector<HTMLElement>("[data-yunari-store-halves]"),
      "halves",
    ).querySelectorAll<HTMLButtonElement>("button"),
  );
}

/**
 * The "a second horizontal bar under the header is forbidden", one level
 * down: the region draws its own header row, and it is the region's *first*
 * row rather than a strip above one.
 *
 * The two halves are named and they are a `Segmented` — one exclusive choice
 * over what the region lists, not navigation between shell surfaces — and
 * choosing one moves the chosen segment rather than replacing the row.
 */
it("shows the two halves as a Segmented inside the region's own header row", async () => {
  const container = await mount(<StoreModeRegion mode="themes" />);
  const surface = container.firstElementChild;
  const header = headerRow(container);

  expect(
    surface?.firstElementChild,
    "something sits above the region's own header row",
  ).toBe(header);

  const segments = halves(header);
  expect(
    segments.map((segment) => segment.textContent),
    "the region does not name the two halves, in order",
  ).toEqual([uiCopy.store.halves.local, uiCopy.store.halves.online]);
  expect(
    segments.map((segment) => segment.getAttribute("aria-pressed")),
    "the region does not open on the local half",
  ).toEqual(["true", "false"]);
  expect(
    must(
      header.querySelector<HTMLElement>("[data-yunari-store-halves]"),
      "halves",
    ).getAttribute("aria-label"),
    "the halves carry no programmatic name of their own",
  ).toBe(uiCopy.store.halves.label);

  await act(async () => halves(header)[1]?.click());

  expect(
    halves(header).map((segment) => segment.getAttribute("aria-pressed")),
    "choosing the online half did not move the chosen segment",
  ).toEqual(["false", "true"]);
});

/**
 * The facet row is five controls on one line, and a window too narrow for five
 * is a second line — never a dropped facet, which would silently filter by
 * something the author can no longer see or unchoose.
 *
 * jsdom lays nothing out, so no width is set and none could be measured here:
 * what is checkable is checked — every facet is rendered (nothing is
 * conditional, so no width can drop one), and the row declares the wrap that
 * puts the overflow on the next line rather than clipping it. The reflow itself
 * is the browser case's, which counts the five inside a really narrow row.
 */
it("keeps the facet row on one line and wraps rather than dropping a control", async () => {
  const container = await mount(<StoreModeRegion mode="themes" />);

  const row = must(
    headerRow(container).querySelector<HTMLElement>("[data-yunari-facet-row]"),
    "facet row",
  );
  const facets = Array.from(
    row.querySelectorAll<HTMLButtonElement>("[data-yunari-facet]"),
  );
  expect(
    facets.map((facet) =>
      facet.querySelector("[data-yunari-facet-name]")?.textContent?.trim(),
    ),
    "the facet row does not name the five facets, in order",
  ).toEqual([
    uiCopy.store.facets.author,
    uiCopy.store.facets.colourMode,
    uiCopy.store.facets.sensors,
    uiCopy.store.facets.shape,
    uiCopy.store.facets.style,
  ]);
  expect(
    row.className,
    "the facet row cannot wrap, so a narrow region clips a control",
  ).toContain("flex-wrap");
});

/**
 * The two wells either side of the facets, and the sort that follows the half.
 *
 * The sort keys are per half and the two share no key: the catalogue knows when
 * an item was published and how often it was taken, and the host's own library
 * knows only what the author wrote. Read as
 * the words the well prints, because the two halves' first keys are different
 * words — `Name` against `Updated` — so a sort that did not follow the half
 * would print the same thing twice.
 */
it("draws the search well and the sort well, and the sort follows the half", async () => {
  const container = await mount(<StoreModeRegion mode="themes" />);
  const header = headerRow(container);

  const search = must(
    header.querySelector<HTMLInputElement>("[data-yunari-store-search]"),
    "search well",
  );
  expect(
    search.getAttribute("aria-label"),
    "the search well has no programmatic name",
  ).toBe(uiCopy.store.search);
  expect(search.placeholder, "the empty search well says nothing").toBe(
    uiCopy.store.search,
  );

  const sort = must(
    header.querySelector<HTMLElement>("[data-yunari-store-sort]"),
    "sort well",
  );
  expect(sort.textContent).toContain(uiCopy.store.sort.local.name);

  await act(async () => halves(header)[1]?.click());

  expect(
    header.querySelector<HTMLElement>("[data-yunari-store-sort]")?.textContent,
    "the sort kept the local half's key on the online half",
  ).toContain(uiCopy.store.sort.online.updated);
});

/**
 * The checkbox choice row, which is the one control this commit adds to the
 * design language: a set you may choose *several* of is not rule 7's radio
 * group, so the row's semantics are a checkbox and the group is a plain group.
 *
 * Read with fixtures rather than with the catalogue, because the values are
 * A.3's record to derive and the row is only the surface that draws them. The
 * count is what the author reads *before* opening the facet, so it is asserted
 * on the trigger rather than inside the popover.
 */
it("opens a facet as a group of checkbox rows, and counts what is chosen", async () => {
  const facets: readonly Facet[] = [
    {
      id: "author",
      name: uiCopy.store.facets.author,
      options: [
        { id: "ada", name: "Ada", count: 3 },
        { id: "bob", name: "Bob", count: 1 },
      ],
    },
  ];
  const container = await mount(<FacetFixture facets={facets} />);
  const trigger = must(
    container.querySelector<HTMLButtonElement>("[data-yunari-facet]"),
    "facet button",
  );
  expect(
    trigger.querySelector("[data-yunari-facet-count]"),
    "a facet with nothing chosen claims a count",
  ).toBeNull();

  await act(async () => trigger.click());

  const rows = Array.from(
    document.body.querySelectorAll<HTMLButtonElement>(
      "[data-yunari-facet-option]",
    ),
  );
  expect(
    rows.map((row) =>
      row.querySelector("[data-yunari-facet-option-name]")?.textContent?.trim(),
    ),
    "the facet did not offer its options",
  ).toEqual(["Ada", "Bob"]);
  expect(
    rows.map((row) => row.getAttribute("aria-checked")),
    "the facet's rows do not open unchecked",
  ).toEqual(["false", "false"]);

  await act(async () => rows[0]?.click());

  expect(
    document.body
      .querySelectorAll("[data-yunari-facet-option]")[0]
      ?.getAttribute("aria-checked"),
    "choosing a value did not check its row",
  ).toBe("true");
  expect(
    trigger.querySelector("[data-yunari-facet-count]")?.textContent,
    "the trigger does not count what is chosen",
  ).toBe("1");
});

/**
 * The region is the Themes mode's surface and no other's. The shell renders one
 * `[data-yunari-mode-region]` section for every non-editor mode, and A.8 mounts
 * the Host mode's own region in it — so a region that drew itself in a mode it
 * does not own would be the second surface in one section.
 */
it("renders no region for a mode that is not Themes", async () => {
  const container = await mount(<StoreModeRegion mode="this-pc" />);
  expect(container.textContent, "the store drew itself in the host mode").toBe(
    "",
  );
});

/**
 * The row holds no state of its own — the region owns the selection, because
 * what is chosen filters the list and returns the pager to page one — so a case
 * that mounts the row alone supplies the region's own rule (`toggleFacet`)
 * rather than a second copy of it.
 */
function FacetFixture(props: {
  readonly facets: readonly Facet[];
}): React.JSX.Element {
  const [chosen, setChosen] = useState<FacetSelection>({});
  return (
    <FacetRow
      facets={props.facets}
      chosen={chosen}
      onToggle={(facetId, optionId) =>
        setChosen((current) => toggleFacet(current, facetId, optionId))
      }
    />
  );
}

/** A client that answers one listing and refuses everything else: the region
 *  reads `list()` and none of the library's other four members — opening a
 *  theme is the shell's own route, through the session's client rather than
 *  this one. */
function clientListing(
  entries: readonly ThemeLibraryEntry[],
  onList?: () => void,
): ThemeLibraryClient {
  return {
    list: async () => {
      onList?.();
      return entries;
    },
    open: () => Promise.reject(new Error("the region lists; the shell opens")),
    save: () => Promise.reject(new Error("the store does not save")),
    assign: () => Promise.reject(new Error("the store does not assign")),
    listDisplays: async () => ({ default: null, displays: [] }),
  };
}

/** A listing of `count` themes, all 1920×1080 and dark, named so the sort has
 *  something to order. */
function listing(count: number): readonly ThemeLibraryEntry[] {
  return Array.from({ length: count }, (_unused, index) =>
    fixtureEntry({
      id: `theme-${index + 1}`,
      name: `Theme ${String(index + 1).padStart(2, "0")}`,
      ground: DARK_GROUND,
    }),
  );
}

/** The region over one listing, with the shell's own route to a document where
 *  a case has one to prove. */
async function mountStore(
  entries: readonly ThemeLibraryEntry[],
  onOpenTheme?: (id: string) => void,
  onList?: () => void,
): Promise<HTMLElement> {
  return mount(
    <StoreModeRegion
      mode="themes"
      client={clientListing(entries, onList)}
      {...(onOpenTheme === undefined ? {} : { onOpenTheme })}
    />,
  );
}

/** The cells the gallery draws, in order. */
function cells(): readonly HTMLElement[] {
  return Array.from(
    document.body.querySelectorAll<HTMLElement>("[data-yunari-store-cell]"),
  );
}

/** The cells' ids in the order the grid draws them. */
function drawnIds(): readonly (string | null)[] {
  return cells().map((cell) => cell.getAttribute("data-yunari-store-cell"));
}

/** One entry of the sort well chosen, the way a person chooses it: Base UI
 *  commits a list item only when the press that precedes the click started on
 *  it, and the popup opens on a queue `act` does not drain by itself. */
async function chooseSort(id: string): Promise<void> {
  const trigger = must(
    document.body.querySelector<HTMLElement>("[data-yunari-store-sort]"),
    "sort well",
  );
  await act(async () => {
    trigger.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  const option = must(
    document.body.querySelector<HTMLElement>(`[data-yunari-option="${id}"]`),
    `${id} sort option`,
  );
  await act(async () => {
    option.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerType: "mouse",
        button: 0,
      }),
    );
  });
  await act(async () => {
    option.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
    );
  });
  await act(async () => {});
}

/** One cell's action button, pressed the way a person presses it. */
async function pressCell(id: string, action: CellAction): Promise<void> {
  const button = must(
    document.body.querySelector<HTMLButtonElement>(
      `[data-yunari-store-cell="${id}"] [data-yunari-store-cell-action="${action}"]`,
    ),
    `${action} on ${id}`,
  );
  await act(async () => button.click());
}

/** The cell's own surface — its picture and its name, not one of its four
 *  actions — pressed the way a person presses it. */
async function pressCellSurface(id: string): Promise<void> {
  const surface = must(
    document.body.querySelector<HTMLButtonElement>(
      `[data-yunari-store-cell="${id}"] [data-yunari-store-cell-surface]`,
    ),
    `${id}'s own surface`,
  );
  await act(async () => surface.click());
}

/** Whether the item's own surface is on screen, read where it portals to. */
function itemIsOpen(): boolean {
  return document.body.querySelector("[data-yunari-store-item]") !== null;
}

/** The way out of the item's own surface, pressed. */
async function closeItem(): Promise<void> {
  await act(async () =>
    must(
      document.body.querySelector<HTMLButtonElement>(
        "[data-yunari-store-item-close]",
      ),
      "close control",
    ).click(),
  );
}

/** The page the pager says is in force, or `undefined` when it draws none. */
function currentPage(): number | undefined {
  const shown = document.body.querySelector<HTMLElement>(
    "[data-yunari-store-page][aria-current]",
  );
  return shown === null
    ? undefined
    : Number(shown.getAttribute("data-yunari-store-page"));
}

/** One run of a facet popover: the heading it is drawn under, or `undefined`
 *  for values filed under none, and the values themselves. */
interface FacetRun {
  readonly group: string | undefined;
  readonly values: readonly string[];
}

/**
 * One facet's own popover, opened, and what it draws: the sentence above the
 * options where the surface has one, and the labelled runs of values.
 *
 * It is read **inside that popup** rather than across `body`, so a case that
 * opens two in turn cannot read the first one's values and call them the
 * second's. The runs are reconstructed from the rows' own owners rather than
 * from a list of headings, so a heading drawn over no value, or a value under a
 * heading that is not its own, is what the reading shows.
 *
 * `runClasses` is each run's own wrapper class, in the same order, so a case can
 * pin the spacing a run gives its rows — jsdom lays nothing out, so a measured
 * gap would be zero whatever the classes said.
 */
async function openFacet(
  facetId: string,
  name: string,
): Promise<{
  readonly hint: string | undefined;
  readonly runs: readonly FacetRun[];
  readonly runClasses: readonly string[];
}> {
  await act(async () =>
    must(
      document.body.querySelector<HTMLButtonElement>(
        `[data-yunari-facet="${facetId}"]`,
      ),
      `${facetId} facet`,
    ).click(),
  );
  const popup = must(
    document.body.querySelector<HTMLElement>(`[aria-label="${name}"]`),
    `${facetId} popover`,
  );

  const runs: {
    group: string | undefined;
    values: string[];
    classes: string;
  }[] = [];
  for (const row of popup.querySelectorAll<HTMLElement>(
    "[data-yunari-facet-option]",
  )) {
    const wrapper = must(row.parentElement, "a facet option's own run");
    const owner = wrapper.closest("[data-yunari-facet-group]");
    const group = owner?.getAttribute("data-yunari-facet-group") ?? undefined;
    const value =
      row
        .querySelector("[data-yunari-facet-option-name]")
        ?.textContent?.trim() ?? "";
    const last = runs.at(-1);
    if (last !== undefined && last.group === group) last.values.push(value);
    else runs.push({ group, values: [value], classes: wrapper.className });
  }

  return {
    hint:
      popup.querySelector("[data-yunari-facet-hint]")?.textContent?.trim() ??
      undefined,
    runs: runs.map(({ group, values }) => ({ group, values })),
    runClasses: runs.map((run) => run.classes),
  };
}

/** A search well, typed into the way React reads a controlled input: through the
 *  native setter, which a plain `value =` write does not go through. */
async function type(query: string): Promise<void> {
  const well = must(
    document.body.querySelector<HTMLInputElement>("[data-yunari-store-search]"),
    "search well",
  );
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(well, query);
    well.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/**
 * The region lists the items, and **the cell's own surface is what opens the
 * item's**.
 *
 * The gallery is the wiring's visible half: before A.6 the region's body was
 * empty, so a cell drawn at all is the source reaching the grid. The cell is
 * the control here rather than the `open` action, which names the library
 * operation its label prints — *Open in editor* — and is the half below.
 */
it("lists the items and opens one from the cell's own surface", async () => {
  await mountStore([
    fixtureEntry({
      id: "living-room",
      name: "Living room",
      ground: DARK_GROUND,
    }),
    fixtureEntry({
      id: "porch-strip",
      name: "Porch strip",
      ground: DARK_GROUND,
    }),
  ]);

  expect(
    cells().map((cell) => cell.getAttribute("data-yunari-store-cell")),
    "the region draws no cells for the items it listed",
  ).toEqual(["living-room", "porch-strip"]);

  await pressCellSurface("porch-strip");

  expect(
    document.body
      .querySelector("[data-yunari-store-item-name]")
      ?.textContent?.trim(),
    "the cell's own surface did not open the item's own surface",
  ).toBe("Porch strip");
});

/**
 * **The `open` action asks for a document and opens no modal**, from the cell
 * and from the modal's own footer alike: the surface labels it *Open in editor*
 * and the library's existing operation is what the label names (R134).
 *
 * The two are one case because they are one route — the modal draws the cell's
 * own four actions and reports them through the same callback — and the failure
 * this owns was exactly the two disagreeing with the label.
 */
it("asks for the theme as a document from the cell's open action and the modal's", async () => {
  const opened: string[] = [];
  await mountStore(
    [
      fixtureEntry({
        id: "porch-strip",
        name: "Porch strip",
        ground: DARK_GROUND,
      }),
    ],
    (id) => opened.push(id),
  );

  await pressCell("porch-strip", "open");

  expect(
    itemIsOpen(),
    "the cell's open action opened a modal instead of a document",
  ).toBe(false);
  expect(
    opened,
    "the cell's open action did not ask for the theme as a document",
  ).toEqual(["porch-strip"]);

  await pressCellSurface("porch-strip");
  await act(async () =>
    must(
      document.body.querySelector<HTMLButtonElement>(
        "[data-yunari-store-item-action='open']",
      ),
      "the modal's open action",
    ).click(),
  );

  expect(
    opened,
    "the modal's own open action does not take the route the cell's does",
  ).toEqual(["porch-strip", "porch-strip"]);
  // **And it leaves this surface where it was** (`item-modal.tsx`): loading a
  // document is a fact about the document, so the surface someone is reading
  // stays on screen — closing it here would be the modal deciding something the
  // region's own `openId` owns.
  expect(
    itemIsOpen(),
    "the modal's own open action closed the item's own surface",
  ).toBe(true);
  expect(
    document.body
      .querySelector("[data-yunari-store-item-name]")
      ?.textContent?.trim(),
    "the modal's own open action moved the item's own surface",
  ).toBe("Porch strip");
});

/**
 * **The two empties are two sentences, and not the same one twice** (R124). An
 * empty library is not an empty filter result: the first says the library has
 * nothing in it and what to do about it, and the second says the filters matched
 * nothing. The first-run sentence would tell someone with forty themes to go and
 * build one.
 */
it("offers the two different empty states, and not the same one twice", async () => {
  await mountStore([]);

  const empty = must(
    document.body.querySelector<HTMLElement>("[data-yunari-store-empty]"),
    "empty state",
  );
  expect(
    empty.textContent,
    "an empty library does not say the library is empty",
  ).toContain(uiCopy.store.empty.library);
  expect(
    empty.textContent,
    "an empty library offers the filter sentence",
  ).not.toContain(uiCopy.store.empty.filter);

  await mountStore([
    fixtureEntry({
      id: "living-room",
      name: "Living room",
      ground: DARK_GROUND,
    }),
  ]);
  await type("nothing matches this");

  const filtered = must(
    document.body.querySelector<HTMLElement>("[data-yunari-store-empty]"),
    "empty state after a query",
  );
  expect(
    filtered.textContent,
    "a filter that matched nothing does not say so",
  ).toContain(uiCopy.store.empty.filter);
  expect(
    filtered.textContent,
    "a filter that matched nothing tells the reader to build a theme",
  ).not.toContain(uiCopy.store.empty.library);
});

/**
 * **A changed filter returns to page one** (R123), and it is the filter's rule
 * rather than the pager's: a narrower result would otherwise leave the viewer on
 * a page they were not looking for, which reads as a store that moved under them.
 *
 * **The filter leaves two pages standing**, which is what makes this the rule's
 * own case rather than the clamp's: twenty-four of the thirty carry the word the
 * query names, so page two still exists and still holds items when the query
 * lands, and nothing but `toFirstPage()` can answer page one.
 */
it("returns to page one when a filter changes", async () => {
  await mountStore(
    Array.from({ length: 30 }, (_unused, at) =>
      fixtureEntry({
        id: `theme-${at + 1}`,
        name: `${at < 24 ? "Themed" : "Plain"} ${String(at + 1).padStart(2, "0")}`,
        ground: DARK_GROUND,
      }),
    ),
  );

  const second = must(
    document.body.querySelector<HTMLButtonElement>(
      "[data-yunari-store-page='2']",
    ),
    "second page numeral",
  );
  await act(async () => second.click());
  expect(currentPage(), "the pager did not move to page two").toBe(2);

  await type("Themed");

  expect(
    document.body.querySelector("[data-yunari-store-page='2']"),
    "the filter left fewer pages than this case is about",
  ).not.toBeNull();
  expect(
    currentPage(),
    "a changed query left the viewer on the page they were on",
  ).toBe(1);
});

/**
 * **Opening the item does not disturb what is underneath it**: the page, the
 * query and the sort are where they were when the modal closes, so a person
 * comes back to the list they left.
 */
it("closes back onto the same page, filter and sort", async () => {
  await mountStore(listing(30));
  await type("Theme");

  const second = must(
    document.body.querySelector<HTMLButtonElement>(
      "[data-yunari-store-page='2']",
    ),
    "second page numeral",
  );
  await act(async () => second.click());

  const opened = String(cells()[0]?.getAttribute("data-yunari-store-cell"));
  await pressCellSurface(opened);
  await closeItem();

  expect(
    document.body.querySelector("[data-yunari-store-item]"),
    "the item's own surface did not close",
  ).toBeNull();
  expect(currentPage(), "closing the item lost the page").toBe(2);
  expect(
    must(
      document.body.querySelector<HTMLInputElement>(
        "[data-yunari-store-search]",
      ),
      "search well",
    ).value,
    "closing the item lost the query",
  ).toBe("Theme");
});

/**
 * **The facet values are the items' own readings** (R122). Three things are
 * asserted, and each is a way a facet can lie: `unclassified` is not a value a
 * person can ask for (it is reachable under "any" and under nothing else), a
 * size exactly one theme declares is not offered (it would be a theme wearing a
 * filter's clothes), and a size two themes declare is.
 *
 * **The groups are read too** (R115): the surface draws Shape's three groups as
 * labelled runs under "A theme must match every group.", and a flat list is what
 * hides the AND — a person who picks Landscape + 16:9 and gets no portrait 16:9
 * theme has been told the opposite of what the filter does.
 */
it("derives the facet values from the items", async () => {
  await mountStore([
    fixtureEntry({ id: "dark", ground: DARK_GROUND }),
    fixtureEntry({ id: "dark-two", ground: DARK_GROUND }),
    fixtureEntry({ id: "light", ground: LIGHT_GROUND }),
    // No ground at all, so the record cannot read a colour mode from it.
    fixtureEntry({ id: "unclassified" }),
    fixtureEntry({
      id: "wide",
      width: 2560,
      height: 1440,
      ground: DARK_GROUND,
    }),
  ]);

  const colour = await openFacet("colour-mode", uiCopy.store.facets.colourMode);
  expect(
    colour.runs,
    "the colour facet offers a value nobody can ask for, or misses one",
  ).toEqual([
    {
      group: undefined,
      values: [uiCopy.store.colourModes.dark, uiCopy.store.colourModes.light],
    },
  ]);
  expect(
    colour.hint,
    "a facet the surface draws without a sentence says one anyway",
  ).toBeUndefined();

  const shape = await openFacet("shape", uiCopy.store.facets.shape);
  expect(
    shape.hint,
    "the shape popover does not carry the sentence the surface draws",
  ).toBe(uiCopy.store.facets.shapeHint);
  const headings = uiCopy.store.facets.shapeGroups;
  expect(
    shape.runs,
    "the shape facet flattens the three labelled groups",
  ).toEqual([
    {
      group: headings.orientation,
      values: [uiCopy.store.orientations.landscape],
    },
    { group: headings.aspect, values: ["16:9"] },
    // A size exactly one theme declares is not a value: it is a theme wearing a
    // filter's clothes, and every other size is reachable under `Other`.
    { group: headings.size, values: [uiCopy.store.size(1920, 1080)] },
  ]);
});

/**
 * **A run's spacing belongs to the run, not to the grouping** (A.6's fix round
 * 2, G1). F5 gave the grouped branch a `gap-[var(--space-4)]` and left the flat
 * one without, so Colour mode, Author and Style drew their rows flush while
 * Shape's sat 4px apart — the spacing the rows had as direct children of the
 * popup, lost to a branch that only meant to add a heading.
 *
 * **The class is pinned rather than a measured gap**, because jsdom lays nothing
 * out: every `getBoundingClientRect` here is zeroes, so a case that measured
 * would agree with any spacing at all. The one class string shared by every run
 * is the invariant — two branches that each carried their own would be two
 * strings — and the browser case measures the same gap for real.
 */
it("gives an ungrouped run's rows the spacing it gives a grouped one's", async () => {
  await mountStore([
    fixtureEntry({ id: "dark", ground: DARK_GROUND }),
    fixtureEntry({ id: "light", ground: LIGHT_GROUND }),
    fixtureEntry({
      id: "wide",
      width: 2560,
      height: 1440,
      ground: DARK_GROUND,
    }),
  ]);

  const flat = await openFacet("colour-mode", uiCopy.store.facets.colourMode);
  const grouped = await openFacet("shape", uiCopy.store.facets.shape);

  expect(
    flat.runs.length,
    "the colour facet draws no run to space at all",
  ).toBe(1);
  expect(grouped.runs.length, "the shape facet draws no labelled run").toBe(3);
  const classes = [...new Set([...flat.runClasses, ...grouped.runClasses])];
  expect(
    classes.length,
    `an ungrouped run and a grouped one space their rows differently (${JSON.stringify(classes)})`,
  ).toBe(1);
  expect(
    classes[0],
    `the rows of a run are drawn flush (${JSON.stringify(classes)})`,
  ).toContain("gap-[var(--space-4)]");
});

/**
 * **The sensors are grouped by the family the vocabulary already files them
 * under**, which is one grouping and not a second reading of the key here.
 *
 * A key this build does not know has no family, so it is offered under no
 * heading rather than under an invented one — and it is still offered,
 * because a theme that binds it is a theme the library holds.
 */
it("groups the sensors by the family the vocabulary files them under", async () => {
  await mountStore([
    fixtureEntry({
      id: "reads-two-families",
      ground: DARK_GROUND,
      bindings: {
        "cpu-label": [{ id: "cpu", semanticKey: "cpu.load" }],
        "disk-label": [{ id: "disk", semanticKey: "disk.used" }],
        "unknown-label": [{ id: "unknown", semanticKey: "not.a.key" }],
      },
    }),
  ]);

  const sensors = await openFacet("sensors", uiCopy.store.facets.sensors);

  expect(
    sensors.runs,
    "the sensor values are one flat list rather than the vocabulary's families",
  ).toEqual([
    {
      group: uiCopy.store.facets.sensorFamilies.cpu,
      values: ["CPU load"],
    },
    {
      group: uiCopy.store.facets.sensorFamilies.disk,
      values: ["Disk used"],
    },
    // The key this build does not know, under no heading at all.
    { group: undefined, values: ["not.a.key"] },
  ]);
});

/**
 * The host `/api/themes/active` answers from: the two reads and the one write
 * the display choice makes, and the requests it received.
 *
 * **The client under it is the real one over a stubbed transport.** A hand-made
 * client would be a second implementation of `assign` and `listDisplays`, and
 * what these cases are about is the path the store depends on — the body on the
 * wire, and the words the host sends back — rather than the shape of a stub.
 */
interface ActiveThemeHost {
  /** What `GET /api/themes/active` answers. */
  answer: {
    readonly default: string | null;
    readonly displays: readonly ThemedDisplay[];
  };
  /** What the read answers with instead, when the host refuses it. */
  readRefusal: { readonly status: number; readonly body: string } | undefined;
  /** What the write answers with, when the host refuses it. */
  writeRefusal: { readonly status: number; readonly body: string } | undefined;
  /** Every `PUT` body the host received, in order. */
  readonly writes: { readonly display?: unknown; readonly id?: unknown }[];
  /** How many times the display list was read. **The surface's claim that it
   *  keeps no list is exactly that this grows once per opening.** */
  reads: number;
}

function hostServing(
  overrides: Partial<ActiveThemeHost> = {},
): ActiveThemeHost {
  return {
    answer: { default: null, displays: [] },
    readRefusal: undefined,
    writeRefusal: undefined,
    writes: [],
    reads: 0,
    ...overrides,
  };
}

/** The store's own client over that host, and the listing it serves. */
function clientOver(
  host: ActiveThemeHost,
  themes: readonly ThemeLibraryEntry[],
): ThemeLibraryClient {
  return createThemeLibraryClient({
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/themes") {
        return new Response(JSON.stringify({ themes }), { status: 200 });
      }
      if (url !== "/api/themes/active") {
        return new Response("Not found", { status: 404 });
      }
      if (init?.method === "PUT") {
        host.writes.push(
          JSON.parse(String(init.body)) as {
            readonly display?: unknown;
            readonly id?: unknown;
          },
        );
        const refusal = host.writeRefusal;
        return refusal === undefined
          ? new Response(JSON.stringify({ ok: true }), { status: 200 })
          : new Response(refusal.body, { status: refusal.status });
      }
      host.reads += 1;
      const refusal = host.readRefusal;
      return refusal === undefined
        ? new Response(JSON.stringify(host.answer), { status: 200 })
        : new Response(refusal.body, { status: refusal.status });
    }) as unknown as typeof fetch,
  });
}

/** One theme, mounted over a host that answers the display routes. */
async function mountOver(host: ActiveThemeHost): Promise<void> {
  await mount(
    <StoreModeRegion
      mode="themes"
      client={clientOver(host, [
        fixtureEntry({
          id: "living-room",
          name: "Living room",
          ground: DARK_GROUND,
        }),
      ])}
    />,
  );
}

/**
 * The display choice, read through its status node: it is mounted whether or not
 * it says anything (`assign-display.tsx`), so its presence is the choice's.
 */
function assignIsOpen(): boolean {
  return (
    document.body.querySelector("[data-yunari-store-assign-status]") !== null
  );
}

/** What the choice is saying, in the host's own words. */
function assignStatus(): string {
  return (
    must(
      document.body.querySelector<HTMLElement>(
        "[data-yunari-store-assign-status]",
      ),
      "the display choice",
    ).textContent?.trim() ?? ""
  );
}

/** Opens one theme's display choice from its cell. */
async function openAssign(themeId: string): Promise<void> {
  await pressCell(themeId, "assign");
}

/** The choice's own select, which is drawn only once a read has arrived. */
function assignSelect(): HTMLButtonElement {
  return must(
    document.body.querySelector<HTMLButtonElement>(
      "[data-yunari-store-assign-display]",
    ),
    "the display select",
  );
}

/** What the choice's select reports as its value. */
function assignValue(): string {
  return (
    must(
      assignSelect().querySelector<HTMLElement>("[data-yunari-value]"),
      "the display select's value",
    ).getAttribute("data-yunari-value") ?? ""
  );
}

/** The choice's own way out, pressed: the dialog's close control, which is the
 *  one route out of a modal that needs no Escape key (`dialog.tsx`). */
async function closeAssign(): Promise<void> {
  await act(async () =>
    must(
      document.body.querySelector<HTMLButtonElement>(
        ".editor-shell-dialog-close",
      ),
      "the display choice's close control",
    ).click(),
  );
}

/** Opens the choice's own select, which is how a display is reached. */
async function openDisplays(): Promise<void> {
  await act(async () => assignSelect().click());
}

/** Opens the choice and answers the displays it offers, as the ids it would
 *  send — not the words beside them. */
async function offeredDisplays(): Promise<readonly string[]> {
  await openDisplays();
  return Array.from(
    document.body.querySelectorAll<HTMLElement>("[data-yunari-option]"),
  ).map((option) => option.getAttribute("data-yunari-option") ?? "");
}

/** Presses one display inside the select that is open. **Base UI commits a list
 *  item only when the press that precedes the click started on it**, so the
 *  press is part of the interaction rather than a detail of the driver. */
async function chooseDisplay(value: string): Promise<void> {
  const option = must(
    document.body.querySelector<HTMLElement>(`[data-yunari-option="${value}"]`),
    `the ${value} display`,
  );
  await act(async () =>
    option.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerType: "mouse",
        button: 0,
      }),
    ),
  );
  await act(async () =>
    option.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
    ),
  );
}

/** A host holding the two displays the cases below choose between. */
function twoDisplays(): ActiveThemeHost {
  return hostServing({
    answer: {
      default: null,
      displays: [
        {
          id: "this-pc",
          label: "This PC",
          kind: "local",
          theme: null,
          shape: "rect",
          rotation: 0,
        },
        {
          id: "kitchen-tablet",
          label: "Kitchen tablet",
          kind: "paired",
          theme: null,
          shape: "rect",
          rotation: 0,
        },
      ],
    },
  });
}

/**
 * **The cell's third action assigns the theme to the display that was chosen,
 * and to no other.** The request is the body the host reads: one `PUT` carrying
 * the chosen display's key and this theme's id, which is the whole of what the
 * act is.
 */
it("assigns the theme to the display that was chosen and to no other", async () => {
  const host = twoDisplays();
  await mountOver(host);

  await openAssign("living-room");
  await openDisplays();
  await chooseDisplay("kitchen-tablet");

  expect(
    host.writes,
    "the choice did not assign this theme to the display that was chosen, or assigned more than once",
  ).toEqual([{ display: "kitchen-tablet", id: "living-room" }]);
  expect(
    assignIsOpen(),
    "the choice stayed open after the assignment it made",
  ).toBe(false);
});

/**
 * **The default is offered beside the displays, never as one of them.** It is
 * the key a display holding no choice of its own falls to — `assign("default",
 * id)` is a call the host accepts — and it is not a display: a theme id is not a
 * display id, which is why the host answers it as its own field and why the
 * option is the key rather than the theme the default currently holds.
 */
it("offers the default beside the displays rather than as one of them", async () => {
  const host = hostServing({
    answer: {
      // A default that currently holds a theme: the option must still be the
      // key, because that is what `assign` takes.
      default: "porch-strip",
      displays: [
        {
          id: "this-pc",
          label: "This PC",
          kind: "local",
          theme: null,
          shape: "rect",
          rotation: 0,
        },
        {
          id: "kitchen-tablet",
          label: "Kitchen tablet",
          kind: "paired",
          theme: null,
          shape: "rect",
          rotation: 0,
        },
      ],
    },
  });
  await mountOver(host);

  await openAssign("living-room");
  expect(
    await offeredDisplays(),
    "the choice does not offer the default first, beside the displays it was answered",
  ).toEqual(["default", "this-pc", "kitchen-tablet"]);

  await chooseDisplay("default");
  expect(host.writes, "the default is not the key the route accepts").toEqual([
    { display: "default", id: "living-room" },
  ]);
});

/**
 * **A refused assignment is the host's own words**, not a sentence this surface
 * wrote about them: the reason is what says *which* of the two the host would
 * not take, and a generic sentence throws that away. The choice stays where it
 * is, so another display can be tried.
 */
it("reports the host's refusal in the host's own words", async () => {
  const host = hostServing({
    answer: {
      default: null,
      displays: [
        {
          id: "kitchen-tablet",
          label: "Kitchen tablet",
          kind: "paired",
          theme: null,
          shape: "rect",
          rotation: 0,
        },
      ],
    },
    writeRefusal: { status: 404, body: "No such display." },
  });
  await mountOver(host);

  await openAssign("living-room");
  await openDisplays();
  await chooseDisplay("kitchen-tablet");

  expect(assignStatus(), "the refusal is not the message the host sent").toBe(
    "No such display.",
  );
  expect(assignIsOpen(), "a refused assignment closed the choice").toBe(true);
});

/**
 * **A failed read is not an empty list.** The two look identical on screen and
 * mean opposite things — no displays exist, against nobody having answered
 * which do — so a read that failed draws no choice at all and says what the host
 * said, rather than offering the default alone as though that were the answer.
 */
it("offers no choice at all when the read of the displays failed", async () => {
  const host = hostServing({
    readRefusal: {
      status: 403,
      body: "Settings are available on this PC only.",
    },
  });
  await mountOver(host);

  await openAssign("living-room");

  expect(
    assignStatus(),
    "a failed read is not reported as the host's own refusal",
  ).toBe("Settings are available on this PC only.");
  expect(
    document.body.querySelector("[data-yunari-store-assign-display]"),
    "a failed read was drawn as a choice with nothing in it",
  ).toBeNull();
});

/**
 * **The list is the host's answer, read when the choice opens and kept
 * nowhere.** A list this surface held would be a second source of truth about
 * which displays exist, and it would go stale the moment one paired or left — so
 * a display that appears between two openings is offered by the second, and the
 * read happens once per opening rather than once per region.
 */
it("reads the displays each time the choice opens rather than keeping a list", async () => {
  const host = hostServing({
    answer: {
      default: null,
      displays: [
        {
          id: "this-pc",
          label: "This PC",
          kind: "local",
          theme: null,
          shape: "rect",
          rotation: 0,
        },
      ],
    },
  });
  await mountOver(host);

  await openAssign("living-room");
  expect(await offeredDisplays()).toEqual(["default", "this-pc"]);
  await chooseDisplay("this-pc");
  expect(
    host.reads,
    "the choice read the displays more than once per opening",
  ).toBe(1);

  // The host paired a second display while the choice was closed.
  host.answer = {
    default: null,
    displays: [
      {
        id: "this-pc",
        label: "This PC",
        kind: "local",
        theme: null,
        shape: "rect",
        rotation: 0,
      },
      {
        id: "kitchen-tablet",
        label: "Kitchen tablet",
        kind: "paired",
        theme: null,
        shape: "rect",
        rotation: 0,
      },
    ],
  };

  await openAssign("living-room");
  expect(
    await offeredDisplays(),
    "the choice offered a display list it had kept rather than the host's answer",
  ).toEqual(["default", "this-pc", "kitchen-tablet"]);
  expect(host.reads, "the second opening did not read the displays again").toBe(
    2,
  );
});

/**
 * **The value is where the theme already is**: the display whose own choice is
 * this theme. It is the one reading this control can make truthfully before a
 * choice is made, and `""` — no display holding it of its own — is not the same
 * as the default, which is a choice of this control rather than a reading of it.
 */
it("reports where the theme already is as the choice's own value", async () => {
  const host = hostServing({
    answer: {
      default: null,
      displays: [
        {
          id: "this-pc",
          label: "This PC",
          kind: "local",
          theme: "porch-strip",
          shape: "rect",
          rotation: 0,
        },
        {
          id: "kitchen-tablet",
          label: "Kitchen tablet",
          kind: "paired",
          theme: "living-room",
          shape: "rect",
          rotation: 0,
        },
      ],
    },
  });
  await mountOver(host);

  await openAssign("living-room");

  expect(
    assignValue(),
    "the choice does not report the display this theme is already on",
  ).toBe("kitchen-tablet");
});

/**
 * **"Nothing holds this theme" and "this theme is the default" are two states,
 * not one rendering.** `""` is the first — the common path, every theme nothing
 * has been assigned to — and the default's own key is the second, because the
 * host's answer says every display with no choice of its own already gets this
 * theme. The host's `default` field is what tells them apart, and reading `""`
 * for both is a real answer rendered as absence.
 */
it("tells a theme no display holds apart from the theme that is the default", async () => {
  const host = hostServing({
    answer: {
      default: null,
      displays: [
        {
          id: "this-pc",
          label: "This PC",
          kind: "local",
          theme: null,
          shape: "rect",
          rotation: 0,
        },
      ],
    },
  });
  await mountOver(host);

  await openAssign("living-room");
  expect(
    assignValue(),
    "a theme no display holds of its own did not open with nothing chosen",
  ).toBe("");

  await closeAssign();

  // The host's own answer now names this theme as the default.
  host.answer = {
    default: "living-room",
    displays: [
      {
        id: "this-pc",
        label: "This PC",
        kind: "local",
        theme: null,
        shape: "rect",
        rotation: 0,
      },
    ],
  };
  await openAssign("living-room");
  expect(
    assignValue(),
    "the theme the host names as its default opened as though nothing held it",
  ).toBe("default");
});

/**
 * **The modal's footer assign is the same route as the cell's**, because the
 * modal draws the cell's own four actions and reports them through the one
 * callback. Two answers to "what does assign mean" is the state this case
 * exists to keep out.
 *
 * **The page stays.** Ruled 2026-10-31: an author who assigns from a theme's
 * own page is returned to that page, not to the gallery. The choice is drawn
 * inside the modal rather than as a second modal over it, so one Escape still
 * closes one surface and no second scrim stacks.
 */
it("opens the choice inside the modal's own page", async () => {
  const host = twoDisplays();
  await mountOver(host);

  await pressCellSurface("living-room");
  await act(async () =>
    must(
      document.body.querySelector<HTMLButtonElement>(
        "[data-yunari-store-item-action='assign']",
      ),
      "the modal's assign action",
    ).click(),
  );

  expect(
    document.body.querySelector("[data-yunari-store-item-assign]"),
    "the modal's own assign action drew no choice inside the page",
  ).not.toBeNull();
  expect(
    itemIsOpen(),
    "the item's own modal closed instead of keeping the page being read",
  ).toBe(true);
  expect(
    document.body.querySelectorAll(".editor-shell-dialog-overlay").length,
    "two dialog scrims are stacked over the region",
  ).toBe(1);
  expect(await offeredDisplays()).toEqual([
    "default",
    "this-pc",
    "kitchen-tablet",
  ]);
});

/**
 * The ruling's second half: the assignment lands without the page going away,
 * and says where the theme went so the author is not left guessing whether the
 * press did anything.
 */
it("confirms an assignment from the modal beside the choice it made", async () => {
  const host = twoDisplays();
  await mountOver(host);

  await pressCellSurface("living-room");
  await act(async () =>
    must(
      document.body.querySelector<HTMLButtonElement>(
        "[data-yunari-store-item-action='assign']",
      ),
      "the modal's assign action",
    ).click(),
  );
  await openDisplays();
  await chooseDisplay("kitchen-tablet");

  expect(host.writes).toEqual([
    { display: "kitchen-tablet", id: "living-room" },
  ]);
  expect(itemIsOpen(), "the assignment closed the page it was made from").toBe(
    true,
  );
  expect(
    must(
      document.body.querySelector<HTMLElement>(
        "[data-yunari-store-assign-confirmed]",
      ),
      "the assignment's confirmation",
    ).textContent?.trim(),
  ).toBe(uiCopy.store.assign.assigned("Kitchen tablet"));
});

/**
 * The catalogue's listing, as the source reads it: one document of entries, and
 * the same wire shape the index's own owner declares.
 */
function catalogueServing(entries: readonly unknown[]): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        generatedAt: "2026-10-21T00:00:00.000Z",
        entries,
      }),
      { status: 200 },
    )) as unknown as typeof fetch;
}

const CATALOGUE_FACETS = {
  author: "mira-k",
  colourMode: "dark",
  sensors: [],
  tags: [],
  orientation: "landscape",
  aspect: "16:9",
  width: 1920,
  height: 1080,
};

/** One catalogue entry, with its sort facts overridable where a case orders it
 *  rather than merely lists it. */
function catalogueEntry(
  id: string,
  version: string,
  kind = "dashboard-theme",
  facts: {
    readonly createdAt?: string;
    readonly updatedAt?: string;
    readonly downloads?: number;
    readonly favorites?: number;
    readonly name?: string;
  } = {},
): Record<string, unknown> {
  return {
    id,
    kind,
    name: facts.name ?? `Catalogue ${id}`,
    version,
    createdAt: facts.createdAt ?? "2026-10-01T00:00:00.000Z",
    updatedAt: facts.updatedAt ?? "2026-10-14T00:00:00.000Z",
    downloads: facts.downloads ?? 42,
    favorites: facts.favorites ?? 7,
    packageUrl: `https://store.test/${id}.zip`,
    thumbnail: `${id}/thumbnail.png`,
    facets: CATALOGUE_FACETS,
  };
}

/** A library theme the host holds an origin record for: where the online join
 *  reads what this PC installed, and at which catalogue version. */
function fixtureWithOrigin(
  theme: FixtureTheme,
  catalogueId: string,
  version: string,
): ThemeLibraryEntry {
  const origin: ThemeOrigin = {
    catalogueId,
    version,
    installedAt: "2026-10-15T00:00:00.000Z",
  };
  return { ...fixtureEntry(theme), origin };
}

/** One library entry the host holds after an install: what the re-list reads,
 *  and what makes the online item read *Installed*. */
function installedCopy(id: string): ThemeLibraryEntry {
  return fixtureWithOrigin(
    {
      id: `${id}-copy`,
      name: `Catalogue ${id}`,
      version: "1.3.0",
      ground: DARK_GROUND,
    },
    id,
    "1.3.0",
  );
}

/** A host serving the catalogue and the install route, and recording every
 *  install body it received. `hold` keeps each install open so a case can press
 *  another item while the first attempt is in flight; `refusal` answers it with
 *  the host's own sentence. */
function installHost(options: {
  readonly entries: readonly unknown[];
  readonly refusal?: string;
  readonly hold?: boolean;
  readonly onInstall?: () => void;
}): {
  readonly fetch: typeof fetch;
  readonly posts: unknown[];
  readonly resolve: () => void;
  readonly resolveNext: () => void;
} {
  const posts: unknown[] = [];
  const releases: (() => void)[] = [];
  const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) !== "/api/themes/install") {
      return new Response(
        JSON.stringify({
          generatedAt: "2026-10-21T00:00:00.000Z",
          entries: options.entries,
        }),
        { status: 200 },
      );
    }
    posts.push(JSON.parse(String(init?.body)));
    options.onInstall?.();
    if (options.hold === true) {
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
    }
    return options.refusal === undefined
      ? new Response(JSON.stringify({ ok: true, id: "installed" }), {
          status: 200,
        })
      : new Response(options.refusal, { status: 400 });
  }) as unknown as typeof fetch;

  return {
    fetch: fetchStub,
    posts,
    // Every install held by this host, so a case with two in flight releases
    // both rather than leaking the one it did not press.
    resolve: () => {
      for (const release of releases.splice(0)) release();
    },
    // The install held first, so a case can finish one of two in flight.
    resolveNext: () => releases.shift()?.(),
  };
}

/** The cell's install control, or the failure that it drew none. */
function installControl(id: string): HTMLButtonElement {
  return must(
    document.body.querySelector<HTMLButtonElement>(
      `[data-yunari-store-cell="${id}"] button[data-yunari-store-cell-install]`,
    ),
    `${id}'s install control`,
  );
}

/** Lets a press's promise chain — the post, the re-list and the state it sets —
 *  finish before the assertion reads the grid. */
async function settle(): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** The online half chosen, and the catalogue read settled before the assertion
 *  reads the grid. */
async function showOnline(): Promise<void> {
  await act(async () => halves(headerRow(document.body))[1]?.click());
  await act(async () => {});
}

/** One install reading per drawn cell, in the grid's order. */
function installReadings(): readonly (readonly [
  string | null,
  string | null,
])[] {
  return cells().map((cell) => [
    cell.getAttribute("data-yunari-store-cell"),
    cell
      .querySelector("[data-yunari-store-cell-install]")
      ?.getAttribute("data-yunari-store-cell-install") ?? null,
  ]);
}

/**
 * **The online half lists the catalogue** where it used to list nothing, and
 * choosing the local half back draws the library unchanged: the two listings are
 * separate facts, and a half that kept the other's items would be a store that
 * showed the catalogue under *Your themes*.
 */
it("lists the catalogue on the online half and the library on the local one", async () => {
  vi.stubGlobal(
    "fetch",
    catalogueServing([catalogueEntry("office-wall", "1.3.0")]),
  );
  await mountStore([
    fixtureEntry({
      id: "living-room",
      name: "Living room",
      ground: DARK_GROUND,
    }),
  ]);

  expect(
    cells().map((cell) => cell.getAttribute("data-yunari-store-cell")),
    "the local half does not list the library",
  ).toEqual(["living-room"]);

  await showOnline();

  expect(
    cells().map((cell) => cell.getAttribute("data-yunari-store-cell")),
    "the online half lists nothing",
  ).toEqual(["office-wall"]);

  await act(async () => halves(headerRow(document.body))[0]?.click());

  expect(
    cells().map((cell) => cell.getAttribute("data-yunari-store-cell")),
    "the local half changed when the catalogue arrived",
  ).toEqual(["living-room"]);
});

/**
 * **Each of the online half's four keys reorders the catalogue**, and the
 * default is `updated` newest first: a person who chooses *Most downloaded* and
 * sees the list unmoved has been told their choice did nothing.
 *
 * The wire order is `bac`, which is none of the four expected orders and none
 * of the half's default, so a comparator that compares nothing leaves the list
 * visibly wrong for every key rather than passing on a lucky coincidence.
 */
it("reorders the catalogue by each of its four keys", async () => {
  vi.stubGlobal(
    "fetch",
    catalogueServing([
      catalogueEntry("b", "1.0.0", "dashboard-theme", {
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        downloads: 30,
        favorites: 3,
      }),
      catalogueEntry("a", "1.0.0", "dashboard-theme", {
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-02-02T00:00:00.000Z",
        downloads: 10,
        favorites: 9,
      }),
      catalogueEntry("c", "1.0.0", "dashboard-theme", {
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-03-02T00:00:00.000Z",
        downloads: 20,
        favorites: 6,
      }),
    ]),
  );
  await mountStore([]);
  await showOnline();

  expect(
    drawnIds(),
    "the online half does not open on its default — newest update first",
  ).toEqual(["c", "a", "b"]);

  await chooseSort("created");
  expect(
    drawnIds(),
    "sorting the catalogue by created did not reorder it",
  ).toEqual(["a", "b", "c"]);

  await chooseSort("downloads");
  expect(
    drawnIds(),
    "sorting the catalogue by downloads did not reorder it",
  ).toEqual(["b", "c", "a"]);

  await chooseSort("favorites");
  expect(
    drawnIds(),
    "sorting the catalogue by favorites did not reorder it",
  ).toEqual(["a", "c", "b"]);
});

/**
 * **The join is against the library's origin record**, not the document's own
 * version: what the catalogue says this PC installed is `origin.version`, and a
 * library copy whose document has since been edited past that version is still
 * the catalogue's older copy. The `held-older` case is the one that tells the
 * two apart — its document declares `1.3.0` while the origin says `1.2.0`, so a
 * join reading the document answers *Installed* where the truth is *Update*.
 */
it("joins the catalogue against the library's origins, not its documents", async () => {
  vi.stubGlobal(
    "fetch",
    catalogueServing([
      catalogueEntry("held-same", "1.3.0"),
      catalogueEntry("held-older", "1.3.0"),
      catalogueEntry("not-held", "1.3.0"),
    ]),
  );
  await mountStore([
    fixtureWithOrigin(
      { id: "same-copy", name: "Same", version: "1.3.0", ground: DARK_GROUND },
      "held-same",
      "1.3.0",
    ),
    fixtureWithOrigin(
      {
        id: "older-copy",
        name: "Older",
        version: "1.3.0",
        ground: DARK_GROUND,
      },
      "held-older",
      "1.2.0",
    ),
  ]);

  await showOnline();

  expect(
    installReadings(),
    "the catalogue was not joined against the library's origin versions",
  ).toEqual([
    ["held-same", "installed"],
    ["held-older", "update"],
    ["not-held", "install"],
  ]);
});

/**
 * **An empty catalogue is not an empty library** (R124, one half over): before
 * the catalogue is published this is the *normal* state, so it must say the
 * store has nothing rather than telling someone with forty themes their library
 * is empty.
 */
it("says the store has nothing yet in its own words", async () => {
  vi.stubGlobal("fetch", catalogueServing([]));
  await mountStore([]);

  await showOnline();

  const empty = must(
    document.body.querySelector<HTMLElement>("[data-yunari-store-empty]"),
    "empty catalogue state",
  );
  expect(
    empty.textContent,
    "an empty catalogue does not say the store has nothing",
  ).toContain(uiCopy.store.empty.catalogue);
  expect(
    empty.textContent,
    "an empty catalogue tells the reader their library is empty",
  ).not.toContain(uiCopy.store.empty.library);
});

/**
 * **An all-refused catalogue is not "the store has nothing yet"**: the grid is
 * empty because everything in it was unreadable, and the refusal line is the
 * sentence that says so. Drawing both would print two contradictory claims.
 */
it("draws only the refusal line when every catalogue entry was refused", async () => {
  vi.stubGlobal(
    "fetch",
    catalogueServing([catalogueEntry("widget", "1.0.0", "widget-preset")]),
  );
  await mountStore([]);

  await showOnline();

  expect(
    document.body.querySelector("[data-yunari-store-empty]"),
    "an all-refused catalogue draws the empty-catalogue sentence",
  ).toBeNull();
  expect(
    must(
      document.body.querySelector<HTMLElement>("[data-yunari-store-refusal]"),
      "refusal line",
    ).textContent,
    "the refusal line does not say what the catalogue held",
  ).toBe(uiCopy.store.catalogueRefused("widget-preset", 1));
});

/**
 * **The skipped-kind line names the identifier the catalogue used**, never a
 * display word: this build has no vocabulary for `widget-preset`, and inventing
 * one would be the word for something nothing declared. The line sits below the
 * grid and above the pager, where the surface puts it.
 */
it("names the identifier of a kind the store skipped", async () => {
  vi.stubGlobal(
    "fetch",
    catalogueServing([
      catalogueEntry("office-wall", "1.3.0"),
      catalogueEntry("widget", "1.0.0", "widget-preset"),
    ]),
  );
  await mountStore([]);

  await showOnline();

  const line = must(
    document.body.querySelector<HTMLElement>("[data-yunari-store-refusal]"),
    "refusal line",
  );
  expect(
    line.textContent,
    "the refusal does not name the kind the catalogue declared",
  ).toBe(uiCopy.store.catalogueRefused("widget-preset", 1));
  expect(
    line.textContent,
    "the refusal line does not print the wire identifier",
  ).toContain("widget-preset");

  const follows = (first: Node, second: Node): boolean =>
    (first.compareDocumentPosition(second) &
      Node.DOCUMENT_POSITION_FOLLOWING) !==
    0;
  expect(
    follows(
      must(
        document.body.querySelector("[data-yunari-store-gallery]"),
        "gallery",
      ),
      line,
    ),
    "the refusal line is not below the grid",
  ).toBe(true);
  expect(
    follows(
      line,
      must(document.body.querySelector("[data-yunari-store-pager]"), "pager"),
    ),
    "the refusal line is not above the pager",
  ).toBe(true);
});

/**
 * **A failed read is not an empty catalogue.** The two look the same on screen
 * and mean opposite things — nothing published against nobody having answered —
 * so the listing stays unset and the body draws nothing, exactly as the local
 * half does (`:558-563`).
 */
it("leaves the online half unset when the catalogue read failed", async () => {
  await mountStore([]);

  await showOnline();

  expect(cells(), "a failed read was drawn as a listing").toEqual([]);
  expect(
    document.body.querySelector("[data-yunari-store-empty]"),
    "a failed read was drawn as an empty catalogue",
  ).toBeNull();
  expect(
    document.body.querySelector("[data-yunari-store-refusal]"),
    "a failed read claimed something it could not read",
  ).toBeNull();
});

/**
 * **The cell's Install posts the item once and the cell then reads
 * Installed** — from the listing, not from a flag kept in the cell: the host
 * records the origin, the region re-lists, and the join answers the word.
 */
it("installs from the cell's Install and re-lists so the cell reads Installed", async () => {
  const library: ThemeLibraryEntry[] = [];
  const host = installHost({
    entries: [catalogueEntry("office-wall", "1.3.0")],
    onInstall: () => library.push(installedCopy("office-wall")),
  });
  vi.stubGlobal("fetch", host.fetch);
  await mountStore(library);
  await showOnline();

  await act(async () => installControl("office-wall").click());
  await settle();

  expect(
    host.posts,
    "the cell's Install did not post the item once, with the four facts the host needs",
  ).toEqual([
    {
      packageUrl: "https://store.test/office-wall.zip",
      catalogueId: "office-wall",
      version: "1.3.0",
      kind: "dashboard-theme",
    },
  ]);
  expect(
    installReadings(),
    "the cell still offers Install after the re-list gained the copy",
  ).toEqual([["office-wall", "installed"]]);
  expect(
    document.body.querySelector('[data-yunari-store-cell="office-wall"]')
      ?.textContent,
    "the cell does not read the listing's own word after the install",
  ).toContain(uiCopy.store.cell.installStates.installed);
});

/**
 * **A completed install is announced, not only drawn.** The cell redraws as
 * *Installed*; a screen reader that cannot see that redraw hears one sentence
 * naming the item, through the same single live region a refusal uses.
 */
it("announces a completed install through the live region", async () => {
  const library: ThemeLibraryEntry[] = [];
  const host = installHost({
    entries: [catalogueEntry("office-wall", "1.3.0")],
    onInstall: () => library.push(installedCopy("office-wall")),
  });
  vi.stubGlobal("fetch", host.fetch);
  await mountStore(library);
  await showOnline();

  await act(async () => installControl("office-wall").click());
  await settle();

  const live = Array.from(
    document.body.querySelectorAll<HTMLElement>('[role="status"]'),
  );
  expect(
    live,
    "the install is announced in more than one live region",
  ).toHaveLength(1);
  expect(
    live[0]?.textContent,
    "a completed install reached no live region",
  ).toBe(uiCopy.store.install.installed("Catalogue office-wall"));
});

/**
 * **A new press clears the last success**, so the region is not still saying
 * the previous item landed while another one is in flight.
 */
it("clears a completed install's announcement when the next press starts", async () => {
  const host = installHost({
    entries: [
      catalogueEntry("office-wall", "1.3.0"),
      catalogueEntry("living-room", "1.4.0"),
    ],
    hold: true,
  });
  vi.stubGlobal("fetch", host.fetch);
  await mountStore([]);
  await showOnline();

  await act(async () => installControl("office-wall").click());
  await act(async () => host.resolveNext());
  await settle();

  const live = () =>
    must(
      document.body.querySelector<HTMLElement>('[role="status"]'),
      "the live region",
    ).textContent;
  expect(live(), "the completed install was not announced").toBe(
    uiCopy.store.install.installed("Catalogue office-wall"),
  );

  await act(async () => installControl("living-room").click());
  expect(live(), "the previous install's success survived the next press").toBe(
    "",
  );

  await act(async () => host.resolve());
  await settle();
});

/**
 * **The modal's Install is the same route as the cell's**: one post, and the
 * modal then reads *Installed* from the re-listed item it was opened on rather
 * than from a state it kept.
 */
it("installs from the modal's Install and the modal then reads Installed", async () => {
  const library: ThemeLibraryEntry[] = [];
  const host = installHost({
    entries: [catalogueEntry("office-wall", "1.3.0")],
    onInstall: () => library.push(installedCopy("office-wall")),
  });
  vi.stubGlobal("fetch", host.fetch);
  await mountStore(library);
  await showOnline();
  await pressCellSurface("office-wall");

  await act(async () =>
    must(
      document.body.querySelector<HTMLButtonElement>(
        '[data-yunari-store-item-install="install"]',
      ),
      "the modal's install control",
    ).click(),
  );
  await settle();

  expect(
    host.posts,
    "the modal's Install did not post the item once",
  ).toHaveLength(1);
  expect(
    must(
      document.body.querySelector<HTMLElement>(
        '[data-yunari-store-item-install="installed"]',
      ),
      "the modal's installed mark",
    ).tagName,
    "the modal still draws a control after the copy was installed",
  ).toBe("SPAN");
});

/**
 * **A press in flight disables the control**, so a second press cannot post a
 * second install: the one attempt is still open when the second press lands.
 */
it("posts nothing on a second press while the first is in flight", async () => {
  const library: ThemeLibraryEntry[] = [];
  const host = installHost({
    entries: [catalogueEntry("office-wall", "1.3.0")],
    hold: true,
    onInstall: () => library.push(installedCopy("office-wall")),
  });
  vi.stubGlobal("fetch", host.fetch);
  await mountStore(library);
  await showOnline();

  await act(async () => installControl("office-wall").click());
  expect(
    installControl("office-wall").disabled,
    "the control is still pressable while its first press is in flight",
  ).toBe(true);

  await act(async () => installControl("office-wall").click());
  expect(
    host.posts,
    "a second press while the first is in flight posted a second install",
  ).toHaveLength(1);

  await act(async () => host.resolve());
  await settle();
  expect(host.posts, "the settled install posted more than once").toHaveLength(
    1,
  );
});

/**
 * **A refusal changes nothing but its reason**: the control returns to the
 * state the listing gave it, and the host's own sentence is stated beside it
 * rather than swallowed.
 */
it("leaves the control as it was and states the host's reason when the install is refused", async () => {
  const library: ThemeLibraryEntry[] = [];
  const host = installHost({
    entries: [catalogueEntry("office-wall", "1.3.0")],
    refusal: "That package is not a theme.",
  });
  vi.stubGlobal("fetch", host.fetch);
  await mountStore(library);
  await showOnline();

  await act(async () => installControl("office-wall").click());
  await settle();

  expect(installReadings(), "a refused install moved the item's state").toEqual(
    [["office-wall", "install"]],
  );
  expect(
    installControl("office-wall").disabled,
    "a refused install left the control dead",
  ).toBe(false);
  expect(
    must(
      document.body.querySelector<HTMLElement>(
        "[data-yunari-store-cell-install-refusal]",
      ),
      "the refusal reason",
    ).textContent,
    "the refusal is not the host's own sentence",
  ).toBe("That package is not a theme.");
});

/** The catalogue id each install body named, in the order the host received
 *  them. */
function postedIds(posts: readonly unknown[]): readonly string[] {
  return posts.map(
    (post) => (post as { readonly catalogueId: string }).catalogueId,
  );
}

/**
 * **Each in-flight install keeps its own busy state.** Pressing a second item
 * must not re-enable the first one's control: the two are separate requests, and
 * a repeat press of the first has to post nothing while its own request is open.
 */
it("keeps both items busy when two installs are in flight", async () => {
  const library: ThemeLibraryEntry[] = [];
  const host = installHost({
    entries: [
      catalogueEntry("office-wall", "1.3.0"),
      catalogueEntry("living-room", "1.4.0"),
    ],
    hold: true,
  });
  vi.stubGlobal("fetch", host.fetch);
  await mountStore(library);
  await showOnline();

  await act(async () => installControl("office-wall").click());
  await act(async () => installControl("living-room").click());

  expect(
    installControl("office-wall").disabled,
    "the first item's control re-enabled when the second item was pressed",
  ).toBe(true);
  expect(
    installControl("living-room").disabled,
    "the second item's control is not busy while it installs",
  ).toBe(true);

  await act(async () => installControl("office-wall").click());
  expect(
    postedIds(host.posts),
    "a repeat press of an item already in flight posted a second install",
  ).toEqual(["office-wall", "living-room"]);

  await act(async () => host.resolve());
  await settle();
  expect(
    host.posts,
    "the settled installs posted more than twice",
  ).toHaveLength(2);
});

/**
 * **The handler refuses a second press of the same item in one tick**, before
 * the control's `disabled` has committed: two presses in one act see the same
 * rendered props, so the guard has to read the in-flight set rather than state.
 */
it("posts once for two presses of the same item in one tick", async () => {
  const library: ThemeLibraryEntry[] = [];
  const host = installHost({
    entries: [catalogueEntry("office-wall", "1.3.0")],
    hold: true,
  });
  vi.stubGlobal("fetch", host.fetch);
  await mountStore(library);
  await showOnline();

  await act(async () => {
    installControl("office-wall").click();
    installControl("office-wall").click();
  });
  expect(
    host.posts,
    "two presses in one tick posted two installs of the same item",
  ).toHaveLength(1);

  await act(async () => host.resolve());
  await settle();
});

/**
 * **The refusal is announced once, through the region's own live region.** The
 * cell and the item's modal both draw the sentence (the modal is open and the
 * gallery is still mounted underneath it), and neither may be a live region:
 * exactly one `role="status"` node exists, and it carries the host's words.
 */
it("announces a refusal once while its cell and its modal both draw it", async () => {
  const host = installHost({
    entries: [catalogueEntry("office-wall", "1.3.0")],
    refusal: "That package is not a theme.",
  });
  vi.stubGlobal("fetch", host.fetch);
  await mountStore([]);
  await showOnline();
  await pressCellSurface("office-wall");

  await act(async () =>
    must(
      document.body.querySelector<HTMLButtonElement>(
        '[data-yunari-store-item-install="install"]',
      ),
      "the modal's install control",
    ).click(),
  );
  await settle();

  expect(
    must(
      document.body.querySelector<HTMLElement>(
        "[data-yunari-store-cell-install-refusal]",
      ),
      "the cell's refusal sentence",
    ).textContent,
    "the cell does not draw the reason beside its own control",
  ).toBe("That package is not a theme.");
  const live = Array.from(
    document.body.querySelectorAll<HTMLElement>('[role="status"]'),
  );
  expect(
    live,
    "the same refusal is held in more than one live region",
  ).toHaveLength(1);
  expect(
    live[0]?.textContent,
    "the one live region does not carry the host's sentence",
  ).toBe("That package is not a theme.");
  // Base UI's `markOthers` spares only `[aria-live]` nodes and their ancestors
  // when the modal hides what is outside it, so `role="status"` alone would be
  // hidden under the open modal and the refusal would reach no live region.
  expect(
    live[0]?.getAttribute("aria-live"),
    "the live region is not spared by the modal's outside-hiding",
  ).toBe("polite");
});

/**
 * **A successful install whose re-list fails is not silence.** The host holds
 * the theme, so the cell cannot claim nothing happened; the surface says the
 * library could not be refreshed rather than returning to *Install* with no
 * word.
 */
it("says the theme was installed when the re-list fails", async () => {
  const host = installHost({
    entries: [catalogueEntry("office-wall", "1.3.0")],
  });
  vi.stubGlobal("fetch", host.fetch);

  let lists = 0;
  const client: ThemeLibraryClient = {
    list: async () => {
      lists += 1;
      if (lists > 1) throw new Error("the library could not be read");
      return [];
    },
    open: () => Promise.reject(new Error("the region lists; the shell opens")),
    save: () => Promise.reject(new Error("the store does not save")),
    assign: () => Promise.reject(new Error("the store does not assign")),
    listDisplays: async () => ({ default: null, displays: [] }),
  };
  await mount(<StoreModeRegion mode="themes" client={client} />);
  await showOnline();

  await act(async () => installControl("office-wall").click());
  await settle();

  expect(host.posts, "the install was not posted").toHaveLength(1);
  expect(
    must(
      document.body.querySelector<HTMLElement>(
        "[data-yunari-store-cell-install-refusal]",
      ),
      "the re-list failure's sentence",
    ).textContent,
    "a failed re-list left the person with no word about the install",
  ).toBe(uiCopy.store.install.notRefreshed);
  expect(
    installReadings(),
    "the cell moved to installed without a listing to read it from",
  ).toEqual([["office-wall", "install"]]);
  // The success sentence was already set when the re-list failed; the refusal
  // has to outrank it, or a screen reader hears "installed" and nothing else.
  expect(
    must(
      document.body.querySelector<HTMLElement>(
        "[data-yunari-store-install-announcement]",
      ),
      "the live region",
    ).textContent,
    "the live region announced the success and not the failed re-list",
  ).toBe(uiCopy.store.install.notRefreshed);
});

/**
 * **A completion clears only its own busy state.** The first of two installs to
 * finish must re-enable its own control and leave the other one disabled while
 * its request is still open.
 */
it("leaves the other item busy when one of two installs finishes", async () => {
  const library: ThemeLibraryEntry[] = [];
  const host = installHost({
    entries: [
      catalogueEntry("office-wall", "1.3.0"),
      catalogueEntry("living-room", "1.4.0"),
    ],
    hold: true,
  });
  vi.stubGlobal("fetch", host.fetch);
  await mountStore(library);
  await showOnline();

  await act(async () => installControl("office-wall").click());
  await act(async () => installControl("living-room").click());
  await act(async () => host.resolveNext());
  await settle();

  expect(
    installControl("office-wall").disabled,
    "the finished item's control stayed busy after its own install settled",
  ).toBe(false);
  expect(
    installControl("living-room").disabled,
    "the other item's control re-enabled when a different install finished",
  ).toBe(true);

  await act(async () => host.resolve());
  await settle();
});

/**
 * **A library item never carries a catalogue refusal**, even when its id equals
 * the refused catalogue item's: the sentence draws only for an item with
 * catalogue facts, because only those draw the control it belongs beside.
 */
it("draws no catalogue refusal on a library item whose id collides", async () => {
  const host = installHost({
    entries: [catalogueEntry("office-wall", "1.3.0")],
    refusal: "That package is not a theme.",
  });
  vi.stubGlobal("fetch", host.fetch);
  await mountStore([
    fixtureEntry({
      id: "office-wall",
      name: "Local copy",
      ground: DARK_GROUND,
    }),
  ]);
  await showOnline();

  await act(async () => installControl("office-wall").click());
  await settle();
  expect(
    must(
      document.body.querySelector<HTMLElement>(
        "[data-yunari-store-cell-install-refusal]",
      ),
      "the catalogue cell's refusal",
    ).textContent,
    "the refused catalogue install is not stated",
  ).toBe("That package is not a theme.");

  await act(async () => halves(headerRow(document.body))[0]?.click());
  await act(async () => {});

  const local = must(
    document.body.querySelector<HTMLElement>(
      '[data-yunari-store-cell="office-wall"]',
    ),
    "the local cell whose id collides",
  );
  expect(
    local.querySelector("[data-yunari-store-cell-install-refusal]"),
    "a library item drew a catalogue refusal it has no control for",
  ).toBeNull();
});

/**
 * **A press that rejects still releases its control.** `installItem` answers
 * rather than throwing for every refusal it can name, but one path escapes
 * before its own try: an environment with no `fetch` to bind. A busy flag
 * nobody clears would disable that cell for the rest of the session, so the
 * release rides `finally` rather than the success arm.
 */
it("releases the control when the press rejects rather than answering", async () => {
  const host = installHost({
    entries: [catalogueEntry("office-wall", "1.3.0")],
  });
  vi.stubGlobal("fetch", host.fetch);
  await mountStore([]);
  await showOnline();

  vi.stubGlobal("fetch", undefined);
  await act(async () => installControl("office-wall").click());
  await settle();

  expect(
    installControl("office-wall").disabled,
    "the control stayed busy after a press that rejected",
  ).toBe(false);
  expect(
    must(
      document.body.querySelector<HTMLElement>(
        "[data-yunari-store-cell-install-refusal]",
      ),
      "the rejected press's sentence",
    ).textContent,
    "a rejected press stated nothing",
  ).not.toBe("");
});

/**
 * The submission routes the editor's own surface reaches: each `submit` answer
 * is drawn in turn, and the last one repeats, so a case can say *the second
 * submit* rather than counting whichever answer came back. The sign-in start and
 * the session probe answer once each unless a case says otherwise.
 */
function submitHost(options: {
  readonly submit: readonly Response[];
  readonly start?: Response;
  readonly session?: readonly Response[];
}): {
  readonly fetch: typeof fetch;
  readonly calls: string[];
  readonly polls: () => number;
} {
  const calls: string[] = [];
  const submits = [...options.submit];
  const sessions = [...(options.session ?? [])];
  let polled = 0;
  const fetchStub = (async (input: RequestInfo | URL) => {
    const path = String(input);
    calls.push(path);
    if (path === "/api/themes/submit") {
      const answer = submits.length > 1 ? submits.shift() : submits[0];
      return answer?.clone() ?? new Response("", { status: 500 });
    }
    if (path === "/api/store/auth/start") {
      return (
        options.start?.clone() ??
        new Response(JSON.stringify({ url: SIGN_IN_URL }), { status: 200 })
      );
    }
    if (path === "/api/store/session") {
      polled += 1;
      const answer = sessions.length > 1 ? sessions.shift() : sessions[0];
      return (
        answer?.clone() ??
        new Response(JSON.stringify({ signedIn: false }), { status: 200 })
      );
    }
    return new Response("Not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetch: fetchStub, calls, polls: () => polled };
}

/** The host's sign-in address, as `POST /api/store/auth/start` answers it. */
const SIGN_IN_URL = "https://store.test/auth/start?provider=github";

/** The one popup the flow opens, so a case can watch it close once the host
 *  holds the session. */
function signInPopup(): { readonly closed: boolean; readonly close: unknown } {
  return { closed: false, close: vi.fn() };
}

/** The modal's Submit control, or the failure that the library half draws none. */
function submitControl(): HTMLButtonElement {
  return must(
    document.body.querySelector<HTMLButtonElement>(
      "[data-yunari-store-item-submit]",
    ),
    "the modal's submit control",
  );
}

/** One press of the modal's Submit. */
async function pressSubmit(): Promise<void> {
  await act(async () => submitControl().click());
}

/** What the region's one live region is saying. */
function liveRegion(): string {
  return (
    must(
      document.body.querySelector<HTMLElement>(
        "[data-yunari-store-install-announcement]",
      ),
      "the live region",
    ).textContent ?? ""
  );
}

/** One library theme, its own surface opened, ready for a submission press. */
async function mountAndOpen(): Promise<void> {
  await mountStore([
    fixtureEntry({
      id: "living-room",
      name: "Living room",
      ground: DARK_GROUND,
    }),
  ]);
  await pressCellSurface("living-room");
}

/**
 * **A missing identity opens the host's sign-in window and nothing else.** The
 * host answers `401`; the surface asks the host for the address, opens that
 * window, and says the author's part — finish signing in. The browser never sees
 * a token, and no code is printed here because the host's own window holds the
 * conversation.
 */
it("opens the host's sign-in window and waits for the session", async () => {
  vi.useFakeTimers();
  const popup = signInPopup();
  const open = vi.fn((..._args: unknown[]) => popup as never);
  vi.stubGlobal("open", open);
  const host = submitHost({
    submit: [
      new Response(
        JSON.stringify({ ok: false, message: "Sign in to the store." }),
        { status: 401 },
      ),
    ],
  });
  vi.stubGlobal("fetch", host.fetch);
  await mountAndOpen();

  await pressSubmit();
  await settle();

  expect(
    open.mock.calls.map((call) => call[0]),
    "the surface did not open the address the host answered",
  ).toEqual([SIGN_IN_URL]);
  expect(
    host.calls,
    "the surface did not ask the host to start a sign-in",
  ).toContain("/api/store/auth/start");
  expect(
    document.body.querySelector("[data-yunari-store-item-submit-code]"),
    "the surface printed a device code the host no longer sends",
  ).toBeNull();
  expect(liveRegion(), "the authorising state reached no live region").toBe(
    uiCopy.store.submit.announcement(
      "Living room",
      uiCopy.store.submit.authorising,
    ),
  );
  expect(
    submitControl().textContent?.trim(),
    "the control does not state the author's part while the window is open",
  ).toBe(uiCopy.store.submit.authorising);
});

/**
 * **A poll that answers signed in retries the submission once**, and the retry's
 * answer names the state and version: the control states them, closes the
 * sign-in window, cannot be pressed again, and the library is read again so the
 * listing carries that version.
 */
it("retries the submission once the session lands and shows the status word", async () => {
  vi.useFakeTimers();
  const popup = signInPopup();
  vi.stubGlobal(
    "open",
    vi.fn(() => popup as never),
  );
  const host = submitHost({
    submit: [
      new Response(
        JSON.stringify({ ok: false, message: "Sign in to the store." }),
        { status: 401 },
      ),
      new Response(
        JSON.stringify({
          ok: true,
          status: "pending",
          version: { from: "1.4.0", to: "1.5.0", level: "minor" },
        }),
        { status: 200 },
      ),
    ],
    session: [
      new Response(
        JSON.stringify({ signedIn: true, email: "author@example.test" }),
        { status: 200 },
      ),
    ],
  });
  vi.stubGlobal("fetch", host.fetch);
  let lists = 0;
  await mountStore(
    [
      fixtureEntry({
        id: "living-room",
        name: "Living room",
        ground: DARK_GROUND,
      }),
    ],
    undefined,
    () => {
      lists += 1;
    },
  );
  await pressCellSurface("living-room");
  const listedBefore = lists;

  await pressSubmit();
  await settle();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
  await settle();

  expect(
    popup.close,
    "the sign-in window was left open after the host held the session",
  ).toHaveBeenCalledTimes(1);
  expect(
    must(
      document.body.querySelector<HTMLElement>(
        "[data-yunari-store-item-submit-status]",
      ),
      "the status word",
    ).textContent,
    "the footer does not state the state the store landed",
  ).toBe(uiCopy.store.status.pending);
  expect(
    must(
      document.body.querySelector<HTMLElement>(
        "[data-yunari-store-item-submit-version]",
      ),
      "the version sentence",
    ).textContent,
    "the footer does not name the version the host published",
  ).toBe(
    uiCopy.store.submit.version({
      from: "1.4.0",
      to: "1.5.0",
      level: "minor",
    }),
  );
  expect(
    lists,
    "the library was not read again after the submission landed",
  ).toBe(listedBefore + 1);
  expect(
    host.calls.filter((call) => call === "/api/themes/submit"),
    "the session's landing did not retry the submission exactly once",
  ).toHaveLength(2);
  expect(
    submitControl().disabled,
    "the control is still pressable after the submission landed",
  ).toBe(true);
  expect(liveRegion(), "the submitted state reached no live region").toBe(
    uiCopy.store.submit.announcement(
      "Living room",
      uiCopy.store.submit.submitted("pending"),
    ),
  );
});

/**
 * **A refusal is the host's own sentence**, stated beside the control, and the
 * control can be pressed again — the reason says which part of the submission
 * failed, so a sentence composed here would hide it.
 */
it("states the host's refusal beside the control and re-enables it", async () => {
  const refusal = "That theme has no picture to put in the store.";
  vi.stubGlobal(
    "fetch",
    submitHost({
      submit: [new Response(refusal, { status: 422 })],
    }).fetch,
  );
  await mountAndOpen();

  await pressSubmit();
  await settle();

  expect(
    must(
      document.body.querySelector<HTMLElement>(
        "[data-yunari-store-item-submit-refusal]",
      ),
      "the submit refusal",
    ).textContent,
    "the refusal is not the host's own sentence",
  ).toBe(refusal);
  expect(
    submitControl().disabled,
    "a refused submission left the control dead",
  ).toBe(false);
  expect(
    liveRegion(),
    "the refusal did not outrank the state it interrupted",
  ).toBe(uiCopy.store.submit.announcement("Living room", refusal));
});

/**
 * **One theme's submission answer belongs to that theme.** The flow lives on
 * the region and outlives the modal, so a state kept without an id would draw
 * theme A's refusal or link on theme B and disable B's control with A's
 * success; the id travels with the state for that reason.
 */
it("keeps one theme's submission answer off another theme's surface", async () => {
  const refusal = "That theme has no picture to put in the store.";
  vi.stubGlobal(
    "fetch",
    submitHost({
      submit: [new Response(refusal, { status: 422 })],
    }).fetch,
  );
  await mountStore([
    fixtureEntry({
      id: "living-room",
      name: "Living room",
      ground: DARK_GROUND,
    }),
    fixtureEntry({
      id: "office-wall",
      name: "Office wall",
      ground: DARK_GROUND,
    }),
  ]);

  await pressCellSurface("living-room");
  await pressSubmit();
  await settle();
  expect(
    document.body.querySelector("[data-yunari-store-item-submit-refusal]"),
    "the theme that was refused stated nothing",
  ).not.toBeNull();

  await closeItem();
  await pressCellSurface("office-wall");

  expect(
    document.body.querySelector("[data-yunari-store-item-submit-refusal]"),
    "another theme's refusal is drawn on this theme",
  ).toBeNull();
  expect(
    submitControl().disabled,
    "another theme's refusal disabled this theme's control",
  ).toBe(false);

  // The answer is kept for the theme it belongs to, not discarded.
  await closeItem();
  await pressCellSurface("living-room");
  expect(
    must(
      document.body.querySelector<HTMLElement>(
        "[data-yunari-store-item-submit-refusal]",
      ),
      "the refused theme's own sentence",
    ).textContent,
  ).toBe(refusal);
});

/**
 * **Another theme's Submit is drawn busy while one submission is in flight.**
 * The region holds one flow at a time, so a press on B while A authorises would
 * meet the guard and do nothing. The control says that instead of looking
 * pressable: disabled, `aria-busy`, and the busy sentence — over the whole
 * authorisation window, not only after A's flow has ended.
 */
it("draws another theme's Submit busy while a submission is in flight", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "open",
    vi.fn(() => signInPopup() as never),
  );
  const host = submitHost({
    submit: [
      new Response(
        JSON.stringify({ ok: false, message: "Sign in to the store." }),
        { status: 401 },
      ),
    ],
  });
  vi.stubGlobal("fetch", host.fetch);
  await mountStore([
    fixtureEntry({
      id: "living-room",
      name: "Living room",
      ground: DARK_GROUND,
    }),
    fixtureEntry({
      id: "office-wall",
      name: "Office wall",
      ground: DARK_GROUND,
    }),
  ]);

  await pressCellSurface("living-room");
  await pressSubmit();
  await settle();
  expect(
    host.calls,
    "A did not reach the authorising window the case is about",
  ).toContain("/api/store/auth/start");

  await closeItem();
  await pressCellSurface("office-wall");

  const control = submitControl();
  expect(
    control.disabled,
    "B's Submit is pressable while A's submission is in flight",
  ).toBe(true);
  expect(
    control.getAttribute("aria-busy"),
    "B's Submit is not drawn busy while A's submission is in flight",
  ).toBe("true");
  expect(
    control.textContent?.trim(),
    "B's Submit does not state the busy sentence",
  ).toBe(uiCopy.store.submit.busy);

  const submits = (): number =>
    host.calls.filter((call) => call === "/api/themes/submit").length;
  const before = submits();
  await act(async () => control.click());
  await settle();
  expect(
    submits(),
    "a press on B sent a submission while A's flow still held the guard",
  ).toBe(before);
});

/**
 * **A sign-in the host never confirms is a refusal the surface can name**,
 * because the poll answers without a sentence: after five minutes the author is
 * told to submit again, and the control is their way to.
 */
it("states an unconfirmed sign-in and lets the author submit again", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "open",
    vi.fn(() => signInPopup() as never),
  );
  vi.stubGlobal(
    "fetch",
    submitHost({
      submit: [
        new Response(
          JSON.stringify({ ok: false, message: "Sign in to the store." }),
          { status: 401 },
        ),
      ],
      session: [
        new Response(JSON.stringify({ signedIn: false }), { status: 200 }),
      ],
    }).fetch,
  );
  await mountAndOpen();

  await pressSubmit();
  await settle();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300_000);
  });
  await settle();

  expect(
    must(
      document.body.querySelector<HTMLElement>(
        "[data-yunari-store-item-submit-refusal]",
      ),
      "the unconfirmed sign-in's sentence",
    ).textContent,
    "an unconfirmed sign-in stated nothing",
  ).toBe(uiCopy.store.submit.noSignIn);
  expect(
    submitControl().disabled,
    "an unconfirmed sign-in left the control dead",
  ).toBe(false);
  expect(
    submitControl().textContent?.trim(),
    "the control did not return to its own label",
  ).toBe(uiCopy.store.submit.label);
});

/**
 * **The poll stops with the surface.** A timer scheduled before unmount is
 * cleared rather than firing against a hook that no longer exists.
 */
/** A remix credit, and the UUIDs a routed index resolves through. */
const REMIX_PARENT_ID = "8f14e45f-ceea-4670-9c1e-0f4b4b9d0a11";
const REMIX_ID = "5d41402a-bc4b-4c8a-9d0e-2f1a3b4c5d6e";
const REMIX = {
  catalogueId: REMIX_PARENT_ID,
  name: "System dashboard",
  version: "1.2.0",
} as const;

/** The credit's own node, whichever of the two shapes it is drawn as. */
function remixCredit(): HTMLElement {
  return must(
    document.body.querySelector<HTMLElement>("[data-yunari-store-item-remix]"),
    "remix credit",
  );
}

/**
 * **A remix's credit is read from the routed index and opens its parent** — the
 * parent is a `StoreItem` the listing resolved by id, so the press opens that
 * item's own modal rather than a URL composed from the document's string.
 */
it("credits a remix from the routed index and opens the parent item", async () => {
  vi.stubGlobal(
    "fetch",
    catalogueServing([
      catalogueEntry(REMIX_PARENT_ID, "1.2.0", "dashboard-theme", {
        name: REMIX.name,
      }),
      {
        ...catalogueEntry(REMIX_ID, "1.0.0", "dashboard-theme", {
          name: "Bright dashboard",
        }),
        remixOf: REMIX,
      },
    ]),
  );
  await mountStore([]);
  await showOnline();
  await pressCellSurface(REMIX_ID);

  const credit = remixCredit();
  expect(
    (credit.textContent ?? "").replace(/\s+/g, " ").trim(),
    "the credit does not name the parent the document recorded",
  ).toBe(uiCopy.store.item.remixedFrom(REMIX.name));
  expect(credit.tagName, "a parent in the index is not a control").toBe(
    "BUTTON",
  );

  await act(async () => credit.click());

  expect(
    document.body
      .querySelector("[data-yunari-store-item-name]")
      ?.textContent?.trim(),
    "pressing the credit did not open the parent item",
  ).toBe(REMIX.name);
});

/**
 * **A credit whose parent is not in the index is text**, and draws no control:
 * a deleted item, a failed read, or a remix published before its parent must
 * not leave a dead link or a crash.
 */
it("draws a remix's credit as text when the parent is absent from the index", async () => {
  vi.stubGlobal(
    "fetch",
    catalogueServing([
      {
        ...catalogueEntry(REMIX_ID, "1.0.0", "dashboard-theme", {
          name: "Bright dashboard",
        }),
        remixOf: REMIX,
      },
    ]),
  );
  await mountStore([]);
  await showOnline();
  await pressCellSurface(REMIX_ID);

  const credit = remixCredit();
  expect(
    (credit.textContent ?? "").replace(/\s+/g, " ").trim(),
    "the credit lost the snapshot it printed",
  ).toBe(uiCopy.store.item.remixedFrom(REMIX.name));
  expect(credit.tagName, "an absent parent was drawn as a control").toBe(
    "SPAN",
  );
  expect(
    credit.querySelector("button, a"),
    "an absent parent drew a control inside the credit",
  ).toBeNull();
});

/**
 * **The library is not the catalogue**, so a library item's credit is text even
 * when a local theme happens to hold the parent's id: the parent a link opens
 * is a catalogue item the listing resolved, and this half read the library.
 */
it("draws a library item's credit as text with no control", async () => {
  await mountStore([
    {
      ...fixtureEntry({
        id: "living-room",
        name: "Living room",
        ground: DARK_GROUND,
      }),
      remixOf: REMIX,
    },
  ]);
  await pressCellSurface("living-room");

  const credit = remixCredit();
  expect(
    (credit.textContent ?? "").replace(/\s+/g, " ").trim(),
    "the library lost the credit its document declares",
  ).toBe(uiCopy.store.item.remixedFrom(REMIX.name));
  expect(credit.tagName, "a library credit was drawn as a control").toBe(
    "SPAN",
  );
  expect(
    credit.querySelector("button, a"),
    "a library credit drew a control inside it",
  ).toBeNull();
});

it("does not poll after the surface unmounts", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "open",
    vi.fn(() => signInPopup() as never),
  );
  const host = submitHost({
    submit: [
      new Response(
        JSON.stringify({ ok: false, message: "Sign in to the store." }),
        { status: 401 },
      ),
    ],
  });
  vi.stubGlobal("fetch", host.fetch);
  await mountAndOpen();
  // The region's own mount reads the session; this case is about the polls the
  // flow would add on top of it.
  const sessionsBefore = host.polls();

  await pressSubmit();
  await settle();
  await unmount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });

  expect(
    host.polls() - sessionsBefore,
    "a poll fired after the surface unmounted",
  ).toBe(0);
});

/** The author's own item, as `/api/store/mine` answers it: a catalogue entry
 *  plus the state the public listing has no room for. */
const MINE_ID = "5d41402a-bc4b-4c8a-9d0e-2f1a3b4c5d6e";

function mineEntry(
  status: string,
  facts: { readonly name?: string } = {},
): Record<string, unknown> {
  return {
    ...catalogueEntry(MINE_ID, "1.0.0", "dashboard-theme", {
      name: facts.name ?? "Withdrawn theme",
    }),
    status,
  };
}

/** A host answering the store's session probe and the author's own listing, and
 *  recording every path it was asked for.
 *
 *  `entries` may be a function, because a re-read after a command must answer
 *  the listing the host would now hold rather than the one it answered first.
 *  `transitions` is the queue of answers to the author's own commands, and
 *  `onTransition` is how a case moves that listing on when one is served. */
function mineHost(options: {
  readonly signedIn?: boolean;
  readonly entries?: readonly unknown[] | (() => readonly unknown[]);
  readonly sessionStatus?: number;
  /** The author's own listing's answer, so a case can make the re-read after a
   *  command fail without failing the first read. */
  readonly mineStatus?: number | (() => number);
  readonly transitions?: readonly Response[];
  readonly onTransition?: (path: string) => void;
}): { readonly fetch: typeof fetch; readonly calls: string[] } {
  const calls: string[] = [];
  const answers = [...(options.transitions ?? [])];
  const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    calls.push(path);
    if (path === "/api/store/session") {
      if (options.sessionStatus !== undefined) {
        return new Response("", { status: options.sessionStatus });
      }
      return new Response(
        JSON.stringify(
          options.signedIn === false
            ? { signedIn: false }
            : { signedIn: true, email: "author@example.com" },
        ),
        { status: 200 },
      );
    }
    if (path === "/api/store/mine") {
      const status =
        typeof options.mineStatus === "function"
          ? options.mineStatus()
          : (options.mineStatus ?? 200);
      if (status !== 200) return new Response("", { status });
      const entries =
        typeof options.entries === "function"
          ? options.entries()
          : (options.entries ?? []);
      return new Response(JSON.stringify({ entries }), { status: 200 });
    }
    if (path.startsWith("/api/store/items/") && init?.method === "POST") {
      options.onTransition?.(path);
      return answers.shift() ?? new Response("", { status: 404 });
    }
    return new Response("Not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetch: fetchStub, calls };
}

/** The Mine toggle, or the absence this file reports in its own words. */
function mineToggle(): HTMLButtonElement | null {
  return document.body.querySelector<HTMLButtonElement>(
    "[data-yunari-store-mine]",
  );
}

/**
 * **The toggle is the session's, not the store's.** A host holding no session
 * answers `{ signedIn: false }`, and the region draws no Mine control for it:
 * a toggle that lists nothing would be a promise the host cannot keep.
 */
it("draws no Mine toggle when the host holds no session", async () => {
  vi.stubGlobal("fetch", mineHost({ signedIn: false }).fetch);
  await mountStore([
    fixtureEntry({
      id: "living-room",
      name: "Living room",
      ground: DARK_GROUND,
    }),
  ]);
  await settle();

  expect(
    mineToggle(),
    "a host with no session still draws a Mine toggle",
  ).toBeNull();
});

/**
 * **A held session draws the toggle, named from the copy.** The control is
 * read by the word beside it, which is the same word the copy owns.
 */
it("offers a Mine toggle when a session is held", async () => {
  const host = mineHost({});
  vi.stubGlobal("fetch", host.fetch);
  await mountStore([]);
  await settle();

  const toggle = must(mineToggle(), "Mine toggle");
  expect(
    toggle.textContent?.trim(),
    "the Mine toggle does not carry the copy's own word",
  ).toBe(uiCopy.store.mine.label);
  expect(
    toggle.getAttribute("aria-pressed"),
    "the Mine toggle does not open unpressed",
  ).toBe("false");
  // The probe is one read per mount, never a poll: a second request would be a
  // session watched rather than an answer taken once.
  expect(
    host.calls.filter((path) => path === "/api/store/session"),
    "the region probed the session more than once",
  ).toHaveLength(1);
});

/**
 * **Mine lists the author's own rows from the online half, and the public
 * filters still narrow them.** Turning it on from the local half moves the
 * region to the online half, because that is the half the source belongs to.
 */
it("lists the author's own items when Mine is turned on", async () => {
  const host = mineHost({ entries: [mineEntry("unpublished")] });
  vi.stubGlobal("fetch", host.fetch);
  await mountStore([
    fixtureEntry({
      id: "living-room",
      name: "Living room",
      ground: DARK_GROUND,
    }),
  ]);
  await settle();

  await act(async () => must(mineToggle(), "Mine toggle").click());
  await settle();

  expect(
    halves(headerRow(document.body)).map((segment) =>
      segment.getAttribute("aria-pressed"),
    ),
    "turning Mine on did not move the region to the online half",
  ).toEqual(["false", "true"]);
  expect(
    cells().map((cell) => cell.getAttribute("data-yunari-store-cell")),
    "Mine did not list the author's own rows",
  ).toEqual([MINE_ID]);
  expect(
    document.body.querySelector(`[data-yunari-store-cell="${MINE_ID}"]`)
      ?.textContent,
    "the Mine row does not draw the item's own name",
  ).toContain("Withdrawn theme");

  // The public filters are the listing's, not the source's: a query that
  // matches no Mine row draws the filter's own sentence.
  await type("nothing matches this");
  expect(
    must(
      document.body.querySelector<HTMLElement>("[data-yunari-store-empty]"),
      "empty state after a query over Mine",
    ).textContent,
    "a filter that matched no Mine row does not say so",
  ).toContain(uiCopy.store.empty.filter);
});

/**
 * **A Mine row the library already holds is joined like a catalogue row.** The
 * author's own listing is read from the host, but what this PC installed is the
 * library's fact — without the join every Mine row offers Install, and pressing
 * it overwrites the author's local copy with no undo.
 */
it("joins Mine rows against the library so an installed copy is not offered again", async () => {
  const host = mineHost({ entries: [mineEntry("published")] });
  vi.stubGlobal("fetch", host.fetch);
  await mountStore([
    fixtureWithOrigin(
      {
        id: "mine-copy",
        name: "Withdrawn theme",
        version: "1.1.0",
        ground: DARK_GROUND,
      },
      MINE_ID,
      "1.0.0",
    ),
  ]);
  await settle();

  await act(async () => must(mineToggle(), "Mine toggle").click());
  await settle();

  const slot = must(
    document.body.querySelector<HTMLElement>(
      `[data-yunari-store-cell="${MINE_ID}"] [data-yunari-store-cell-install]`,
    ),
    `${MINE_ID}'s install slot`,
  );
  expect(
    slot.getAttribute("data-yunari-store-cell-install"),
    "an installed Mine row still offers Install",
  ).toBe("installed");
  expect(
    slot.tagName,
    "an installed Mine row draws a pressable control instead of the mark",
  ).toBe("SPAN");
  expect(
    document.body.querySelector(
      `[data-yunari-store-cell="${MINE_ID}"] button[data-yunari-store-cell-install]`,
    ),
    "an installed Mine row still offers the install action",
  ).toBeNull();
});

/**
 * **A row dropped for a state this build cannot read is not an empty listing.**
 * The host sent the author a row, so the surface says it could not read it
 * rather than telling them they have submitted nothing.
 */
it("says a Mine row was unreadable rather than claiming no submissions", async () => {
  const host = mineHost({
    entries: [{ ...mineEntry("published"), status: "shadow-banned" }],
  });
  vi.stubGlobal("fetch", host.fetch);
  await mountStore([]);
  await settle();

  await act(async () => must(mineToggle(), "Mine toggle").click());
  await settle();

  expect(
    document.body.querySelector("[data-yunari-store-empty]"),
    "an unreadable row was drawn as the no-submissions sentence",
  ).toBeNull();
  expect(
    must(
      document.body.querySelector<HTMLElement>("[data-yunari-store-refusal]"),
      "refusal line",
    ).textContent,
    "the unreadable Mine row is not stated",
  ).toBe(uiCopy.store.catalogueRefused("dashboard-theme", 1));
});

/** The live region every store sentence is spoken through. */
function announcement(): string {
  return (
    must(
      document.body.querySelector<HTMLElement>(
        "[data-yunari-store-install-announcement]",
      ),
      "live region",
    ).textContent ?? ""
  );
}

/** One author command inside the open item's modal, or the absence. */
function statusAction(
  action: "unpublish" | "republish",
): HTMLButtonElement | null {
  return document.body.querySelector<HTMLButtonElement>(
    `[data-yunari-store-item-status-action="${action}"]`,
  );
}

/**
 * **Withdrawing re-reads the listing, and the listing is the state drawn.** The
 * host's answer says what it thinks the state is; this surface does not write
 * it, so the row and the open modal both redraw from the author's own rows and
 * a host that answered something else cannot leave a stale word on screen.
 */
it("withdraws an item, re-reads the listing and draws its new state", async () => {
  let state = "published";
  const host = mineHost({
    entries: () => [mineEntry(state)],
    transitions: [
      new Response(JSON.stringify({ ok: true, status: "unpublished" }), {
        status: 200,
      }),
    ],
    onTransition: () => {
      state = "unpublished";
    },
  });
  vi.stubGlobal("fetch", host.fetch);
  await mountStore([]);
  await settle();
  await act(async () => must(mineToggle(), "Mine toggle").click());
  await settle();
  await pressCellSurface(MINE_ID);

  expect(
    document.body.querySelector("[data-yunari-store-status]"),
    "a published Mine row drew a badge the public listing already gives it",
  ).toBeNull();
  await act(async () =>
    must(statusAction("unpublish"), "Unpublish control").click(),
  );
  await settle();

  expect(
    host.calls.filter(
      (path) => path === `/api/store/items/${MINE_ID}/unpublish`,
    ),
    "the press did not post the author's own command",
  ).toHaveLength(1);
  expect(
    host.calls.filter((path) => path === "/api/store/mine"),
    "the successful change did not re-read the author's own rows",
  ).toHaveLength(2);
  expect(
    must(
      document.body.querySelector<HTMLElement>("[data-yunari-store-status]"),
      "status badge",
    ).textContent,
    "the re-read state is not what the modal draws",
  ).toBe(uiCopy.store.status.unpublished);
  expect(
    statusAction("republish"),
    "the redrawn modal does not offer the command its new state allows",
  ).not.toBeNull();
  expect(announcement(), "a successful change was announced as a refusal").toBe(
    "",
  );
});

/**
 * **A refused command changes nothing and is spoken.** The sentence is the
 * Worker's own — this surface knows which item it pressed for, not why the
 * store said no — and the row keeps the state the listing gave it.
 */
it("announces the store's refusal and leaves the item as it was", async () => {
  const sentence = "Only the author may withdraw this item.";
  const host = mineHost({
    entries: [mineEntry("published")],
    transitions: [
      new Response(JSON.stringify({ ok: false, message: sentence }), {
        status: 403,
      }),
    ],
  });
  vi.stubGlobal("fetch", host.fetch);
  await mountStore([]);
  await settle();
  await act(async () => must(mineToggle(), "Mine toggle").click());
  await settle();
  await pressCellSurface(MINE_ID);

  await act(async () =>
    must(statusAction("unpublish"), "Unpublish control").click(),
  );
  await settle();

  expect(
    announcement(),
    "the store's refusal is not what the live region says",
  ).toBe(sentence);
  expect(
    host.calls.filter((path) => path === "/api/store/mine"),
    "a refused change re-read the listing it did not alter",
  ).toHaveLength(1);
  expect(
    statusAction("unpublish"),
    "a refused change moved the item's state",
  ).not.toBeNull();
});

/**
 * **The most recent command is what the region speaks.** An install's sentence
 * outlives the press that made it, so an older success must not sit in front of
 * a fresh refusal — a screen reader would never hear that the change was
 * refused.
 */
it("speaks a status refusal even while an install sentence still stands", async () => {
  const refusal = "Only the author may withdraw this item.";
  const host = mineHost({
    entries: [mineEntry("published")],
    transitions: [
      new Response(JSON.stringify({ ok: false, message: refusal }), {
        status: 403,
      }),
    ],
  });
  const withInstall = (async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input) === "/api/themes/install"
      ? new Response(JSON.stringify({ ok: true }), { status: 200 })
      : host.fetch(input, init)) as typeof fetch;
  vi.stubGlobal("fetch", withInstall);
  await mountStore([]);
  await settle();
  await act(async () => must(mineToggle(), "Mine toggle").click());
  await settle();
  await pressCellSurface(MINE_ID);

  await act(async () =>
    must(
      document.body.querySelector<HTMLButtonElement>(
        '[data-yunari-store-item-install="install"]',
      ),
      "Install control",
    ).click(),
  );
  await settle();
  expect(
    announcement(),
    "the install did not speak first, so this case proves nothing",
  ).toBe(uiCopy.store.install.installed("Withdrawn theme"));

  await act(async () =>
    must(statusAction("unpublish"), "Unpublish control").click(),
  );
  await settle();

  expect(
    announcement(),
    "an older install sentence shadowed the status refusal",
  ).toBe(refusal);
});

/**
 * **A change the store accepted but the client could not read back is still
 * spoken.** Silence would leave the old state on screen with no word saying the
 * command landed; the listing is unchanged because there is no answer to draw.
 */
it("says a change was saved when the author's rows cannot be re-read", async () => {
  let mineReads = 0;
  const host = mineHost({
    entries: [mineEntry("published")],
    mineStatus: () => (mineReads++ === 0 ? 200 : 500),
    transitions: [
      new Response(JSON.stringify({ ok: true, status: "unpublished" }), {
        status: 200,
      }),
    ],
  });
  vi.stubGlobal("fetch", host.fetch);
  await mountStore([]);
  await settle();
  await act(async () => must(mineToggle(), "Mine toggle").click());
  await settle();
  await pressCellSurface(MINE_ID);

  await act(async () =>
    must(statusAction("unpublish"), "Unpublish control").click(),
  );
  await settle();

  expect(
    announcement(),
    "a saved change with a failed re-read is not spoken",
  ).toBe(uiCopy.store.status.unrefreshed);
  expect(
    document.body.querySelector("[data-yunari-store-status]"),
    "a failed re-read invented a state",
  ).toBeNull();
  expect(
    statusAction("unpublish"),
    "a failed re-read moved the item's state",
  ).not.toBeNull();
});

/**
 * **Republish is the other direction, and it re-reads too.** The path names
 * `/publish`, the state drawn afterwards is the listing's, and the modal offers
 * the command that state now allows rather than the one that was pressed.
 */
it("republishes an unpublished item and redraws it from the re-read", async () => {
  let state = "unpublished";
  const host = mineHost({
    entries: () => [mineEntry(state)],
    transitions: [
      new Response(JSON.stringify({ ok: true, status: "published" }), {
        status: 200,
      }),
    ],
    onTransition: () => {
      state = "published";
    },
  });
  vi.stubGlobal("fetch", host.fetch);
  await mountStore([]);
  await settle();
  await act(async () => must(mineToggle(), "Mine toggle").click());
  await settle();
  await pressCellSurface(MINE_ID);

  expect(
    must(
      document.body.querySelector<HTMLElement>("[data-yunari-store-status]"),
      "status badge",
    ).textContent,
    "an unpublished row does not draw its state",
  ).toBe(uiCopy.store.status.unpublished);

  await act(async () =>
    must(statusAction("republish"), "Republish control").click(),
  );
  await settle();

  expect(
    host.calls.filter((path) => path === `/api/store/items/${MINE_ID}/publish`),
    "the press did not post the publish command",
  ).toHaveLength(1);
  expect(
    host.calls.filter((path) => path === "/api/store/mine"),
    "the successful republish did not re-read the author's own rows",
  ).toHaveLength(2);
  expect(
    document.body.querySelector("[data-yunari-store-status]"),
    "the re-read published state still draws a badge",
  ).toBeNull();
  expect(
    statusAction("unpublish"),
    "the redrawn modal does not offer Unpublish for a published row",
  ).not.toBeNull();
});

/**
 * The strip's Themes-mode reading (#164): the region publishes what its own
 * listing shows, and the shell places it. The count is the half's, after the
 * facets and the query — not the editor's document, which is what the strip
 * used to show in this mode.
 */
it("publishes the visible listing's count to the strip", async () => {
  const seen: (number | undefined)[] = [];
  await mount(
    <StoreModeRegion
      mode="themes"
      client={clientListing(listing(3))}
      onStatus={(count) => seen.push(count)}
    />,
  );
  await settle();

  expect(seen.at(-1), "the count the strip would show").toBe(3);
});

it("publishes no count for a listing that did not arrive", async () => {
  const seen: (number | undefined)[] = [];
  const client: ThemeLibraryClient = {
    ...clientListing([]),
    list: async () => {
      throw new Error("the library could not be read");
    },
  };
  await mount(
    <StoreModeRegion
      mode="themes"
      client={client}
      onStatus={(count) => seen.push(count)}
    />,
  );
  await settle();

  // A failed read is not an empty result: the strip draws nothing rather than
  // claiming the library is empty.
  expect(
    seen.every((count) => count === undefined),
    "a failed read published a count",
  ).toBe(true);
});
