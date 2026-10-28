import type { AssetPage, AssetResult } from "@yunari/renderer-core";
import { interleave } from "./interleave.js";

/** One result with the page it answered on, so its source and its action need
 *  no second lookup. */
export interface FinderRow {
  readonly page: AssetPage;
  readonly result: AssetResult;
}

/** One tab's accumulation: the question it answers, everything shown so far,
 *  which page each source was asked for, how far each says it reaches, and the
 *  sources that refused. Pure data — no React, no client. */
export interface TabData {
  readonly query: string;
  readonly rows: readonly FinderRow[];
  readonly asked: ReadonlyMap<string, number>;
  readonly totals: ReadonlyMap<string, number>;
  readonly failures: ReadonlyMap<string, AssetPage>;
}

export const EMPTY_TAB: TabData = {
  query: "",
  rows: [],
  asked: new Map(),
  totals: new Map(),
  failures: new Map(),
};

export function resetForQuestion(query: string): TabData {
  return { ...EMPTY_TAB, query };
}

/** The first page of every enabled source, and afterwards the next page of each
 *  source that says it has one. A source with no total is at its end; a failed
 *  source is retried rather than paged. */
export function nextPages(
  data: TabData,
  enabled: readonly string[],
): Record<string, number> {
  const pages: Record<string, number> = {};
  if (data.asked.size === 0) {
    for (const id of enabled) pages[id] = 1;
    return pages;
  }
  for (const id of enabled) {
    if (data.failures.has(id)) continue;
    const asked = data.asked.get(id);
    if (asked === undefined) {
      pages[id] = 1;
      continue;
    }
    const total = data.totals.get(id);
    if (total !== undefined && total > asked) pages[id] = asked + 1;
  }
  return pages;
}

/** The page to ask again after a refusal: the one that failed. */
export function retryPages(
  data: TabData,
  enabled: readonly string[],
): Record<string, number> {
  const pages: Record<string, number> = {};
  for (const id of enabled) {
    if (!data.failures.has(id)) continue;
    pages[id] = (data.asked.get(id) ?? 0) + 1;
  }
  return pages;
}

export function hasMore(data: TabData, enabled: readonly string[]): boolean {
  return Object.keys(nextPages(data, enabled)).length > 0;
}

/** A page's answer lands after what is already shown: new rows append, an id
 *  already drawn is skipped, and a refusal is kept as a failure without moving
 *  the rows, the page count or the total. */
export function appendAnswer(
  data: TabData,
  pages: readonly AssetPage[],
  asked: Readonly<Record<string, number>>,
): TabData {
  const nextAsked = new Map(data.asked);
  const nextTotals = new Map(data.totals);
  const nextFailures = new Map(data.failures);
  const answered: AssetPage[] = [];

  for (const page of pages) {
    if (page.failure !== undefined) {
      nextFailures.set(page.source, page);
      continue;
    }
    nextFailures.delete(page.source);
    const at = asked[page.source];
    if (at !== undefined) nextAsked.set(page.source, at);
    if (page.totalPages === undefined) nextTotals.delete(page.source);
    else nextTotals.set(page.source, page.totalPages);
    answered.push(page);
  }

  const pageOf = new Map<AssetResult, AssetPage>();
  for (const row of data.rows) pageOf.set(row.result, row.page);
  for (const page of answered) {
    for (const result of page.results) pageOf.set(result, page);
  }

  const seen = new Set<string>();
  const rows: FinderRow[] = [];
  for (const result of interleave(
    answered,
    data.rows.map((row) => row.result),
  )) {
    const page = pageOf.get(result);
    if (page === undefined) continue;
    const key = `${page.source}:${result.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ page, result });
  }

  return {
    ...data,
    rows,
    asked: nextAsked,
    totals: nextTotals,
    failures: nextFailures,
  };
}

/** The rows of the sources that are still switched on, in the order they
 *  arrived. A switched-off source keeps its rows for when it returns. */
export function rowsOf(
  data: TabData,
  enabled: readonly string[],
): readonly FinderRow[] {
  const wanted = new Set(enabled);
  return data.rows.filter((row) => wanted.has(row.page.source));
}
