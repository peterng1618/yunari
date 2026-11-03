import type * as React from "react";
import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { ControlIconButton } from "../components/ui/control-icon-button.js";
import {
  cardWidthFor,
  columnsForWidth,
  type GridDensityLevel,
  targetCardWidth,
} from "../editor-shell/grid-density.js";
import {
  ASSIGN_ITEM_GLYPH,
  CHECK_GLYPH,
  DELETE_ITEM_GLYPH,
  EXPORT_ITEM_GLYPH,
  Glyph,
  INSTALL_ITEM_GLYPH,
  type LucideIcon,
  OPEN_ITEM_GLYPH,
  PUBLISH_ITEM_GLYPH,
} from "../editor-shell/icons.js";
import { uiCopy } from "../ui-copy.js";
import { CELL_ACTION_REASONS } from "./cell-actions.js";
import type { InstallControl } from "./install-item.js";
import { type InstallState, installStateOf } from "./install-state.js";
import { justifiedRows } from "./justified-rows.js";
import type { CellAction, StoreItem } from "./local-source.js";
import { StoreStatusBadge } from "./status-badge.js";
import type { SubmitControl } from "./use-submit.js";

/**
 * The gallery: the cell, and the grid of them.
 *
 * It is handed its items and narrows nothing — A.5 owns what a query and a
 * facet selection filter, A.6 mounts it in the region and owns the empty states,
 * and the source it reads is A.4's. What is here is the cell's own geometry,
 * taken from the store-themes region.
 */

/** The four library actions in the card's own order: assign, edit, export,
 *  delete. Publishing, when the item is local-only, sits between edit and
 *  export. */
const CELL_ACTIONS = [
  "assign",
  "open",
  "export",
  "delete",
] as const satisfies readonly CellAction[];

/** One cell action's control id, derived from the item and the action the way
 *  `useControlIds` derives a control's — so the reason node beside a disabled
 *  button is found from the button that describes itself by it. */
const cellActionId = (itemId: string, action: CellAction): string =>
  `yunari-store-cell-${itemId}-${action}`;

/** One glyph per action, as a **total** lookup: an action added to `CellAction`
 *  without a mark fails to compile here rather than drawing a nameless square. */
const CELL_ACTION_GLYPHS: Readonly<Record<CellAction, LucideIcon>> = {
  open: OPEN_ITEM_GLYPH,
  assign: ASSIGN_ITEM_GLYPH,
  export: EXPORT_ITEM_GLYPH,
  delete: DELETE_ITEM_GLYPH,
};

/** The download count's reader. `en-US` because `uiCopy` is one English table,
 *  and `Intl` rather than `toLocaleString` so the separator is the build's
 *  rather than the machine's — the `1,204`. When the UI gains locales
 *  this follows `uiCopy`. */
const DOWNLOAD_COUNT = new Intl.NumberFormat("en-US");

/** The gallery's gutter, in both directions. */
const GALLERY_GAP = 12;

/** The ratio a record without a usable size is laid out at: the old 2:1 band
 *  rather than a card that collapses. */
function ratioOf(item: StoreItem): number {
  return item.facets.width > 0 && item.facets.height > 0
    ? item.facets.width / item.facets.height
    : 2;
}

/**
 * The grid of cells: a masonry of cards at the themes' own heights.
 *
 * **A row is justified, not a masonry column.** Cards are collected until their
 * natural widths pass the scroller, and the row is scaled so its cards and
 * gutters together equal the scroller's width — flush at both edges. A 4:1
 * theme therefore takes the width it needs to stay legible instead of becoming
 * a strip, and a square theme no longer reserves a square's area out of every
 * row. The final row keeps the target height and is short on the right.
 *
 * **The density is a level, and the columns are the width's answer for it.**
 * The count is derived here from the measured scroller rather than handed down
 * as a number, so a resize re-derives it instead of freezing the count that was
 * chosen in another window size.
 *
 * The four actions travel through one `onAction`, because a cell draws four and
 * a callback per action would be four props a caller can half-wire.
 */
export function Gallery(props: {
  readonly items: readonly StoreItem[];
  /** The viewer's density level. The header's slider owns it; the grid only
   *  reads it, so the control and the packing cannot disagree. */
  readonly density: GridDensityLevel;
  readonly onAction: (action: CellAction, id: string) => void;
  /** Opens one item's own surface — the modal — which is the cell's own
   *  gesture rather than one of its four actions. */
  readonly onOpenItem: (id: string) => void;
  /** The online half's install press, which the region owns because the
   *  re-listing it causes is the listing's fact rather than a cell's. */
  readonly install: InstallControl;
  /** The local half's publish press, owned by the region for the same reason:
   *  a landed submission re-lists the library. Absent on a surface with no
   *  submission flow, which draws the four actions alone. */
  readonly submit?: SubmitControl | undefined;
}): React.JSX.Element {
  const listRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const node = listRef.current;
    if (node === null) return undefined;
    const measure = (): void => setWidth(node.clientWidth);
    measure();
    // The window listener is the fallback for a resize the observer does not
    // report: a stale width would leave the rows at the size of a pane that no
    // longer exists, and the cards would wrap out of their own row.
    window.addEventListener("resize", measure);
    if (typeof ResizeObserver === "undefined") {
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const columns = columnsForWidth(width, props.density);
  // Before the first measurement, the count answers for a pane of the target
  // card size, so the first frame reserves the cards it is about to draw.
  const unit = targetCardWidth(props.density);
  const targetHeight =
    width > 0
      ? cardWidthFor(width, columns)
      : cardWidthFor(columns * unit + GALLERY_GAP * (columns - 1), columns);
  const rows = justifiedRows({
    items: props.items,
    ratioOf,
    width,
    targetHeight,
    gap: GALLERY_GAP,
  });

  return (
    <div
      ref={listRef}
      role="list"
      data-yunari-store-gallery=""
      className="flex flex-col gap-[var(--space-12)]"
    >
      {/* **A row is a container, and its columns are ratios.** Each card takes
          a track proportional to its own ratio, so the tracks fill the row and
          every card's picture lands on the same height — the browser justifies
          the row without a width read, and a resize cannot leave the cards
          wrapping out of the row the packing gave them. A row the packing kept
          at the target height carries its own width and stops short. */}
      {rows.map((row) => {
        const shortWidth =
          row.items.reduce((sum, card) => sum + card.width, 0) +
          GALLERY_GAP * (row.items.length - 1);
        return (
          <div
            key={row.items[0]?.item.id ?? row.height}
            data-yunari-store-row=""
            className="grid gap-[var(--space-12)]"
            style={{
              gridTemplateColumns: row.items
                .map(({ item }) => `${ratioOf(item)}fr`)
                .join(" "),
              ...(row.short ? { maxWidth: shortWidth } : {}),
            }}
          >
            {row.items.map(({ item }) => (
              <Cell
                key={item.id}
                item={item}
                ratio={ratioOf(item)}
                onAction={props.onAction}
                onOpenItem={props.onOpenItem}
                install={props.install}
                submit={props.submit}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

/**
 * One item: its picture, one row for the name, the updated date and the card's
 * controls, and — only where it carries facts of its own — a band beneath.
 *
 * **The picture is the theme's own shape, contained, not cropped**: a card
 * advertises the theme's own picture, and a cropped one shows a composition the
 * author never drew. In a justified row its height is the row's, so the picture
 * fills exactly the width the row gave it.
 *
 * **The date and the controls share the name's line.** The date sits at the
 * right of that line; attending the card fades it out and fades the controls in
 * over the same space. A band remains only for the facts that are not this
 * theme's identity — an online item's kind and download count, or an origin
 * pill — so a plain library theme no longer repeats a date line under its name.
 */
function Cell(props: {
  readonly item: StoreItem;
  /** The theme's own width/height, which is the card's track weight and its
   *  picture's shape. */
  readonly ratio: number;
  readonly onAction: (action: CellAction, id: string) => void;
  readonly onOpenItem: (id: string) => void;
  readonly install: InstallControl;
  readonly submit?: SubmitControl | undefined;
}): React.JSX.Element {
  const { item, onAction, onOpenItem, install, submit } = props;
  const catalogue = item.catalogue;
  // The left slot branches on whether the item has catalogue facts; the action
  // slot on the install decision. They read different facts on purpose: a
  // library item has no install state, and an online item always has a left slot.
  const installState = installStateOf(item);
  const refusal =
    install.refusal?.id === item.id ? install.refusal.message : undefined;
  /** **Only a theme the host holds no store record of can be published**, and
   *  the press belongs to the same submission the item's own surface runs. It
   *  is not a `CELL_ACTIONS` member because that union is the library's four;
   *  the card draws it between Edit and Export. */
  const publish =
    submit !== undefined && item.origin === undefined ? (
      <ControlIconButton
        id={`yunari-store-cell-${item.id}-publish`}
        label={uiCopy.store.submit.label}
        disabled={
          submit.inFlight ||
          (submit.itemId === item.id && submit.state === "submitted")
        }
        aria-busy={
          submit.itemId === item.id && submit.inFlight ? true : undefined
        }
        data={{ "data-yunari-store-cell-action": "publish" }}
        onClick={() => submit.onSubmit(item)}
      >
        <Glyph icon={PUBLISH_ITEM_GLYPH} size={14} />
      </ControlIconButton>
    ) : null;

  return (
    <div
      role="listitem"
      data-yunari-store-cell={item.id}
      className="group relative flex min-w-0 flex-col overflow-hidden rounded-lg border border-edge bg-panel-2"
    >
      {/* **The author is a hover chip, not a line.** The chip sits over the
          picture's top-right corner, appears while the card is attended, and
          keeps its words in the tree either way — `opacity` hides it from
          sight, not from a screen reader. */}
      <span
        data-yunari-store-cell-author=""
        className="pointer-events-none absolute right-[var(--space-8)] top-[var(--space-8)] rounded-full bg-panel/80 px-[var(--space-8)] py-[var(--space-4)] font-mono text-2xs text-muted opacity-0 transition-opacity group-hover:opacity-100"
      >
        {authorChip(item)}
      </span>
      {/* **The picture and the name are two presses on the same document.**
          They are separate buttons so the controls can sit outside both: a
          button's own descendants are presentational, and one wrapping the
          actions would open the item on every press. */}
      <button
        type="button"
        data-yunari-store-cell-surface=""
        onClick={() => onOpenItem(item.id)}
        className="block w-full"
      >
        <Picture item={item} ratio={props.ratio} />
      </button>
      {/* **The date and the controls share one line.** The date is the resting
          reading; attending the card fades it out and the controls fade in over
          the same space, so the row never grows and the card never repeats a
          second date line beneath itself. */}
      <div className="relative flex items-center gap-[var(--space-6)] px-[var(--space-10)] pt-[var(--space-8)] pb-[var(--space-10)]">
        <button
          type="button"
          data-yunari-store-cell-name-press=""
          onClick={() => onOpenItem(item.id)}
          className="min-w-0 flex-1 text-left"
        >
          <span
            data-yunari-store-cell-name=""
            className="block truncate text-sm font-semibold text-text"
          >
            {item.name}
          </span>
        </button>
        <StoreStatusBadge status={item.status} />
        <span
          data-yunari-store-cell-byline=""
          className="flex-none font-mono text-2xs text-muted transition-opacity group-hover:opacity-0 group-focus-within:opacity-0"
        >
          {byline(item)}
        </span>
        <div
          data-yunari-store-cell-actions=""
          className="pointer-events-none absolute right-[var(--space-10)] top-[var(--space-8)] flex items-center gap-[var(--space-6)] opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
        >
          {installState === "none" ? (
            <>
              {CELL_ACTIONS.map((action) => {
                const reason = CELL_ACTION_REASONS[action];
                const controlId = cellActionId(item.id, action);
                return (
                  <Fragment key={action}>
                    {action === "export" ? publish : null}
                    <ControlIconButton
                      id={controlId}
                      label={uiCopy.store.cell.actions[action]}
                      disabled={reason !== undefined}
                      {...(reason === undefined
                        ? {}
                        : { describedById: `${controlId}-reason` })}
                      destructive={action === "delete"}
                      data={{ "data-yunari-store-cell-action": action }}
                      onClick={() => onAction(action, item.id)}
                    >
                      <Glyph icon={CELL_ACTION_GLYPHS[action]} size={14} />
                    </ControlIconButton>
                    {reason === undefined ? null : (
                      <span id={`${controlId}-reason`} className="sr-only">
                        {reason}
                      </span>
                    )}
                  </Fragment>
                );
              })}
            </>
          ) : (
            <InstallAction item={item} state={installState} install={install} />
          )}
        </div>
      </div>
      {catalogue === undefined && item.origin === undefined ? null : (
        <div className="px-[var(--space-10)] pb-[var(--space-10)]">
          {/* The band's own hook, because **what the badge sits in is the claim**:
            the layout puts it here rather than beside the name, so a case that
            only asked whether the badge exists would stay green through a move
            that changed the grid. */}
          <span
            data-yunari-store-cell-band=""
            className="flex min-w-0 items-center gap-[var(--space-6)]"
          >
            {/* **The band is the facts the name line cannot carry** — the online
              cell's kind and count, or the library cell's origin pill. A theme
              that came from nowhere and has no catalogue record draws no band
              at all: a row repeating its date under the name it already reads
              is the repetition this card removed. */}
            {catalogue === undefined ? (
              <span
                data-yunari-store-cell-origin=""
                className="flex-none rounded-full border border-edge bg-panel px-[var(--space-8)] py-[var(--space-4)] text-2xs font-medium text-muted"
              >
                {uiCopy.store.fromStore}
              </span>
            ) : (
              <>
                <span
                  data-yunari-store-cell-kind=""
                  className="flex-none rounded-full border border-edge px-[var(--space-8)] py-[var(--space-4)] text-2xs font-medium text-muted"
                >
                  {/* A kind this build does not know prints its identifier, which
                    is the rule for a client older than the kind. */}
                  {uiCopy.store.cell.kinds[item.kind] ?? item.kind}
                </span>
                <span
                  data-yunari-store-cell-downloads=""
                  className="flex flex-none items-center gap-[var(--space-4)] font-mono text-xs text-muted"
                >
                  {/* The download mark, the same glyph the export
                    action wears: one arrow for "taken from the store". The
                    mark is `--faint`, one step below the number's `--muted`. */}
                  <span className="flex-none text-faint">
                    <Glyph icon={EXPORT_ITEM_GLYPH} size={12} />
                  </span>
                  {/* The noun is read, not seen — see `uiCopy.store.counts`. */}
                  {DOWNLOAD_COUNT.format(catalogue.downloads)}
                  <span className="sr-only">
                    {` ${uiCopy.store.counts.downloads(catalogue.downloads)}`}
                  </span>
                </span>
              </>
            )}
          </span>
          {/* **The host's reason, beside the control it refused** — in the cell
            rather than in the band, because a sentence is not a 26px reading
            and truncating it would swallow the part that says what to fix. Only
            a cell with catalogue facts can have been refused: drawn
            unconditionally, a library item whose id collided with a refused
            catalogue id would carry the sentence with no control. The
            announcement is the region's one live region, not this span's. */}
          {installState === "none" || refusal === undefined ? null : (
            <span
              data-yunari-store-cell-install-refusal=""
              className="block pt-[var(--space-6)] text-2xs text-warn"
            >
              {refusal}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The online cell's action slot: one of the three readings, never the
 * library's four actions.
 *
 * **Installed is a mark, not a control** — there is nothing to do, and the
 * cell draws no button there. **Install and Update post the item to the
 * host**, and the control disables itself while that press is in flight so a
 * double press cannot install twice; the region re-lists on success, so the
 * word this draws comes from the listing rather than from a copy kept here.
 */
function InstallAction(props: {
  readonly item: StoreItem;
  readonly state: Exclude<InstallState, "none">;
  readonly install: InstallControl;
}): React.JSX.Element {
  const { item, state, install } = props;

  if (state === "installed") {
    return (
      <span
        data-yunari-store-cell-install={state}
        className="flex flex-none items-center gap-[var(--space-6)] text-xs text-muted"
      >
        {/* The word is muted like every other reading in the band; only the
            check carries the rationed accent. */}
        <span className="flex-none text-accent">
          <Glyph icon={CHECK_GLYPH} size={13} />
        </span>
        {uiCopy.store.cell.installStates.installed}
      </span>
    );
  }

  const busy = install.installingIds.has(item.id);
  return (
    <button
      type="button"
      id={`yunari-store-cell-${item.id}-install`}
      data-yunari-store-cell-install={state}
      disabled={busy}
      aria-busy={busy}
      onClick={() => install.onInstall(item)}
      className="inline-flex flex-none items-center gap-[var(--space-6)] rounded-md border border-edge bg-panel px-[var(--space-10)] py-[var(--space-4)] text-xs text-text disabled:text-faint"
    >
      <Glyph
        icon={state === "install" ? INSTALL_ITEM_GLYPH : EXPORT_ITEM_GLYPH}
        size={13}
      />
      {uiCopy.store.cell.installStates[state]}
    </button>
  );
}

/**
 * The picture box, and the theme's own ground behind it.
 *
 * **The box's shape is the theme's own ratio, and the row's tracks make the
 * heights agree** — every card in a row gets a width proportional to its ratio,
 * so width ÷ ratio is the same for all of them. The picture is contained, so
 * nothing is cropped and nothing is letterboxed.
 *
 * **A theme with no picture draws its ground, not a broken image.** The host
 * answers `404` at a theme's thumbnail address when it has stored none
 * (`server.ts`), so the address being present says nothing about the picture
 * being there: the box carries the ground from the first paint, and the `<img>`
 * that fails is dropped rather than left showing a browser's broken mark. With
 * no address at all the box is the ground alone.
 *
 * **What failed is the address and the theme's own time, not the box.** The host
 * builds the address from the theme's id (`theme-library-client.ts`), so it is
 * the same one across a re-listing and the address alone cannot say a picture
 * arrived; `updatedAt` is what a save changes. Keying on both means a cell whose
 * picture is replaced — a save that stores a thumbnail, a listing refreshed —
 * draws the new picture instead of the neutral box the old one left behind,
 * while a re-listing that changed nothing does not ask for a picture it already
 * knows is missing. A latched flag would be a cell that never shows a picture
 * again for as long as it is mounted.
 *
 * The image is `alt=""` because the cell names the theme beside it: a picture
 * repeating the name is read twice.
 */
function Picture(props: {
  readonly item: StoreItem;
  readonly ratio: number;
}): React.JSX.Element {
  const { item } = props;
  const picture =
    item.thumbnailUrl === undefined
      ? undefined
      : {
          url: item.thumbnailUrl,
          key: `${item.thumbnailUrl} ${item.updatedAt ?? ""}`,
        };
  const [broken, setBroken] = useState<string | undefined>(undefined);
  const showPicture = picture !== undefined && picture.key !== broken;

  return (
    <span
      data-yunari-store-picture=""
      aria-hidden
      className="relative block w-full overflow-hidden"
      style={{
        aspectRatio: props.ratio,
        ...(item.ground === undefined ? {} : { background: item.ground }),
      }}
    >
      {picture !== undefined && showPicture ? (
        <img
          src={picture.url}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-contain"
          onError={() => setBroken(picture.key)}
        />
      ) : null}
    </span>
  );
}

/**
 * The card's meta line: the day `updatedAt` names.
 *
 * The host sends an ISO-8601 instant and the UI prints a day, and the first ten
 * characters of ISO-8601 *are* that day in UTC — so no reader sees a different
 * one, which a locale-formatted date would give them. An entry with no time at
 * all (a template) leaves the line empty rather than inventing a day.
 */
function byline(item: StoreItem): string {
  return item.updatedAt?.slice(0, 10) ?? "";
}

/** The author's hover chip: `© Yunari`, or the no-author word where the
 *  document declares none — the same fact the byline used to carry. */
function authorChip(item: StoreItem): string {
  return item.author === undefined
    ? uiCopy.store.cell.noAuthor
    : `© ${item.author}`;
}
