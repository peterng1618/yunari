import type {
  CatalogueOrigin,
  CatalogueRefusal,
  MemberKind,
} from "@yunari/renderer-core";
import type * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { HeldUpdateNotice } from "../components/held-update-notice.js";
import { BareSegmented } from "../components/ui/bare-segmented.js";
import { AssignChoice, AssignDisplay } from "../store-mode/assign-display.js";
import { removalPath } from "../store-mode/cell-actions.js";
import { readCollectionPlan } from "../store-mode/collection-plan.js";
import { Gallery } from "../store-mode/gallery.js";
import { ItemModal } from "../store-mode/item-modal.js";
import {
  type CellAction,
  type FacetSelection,
  matchesFacets,
  matchesQuery,
  type StoreItem,
  settledTags,
} from "../store-mode/local-source.js";
import { useInstall } from "../store-mode/use-install.js";
import type { ThemeLibraryClient } from "../theme-library-client.js";
import { uiCopy } from "../ui-copy.js";
import type { StoreCard } from "./cards.js";
import { toggleFacet } from "./facet-row.js";
import { listingFacets } from "./facets.js";
import { Empty, Failure } from "./feedback.js";
import { ListingToolbar, useGridDensity } from "./listing-toolbar.js";
import { readOrigins } from "./origins.js";
import { type Row, rowsFor } from "./rows.js";
import { SORT_ORDERS } from "./sort-orders.js";
import {
  type CollectionsRead,
  catalogueSourceFor,
  type ExtensionRow,
  type LibraryClients,
  type LibraryPage,
  type LibraryState,
  librarySourceFor,
  type OriginsRead,
} from "./sources.js";
import { DeleteThemeDialog, useThemeActions } from "./theme-actions.js";
import { usePageSubmit } from "./use-page-submit.js";
import {
  pruneLibraryFacets,
  readLibraryFacets,
  readLibrarySort,
  rememberLibraryFacets,
  rememberLibrarySort,
} from "./view-preferences.js";

/** The pages whose cards can be code, so their detail's trust block reads the
 *  installed extension listing. A page not named here draws no code kind. */
const CODE_PAGES: ReadonlySet<LibraryPage> = new Set([
  "sensor-providers",
  "asset-sources",
  "panel-drivers",
]);

/** The Sensor providers page's two member-kind words. The kinds themselves are
 *  `PAGE_RULES["sensor-providers"].memberKinds`, read through the source. */
const SENSOR_NAMES: Readonly<Partial<Record<MemberKind, string>>> = {
  "sensor-provider": uiCopy.library.sensors.sensors,
  "data-source": uiCopy.library.sensors.dataSources,
};

/** How many rows the grid draws before the sentinel asks for another batch.
 *  `DESIGN.md` states the grid loads near the end, and the catalogue can be
 *  large; the scroller stays responsive without mounting everything at once. */
const LOAD_BATCH = 24;

/** One per-type page: the listing toolbar, the joined rows, and an item's own
 *  surface. The Dashboard themes page draws its four library actions here. */
export function PageListing(props: {
  readonly page: LibraryPage;
  readonly state: LibraryState;
  readonly client: ThemeLibraryClient;
  readonly clients: LibraryClients;
  readonly onStatus?: ((count: number | undefined) => void) | undefined;
  readonly onOpenTheme?: ((id: string) => void) | undefined;
  readonly onThemeRemoved?: ((id: string) => void) | undefined;
  /** Tells the session a submission landed, so the open document's base is
   *  advanced past the version the host published. */
  readonly onThemePublished?: ((id: string) => void) | undefined;
  readonly onOpenSettings?: ((page: "extensions") => void) | undefined;
  readonly collections: CollectionsRead;
  readonly detailOrigins: OriginsRead;
  readonly onDetailOpen: () => void;
}): React.JSX.Element {
  const density = useGridDensity();
  const [sort, setSort] = useState<string>(readLibrarySort);
  const [chosen, setChosen] = useState<FacetSelection>(readLibraryFacets);
  const sources = useMemo(
    () => ({
      catalogue: catalogueSourceFor(props.page),
      library: librarySourceFor(props.page, props.clients),
    }),
    [props.page, props.clients],
  );
  /** The Sensor providers sub-filter, built from the page rule's own member
   *  kinds: the options and the filter read one list, so a second spelling
   *  here cannot drift from what the page browses. */
  const sensorKinds = sources.catalogue.memberKinds;
  const [sensorKind, setSensorKind] = useState<MemberKind>(
    () => sensorKinds[0] ?? "sensor-provider",
  );
  const [query, setQuery] = useState("");
  /** The stored facet choice is pruned once, after the listing answers: a
   *  prune over the first render's empty rows would erase it. */
  const pruned = useRef(false);
  const [catalogue, setCatalogue] = useState<readonly StoreItem[] | undefined>(
    undefined,
  );
  const [library, setLibrary] = useState<readonly StoreItem[] | undefined>(
    undefined,
  );
  const [refused, setRefused] = useState<readonly CatalogueRefusal[]>([]);
  const [catalogueFailed, setCatalogueFailed] = useState(false);
  const [libraryFailed, setLibraryFailed] = useState(false);
  const [origins, setOrigins] = useState<
    readonly CatalogueOrigin[] | undefined
  >(undefined);
  const [originsFailed, setOriginsFailed] = useState(false);
  const [extensions, setExtensions] = useState<
    readonly ExtensionRow[] | undefined
  >(undefined);
  const [extensionsFailed, setExtensionsFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const readsOrigins = sources.catalogue.memberKind === "collection";
  const readsExtensions = CODE_PAGES.has(props.page);
  const [openCard, setOpenCard] = useState<StoreCard | undefined>(undefined);
  /** Whether the card that just opened asks for the collection sheet directly:
   *  a collection card's Install press is a request for the sheet, never an
   *  install with the card's own (missing) choices. */
  const [openSheetInitially, setOpenSheetInitially] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [assignId, setAssignId] = useState<string | undefined>(undefined);
  const actions = useThemeActions({
    client: props.client,
    onDeleted: (id) => {
      setCatalogue((current) =>
        current === undefined
          ? current
          : current.filter((item) => item.id !== id),
      );
      setLibrary((current) =>
        current === undefined
          ? current
          : current.filter((item) => item.id !== id),
      );
      setOpenCard((current) =>
        current?.listing.id === id ? undefined : current,
      );
      setAssignId((current) => (current === id ? undefined : current));
    },
    ...(props.onThemeRemoved === undefined
      ? {}
      : { onRemoved: props.onThemeRemoved }),
  });

  useEffect(() => {
    setExpanded(new Set());
    setOpenCard(undefined);
    setOpenSheetInitially(false);
    setNotice(undefined);
    setAssignId(undefined);
    setQuery("");
    setSensorKind(sensorKinds[0] ?? "sensor-provider");
    pruned.current = false;
  }, [props.page, sensorKinds]);

  useEffect(() => {
    let live = true;
    setCatalogue(undefined);
    setLibrary(undefined);
    setRefused([]);
    setCatalogueFailed(false);
    setLibraryFailed(false);
    setOrigins(undefined);
    setOriginsFailed(false);
    setExtensions(undefined);
    setExtensionsFailed(false);
    sources.catalogue.list().then(
      (read) => {
        if (!live) return;
        setCatalogue(read.rows);
        setRefused(read.refused);
      },
      () => {
        if (live) setCatalogueFailed(true);
      },
    );
    sources.library.list().then(
      (read) => {
        if (live) setLibrary(read.rows);
      },
      () => {
        if (live) setLibraryFailed(true);
      },
    );
    if (readsOrigins) {
      readOrigins().then(
        (rows) => {
          if (live) setOrigins(rows);
        },
        () => {
          if (live) setOriginsFailed(true);
        },
      );
    }
    if (readsExtensions) {
      props.clients.extensions().then(
        (rows) => {
          if (live) setExtensions(rows);
        },
        () => {
          if (live) setExtensionsFailed(true);
        },
      );
    }
    return () => {
      live = false;
    };
  }, [sources, attempt, readsOrigins, readsExtensions, props.clients]);

  const rows = useMemo(
    () => rowsFor(catalogue ?? [], library ?? [], props.state, origins),
    [catalogue, library, props.state, origins],
  );
  const visible = useMemo(
    () =>
      props.page === "sensor-providers"
        ? rows.filter((row) =>
            row.item.members.some((member) => member.kind === sensorKind),
          )
        : rows,
    [rows, props.page, sensorKind],
  );
  const items = useMemo(() => visible.map((row) => row.item), [visible]);
  const facets = useMemo(() => listingFacets(items), [items]);
  /** **A prune waits for the listing.** The restored choice is the person's, and
   *  the first render holds no rows yet; pruning then would erase it. The
   *  one-shot flag keeps a later prune of the same listing from eating a facet
   *  they just chose. */
  const listingsSettled =
    (catalogue !== undefined || catalogueFailed) &&
    (library !== undefined || libraryFailed);
  useEffect(() => {
    if (pruned.current || !listingsSettled) return;
    pruned.current = true;
    const next = pruneLibraryFacets(chosen, facets);
    if (next !== chosen) {
      setChosen(next);
      rememberLibraryFacets(next);
    }
  }, [chosen, facets, listingsSettled]);
  const matched = useMemo(
    () =>
      items.filter(
        (item) => matchesQuery(item, query) && matchesFacets(item, chosen),
      ),
    [items, chosen, query],
  );
  const shown = useMemo(
    () => [...matched].sort(SORT_ORDERS[sort] ?? (() => 0)),
    [matched, sort],
  );
  const answered = catalogue !== undefined || library !== undefined;
  /** The grid draws one batch and the sentinel asks for the next, as the store
   *  region did: the catalogue can be large and the scroller stays responsive. */
  const [shownCount, setShownCount] = useState(LOAD_BATCH);
  const paged = shown.slice(0, shownCount);
  const more = shown.length > paged.length;
  useEffect(() => {
    setShownCount(LOAD_BATCH);
  }, [props.page, props.state, sort, chosen, query]);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!more) return undefined;
    const node = sentinel.current;
    if (node === null || typeof IntersectionObserver === "undefined") {
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShownCount((current) =>
            Math.min(shown.length, current + LOAD_BATCH),
          );
        }
      },
      { rootMargin: "0px 0px 50% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [more, shown.length]);

  // The strip is the shell's; this region owns the count. **A count is
  // published only when both halves answered**: a failed read is not an empty
  // result, so neither "0" nor the surviving half's length stands for it.
  const onStatus = props.onStatus;
  const complete =
    catalogue !== undefined &&
    library !== undefined &&
    !catalogueFailed &&
    !libraryFailed;
  const count = complete ? shown.length : undefined;
  useEffect(() => {
    onStatus?.(count);
    return () => onStatus?.(undefined);
  }, [onStatus, count]);

  /** Resolves the open card's listing against the rows a refresh joined, so the
   *  modal's foot reads the state the listing now reports rather than the
   *  snapshot it opened with. */
  const refreshOpenCard = (joined: readonly Row[]): void => {
    setOpenCard((current) => {
      if (current === undefined) return current;
      const row = joined.find(
        (candidate) => candidate.item.id === current.listing.id,
      );
      return row === undefined ? current : { ...current, listing: row.item };
    });
  };

  /**
   * Re-reads what a write changed: both halves, the register and the extension
   * listing, then the open card from their join.
   *
   * **The join is built from the halves this read answered**, never from one
   * fresh half beside a stale one: `installedId` and a collection's count come
   * from the pair. A refusal the re-list answered is set with its rows, so a
   * cleared list cannot let a refused entry read as absent.
   */
  const relist = async (): Promise<void> => {
    let nextCatalogue = catalogue;
    let nextLibrary = library;
    let nextOrigins = origins;
    try {
      const read = await sources.catalogue.list();
      nextCatalogue = read.rows;
      setCatalogue(read.rows);
      setRefused(read.refused);
    } catch {
      setCatalogueFailed(true);
    }
    try {
      const read = await sources.library.list();
      nextLibrary = read.rows;
      setLibrary(read.rows);
    } catch {
      setLibraryFailed(true);
    }
    if (readsOrigins) {
      try {
        nextOrigins = await readOrigins();
        setOrigins(nextOrigins);
      } catch {
        setOriginsFailed(true);
      }
    }
    if (readsExtensions) {
      props.clients.extensions().then(
        (rows) => setExtensions(rows),
        () => setExtensionsFailed(true),
      );
    }
    refreshOpenCard(
      rowsFor(nextCatalogue ?? [], nextLibrary ?? [], "all", nextOrigins),
    );
  };

  const installSource = useMemo(
    () => ({
      kind: sources.catalogue.memberKind,
      list: async () => (await sources.catalogue.list()).rows,
    }),
    [sources],
  );
  const install = useInstall({
    source: installSource,
    onListed: () => {
      void relist();
    },
  });
  const submit = usePageSubmit({
    client: props.client,
    // A landed submission re-reads both halves, so the card draws the version
    // the host just wrote rather than the one this page read at mount; the
    // modal's foot is refreshed from the same join (`relist`).
    onSubmitted: () => {
      void relist();
    },
    onPublished: props.onThemePublished,
  });

  const openCardAt = (card: StoreCard): void => {
    props.onDetailOpen();
    setOpenSheetInitially(false);
    setOpenCard(card);
  };

  /** A collection card's Install or Update: the sheet owns the chosen set and
   *  the members' consent, so the card only asks for it. */
  const openSheetAt = (card: StoreCard): void => {
    props.onDetailOpen();
    setOpenSheetInitially(true);
    setOpenCard(card);
  };

  /** Removes one installed copy through the route its kind owns. The re-list
   *  that follows is the listing's fact: the row disappears because the host no
   *  longer lists it, not because this surface hid it. */
  const remove = async (path: string): Promise<void> => {
    try {
      const response = await fetch(path, { method: "DELETE" });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => undefined);
        const message =
          typeof body === "object" && body !== null
            ? (body as { readonly message?: unknown }).message
            : undefined;
        setNotice(
          typeof message === "string" && message.trim() !== ""
            ? message
            : uiCopy.store.removeRefused(response.status),
        );
        return;
      }
      setNotice(undefined);
      await relist();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  /**
   * The one callback a cell's actions and the modal's foot share.
   *
   * **R27: every live control runs through its route.** A command this build
   * cannot run is drawn disabled with its reason (`actionDisabledReason`), so no
   * press reaches this callback for a sentence instead of an action. A theme's
   * four commands act on the library copy the join named (`installedId`), a
   * removal on the route `removalPath` owns, and a collection's Remove opens the
   * sheet that names each member's own removal.
   */
  const onAction = (action: CellAction, card: StoreCard): void => {
    const item = card.listing;
    const kind = card.member?.kind ?? item.kind;
    const id = item.installedId ?? item.id;
    if (kind === "collection" && action === "remove") {
      openSheetAt({ ...card });
      return;
    }
    if (kind === "dashboard-theme") {
      if (action === "open" && props.onOpenTheme !== undefined) {
        props.onOpenTheme(id);
        return;
      }
      if (action === "delete") {
        if (props.client.remove === undefined) {
          setNotice(uiCopy.store.deleteUnavailable);
          return;
        }
        actions.requestDelete(id);
        return;
      }
      if (action === "export") {
        actions.exportTheme(id);
        return;
      }
      if (action === "assign") {
        setAssignId(id);
        return;
      }
    }
    if (action === "remove") {
      const path = removalPath(kind, id);
      if (path !== undefined) void remove(path);
    }
  };

  const assignItem =
    assignId === undefined
      ? undefined
      : [...(catalogue ?? []), ...(library ?? [])].find(
          (item) => item.id === assignId,
        );
  /** The parent an open remix credits, resolved from the two halves this page
   *  already holds: an entry the index carries is a link to its card, and an
   *  absent one stays the name as text. */
  const remixParent =
    openCard?.listing.remixOf === undefined
      ? undefined
      : [...(catalogue ?? []), ...(library ?? [])].find(
          (item) => item.id === openCard?.listing.remixOf?.catalogueId,
        );
  const inlineAssign =
    openCard !== undefined && assignId === openCard.listing.id;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {props.page === "sensor-providers" ? (
        <div className="flex flex-none items-center px-[var(--space-16)] pt-[var(--space-12)]">
          <BareSegmented
            id="yunari-library-sensors"
            data={{ "data-yunari-library-sensors": "" }}
            label={uiCopy.library.sensors.label}
            value={sensorKind}
            options={sensorKinds.map((kind) => ({
              id: kind,
              name: SENSOR_NAMES[kind] ?? kind,
            }))}
            onChange={(kind) => {
              if (sensorKinds.some((option) => option === kind)) {
                setSensorKind(kind as MemberKind);
              }
            }}
          />
        </div>
      ) : null}

      <ListingToolbar
        query={query}
        onQuery={setQuery}
        facets={facets}
        chosen={chosen}
        onToggle={(facetId, optionId) => {
          const next = toggleFacet(chosen, facetId, optionId);
          setChosen(next);
          rememberLibraryFacets(next);
        }}
        sort={sort}
        onSort={(id) => {
          setSort(id);
          rememberLibrarySort(id);
        }}
        densityLevel={density.level}
        onDensity={density.set}
      />

      <div
        data-yunari-library-listing=""
        className="flex min-h-0 flex-1 flex-col gap-[var(--space-8)] p-[var(--space-16)]"
      >
        {catalogueFailed ? (
          <Failure
            message={uiCopy.store.unreadable.online}
            onRetry={() => setAttempt((current) => current + 1)}
          />
        ) : null}
        {libraryFailed ? (
          <Failure
            message={uiCopy.store.unreadable.local}
            onRetry={() => setAttempt((current) => current + 1)}
          />
        ) : null}
        {originsFailed ? (
          <Failure
            message={uiCopy.store.unreadable.origins}
            onRetry={() => setAttempt((current) => current + 1)}
          />
        ) : null}
        {extensionsFailed ? (
          <Failure
            message={uiCopy.store.detail.trust.unreadable}
            onRetry={() => setAttempt((current) => current + 1)}
          />
        ) : null}
        {/* **A held update is never a silent no-op.** The host read the
            package, refused to write it, and named the growth that held it;
            the notice says which listing, what grew and what the approval
            press grants. It sits beside the listing it did not change, as the
            retired store region drew it. */}
        {install.control.held === undefined ? null : (
          <div className="flex-none">
            <HeldUpdateNotice
              held={install.control.held.held}
              heading={uiCopy.store.install.reviewHeading}
              reasonsLabel={uiCopy.store.install.reviewReasons}
              approveLabel={uiCopy.store.install.reviewApprove}
              dismissLabel={uiCopy.store.install.reviewDismiss}
              onApprove={install.control.onApproveUpdate}
              onDismiss={install.control.onDismissUpdate}
            />
          </div>
        )}
        {notice === undefined ? null : (
          <p
            data-yunari-library-action-notice=""
            role="status"
            className="text-xs text-warn"
          >
            {notice}
          </p>
        )}
        {actions.deleteRefusal === undefined ? null : (
          <p
            data-yunari-library-delete-refusal=""
            className="text-xs text-warn"
          >
            {actions.deleteRefusal}
          </p>
        )}
        {actions.exportRefusal === undefined ? null : (
          <p
            data-yunari-library-export-refusal=""
            className="text-xs text-warn"
          >
            {actions.exportRefusal}
          </p>
        )}
        {paged.length > 0 ? (
          <Gallery
            items={paged}
            density={density.level}
            origins={origins}
            expanded={expanded}
            onExpand={(key) =>
              setExpanded((current) => {
                const next = new Set(current);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })
            }
            onAction={onAction}
            onOpenItem={openCardAt}
            onOpenSheet={openSheetAt}
            install={install.control}
            submit={submit.control}
          />
        ) : answered && !catalogueFailed && !libraryFailed ? (
          <div data-yunari-library-empty="">
            <Empty
              lead={uiCopy.library.empty}
              hint={uiCopy.library.emptyHint}
            />
          </div>
        ) : null}
        {/* **The sentinel asks for the next batch near the end.** It is drawn
            only while rows remain, so a page that has drawn its whole listing
            unmounts the observer rather than observing nothing. */}
        {more ? (
          <div
            ref={sentinel}
            data-yunari-library-sentinel=""
            aria-hidden="true"
            className="h-px flex-none"
          />
        ) : null}
        {refused.length > 0 ? (
          <ul
            data-yunari-library-refusals=""
            className="flex flex-col gap-[var(--space-4)] text-xs text-faint"
          >
            {refused.map((refusal) => (
              <li
                key={`${refusal.reason}:${refusal.kind ?? ""}`}
                data-yunari-library-refusal=""
              >
                {uiCopy.store.catalogueRefused(refusal.kind, refusal.count)}
              </li>
            ))}
          </ul>
        ) : null}
        {openCard === undefined ? null : (
          <ItemModal
            item={openCard.listing}
            card={openCard}
            {...(openCard.member === undefined
              ? {}
              : { member: openCard.member })}
            collections={props.collections.entries ?? []}
            collectionsLoading={props.collections.loading}
            {...(props.collections.failed
              ? {
                  collectionsFailure: {
                    message: uiCopy.store.detail.partOfFailed,
                    onRetry: props.collections.retry,
                  },
                }
              : {})}
            {...(extensions === undefined ? {} : { extensions })}
            {...(extensionsFailed
              ? {
                  extensionsFailure: {
                    onRetry: () => setAttempt((current) => current + 1),
                  },
                }
              : {})}
            {...(origins === undefined
              ? props.detailOrigins.entries === undefined
                ? {}
                : { origins: props.detailOrigins.entries }
              : { origins })}
            originsLoading={
              origins === undefined && props.detailOrigins.loading
            }
            {...(origins === undefined && props.detailOrigins.failed
              ? {
                  originsFailure: {
                    message: uiCopy.store.unreadable.origins,
                    onRetry: props.detailOrigins.retry,
                  },
                }
              : {})}
            readPlan={readCollectionPlan}
            vocabulary={settledTags(
              [...(catalogue ?? []), ...(library ?? [])],
              openCard.listing,
            )}
            onClose={() => {
              setOpenCard(undefined);
              setAssignId(undefined);
            }}
            onAction={onAction}
            actionNotice={notice}
            install={install.control}
            submit={submit.control}
            openSheetInitially={openSheetInitially}
            onOpenItem={openCardAt}
            onOpenCollection={openCardAt}
            {...(remixParent === undefined ? {} : { remixParent })}
            {...(props.onOpenSettings === undefined
              ? {}
              : { onOpenSettings: props.onOpenSettings })}
            {...(inlineAssign
              ? {
                  assign: (
                    <AssignChoice
                      themeId={openCard.listing.id}
                      client={props.client}
                      onAssigned={() => undefined}
                    />
                  ),
                }
              : {})}
          />
        )}
      </div>

      {assignItem === undefined || inlineAssign ? null : (
        <AssignDisplay
          themeId={assignItem.id}
          client={props.client}
          pairNew={{
            url: () =>
              props.client.pairingUrl?.() ?? Promise.resolve(undefined),
            unavailable: uiCopy.publish.pairUnavailable,
          }}
          onClose={() => setAssignId(undefined)}
        />
      )}

      <DeleteThemeDialog
        open={actions.confirmDeleteId !== undefined}
        onCancel={actions.cancelDelete}
        onConfirm={actions.confirmDelete}
      />

      <span
        data-yunari-library-install-announcement=""
        role="status"
        aria-live="polite"
        className="sr-only"
      >
        {actions.deleteRefusal ||
          actions.exportRefusal ||
          install.announcement ||
          submit.announcement}
      </span>
    </div>
  );
}
