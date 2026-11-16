import type { InstalledExtension } from "@yunari/extension-api";
import type { CollectionPlan } from "@yunari/renderer-core";
import type * as React from "react";
import { uiCopy } from "../ui-copy.js";
import type { StoreItem } from "./local-source.js";

/**
 * The detail sections a member card adds beyond a theme's facts: the members,
 * a collection's plan state, and the trust block that says what code may do.
 *
 * **The wire's own words.** An execution profile, a capability and a device id
 * are printed as the extension listing or the plan serves them; this file names
 * the labels, never the values.
 */

/** The plan a collection's detail reads: in flight, answered, or refused. */
export type DetailPlanState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly plan: CollectionPlan }
  | { readonly status: "failed"; readonly message: string };

/** A code member's trust facts, whichever listing supplied them. */
interface TrustEntry {
  readonly key: string;
  readonly name: string;
  readonly execution: string;
  readonly capabilities: readonly string[];
  readonly devices: readonly string[];
}

/** One installed plugin's trust facts, as the extension listing serves them. */
export function extensionTrustOf(extension: InstalledExtension): TrustEntry {
  return {
    key: extension.key,
    name: extension.name,
    execution: extension.execution,
    capabilities: extension.capabilities,
    devices: extension.devices,
  };
}

/** One member row the detail lists: the package's own members, or a
 *  collection's plan members. */
interface MemberRow {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly publisher: string;
  readonly optional: boolean;
}

/** One code member's trust facts under their labels. Empty wire lists are the
 *  member's own declaration of nothing, stated as such rather than dropped. */
export function TrustBlock(props: {
  readonly entries: readonly TrustEntry[];
}): React.JSX.Element {
  return (
    <span
      data-yunari-store-detail-trust=""
      className="flex flex-col gap-[var(--space-8)] rounded-md border border-edge bg-panel-2 p-[var(--space-10)]"
    >
      {props.entries.map((entry) => (
        <span
          key={entry.key}
          data-yunari-store-detail-trust-entry=""
          className="flex flex-col gap-[var(--space-4)] text-2xs text-muted"
        >
          <span className="text-xs font-medium text-text">{entry.name}</span>
          <span className="font-mono text-faint">{entry.key}</span>
          <span>
            {uiCopy.store.detail.trust.execution}: {entry.execution}
          </span>
          <span data-yunari-store-detail-capability="">
            {uiCopy.store.detail.trust.capabilities}:{" "}
            {entry.capabilities.length === 0
              ? uiCopy.store.detail.trust.none
              : entry.capabilities.join(", ")}
          </span>
          <span data-yunari-store-detail-device="">
            {uiCopy.store.detail.trust.devices}:{" "}
            {entry.devices.length === 0
              ? uiCopy.store.detail.trust.none
              : entry.devices.join(", ")}
          </span>
        </span>
      ))}
    </span>
  );
}

/** One member row: its name, its kind's word and the publisher a person can
 *  judge it by. */
export function MemberList(props: {
  readonly rows: readonly MemberRow[];
}): React.JSX.Element {
  return (
    <span
      data-yunari-store-detail-members=""
      className="flex flex-col gap-[var(--space-6)]"
    >
      <span className="text-2xs font-semibold tracking-[0.11em] text-muted uppercase">
        {uiCopy.store.detail.members}
      </span>
      <span className="flex flex-col gap-[var(--space-4)]">
        {props.rows.map((row) => (
          <span
            key={`${row.kind}/${row.id}`}
            data-yunari-store-detail-member=""
            className="flex min-w-0 flex-col rounded-md border border-edge-2 px-[var(--space-8)] py-[var(--space-6)]"
          >
            <span className="flex min-w-0 items-center gap-[var(--space-6)]">
              <span
                data-yunari-store-detail-member-name=""
                className="min-w-0 truncate text-xs text-text"
              >
                {row.name}
              </span>
              <span className="flex-none text-2xs text-faint">
                {uiCopy.store.cell.memberKinds[row.kind] ?? row.kind}
              </span>
              {row.optional ? (
                <span className="flex-none text-2xs text-faint">
                  {uiCopy.store.detail.optional}
                </span>
              ) : null}
            </span>
            <span
              data-yunari-store-detail-member-publisher=""
              className="font-mono text-2xs text-faint"
            >
              {row.publisher === ""
                ? uiCopy.store.detail.noPublisher
                : `@${row.publisher}`}
            </span>
          </span>
        ))}
      </span>
    </span>
  );
}

/** The member rows an item's detail lists. A collection's are the plan's, so
 *  each carries its own publisher; every other kind's are the listing's
 *  members, published by the account that published the package. */
export function memberRowsOf(
  item: StoreItem,
  kind: string,
  plan: DetailPlanState | undefined,
): readonly MemberRow[] | undefined {
  if (kind === "collection") {
    if (plan?.status !== "ready") return undefined;
    return plan.plan.members.map((member) => ({
      id: member.id,
      kind: member.kind,
      name: member.name,
      publisher: member.publisher,
      optional: member.optional,
    }));
  }
  const publisher = item.catalogue?.publisher ?? item.author ?? "";
  return item.members.map((member) => ({
    id: member.id,
    kind: member.kind,
    name: member.name,
    publisher,
    optional: false,
  }));
}

/** What the plan is doing, where a collection has no rows to draw yet. The
 *  loading and failure sentences are shared by the member list and the trust
 *  block: one read answers both, and drawing two copies of its state would be
 *  two announcements of one fact. */
export function PlanStateNote(props: {
  readonly plan: DetailPlanState | undefined;
  readonly onRetry: (() => void) | undefined;
}): React.JSX.Element | null {
  if (props.plan === undefined || props.plan.status === "ready") return null;
  return props.plan.status === "loading" ? (
    <span
      data-yunari-store-detail-plan="loading"
      className="text-xs text-muted"
    >
      {uiCopy.store.detail.plan.loading}
    </span>
  ) : (
    <span
      data-yunari-store-detail-plan="failed"
      className="flex flex-col items-start gap-[var(--space-4)] text-xs text-warn"
    >
      {uiCopy.store.detail.plan.failed(props.plan.message)}
      {props.onRetry === undefined ? null : (
        <button
          type="button"
          data-yunari-store-detail-plan-retry=""
          onClick={props.onRetry}
          className="text-xs text-accent underline hover:text-text"
        >
          {uiCopy.store.retry}
        </button>
      )}
    </span>
  );
}

/** A wire list read defensively: the plan is host data, and a capability list
 *  that is not an array is a member this surface cannot describe rather than a
 *  modal that crashes. */
function stringsOf(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** The trust entries a collection's plan carries: every member whose package
 *  declared a consent. A collection asks for none of its own, so a plan with no
 *  consent entry says exactly that rather than drawing an empty list. */
export function planTrust(
  plan: DetailPlanState | undefined,
): readonly TrustEntry[] | undefined {
  if (plan?.status !== "ready") return undefined;
  return plan.plan.members.flatMap((member) =>
    member.consent === undefined
      ? []
      : [
          {
            key: member.consent.key,
            name: member.consent.name,
            execution: member.consent.execution,
            capabilities: stringsOf(member.consent.capabilities),
            devices: stringsOf(member.consent.devices),
          },
        ],
  );
}

/** A collection's trust block waits for its plan: the loading and failure
 *  sentences are the plan's, and a failure must not draw as an empty consent
 *  list. Every other code kind reads the extension listing the surface already
 *  holds, so its block is drawn even when that listing did not name the item —
 *  the absence is stated. */
export function canShowTrust(
  kind: string,
  plan: DetailPlanState | undefined,
): boolean {
  return kind === "collection" ? plan?.status === "ready" : true;
}
