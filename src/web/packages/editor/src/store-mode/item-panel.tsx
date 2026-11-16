import type { InstalledExtension } from "@yunari/extension-api";
import type * as React from "react";
import { Fragment } from "react";
import { ControlIconButton } from "../components/ui/control-icon-button.js";
import { CLOSE_GLYPH, Glyph } from "../editor-shell/icons.js";
import type { StoreCard } from "../library-mode/cards.js";
import { uiCopy } from "../ui-copy.js";
import { isCodeKind } from "./cell-actions.js";
import {
  canShowTrust,
  type DetailPlanState,
  extensionTrustOf,
  MemberList,
  memberRowsOf,
  PlanStateNote,
  planTrust,
  TrustBlock,
} from "./item-detail.js";
import type { StoreItem } from "./local-source.js";
import { StoreStatusBadge } from "./status-badge.js";

/**
 * A member's facts panel: its head and its scrolling body. The foot is
 * `item-foot.tsx`, because the commands a kind offers are a different reading
 * from the facts it carries.
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
 * the preview can spare.
 */

/** The counts' reader: `en-US` because `uiCopy` is one English table — the
 *  UI's `1,204`, not the machine's. */
const CATALOGUE_COUNT = new Intl.NumberFormat("en-US");

/** One pill: the `--panel-2` inside a 1px `--edge` at a full radius.
 *  `mono` is the size's own treatment, and **a proposed pill is that same box
 *  dashed and in `--muted`**. */
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

/** One group: the eyebrow over its pills. A group with no pills is not drawn at
 *  all — a heading over nothing is a word that says nothing. */
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
        className="text-2xs font-semibold tracking-[0.11em] text-muted uppercase"
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

/** The Shape group's readings, in the order. **An unclassified theme
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

/** The panel's head: the name, the state and the kind on one row with the way
 *  out; the author and the version-date pair on the next. The catalogue's counts
 *  join that pair — facts about the item rather than about any facet. */
export function PanelHeader(props: {
  readonly item: StoreItem;
  /** The member's kind when the card is one, otherwise the listing's. */
  readonly kind: string;
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
        <span
          data-yunari-store-item-kind=""
          className="flex-none rounded-full border border-edge px-[var(--space-8)] py-[var(--space-4)] text-2xs font-medium text-muted"
        >
          {/* A member's own kind word, then the listing kind's word, then the
              identifier itself for a kind this build does not ship. */}
          {uiCopy.store.cell.memberKinds[props.kind] ?? props.kind}
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
        {/* The stamp gives way before the row does: `min-w-0 truncate` lets it
            shrink inside the 238px content width, and because the counts sit
            last the ellipsis takes them before the version and date. */}
        {stamp.length === 0 ? null : (
          <span
            data-yunari-store-item-date=""
            className="min-w-0 truncate font-mono text-2xs text-faint"
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

/** What the item's state means: the owner's reason where the store gave one,
 *  and — for a removed row — that it cannot come back, whether or not a reason
 *  exists. */
function statusNoteOf(item: StoreItem): string | undefined {
  if (item.status === "rejected") return item.statusReason;
  if (item.status !== "removed") return undefined;
  return item.statusReason === undefined
    ? uiCopy.store.status.removedPermanent
    : `${item.statusReason} ${uiCopy.store.status.removedPermanent}`;
}

/** The panel's scrolling body: the pill groups, the member links, the
 *  collections the item belongs to, a code member's trust block, the remix
 *  credit, the state's sentence and the provenance under a hairline. */
export function PanelBody(props: {
  readonly item: StoreItem;
  readonly kind: string;
  readonly vocabulary: readonly string[];
  readonly remixParent: StoreItem | undefined;
  readonly onOpenItem: ((card: StoreCard) => void) | undefined;
  /** Opens a collection that includes this item; absent where the surface's
   *  open state cannot hold it, which draws the name as text. */
  readonly onOpenCollection: ((card: StoreCard) => void) | undefined;
  readonly plan: DetailPlanState | undefined;
  readonly onRetryPlan: () => void;
  readonly extension: InstalledExtension | undefined;
  /** The extension listing's read failed. A failure is not "this plugin is not
   *  installed", so the block states it and offers the read again. */
  readonly trustFailure: { readonly onRetry: () => void } | undefined;
  readonly collections: readonly StoreItem[];
  /** The collections read failed, so membership is unknown rather than empty. */
  readonly collectionsFailure:
    | { readonly message: string; readonly onRetry: () => void }
    | undefined;
  readonly collectionsLoading: boolean;
  readonly onOpenSettings: ((page: "extensions") => void) | undefined;
}): React.JSX.Element {
  const { item, kind, remixParent, onOpenItem, plan, extension } = props;
  const remixOf = item.remixOf;
  const statusNote = statusNoteOf(item);
  const rows = memberRowsOf(item, kind, plan);
  // A theme is one member of itself, so the list would print the item's own
  // name under its own name. A package or a collection has members worth
  // naming; a single-member listing is already the header's name.
  const showMembers =
    kind === "collection" || (rows !== undefined && rows.length > 1);
  const planEntries = planTrust(plan);
  const trustEntries =
    planEntries ??
    (extension === undefined ? undefined : [extensionTrustOf(extension)]);
  const showsTrust =
    kind === "collection" || isCodeKind(kind) || item.kind === "plugin";
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
      {kind === "collection" ? (
        <PlanStateNote plan={plan} onRetry={props.onRetryPlan} />
      ) : null}
      {!showMembers || rows === undefined ? null : <MemberList rows={rows} />}
      {kind === "collection" &&
      plan?.status === "ready" &&
      plan.plan.missing.length > 0 ? (
        <span
          data-yunari-store-detail-missing=""
          className="flex flex-col gap-[var(--space-4)]"
        >
          {plan.plan.missing.map((member) => (
            <span key={member.id} className="text-xs text-warn">
              {uiCopy.store.detail.plan.missingMember(member.id, member.reason)}
            </span>
          ))}
        </span>
      ) : null}
      {props.collectionsFailure === undefined ? (
        props.collectionsLoading ? (
          <span
            data-yunari-store-detail-part-of-state="loading"
            className="text-xs text-muted"
          >
            {uiCopy.store.detail.partOfLoading}
          </span>
        ) : props.collections.length === 0 ? null : (
          <span
            data-yunari-store-detail-part-of=""
            className="flex flex-col gap-[var(--space-6)]"
          >
            <span className="text-2xs font-semibold tracking-[0.11em] text-muted uppercase">
              {uiCopy.store.detail.partOf}
            </span>
            <span className="flex flex-wrap gap-[var(--space-6)]">
              {props.collections.map((collection) => (
                <span
                  key={collection.id}
                  data-yunari-store-detail-collection={collection.id}
                  className="text-xs text-muted"
                >
                  {props.onOpenCollection === undefined ? (
                    collection.name
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        props.onOpenCollection?.({
                          key: collection.id,
                          listing: collection,
                          member: undefined,
                        })
                      }
                      className="underline hover:text-text"
                    >
                      {collection.name}
                    </button>
                  )}
                </span>
              ))}
            </span>
          </span>
        )
      ) : (
        <span
          data-yunari-store-detail-part-of-state="failed"
          className="flex flex-col items-start gap-[var(--space-4)] text-xs text-warn"
        >
          {props.collectionsFailure.message}
          <button
            type="button"
            data-yunari-store-detail-collections-retry=""
            onClick={props.collectionsFailure.onRetry}
            className="text-xs text-accent underline hover:text-text"
          >
            {uiCopy.store.retry}
          </button>
        </span>
      )}
      {showsTrust && canShowTrust(kind, plan) ? (
        <span className="flex flex-col gap-[var(--space-6)]">
          {props.trustFailure !== undefined ? (
            <span
              data-yunari-store-detail-trust-state="failed"
              className="flex flex-col items-start gap-[var(--space-4)] text-xs text-warn"
            >
              {uiCopy.store.detail.trust.unreadable}
              <button
                type="button"
                data-yunari-store-detail-trust-retry=""
                onClick={props.trustFailure.onRetry}
                className="text-xs text-accent underline hover:text-text"
              >
                {uiCopy.store.retry}
              </button>
            </span>
          ) : trustEntries === undefined || trustEntries.length === 0 ? (
            <span
              data-yunari-store-detail-trust-state="none"
              className="text-xs text-muted"
            >
              {kind === "collection"
                ? uiCopy.store.detail.trust.noCode
                : uiCopy.store.detail.trust.unavailable}
            </span>
          ) : (
            <TrustBlock entries={trustEntries} />
          )}
          {props.onOpenSettings === undefined ? null : (
            <button
              type="button"
              data-yunari-store-detail-settings=""
              onClick={() => props.onOpenSettings?.("extensions")}
              className="self-start text-xs text-muted underline hover:text-text"
            >
              {uiCopy.store.detail.trust.settings}
            </button>
          )}
        </span>
      ) : null}
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
              onClick={() =>
                onOpenItem({
                  key: remixParent.id,
                  listing: remixParent,
                  member: remixParent.members[0],
                })
              }
              className="text-xs text-faint underline hover:text-text"
            >
              {uiCopy.store.item.remixedFrom(remixOf.name)}
            </button>
          )}
        </span>
      )}
      {/* **What the state is, and what it means.** A Mine row's state badge
          lives here rather than beside the name: the header is 238px wide, and
          a second badge there took the name down to "Withd…" on exactly the
          states that draw one. The badge is the word, the sentence below it the
          consequence. */}
      {item.status === undefined ? null : (
        <span className="flex">
          <StoreStatusBadge status={item.status} />
        </span>
      )}
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
