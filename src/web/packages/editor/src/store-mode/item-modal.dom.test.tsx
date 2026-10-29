// @vitest-environment jsdom
/**
 * The item's own surface: the modal a cell opens.
 *
 * **What this file owns.** The two claims the plan makes about the modal in
 * code — that the stage is one height for every item and the theme is contained
 * in it, and that the facts are pills in groups rather than a row per fact —
 * plus the 270px panel they moved into, the stage's size reading, the foot's
 * four glyph+word boxes, and the two of them it draws disabled because no phase
 * owns them (R164).
 *
 * **What it deliberately does not measure.** jsdom lays nothing out, so the
 * fixed stage is read off the declaration that fixes it and the picture's ratio
 * off the style the item gives it; that two items of different ratios really
 * draw the same stage height is the browser case's (`tests/e2e/editor-rail.spec.ts`),
 * which measures both. The empty states and the page a close returns to are the
 * region's, and live in `region.dom.test.tsx` — the same placement correction
 * A.4's review made for the facet predicate, which the plan had put in the
 * gallery's file.
 */
import { DASHBOARD_THEME_KIND } from "@yunari/renderer-core";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type { ThemeOrigin } from "../theme-library-client.js";
import { uiCopy } from "../ui-copy.js";
import type { InstallControl } from "./install-item.js";
import { DARK_GROUND, type FixtureTheme, fixtureItem } from "./item-fixture.js";
import { ItemModal } from "./item-modal.js";
import type { CatalogueFacts, CellAction, StoreItem } from "./local-source.js";
import type { SubmitControl } from "./use-submit.js";

// Base UI's dialog needs three browser APIs jsdom has none of: floating-ui
// observes its anchor, the popup waits for its own open transition, and it asks
// the selector engine for `:modal`/`:popover-open`, which jsdom parses slowly
// enough (about 0.5s a call) to dominate the file.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as never;
Element.prototype.getAnimations ??= (): never[] => [];
window.PointerEvent ??= MouseEvent as never;

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

/** The mounted surface and its host, taken down together: the popup is portalled
 *  to `body`, so a root left mounted would leave a second modal in the tree for
 *  the next read to find. */
async function unmount(): Promise<void> {
  const mounted = root;
  root = undefined;
  host?.remove();
  host = undefined;
  if (mounted !== undefined) await act(async () => mounted.unmount());
}

afterEach(async () => {
  await unmount();
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
  if (found === null) throw new Error(`the item modal rendered no ${what}`);
  return found;
}

/**
 * The record comes from the fixture's own `facetRecordOf` derivation rather than
 * from a hand-written descriptor, which is the trap A.4a's review found: a
 * hand-written `{label: "CPU", family: "system"}` answers something the host
 * never would, and the pill's own word is what this file is reading.
 */
const LANDSCAPE: FixtureTheme = {
  id: "kitchen-strip",
  name: "Kitchen strip",
  author: "huyng",
  version: "1.4.0",
  ground: DARK_GROUND,
  bindings: {
    "cpu-label": [{ id: "cpu", semanticKey: "cpu.load" }],
    "disk-label": [{ id: "disk", semanticKey: "disk.used" }],
  },
};

/** A second theme at the other orientation, for the one-height claim. */
const PORTRAIT: FixtureTheme = {
  id: "hall-totem",
  name: "Hall totem",
  ground: DARK_GROUND,
  width: 1080,
  height: 1920,
};

/** The same document with **no version declared**, which is a fact about the
 *  theme rather than a missing reading: the caption must draw its date alone
 *  rather than a separator with nothing before it (R128). */
const VERSIONLESS: FixtureTheme = {
  id: "kitchen-strip",
  name: "Kitchen strip",
  author: "huyng",
  ground: DARK_GROUND,
};

function modal(theme: FixtureTheme): ReactElement {
  return modalFor(fixtureItem(theme));
}

/** The same surface over an item built here rather than from a fixture theme —
 *  the origin record has no document behind it to derive.
 *
 *  `vocabulary` is the listing's own reading and the region builds it
 *  (`settledTags`), so the default here is the empty one a fixture with no tags
 *  is read against; the style case below hands the set it is about. */
function modalFor(
  item: StoreItem,
  vocabulary: readonly string[] = [],
  install: InstallControl = NO_INSTALL,
  submit: SubmitControl = NO_SUBMIT,
  author: {
    readonly onUnpublish?: (id: string) => void;
    readonly onRepublish?: (id: string) => void;
  } = {},
): ReactElement {
  return (
    <ItemModal
      item={item}
      vocabulary={vocabulary}
      onClose={() => {}}
      onAction={() => {}}
      install={install}
      submit={submit}
      {...author}
    />
  );
}

/** The install control a case that is not about installing hands down. A press
 *  is in flight for nobody, and nothing was refused. */
const NO_INSTALL: InstallControl = {
  onInstall: () => undefined,
  installingIds: new Set(),
  refusal: undefined,
};

/** The submit control a case that is not about submitting hands down: idle,
 *  with nothing asked for and nothing answered. */
const NO_SUBMIT: SubmitControl = {
  onSubmit: () => undefined,
  itemId: undefined,
  state: "idle",
  inFlight: false,
  url: undefined,
  refusal: undefined,
  version: undefined,
  status: undefined,
};

/** Where a theme came from, as the host records it: the catalogue item and the
 *  version this copy was installed from. */
const ORIGIN: ThemeOrigin = {
  catalogueId: "yunari/office-wall",
  version: "1.3.0",
  installedAt: "2026-10-14T00:00:00.000Z",
};

/** The catalogue's facts about one online item, with the field the join fills
 *  — what this PC has installed — left to each case. */
function catalogueFacts(
  overrides: Partial<CatalogueFacts> = {},
): CatalogueFacts {
  return {
    id: "kitchen-strip",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
    downloads: 1204,
    favorites: 38,
    packageUrl: "https://example.invalid/kitchen-strip.vtheme",
    installedVersion: undefined,
    ...overrides,
  };
}

/** An online item: the same library record with the catalogue's facts attached,
 *  which is the only thing that separates the two halves' modals. */
function onlineItem(overrides: Partial<CatalogueFacts> = {}): StoreItem {
  return fixtureItem(LANDSCAPE, catalogueFacts(overrides));
}

/** The stage and the picture inside it, from the portalled popup. */
function stage(): HTMLElement {
  return must(
    document.body.querySelector<HTMLElement>("[data-yunari-store-item-stage]"),
    "stage",
  );
}

/** The modal's own box, which is the width `DESIGN.md` fixes at 960. */
function box(): HTMLElement {
  return must(
    document.body.querySelector<HTMLElement>("[data-yunari-store-item]"),
    "modal box",
  );
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

/** The caption's right-hand end: the version, the date, and the catalogue's
 *  counts where the item has them. */
function caption(): HTMLElement {
  return must(
    document.body.querySelector<HTMLElement>("[data-yunari-store-item-date]"),
    "caption date line",
  );
}

function dateLine(): string {
  return visibleText(caption());
}

/** The stage's corner reading, or the absence when the record has no size. */
function stageCaption(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(
    "[data-yunari-store-item-caption]",
  );
}

/** One group's eyebrow and its pills, as the words a reader sees. */
function group(id: string): {
  readonly name: string | undefined;
  readonly pills: readonly (string | undefined)[];
} {
  const found = must(
    document.body.querySelector<HTMLElement>(
      `[data-yunari-store-item-group="${id}"]`,
    ),
    `${id} group`,
  );
  return {
    name: found
      .querySelector("[data-yunari-store-item-group-name]")
      ?.textContent?.trim(),
    pills: Array.from(
      found.querySelectorAll("[data-yunari-store-item-pill]"),
    ).map((pill) => pill.textContent?.trim()),
  };
}

/**
 * The box is the 960 × 760 and the stage takes the box's height
 * whatever the item is, so the modal does not change size as a person steps
 * between items.
 *
 * **A stage sized to the item would make the modal move**, which is the one
 * thing a viewer must not do. jsdom lays nothing out, so what is read is the
 * declarations that make it true: the box carries the height token, and the
 * stage carries none of its own — it is the flex child that takes what the panel
 * leaves. That the two really draw the same height, and that the picture keeps
 * its own ratio inside, is measured in the browser case.
 *
 * **The numbers are pinned, not the shape of a class.** `DESIGN.md` fixes the
 * modal at 960 and its height at the 760 because a case that accepted
 * `h-<any>` would pass a 100px stage.
 */
it("keeps the 960px box and the stage's one height", async () => {
  await mount(modal(LANDSCAPE));
  const landscape = { box: box().className, stage: stage().className };

  await mount(modal(PORTRAIT));
  const portrait = { box: box().className, stage: stage().className };

  expect(landscape.box, "the modal is not the 960px DESIGN.md fixes").toContain(
    "w-[960px]",
  );
  expect(landscape.box, "the modal does not take the 760px height").toContain(
    "h-[var(--store-item-height)]",
  );
  expect(
    landscape.stage,
    "the stage sets a height of its own instead of taking the box's",
  ).not.toMatch(/(?:^|\s)h-/);
  expect(landscape.stage, "the stage is not the same for both items").toBe(
    portrait.stage,
  );
  expect(landscape.box, "the modal box moves with the item").toBe(portrait.box);
});

/**
 * The facts and the commands live in a 270px right panel, not in a band under
 * the stage: the name, the groups and the actions are all its descendants, and
 * it is the stage's sibling in the box.
 */
it("draws a 270px right panel and no caption band", async () => {
  await mount(modal(LANDSCAPE));

  const panel = must(
    document.body.querySelector<HTMLElement>("[data-yunari-store-item-panel]"),
    "right panel",
  );
  // jsdom computes no width; the class carries the 270px token.
  expect(panel.className).toContain("w-[var(--store-item-panel-width)]");
  expect(stage().nextElementSibling, "the panel is not beside the stage").toBe(
    panel,
  );
  for (const selector of [
    "[data-yunari-store-item-name]",
    '[data-yunari-store-item-group="reads"]',
    "[data-yunari-store-item-date]",
    '[data-yunari-store-item-action="delete"]',
    "[data-yunari-store-item-close]",
  ]) {
    expect(
      panel.querySelector(selector),
      `${selector} stayed outside the panel`,
    ).not.toBeNull();
  }
});

/**
 * The stage's corner prints the size the theme is drawn at and the fit verb —
 * `1920 × 1080 · fit`, a reading rather than a sentence. A record without a
 * readable size draws **no caption at all**: `0 × 0` would be a measurement of
 * nothing, not a reading.
 */
it("reads the stage's size and fit, and survives a record without one", async () => {
  await mount(modal(LANDSCAPE));
  expect(
    must(stageCaption(), "stage caption").textContent?.trim(),
    "the stage does not read the theme's own size and the fit verb",
  ).toBe(
    `1920 × 1080${uiCopy.store.readingSeparator}${uiCopy.assets.preview.fit}`,
  );

  const item = fixtureItem(LANDSCAPE);
  await mount(
    modalFor({ ...item, facets: { ...item.facets, width: 0, height: 0 } }),
  );
  expect(
    stageCaption(),
    "an unreadable size drew a caption of its own",
  ).toBeNull();
  // The same guard reaches the picture: a `calc` over 0 is invalid at
  // computed-value time and collapses it, so an unsized record takes the stage's
  // own box instead and keeps no ratio of its own.
  const picture = must(
    document.body.querySelector<HTMLElement>(
      "[data-yunari-store-item-picture]",
    ),
    "picture",
  );
  expect(
    picture.style.width,
    "a 0 × 0 record left a ratio style on the picture",
  ).toBe("");
  expect(
    picture.className,
    "an unsized picture does not take the stage's own box",
  ).toContain("size-full");
});

/**
 * The facts are pills in the groups the facets offer them in, and each pill is
 * the record's own reading: a sensor by the descriptor's `label` rather than by
 * its `semanticKey`, and a shape by its own words.
 *
 * The group names are the — Reads and Shape — and not the facet row's
 * (Sensors, Colour mode): the row names what a filter narrows by, and the modal
 * names what the theme reads and how it is shaped.
 */
it("draws the facts as pills in their groups rather than a row per fact", async () => {
  await mount(modal(LANDSCAPE));

  const reads = group("reads");
  expect(reads.name, "the sensor pills sit under no eyebrow").toBe(
    uiCopy.store.pillGroups.reads,
  );
  expect(
    reads.pills,
    "a sensor pill is not labelled by the descriptor's own label",
  ).toEqual(["CPU load", "Disk used"]);

  const shape = group("shape");
  expect(shape.name, "the shape pills sit under no eyebrow").toBe(
    uiCopy.store.pillGroups.shape,
  );
  expect(
    shape.pills,
    "the shape pills are not the record's own readings",
  ).toEqual([
    uiCopy.store.colourModes.dark,
    uiCopy.store.orientations.landscape,
    "16:9",
    "1920×1080",
  ]);
});

/** One pill's class list, by the id it is drawn with — the only way to read a
 *  treatment, since jsdom lays nothing out. */
function pillClass(id: string): string {
  return must(
    document.body.querySelector<HTMLElement>(
      `[data-yunari-store-item-pill="${id}"]`,
    ),
    `the ${id} pill`,
  ).className;
}

/**
 * **The third group, and the pill that says its word is new**: *a style pill
 * one tag, with a proposed tag saying so on its own pill rather than being
 * indistinguishable from a settled one*.
 *
 * The vocabulary is the listing's and arrives as a prop, so this case hands the
 * set it is about rather than deriving one: what the modal owns is reading a tag
 * against it. Both halves of the mark are read — the words
 * (`<tag> · proposed`) and the dashed edge — because either alone would pass a
 * pill that was indistinguishable from a settled one in the other respect.
 */
it("draws the Style group, and marks the tag the vocabulary does not hold", async () => {
  const tagged: FixtureTheme = {
    ...LANDSCAPE,
    id: "tagged",
    tags: ["retro", "retro-diner"],
  };
  await mount(modalFor(fixtureItem(tagged), ["retro"]));

  const style = group("style");
  expect(style.name, "the style pills sit under no eyebrow").toBe(
    uiCopy.store.pillGroups.style,
  );
  expect(
    style.pills,
    "the style pills are not the document's own tags, with the proposed one marked",
  ).toEqual(["retro", uiCopy.panels.tagsProposed("retro-diner")]);

  expect(
    pillClass("retro"),
    "a tag the vocabulary holds is drawn as a proposed one",
  ).not.toContain("border-dashed");
  expect(
    pillClass("retro-diner"),
    "a tag the vocabulary does not hold is drawn as a settled one",
  ).toContain("border-dashed");

  // The `font:500` belongs to the pill's own box, not to the mark, so
  // both pills carry it: a settled pill and a proposed one differ in edge and
  // colour, and in nothing else.
  for (const id of ["retro", "retro-diner"]) {
    expect(pillClass(id), `${id}: not the weight`).toContain("font-medium");
  }
});

/**
 * **A theme that declares no tag draws no Style group**, which is the rule the
 * group's heading shares with the Reads group: a heading over nothing is a word
 * that says nothing, and every theme in the library was untagged before the
 * format carried the field.
 */
it("draws no Style group for a theme that declares no tags", async () => {
  await mount(modal(LANDSCAPE));

  expect(
    document.body.querySelector('[data-yunari-store-item-group="style"]'),
    "a theme with no tags draws a Style heading over nothing",
  ).toBeNull();
});

/**
 * The panel's head names the item and says what it is, and the foot writes its
 * actions in the short words, in its own order.
 *
 * The kind is a badge rather than a title bar's word: what a kind is called is
 * `uiCopy.store.cell.kinds`, and a kind this build does not know prints its own
 * identifier rather than a name nobody chose. The version and the date are one
 * reading pair, `1.4.0 · 2026-10-14`, with the separator between them.
 */
it("names the item in the panel and writes its actions in the short words", async () => {
  await mount(modal(LANDSCAPE));

  expect(
    document.body
      .querySelector("[data-yunari-store-item-name]")
      ?.textContent?.trim(),
    "the panel does not name the item",
  ).toBe("Kitchen strip");
  expect(
    document.body
      .querySelector("[data-yunari-store-item-kind]")
      ?.textContent?.trim(),
    "the panel does not say what kind of thing this is",
  ).toBe(uiCopy.store.cell.kinds[DASHBOARD_THEME_KIND]);
  expect(
    document.body
      .querySelector("[data-yunari-store-item-date]")
      ?.textContent?.trim(),
    "the panel does not pair the version with the date",
  ).toBe(`1.4.0${uiCopy.store.readingSeparator}2026-10-14`);

  const actions = Array.from(
    document.body.querySelectorAll<HTMLElement>(
      "[data-yunari-store-item-action]",
    ),
  );
  expect(
    actions.map((action) => action.textContent?.trim()),
    "the actions are not the short words in its own order",
  ).toEqual([
    uiCopy.store.item.actions.delete,
    uiCopy.store.item.actions.export,
    uiCopy.store.item.actions.assign,
    uiCopy.store.item.actions.open,
  ]);
});

/**
 * Each action is a box holding a 12px glyph and one word, and **Delete is the
 * only one carrying the destructive marker**. The mark is the attribute the
 * shell's rule paints `--hot`; no box is filled — an accent fill would make one
 * of four the act.
 *
 * **Delete is disabled by R164 today, so the palette paints it `--faint`, not `--hot`.**
 * jsdom computes no colour, so this case reads the mark and the disabled state
 * rather than the paint; `editor-shell.control-rules.test.ts` holds that the
 * shell declines to paint a disabled mark.
 */
it("gives Delete the destructive marker and its R164 reason", async () => {
  await mount(modal(LANDSCAPE));

  const actions = Array.from(
    document.body.querySelectorAll<HTMLButtonElement>(
      "[data-yunari-store-item-action]",
    ),
  );
  expect(actions, "the foot is not the four boxes").toHaveLength(4);

  for (const action of actions) {
    const name = action.getAttribute("data-yunari-store-item-action");
    expect(
      action.querySelector("svg"),
      `${name}: the box draws no glyph`,
    ).not.toBeNull();
    expect(
      action.querySelector("span")?.textContent,
      `${name}: the box does not hold one word`,
    ).toBe(uiCopy.store.item.actions[name as CellAction]);
    expect(
      action.className,
      `${name}: the box takes an accent fill`,
    ).not.toContain("border-accent");
    expect(action.className, `${name}: the box is not a filled well`).toContain(
      "bg-panel-2",
    );
  }

  const marked = actions
    .filter((action) => action.hasAttribute("data-yunari-destructive"))
    .map((action) => action.getAttribute("data-yunari-store-item-action"));
  expect(
    marked,
    "more than Delete carries the mark, so more than one word would paint --hot",
  ).toEqual(["delete"]);

  const deleteBox = must(
    actions.find(
      (action) =>
        action.getAttribute("data-yunari-store-item-action") === "delete",
    ) ?? null,
    "delete box",
  );
  expect(
    deleteBox.disabled,
    "R164 no longer disables Delete, so the shell would paint it --hot",
  ).toBe(true);
  const describedBy = deleteBox.getAttribute("aria-describedby") ?? "";
  expect(describedBy, "Delete no longer states its R164 reason").not.toBe("");
  expect(
    must(
      document.body.querySelector<HTMLElement>(`#${describedBy}`),
      "Delete's reason",
    ).textContent,
    "Delete's reason is not the copy table's",
  ).toBe(uiCopy.store.cell.unavailable);
});

/**
 * **The footer draws the four and only two of them run** (R164).
 *
 * Delete and Export package are drawn because the surface draws them, and no
 * task in this plan and no phase owns either — so
 * they are disabled with their reason rather than answering a press with
 * nothing. Every button is read through `must`, because a case that passed by
 * finding nothing would prove nothing, and the two that run are pressed in the
 * same pass: the disabled pair's silence is then a reading rather than a harness
 * that never fired.
 */
it("runs the footer's two actions and disables the two it has not", async () => {
  const ran: string[] = [];
  await mount(
    <ItemModal
      item={fixtureItem(LANDSCAPE)}
      vocabulary={[]}
      onClose={() => {}}
      onAction={(action) => ran.push(action)}
      install={NO_INSTALL}
      submit={NO_SUBMIT}
    />,
  );

  /** One of the footer's four actions, or a failure naming which is missing. */
  function actionButton(action: string): HTMLButtonElement {
    return must(
      document.body.querySelector<HTMLButtonElement>(
        `[data-yunari-store-item-action="${action}"]`,
      ),
      `${action} footer action`,
    );
  }

  for (const action of ["delete", "export", "assign", "open"] as const) {
    await act(async () => actionButton(action).click());
  }

  expect(
    ran,
    "the two actions this build runs did not both report, so the disabled pair's silence would prove nothing",
  ).toEqual(["assign", "open"]);

  // The pair that does not run: `disabled` is what makes a button unpressable,
  // read off the control rather than inferred from a click that changed nothing,
  // and the reason is a node in the tree rather than a tooltip.
  for (const action of ["delete", "export"] as const) {
    const button = actionButton(action);
    expect(button.disabled, `${action} is drawn live`).toBe(true);
    const describedBy = button.getAttribute("aria-describedby") ?? "";
    expect(describedBy, `${action} states no reason`).not.toBe("");
    expect(
      must(
        document.body.querySelector<HTMLElement>(`#${describedBy}`),
        `${action}'s reason`,
      ).textContent,
      `${action}'s reason is not the copy table's`,
    ).toBe(uiCopy.store.cell.unavailable);
  }
});

/**
 * **A theme with no version draws no separator and no empty slot** (R128): the
 * pair is drawn where both readings exist, and a document that declares none
 * says its date alone rather than ` · 2026-10-14` or `0.0.0`.
 */
it("draws no version and no separator for a theme that declares none", async () => {
  await mount(modal(VERSIONLESS));

  expect(
    document.body
      .querySelector("[data-yunari-store-item-date]")
      ?.textContent?.trim(),
    "a versionless theme draws a separator or an invented version",
  ).toBe("2026-10-14");
});

/**
 * **The modal says where the item came from**, which is the one thing a cell's
 * badge cannot: *a cell can say From the store and cannot say from where*. It
 * is one muted line under the pills rather than a group of pills, and it names
 * the catalogue item and the version this copy was installed
 * from — the record's own strings, not the caption's document version.
 *
 * **A theme the host has no record for draws no line at all**, and the line
 * carries the origin clause alone: *Shows on …* is an assignment fact no item
 * carries yet.
 */
it("names the catalogue item and the installed version on one line, and draws none without one", async () => {
  await mount(modalFor({ ...fixtureItem(LANDSCAPE), origin: ORIGIN }));

  const line = must(
    document.body.querySelector<HTMLElement>("[data-yunari-store-item-origin]"),
    "provenance line",
  );
  expect(
    line.textContent,
    "the line does not name the catalogue item and the version installed",
  ).toBe(
    [uiCopy.store.fromStore, ORIGIN.catalogueId, ORIGIN.version].join(
      uiCopy.store.readingSeparator,
    ),
  );

  await mount(modal(LANDSCAPE));
  expect(
    document.body.querySelector("[data-yunari-store-item-origin]"),
    "the modal drew a provenance line for a theme with no origin",
  ).toBeNull();
});

/** The way out is the modal's own answer rather than a state it keeps: the
 *  surface is mounted by whoever holds the item, and closing it is theirs. */
it("reports its own close rather than closing itself", async () => {
  const closed: number[] = [];
  await mount(
    <ItemModal
      item={fixtureItem(LANDSCAPE)}
      vocabulary={[]}
      onClose={() => closed.push(1)}
      onAction={() => {}}
      install={NO_INSTALL}
      submit={NO_SUBMIT}
    />,
  );

  await act(async () =>
    must(
      document.body.querySelector<HTMLButtonElement>(
        "[data-yunari-store-item-close]",
      ),
      "close control",
    ).click(),
  );

  expect(closed, "the close control does not report a close").toHaveLength(1);
});

/**
 * **The catalogue's counts are facts about the item rather than about a facet**,
 * so they join the caption's right-hand end — the `1.4.0 · 2026-10-14`
 * plus the cell's two numbers — rather than taking a row or a pill group of
 * their own. `1,204` rather than `1204` is the
 * formatter's, and both are counted against the literal because the separator
 * alone would pass either.
 *
 * **A library item draws neither count**: it has no catalogue to read them off,
 * which is the guard this case's second half holds.
 */
it("joins the catalogue's counts to the caption's right-hand end", async () => {
  const separator = uiCopy.store.readingSeparator;

  await mount(modalFor(onlineItem()));
  expect(
    dateLine(),
    "an online item does not draw the catalogue's two counts beside its version and date",
  ).toBe(["1.4.0", "2026-10-14", "1,204", "38"].join(separator));

  // A fixed-width stamp is cut mid-digit by the popup's `overflow-hidden`; it
  // must shrink and ellipsise instead, and its end is what gives way first.
  const stampClass = caption().className;
  expect(
    stampClass,
    "the stamp cannot shrink inside the panel, so a long count is cut by the popup",
  ).toContain("min-w-0");
  expect(
    stampClass,
    "the stamp cannot ellipsise, so a long count is cut mid-digit",
  ).toContain("truncate");

  // The figure is visible and its noun is read — see `uiCopy.store.counts` —
  // so the composed reading is figure, one space, noun.
  expect(
    spokenText(caption()),
    "the caption's composed reading is not each figure, a space, and its noun",
  ).toBe(
    [
      "1.4.0",
      "2026-10-14",
      `1,204 ${uiCopy.store.counts.downloads(1204)}`,
      `38 ${uiCopy.store.counts.favorites(38)}`,
    ].join(separator),
  );

  await mount(modalFor(fixtureItem(LANDSCAPE)));
  expect(
    dateLine(),
    "a library item drew counts it has no catalogue to read",
  ).toBe(["1.4.0", "2026-10-14"].join(separator));
  expect(spokenText(caption()), "a library item drew a count's noun").toBe(
    ["1.4.0", "2026-10-14"].join(separator),
  );
});

/**
 * **The online footer carries the same install reading the cell does** — the
 * cell's *Install*, *Installed* or *Update* in place of the library's four
 * actions.
 *
 * Installed is a **mark**, not a control, because there is nothing to do; the
 * check carries the rationed accent and the word stays `--muted`, exactly as
 * the cell draws it. Install and Update are
 * controls that report the item they press, and the region owns what that
 * press does.
 */
it("carries the cell's install reading in the footer instead of the library's four", async () => {
  const onInstall = vi.fn();
  const cases = [
    { state: "installed", catalogue: { installedVersion: "1.4.0" } },
    { state: "install", catalogue: {} },
    { state: "update", catalogue: { installedVersion: "1.3.0" } },
  ] as const;

  let pressed = 0;
  for (const sample of cases) {
    await mount(
      modalFor(onlineItem(sample.catalogue), [], { ...NO_INSTALL, onInstall }),
    );
    const word = uiCopy.store.cell.installStates[sample.state];

    expect(
      document.body.querySelector("[data-yunari-store-item-action]"),
      `${sample.state}: the library's four actions are drawn beside the catalogue's reading`,
    ).toBeNull();

    const reading = must(
      document.body.querySelector<HTMLElement>(
        `[data-yunari-store-item-install="${sample.state}"]`,
      ),
      `${sample.state} reading`,
    );
    expect(
      reading.textContent,
      `${sample.state}: the footer is not the copy table's word`,
    ).toBe(word);

    if (sample.state === "installed") {
      expect(reading.tagName, "the installed state drew a control").toBe(
        "SPAN",
      );
      expect(
        reading.className,
        "the mark's word is not drawn in the muted colour",
      ).toContain("text-muted");
      expect(
        must(
          reading.querySelector<HTMLElement>("span.text-accent"),
          "the check's accent colour",
        ).textContent,
        "the accent is not on the check alone",
      ).toBe("");
      expect(
        reading.querySelector("button"),
        "the installed state drew a button it has no action for",
      ).toBeNull();
      continue;
    }

    const button = must(
      document.body.querySelector<HTMLButtonElement>(
        `[data-yunari-store-item-install="${sample.state}"]`,
      ),
      `${sample.state} action`,
    );
    expect(button.disabled, `${word} is drawn dead`).toBe(false);
    await act(async () => button.click());
    pressed += 1;
  }

  expect(
    onInstall.mock.calls.map(([itemPressed]) => itemPressed.id),
    "the two controls did not report the item that was pressed",
  ).toEqual(Array.from({ length: pressed }, () => "kitchen-strip"));
});

/**
 * **A press in flight disables the footer's control**, and a refusal is the
 * host's own sentence beside it: the person who pressed reads why it did not
 * land rather than a control that snapped back with nothing said.
 */
it("disables the footer's install in flight and states the host's refusal", async () => {
  const pressed = onlineItem();

  await mount(
    modalFor(pressed, [], {
      ...NO_INSTALL,
      installingIds: new Set([pressed.id]),
    }),
  );
  expect(
    must(
      document.body.querySelector<HTMLButtonElement>(
        '[data-yunari-store-item-install="install"]',
      ),
      "install action",
    ).disabled,
    "an install in flight is pressable a second time",
  ).toBe(true);

  await mount(
    modalFor(pressed, [], {
      ...NO_INSTALL,
      refusal: { id: pressed.id, message: "That package is not a theme." },
    }),
  );
  expect(
    must(
      document.body.querySelector<HTMLElement>(
        "[data-yunari-store-item-install-refusal]",
      ),
      "install refusal",
    ).textContent,
    "the footer does not state the host's own reason",
  ).toBe("That package is not a theme.");
  expect(
    must(
      document.body.querySelector<HTMLButtonElement>(
        '[data-yunari-store-item-install="install"]',
      ),
      "install action after a refusal",
    ).disabled,
    "a refused install left the control dead",
  ).toBe(false);
});

/** **A library item's footer is untouched** — the four actions, in this
 *  order, and no catalogue reading among them. This is the half of the
 *  guard that keeps phase A's surface intact. */
it("draws no catalogue reading for a library item", async () => {
  await mount(modalFor(fixtureItem(LANDSCAPE)));

  expect(
    document.body.querySelector("[data-yunari-store-item-install]"),
    "a library item drew a catalogue install reading",
  ).toBeNull();
  expect(
    document.body.querySelectorAll("[data-yunari-store-item-action]"),
    "a library item lost the footer's four actions",
  ).toHaveLength(4);
});

/** A remix credit: the parent's catalogue id is the UUID a link resolves
 *  through, and the name is the snapshot the credit prints when it cannot. */
const REMIX_PARENT_ID = "8f14e45f-ceea-4670-9c1e-0f4b4b9d0a11";
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
 * **A remixed item credits its parent, and the credit opens it** when the
 * listing holds that parent: the name is the document's snapshot and the target
 * is the resolved `StoreItem`, so no string out of a document reaches a link.
 */
it("credits a remix's parent and opens it when the listing holds it", async () => {
  const opened: string[] = [];
  await mount(
    <ItemModal
      item={{ ...onlineItem(), remixOf: REMIX }}
      vocabulary={[]}
      onClose={() => {}}
      onAction={() => {}}
      install={NO_INSTALL}
      submit={NO_SUBMIT}
      onOpenItem={(id) => opened.push(id)}
      remixParent={fixtureItem({
        id: REMIX_PARENT_ID,
        name: REMIX.name,
        ground: DARK_GROUND,
      })}
    />,
  );

  const credit = remixCredit();
  expect(row(credit), "the credit is not the copy table's sentence").toBe(
    uiCopy.store.item.remixedFrom(REMIX.name),
  );
  expect(credit.tagName, "a resolvable parent is not drawn as a control").toBe(
    "BUTTON",
  );

  await act(async () => credit.click());
  expect(opened, "the credit does not open the parent item").toEqual([
    REMIX_PARENT_ID,
  ]);
});

/**
 * **With no resolved parent the credit is text** — a deleted item, a failed
 * read, or this PC's own library, which is not the catalogue the id names.
 * Handing the modal an `onOpenItem` alone must not give it a target: the parent
 * is the listing's resolved item, never an id the modal invents.
 */
it("draws a remix's credit as text when no parent was resolved", async () => {
  for (const withOpen of [false, true]) {
    await mount(
      <ItemModal
        item={{ ...fixtureItem(LANDSCAPE), remixOf: REMIX }}
        vocabulary={[]}
        onClose={() => {}}
        onAction={() => {}}
        install={NO_INSTALL}
        submit={NO_SUBMIT}
        {...(withOpen ? { onOpenItem: () => undefined } : {})}
      />,
    );

    const credit = remixCredit();
    expect(row(credit), "the credit lost its sentence").toBe(
      uiCopy.store.item.remixedFrom(REMIX.name),
    );
    expect(credit.tagName, "an unresolved parent was drawn as a control").toBe(
      "SPAN",
    );
    expect(
      credit.querySelector("button, a"),
      "an unresolved parent drew a control inside the credit",
    ).toBeNull();
  }
});

/** What a node reads as: its text with runs of whitespace collapsed. */
function row(node: Element): string {
  return (node.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * **A landed submission tells the author which version it published, beside the
 * state the store landed it in**: the level is the host's own answer to what
 * changed, and the status word is the store's answer to what happens next, so
 * this surface states both rather than deriving a second ladder or a second
 * state machine.
 */
it("states the version a submission published beside its status word", async () => {
  const item = fixtureItem(LANDSCAPE);
  await mount(
    modalFor(item, [], NO_INSTALL, {
      ...NO_SUBMIT,
      itemId: item.id,
      state: "submitted",
      status: "pending",
      version: { from: "1.4.0", to: "1.5.0", level: "minor" },
    }),
  );

  const sentence = must(
    document.body.querySelector<HTMLElement>(
      "[data-yunari-store-item-submit-version]",
    ),
    "version sentence",
  );
  const badge = must(
    document.body.querySelector<HTMLElement>(
      "[data-yunari-store-item-submit-status]",
    ),
    "status word",
  );
  expect(
    sentence.textContent,
    "the footer does not name the version it published",
  ).toBe(
    uiCopy.store.submit.version({
      from: "1.4.0",
      to: "1.5.0",
      level: "minor",
    }),
  );
  expect(
    badge.textContent,
    "the footer does not state the state the store landed",
  ).toBe(uiCopy.store.status.pending);
  expect(
    badge.compareDocumentPosition(sentence) & Node.DOCUMENT_POSITION_PRECEDING,
    "the status word is not beside the version sentence",
  ).toBe(Node.DOCUMENT_POSITION_PRECEDING);
});

/** The modal's author command, read by the word a person presses rather than by
 *  an id the markup happens to carry. */
function authorButton(label: string): HTMLButtonElement | null {
  return (
    Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === label) ?? null
  );
}

/** The state badge the caption draws after the name, or the absence. */
function statusBadge(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>("[data-yunari-store-status]");
}

/**
 * **A published Mine item offers one author command: Unpublish.** The word is
 * the badge's counterpart — the surface states the state and the one act that
 * changes it — and the press reports the item it belongs to rather than
 * deciding anything here.
 */
it("offers Unpublish on a published item and reports the press", async () => {
  const onUnpublish = vi.fn();
  const onRepublish = vi.fn();
  const item = onlineItem();
  await mount(
    modalFor({ ...item, status: "published" }, [], NO_INSTALL, NO_SUBMIT, {
      onUnpublish,
      onRepublish,
    }),
  );

  expect(
    statusBadge(),
    "a published item drew a state badge the public listing already gives it",
  ).toBeNull();
  expect(
    authorButton(uiCopy.store.actions.republish),
    "a published item offers Republish",
  ).toBeNull();

  await act(async () =>
    must(
      authorButton(uiCopy.store.actions.unpublish),
      "Unpublish control",
    ).click(),
  );
  expect(
    onUnpublish.mock.calls.map(([id]) => id),
    "the press did not report the item it was drawn for",
  ).toEqual([item.id]);
  expect(
    onRepublish,
    "a published item reported Republish",
  ).not.toHaveBeenCalled();
});

/**
 * **An unpublished Mine item says so and offers Republish.** The badge is read
 * as a word, not as a colour, and Unpublish is replaced rather than drawn
 * beside it — an item cannot be withdrawn twice.
 */
it("badges an unpublished item and offers Republish instead of Unpublish", async () => {
  const onUnpublish = vi.fn();
  const onRepublish = vi.fn();
  const item = onlineItem();
  await mount(
    modalFor({ ...item, status: "unpublished" }, [], NO_INSTALL, NO_SUBMIT, {
      onUnpublish,
      onRepublish,
    }),
  );

  const badge = must(statusBadge(), "status badge");
  expect(
    badge.getAttribute("data-yunari-store-status"),
    "the badge does not name the state it draws",
  ).toBe("unpublished");
  expect(
    badge.textContent,
    "the badge does not carry the copy's own word",
  ).toBe(uiCopy.store.status.unpublished);
  expect(
    authorButton(uiCopy.store.actions.unpublish),
    "an unpublished item still offers Unpublish",
  ).toBeNull();

  await act(async () =>
    must(
      authorButton(uiCopy.store.actions.republish),
      "Republish control",
    ).click(),
  );
  expect(
    onRepublish.mock.calls.map(([id]) => id),
    "the press did not report the item it was drawn for",
  ).toEqual([item.id]);
});

/**
 * **A pending item waits, and says what for.** Neither command is drawn —
 * there is nothing the author can do until the owner has read it — and the
 * sentence is the reason rather than a disabled control.
 */
it("draws no author command for a pending item but says what it waits for", async () => {
  const item = onlineItem();
  await mount(
    modalFor({ ...item, status: "pending" }, [], NO_INSTALL, NO_SUBMIT, {
      onUnpublish: () => {},
      onRepublish: () => {},
    }),
  );

  expect(
    must(statusBadge(), "status badge").textContent,
    "the badge does not carry the pending word",
  ).toBe(uiCopy.store.status.pending);
  expect(
    authorButton(uiCopy.store.actions.unpublish),
    "a pending item offers Unpublish",
  ).toBeNull();
  expect(
    authorButton(uiCopy.store.actions.republish),
    "a pending item offers Republish",
  ).toBeNull();
  expect(
    document.body.textContent,
    "a pending item does not say what it waits for",
  ).toContain(uiCopy.store.status.pendingReview);
});

/**
 * **A rejected item draws the owner's own sentence**, because the reason is the
 * only thing the author can act on; neither command is offered.
 */
it("states the owner's reason on a rejected item", async () => {
  const reason = "The thumbnail is a screenshot rather than the theme.";
  const item = onlineItem();
  await mount(
    modalFor(
      { ...item, status: "rejected", statusReason: reason },
      [],
      NO_INSTALL,
      NO_SUBMIT,
      { onUnpublish: () => {}, onRepublish: () => {} },
    ),
  );

  expect(
    must(statusBadge(), "status badge").textContent,
    "the badge does not carry the rejected word",
  ).toBe(uiCopy.store.status.rejected);
  expect(
    document.body.textContent,
    "the owner's reason is not drawn",
  ).toContain(reason);
  expect(
    authorButton(uiCopy.store.actions.unpublish),
    "a rejected item offers Unpublish",
  ).toBeNull();
  expect(
    authorButton(uiCopy.store.actions.republish),
    "a rejected item offers Republish",
  ).toBeNull();
});

/**
 * **A removed item says the state is permanent.** The owner's reason is drawn
 * as it is on a rejected row, and the surface adds the one fact the reason
 * alone does not carry: there is no way back.
 */
it("adds that a removed item cannot be republished", async () => {
  const reason = "Withdrawn at the owner's request.";
  const item = onlineItem();
  await mount(
    modalFor(
      { ...item, status: "removed", statusReason: reason },
      [],
      NO_INSTALL,
      NO_SUBMIT,
      { onUnpublish: () => {}, onRepublish: () => {} },
    ),
  );

  expect(
    must(statusBadge(), "status badge").textContent,
    "the badge does not carry the removed word",
  ).toBe(uiCopy.store.status.removed);
  expect(
    document.body.textContent,
    "the owner's reason is not drawn",
  ).toContain(reason);
  expect(
    document.body.textContent,
    "a removed item does not say it cannot come back",
  ).toContain(uiCopy.store.status.removedPermanent);
  expect(
    authorButton(uiCopy.store.actions.republish),
    "a removed item offers Republish",
  ).toBeNull();
});

/**
 * **A public listing item is unchanged.** No status means this is not the
 * author's own row: the badge and both commands are absent, and the footer is
 * exactly the four library actions a public item always drew.
 */
it("draws no status at all for an item the listing gives no state", async () => {
  await mount(
    modalFor(fixtureItem(LANDSCAPE), [], NO_INSTALL, NO_SUBMIT, {
      onUnpublish: () => {},
      onRepublish: () => {},
    }),
  );

  expect(statusBadge(), "an item with no state drew a badge").toBeNull();
  expect(
    authorButton(uiCopy.store.actions.unpublish),
    "an item with no state offers Unpublish",
  ).toBeNull();
  expect(
    authorButton(uiCopy.store.actions.republish),
    "an item with no state offers Republish",
  ).toBeNull();
  expect(
    document.body.querySelector('[data-yunari-store-item-action="open"]'),
    "an item with no state lost its own four actions",
  ).not.toBeNull();
});

/**
 * **A removed row says it cannot come back even with no reason.** The Worker
 * omits `statusReason` when it has none, and the permanent sentence is the
 * state's own fact rather than the reason's — gating it on the reason leaves a
 * badge and nothing else.
 */
it("states a removed item's permanence even when the store gave no reason", async () => {
  const item = onlineItem();
  await mount(
    modalFor({ ...item, status: "removed" }, [], NO_INSTALL, NO_SUBMIT, {
      onUnpublish: () => {},
      onRepublish: () => {},
    }),
  );

  expect(
    must(statusBadge(), "status badge").textContent,
    "the badge does not carry the removed word",
  ).toBe(uiCopy.store.status.removed);
  expect(
    document.body.textContent,
    "a removed item with no reason does not say it cannot come back",
  ).toContain(uiCopy.store.status.removedPermanent);
});
