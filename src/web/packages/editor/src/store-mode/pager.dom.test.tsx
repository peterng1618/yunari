// @vitest-environment jsdom
/**
 * The pager: which numerals a numbered pager draws, and the four things the
 * region hands it.
 *
 * **What this file owns.** `pageNumbers` — the pure decision, with the plan's
 * two cases, the near-end shapes fix round 1 rules and the invariants over every
 * current page of every total up to two dozen — and the component: the numeral
 * that reports its own page, the two steps and where they stop, the size well's
 * four entries, and the chosen treatment on the page in force.
 *
 * **What it deliberately does not measure.** jsdom lays nothing out, so the
 * 26px numeral and the 14px chevron are declarations read off the class list
 * rather than a reflow; the surface fixes them. **The well's 76px and its row's
 * 158px are read twice**: their class lists here, and the drawn boxes in the
 * browser (`tests/e2e/editor-rail.spec.ts`), which is where the wrap that made
 * the bar 61px instead of the 43 was measured.
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type { PageSize } from "../editor-shell/page-size.js";
import { uiCopy } from "../ui-copy.js";
import { Pager, pageNumbers } from "./pager.js";

// Base UI's tooltip and select popup need three browser APIs jsdom has none of:
// floating-ui observes its anchor, the popup waits for its own open transition,
// and it asks the selector engine for `:modal`/`:popover-open`, which jsdom
// parses slowly enough to dominate the file. Each test file that mounts a
// control supplies its own — there is no shared harness for it here.
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

/** A missing element is a defect this file names, rather than a `null` a later
 *  assertion reports as a wrong value. */
function must<T extends Element>(found: T | null, what: string): T {
  if (found === null) throw new Error(`the pager drew no ${what}`);
  return found;
}

/** React and floating-ui schedule outside `act`, so a popup is flushed with
 *  macrotasks rather than one. */
async function flush(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function click(target: Element, detail = 0): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail }),
    );
  });
}

/** A mouse press. Base UI's list items commit a click only when the press that
 *  precedes it started on the item, so the press is part of the interaction. */
async function pointerDown(target: Element): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerType: "mouse",
        button: 0,
      }),
    );
  });
}

/** The pager at one page of one listing, with callbacks a case can read. */
function pager(over: {
  readonly current?: number;
  readonly total?: number;
  readonly size?: PageSize;
  readonly onPage?: (page: number) => void;
  readonly onSize?: (size: PageSize) => void;
}): ReactElement {
  return (
    <Pager
      current={over.current ?? 1}
      total={over.total ?? 12}
      size={over.size ?? 12}
      onPage={over.onPage ?? (() => undefined)}
      onSize={over.onSize ?? (() => undefined)}
    />
  );
}

/** The numerals the pager drew, in the order it drew them. */
function numerals(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>("[data-yunari-store-page]"),
  );
}

/** The numbers a pager's own output names, gaps dropped. */
function numbersOf(shown: readonly (number | "gap")[]): number[] {
  return shown.filter((entry): entry is number => entry !== "gap");
}

/**
 * The plan's own case: the current page and two either side.
 */
it("shows the five pages nearest the current one", () => {
  expect(pageNumbers(6, 12)).toEqual([1, "gap", 4, 5, 6, 7, 8, "gap", 12]);
});

/**
 * Seven or fewer is where the numbers *are* the list, so every one is drawn and
 * no gap can stand between them.
 *
 * It is not the *only* shape that shows every page: with the one-page-hole rule
 * a total of 8 or 9 shows them all from some positions too (`pageNumbers(5, 8)`
 * is every page). This case is about `NO_GAP_TOTAL`, and it stays true as the
 * plan writes it.
 */
it("shows every page when there are seven or fewer", () => {
  expect(pageNumbers(2, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
});

/**
 * The near-end shapes, as fix round 1 rules them (R119's own example is
 * withdrawn). The window slides rather than shrinks, so a hole beside it is
 * often one page wide — and **a hole of one page is drawn as that page's
 * numeral**, because a gap standing for one page sits adjacent to a number it
 * stands for, which the plan forbids.
 */
it("draws a gap only where it stands for two or more pages", () => {
  expect(pageNumbers(5, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(pageNumbers(4, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  // Both arms at once: the holes are pages 2 and 8, one page each.
  expect(pageNumbers(5, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  expect(pageNumbers(1, 12)).toEqual([1, 2, 3, 4, 5, "gap", 12]);
  expect(pageNumbers(11, 12)).toEqual([1, "gap", 8, 9, 10, 11, 12]);
  expect(pageNumbers(12, 12)).toEqual([1, "gap", 8, 9, 10, 11, 12]);
});

/**
 * The invariants the plan states, over every current page of every listing this
 * half can hold: no duplicate, the first and the last always reachable, the
 * current page always drawn, and no gap adjacent to a number it stands for —
 * which is the same claim as "a gap stands for two or more pages", read off the
 * two numerals around it.
 *
 * The case is derived rather than pinned to the shapes above, because a rule
 * that held at 12 pages and broke at 13 is exactly what a fixed list of cases
 * cannot see.
 */
it("keeps every page reachable and every gap honest, at every total", () => {
  for (let total = 1; total <= 24; total += 1) {
    for (let current = 1; current <= total; current += 1) {
      const shown = pageNumbers(current, total);
      const where = `${current} of ${total}`;
      const numbers = numbersOf(shown);

      expect(numbers[0], `the first page is missing at ${where}`).toBe(1);
      expect(numbers.at(-1), `the last page is missing at ${where}`).toBe(
        total,
      );
      expect(new Set(numbers).size, `a page is drawn twice at ${where}`).toBe(
        numbers.length,
      );
      expect(numbers, `the current page is missing at ${where}`).toContain(
        current,
      );

      shown.forEach((entry, at) => {
        if (entry !== "gap") return;
        const before = shown[at - 1];
        const after = shown[at + 1];
        if (typeof before !== "number" || typeof after !== "number")
          throw new Error(`the gap at ${where} has no numbers around it`);
        expect(
          after - before,
          `the gap at ${where} stands for one page, which is drawn instead`,
        ).toBeGreaterThan(2);
      });
    }
  }
});

/** A listing with no pages numbers nothing rather than inventing a page one. */
it("numbers nothing when there is nothing to page", () => {
  expect(pageNumbers(1, 0)).toEqual([]);
});

/**
 * A page count that is not a whole number is refused rather than truncated
 * (refuse invalid numeric input rather than coercing it). Half a
 * page is not a page, and answering 12 for 12.5 hides the caller's bug behind a
 * numeral nothing could draw.
 */
it("numbers nothing for a page count that is not a whole number", () => {
  expect(pageNumbers(1, 12.5)).toEqual([]);
  expect(pageNumbers(6, 0.5)).toEqual([]);
  expect(pageNumbers(1, Number.NaN)).toEqual([]);
  expect(pageNumbers(1, Number.POSITIVE_INFINITY)).toEqual([]);
});

/**
 * The current page carries the store's chosen treatment — `--stage` behind a
 * `--text` numeral, the same one the halves and the facet rows take — and never
 * an accent fill.
 */
it("marks the current page with the chosen treatment and no accent fill", async () => {
  const container = await mount(pager({ current: 6, total: 12 }));

  const current = must(
    container.querySelector<HTMLElement>(
      '[data-yunari-store-page][aria-current="page"]',
    ),
    "current page",
  );
  expect(current.textContent, "the current numeral is not its own page").toBe(
    "6",
  );
  const treatment = current.className;
  expect(
    treatment,
    "the current page is not lifted to the raised background",
  ).toContain("[background:var(--stage)]");
  expect(treatment, "the current numeral is not --text").toContain("text-text");
  // the palette rations the accent to one filled element per region, so the chosen
  // treatment is a raised background and a `--text` numeral and never a fill.
  // The focus ring is not a fill and is not what this reads.
  for (const fill of [
    "bg-accent",
    "border-accent",
    "[background:var(--accent)]",
  ])
    expect(
      treatment,
      `the current page is filled with the accent (${fill})`,
    ).not.toContain(fill);

  // Exactly one page is the current one: a pager that marked none, or marked
  // two, would satisfy the reading above.
  expect(
    container.querySelectorAll('[data-yunari-store-page][aria-current="page"]'),
  ).toHaveLength(1);
});

/** Every numeral names its page — a bare `6` announces nothing — and reports
 *  the page it names. */
it("names every page and reports the one pressed", async () => {
  const onPage = vi.fn();
  const container = await mount(pager({ current: 6, total: 12, onPage }));

  const drawn = numerals(container);
  const shown = numbersOf(pageNumbers(6, 12));
  expect(
    drawn.map((button) => button.textContent),
    "the pager does not draw the numerals the rule answers",
  ).toEqual(shown.map(String));
  expect(
    drawn.map((button) => button.getAttribute("aria-label")),
    "the numerals are not named from the copy table",
  ).toEqual(shown.map((page) => uiCopy.store.pager.page(page)));
  // The two skipped runs are two marks, not numerals.
  expect(
    container.querySelectorAll("[data-yunari-store-page-gap]"),
  ).toHaveLength(2);

  const fourth = must(
    drawn.find(
      (button) => button.getAttribute("data-yunari-store-page") === "4",
    ) ?? null,
    "numeral 4",
  );
  await click(fourth);

  expect(onPage).toHaveBeenCalledWith(4);
  // The pager moves nothing: which page is in force is the region's.
  expect(numerals(container).map((button) => button.textContent)).toEqual(
    shown.map(String),
  );
});

/** The two steps, and where they stop: the ends are disabled rather than
 *  reporting a page outside the listing. */
it("steps one page at a time and stops at the ends", async () => {
  const onPage = vi.fn();
  const container = await mount(pager({ current: 1, total: 12, onPage }));

  const previous = must(
    container.querySelector<HTMLButtonElement>(
      "[data-yunari-store-page-previous]",
    ),
    "previous step",
  );
  const next = must(
    container.querySelector<HTMLButtonElement>("[data-yunari-store-page-next]"),
    "next step",
  );
  expect(previous.disabled, "page one can step back off the listing").toBe(
    true,
  );
  expect(next.disabled).toBe(false);
  expect(previous.getAttribute("aria-label")).toBe(uiCopy.store.pager.previous);
  expect(next.getAttribute("aria-label")).toBe(uiCopy.store.pager.next);

  await click(next);
  expect(onPage).toHaveBeenCalledWith(2);
});

it("disables the forward step on the last page", async () => {
  const onPage = vi.fn();
  const container = await mount(pager({ current: 12, total: 12, onPage }));

  const next = must(
    container.querySelector<HTMLButtonElement>("[data-yunari-store-page-next]"),
    "next step",
  );
  expect(next.disabled, "the last page can step past the listing").toBe(true);
  await click(next);
  expect(onPage).not.toHaveBeenCalled();

  await click(
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-store-page-previous]",
      ),
      "previous step",
    ),
  );
  expect(onPage).toHaveBeenCalledWith(11);
});

/** The size well: the four sizes in the order, named from the table,
 *  and the chosen one reported. */
it("offers the four page sizes and reports the one chosen", async () => {
  const onSize = vi.fn();
  const container = await mount(pager({ size: 12, onSize }));

  const trigger = must(
    container.querySelector<HTMLElement>("[data-yunari-store-page-size]"),
    "size well",
  );
  expect(
    // The value carrier inside the trigger, which is where `ControlSelect`
    // prints the chosen label — a driver reads the value it must not guess at.
    must(
      trigger.querySelector<HTMLElement>("[data-yunari-value]"),
      "size value",
    ).getAttribute("data-yunari-value"),
    "the well does not print the size in force",
  ).toBe("12");
  expect(
    container.querySelector("label")?.textContent,
    "the well is not labelled with the table's word",
  ).toBe(uiCopy.store.pager.perPage);

  await click(trigger);
  await flush();
  const options = Array.from(
    document.querySelectorAll<HTMLElement>("[data-yunari-option]"),
  );
  expect(
    options.map((option) => option.getAttribute("data-yunari-option")),
    "the well does not offer the four sizes in the order",
  ).toEqual(["12", "24", "48", "all"]);
  expect(
    options.map((option) => option.textContent),
    "the whole-library size is not the table's own word",
  ).toEqual(["12", "24", "48", uiCopy.store.pager.all]);

  const chosen = options.find(
    (option) => option.getAttribute("data-yunari-option") === "24",
  );
  if (chosen === undefined) throw new Error("the well offers no 24");
  await pointerDown(chosen);
  await click(chosen, 1);
  await flush();

  expect(onSize).toHaveBeenCalledWith(24);
});

/**
 * **The row the `Per page` label and its well share is 158px** — the 74px label
 * column, the 8px gap and the 76px well, each already fixed — because
 * a row given only the well's 76px wraps the well onto a second line, and the
 * bar grows from the 43px to 61.
 *
 * The number is pinned here and the *boxes* are measured in the browser
 * (`tests/e2e/editor-rail.spec.ts`): jsdom lays nothing out, so a case that
 * asserted a label above a well would pass whatever the widths were, and a case
 * that asserts only the class list cannot see the wrap. Both halves are read,
 * and neither alone is the claim.
 */
it("gives the label and its well its own row width", async () => {
  const container = await mount(pager({}));

  const row = must(
    container.querySelector<HTMLElement>("[data-yunari-store-page-row]"),
    "size row",
  );
  expect(
    row.className,
    "the per-page row is not the 158px its label and well need on one line",
  ).toContain("w-[158px]");
  expect(
    must(
      row.querySelector<HTMLElement>("[data-yunari-store-page-size]"),
      "size well",
    ),
    "the well is outside the row the label shares",
  ).not.toBeNull();
});
