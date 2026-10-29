import type * as React from "react";
import { Fragment, useState } from "react";
import { ControlIconButton } from "../components/ui/control-icon-button.js";
import {
  ASSIGN_ITEM_GLYPH,
  CHECK_GLYPH,
  DELETE_ITEM_GLYPH,
  EXPORT_ITEM_GLYPH,
  Glyph,
  INSTALL_ITEM_GLYPH,
  type LucideIcon,
  OPEN_ITEM_GLYPH,
} from "../editor-shell/icons.js";
import { uiCopy } from "../ui-copy.js";
import { CELL_ACTION_REASONS } from "./cell-actions.js";
import type { InstallControl } from "./install-item.js";
import { type InstallState, installStateOf } from "./install-state.js";
import type { CellAction, StoreItem } from "./local-source.js";
import { StoreStatusBadge } from "./status-badge.js";

/**
 * The gallery: the cell, and the grid of them.
 *
 * It is handed its items and narrows nothing — A.5 owns what a query and a
 * facet selection filter, A.6 mounts it in the region and owns the empty states,
 * and the source it reads is A.4's. What is here is the cell's own geometry,
 * taken from the store-themes region.
 */

/** The four actions in its own order: open, assign, export, delete. */
const CELL_ACTIONS = [
  "open",
  "assign",
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

/**
 * The grid of cells.
 *
 * **`repeat(auto-fill, minmax(272px, 1fr))`, and the 272 is not this half's
 * number.** It is derived from the *online* half's busiest facts band — its
 * badge, its counts and its actions — so a person switching halves does not
 * watch the grid change shape; the layout states it and DESIGN.md's Layout
 * section carries it as a design-language value. `auto-fill` answers the column
 * count from the width, so there is no measured count and no breakpoint to keep
 * in step with the window.
 *
 * The four actions travel through one `onAction`, because a cell draws four and
 * a callback per action would be four props a caller can half-wire.
 */
export function Gallery(props: {
  readonly items: readonly StoreItem[];
  readonly onAction: (action: CellAction, id: string) => void;
  /** Opens one item's own surface — the modal — which is the cell's own
   *  gesture rather than one of its four actions. */
  readonly onOpenItem: (id: string) => void;
  /** The online half's install press, which the region owns because the
   *  re-listing it causes is the listing's fact rather than a cell's. */
  readonly install: InstallControl;
}): React.JSX.Element {
  return (
    <ul
      data-yunari-store-gallery=""
      className="grid grid-cols-[repeat(auto-fill,minmax(272px,1fr))] gap-[var(--space-12)]"
    >
      {props.items.map((item) => (
        <Cell
          key={item.id}
          item={item}
          onAction={props.onAction}
          onOpenItem={props.onOpenItem}
          install={props.install}
        />
      ))}
    </ul>
  );
}

/**
 * One item: its picture, its name, its byline and its facts band.
 *
 * The bands are fixed exactly — the picture at `2/1` with `object-fit:
 * cover`, the name, the mono byline, and the 26px band. **The band's left slot
 * has one occupant per half, and they are exclusive**: an online item draws the
 * kind badge and the download count, and a library item draws the origin pill
 * where the host holds a record of where the theme came from.
 */
function Cell(props: {
  readonly item: StoreItem;
  readonly onAction: (action: CellAction, id: string) => void;
  readonly onOpenItem: (id: string) => void;
  readonly install: InstallControl;
}): React.JSX.Element {
  const { item, onAction, onOpenItem, install } = props;
  const catalogue = item.catalogue;
  // The left slot branches on whether the item has catalogue facts; the action
  // slot on the install decision. They read different facts on purpose: a
  // library item has no install state, and an online item always has a left slot.
  const installState = installStateOf(item);
  const refusal =
    install.refusal?.id === item.id ? install.refusal.message : undefined;

  return (
    <li
      data-yunari-store-cell={item.id}
      className="flex flex-col overflow-hidden rounded-lg border border-edge bg-panel-2"
    >
      {/* **The cell's own surface is a control**. A button rather than a handler
          on the `li`, because the item's modal must be reachable without a
          mouse (the keyboard section) — and because a press on one of the four
          actions below must not open the item as well.

          **It is the picture and the name, and the byline is its sibling.** A
          button's own descendants are presentational, so a byline inside it
          would be reachable only through the button's name; beside it, the
          author and the date are still read, and the button's own name is the
          theme's.

          **The padding is the surface's own arithmetic, kept exactly** now that
          the surface, the byline and the facts band are three elements: the
          name's box pads the picture on three sides and stops 6px short of the
          byline, the byline stops 6 short of the band, and the band's wrapper
          carries the rest — so the name, the byline and the 26px band sit where
          they sat inside one padded column. */}
      <button
        type="button"
        data-yunari-store-cell-surface=""
        onClick={() => onOpenItem(item.id)}
        className="flex w-full flex-col text-left"
      >
        <Picture item={item} />
        {/* The name's box is this wrapper so the state's word can sit after the
            name without leaving the padded column: **the badge belongs to the
            name's line**, not to the facts band, which is one occupant per half
            and nothing about the author's store row. The padding is the
            surface's own arithmetic, kept on the wrapper. */}
        <span className="flex items-center gap-[var(--space-6)] p-[var(--space-10)] pb-[var(--space-6)]">
          <span
            data-yunari-store-cell-name=""
            className="truncate text-sm text-text"
          >
            {item.name}
          </span>
          <StoreStatusBadge status={item.status} />
        </span>
      </button>
      <span
        data-yunari-store-cell-byline=""
        className="truncate px-[var(--space-10)] pb-[var(--space-6)] font-mono text-xs text-muted"
      >
        {byline(item)}
      </span>
      <div className="px-[var(--space-10)] pb-[var(--space-10)]">
        {/* The band's own hook, because **what the badge sits in is the claim**:
            the layout puts it here rather than beside the name, so a case that
            only asked whether the badge exists would stay green through a move
            that changed the grid. */}
        <span
          data-yunari-store-cell-band=""
          className="flex h-[26px] items-center gap-[var(--space-6)]"
        >
          {/* **The left slot has one occupant per half** — the online cell's
              kind and count, or the library cell's origin pill — because the
              two derive from facts the other half does not have and fitting
              four readings in the band would change the grid's minimum shape.
              The origin pill is drawn only for a theme the host holds a record
              of: a theme the author made here came from nowhere, and a badge
              saying so would be a fact no record carries. */}
          {catalogue === undefined ? (
            item.origin === undefined ? null : (
              <span
                data-yunari-store-cell-origin=""
                className="flex-none rounded-full border border-edge bg-panel px-[var(--space-8)] py-[var(--space-4)] text-2xs font-medium text-muted"
              >
                {uiCopy.store.fromStore}
              </span>
            )
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
          <span className="flex-1" />
          {installState === "none" ? (
            /* **All four are drawn and the two a build does not run are
               disabled** (R164): the surface gives every cell four, and a
               control that looks live and answers a press with nothing is the
               defect the ruling answers. The reason travels beside the button
               rather than in a tooltip, because a disabled control is one the
               pointer cannot ask. */
            CELL_ACTIONS.map((action) => {
              const reason = CELL_ACTION_REASONS[action];
              const controlId = cellActionId(item.id, action);
              return (
                <Fragment key={action}>
                  <ControlIconButton
                    id={controlId}
                    label={uiCopy.store.cell.actions[action]}
                    disabled={reason !== undefined}
                    // `exactOptionalPropertyTypes` wants the prop omitted rather
                    // than handed `undefined`, and a button with a reason of its
                    // own must not describe itself by one it does not have.
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
            })
          ) : (
            <InstallAction item={item} state={installState} install={install} />
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
    </li>
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
function Picture(props: { readonly item: StoreItem }): React.JSX.Element {
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
      className="aspect-[2/1] w-full"
      style={
        item.ground === undefined ? undefined : { background: item.ground }
      }
    >
      {picture !== undefined && showPicture ? (
        <img
          src={picture.url}
          alt=""
          className="size-full object-cover"
          onError={() => setBroken(picture.key)}
        />
      ) : null}
    </span>
  );
}

/**
 * The mono line under the name: `@mira-k · 2026-10-15`, or its own
 * *No author* in the same slot — a fact about the theme rather than a missing
 * reading.
 *
 * The date is `updatedAt`'s day. The host sends an ISO-8601 instant and the
 * UI prints a day, and the first ten characters of ISO-8601 *are* that day
 * in UTC — so no reader sees a different one, which a locale-formatted date
 * would give them. An entry with no time at all (a template) prints the author
 * alone rather than a separator with nothing after it.
 */
function byline(item: StoreItem): string {
  const author =
    item.author === undefined ? uiCopy.store.cell.noAuthor : `@${item.author}`;
  const date = item.updatedAt?.slice(0, 10);
  return date === undefined || date === ""
    ? author
    : `${author}${uiCopy.store.readingSeparator}${date}`;
}
