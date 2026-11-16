import { Checkbox } from "@base-ui/react/checkbox";
import type { CatalogueOrigin, CollectionPlan } from "@yunari/renderer-core";
import { useEffect, useState } from "react";
import { HeldUpdateNotice } from "../components/held-update-notice.js";
import { ACTION_BUTTON, Dialog } from "../components/ui/dialog.js";
import { CHECK_GLYPH, Glyph } from "../editor-shell/icons.js";
import type { InstallControl } from "../store-mode/install-item.js";
import type { DetailPlanState } from "../store-mode/item-detail.js";
import type { StoreItem } from "../store-mode/local-source.js";
import { uiCopy } from "../ui-copy.js";
import {
  type CollectionConsentResult,
  choiceOf,
  choicesOf,
  type PlanChange,
  toggleChoice,
  updateDiff,
} from "./collection-install.js";

/**
 * The collection install sheet: everything a collection will put on this PC,
 * one opt-out list, the code members' own authority, and the update diff.
 *
 * **The sheet is a reviewer, not a writer.** It reads the host's plan and posts
 * the chosen ids through the region's install hook; the host re-runs the same
 * pre-flight and never trusts this screen. A collection asks for no consent of
 * its own, so the consent section is each code member's own declaration — the
 * sheet cannot turn a collection's name into authority over a plugin.
 *
 * **A required member is locked, not warned about.** Its row is checked and
 * disabled, so the only way to reach `missingRequired` is a stale plan or a
 * direct call; the region keeps the guard and this surface cannot produce it.
 */

function memberKindWord(kind: string): string {
  return uiCopy.store.cell.memberKinds[kind] ?? kind;
}

function publisherOf(publisher: string): string {
  return publisher === "" ? uiCopy.store.detail.noPublisher : `@${publisher}`;
}

/** One member row: the checkbox choice row from `DESIGN.md`, with the member's
 *  publisher, kind and size beside its name. The row's own text is the
 *  checkbox's accessible name, so a person hears the member they are opting
 *  out of rather than an unlabelled box. */
function MemberRow(props: {
  readonly member: CollectionPlan["members"][number];
  readonly checked: boolean;
  readonly locked: boolean;
  readonly disabled: boolean;
  readonly onToggle: () => void;
}): React.JSX.Element {
  const { member, checked, locked, disabled } = props;
  return (
    <div data-yunari-collection-member={member.id}>
      <Checkbox.Root
        nativeButton
        render={<button type="button" />}
        data-yunari-collection-choice=""
        checked={checked}
        disabled={disabled || locked}
        onCheckedChange={() => props.onToggle()}
        className="group flex w-full items-center gap-[var(--space-8)] rounded-md border border-edge bg-panel-2 px-[var(--space-10)] py-[var(--space-6)] text-left text-xs text-muted data-[checked]:border-accent data-[checked]:text-text data-[checked]:[background:var(--stage)] disabled:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
      >
        <span
          aria-hidden
          className="flex size-[14px] flex-none items-center justify-center rounded-sm border border-edge group-data-[checked]:border-muted"
        >
          <Checkbox.Indicator className="flex text-text">
            <Glyph icon={CHECK_GLYPH} size={10} />
          </Checkbox.Indicator>
        </span>
        <span className="min-w-0 flex-1 truncate text-text">{member.name}</span>
        <span className="flex-none text-2xs text-faint">
          {memberKindWord(member.kind)}
        </span>
        <span className="min-w-0 flex-none truncate font-mono text-2xs text-faint">
          {publisherOf(member.publisher)}
        </span>
        <span className="flex-none font-mono text-2xs text-faint">
          {uiCopy.store.collectionSheet.size(member.bytes)}
        </span>
        <span className="flex-none text-2xs text-faint">
          {locked
            ? uiCopy.store.collectionSheet.required
            : uiCopy.store.collectionSheet.optional}
        </span>
      </Checkbox.Root>
    </div>
  );
}

/** The aggregated consent block: one entry per chosen code member, printing the
 *  wire's own execution profile, capabilities and devices. A plan with no code
 *  member says exactly that instead of drawing an empty permission list. */
function ConsentSection(props: {
  readonly plan: CollectionPlan;
  readonly chosen: ReadonlySet<string>;
}): React.JSX.Element {
  const code = props.plan.members.filter(
    (member) => member.consent !== undefined && props.chosen.has(member.id),
  );
  return (
    <section
      data-yunari-collection-sheet-consent=""
      className="flex flex-col gap-[var(--space-6)]"
      aria-label={uiCopy.store.collectionSheet.consent.heading}
    >
      <h3 className="text-2xs font-semibold tracking-[0.11em] text-muted uppercase">
        {uiCopy.store.collectionSheet.consent.heading}
      </h3>
      <p className="text-xs text-muted">
        {uiCopy.store.collectionSheet.consent.lead}
      </p>
      {code.length === 0 ? (
        <p className="text-xs text-faint">
          {uiCopy.store.collectionSheet.consent.noCode}
        </p>
      ) : (
        code.map((member) => {
          const consent = member.consent;
          if (consent === undefined) return null;
          return (
            <div
              key={member.id}
              data-yunari-collection-consent={member.id}
              className="flex flex-col gap-[var(--space-4)] rounded-md border border-edge bg-panel-2 p-[var(--space-10)] text-2xs text-muted"
            >
              <span className="text-xs font-medium text-text">
                {consent.name}
              </span>
              <span className="font-mono text-faint">{consent.key}</span>
              <span>
                {uiCopy.store.detail.trust.execution}: {consent.execution}
              </span>
              <span>
                {uiCopy.store.detail.trust.capabilities}:{" "}
                {consent.capabilities.length === 0
                  ? uiCopy.store.detail.trust.none
                  : consent.capabilities.join(", ")}
              </span>
              <span>
                {uiCopy.store.detail.trust.devices}:{" "}
                {consent.devices.length === 0
                  ? uiCopy.store.detail.trust.none
                  : consent.devices.join(", ")}
              </span>
            </div>
          );
        })
      )}
    </section>
  );
}

/** The update diff: what is not on this PC yet, and what the collection no
 *  longer includes. **A dropped member is offered, never removed**: no bulk
 *  removal route exists, so the row names the action and the surface where the
 *  person makes that decision. */
function DiffSection(props: {
  readonly plan: CollectionPlan;
  readonly origins: readonly CatalogueOrigin[];
  readonly collectionId: string;
}): React.JSX.Element | null {
  const diff = updateDiff(props.plan, props.origins, props.collectionId);
  const includes = props.plan.members.length + props.plan.missing.length;
  // A collection with nothing on this PC is an install, not an update: its
  // "missing" list would repeat every included row above it.
  const updateMode = diff.missing.length < includes;
  if (!updateMode) return null;
  if (diff.missing.length === 0 && diff.dropped.length === 0) return null;

  const membersById = new Map(
    props.plan.members.map((member) => [member.id, member]),
  );
  const originById = new Map(
    props.origins.map((origin) => [origin.catalogueId, origin]),
  );
  // The section's own name names what it actually draws, so a diff showing only
  // missing members is not labelled "No longer in this collection".
  const label =
    diff.dropped.length === 0
      ? uiCopy.store.collectionSheet.update.missing
      : diff.missing.length === 0
        ? uiCopy.store.collectionSheet.update.dropped
        : `${uiCopy.store.collectionSheet.update.missing}${uiCopy.store.readingSeparator}${uiCopy.store.collectionSheet.update.dropped}`;

  return (
    <section
      data-yunari-collection-diff=""
      className="flex flex-col gap-[var(--space-6)]"
      aria-label={label}
    >
      {diff.missing.length === 0 ? null : (
        <div className="flex flex-col gap-[var(--space-4)]">
          <h3 className="text-2xs font-semibold tracking-[0.11em] text-muted uppercase">
            {uiCopy.store.collectionSheet.update.missing}
          </h3>
          {diff.missing.map((id) => {
            const member = membersById.get(id);
            const origin = originById.get(id);
            return (
              <span
                key={id}
                data-yunari-collection-missing={id}
                className="text-xs text-muted"
              >
                {member?.name ?? id}
                {" · "}
                {memberKindWord(member?.kind ?? origin?.kind ?? "")}
              </span>
            );
          })}
        </div>
      )}
      {diff.dropped.length === 0 ? null : (
        <div
          data-yunari-collection-dropped=""
          className="flex flex-col gap-[var(--space-4)]"
        >
          <h3 className="text-2xs font-semibold tracking-[0.11em] text-muted uppercase">
            {uiCopy.store.collectionSheet.update.dropped}
          </h3>
          <p className="text-xs text-muted">
            {uiCopy.store.collectionSheet.update.droppedLead}
          </p>
          {diff.dropped.map((id) => {
            const origin = originById.get(id);
            const kind = origin?.kind ?? "";
            return (
              <span
                key={id}
                data-yunari-collection-dropped-member={id}
                className="flex flex-wrap items-baseline gap-[var(--space-6)] text-xs text-muted"
              >
                <span className="font-mono text-text">{id}</span>
                <span className="text-2xs text-faint">
                  {memberKindWord(kind)}
                </span>
                <span className="text-2xs">
                  {uiCopy.store.collectionSheet.update.removal(kind)}
                </span>
              </span>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function CollectionSheet(props: {
  readonly item: StoreItem;
  /** The plan the detail surface already reads when it opens. The sheet is
   *  mounted by that surface, so it inherits the read rather than starting a
   *  second one. */
  readonly plan: DetailPlanState;
  /** This PC's register, for the update diff. Absent is a register the surface
   *  never obtained, so no diff is claimed. */
  readonly origins: readonly CatalogueOrigin[] | undefined;
  readonly install: InstallControl;
  readonly onClose: () => void;
  readonly onRetryPlan?: (() => void) | undefined;
}): React.JSX.Element {
  /** A plan re-read on the Install press, which replaces what this sheet shows
   *  rather than installing a stale set. */
  const [replaced, setReplaced] = useState<CollectionPlan | undefined>(
    undefined,
  );
  const [changed, setChanged] = useState<PlanChange | undefined>(undefined);
  const [settled, setSettled] = useState<CollectionConsentResult | undefined>(
    undefined,
  );
  const shown =
    replaced ?? (props.plan.status === "ready" ? props.plan.plan : undefined);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() =>
    shown === undefined ? new Set() : choicesOf(shown).chosen,
  );

  // A plan the surface retried into readiness initializes the opt-out list once;
  // the effect is keyed on the plan's identity, so a person's unticking is not
  // undone by an unrelated re-render.
  useEffect(() => {
    if (replaced !== undefined) return;
    if (props.plan.status !== "ready") return;
    setChosen(choicesOf(props.plan.plan).chosen);
  }, [props.plan, replaced]);

  const busy = props.install.installingIds.has(props.item.id);
  const refusal =
    props.install.refusal?.id === props.item.id
      ? props.install.refusal.message
      : undefined;
  /** **A held member is approved here**, not in Settings: the sheet is where
   *  the chosen set was made, and the approval re-posts exactly that set naming
   *  the one member whose notice was shown. */
  const held =
    props.install.refusal?.id === props.item.id
      ? props.install.refusal.held
      : undefined;
  const heldMemberId =
    props.install.refusal?.id === props.item.id
      ? props.install.refusal.memberId
      : undefined;
  /** The consent a press that stopped part-way obtained for the members it did
   *  write. The retry skips those members, so this sheet is the only place the
   *  grant is stated. */
  const refusalConsent =
    props.install.refusal?.id === props.item.id
      ? props.install.refusal.consent
      : undefined;
  /** The members a stopped press wrote. An approval press posts the same chosen
   *  set, and the retry skips them as already registered, so the sheet carries
   *  their ids forward: without them their consent would be forgotten when the
   *  refusal clears. */
  const refusalWritten =
    props.install.refusal?.id === props.item.id
      ? props.install.refusal.written
      : undefined;
  const [carried, setCarried] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (refusalWritten === undefined || refusalWritten.length === 0) return;
    setCarried((current) => {
      const next = new Set(current);
      for (const id of refusalWritten) next.add(id);
      return next;
    });
  }, [refusalWritten]);
  const choice = shown === undefined ? undefined : choiceOf(shown, chosen);
  const blockedReason =
    shown === undefined
      ? undefined
      : shown.missing.length > 0
        ? uiCopy.store.collectionSheet.unavailableBlocks(
            shown.missing.map((member) => member.id),
          )
        : choice !== undefined && choice.missingRequired.length > 0
          ? uiCopy.store.collectionSheet.requiredMissing(choice.missingRequired)
          : choice !== undefined && choice.chosen.size === 0
            ? uiCopy.store.collectionSheet.noneChosen
            : undefined;
  const collectionId = props.item.catalogue?.id ?? props.item.id;
  /** The members a part-way failure could not write, by the plan's own names. */
  const failedMembers =
    props.install.refusal?.id === props.item.id &&
    props.install.refusal.members !== undefined &&
    shown !== undefined
      ? props.install.refusal.members
          .filter((member) => !member.ok)
          .map(
            (member) =>
              shown.members.find((planned) => planned.id === member.id)?.name ??
              member.id,
          )
      : [];
  const totalBytes =
    shown === undefined
      ? 0
      : shown.members
          .filter((member) => chosen.has(member.id))
          .reduce((sum, member) => sum + member.bytes, 0);

  const press = (approveMember?: string): void => {
    if (shown === undefined || blockedReason !== undefined || busy) return;
    if (props.install.onInstallCollection === undefined) return;
    // A fresh press answers the change the last one reported: the notice must
    // not outlive the plan the person is now installing.
    setChanged(undefined);
    props.install.onInstallCollection(
      props.item,
      [...chosen],
      shown,
      (plan, change) => {
        setReplaced(plan);
        setChosen(choicesOf(plan).chosen);
        setChanged(change);
        setSettled(undefined);
      },
      (consent) => setSettled(consent),
      approveMember,
      carried.size === 0 ? undefined : [...carried],
    );
  };

  /**
   * **The way out is always drawn.** A plan that is still loading or that
   * failed is exactly when a person wants to leave the sheet, so Cancel does not
   * depend on the plan having answered. A ready plan adds Install beside it;
   * a landed press replaces both with Done.
   */
  const footer = (
    <div className="flex justify-end gap-[var(--space-8)]">
      {settled !== undefined ? (
        <button type="button" onClick={props.onClose} className={ACTION_BUTTON}>
          {uiCopy.store.collectionSheet.done}
        </button>
      ) : shown === undefined ? (
        <button type="button" onClick={props.onClose} className={ACTION_BUTTON}>
          {uiCopy.store.collectionSheet.cancel}
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={props.onClose}
            className={ACTION_BUTTON}
          >
            {uiCopy.store.collectionSheet.cancel}
          </button>
          <button
            type="button"
            data-yunari-collection-sheet-install=""
            disabled={
              busy ||
              blockedReason !== undefined ||
              props.install.onInstallCollection === undefined
            }
            aria-busy={busy}
            {...(blockedReason === undefined
              ? {}
              : {
                  "aria-describedby": "yunari-collection-sheet-blocked-reason",
                })}
            onClick={() => press()}
            className={`${ACTION_BUTTON} disabled:text-faint`}
          >
            {busy
              ? uiCopy.store.collectionSheet.busy
              : uiCopy.store.collectionSheet.install}
          </button>
          {blockedReason === undefined ? null : (
            <span
              id="yunari-collection-sheet-blocked-reason"
              className="sr-only"
            >
              {blockedReason}
            </span>
          )}
        </>
      )}
    </div>
  );

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
      label={uiCopy.store.collectionSheet.title(props.item.name)}
      closeLabel={uiCopy.store.collectionSheet.close}
    >
      <div
        data-yunari-collection-sheet=""
        className="flex flex-col gap-[var(--space-12)]"
      >
        <p className="text-sm text-muted">
          {uiCopy.store.collectionSheet.lead}
        </p>

        {shown === undefined ? (
          props.plan.status === "failed" ? (
            <div
              data-yunari-collection-sheet-plan="failed"
              className="flex flex-col items-start gap-[var(--space-4)] text-xs text-warn"
            >
              {uiCopy.store.detail.plan.failed(props.plan.message)}
              {props.onRetryPlan === undefined ? null : (
                <button
                  type="button"
                  onClick={props.onRetryPlan}
                  className="text-xs text-accent underline hover:text-text"
                >
                  {uiCopy.store.retry}
                </button>
              )}
            </div>
          ) : (
            <p
              data-yunari-collection-sheet-plan="loading"
              className="text-xs text-muted"
            >
              {uiCopy.store.detail.plan.loading}
            </p>
          )
        ) : (
          <>
            <section
              className="flex flex-col gap-[var(--space-6)]"
              aria-label={uiCopy.store.collectionSheet.included}
            >
              <h3 className="text-2xs font-semibold tracking-[0.11em] text-muted uppercase">
                {uiCopy.store.collectionSheet.included}
              </h3>
              <div
                role="group"
                aria-label={uiCopy.store.collectionSheet.included}
                className="flex flex-col gap-[var(--space-4)]"
              >
                {shown.members.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    checked={chosen.has(member.id)}
                    locked={!member.optional}
                    disabled={
                      busy || settled !== undefined || held !== undefined
                    }
                    onToggle={() =>
                      setChosen(toggleChoice(shown, chosen, member.id).chosen)
                    }
                  />
                ))}
              </div>
              <p
                data-yunari-collection-sheet-total=""
                className="text-xs text-text"
              >
                {uiCopy.store.collectionSheet.total(
                  uiCopy.store.collectionSheet.size(totalBytes),
                )}
              </p>
            </section>

            <ConsentSection plan={shown} chosen={chosen} />

            {changed === undefined ? null : (
              <p
                data-yunari-collection-sheet-changed=""
                role="status"
                aria-live="polite"
                className="text-xs text-warn"
              >
                {uiCopy.store.collectionSheet.changed(changed)}
              </p>
            )}

            {held === undefined ? null : (
              <HeldUpdateNotice
                held={held}
                heading={uiCopy.store.install.reviewHeading}
                reasonsLabel={uiCopy.store.install.reviewReasons}
                approveLabel={uiCopy.store.install.reviewApprove}
                dismissLabel={uiCopy.store.install.reviewDismiss}
                disabled={busy || heldMemberId === undefined}
                onApprove={() => press(heldMemberId)}
                onDismiss={props.install.onDismissUpdate}
              />
            )}

            {props.origins === undefined ? null : (
              <DiffSection
                plan={shown}
                origins={props.origins}
                collectionId={collectionId}
              />
            )}

            {blockedReason === undefined ? null : (
              <p
                data-yunari-collection-sheet-blocked=""
                role="status"
                aria-live="polite"
                className="text-xs text-warn"
              >
                {blockedReason}
              </p>
            )}

            {settled === undefined ? null : (
              <p
                data-yunari-collection-sheet-installed=""
                role="status"
                aria-live="polite"
                className="text-xs text-muted"
              >
                {settled.notGranted.length === 0
                  ? uiCopy.store.install.installed(props.item.name)
                  : uiCopy.store.collectionSheet.notGranted(settled.notGranted)}
              </p>
            )}

            {refusal === undefined || held !== undefined ? null : (
              <p
                data-yunari-collection-sheet-refusal=""
                className="text-xs text-warn"
              >
                {refusal}
              </p>
            )}

            {refusalConsent === undefined ||
            (refusalConsent.granted.length === 0 &&
              refusalConsent.notGranted.length === 0) ? null : (
              <>
                {refusalConsent.granted.length === 0 ? null : (
                  <p
                    data-yunari-collection-sheet-consent-granted=""
                    role="status"
                    className="text-xs text-muted"
                  >
                    {uiCopy.store.collectionSheet.consentGranted(
                      refusalConsent.granted,
                    )}
                  </p>
                )}
                {refusalConsent.notGranted.length === 0 ? null : (
                  <p
                    data-yunari-collection-sheet-consent-not-granted=""
                    role="status"
                    className="text-xs text-warn"
                  >
                    {uiCopy.store.collectionSheet.consentNotGranted(
                      refusalConsent.notGranted,
                    )}
                  </p>
                )}
              </>
            )}

            {failedMembers.length === 0 ? null : (
              <p
                data-yunari-collection-sheet-failed=""
                role="status"
                className="text-xs text-warn"
              >
                {uiCopy.store.collectionSheet.failedMembers(failedMembers)}
              </p>
            )}

            {footer}
          </>
        )}
        {shown === undefined ? footer : null}
      </div>
    </Dialog>
  );
}
