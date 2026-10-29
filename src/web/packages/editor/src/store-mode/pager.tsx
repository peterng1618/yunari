import type * as React from "react";
import { ControlIconButton } from "../components/ui/control-icon-button.js";
import {
  type ControlOption,
  ControlSelect,
} from "../components/ui/control-select.js";
import {
  Glyph,
  NEXT_PAGE_GLYPH,
  PREVIOUS_PAGE_GLYPH,
} from "../editor-shell/icons.js";
import { type PageSize, pageSizes } from "../editor-shell/page-size.js";
import { uiCopy } from "../ui-copy.js";

/**
 * The pager: the per-page well at the left, the numbered pages at the right.
 *
 * **It is handed its numbers and moves nothing.** `current`, `total` and `size`
 * are the region's, and the two callbacks report a press — what a page number
 * *means*, which items are on it, and what a changed filter does to it, belongs
 * to whoever holds the items (Task A.6). **A changed filter returns to page
 * one** for the same reason: it lives where the filter is applied rather than
 * here, so the pager cannot hold a page number a filter has invalidated.
 *
 * The bar is its own: a 12px gap, 8px over 16px of padding, and a 1px
 * `--edge` above it.
 */

/** The well's id, named rather than minted: the region has one pager and a
 *  driver reaches the size well by name. */
const PAGE_SIZE_ID = "yunari-store-page-size";

/** The well's list, in `pageSizes`' own order. Each entry is labelled with its
 *  own number — the sizes are data — and `all` with the table's word for it,
 *  which is the one entry that is not a number. */
const PAGE_SIZE_OPTIONS: readonly ControlOption[] = pageSizes.map((size) => ({
  id: String(size),
  name: size === "all" ? uiCopy.store.pager.all : String(size),
}));

/** The pages a numbered pager shows at once: the current one and two either
 *  side. Five rather than every page because a catalogue of four hundred items
 *  is thirty-four pages, and a row of thirty-four numerals is not navigation. */
const PAGE_WINDOW = 5;

/** Seven or fewer pages is where the numbers *are* the list, so the window is
 *  not used at all — five plus the page on either side of it. */
const NO_GAP_TOTAL = PAGE_WINDOW + 2;

/** Every page from `from` to `to`, both included. */
function pagesIn(from: number, to: number): number[] {
  const pages: number[] = [];
  for (let page = from; page <= to; page += 1) pages.push(page);
  return pages;
}

/**
 * The numerals a numbered pager draws, in order, with `"gap"` where pages are
 * skipped.
 *
 * **The five pages nearest the current one, and the first and the last.** Both
 * ends are always reachable, the window slides rather than shrinks so the
 * current page is always one of the five, and a total of seven or fewer shows
 * every page.
 *
 * **A gap is drawn only where it stands for two or more pages** (R119's prose,
 * and the plan's own "never a gap adjacent to a number it stands for"): a hole
 * of exactly one page is drawn as that page's numeral, because a gap standing
 * for one page sits between two numerals it claims, and a gap an author reads as
 * "there is something here" when the number is right there is a mark that says
 * nothing. So `pageNumbers(5, 8)` is every page from 1 to 8 — the hole beside
 * the window is page 2 alone — while `pageNumbers(11, 12)` still begins
 * `1, "gap", 8, …`, because that hole is three pages wide.
 *
 * It is pure and total: a page outside the listing is clamped into it, so a
 * number a filter left behind still numbers something, and a total that is not a
 * whole page count — nothing, less than one, or fractional — numbers nothing
 * rather than inventing page one or drawing half of one.
 */
export function pageNumbers(
  current: number,
  total: number,
): readonly (number | "gap")[] {
  // A page count is a whole number, and half a page is not a page: a fractional
  // `total` is refused rather than truncated, which would answer 12 for 12.5 and
  // hide the caller's bug.
  if (!Number.isInteger(total) || total < 1) return [];
  if (total <= NO_GAP_TOTAL) return pagesIn(1, total);

  const page = Math.min(Math.max(Math.trunc(current) || 1, 1), total);
  const start = Math.min(Math.max(page - 2, 1), total - PAGE_WINDOW + 1);
  const end = start + PAGE_WINDOW - 1;

  const shown: (number | "gap")[] = [];
  // The pages before the window: empty when it already holds page 1, page 1
  // alone at `start === 2`, and `[1, 2]` at `start === 3` — both of those drawn,
  // because a hole of one page is a numeral and not a gap (R121). Two or more is
  // the gap.
  if (start > 3) shown.push(1, "gap");
  else shown.push(...pagesIn(1, start - 1));
  shown.push(...pagesIn(start, end));
  // The pages between the window and the last, by the same rule.
  if (end < total - 2) shown.push("gap", total);
  else shown.push(...pagesIn(end + 1, total));
  return shown;
}

/** One numeral: the icon button carrying the page's own number.
 *
 *  The page in force takes the chosen treatment every other chosen thing in this
 *  store takes — the raised `--stage` behind a `--text` numeral, never an accent
 *  fill. Its name is the table's, because a bare `6` is announced as a
 *  number and says nothing about what pressing it does. */
function PageNumber(props: {
  readonly page: number;
  readonly current: boolean;
  readonly onPage: (page: number) => void;
}): React.JSX.Element {
  const { page, current, onPage } = props;
  return (
    <button
      type="button"
      id={`yunari-store-page-${page}`}
      data-yunari-store-page={page}
      aria-label={uiCopy.store.pager.page(page)}
      aria-current={current ? "page" : undefined}
      onClick={() => onPage(page)}
      className={`inline-flex size-[26px] flex-none items-center justify-center rounded-md border border-transparent font-mono text-sm hover:border-edge hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
        current
          ? "[background:var(--stage)] text-text font-medium"
          : "text-muted"
      }`}
    >
      {page}
    </button>
  );
}

/** The mark a skipped run leaves: the ellipsis, in a numeral's own box
 *  so the row's rhythm does not shift where pages are missing. It is decoration
 *  — the numbers either side say which run is skipped — so it is not read. */
function PageGap(): React.JSX.Element {
  return (
    <span
      data-yunari-store-page-gap=""
      aria-hidden
      className="inline-flex size-[26px] flex-none items-center justify-center text-sm text-muted"
    >
      …
    </span>
  );
}

export function Pager(props: {
  readonly current: number;
  readonly total: number;
  readonly size: PageSize;
  readonly onPage: (page: number) => void;
  readonly onSize: (size: PageSize) => void;
}): React.JSX.Element {
  const { current, total, size, onPage, onSize } = props;

  return (
    <div
      data-yunari-store-pager=""
      className="flex flex-none items-center gap-[var(--space-12)] border-t border-edge px-[var(--space-16)] py-[var(--space-8)]"
    >
      {/* The select, and the 76px well. **The label sits beside the
          well rather than above it**, which is what the surface draws and what
          the browser measures: the row is the 74px label column, the 8px gap
          and the 76px well — 158px, the three values each already fixed, and the
          one width this row needs rather than a 76px column that wraps the well
          to a second line and makes the bar 61px against the 43. */}
      <span data-yunari-store-page-row="" className="w-[158px] flex-none">
        <ControlSelect
          id={PAGE_SIZE_ID}
          label={uiCopy.store.pager.perPage}
          data={{ "data-yunari-store-page-size": "" }}
          value={String(size)}
          options={PAGE_SIZE_OPTIONS}
          onChange={(id) => {
            // A value the list does not name is refused rather than written: a
            // widened option list must not be able to set a size nothing reads.
            const chosen = pageSizes.find((option) => String(option) === id);
            if (chosen === undefined) return;
            onSize(chosen);
          }}
        />
      </span>
      <span className="flex-1" />
      <span className="flex items-center gap-[var(--space-4)]">
        <ControlIconButton
          id="yunari-store-page-previous"
          label={uiCopy.store.pager.previous}
          data={{ "data-yunari-store-page-previous": "" }}
          disabled={current <= 1}
          onClick={() => onPage(current - 1)}
        >
          <Glyph icon={PREVIOUS_PAGE_GLYPH} size={14} />
        </ControlIconButton>
        {pageNumbers(current, total).map((entry, at) =>
          entry === "gap" ? (
            // The index is the key because two gaps can be on screen at once
            // and neither is a page the pager could name.
            <PageGap key={`gap-${at}`} />
          ) : (
            <PageNumber
              key={entry}
              page={entry}
              current={entry === current}
              onPage={onPage}
            />
          ),
        )}
        <ControlIconButton
          id="yunari-store-page-next"
          label={uiCopy.store.pager.next}
          data={{ "data-yunari-store-page-next": "" }}
          disabled={current >= total}
          onClick={() => onPage(current + 1)}
        >
          <Glyph icon={NEXT_PAGE_GLYPH} size={14} />
        </ControlIconButton>
      </span>
    </div>
  );
}
