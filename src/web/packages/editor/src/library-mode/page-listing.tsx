import type { CatalogueOrigin, CatalogueRefusal } from "@yunari/renderer-core";
import type * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { confirmOutputBake } from "../components/output-bake-dialog.js";
import { BareSegmented } from "../components/ui/bare-segmented.js";
import { bakeStoredThemeCrops } from "../crop-manager/bake-stored.js";
import { AssignChoice, AssignDisplay } from "../store-mode/assign-display.js";
import { readCollectionPlan } from "../store-mode/collection-plan.js";
import { Gallery } from "../store-mode/gallery.js";
import { withInstalledVersions } from "../store-mode/install-state.js";
import { actionLabel } from "../store-mode/item-foot.js";
import { ItemModal } from "../store-mode/item-modal.js";
import {
  type CellAction,
  type FacetSelection,
  matchesFacets,
  type StoreItem,
  settledTags,
} from "../store-mode/local-source.js";
import { useInstall } from "../store-mode/use-install.js";
import { useSubmit } from "../store-mode/use-submit.js";
import type {
  ThemeLibraryClient,
  ThemeLibraryContent,
} from "../theme-library-client.js";
import { uiCopy } from "../ui-copy.js";
import { collectionStateOf, type StoreCard } from "./cards.js";
import { toggleFacet } from "./facet-row.js";
import { listingFacets } from "./facets.js";
import { Empty, Failure } from "./feedback.js";
import { ListingToolbar, useGridDensity } from "./listing-toolbar.js";
import { readOrigins } from "./origins.js";
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

/** The Sensor providers page's two member kinds, in its sub-filter's order. */
const SENSOR_KINDS = ["sensor-provider", "data-source"] as const;

type SensorKind = (typeof SENSOR_KINDS)[number];

const SENSOR_NAMES: Record<SensorKind, string> = {
  "sensor-provider": uiCopy.library.sensors.sensors,
  "data-source": uiCopy.library.sensors.dataSources,
};

/** One row, tagged with the half it was read from. The tag is what keeps a
 *  library row in "On this PC" whatever its origin says. */
interface Row {
  readonly item: StoreItem;
  readonly half: "store" | "library";
}

/**
 * The two halves joined, then filtered by the state.
 *
 * **A library row that names a catalogue item is that item's installed copy**,
 * so the library half drops it when the catalogue listing actually carries that
 * item; the catalogue row takes the origin the library row carried. A library
 * row whose catalogue id the listing does not carry — an unpublished entry, a
 * page that stopped browsing that kind, or a catalogue half that failed — stays
 * its own row, or the installed copy would vanish with nothing left to remove.
 *
 * The rule is one function because the filter and the grid must not disagree
 * about which rows the state admits.
 *
 * **A collection's installed state is its includes'**, so the filter reads
 * `collectionStateOf` rather than the row's own origin, which a collection
 * never has. A partially installed collection is *On this PC*: it has copies on
 * this PC and reads its count with Update. Only a collection with no include
 * installed is *Not installed*.
 */
function rowsFor(
  catalogue: readonly StoreItem[],
  library: readonly StoreItem[],
  state: LibraryState,
  origins: readonly CatalogueOrigin[] | undefined,
): readonly Row[] {
  const byCatalogueId = new Map<string, CatalogueOrigin>();
  for (const item of library) {
    if (item.origin !== undefined) {
      byCatalogueId.set(item.origin.catalogueId, item.origin);
    }
  }
  const store = withInstalledVersions(catalogue, library).map((item) => {
    const origin = byCatalogueId.get(item.id);
    return origin === undefined ? item : { ...item, origin };
  });
  const listed = new Set(store.map((item) => item.id));
  const libraryOnly = library.filter(
    (item) => item.origin === undefined || !listed.has(item.origin.catalogueId),
  );
  const rows: readonly Row[] = [
    ...store.map((item): Row => ({ item, half: "store" })),
    ...libraryOnly.map((item): Row => ({ item, half: "library" })),
  ];

  if (state === "all") return rows;

  const collectionOf = (row: Row) =>
    origins === undefined ? undefined : collectionStateOf(row.item, origins);

  if (state === "on-this-pc") {
    return rows.filter((row) => {
      if (row.half === "library" || row.item.origin !== undefined) return true;
      const collection = collectionOf(row);
      return collection !== undefined && collection.state !== "absent";
    });
  }
  return rows.filter((row) => {
    const collection = collectionOf(row);
    if (collection !== undefined) return collection.state === "absent";
    return row.half === "store" && row.item.origin === undefined;
  });
}

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
  const [sensorKind, setSensorKind] = useState<SensorKind>("sensor-provider");
  const sources = useMemo(
    () => ({
      catalogue: catalogueSourceFor(props.page),
      library: librarySourceFor(props.page, props.clients),
    }),
    [props.page, props.clients],
  );
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
    setNotice(undefined);
    setAssignId(undefined);
  }, [props.page]);

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
  const visible =
    props.page === "sensor-providers"
      ? rows.filter((row) =>
          row.item.members.some((member) => member.kind === sensorKind),
        )
      : rows;
  const items = useMemo(() => visible.map((row) => row.item), [visible]);
  const facets = useMemo(() => listingFacets(items), [items]);
  useEffect(() => {
    const pruned = pruneLibraryFacets(chosen, facets);
    if (pruned !== chosen) {
      setChosen(pruned);
      rememberLibraryFacets(pruned);
    }
  }, [chosen, facets]);
  const matched = useMemo(
    () => items.filter((item) => matchesFacets(item, chosen)),
    [items, chosen],
  );
  const shown = useMemo(
    () => [...matched].sort(SORT_ORDERS[sort] ?? (() => 0)),
    [matched, sort],
  );
  const answered = catalogue !== undefined || library !== undefined;

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

  const installSource = useMemo(
    () => ({
      kind: sources.catalogue.memberKind,
      list: async () => (await sources.catalogue.list()).rows,
    }),
    [sources],
  );
  const install = useInstall({
    source: installSource,
    onListed: (listed) => {
      setCatalogue(listed);
      // The install re-listed the catalogue itself, so the refusals the mount
      // read no longer describe what is drawn: they are cleared with the rows.
      setRefused([]);
      sources.library.list().then(
        (read) => setLibrary(read.rows),
        () => setLibraryFailed(true),
      );
      if (readsOrigins) {
        readOrigins().then(
          (rows) => setOrigins(rows),
          () => setOriginsFailed(true),
        );
      }
      if (readsExtensions) {
        props.clients.extensions().then(
          (rows) => setExtensions(rows),
          () => setExtensionsFailed(true),
        );
      }
    },
  });
  /** **A submission is this page's own flow.** The Library replaced the old
   *  store region, so the theme a person publishes is the stored copy the host
   *  holds: the crop pass writes the baked copy before the host reads it, and a
   *  landed press restores the author's un-baked library copy beside advancing
   *  the open document's base. */
  const publishedBackup = useRef<
    { readonly id: string; readonly content: ThemeLibraryContent } | undefined
  >(undefined);
  const submit = useSubmit({
    // A landed submission re-reads both halves, so the card draws the version
    // the host just wrote rather than the one this page read at mount. An open
    // item's surface is replaced from the same read: the modal keeps drawing
    // the item it opened, and that item's version is the listing's fact.
    onSubmitted: () => {
      const refreshOpenCard = (rows: readonly StoreItem[]): void => {
        setOpenCard((current) => {
          if (current === undefined) return current;
          const listed = rows.find((item) => item.id === current.listing.id);
          return listed === undefined
            ? current
            : { ...current, listing: listed };
        });
      };
      void sources.catalogue.list().then(
        (read) => {
          setCatalogue(read.rows);
          setRefused(read.refused);
          refreshOpenCard(read.rows);
        },
        () => setCatalogueFailed(true),
      );
      void sources.library.list().then(
        (read) => {
          setLibrary(read.rows);
          refreshOpenCard(read.rows);
        },
        () => setLibraryFailed(true),
      );
    },
    beforeSubmit: async (id) => {
      try {
        const content = await props.client.open(id);
        const baked = await bakeStoredThemeCrops({
          envelope: content.envelope,
          assets: content.assets,
        });
        if (baked.baked === 0) return undefined;
        if (
          !(await confirmOutputBake({
            title: uiCopy.store.submit.label,
            crops: baked.baked,
          }))
        ) {
          return uiCopy.store.submit.cancelled;
        }
        await props.client.save(id, {
          ...content,
          envelope: baked.envelope,
          assets: baked.assets,
        });
        publishedBackup.current = { id, content };
        return undefined;
      } catch {
        return uiCopy.store.submit.prepareFailed;
      }
    },
    afterSubmit: async (version) => {
      const backup = publishedBackup.current;
      publishedBackup.current = undefined;
      if (backup === undefined) return;
      const envelope =
        version === undefined
          ? backup.content.envelope
          : {
              ...backup.content.envelope,
              metadata: { ...backup.content.envelope.metadata, version },
            };
      try {
        // An overwrite, because the host advanced the base while it published
        // the baked copy; the bytes being restored are the author's own.
        await props.client.save(
          backup.id,
          { ...backup.content, envelope },
          { overwrite: true },
        );
      } catch {
        // The submission already happened. Retrying here would be a second
        // write the author did not ask for.
      }
      props.onThemePublished?.(backup.id);
    },
  });

  const openCardAt = (card: StoreCard): void => {
    props.onDetailOpen();
    setOpenCard(card);
  };

  /**
   * Whether this page and this row own one of the stored-theme commands.
   *
   * **Only Dashboard themes owns the four**, and only for a dashboard theme:
   * `open` needs the document's route, and Delete, Export and Assign act on the
   * host's `/api/themes` routes, which hold editor themes nowhere and drivers
   * never. A page that draws the gallery's shared action row for another kind
   * reports the press as pending rather than calling a route for the wrong
   * store.
   */
  const ownsThemeCommand = (card: StoreCard): boolean =>
    props.page === "dashboard-themes" &&
    card.listing.kind === "dashboard-theme";

  /**
   * The one callback a cell's actions and the modal's footer share.
   *
   * Every command this page does not own keeps the pending sentence, so a
   * control stays drawn (R164) and its press says what is not wired rather than
   * acting on the wrong kind. Assign from the item's own surface is drawn inline
   * and stays inside the page it was opened from; from a cell there is no page
   * to keep, so it opens as the dialog it is.
   */
  const onAction = (action: CellAction, card: StoreCard): void => {
    const id = card.listing.id;
    if (ownsThemeCommand(card)) {
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
    setNotice(
      uiCopy.library.actionPending(
        actionLabel(action, card.member?.kind ?? card.listing.kind),
      ),
    );
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
            options={SENSOR_KINDS.map((kind) => ({
              id: kind,
              name: SENSOR_NAMES[kind],
            }))}
            onChange={(kind) => setSensorKind(kind as SensorKind)}
          />
        </div>
      ) : null}

      <ListingToolbar
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
        {shown.length > 0 ? (
          <Gallery
            items={shown}
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
            install={install.control}
          />
        ) : answered && !catalogueFailed && !libraryFailed ? (
          <div data-yunari-library-empty="">
            <Empty
              lead={uiCopy.library.empty}
              hint={uiCopy.library.emptyHint}
            />
          </div>
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
        {actions.deleteRefusal || actions.exportRefusal || install.announcement}
      </span>
    </div>
  );
}
