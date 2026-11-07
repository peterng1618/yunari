import {
  type AssetPage,
  type AssetResult,
  type AssetSourceListing,
  type DeclarativeCategory,
  declarativeCategories,
  type ListingCategory,
  type PresetKind,
} from "@yunari/renderer-core";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { finderTabGlyph, Glyph } from "../editor-shell/icons.js";
import { VideoTrimModal } from "../panes/assets/video-trim-modal.js";
import { uiCopy } from "../ui-copy.js";
import { itemAssetPath } from "../wallpaper-engine/client.js";
import { type AssetPlacement } from "./actions.js";
import { type ClientOptions, listExtensions, listSources } from "./client.js";
import { assetActionsFor } from "./finder-asset-actions.js";
import { FinderBody } from "./finder-body.js";
import {
  cardModelOf,
  type FinderCardModel,
  previewableOf,
} from "./finder-card.js";
import { ConnectionsButton, type FinderAction } from "./finder-controls.js";
import {
  FinderEmptyState,
  FinderPlaceholderDialog,
  FinderStatus,
} from "./finder-feedback.js";
import { FinderFooterActions } from "./finder-footer.js";
import { FinderFrame } from "./finder-frame.js";
import {
  type ActionOutcome,
  categoryLabel,
  categoryTabs,
  categoryWord,
  customSourcesOf,
  DEFAULT_FINDER_TAB,
  DISABLED_KEY,
  EMPTY_VIEW,
  gridSourcesOf,
  type KindFilter,
  type PreviewTarget,
  rememberedFinderTab,
  rememberFinderTab,
  sourceIdOf,
  storedDisabled,
  viewOf,
} from "./finder-model.js";
import { previewModel } from "./finder-preview.js";
import { FinderFilters, FinderSourceChips } from "./finder-toolbar.js";
import { FontPreviewPanel } from "./font-preview-panel.js";
import { type FontActions, fontRows } from "./fonts.js";
import { FinderPreviewModal } from "./preview-modal.js";
import { type FinderRow, hasMore, rowsOf } from "./tab-data.js";
import { useFontTab } from "./use-font-tab.js";
import { useTabSearches } from "./use-tab-searches.js";
import { useWallpaperTab } from "./use-wallpaper-tab.js";
import { type WallpaperActions, WallpaperTools } from "./wallpaper.js";

export type { ActionOutcome };

export interface FinderProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The Fonts tab's session writes and role presets. Absent until the shell
   *  wires them; every font action is drawn from what this offers. */
  readonly font?: FontActions;
  /** The Wallpaper Engine tab's session writes. Absent makes the library
   *  read-only: the cards still draw and no action claims to run. */
  readonly wallpaper?: WallpaperActions;
  /** One row's action. `placement` names a second action — an image can be set
   *  as the theme's background or placed on the canvas — and is absent for the
   *  kind's own default. */
  readonly onAction: (
    page: AssetPage,
    result: AssetResult,
    placement?: AssetPlacement,
  ) => Promise<ActionOutcome>;
  /** Opens Settings on Connections; absent until the shell wires it. */
  readonly onOpenConnections?: () => void;
  /** The category to select once the listing arrives, when the caller asked
   *  for one (the font field opens on Fonts). */
  readonly initialCategory?: ListingCategory;
  readonly client?: ClientOptions;
}

/**
 * The finder: one modal, tabs derived from the registry's categories, one
 * mixed grid per grid category and a body per category that owns a component.
 *
 * **Browse on open and append as the author scrolls.** Each tab owns its own
 * question, rows, page cursor and selection; opening it asks page one of every
 * enabled source, and reaching the grid's end asks the next page of the
 * sources that say they have one. The grid only ever grows.
 *
 * A late answer is dropped by comparing a ticket on resolve; an abort alone
 * does not stop a response already in flight, so two searches racing would
 * otherwise leave the older one on screen. The ticket is per category, so a
 * tab's answer still lands while another tab is being read.
 */
export function AssetFinder({
  open,
  onOpenChange,
  font,
  wallpaper,
  onAction,
  onOpenConnections,
  initialCategory,
  client,
}: FinderProps): React.JSX.Element {
  const [sources, setSources] = useState<readonly AssetSourceListing[]>([]);
  /** The categories the installed extensions declare. A host that cannot list
   *  extensions leaves this empty, so the finder keeps its built-in tabs. */
  const [declared, setDeclared] = useState<readonly DeclarativeCategory[]>([]);
  /** The declared ids, readable from an effect callback that may have started
   *  before the extension listing arrived. */
  const declaredIdsRef = useRef<ReadonlySet<string>>(new Set());
  const [listing, setListing] = useState<"loading" | "ok" | "failed">(
    "loading",
  );
  const [active, setActive] = useState<ListingCategory | undefined>(
    rememberedFinderTab,
  );
  const [disabled, setDisabled] = useState<ReadonlySet<string>>(storedDisabled);
  /** The Colours tab's kind filter. A palette and a gradient are different
   *  presets, so a question about one must not be answered with the other. */
  const [presetFilter, setPresetFilter] = useState<KindFilter>("all");
  /** The hosts the first host-contacting search reached, shown once.
   *  A search that reached none is not the disclosure: a person is told before
   *  the term leaves, not after. */
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  /** The result the preview modal is showing, and the asset action it is
   *  running. The preview is a second surface over the finder, not a tab. */
  const [previewing, setPreviewing] = useState<PreviewTarget | undefined>();
  const [runningAsset, setRunningAsset] = useState<string | undefined>();
  /** A plugin body owns its own search; the finder keeps the question it last
   *  answered and the page it answered it with. */
  const [customQuery, setCustomQuery] = useState("");
  const [customPage, setCustomPage] = useState<AssetPage | undefined>(
    undefined,
  );
  /** The finder does not page a plugin body; the frame asks for its own pages.
   *  The setter still records the answer, so a caller may read it later. */
  const [, setCustomPageNumber] = useState(1);

  /** A category exists when an extension declares it, the registry lists one,
   *  or the session offers the writes a pane needs. */
  const present = (
    category: ListingCategory,
    listing: readonly AssetSourceListing[],
  ): boolean =>
    declaredIdsRef.current.has(category) ||
    listing.some((source) => source.category === category) ||
    (category === "font" && font !== undefined) ||
    (category === "local" && wallpaper !== undefined);

  useEffect(() => {
    if (!open) return;

    let live = true;
    // The sources decide the dialog and are the only answer that can fail it;
    // the extension listing only adds tabs, so it never gates the finder and a
    // refused or slow extensions route leaves the built-in categories drawn.
    void listSources(client).then((next) => {
      if (!live) return;
      // A host that cannot be reached is a sentence, not an empty dialog: a
      // build without the asset routes and an absent host read the same here,
      // and both mean the finder cannot work.
      if (!next.ok) {
        setListing("failed");
        setSources([]);
        return;
      }
      setListing("ok");
      setSources(next.sources);
      const listed = next.sources;
      setActive((current) => {
        // A caller that names a category wins over the last one: the font
        // field opens Fonts every time, not only the first time.
        if (initialCategory !== undefined && present(initialCategory, listed)) {
          return initialCategory;
        }
        if (current !== undefined && present(current, listed)) return current;
        // Icons are where a person starts when no call names a tab and no
        // choice was made this session.
        if (present(DEFAULT_FINDER_TAB, listed)) return DEFAULT_FINDER_TAB;
        return listed[0]?.category ?? (font !== undefined ? "font" : "local");
      });
    });

    void listExtensions(client)
      .then((extensions) => {
        if (!live) return;
        const categories = extensions.ok
          ? declarativeCategories(extensions.extensions)
          : [];
        declaredIdsRef.current = new Set(
          categories.map((category) => category.id),
        );
        setDeclared(categories);
        // The caller's named tab may be one only an extension declares, and
        // the sources answer may already have picked another.
        if (
          initialCategory !== undefined &&
          declaredIdsRef.current.has(initialCategory)
        ) {
          setActive(initialCategory);
        }
      })
      .catch(() => {
        if (live) setDeclared([]);
      });

    return () => {
      live = false;
    };
    // `font` is read for presence only; its callbacks are the session's.
  }, [open, client, initialCategory, font === undefined]);

  useEffect(() => {
    // A browser that refuses storage keeps the choice for this session only;
    // the chip is still the author's press, so throwing here would take the
    // modal down over a preference.
    try {
      localStorage.setItem(DISABLED_KEY, JSON.stringify([...disabled]));
    } catch {
      // No store: the disabled set lives in state for as long as the page does.
    }
  }, [disabled]);

  useEffect(() => {
    // Each tab's plugin body is its own frame; a question and page from the
    // previous tab are not this one's.
    setCustomQuery("");
    setCustomPage(undefined);
    setCustomPageNumber(1);
  }, [active]);

  /** A declared category is a tab even before a source serves it: the
   *  extension registered the place, and its grid says it has nothing yet. */
  const declaredIds = new Set(declared.map((category) => category.id));
  const declaredLabels = new Map(
    declared.map((category) => [category.id, category.label]),
  );
  /** A declared category names its own glyph; a built-in id still reads the
   *  built-in map inside `finderTabGlyph`. */
  const declaredIcons = new Map(
    declared.map((category) => [category.id, category.icon]),
  );
  const categories = categoryTabs(declared, sources).filter(
    (category) => present(category, sources) || declaredIds.has(category),
  );

  const gridSources =
    active === undefined ? [] : gridSourcesOf(sources, active);
  /** The tab's source whose body is a plugin frame, when it declares one. */
  const customSource =
    active === undefined ? undefined : customSourcesOf(sources, active)[0];
  /** The kinds the tab's sources actually yield, never a fixed list. */
  const kinds = [
    ...new Set(
      gridSources
        .map((source) => source.presetKind)
        .filter((kind): kind is PresetKind => kind !== null),
    ),
  ];
  // The filter chooses which sources are asked; the chips' own persisted
  // choice is intersected with it, never rewritten by it.
  const visibleSources =
    presetFilter === "all"
      ? gridSources
      : gridSources.filter((source) => source.presetKind === presetFilter);
  const enabledSources = visibleSources.filter(
    (source) => !disabled.has(source.id),
  );
  const enabled = enabledSources.map((source) => source.id);

  const { views, patch, askNew, loadMore, retry } = useTabSearches({
    open,
    active,
    visibleSources,
    enabled,
    enabledSources,
    client,
    onNotice: setNotice,
  });
  const view = active === undefined ? EMPTY_VIEW : viewOf(views, active);
  const fontTab = useFontTab({
    open,
    active,
    selection: view.selection,
    font,
    patch,
  });
  const wallpaperTab = useWallpaperTab({
    open,
    active,
    client,
    wallpaper,
    setPreviewing,
  });

  const sourceOf = (id: string): AssetSourceListing | undefined =>
    sources.find((source) => source.id === id);

  const runRow = async (
    category: ListingCategory,
    row: FinderRow,
    placement?: AssetPlacement,
  ): Promise<ActionOutcome> => {
    setBusy(true);
    const outcome = await onAction(row.page, row.result, placement);
    setBusy(false);
    patch(category, (current) => ({
      ...current,
      message: {
        text:
          outcome.message ??
          categoryWord(uiCopy.assets.done, category) ??
          uiCopy.assets.done.icon,
        tone: outcome.ok ? "ok" : "failed",
        ...(outcome.ok ? {} : { failedId: row.result.id }),
      },
    }));
    return outcome;
  };

  if (listing !== "ok") {
    return (
      <FinderPlaceholderDialog
        open={open}
        onOpenChange={onOpenChange}
        state={listing === "failed" ? "failed" : "loading"}
      />
    );
  }

  if (active === undefined) {
    return (
      <FinderPlaceholderDialog
        open={open}
        onOpenChange={onOpenChange}
        state="no-source"
      />
    );
  }

  /** The Wallpaper Engine tab draws the same frame, card and grid, but its
   *  content is a listing rather than an answer. */
  const isLocal = active === "local";
  const isGrid =
    isLocal || gridSources.length > 0 || customSource !== undefined;
  const rows = rowsOf(view.data, enabled);
  /** What the grid draws: the tab's own filter can narrow a font answer
   *  without touching what was asked or kept. */
  const shown = active === "font" ? fontRows(rows, fontTab.fontFilter) : rows;
  const more = isGrid && hasMore(view.data, enabled);
  const failures = [...view.data.failures.values()];
  /** A keyed source in trouble is the one reason to offer Connections: a
   *  refused key can reach the host as a plain failure, so the control follows
   *  the source's declaration, not the reason it reports. */
  const needsConnections = failures.some(
    (page) =>
      page.failure?.reason === "needs-credential" ||
      (sourceOf(page.source)?.requires ?? null) !== null,
  );
  const pendingFirst = !view.browsed || view.loading === "first";
  const kindSourcesOff = visibleSources.length > 0 && enabled.length === 0;

  const selectionId =
    view.selection === undefined
      ? undefined
      : `${view.selection.page.source}:${view.selection.result.id}`;
  const busyId =
    busy && view.selection !== undefined ? view.selection.result.id : undefined;
  const failedId = view.message?.failedId;

  const statusTone: "ok" | "failed" | undefined = isLocal
    ? wallpaperTab.local.message?.tone
    : (view.message?.tone ?? (failures.length > 0 ? "failed" : undefined));

  const runRowHere = (
    row: FinderRow,
    placement?: AssetPlacement,
  ): Promise<ActionOutcome> => runRow(active, row, placement);
  const footerAsset = assetActionsFor({
    active,
    row: view.selection,
    busy,
    runRow: runRowHere,
  });

  const cards: readonly FinderCardModel[] = shown.map(({ page, result }) =>
    cardModelOf(result, sourceOf(page.source)?.label ?? page.source),
  );
  const rowOfCard = (card: FinderCardModel): FinderRow | undefined =>
    shown.find(
      ({ page, result }) =>
        result.id === card.id && page.source === card.sourceId,
    );

  /** Only a picture has something to enlarge: an icon, palette, gradient or
   *  face keeps its single-press selection and no Preview button. */
  const previewableSelection = isLocal
    ? wallpaperTab.local.selection !== undefined
    : active !== "font" &&
      view.selection !== undefined &&
      previewableOf(view.selection.result);

  const openSelectionPreview = (): void => {
    if (isLocal) {
      if (wallpaperTab.local.selection !== undefined) {
        setPreviewing({ kind: "local", item: wallpaperTab.local.selection });
      }
      return;
    }
    const row = view.selection;
    if (row !== undefined && previewableOf(row.result)) {
      setPreviewing({ kind: "asset", row });
    }
  };

  const previewActions: readonly FinderAction[] =
    previewing === undefined
      ? []
      : previewing.kind === "local"
        ? wallpaperTab.actionsFor(previewing.item)
        : assetActionsFor({
            active,
            row: previewing.row,
            busy,
            runRow: runRowHere,
          });
  const previewMessage =
    previewing === undefined
      ? undefined
      : previewing.kind === "local"
        ? wallpaperTab.local.message
        : view.message;
  const previewBusy =
    previewing === undefined
      ? undefined
      : previewing.kind === "local"
        ? wallpaperTab.localRunning
        : runningAsset;

  const runPreviewAction = (action: FinderAction): void => {
    if (previewing === undefined) return;
    if (previewing.kind === "local") {
      wallpaperTab.runAction(action, previewing.item);
      return;
    }
    setRunningAsset(action.id);
    void Promise.resolve(action.run()).finally(() => {
      setRunningAsset(undefined);
    });
  };

  const empty = (
    <FinderEmptyState
      kindSourcesOff={kindSourcesOff}
      pendingFirst={pendingFirst}
      failures={failures}
      {...(onOpenConnections === undefined ? {} : { onOpenConnections })}
      onRetry={retry}
      hasRows={rows.length > 0}
      query={view.data.query}
      onClearQuery={() => askNew(active, "")}
    />
  );

  /** A plugin body answers its own search; `onPick` is the frame asking for a
   *  result's bytes, which the finder imports through its normal action. */
  const pluginBody =
    customSource === undefined
      ? undefined
      : {
          source: customSource,
          page: customPage,
          query: customQuery,
          onQuery: setCustomQuery,
          onPage: setCustomPageNumber,
          onResults: setCustomPage,
          onPick: (result: AssetResult) => {
            const page: AssetPage = customPage ?? {
              source: customSource.id,
              results: [result],
              totalPages: undefined,
              failure: undefined,
            };
            void runRow(active, { page, result });
          },
        };

  return (
    <>
      <FinderFrame
        open={open}
        onOpenChange={(next) => {
          // While the preview is over the finder, the preview is what a close
          // closes: the finder would otherwise go with it.
          if (!next && previewing !== undefined) return;
          onOpenChange(next);
        }}
        onEscape={() => {
          // A selected card is the first thing Escape drops. An empty
          // selection leaves the key to the dialog, which closes the finder.
          if (view.selection !== undefined) {
            patch(active, (current) => ({
              ...current,
              selection: undefined,
            }));
            return true;
          }
          if (wallpaperTab.local.selection !== undefined) {
            wallpaperTab.clearSelection();
            return true;
          }
          return false;
        }}
        label={uiCopy.assets.title}
        heading={uiCopy.panels.assetFinder}
        closeLabel={uiCopy.assets.close}
        className="editor-shell-dialog--finder"
        tabs={categories.map((category) => ({
          id: category,
          label: declaredLabels.get(category) ?? categoryLabel(category),
          icon: (
            <Glyph
              icon={finderTabGlyph(category, declaredIcons.get(category))}
              size={13}
            />
          ),
        }))}
        active={active}
        onTabChange={(category) => {
          // The kind filter belongs to the Colours tab: it neither follows the
          // author to the next tab nor leaves Colours' rows answering a
          // narrower question than the chip will show on the way back.
          if (presetFilter !== "all") {
            setPresetFilter("all");
            askNew("colour", views.colour?.data.query ?? "");
          }
          setActive(category);
          rememberFinderTab(category);
        }}
        {...(isGrid && customSource === undefined
          ? isLocal
            ? {
                query: wallpaperTab.local.query,
                searchPlaceholder:
                  categoryWord(uiCopy.assets.search, active) ??
                  uiCopy.assets.searchPlaceholder,
                onQueryChange: wallpaperTab.setQuery,
              }
            : {
                query: view.data.query,
                searchPlaceholder:
                  categoryWord(uiCopy.assets.search, active) ??
                  uiCopy.assets.searchPlaceholder,
                onQueryChange: (value: string) => askNew(active, value),
              }
          : {})}
        filters={
          <FinderFilters
            active={active}
            local={isLocal}
            fontFilter={fontTab.fontFilter}
            onFontFilterChange={fontTab.setFontFilter}
            localKind={wallpaperTab.local.kind}
            onLocalKindChange={wallpaperTab.setKind}
            localSort={wallpaperTab.sort}
            onLocalSortChange={wallpaperTab.setSort}
            localDirection={wallpaperTab.direction}
            onLocalDirectionChange={wallpaperTab.setDirection}
            kinds={kinds}
            presetFilter={presetFilter}
            onPresetFilterChange={(kind) => {
              setPresetFilter(kind);
              askNew(active, view.data.query);
            }}
          />
        }
        sources={
          <FinderSourceChips
            sources={visibleSources}
            disabled={disabled}
            failures={view.data.failures}
            onToggle={(sourceId) => {
              setDisabled((current) => {
                const next = new Set(current);
                if (next.has(sourceId)) next.delete(sourceId);
                else if (
                  enabled.length > 1 ||
                  !visibleSources.some((entry) => !next.has(entry.id))
                ) {
                  next.add(sourceId);
                }
                return next;
              });
              askNew(active, view.data.query);
            }}
          />
        }
        tools={
          <>
            {isLocal ? (
              <WallpaperTools
                onImportPackage={wallpaper?.onImportPackage}
                onRefresh={wallpaperTab.refresh}
                onStatus={wallpaperTab.showMessage}
              />
            ) : null}
            <ConnectionsButton
              needs={needsConnections}
              onOpen={() => onOpenConnections?.()}
            />
          </>
        }
        status={
          <FinderStatus
            local={isLocal}
            grid={isGrid}
            localMessage={wallpaperTab.local.message}
            message={view.message}
            loading={view.loading !== undefined}
            enabledCount={enabled.length}
            failures={failures}
            shownCount={shown.length}
            sourceCount={
              new Set(shown.map((row) => sourceIdOf(row.result))).size
            }
            more={more}
            labelOf={(source) => sourceOf(source)?.label ?? source}
            onRetry={retry}
          />
        }
        {...(statusTone === undefined ? {} : { statusTone })}
        {...(fontTab.selection === undefined
          ? {}
          : {
              detail: (
                <FontPreviewPanel
                  selected={fontTab.selection}
                  presets={font?.presets ?? {}}
                  state={fontTab.fontPreview}
                  {...(fontTab.favorite === undefined
                    ? {}
                    : { favorite: fontTab.favorite })}
                  onChange={fontTab.setFontPreview}
                />
              ),
            })}
        actions={
          <FinderFooterActions
            grid={isGrid}
            previewable={previewableSelection}
            onOpenPreview={openSelectionPreview}
            local={isLocal}
            localActions={wallpaperTab.footer}
            localRunning={wallpaperTab.localRunning}
            onRunLocal={wallpaperTab.runAction}
            font={active === "font"}
            fontActions={fontTab.footer}
            running={fontTab.running}
            onRunFont={fontTab.run}
            assetActions={footerAsset}
            busy={busy}
          />
        }
      >
        <FinderBody
          {...(pluginBody === undefined ? {} : { plugin: pluginBody })}
          active={active}
          grid={isGrid}
          local={isLocal}
          localUnavailable={wallpaperTab.unavailable}
          library={wallpaperTab.library}
          libraryCount={wallpaperTab.libraryItems.length}
          localItems={wallpaperTab.items}
          localSelection={wallpaperTab.local.selection}
          localBusyId={wallpaperTab.busyId}
          localFailedId={wallpaperTab.local.message?.failedId}
          localDone={wallpaperTab.local.done}
          onSelectLocal={wallpaperTab.select}
          onPreviewLocal={wallpaperTab.preview}
          onApplyLocal={wallpaperTab.apply}
          notice={notice}
          empty={empty}
          shownCount={shown.length}
          loading={view.loading !== undefined}
          query={view.data.query}
          cards={cards}
          selectedId={selectionId}
          busyId={busyId}
          failedId={failedId}
          onSelect={(card) => {
            const row = rowOfCard(card);
            if (row !== undefined) {
              patch(active, (current) => ({
                ...current,
                selection: row,
              }));
              // A cut belongs to the family that listed it.
              if (active === "font") {
                fontTab.setFontPreview((current) => ({
                  ...current,
                  cutId: undefined,
                }));
              }
            }
          }}
          onPreview={(card) => {
            // Double-click enlarges a picture; every other kind has no
            // larger form and keeps its single-press selection.
            const row = rowOfCard(card);
            if (row !== undefined && previewableOf(row.result)) {
              setPreviewing({ kind: "asset", row });
            }
          }}
          onApply={(card) => {
            const row = rowOfCard(card);
            if (row === undefined) return;
            patch(active, (current) => ({
              ...current,
              selection: row,
            }));
            if (active === "font") {
              const first = fontTab.firstFor(row);
              if (first !== undefined) fontTab.run(first);
              return;
            }
            void runRow(
              active,
              row,
              active === "image" ? "background" : undefined,
            );
          }}
          onNeedMore={loadMore}
          canLoadMore={more && view.loading === undefined}
          appending={view.loading === "more"}
        />
      </FinderFrame>
      {wallpaperTab.trimming === undefined ? null : (
        <VideoTrimModal
          src={itemAssetPath(wallpaperTab.trimming.workshopId)}
          name={wallpaperTab.trimming.title}
          onConfirm={wallpaperTab.confirmTrim}
          onClose={wallpaperTab.cancelTrim}
        />
      )}
      <FinderPreviewModal
        preview={
          previewing === undefined ? undefined : previewModel(previewing)
        }
        actions={previewActions}
        busyActionId={previewBusy}
        message={previewMessage}
        onRun={runPreviewAction}
        onClose={() => {
          setPreviewing(undefined);
        }}
      />
    </>
  );
}
