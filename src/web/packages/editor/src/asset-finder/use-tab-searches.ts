import type {
  AssetSourceListing,
  ListingCategory,
} from "@yunari/renderer-core";
import { useEffect, useRef, useState } from "react";
import { type ClientOptions, searchAssets } from "./client.js";
import {
  bodyOf,
  EMPTY_VIEW,
  emptyViews,
  SEARCH_DEBOUNCE_MS,
  type TabView,
  viewOf,
} from "./finder-model.js";
import {
  appendAnswer,
  nextPages,
  resetForQuestion,
  retryPages,
} from "./tab-data.js";

/** One tab's question, rows, page cursor and selection, plus the three asks a
 *  tab makes: a new question, the next page, and the page a source refused.
 *  A late answer is dropped by a per-category ticket. */
export function useTabSearches(props: {
  readonly open: boolean;
  readonly active: ListingCategory | undefined;
  readonly visibleSources: readonly AssetSourceListing[];
  readonly enabled: readonly string[];
  readonly enabledSources: readonly AssetSourceListing[];
  readonly client: ClientOptions | undefined;
  readonly onNotice: (notice: string | undefined) => void;
}): {
  readonly views: Record<string, TabView>;
  readonly patch: (
    category: ListingCategory,
    update: (current: TabView) => TabView,
  ) => void;
  readonly askNew: (category: ListingCategory, query: string) => void;
  readonly loadMore: () => void;
  readonly retry: () => void;
} {
  const { open, active, visibleSources, enabled, enabledSources, client } =
    props;
  const [views, setViews] = useState<Record<string, TabView>>(emptyViews);
  const tickets = useRef(new Map<string, number>());
  const announced = useRef(false);
  // A category this session has not drawn yet reads as the empty view rather
  // than being pre-populated for an id nothing knows.
  const view = active === undefined ? EMPTY_VIEW : viewOf(views, active);

  // A closed finder is not a status surface: the sentence a write left belongs
  // to the session that ran it, so reopening starts without one.
  useEffect(() => {
    if (open) return;
    setViews((current) => {
      let changed = false;
      const next = { ...current };
      for (const [category, view] of Object.entries(current)) {
        if (view.message === undefined) continue;
        next[category] = { ...view, message: undefined };
        changed = true;
      }
      return changed ? next : current;
    });
  }, [open]);

  const bump = (category: ListingCategory): number => {
    const next = (tickets.current.get(category) ?? 0) + 1;
    tickets.current.set(category, next);
    return next;
  };
  const ticketOf = (category: ListingCategory): number =>
    tickets.current.get(category) ?? 0;
  const patch = (
    category: ListingCategory,
    update: (current: TabView) => TabView,
  ): void => {
    setViews((current) => ({
      ...current,
      [category]: update(viewOf(current, category)),
    }));
  };

  /** A new question: what was shown answered the old one, so it leaves at the
   *  press that asked, and an answer already in flight is no longer wanted. */
  const askNew = (category: ListingCategory, query: string): void => {
    bump(category);
    patch(category, (current) => ({
      ...current,
      data: resetForQuestion(query),
      browsed: false,
      loading: undefined,
      selection: undefined,
      message: undefined,
    }));
  };

  const enabledKey = enabled.join("|");

  useEffect(() => {
    if (!open || active === undefined) return undefined;
    // A body category draws its own component, and a tab whose sources are all
    // switched off has no question to ask.
    if (visibleSources.length === 0 || enabled.length === 0) return undefined;
    if (view.browsed) return undefined;

    const category = active;
    const question = view.data.query;
    const pages = nextPages(view.data, enabled);
    if (Object.keys(pages).length === 0) return undefined;
    const issued = bump(category);
    patch(category, (current) => ({ ...current, loading: "first" }));

    const timer = setTimeout(() => {
      void searchAssets(
        { query: question, enabled, pages, body: bodyOf(category) },
        client,
      ).then((next) => {
        if (issued !== ticketOf(category)) return;
        const reached = [
          ...new Set(
            enabledSources
              .filter((source) => enabled.includes(source.id))
              .map((source) => source.host)
              .filter((host): host is string => host !== null),
          ),
        ];
        if (!announced.current && reached.length > 0) {
          announced.current = true;
          props.onNotice(reached.join(", "));
        } else if (announced.current) {
          props.onNotice(undefined);
        }
        patch(category, (current) => ({
          ...current,
          data: appendAnswer(current.data, next.pages, pages),
          loading: undefined,
          browsed: true,
        }));
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // `enabledKey` and `question` stand for the source list and the query:
    // `enabledSources` is a new array every render and would restart the timer.
  }, [open, active, view.browsed, view.data.query, enabledKey, client]);

  const loadMore = (): void => {
    if (active === undefined) return;
    const category = active;
    const current = viewOf(views, category);
    if (current.loading !== undefined || !current.browsed) return;
    const pages = nextPages(current.data, enabled);
    if (Object.keys(pages).length === 0) return;

    const issued = bump(category);
    patch(category, (view) => ({ ...view, loading: "more" }));
    void searchAssets(
      {
        query: current.data.query,
        enabled,
        pages,
        body: bodyOf(category),
      },
      client,
    ).then((next) => {
      if (issued !== ticketOf(category)) return;
      patch(category, (view) => ({
        ...view,
        data: appendAnswer(view.data, next.pages, pages),
        loading: undefined,
      }));
    });
  };

  /** Ask again the page each refused source failed on. A success clears that
   *  source's failure in `appendAnswer`, so the sentence leaves with the rows. */
  const retry = (): void => {
    if (active === undefined) return;
    const category = active;
    const current = viewOf(views, category);
    const pages = retryPages(current.data, enabled);
    if (Object.keys(pages).length === 0) return;

    const issued = bump(category);
    patch(category, (view) => ({ ...view, loading: "first" }));
    void searchAssets(
      {
        query: current.data.query,
        enabled,
        pages,
        body: bodyOf(category),
      },
      client,
    ).then((next) => {
      if (issued !== ticketOf(category)) return;
      patch(category, (view) => ({
        ...view,
        data: appendAnswer(view.data, next.pages, pages),
        loading: undefined,
        browsed: true,
      }));
    });
  };

  return { views, patch, askNew, loadMore, retry };
}
