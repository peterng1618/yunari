import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type * as React from "react";
import { Fragment } from "react";
import { ControlIconButton } from "../components/ui/control-icon-button.js";
import { ACTION_BUTTON, ActionBox } from "../components/ui/dialog.js";
import {
  ASSIGN_ITEM_GLYPH,
  CHECK_GLYPH,
  CLOSE_GLYPH,
  DELETE_ITEM_GLYPH,
  EXPORT_ITEM_GLYPH,
  Glyph,
  type LucideIcon,
  PENCIL_GLYPH,
} from "../editor-shell/icons.js";
import { uiCopy } from "../ui-copy.js";
import { CELL_ACTION_REASONS } from "./cell-actions.js";
import type { InstallControl } from "./install-item.js";
import { type InstallState, installStateOf } from "./install-state.js";
import type { CellAction, StoreItem } from "./local-source.js";
import { StoreStatusBadge } from "./status-badge.js";
import type { SubmitControl } from "./use-submit.js";

/**
 * The item's own surface: the modal a cell opens (`store-detail.html`).
 *
 * **It is a viewer first.** The box is 960 × 760 against the settings sheet's
 * 560, with no title bar: the stage takes every pixel the 270px facts panel does
 * not, and the theme is contained in it rather than the stage being sized to the
 * theme. The box therefore keeps one height as a person steps between items — the
 * one thing a viewer must not do — and a portrait artboard is still seen
 * uncropped.
 *
 * **The facts and the commands are a right panel, not a band.** A band under the
 * stage spends the theme's own height on four words; a 270px column spends width
 * the preview can spare. The panel stacks the pills tight, the provenance under
 * them, and holds the four commands at its foot.
 *
 * **One modal for every kind.** `kind` is the seam the storefront reads, so what
 * changes with the kind is which pills appear and which actions the foot offers —
 * the online half carries Install, Installed or Update in place of the library's
 * grid, and the library's foot carries Submit to the store above it.
 */

/**
 * The panel foot's four commands, in the drawing's order. Each is one glyph and
 * one word, and the words are this surface's short set
 * (`uiCopy.store.item.actions`): four boxes share 270px, and the cell keeps its
 * longer words. Delete is the one that destroys; §4's mark paints its glyph and
 * word `--hot` and the shell's own selector refuses to paint it when disabled.
 *
 * **`open` leaves this surface alone.** It loads the stored theme as the editor's
 * document, which is a fact about the document rather than about the item: the
 * region's `openId` is what says whether this modal is on screen.
 */
const ACTION_BOXES = [
  { action: "delete", icon: DELETE_ITEM_GLYPH, destructive: true },
  { action: "export", icon: EXPORT_ITEM_GLYPH, destructive: false },
  { action: "assign", icon: ASSIGN_ITEM_GLYPH, destructive: false },
  { action: "open", icon: PENCIL_GLYPH, destructive: false },
] as const satisfies readonly {
  readonly action: CellAction;
  readonly icon: LucideIcon;
  readonly destructive: boolean;
}[];

/** §5's dialog button, for the foot's wider controls (Install, Submit, the
 *  author's command). The four boxes are `ActionBox`. */
const FOOTER_BUTTON = `${ACTION_BUTTON} disabled:text-faint`;

/** The counts' reader: `en-US` because `uiCopy` is one English table — the
 *  drawing's `1,204`, not the machine's. */
const CATALOGUE_COUNT = new Intl.NumberFormat("en-US");

/** One pill: the drawing's `--panel-2` inside a 1px `--edge` at a full radius.
 *  `mono` is the size's own treatment, and **a proposed pill is that same box
 *  dashed and in `--muted`** (`store-detail.html`). */
function Pill(props: {
  readonly id: string;
  readonly name: string;
  readonly mono: boolean;
  readonly proposed: boolean;
}): React.JSX.Element {
  return (
    <span
      data-yunari-store-item-pill={props.id}
      className={`rounded-full border bg-panel-2 px-[var(--space-10)] py-[var(--space-4)] text-xs font-medium ${
        props.proposed
          ? "border-dashed border-edge text-muted"
          : "border-edge text-text"
      } ${props.mono ? "font-mono" : ""}`}
    >
      {props.name}
    </span>
  );
}

/** One group: §2's eyebrow over its pills. A group with no pills is not drawn at
 *  all — a heading over nothing is a word that says nothing (§9). */
function PillGroup(props: {
  readonly id: string;
  readonly name: string;
  readonly pills: readonly {
    readonly id: string;
    readonly name: string;
    readonly mono: boolean;
    readonly proposed: boolean;
  }[];
}): React.JSX.Element | null {
  if (props.pills.length === 0) return null;
  return (
    <span
      data-yunari-store-item-group={props.id}
      className="flex flex-col gap-[var(--space-6)]"
    >
      <span
        data-yunari-store-item-group-name=""
        className="text-2xs font-semibold tracking-[0.11em] text-faint uppercase"
      >
        {props.name}
      </span>
      <span className="flex flex-wrap gap-[var(--space-6)]">
        {props.pills.map((pill) => (
          <Pill
            key={pill.id}
            id={pill.id}
            name={pill.name}
            mono={pill.mono}
            proposed={pill.proposed}
          />
        ))}
      </span>
    </span>
  );
}

/** One reading on a pill: the id a driver reads and the word a person does. */
interface Reading {
  readonly id: string;
  readonly name: string;
  readonly mono: boolean;
  readonly proposed: boolean;
}

/** The Shape group's readings, in the drawing's order. **An unclassified theme
 *  draws no colour-mode pill**: `unclassified` is the absence of an answer
 *  rather than an answer (R117). */
function shapeReadings(item: StoreItem): readonly Reading[] {
  const { colourMode, orientation, aspect, width, height } = item.facets;
  const readings: Reading[] = [];
  if (colourMode !== "unclassified") {
    readings.push({
      id: colourMode,
      name: uiCopy.store.colourModes[colourMode],
      mono: false,
      proposed: false,
    });
  }
  readings.push(
    {
      id: orientation,
      name: uiCopy.store.orientations[orientation],
      mono: false,
      proposed: false,
    },
    {
      id: aspect,
      name: aspect === "other" ? uiCopy.store.otherShape : aspect,
      mono: false,
      proposed: false,
    },
    {
      id: `${width}x${height}`,
      name: uiCopy.store.size(width, height),
      mono: true,
      proposed: false,
    },
  );
  return readings;
}

/** The Style group's readings: one pill per tag, and a tag the vocabulary does
 *  not hold says so on its own pill. `vocabulary` is the settled set the region
 *  hands down (`settledTags`), not a second reading of the listing. */
function styleReadings(
  item: StoreItem,
  vocabulary: readonly string[],
): readonly Reading[] {
  const settled = new Set(vocabulary);
  return item.facets.tags.map((tag) => {
    const proposed = !settled.has(tag);
    return {
      id: tag,
      name: proposed ? uiCopy.panels.tagsProposed(tag) : tag,
      mono: false,
      proposed,
    };
  });
}

/** The stage's own reading: the size the theme is drawn at, then the fit verb
 *  (`store-detail.html`). A size this record cannot read draws **no caption**, not
 *  `0 × 0` — a measurement of nothing is not a reading. */
function stageReading(item: StoreItem): string | undefined {
  const { width, height } = item.facets;
  if (!(width > 0 && height > 0)) return undefined;
  return `${width} × ${height}${uiCopy.store.readingSeparator}${uiCopy.assets.preview.fit}`;
}

/** The panel's head: the name, the state and the kind on one row with the way
 *  out; the author and the version-date pair on the next. The catalogue's counts
 *  join that pair — facts about the item rather than about any facet. */
function PanelHeader(props: {
  readonly item: StoreItem;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { item } = props;
  // The first ten characters of an ISO-8601 instant *are* its UTC day, so no
  // reader sees a different one; a locale-formatted date would give two readers
  // two days (`gallery.tsx`).
  const day = item.updatedAt?.slice(0, 10);
  // The separator belongs to the pair rather than to either reading: a theme
  // with no version draws no separator and no empty slot (R128).
  const stamp: { readonly key: string; readonly node: React.ReactNode }[] = [];
  if (item.version !== undefined && item.version !== "") {
    stamp.push({ key: "version", node: item.version });
  }
  if (day !== undefined && day !== "") {
    stamp.push({ key: "date", node: day });
  }
  if (item.catalogue !== undefined) {
    const { downloads, favorites } = item.catalogue;
    stamp.push(
      {
        key: "downloads",
        node: (
          <>
            {CATALOGUE_COUNT.format(downloads)}
            <span className="sr-only">
              {` ${uiCopy.store.counts.downloads(downloads)}`}
            </span>
          </>
        ),
      },
      {
        key: "favorites",
        node: (
          <>
            {CATALOGUE_COUNT.format(favorites)}
            <span className="sr-only">
              {` ${uiCopy.store.counts.favorites(favorites)}`}
            </span>
          </>
        ),
      },
    );
  }
  return (
    <span className="flex flex-none flex-col gap-[var(--space-6)] border-b border-edge pt-[var(--space-14)] pr-[var(--space-16)] pb-[var(--space-12)] pl-[var(--space-16)]">
      <span className="flex min-w-0 items-center gap-[var(--space-8)]">
        <span
          data-yunari-store-item-name=""
          className="min-w-0 truncate text-lg font-semibold text-text"
        >
          {item.name}
        </span>
        {/* A Mine row's own state, absent on the public listing. */}
        <StoreStatusBadge status={item.status} />
        <span
          data-yunari-store-item-kind=""
          className="flex-none rounded-full border border-edge px-[var(--space-8)] py-[var(--space-4)] text-2xs font-medium text-muted"
        >
          {/* A kind this build does not know prints its own identifier. */}
          {uiCopy.store.cell.kinds[item.kind] ?? item.kind}
        </span>
        <span className="flex-1" />
        <span className="flex-none">
          <ControlIconButton
            id="yunari-store-item-close"
            label={uiCopy.store.item.close}
            data={{ "data-yunari-store-item-close": "" }}
            onClick={props.onClose}
          >
            <Glyph icon={CLOSE_GLYPH} size={14} />
          </ControlIconButton>
        </span>
      </span>
      <span className="flex items-center gap-[var(--space-8)]">
        <span
          data-yunari-store-item-author=""
          className="min-w-0 truncate font-mono text-xs text-muted"
        >
          {item.author === undefined
            ? uiCopy.store.cell.noAuthor
            : `@${item.author}`}
        </span>
        <span className="flex-1" />
        {stamp.length === 0 ? null : (
          <span
            data-yunari-store-item-date=""
            className="flex-none font-mono text-2xs text-faint"
          >
            {stamp.map((part, index) => (
              <Fragment key={part.key}>
                {index === 0 ? null : uiCopy.store.readingSeparator}
                {part.node}
              </Fragment>
            ))}
          </span>
        )}
      </span>
    </span>
  );
}

/** The panel's scrolling body: the three pill groups, the remix credit, the
 *  state's sentence and the provenance under a hairline. */
function PanelBody(props: {
  readonly item: StoreItem;
  readonly vocabulary: readonly string[];
  readonly statusNote: string | undefined;
  readonly remixParent: StoreItem | undefined;
  readonly onOpenItem: ((id: string) => void) | undefined;
}): React.JSX.Element {
  const { item, remixParent, onOpenItem, statusNote } = props;
  const remixOf = item.remixOf;
  return (
    <span className="flex min-h-0 flex-1 flex-col gap-[var(--space-12)] overflow-auto px-[var(--space-16)] py-[var(--space-12)]">
      <PillGroup
        id="reads"
        name={uiCopy.store.pillGroups.reads}
        // A sensor pill carries the descriptor's own `label`, which is what a
        // person reads; the `key` it filters by is not this group's.
        pills={item.facets.sensors.map((sensor) => ({
          id: sensor.key,
          name: sensor.label,
          mono: false,
          proposed: false,
        }))}
      />
      <PillGroup
        id="shape"
        name={uiCopy.store.pillGroups.shape}
        pills={shapeReadings(item)}
      />
      {/* `PillGroup` draws no heading over no pills, so an untagged theme draws
          two groups rather than an empty third. */}
      <PillGroup
        id="style"
        name={uiCopy.store.pillGroups.style}
        pills={styleReadings(item, props.vocabulary)}
      />
      {/* The credit a remixed item carries: a control only when the listing
          resolved the parent, plain text otherwise. */}
      {remixOf === undefined ? null : (
        <span className="text-xs text-faint">
          {remixParent === undefined || onOpenItem === undefined ? (
            <span data-yunari-store-item-remix="">
              {uiCopy.store.item.remixedFrom(remixOf.name)}
            </span>
          ) : (
            <button
              type="button"
              data-yunari-store-item-remix=""
              onClick={() => onOpenItem(remixParent.id)}
              className="text-xs text-faint underline"
            >
              {uiCopy.store.item.remixedFrom(remixOf.name)}
            </button>
          )}
        </span>
      )}
      {/* **What the state means, where the badge is only a word.** */}
      {item.status === "pending" ? (
        <span
          data-yunari-store-item-status-note=""
          className="text-xs text-muted"
        >
          {uiCopy.store.status.pendingReview}
        </span>
      ) : null}
      {statusNote === undefined ? null : (
        <span
          data-yunari-store-item-status-note=""
          className="text-xs text-warn"
        >
          {statusNote}
        </span>
      )}
      {/* **The provenance strip, which is what a cell has no room for.** Only
          the origin clause is drawn: *Shows on …* is an assignment fact no item
          carries yet. The version here is the installed one, not the caption's
          document version — the two can differ. */}
      {item.origin === undefined ? null : (
        <span
          data-yunari-store-item-origin=""
          className="flex flex-col gap-[var(--space-4)] border-t border-edge-2 pt-[var(--space-6)] text-2xs text-faint"
        >
          {[
            uiCopy.store.fromStore,
            item.origin.catalogueId,
            item.origin.version,
          ].join(uiCopy.store.readingSeparator)}
        </span>
      )}
    </span>
  );
}

/**
 * The online half's foot reading: one of the drawing's three answers in place of
 * the library's four boxes (`store-detail.html`).
 *
 * **Installed is a mark, not a control** — there is nothing to do. The check
 * carries the rationed accent and the word stays `--muted`, as the cell draws
 * it. **Install and Update post the item to the host**, disable themselves while
 * the press is in flight, and state the host's refusal beside the control.
 */
function InstallFooter(props: {
  readonly item: StoreItem;
  readonly state: Exclude<InstallState, "none">;
  readonly install: InstallControl;
}): React.JSX.Element {
  const { item, state, install } = props;

  if (state === "installed") {
    return (
      <span
        data-yunari-store-item-install={state}
        className="flex items-center gap-[var(--space-6)] text-sm text-muted"
      >
        <span className="flex-none text-accent">
          <Glyph icon={CHECK_GLYPH} size={14} />
        </span>
        {uiCopy.store.cell.installStates.installed}
      </span>
    );
  }

  const busy = install.installingIds.has(item.id);
  const refusal =
    install.refusal?.id === item.id ? install.refusal.message : undefined;
  return (
    <Fragment>
      <button
        type="button"
        id="yunari-store-item-install"
        data-yunari-store-item-install={state}
        disabled={busy}
        aria-busy={busy}
        onClick={() => install.onInstall(item)}
        className={FOOTER_BUTTON}
      >
        {uiCopy.store.cell.installStates[state]}
      </button>
      {refusal === undefined ? null : (
        <span
          data-yunari-store-item-install-refusal=""
          className="max-w-[40ch] text-xs text-warn"
        >
          {refusal}
        </span>
      )}
    </Fragment>
  );
}

/**
 * The library half's submission: the one control that hands the theme to the
 * store, beside the four actions that keep it on this PC.
 *
 * **The flow can be longer than a press**, so the control states what a person
 * has to do next: finish signing in, the status and version once it lands, and
 * the host's own refusal otherwise.
 */
function SubmitFooter(props: {
  readonly item: StoreItem;
  readonly submit: SubmitControl;
}): React.JSX.Element {
  const { item, submit } = props;
  // **Only this item's own answer is drawn**, on the same rule the install
  // footer follows: the flow lives on the region and outlives the modal.
  const mine = submit.itemId === item.id;
  const state = mine ? submit.state : "idle";
  const version = mine ? submit.version : undefined;
  const refusal = mine ? submit.refusal : undefined;
  const status = mine ? submit.status : undefined;
  // **A flow on another item disables this one too.** The region holds one flow
  // at a time, and a press here would meet that guard and do nothing.
  const busy =
    submit.inFlight || state === "submitting" || state === "authorising";
  const submitted = state === "submitted";
  return (
    <Fragment>
      <button
        type="button"
        id="yunari-store-item-submit"
        data-yunari-store-item-submit={state}
        disabled={busy || submitted}
        aria-busy={busy}
        onClick={() => submit.onSubmit(item)}
        className={FOOTER_BUTTON}
      >
        {state === "authorising"
          ? uiCopy.store.submit.authorising
          : busy
            ? uiCopy.store.submit.busy
            : uiCopy.store.submit.label}
      </button>
      {submitted && status !== undefined ? (
        <span className="flex max-w-[40ch] flex-col gap-[var(--space-4)] text-xs text-muted">
          <span>{uiCopy.store.submit.submitted(status)}</span>
          {/* **The version and the state it landed in**: the level is the host's
              answer to what changed, the status word the store's answer to what
              happens next. */}
          <span className="flex flex-wrap items-center gap-[var(--space-4)]">
            {version === undefined ? null : (
              <span data-yunari-store-item-submit-version="">
                {uiCopy.store.submit.version(version)}
              </span>
            )}
            <span
              data-yunari-store-item-submit-status={status}
              className="font-medium"
            >
              {status === "pending"
                ? uiCopy.store.status.pending
                : uiCopy.store.status.published}
            </span>
          </span>
        </span>
      ) : null}
      {state === "refused" && refusal !== undefined ? (
        <span
          data-yunari-store-item-submit-refusal=""
          className="max-w-[40ch] text-xs text-warn"
        >
          {refusal}
        </span>
      ) : null}
    </Fragment>
  );
}

/** The panel's foot: the author's command and the submission above the library's
 *  2×2 boxes, or the online half's install reading in their place. The two boxes
 *  a build does not run are drawn disabled (R164) with their reason in the tree
 *  beside them: a disabled control is one the pointer cannot ask, so a tooltip
 *  would reach nobody. */
function PanelFoot(props: {
  readonly item: StoreItem;
  readonly install: InstallControl;
  readonly submit: SubmitControl;
  readonly onAction: (action: CellAction, id: string) => void;
  readonly authorAction: "unpublish" | "republish" | undefined;
  readonly authorPress: ((id: string) => void) | undefined;
}): React.JSX.Element {
  const { item, install, submit, onAction, authorAction, authorPress } = props;
  const installState = installStateOf(item);
  const hasCommands = authorAction !== undefined || installState === "none";
  return (
    <span className="flex flex-none flex-col gap-[var(--space-8)] border-t border-edge px-[var(--space-16)] py-[var(--space-12)]">
      {hasCommands ? (
        <span className="flex flex-wrap items-center gap-[var(--space-8)]">
          {authorAction === undefined ? null : (
            <button
              type="button"
              id={`yunari-store-item-${authorAction}`}
              data-yunari-store-item-status-action={authorAction}
              onClick={() => authorPress?.(item.id)}
              className={FOOTER_BUTTON}
            >
              {uiCopy.store.actions[authorAction]}
            </button>
          )}
          {installState === "none" ? (
            <SubmitFooter item={item} submit={submit} />
          ) : null}
        </span>
      ) : null}
      {installState !== "none" ? (
        <InstallFooter item={item} state={installState} install={install} />
      ) : (
        <>
          <span className="grid grid-cols-2 gap-[var(--space-6)]">
            {ACTION_BOXES.map((box) => {
              const reason = CELL_ACTION_REASONS[box.action];
              const controlId = `yunari-store-item-${box.action}`;
              return (
                <ActionBox
                  key={box.action}
                  id={controlId}
                  data={{ "data-yunari-store-item-action": box.action }}
                  icon={box.icon}
                  label={uiCopy.store.item.actions[box.action]}
                  {...(box.destructive ? { destructive: true } : {})}
                  disabled={reason !== undefined}
                  {...(reason === undefined
                    ? {}
                    : { describedById: `${controlId}-reason` })}
                  onClick={() => onAction(box.action, item.id)}
                />
              );
            })}
          </span>
          {ACTION_BOXES.map((box) => {
            const reason = CELL_ACTION_REASONS[box.action];
            return reason === undefined ? null : (
              <span
                key={box.action}
                id={`yunari-store-item-${box.action}-reason`}
                className="sr-only"
              >
                {reason}
              </span>
            );
          })}
        </>
      )}
    </span>
  );
}

export function ItemModal(props: {
  readonly item: StoreItem;
  /** The style tags the vocabulary holds, built from the listing by the surface
   *  that owns it (`settledTags`) — this modal reads the set and never the
   *  listing, so it cannot become a second source of truth about the library. */
  readonly vocabulary: readonly string[];
  readonly onClose: () => void;
  /** The one callback the cell's four actions travel through. The modal draws
   *  the same four, so it reports them the same way rather than owning a second
   *  answer to "what does this action mean". */
  readonly onAction: (action: CellAction, id: string) => void;
  /** The online half's install press, owned by the region because the re-listing
   *  it causes is the listing's fact rather than any surface's. */
  readonly install: InstallControl;
  /** The library half's submission, owned by the region for the same reason:
   *  the sign-in outlives the press that started it. */
  readonly submit: SubmitControl;
  /** Opens another item's modal — the region's own open state, which is what
   *  moves the surface from a remix to the parent it credits. */
  readonly onOpenItem?: (id: string) => void;
  /** The parent the listing resolved for this item's credit, when it holds
   *  one. A resolved `StoreItem`, never an id. */
  readonly remixParent?: StoreItem;
  /** The author's own commands on the store row, drawn only for the state that
   *  allows each (`status-badge.tsx`). The region posts and re-reads the
   *  author's listing; this surface only reports the press. */
  readonly onUnpublish?: (id: string) => void;
  readonly onRepublish?: (id: string) => void;
}): React.JSX.Element {
  const { item, onClose, onAction, install, submit } = props;
  // The one command a state allows, only where the region wired it.
  const authorAction =
    item.status === "published" && props.onUnpublish !== undefined
      ? ("unpublish" as const)
      : item.status === "unpublished" && props.onRepublish !== undefined
        ? ("republish" as const)
        : undefined;
  const authorPress =
    authorAction === "unpublish"
      ? props.onUnpublish
      : authorAction === "republish"
        ? props.onRepublish
        : undefined;
  // What the state means: the owner's reason where the store gave one, and —
  // for a removed row — that it cannot come back, whether or not a reason exists.
  const statusNote =
    item.status === "rejected"
      ? item.statusReason
      : item.status === "removed"
        ? item.statusReason === undefined
          ? uiCopy.store.status.removedPermanent
          : `${item.statusReason} ${uiCopy.store.status.removedPermanent}`
        : undefined;
  const reading = stageReading(item);

  return (
    <DialogPrimitive.Root
      defaultOpen
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        {/* The shell's own scrim; the box below is this surface's, because a
            picture's modal is not the text sheet `.editor-shell-dialog`
            describes. */}
        <DialogPrimitive.Backdrop className="editor-shell-dialog-overlay" />
        <DialogPrimitive.Popup
          data-yunari-store-item=""
          aria-label={item.name}
          className="fixed top-1/2 left-1/2 z-[71] flex h-[var(--store-item-height)] max-h-[90vh] w-[960px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[var(--radius-lg)] border border-edge bg-panel text-sm text-text shadow-[var(--elev-3)]"
        >
          {/* The stage: **every pixel the panel does not take**, and the box's
              own height, so the modal does not move as a person steps between
              items. Its ground is the viewer's fixed dark rather than a second
              dark surface with its own reason. */}
          <span
            data-yunari-store-item-stage=""
            className="relative flex min-w-0 flex-1 items-center justify-center p-[var(--space-20)] [background:var(--store-item-stage)] [container-type:size]"
          >
            {/* The picture at the theme's own ratio, contained in the stage's
                content box: the two `min()`s pick the limiting side, so a wide
                theme is capped by width and a tall one by height without either
                being stretched. */}
            <span
              data-yunari-store-item-picture=""
              className="overflow-hidden rounded-[var(--radius-md)]"
              style={{
                width: `min(100cqw, calc(100cqh * ${item.facets.width} / ${item.facets.height}))`,
                height: `min(100cqh, calc(100cqw * ${item.facets.height} / ${item.facets.width}))`,
                ...(item.ground === undefined
                  ? {}
                  : { background: item.ground }),
              }}
            >
              {item.thumbnailUrl === undefined ? null : (
                <img
                  src={item.thumbnailUrl}
                  alt=""
                  className="size-full object-contain"
                />
              )}
            </span>
            {reading === undefined ? null : (
              <span
                data-yunari-store-item-caption=""
                className="absolute bottom-[var(--space-12)] left-[var(--space-16)] rounded-[var(--radius-sm)] bg-panel/90 px-[var(--space-8)] py-[var(--space-4)] font-mono text-2xs text-muted"
              >
                {reading}
              </span>
            )}
          </span>

          <span
            data-yunari-store-item-panel=""
            className="flex w-[var(--store-item-panel-width)] flex-none flex-col border-l border-edge bg-panel"
          >
            <PanelHeader item={item} onClose={onClose} />
            <PanelBody
              item={item}
              vocabulary={props.vocabulary}
              statusNote={statusNote}
              remixParent={props.remixParent}
              onOpenItem={props.onOpenItem}
            />
            <PanelFoot
              item={item}
              install={install}
              submit={submit}
              onAction={onAction}
              authorAction={authorAction}
              authorPress={authorPress}
            />
          </span>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
