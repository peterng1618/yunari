import { STORE_ITEM_KINDS } from "@yunari/renderer-core";
import type { CollectionDraft, CollectionInclude } from "@yunari/theme-package";
import type * as React from "react";
import { useEffect, useMemo, useState } from "react";
import type { StoreItem } from "../store-mode/local-source.js";
import { mineThemeSource } from "../store-mode/mine-source.js";
import {
  catalogueItemOf,
  readCatalogueListing,
} from "../store-mode/online-source.js";
import { Empty, Failure } from "../store-mode/region.js";
import { StoreStatusBadge } from "../store-mode/status-badge.js";
import { useSubmit } from "../store-mode/use-submit.js";
import { uiCopy } from "../ui-copy.js";

export {
  type CollectionDraft,
  collectionManifest,
  parseCollectionDraft,
  readCollectionDraft,
} from "@yunari/theme-package";

/** One page's read: the rows, or the fact that nothing answered. */
type Read<T> =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "read"; readonly rows: T };

const words = uiCopy.library.collectionBuilder;

/** Why a listing cannot be added, or nothing when it can. The list is the
 *  published catalogue with collections filtered out, so the only refusals left
 *  are a row with no id and one already added. Membership itself — published,
 *  one level deep — is the store's rule and is checked there. */
function addRefusalOf(
  item: StoreItem,
  includes: readonly CollectionInclude[],
): string | undefined {
  if (item.id === "") return words.unknown;
  if (includes.some((include) => include.id === item.id)) {
    return words.alreadyAdded(item.name);
  }
  return undefined;
}

/**
 * The collection builder: published listings to pick from, the drafts the
 * author has added, and the one press that publishes them.
 *
 * **The browser posts the draft and nothing else**: the host packages it,
 * decides whether the name publishes a new listing or a new version of the
 * author's existing one, and holds the store token. Every refusal — the
 * reader's or the host's — is drawn in one live region, verbatim.
 */
export function CollectionBuilder(props: {
  readonly listings: readonly StoreItem[];
  readonly onSubmitted?: () => void;
  readonly fetch?: typeof fetch;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [includes, setIncludes] = useState<readonly CollectionInclude[]>([]);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | undefined>(undefined);

  const submit = useSubmit({
    ...(props.fetch === undefined ? {} : { fetch: props.fetch }),
    ...(props.onSubmitted === undefined
      ? {}
      : { onSubmitted: props.onSubmitted }),
  });
  const collection = submit.collection;

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle === ""
      ? props.listings
      : props.listings.filter((item) =>
          item.name.toLowerCase().includes(needle),
        );
  }, [props.listings, query]);

  const nameOf = (id: string): string =>
    props.listings.find((item) => item.id === id)?.name ?? id;

  const add = (item: StoreItem): void => {
    const refusal = addRefusalOf(item, includes);
    if (refusal !== undefined) {
      setNotice(refusal);
      return;
    }
    setNotice(undefined);
    setIncludes((current) => [...current, { id: item.id, optional: false }]);
  };

  const toggleOptional = (id: string): void => {
    setIncludes((current) =>
      current.map((include) =>
        include.id === id
          ? { id: include.id, optional: !include.optional }
          : include,
      ),
    );
  };

  const publish = (): void => {
    const draft: CollectionDraft = { name, description, includes };
    collection.onSubmit({ draft });
  };

  const refusal =
    collection.state === "refused"
      ? (collection.refusal ?? "")
      : collection.state === "submitted" && collection.status !== undefined
        ? uiCopy.store.submit.submitted(collection.status)
        : collection.state === "authorising"
          ? uiCopy.store.submit.authorising
          : "";

  return (
    <section
      data-yunari-collection-builder=""
      aria-label={words.heading}
      className="flex flex-col gap-[var(--space-12)] rounded-[var(--radius-lg)] border border-edge bg-panel p-[var(--space-16)]"
    >
      <div className="flex flex-col gap-[var(--space-4)]">
        <h3 className="text-sm font-medium text-text">{words.heading}</h3>
        <p className="text-xs text-muted">{words.lead}</p>
      </div>

      <label className="flex flex-col gap-[var(--space-4)] text-xs text-muted">
        {words.name}
        <span className="flex items-center rounded-[var(--radius-md)] border border-edge bg-panel-2 px-[var(--space-8)] py-[var(--space-6)]">
          <input
            type="text"
            data-yunari-collection-name=""
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-full w-full bg-transparent text-sm text-text outline-none"
          />
        </span>
      </label>

      <label className="flex flex-col gap-[var(--space-4)] text-xs text-muted">
        {words.description}
        <span className="flex items-center rounded-[var(--radius-md)] border border-edge bg-panel-2 px-[var(--space-8)] py-[var(--space-6)]">
          <textarea
            rows={3}
            data-yunari-collection-description=""
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="w-full resize-none bg-transparent text-sm text-text outline-none"
          />
        </span>
      </label>

      <div className="flex flex-col gap-[var(--space-8)]">
        <span className="flex items-center rounded-[var(--radius-md)] border border-edge bg-panel-2 px-[var(--space-8)] py-[var(--space-6)]">
          <input
            type="search"
            data-yunari-collection-search=""
            aria-label={words.search}
            placeholder={words.search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-full w-full bg-transparent text-sm text-text outline-none"
          />
        </span>
        {props.listings.length === 0 ? (
          <p className="text-xs text-faint">{words.empty}</p>
        ) : shown.length === 0 ? (
          <p className="text-xs text-faint">{words.noMatches}</p>
        ) : (
          <ul
            aria-label={words.search}
            className="flex flex-col gap-[var(--space-4)] overflow-y-auto"
          >
            {shown.map((item) => (
              <li
                key={item.id}
                data-yunari-collection-candidate={item.id}
                className="flex items-center gap-[var(--space-8)] rounded-[var(--radius-md)] bg-panel-2 px-[var(--space-8)] py-[var(--space-4)]"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-text">
                  {item.name}
                </span>
                <button
                  type="button"
                  data-yunari-collection-add={item.id}
                  aria-label={words.add(item.name)}
                  onClick={() => add(item)}
                  className="flex-none rounded-[var(--radius-md)] border border-edge bg-[var(--yunari-control-bg)] px-[var(--space-8)] py-[var(--space-4)] text-xs text-text enabled:hover:border-muted"
                >
                  {words.addWord}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p
          data-yunari-collection-notice=""
          role="status"
          className="min-h-[var(--space-16)] text-xs text-warn"
        >
          {notice ?? ""}
        </p>
      </div>

      <div className="flex flex-col gap-[var(--space-4)]">
        <h4 className="text-xs font-medium text-muted">{words.includes}</h4>
        {includes.length === 0 ? (
          <p className="text-xs text-faint">{words.includesEmpty}</p>
        ) : (
          <ul
            aria-label={words.includes}
            className="flex flex-col gap-[var(--space-4)]"
          >
            {includes.map((include) => {
              const listingName = nameOf(include.id);
              return (
                <li
                  key={include.id}
                  data-yunari-collection-include={include.id}
                  className="flex items-center gap-[var(--space-8)] rounded-[var(--radius-md)] bg-panel-2 px-[var(--space-8)] py-[var(--space-4)]"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-text">
                    {listingName}
                  </span>
                  <button
                    type="button"
                    data-yunari-collection-optional={include.id}
                    aria-pressed={include.optional}
                    aria-label={
                      include.optional
                        ? words.makeRequired(listingName)
                        : words.makeOptional(listingName)
                    }
                    onClick={() => toggleOptional(include.id)}
                    className="flex-none rounded-[var(--radius-md)] border border-edge bg-[var(--yunari-control-bg)] px-[var(--space-8)] py-[var(--space-4)] text-xs text-muted aria-pressed:border-accent aria-pressed:text-text hover:border-muted"
                  >
                    {include.optional ? words.optionalWord : words.requiredWord}
                  </button>
                  <button
                    type="button"
                    data-yunari-collection-remove={include.id}
                    aria-label={words.remove(listingName)}
                    onClick={() =>
                      setIncludes((current) =>
                        current.filter((entry) => entry.id !== include.id),
                      )
                    }
                    className="flex-none rounded-[var(--radius-md)] border border-edge bg-[var(--yunari-control-bg)] px-[var(--space-8)] py-[var(--space-4)] text-xs text-muted hover:border-muted"
                  >
                    {words.removeWord}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-faint">{words.optionalHint}</p>
      </div>

      <div className="flex items-center gap-[var(--space-8)]">
        <button
          type="button"
          data-yunari-collection-publish=""
          disabled={collection.inFlight}
          onClick={publish}
          className="rounded-[var(--radius-md)] border border-edge bg-[var(--yunari-control-bg)] px-[var(--space-12)] py-[var(--space-6)] text-sm text-text enabled:hover:border-muted disabled:text-faint"
        >
          {collection.inFlight ? words.publishing : words.publish}
        </button>
        {/* **The answer is the host's own sentence**, or the reader's for a
            draft refused before the host was asked. One live region for every
            refusal, so a screen reader hears the one that happened. */}
        <p
          data-yunari-collection-refusal=""
          role="status"
          aria-live="polite"
          className="min-w-0 flex-1 truncate text-xs text-warn"
        >
          {refusal}
        </p>
      </div>
    </section>
  );
}

/**
 * My submissions: the author's own rows, whatever their kind, beside the
 * collection builder.
 *
 * **The builder offers published listings only**, because the catalogue's index
 * is the published set, and it refuses a candidate only for what this surface
 * can see: a row with no catalogue id, or one already in the draft. Publication
 * and one-level-depth belong to the store and are checked there.
 *
 * **An unchanged republish still bumps `minor`**: the author's own listing
 * carries include ids but not the stored package, so a truthful no-change diff
 * would need that package. A second press of the same draft therefore publishes a
 * new version rather than being refused as unchanged.
 *
 * A failed read is stated and can be asked again; it is never drawn as "nothing
 * submitted", which the author's other surfaces would disprove.
 */
export function SubmissionsPage(props: {
  readonly fetch?: typeof fetch;
}): React.JSX.Element {
  const fetcher = props.fetch;
  const [mine, setMine] = useState<Read<readonly StoreItem[]>>({
    state: "loading",
  });
  const [listings, setListings] = useState<Read<readonly StoreItem[]>>({
    state: "loading",
  });
  /** Two reads, two attempts: a publish refreshes the author's rows only, so the
   *  builder stays mounted and its confirmation is not replaced by a re-read. */
  const [mineAttempt, setMineAttempt] = useState(0);
  const [listingsAttempt, setListingsAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setMine({ state: "loading" });
    const options = fetcher === undefined ? {} : { fetch: fetcher };
    void mineThemeSource({ kinds: STORE_ITEM_KINDS, ...options })
      .list()
      .then(
        (rows) => {
          if (live) setMine({ state: "read", rows });
        },
        () => {
          if (live) setMine({ state: "failed" });
        },
      );
    return () => {
      live = false;
    };
  }, [fetcher, mineAttempt]);

  useEffect(() => {
    let live = true;
    setListings({ state: "loading" });
    const options = fetcher === undefined ? {} : { fetch: fetcher };
    void readCatalogueListing(options, STORE_ITEM_KINDS).then(
      (parsed) => {
        if (!live) return;
        setListings({
          state: "read",
          rows: parsed.entries
            // A collection is one level deep, so it can never be an include.
            .filter((entry) => entry.kind !== "collection")
            .map(catalogueItemOf),
        });
      },
      () => {
        if (live) setListings({ state: "failed" });
      },
    );
    return () => {
      live = false;
    };
  }, [fetcher, listingsAttempt]);

  const retry = (): void => {
    setMineAttempt((current) => current + 1);
    setListingsAttempt((current) => current + 1);
  };

  return (
    <div
      data-yunari-submissions-page=""
      className="flex min-h-0 flex-1 flex-col gap-[var(--space-16)] overflow-y-auto p-[var(--space-16)]"
    >
      <section className="flex flex-col gap-[var(--space-8)]">
        <h2 className="text-sm font-medium text-text">
          {uiCopy.library.submissions.heading}
        </h2>
        {mine.state === "failed" ? (
          <Failure
            message={uiCopy.library.submissionsUnreadable}
            onRetry={retry}
          />
        ) : mine.state === "loading" ? (
          <p className="text-xs text-faint">
            {uiCopy.library.submissions.loading}
          </p>
        ) : mine.rows.length === 0 ? (
          <Empty lead={uiCopy.library.submissions.empty} hint={undefined} />
        ) : (
          <ul
            aria-label={uiCopy.library.submissions.heading}
            className="flex flex-col gap-[var(--space-4)]"
          >
            {mine.rows.map((item) => (
              <li
                key={item.id}
                data-yunari-submission={item.id}
                className="flex items-center gap-[var(--space-8)] rounded-[var(--radius-md)] border border-edge bg-panel-2 px-[var(--space-12)] py-[var(--space-6)]"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-text">
                  {item.name}
                </span>
                <span className="flex-none text-2xs text-muted">
                  {uiCopy.library.submissions.kind(item.kind)}
                </span>
                <StoreStatusBadge status={item.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {listings.state === "failed" ? (
        <Failure message={uiCopy.store.unreadable.online} onRetry={retry} />
      ) : listings.state === "loading" ? null : (
        <CollectionBuilder
          listings={listings.rows}
          onSubmitted={() => setMineAttempt((current) => current + 1)}
          {...(fetcher === undefined ? {} : { fetch: fetcher })}
        />
      )}
    </div>
  );
}
