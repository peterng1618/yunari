import type { CatalogueOrigin } from "@yunari/renderer-core";
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
  DELETE_ITEM_GLYPH,
  EXPORT_ITEM_GLYPH,
  Glyph,
  type LucideIcon,
  OPEN_ITEM_GLYPH,
  PUBLISH_ITEM_GLYPH,
  TWISTY_GLYPHS,
} from "../editor-shell/icons.js";
import {
  cardsOf,
  collectionStateOf,
  type StoreCard,
} from "../library-mode/cards.js";
import { uiCopy } from "../ui-copy.js";
import { Picture } from "./card-picture.js";
import {
  actionDisabledReason,
  actionsFor,
  carriesThemeDocument,
} from "./cell-actions.js";
import { InstallAction } from "./install-action.js";
import type { InstallControl } from "./install-item.js";
import { type InstallState, installStateOf } from "./install-state.js";
import { actionLabel } from "./item-foot.js";
import { justifiedRows } from "./justified-rows.js";
import type { CellAction, StoreItem, ThemeAction } from "./local-source.js";
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

/** One glyph per theme action, as a **total** lookup: an action added to the
 *  theme vocabulary without a mark fails to compile here rather than drawing a
 *  nameless square. The wider kinds' marks live on the item panel. */
const CELL_ACTION_GLYPHS: Readonly<Record<ThemeAction, LucideIcon>> = {
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
 *
 * **A listing is drawn as the cards its members make of it** (`cardsOf`): a
 * one-member listing is that member's card, a package of several is one pack
 * card whose members open in place, and a collection is its own card. The
 * expansion is the surface's — the library mode owns which packs are open — so
 * this grid only reads the set and reports a press.
 */
export function Gallery(props: {
  readonly items: readonly StoreItem[];
  /** The viewer's density level. The header's slider owns it; the grid only
   *  reads it, so the control and the packing cannot disagree. */
  readonly density: GridDensityLevel;
  readonly onAction: (action: CellAction, card: StoreCard) => void;
  /** Opens one item's own surface — the modal — which is the cell's own
   *  gesture rather than one of its four actions. */
  readonly onOpenItem: (card: StoreCard) => void;
  /** The online half's install press, which the region owns because the
   *  re-listing it causes is the listing's fact rather than a cell's. */
  readonly install: InstallControl;
  /** The local half's publish press, owned by the region for the same reason:
   *  a landed submission re-lists the library. Absent on a surface with no
   *  submission flow, which draws the four actions alone. */
  readonly submit?: SubmitControl | undefined;
  /** The pack cards this surface has open. Absent where the surface cannot
   *  open one, which draws no expand control and keeps the pack card's own
   *  install because its member cards are unreachable. */
  readonly expanded?: ReadonlySet<string> | undefined;
  /** Reports one pack card's press; the surface flips the key. */
  readonly onExpand?: ((key: string) => void) | undefined;
  /** This PC's origin register, read once by the surface. A collection's
   *  installed count is drawn from these records; a card never fetches a
   *  member's package to say how many it holds. Absent until the read answers,
   *  because an unread register must not draw as "0 installed". */
  readonly origins?: readonly CatalogueOrigin[] | undefined;
  /** Opens a collection's install sheet from its card's Install or Update.
   *  **A collection is never installed from its card**: the sheet owns the
   *  chosen set and the members' consent, so the card's press only asks for it. */
  readonly onOpenSheet?: ((card: StoreCard) => void) | undefined;
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
  // The cards of one listing stay together and in order: the pack card first,
  // then its members. A row still packs listings, because the pack's picture is
  // the listing's and that is the height the row justifies against.
  const grouped = new Map<string, readonly StoreCard[]>();
  for (const card of cardsOf(props.items)) {
    const listed = grouped.get(card.listing.id);
    grouped.set(
      card.listing.id,
      listed === undefined ? [card] : [...listed, card],
    );
  }

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
            {row.items.map(({ item }) => {
              const group = grouped.get(item.id) ?? [];
              const card =
                group.find((candidate) => candidate.member === undefined) ??
                group[0];
              if (card === undefined) return null;
              return (
                <Cell
                  key={card.key}
                  card={card}
                  members={group.filter((member) => member !== card)}
                  ratio={ratioOf(item)}
                  expanded={props.expanded?.has(card.key) ?? false}
                  {...(props.onExpand === undefined
                    ? {}
                    : { onExpand: props.onExpand })}
                  origins={props.origins}
                  onAction={props.onAction}
                  onOpenItem={props.onOpenItem}
                  install={props.install}
                  submit={props.submit}
                  {...(props.onOpenSheet === undefined
                    ? {}
                    : { onOpenSheet: props.onOpenSheet })}
                />
              );
            })}
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
  /** The card this cell draws: a listing's own card, or one member's card. */
  readonly card: StoreCard;
  /** The package's member cards, in order; empty when this cell is not a pack
   *  card. */
  readonly members: readonly StoreCard[];
  /** The theme's own width/height, which is the card's track weight and its
   *  picture's shape. */
  readonly ratio: number;
  readonly expanded: boolean;
  readonly onExpand?: ((key: string) => void) | undefined;
  /** The origin register, read once by the surface. A collection's count and
   *  state are read from these records; absent until the register answers,
   *  which leaves its count and action unstated rather than fabricated. */
  readonly origins: readonly CatalogueOrigin[] | undefined;
  readonly onAction: (action: CellAction, card: StoreCard) => void;
  readonly onOpenItem: (card: StoreCard) => void;
  readonly install: InstallControl;
  readonly submit?: SubmitControl | undefined;
  readonly onOpenSheet?: ((card: StoreCard) => void) | undefined;
}): React.JSX.Element {
  const { card, members, onAction, onOpenItem, install, submit } = props;
  const item = card.listing;
  const member = card.member;
  const catalogue = item.catalogue;
  // The left slot branches on whether the item has catalogue facts; the action
  // slot on the install decision. They read different facts on purpose: a
  // library item has no install state, and an online item always has a left slot.
  const installState = installStateOf(item);
  /** **A collection has no origin of its own**, so `installStateOf` cannot
   *  answer for it: `collectionStateOf` counts its `includes` against the
   *  register, and its action follows that state. Every other kind keeps
   *  `installStateOf` as the one owner. */
  const collection =
    props.origins === undefined
      ? undefined
      : collectionStateOf(item, props.origins);
  const actionState: InstallState | undefined =
    item.includes === undefined
      ? installState
      : collection === undefined
        ? undefined
        : collection.state === "installed"
          ? "installed"
          : collection.state === "partial"
            ? "update"
            : "install";
  const expandable = members.length > 0 && props.onExpand !== undefined;
  /** **A catalogue theme this PC installed keeps the four theme commands.** Its
   *  library copy is the row the host's `/api/themes` routes act on, and
   *  `installedId` is how the join named it; without them the only reading left
   *  would be the mark, and the copy could not be opened or removed.
   *
   *  **Only a copy at the catalogue's version is installed.** An older copy
   *  keeps the install reading instead, because the commands would hide the one
   *  press that brings it up to the catalogue. */
  const themeCommands =
    item.kind === "dashboard-theme" &&
    item.installedId !== undefined &&
    installState === "installed";
  /** A reason names the member's own kind where the card draws one, so a
   *  widget's card does not say a theme command is unavailable. */
  const actionKind = member?.kind ?? item.kind;
  /** **The command set is the kind's own four theme commands.** A cell never
   *  draws one the kind's table does not offer: an app theme has no Open or
   *  Assign, and a package's actions belong to the item's own surface. */
  const cellActions = CELL_ACTIONS.filter((action) =>
    actionsFor(actionKind).includes(action),
  );
  /** The command set is the library's four; the install reading is the online
   *  half's. A collection draws neither — its action is its install press — and
   *  a non-theme kind keeps its commands in the item's own surface. */
  const showThemeActions =
    item.includes === undefined &&
    carriesThemeDocument(actionKind) &&
    (installState === "none" || themeCommands);
  /** **A package's count is stated only where it can be opened**, so a grid with
   *  no expand handler does not advertise members nothing can show. A
   *  collection's count has no such dependency: it is its state. */
  const countText =
    collection !== undefined
      ? uiCopy.store.cell.pack.installed(collection.installed, collection.total)
      : expandable
        ? uiCopy.store.cell.pack.members(members.length)
        : undefined;
  const panelId = `yunari-store-members-${card.key}`;
  /** The publisher is the listing's own catalogue fact, and it is what a member
   *  card names under its member: a local theme has none and draws no line. */
  const publisher = catalogue?.publisher;
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
        onClick={() => onOpenItem(card)}
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
          onClick={() => onOpenItem(card)}
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
          {showThemeActions ? (
            <>
              {cellActions.map((action) => {
                const reason = actionDisabledReason(
                  action,
                  actionKind,
                  actionLabel(action, actionKind),
                  item,
                );
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
                      onClick={() => onAction(action, card)}
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
          ) : actionState === undefined ||
            actionState === "none" ||
            (member === undefined &&
              expandable) ? // **A pack card that can open is cover, count and expand only**:
          // its install controls live on the member cards, where the thing
          // being installed is named. **A pack card that cannot open keeps
          // its own install**, because a surface without an expand handler
          // leaves the hidden member cards unreachable. A collection's
          // action waits for the register rather than guessing "Install".
          null : (
            <InstallAction
              item={item}
              state={actionState}
              install={install}
              {...(item.includes === undefined
                ? {}
                : { onPress: () => props.onOpenSheet?.(card) })}
            />
          )}
        </div>
      </div>
      {publisher === undefined ? null : (
        <span
          data-yunari-store-cell-publisher=""
          className="min-w-0 truncate px-[var(--space-10)] pb-[var(--space-8)] text-2xs text-muted"
        >
          {publisher}
        </span>
      )}
      {/* **A member card names its member.** The line appears only where the
          member adds a reading the card's title and band do not already carry:
          a one-member theme repeats its own name, while a pack with one unit
          keeps the package's name and says which unit it is. */}
      {member === undefined ||
      (member.name === item.name && member.kind === item.kind) ? null : (
        <div
          data-yunari-store-cell-member=""
          className="flex min-w-0 items-center gap-[var(--space-6)] px-[var(--space-10)] pb-[var(--space-8)]"
        >
          <span
            data-yunari-store-cell-member-name=""
            className="min-w-0 truncate text-xs text-muted"
          >
            {member.name}
          </span>
          <span
            data-yunari-store-cell-member-kind=""
            className="flex-none rounded-full border border-edge px-[var(--space-8)] py-[var(--space-4)] text-2xs font-medium text-muted"
          >
            {uiCopy.store.cell.memberKinds[member.kind] ?? member.kind}
          </span>
        </div>
      )}
      {/* **A package states its size in words, and opens in place.** The count
          is text rather than a title attribute, because a tooltip is read by no
          touch screen; the twisty controls the panel below it and reports its
          own state through `aria-expanded`. */}
      {countText === undefined && !expandable ? null : (
        <div
          data-yunari-store-cell-members-row=""
          className="flex min-w-0 items-center gap-[var(--space-6)] px-[var(--space-10)] pb-[var(--space-10)]"
        >
          {countText === undefined ? null : (
            <span
              data-yunari-store-cell-members=""
              className="min-w-0 truncate text-xs text-muted"
            >
              {countText}
            </span>
          )}
          {expandable ? (
            <button
              type="button"
              data-yunari-store-cell-expand=""
              aria-expanded={props.expanded}
              aria-controls={panelId}
              onClick={() => props.onExpand?.(card.key)}
              className="flex flex-none items-center rounded-md border border-edge bg-panel p-[var(--space-4)] text-muted"
            >
              <Glyph
                icon={
                  props.expanded
                    ? TWISTY_GLYPHS.expanded
                    : TWISTY_GLYPHS.collapsed
                }
                size={12}
              />
              <span className="sr-only">
                {`${props.expanded ? uiCopy.store.cell.pack.collapse : uiCopy.store.cell.pack.expand}: ${item.name}`}
              </span>
            </button>
          ) : null}
        </div>
      )}
      {members.length === 0 ? null : (
        <div
          id={panelId}
          role="group"
          aria-label={uiCopy.store.cell.pack.panel(item.name)}
          hidden={!props.expanded}
          data-yunari-store-members=""
          className="border-t border-edge px-[var(--space-10)] py-[var(--space-8)]"
        >
          <ul className="flex flex-col gap-[var(--space-6)]">
            {members.map((memberCard) => (
              <MemberCard
                key={memberCard.key}
                card={memberCard}
                install={install}
                state={installState}
              />
            ))}
          </ul>
        </div>
      )}
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
                  {uiCopy.store.cell.memberKinds[item.kind] ?? item.kind}
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
 * One member of an open pack, drawn as a card rather than a table row: the
 * package's picture or ground identifies it, and the member carries its name,
 * its publisher, its kind badge and the install control for the package. Where
 * the pack card can open, the member cards are what install and the pack card
 * draws no install of its own.
 */
function MemberCard(props: {
  readonly card: StoreCard;
  readonly install: InstallControl;
  readonly state: InstallState;
}): React.JSX.Element {
  const { card, install, state } = props;
  const item = card.listing;
  const member = card.member;
  const publisher = item.catalogue?.publisher;

  return (
    <li
      data-yunari-store-member-card={card.key}
      className="flex min-w-0 items-center gap-[var(--space-8)] rounded-md border border-edge bg-panel p-[var(--space-6)]"
    >
      <span className="block w-16 flex-none overflow-hidden rounded-sm">
        <Picture item={item} ratio={2} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[var(--space-4)]">
        {member === undefined ? null : (
          <span
            data-yunari-store-member-name=""
            className="truncate text-xs font-medium text-text"
          >
            {member.name}
          </span>
        )}
        {publisher === undefined ? null : (
          <span
            data-yunari-store-member-publisher=""
            className="truncate text-2xs text-muted"
          >
            {publisher}
          </span>
        )}
        {member === undefined ? null : (
          <span
            data-yunari-store-member-kind=""
            className="self-start rounded-full border border-edge px-[var(--space-6)] py-[var(--space-4)] text-2xs text-muted"
          >
            {uiCopy.store.cell.memberKinds[member.kind] ?? member.kind}
          </span>
        )}
      </span>
      {state === "none" ? null : (
        <InstallAction
          item={item}
          state={state}
          install={install}
          controlKey={card.key}
        />
      )}
    </li>
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
