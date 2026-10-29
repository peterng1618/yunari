import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import {
  type SemanticFamily,
  semanticKeysByFamily,
} from "@yunari/renderer-core";
import type * as React from "react";
import { useEffect, useState } from "react";
import { ControlSelect } from "../components/ui/control-select.js";
import {
  ControlWell,
  hitTargetClasses,
} from "../components/ui/control-well.js";
import {
  createPageSizePreference,
  type PageSize,
} from "../editor-shell/page-size.js";
import type { ShellMode } from "../editor-shell/shell-layout.js";
import {
  createThemeLibraryClient,
  type ThemeLibraryClient,
} from "../theme-library-client.js";
import { uiCopy } from "../ui-copy.js";
import { AssignDisplay } from "./assign-display.js";
import {
  type Facet,
  type FacetOption,
  FacetRow,
  toggleFacet,
} from "./facet-row.js";
import { Gallery } from "./gallery.js";
import { ItemModal } from "./item-modal.js";
import {
  type CellAction,
  type FacetSelection,
  localThemeSource,
  matchesFacets,
  matchesQuery,
  type StoreItem,
  settledTags,
} from "./local-source.js";
import { useMineListing } from "./mine-listing.js";
import { Pager } from "./pager.js";
import { DEFAULT_SORT, SORT_KEYS, SORT_ORDERS } from "./sort-orders.js";
import { useInstall } from "./use-install.js";
import { useSubmit } from "./use-submit.js";

/**
 * The store's two halves. `local` is the host's own library — what the author
 * already has — and `online` is the catalogue; Local is first for that reason.
 *
 * A half is **not** a shell mode and not a second bar: it is the region's own
 * control over what the region lists, the way a pane's title bar sits inside its
 * pane. The shell's navigation is the header, and §7.2 forbids a horizontal bar
 * under it — which is why the halves sit in the region's *first row* beside the
 * filter and the sort rather than in a strip of their own.
 */
export type StoreTab = "local" | "online";

/** The order the row draws them in, which is a separate decision from what each
 *  is called — the same split `MODE_ORDER` and `MODE_NAMES` make. */
const TAB_ORDER = ["local", "online"] as const satisfies readonly StoreTab[];

/** Each half's name, as a **total** lookup: a `StoreTab` added to the union
 *  without a label fails to compile here rather than rendering a segment with no
 *  name. */
const TAB_NAMES: Record<StoreTab, string> = {
  local: uiCopy.store.halves.local,
  online: uiCopy.store.halves.online,
};

/** The halves' group id, and the stem of each segment's — §5 rule 5 wants every
 *  control to carry an id, derived from the half the way `useControlIds` derives
 *  one from the control it names. */
const HALVES_ID = "yunari-store-halves";

const halvesSegmentId = (tab: StoreTab): string => `${HALVES_ID}-${tab}`;

/** The sort well's id, named rather than minted: the row has one sort and the
 *  browser case reaches for it by name. */
const SORT_ID = "yunari-store-sort";

/**
 * The browser's own storage, or nothing where the accessor itself refuses — a
 * private window throws on the read. It is `shell-layout.tsx`'s `readStorage`
 * answer, kept local because that file mounts this region: importing it would be
 * a cycle.
 */
function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * One facet's options, read off the items rather than invented here: each item
 * contributes the readings it carries, an option's count is how many items carry
 * it, and the value a person chooses is the reading itself — the author string,
 * the colour mode, the sensor's `key`, the ratio, the size.
 *
 * **Ordered by how much is behind each value, then by name**, so the biggest
 * group is where a person looks first and the order does not move while the
 * library does not. The order is derived from the whole listing and never from
 * the filtered one: an option that vanished as it was chosen could not be
 * unchosen.
 *
 * **A reading may name the group it belongs to**, and this keeps it: the
 * grouping is the caller's, because only the caller knows what the values are
 * grouped *by*. Runs of one group are the caller's to keep together — the sort
 * here is within what it is handed, and `sensorOptions` and `shapeOptions` each
 * call it once per group so the count order cannot interleave two headings.
 */
function optionsFrom(
  items: readonly StoreItem[],
  readings: (item: StoreItem) => readonly {
    readonly id: string;
    readonly name: string;
    readonly group?: string;
  }[],
): readonly FacetOption[] {
  const found = new Map<
    string,
    { name: string; count: number; group?: string }
  >();
  for (const item of items) {
    for (const reading of readings(item)) {
      const seen = found.get(reading.id);
      if (seen === undefined) {
        found.set(reading.id, {
          name: reading.name,
          count: 1,
          ...(reading.group === undefined ? {} : { group: reading.group }),
        });
      } else {
        seen.count += 1;
      }
    }
  }
  return [...found.entries()]
    .map(([id, { name, count, group }]) => ({
      id,
      name,
      count,
      ...(group === undefined ? {} : { group }),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** The two colour modes a person can ask for. `unclassified` is not one of them
 *  (R117, R122): a theme that carries it is reachable under "any" and under no
 *  other value, so a chip for it would be a selection that matches nothing. */
function colourModeOptions(
  items: readonly StoreItem[],
): readonly FacetOption[] {
  return optionsFrom(
    items.filter((item) => item.facets.colourMode !== "unclassified"),
    (item) => {
      const mode = item.facets.colourMode;
      return mode === "unclassified"
        ? []
        : [{ id: mode, name: uiCopy.store.colourModes[mode] }];
    },
  );
}

/** The sensors the items bind, labelled by the record's own `label` — the
 *  descriptor's word and not the `key` the selection carries — and **grouped by
 *  the family the vocabulary already files each key under**, which is the
 *  grouping the spec asks for rather than a second reading of the key here.
 *
 *  **One pass per family, so the count order cannot interleave two headings**,
 *  and the families come in the vocabulary's own order
 *  (`semanticKeysByFamily`) rather than in a list of their own that would have
 *  to be kept in step with it.
 *
 *  A key this build does not know carries no family, so it is offered under no
 *  heading and last: an invented heading would be a word for something nothing
 *  declared (§9). */
const familyWord = (family: string): string | undefined =>
  (uiCopy.store.facets.sensorFamilies as Readonly<Record<string, string>>)[
    family
  ];

function sensorOptions(items: readonly StoreItem[]): readonly FacetOption[] {
  const readingsOf =
    (family: SemanticFamily | undefined) =>
    (
      item: StoreItem,
    ): readonly {
      readonly id: string;
      readonly name: string;
      readonly group?: string;
    }[] =>
      item.facets.sensors
        .filter((sensor) => sensor.family === family)
        .map((sensor) => {
          // `family` is an open string now, so a provider-contributed family has
          // no word here yet; it is drawn under no heading rather than invented.
          const group = family === undefined ? undefined : familyWord(family);

          return {
            id: sensor.key,
            name: sensor.label,
            ...(group === undefined ? {} : { group }),
          };
        });

  return [
    ...[...semanticKeysByFamily().keys()].flatMap((family) =>
      optionsFrom(items, readingsOf(family)),
    ),
    ...optionsFrom(items, readingsOf(undefined)),
  ];
}

/** The three shape groups the drawing's Shape popover offers, in its own order:
 *  the orientation words, the aspect buckets, and the exact sizes — each run
 *  under the drawing's own heading, because the three are AND with each other
 *  (R115) and a flat list is what hides it. */
function shapeOptions(items: readonly StoreItem[]): readonly FacetOption[] {
  const headings = uiCopy.store.facets.shapeGroups;
  const orientations = optionsFrom(items, (item) => [
    {
      id: item.facets.orientation,
      name: uiCopy.store.orientations[item.facets.orientation],
      group: headings.orientation,
    },
  ]);
  const buckets = optionsFrom(items, (item) => [
    {
      id: item.facets.aspect,
      name:
        item.facets.aspect === "other"
          ? uiCopy.store.otherShape
          : item.facets.aspect,
      group: headings.aspect,
    },
  ]);
  return [...orientations, ...buckets, ...sizeOptions(items)];
}

/**
 * The style tags the items carry, **each offered however few themes carry it**:
 * a tag one theme declares is still a value, where a size one theme declares is
 * not — a theme nothing can filter to is the theme the facet exists to find.
 *
 * `optionsFrom` counts them in a `Map`, which is what makes a tag that names a
 * prototype member (`constructor` is well-formed) read as itself.
 */
function styleOptions(items: readonly StoreItem[]): readonly FacetOption[] {
  return optionsFrom(items, (item) =>
    item.facets.tags.map((tag) => ({ id: tag, name: tag })),
  );
}

/**
 * The sizes the facet offers: **those more than one theme declares**, largest
 * first. A size exactly one theme declares is a theme wearing a filter's
 * clothes, and every other size is reachable under `Other` (spec, "Finding a
 * theme: the five facets"); the exact size is on the item's own modal either
 * way, which is what makes that acceptable.
 */
function sizeOptions(items: readonly StoreItem[]): readonly FacetOption[] {
  const counts = new Map<
    string,
    { width: number; height: number; count: number }
  >();
  for (const item of items) {
    const { width, height } = item.facets;
    const id = `${width}x${height}`;
    const seen = counts.get(id);
    if (seen === undefined) counts.set(id, { width, height, count: 1 });
    else seen.count += 1;
  }
  return [...counts.entries()]
    .filter(([, size]) => size.count > 1)
    .map(([id, size]) => ({
      id,
      name: uiCopy.store.size(size.width, size.height),
      count: size.count,
      group: uiCopy.store.facets.shapeGroups.size,
      area: size.width * size.height,
      width: size.width,
    }))
    .sort((a, b) => b.area - a.area || b.width - a.width)
    .map(({ id, name, count, group }) => ({ id, name, count, group }));
}

/**
 * The five facets, in the row's order, with the values the items carry.
 *
 * **Style's values are the documents' own tags**, and its facet is drawn with
 * none where no theme declares one — which is what a library of untagged themes
 * looks like rather than a facet that cannot filter.
 */
function storeFacets(items: readonly StoreItem[]): readonly Facet[] {
  return [
    {
      id: "author",
      name: uiCopy.store.facets.author,
      options: optionsFrom(items, (item) =>
        item.author === undefined
          ? []
          : [{ id: item.author, name: item.author }],
      ),
    },
    {
      id: "colour-mode",
      name: uiCopy.store.facets.colourMode,
      options: colourModeOptions(items),
    },
    {
      id: "sensors",
      name: uiCopy.store.facets.sensors,
      options: sensorOptions(items),
    },
    {
      id: "shape",
      name: uiCopy.store.facets.shape,
      // The drawing's own sentence, above the three groups it explains: a theme
      // must match every group, which is what makes the headings worth drawing.
      hint: uiCopy.store.facets.shapeHint,
      options: shapeOptions(items),
    },
    {
      id: "style",
      name: uiCopy.store.facets.style,
      options: styleOptions(items),
    },
  ];
}

/** How many pages a listing of `count` items is at `size` — one page when the
 *  size is `all`, and **none when there is nothing to page**, so an empty result
 *  never claims a page one. */
function pageCount(count: number, size: PageSize): number {
  if (count === 0) return 0;
  return size === "all" ? 1 : Math.ceil(count / size);
}

/** The items one page holds. `size` is a whole number of items or everything. */
function pageItems(
  items: readonly StoreItem[],
  page: number,
  size: PageSize,
): readonly StoreItem[] {
  if (size === "all") return items;
  const from = (page - 1) * size;
  return items.slice(from, from + size);
}

/**
 * What the region's body draws: the items, one of the three empties, or nothing.
 *
 * **"Nothing" is a state and not an oversight.** A listing that has not arrived
 * yet draws nothing rather than the first-run sentence — a store that flashed
 * "No themes are saved on this PC yet" before its own list landed would be lying
 * for a frame. A read that failed stays in this state too, whichever half it
 * was: an empty array would claim the half is empty.
 *
 * **The empties are different sentences because they have different answers**
 * (R124): a library with nothing in it is not a filter that matched nothing, and
 * the first-run sentence would tell someone with forty themes to go and build
 * one — nor does an empty catalogue say the library is empty.
 */
type Body =
  | { readonly kind: "none" }
  | { readonly kind: "empty-library" }
  | { readonly kind: "empty-catalogue" }
  | { readonly kind: "empty-filter" }
  | { readonly kind: "items"; readonly items: readonly StoreItem[] };

/**
 * The two halves, as §5's `Segmented` in its **bare** form — the well holding
 * the labels, the chosen one lifted to `--stage` with `--text`, and no row label
 * beside it. The header's mode switch is the same
 * control in the same kind of strip, composed the same way for the same reason:
 * the region's header row is a bar rather than a field row, so there is no label
 * column to fill, and the set's one `ControlSegmented` is a labelled row.
 *
 * The group is its own name (§5 rule 5): a screen reader reaching two segments
 * is told what is being chosen, and each segment carries an id.
 */
function Halves(props: {
  readonly tab: StoreTab;
  readonly onTab: (tab: StoreTab) => void;
}): React.JSX.Element {
  return (
    <ToggleGroup
      id={HALVES_ID}
      data-yunari-store-halves=""
      aria-label={uiCopy.store.halves.label}
      value={[props.tab]}
      onValueChange={(next) => {
        const chosen = next[0];
        if (chosen !== undefined) props.onTab(chosen as StoreTab);
      }}
      className="flex flex-none gap-[var(--space-4)] rounded-md border border-edge bg-panel-2 p-[var(--space-4)]"
    >
      {TAB_ORDER.map((tab) => (
        <Toggle
          key={tab}
          id={halvesSegmentId(tab)}
          value={tab}
          className={`${hitTargetClasses} rounded-sm px-[var(--space-8)] py-[var(--space-4)] text-xs text-muted data-[pressed]:text-text data-[pressed]:[background:var(--stage)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent`}
        >
          {TAB_NAMES[tab]}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

/** One of the two empty sentences, as a centred pair of lines at §3's
 *  empty-state breathing room. */
function Empty(props: {
  readonly lead: string;
  readonly hint: string | undefined;
}): React.JSX.Element {
  return (
    <div
      data-yunari-store-empty=""
      className="flex flex-1 flex-col items-center justify-center gap-[var(--space-8)] px-[var(--space-32)] text-center"
    >
      <p className="text-sm text-muted">{props.lead}</p>
      {props.hint === undefined ? null : (
        <p className="text-xs text-faint">{props.hint}</p>
      )}
    </div>
  );
}

/**
 * The Themes mode's region — the surface the shell's `[data-yunari-mode-region]`
 * seam was left for.
 *
 * **It renders its own header row and nothing above it.** The shell's header
 * carries the mode switch and the mode's own actions; this row is the region's
 * first row, so §7.2's forbidden second bar does not appear between them. What
 * the row holds is the region's controls over what the region lists: which half,
 * a search, the five facets and a sort.
 *
 * **The mode is a prop rather than state read here.** A.8 mounts the Host mode's
 * own region in the same section, and one component reading the answer from the
 * shell's one owner is what the A.1 seam establishes — so this region draws
 * itself in Themes and in no other mode, rather than the shell deciding which
 * region to render.
 *
 * **`client` is for a test and for a surface that already has one.** The shell
 * mounts this with none, and the region builds the client the library API is
 * reached through — the same default `theme-library-dialog.tsx` takes.
 */
export function StoreModeRegion(props: {
  readonly mode: ShellMode;
  readonly client?: ThemeLibraryClient | undefined;
  /** Opens one of the library's themes as the editor's own document. The shell
   *  hands the session's route; a surface with none — a dom case, or a mode
   *  whose document is not this region's to replace — lists and reads items
   *  without one. */
  readonly onOpenTheme?: ((id: string) => void) | undefined;
}): React.JSX.Element | null {
  return props.mode === "themes" ? (
    <StoreRegion
      client={props.client}
      {...(props.onOpenTheme === undefined
        ? {}
        : { onOpenTheme: props.onOpenTheme })}
    />
  ) : null;
}

/** The region's own state, in its own component so a mode that is not Themes
 *  holds none of it: the half, the search, the sort and the facet selection are
 *  the surface's, and none of them is persisted — leaving the mode and coming
 *  back opens on the same row a fresh mount does. The **page size** is the one
 *  exception, because it is a view preference rather than a query (spec, "The
 *  gallery, and paging"). */
function StoreRegion(props: {
  readonly client?: ThemeLibraryClient | undefined;
  readonly onOpenTheme?: ((id: string) => void) | undefined;
}): React.JSX.Element {
  const [tab, setTab] = useState<StoreTab>("local");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Record<StoreTab, string>>({
    ...DEFAULT_SORT,
  });
  const [chosen, setChosen] = useState<FacetSelection>({});
  const [page, setPage] = useState(1);
  /** Which item's own surface is open, by id rather than by item: the listing is
   *  the one owner of what an item is, so a re-listing cannot leave the modal
   *  showing a copy of something that changed underneath it. */
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  /** Which item's display choice is open, by id for the same reason. */
  const [assignId, setAssignId] = useState<string | undefined>(undefined);
  /** The listing, or `undefined` until it arrives. Nothing draws the first-run
   *  sentence before then. */
  const [items, setItems] = useState<readonly StoreItem[] | undefined>(
    undefined,
  );

  // One client and one source for the life of the region: a client built per
  // render would be a new one every time, and the listing would reach a host the
  // session never talked to. The client is kept as well as the source, because
  // assigning a theme is the library's own operation rather than a second read
  // of the listing — a client built for that alone would be a second path to the
  // same host.
  const [client] = useState(() => props.client ?? createThemeLibraryClient());
  const [source] = useState(() => localThemeSource(client));
  /** The online half's install: the press, its in-flight set, and the sentence
   *  its last refusal announces (`use-install.ts`). */
  const install = useInstall({ source, onListed: setItems });
  /** The library half's submission press and its longer flow (`use-submit.ts`):
   *  the sign-in outlives the modal that started it, so its state lives beside
   *  the region rather than in the surface that pressed. */
  const submit = useSubmit({
    // **A landed submission re-reads the library** so the caption line shows
    // the version the host just wrote. A failed re-list changes nothing: the
    // submission is the fact, and this surface keeps no version of its own.
    onSubmitted: () => void source.list().then(setItems, () => undefined),
  });
  const [preference] = useState(() =>
    createPageSizePreference(browserStorage()),
  );
  const [size, setSize] = useState<PageSize>(() => preference.read());

  useEffect(() => {
    let live = true;
    source.list().then(
      (listed) => {
        if (live) setItems(listed);
      },
      () => {
        // **A failed listing is not a fact about the library**, so nothing is
        // drawn for it: `items` stays unset and the body stays empty rather than
        // claiming the library is empty. The reason has no surface here — the
        // shell's notices belong to the editor's error manager, which is reached
        // through a canvas this region does not have.
      },
    );
    return () => {
      live = false;
    };
  }, [source]);

  // The online half chooses its source: the catalogue, or the author's own rows.
  const online = useMineListing(items, {
    onEnabled: () => setTab("online"),
  });

  // **Each half reads its own listing**, and neither ever draws the other's:
  // the point of the halves is that the catalogue and this PC's library are two
  // different answers to "what themes are there".
  const listed = tab === "local" ? items : online.items;
  const matching = (listed ?? []).filter(
    (item) => matchesFacets(item, chosen) && matchesQuery(item, query),
  );
  // **The half's own key**, not the library's: the two halves share no key, so
  // the order read is the one the drawn half declared.
  const sorted = [...matching].sort(SORT_ORDERS[sort[tab]] ?? (() => 0));
  const total = pageCount(sorted.length, size);
  const current = Math.min(Math.max(page, 1), Math.max(total, 1));

  const body: Body =
    listed === undefined
      ? { kind: "none" }
      : listed.length === 0
        ? tab === "local"
          ? { kind: "empty-library" }
          : online.refused.length > 0
            ? // Everything the catalogue held was unreadable, so the refusal
              // line below is the sentence: "nothing yet" would contradict it.
              { kind: "none" }
            : { kind: "empty-catalogue" }
        : sorted.length === 0
          ? { kind: "empty-filter" }
          : { kind: "items", items: pageItems(sorted, current, size) };

  const openItem =
    openId === undefined
      ? undefined
      : listed?.find((item) => item.id === openId);
  // The credit's parent is resolved from the same listing the modal was opened
  // from, and only on the online half: the library is not the catalogue the
  // credit's id names, so a library item's credit stays text.
  const remixOf = openItem?.remixOf;
  const remixParent =
    tab === "online" && remixOf !== undefined
      ? listed?.find((item) => item.id === remixOf.catalogueId)
      : undefined;
  const assignItem =
    assignId === undefined
      ? undefined
      : listed?.find((item) => item.id === assignId);

  /**
   * The one callback a cell's four actions and the modal's footer share.
   *
   * **`open` and `assign` are the two a build runs.** Export and delete are
   * drawn on every cell and in the item's footer and **no task in this plan and
   * no phase in the spec's landing order owns either**, so they are drawn
   * disabled with their reason rather than reaching this callback at all
   * (`cell-actions.ts`, R164). A phase that takes one up moves it out of that
   * map, and wires it here in the same change.
   *
   * **`open` opens a document and not this modal** (R134). Its label is *Open
   * in editor*, and the library's own operation of that name loads the stored
   * theme as the open document — which is what the cell's own surface is for
   * instead: the item's modal, through `onOpenItem` below.
   *
   * **`assign` opens the display choice**, from the cell and from the modal's
   * footer alike, because the modal draws the cell's own four actions and
   * reports them through this one callback. It reads the displays when it opens
   * and keeps none of them (`assign-display.tsx`).
   */
  const onAction = (action: CellAction, id: string): void => {
    if (action === "open") {
      props.onOpenTheme?.(id);
      return;
    }
    if (action === "assign") {
      // **The choice never coexists with the modal it was opened from.** Both
      // are modal dialogs portalled to `body`, and below they are React
      // siblings — which Base UI's nested-dialog coordination never sees, so
      // each believes it is the topmost: one Escape closes both, and two scrims
      // stack. Closing the modal as the choice opens removes the pair rather
      // than arbitrating it.
      setOpenId(undefined);
      setAssignId(id);
    }
  };

  /** **A changed filter returns to page one** (R123). A narrower result would
   *  otherwise leave the viewer on a page that no longer exists, which reads as
   *  an empty store — and it is the filter's rule rather than the pager's, so
   *  the pager is never asked to reset itself. */
  const toFirstPage = (): void => setPage(1);

  return (
    <div data-yunari-store-region="" className="flex min-h-0 flex-1 flex-col">
      <div
        data-yunari-store-header=""
        className="flex flex-none flex-wrap items-center gap-[var(--space-16)] px-[var(--space-16)] pt-[var(--space-12)]"
      >
        <Halves tab={tab} onTab={setTab} />
        {/* §5's well with the query in it, and no magnifier glyph: the well is
            the control, the placeholder is the word, and a mark beside a word
            is read twice (§6). */}
        <ControlWell widthClassName="w-[180px] flex-none">
          <input
            type="search"
            data-yunari-store-search=""
            aria-label={uiCopy.store.search}
            placeholder={uiCopy.store.search}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              toFirstPage();
            }}
            className="h-full w-full bg-transparent text-sm text-text outline-none"
          />
        </ControlWell>
        <FacetRow
          facets={storeFacets(listed ?? [])}
          chosen={chosen}
          onToggle={(facetId, optionId) => {
            setChosen((current) => toggleFacet(current, facetId, optionId));
            toFirstPage();
          }}
        />
        {/* The author's own listing, beside the filters it is still narrowed by.
            Drawn only where the host holds a session; pressing it moves the
            region to the online half, which is the half it lists through. */}
        {online.offered ? (
          <Toggle
            data-yunari-store-mine=""
            pressed={online.on}
            onPressedChange={online.setOn}
            className="flex-none rounded-md border border-edge bg-panel-2 px-[var(--space-10)] py-[var(--space-6)] text-xs text-muted hover:border-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent data-[pressed]:border-accent data-[pressed]:text-text"
          >
            {uiCopy.store.mine.label}
          </Toggle>
        ) : null}
        {/* §5's select, which is a **labelled row** and stays one here: the set
            has one select and this is it, and a bare well with a chevron would
            be a second copy of its popup, its keyboard model and its `readOnly`
            refusal to keep in step. §5 rule 5's label is the row's own rather
            than a name only a screen reader hears, which is what the drawing's
            unlabelled well would leave it with. */}
        <ControlSelect
          id={SORT_ID}
          label={uiCopy.store.sort.label}
          data={{ "data-yunari-store-sort": "" }}
          value={sort[tab]}
          options={SORT_KEYS[tab]}
          onChange={(id) => {
            // A value the half's own keys do not name is refused rather than
            // written: a widened option list must not be able to set a sort
            // nothing reads.
            if (!SORT_KEYS[tab].some((key) => key.id === id)) return;
            setSort((current) => ({ ...current, [tab]: id }));
          }}
        />
      </div>

      {/* The gallery's own scroller, so the header and the pager stay still
          while the grid moves — the pane body's model (§7.3). */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-[var(--space-16)]">
        {body.kind === "empty-library" ? (
          <Empty
            lead={uiCopy.store.empty.library}
            hint={uiCopy.store.empty.libraryHint}
          />
        ) : null}
        {body.kind === "empty-catalogue" ? (
          <Empty lead={online.empty.lead} hint={online.empty.hint} />
        ) : null}
        {body.kind === "empty-filter" ? (
          <Empty lead={uiCopy.store.empty.filter} hint={undefined} />
        ) : null}
        {body.kind === "items" ? (
          <Gallery
            items={body.items}
            onAction={onAction}
            onOpenItem={setOpenId}
            install={install.control}
          />
        ) : null}
      </div>

      {/* Below the grid and above the pager: what the catalogue read could not
          use, one line per kind, so the grid says what it holds and this says
          what it left out. It belongs to the online half, because it is the
          catalogue's fact and not the library's. */}
      {tab === "online" && online.refused.length > 0 ? (
        <ul
          data-yunari-store-refusals=""
          className="flex flex-none flex-col gap-[var(--space-4)] px-[var(--space-16)] pt-[var(--space-8)] text-xs text-faint"
        >
          {online.refused.map((refusal) => (
            <li
              key={`${refusal.reason}:${refusal.kind ?? ""}`}
              data-yunari-store-refusal=""
            >
              {uiCopy.store.catalogueRefused(refusal.kind, refusal.count)}
            </li>
          ))}
        </ul>
      ) : null}

      <Pager
        current={current}
        total={total}
        size={size}
        onPage={setPage}
        onSize={(next) => {
          setSize(next);
          preference.write(next);
        }}
      />

      {openItem === undefined ? null : (
        <ItemModal
          item={openItem}
          // The vocabulary is the listing's, built here because the listing is
          // this surface's: the modal reads the set and never the items.
          vocabulary={settledTags(listed ?? [], openItem)}
          onClose={() => setOpenId(undefined)}
          onAction={onAction}
          install={install.control}
          submit={submit.control}
          {...(tab === "online" ? { onOpenItem: setOpenId } : {})}
          {...(remixParent === undefined ? {} : { remixParent })}
          onUnpublish={online.onUnpublish}
          onRepublish={online.onRepublish}
        />
      )}

      {assignItem === undefined ? null : (
        <AssignDisplay
          item={assignItem}
          client={client}
          onClose={() => setAssignId(undefined)}
        />
      )}

      {/* **One live region for the whole store**, mounted empty and given its
          sentence when a refusal arrives: a region mounted holding text is the
          less reliably announced pattern, and the cell and the modal are both
          on screen while the modal is open — one region per surface would put
          the same sentence in two. The visible sentence stays beside the
          control that was refused. It is last because the region's *first* row
          is its header (`shows the two halves as a Segmented ...`).
          **The install and the submission share it** rather than each mounting
          their own: two live regions are two announcements, and the modal's
          outside-hiding spares only `[aria-live]` nodes. A status change's
          refusal shares it too, and **the newest command's sentence wins**:
          a stale install success must not sit in front of a fresh refusal. */}
      <span
        data-yunari-store-install-announcement=""
        role="status"
        aria-live="polite"
        className="sr-only"
      >
        {online.announcement || install.announcement || submit.announcement}
      </span>
    </div>
  );
}
