import type { AssetPage, AssetResult, AssetSourceListing } from "@yunari/renderer-core";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import type { CuratedFontFace } from "../font-catalog.js";
import { uiCopy } from "../ui-copy.js";
import { type ClientOptions, listSources, searchAssets } from "./client.js";
import { FontGrid } from "./font-grid.js";
import { SEARCH_DEBOUNCE_MS } from "./modal.js";

/** R5's three-way filter: it narrows what is drawn and never what is asked. */
type FontFilter = "all" | "trio" | "family";

/** `name` sorts the mixed grid A–Z; `provider` groups each source's rows in
 *  chip order, the order the listing already gives them. */
type FontSort = "name" | "provider";

function isFontSource(source: AssetSourceListing): boolean {
  return source.category === "font" && source.body === "font-picker";
}

function kindOf(result: AssetResult): "trio" | "family" {
  return result.font?.trio === undefined ? "family" : "trio";
}

/**
 * The finder's Fonts body: a search over the host's font sources, one mixed
 * grid of trios and families, and the source chips that choose which providers
 * answer (spec R5, R6).
 *
 * The body owns the question and never a write. A failed source leaves the rows
 * it already drew on screen, because one dead provider must not empty a grid a
 * second one is still answering.
 */
export function FontsBody(props: {
  readonly client?: ClientOptions;
  /** Kept wired for the preview panel (Task 11): the grid reports a selection,
   *  and the session's two writes are what a chosen result reaches the document
   *  through. Nothing in this body applies on its own. */
  readonly onApplyFace: (face: CuratedFontFace) => void;
  readonly onApplyTrio: (trioId: string) => void;
}): React.JSX.Element {
  const client = props.client;
  const [sources, setSources] = useState<
    readonly AssetSourceListing[] | undefined
  >(undefined);
  const [listingFailed, setListingFailed] = useState(false);
  const [disabled, setDisabled] = useState<ReadonlySet<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FontFilter>("all");
  const [sort, setSort] = useState<FontSort>("name");
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  /** Each source's rows kept apart, so a failed page can leave that source's
   *  last good answer alone while the others are redrawn. */
  const [bySource, setBySource] = useState<
    ReadonlyMap<string, readonly AssetResult[]>
  >(new Map());
  /** The page each source's rows reach, and the count it says it has. */
  const [asked, setAsked] = useState<ReadonlyMap<string, number>>(new Map());
  const [totals, setTotals] = useState<ReadonlyMap<string, number>>(new Map());
  const [failures, setFailures] = useState<ReadonlyMap<string, AssetPage>>(
    new Map(),
  );
  /** A question is out and no answer has landed for it yet. */
  const [pending, setPending] = useState(false);
  const ticket = useRef(0);

  useEffect(() => {
    let live = true;
    void listSources(client).then((next) => {
      if (!live) return;
      if (!next.ok) {
        setListingFailed(true);
        setSources([]);
        return;
      }
      setSources(next.sources.filter(isFontSource));
    });
    return () => {
      live = false;
    };
  }, [client]);

  const fontSources = sources ?? [];
  const enabled = fontSources
    .filter((source) => !disabled.has(source.id))
    .map((source) => source.id);
  const enabledKey = enabled.join("|");
  const term = query.trim();
  const labels: Record<string, string> = {};
  for (const source of fontSources) labels[source.id] = source.label;

  function draw(
    pages: readonly AssetPage[],
    wanted: ReadonlyMap<string, number>,
  ): void {
    setBySource((current) => {
      const next = new Map(current);
      for (const page of pages) {
        // A failed page keeps the rows already drawn for its source.
        if (page.failure !== undefined) continue;
        const pageNumber = wanted.get(page.source) ?? 1;
        const kept = pageNumber > 1 ? (next.get(page.source) ?? []) : [];
        const seen = new Set(kept.map((entry) => entry.id));
        next.set(page.source, [
          ...kept,
          ...page.results.filter((entry) => !seen.has(entry.id)),
        ]);
      }
      return next;
    });
    setAsked((current) => {
      const next = new Map(current);
      for (const page of pages) {
        if (page.failure === undefined) {
          next.set(page.source, wanted.get(page.source) ?? 1);
        }
      }
      return next;
    });
    setTotals((current) => {
      const next = new Map(current);
      for (const page of pages) {
        if (page.failure !== undefined) continue;
        if (page.totalPages === undefined) next.delete(page.source);
        else next.set(page.source, page.totalPages);
      }
      return next;
    });
    setFailures((current) => {
      const next = new Map(current);
      for (const page of pages) {
        if (page.failure === undefined) next.delete(page.source);
        else next.set(page.source, page);
      }
      return next;
    });
  }

  useEffect(() => {
    // Any change of question discards an answer already in flight.
    ticket.current += 1;
    const issued = ticket.current;
    setPending(false);

    // An empty term is never sent: the curated source ignores the page and
    // answers the whole catalogue at once (~1 MB), so the guard is the body's.
    if (term === "" || enabled.length === 0) {
      setBySource(new Map());
      setAsked(new Map());
      setTotals(new Map());
      setFailures(new Map());
      setSelectedId(undefined);
      return;
    }

    const timer = setTimeout(() => {
      setPending(true);
      void searchAssets(
        {
          query: term,
          enabled,
          pages: Object.fromEntries(enabled.map((id) => [id, 1])),
          body: "font-picker",
        },
        client,
      ).then((next) => {
        if (issued !== ticket.current) return;
        setPending(false);
        draw(next.pages, new Map(enabled.map((id) => [id, 1])));
        setSelectedId(undefined);
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // `enabledKey` stands for the enabled list; a new array every render would
    // restart the debounce on unrelated state.
  }, [term, enabledKey, client, sources]);

  const rows: AssetResult[] = [];
  // A source switched off after its rows landed leaves the grid at once.
  for (const source of fontSources) {
    if (!disabled.has(source.id)) rows.push(...(bySource.get(source.id) ?? []));
  }
  const filtered = rows.filter(
    (result) => filter === "all" || kindOf(result) === filter,
  );
  const shown =
    sort === "name"
      ? [...filtered].sort((left, right) => left.name.localeCompare(right.name))
      : filtered;

  const nextPages: Record<string, number> = {};
  for (const id of enabled) {
    const total = totals.get(id) ?? 1;
    const drawn = asked.get(id) ?? 1;
    if (drawn < total) nextPages[id] = drawn + 1;
  }

  const loadMore = (): void => {
    const wanted = new Map(Object.entries(nextPages));
    if (wanted.size === 0) return;
    // Not a new question, so the ticket is not bumped: a query typed while
    // this page is in flight still discards it.
    const issued = ticket.current;
    void searchAssets(
      { query: term, enabled, pages: nextPages, body: "font-picker" },
      client,
    ).then((next) => {
      if (issued !== ticket.current) return;
      draw(next.pages, wanted);
    });
  };

  const copy = uiCopy.assets;

  if (listingFailed) {
    return (
      <p
        data-yunari-font-listing-failure=""
        className="text-sm text-muted"
      >
        {copy.hostUnavailable}
      </p>
    );
  }
  if (sources === undefined) return <></>;
  if (fontSources.length === 0) {
    return <p className="text-sm text-muted">{copy.noSource}</p>;
  }

  const allOff = enabled.length === 0;
  const empty = term !== "" && !allOff && asked.size > 0 && shown.length === 0;
  const canLoadMore = !pending && Object.keys(nextPages).length > 0;

  return (
    <div className="flex min-h-0 flex-col gap-[var(--space-8)]">
      <div className="flex flex-wrap items-center gap-[var(--space-8)]">
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder={copy.fontSearch}
          aria-label={copy.fontSearch}
          data-yunari-font-search=""
          className="min-w-56 flex-1 rounded-[var(--radius-sm)] border border-edge bg-[var(--panel-2)] px-[var(--space-10)] py-[var(--space-6)] text-sm"
        />
        <div
          role="group"
          aria-label={copy.fontFilterLabel}
          className="flex items-center gap-[var(--space-4)]"
        >
          {(["all", "trio", "family"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={filter === option}
              data-yunari-font-filter={option}
              onClick={() => {
                setFilter(option);
              }}
              className="rounded-full border border-edge px-[var(--space-10)] py-[var(--space-4)] text-xs aria-pressed:border-accent aria-pressed:text-accent"
            >
              {copy.fontFilter[option]}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-[var(--space-6)] text-xs text-muted">
          {copy.fontSortLabel}
          <select
            value={sort}
            data-yunari-font-sort=""
            onChange={(event) => {
              setSort(event.target.value as FontSort);
            }}
            className="rounded-[var(--radius-sm)] border border-edge bg-[var(--panel-2)] px-[var(--space-6)] py-[var(--space-4)] text-xs"
          >
            {(["name", "provider"] as const).map((option) => (
              <option key={option} value={option}>
                {copy.fontSort[option]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {fontSources.length > 1 ? (
        <div
          role="group"
          aria-label={copy.fontSourcesLabel}
          className="flex flex-wrap items-center gap-[var(--space-6)]"
        >
          {fontSources.map((source) => {
            const off = disabled.has(source.id);
            return (
              <button
                key={source.id}
                type="button"
                aria-pressed={!off}
                data-yunari-font-chip={source.id}
                data-disabled={off ? "" : undefined}
                onClick={() => {
                  setDisabled((current) => {
                    const next = new Set(current);
                    if (next.has(source.id)) next.delete(source.id);
                    // The last enabled source stays on: with none, there is no
                    // question to ask and nothing to undo from this row.
                    else if (enabled.length > 1) next.add(source.id);
                    return next;
                  });
                }}
                className="rounded-full border border-edge px-[var(--space-10)] py-[var(--space-4)] text-xs aria-pressed:border-accent aria-pressed:text-accent data-[disabled]:text-faint"
              >
                {source.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {[...failures.values()].map((page) => {
        const failure = page.failure;
        if (failure === undefined) return null;
        const label = labels[page.source] ?? page.source;
        return (
          <p
            key={page.source}
            data-yunari-font-failure={page.source}
            className="text-sm text-muted"
          >
            {failure.reason === "needs-credential"
              ? copy.needsCredential(label)
              : copy.sourceFailed(label, failure.message)}
          </p>
        );
      })}

      {allOff ? (
        <p data-yunari-font-sources-off="" className="text-sm text-muted">
          {copy.kindSourcesOff}
        </p>
      ) : term === "" ? (
        <p data-yunari-font-empty="" className="text-sm text-muted">
          {copy.fontEmptyQuery}
        </p>
      ) : shown.length > 0 ? (
        <FontGrid
          results={shown}
          selectedId={selectedId}
          onSelect={(result) => {
            setSelectedId(result.id);
          }}
          providers={labels}
          {...(canLoadMore ? { onLoadMore: loadMore } : {})}
        />
      ) : pending ? (
        // Nothing drawn yet: say the question is out rather than draw an empty
        // listbox that reads as a broken body. Rows already drawn stay up.
        <p data-yunari-font-searching="" className="text-sm text-muted">
          {copy.fontSearching}
        </p>
      ) : empty ? (
        <p data-yunari-font-no-matches="" className="text-sm text-muted">
          {copy.noResults}
        </p>
      ) : null}
    </div>
  );
}
