import type * as React from "react";
import { Fragment } from "react";
import { HeldUpdateNotice } from "../components/held-update-notice.js";
import { ACTION_BUTTON, ActionBox } from "../components/ui/dialog.js";
import {
  ADD_GLYPH,
  ASSIGN_ITEM_GLYPH,
  CHECK_GLYPH,
  DELETE_ITEM_GLYPH,
  EXPORT_ITEM_GLYPH,
  Glyph,
  type LucideIcon,
  MONITOR_ACTIVITY_GLYPH,
  PALETTE_GLYPH,
  PENCIL_GLYPH,
  SETTINGS_GLYPH,
} from "../editor-shell/icons.js";
import type { CollectionState, StoreCard } from "../library-mode/cards.js";
import { uiCopy } from "../ui-copy.js";
import {
  actionDisabledReason,
  actionsFor,
  isRemovalKind,
} from "./cell-actions.js";
import type { InstallControl } from "./install-item.js";
import { type InstallState, installStateOf } from "./install-state.js";
import type { CellAction, StoreItem } from "./local-source.js";
import type { SubmitControl } from "./use-submit.js";

/**
 * The item panel's foot: one set of commands per member kind.
 *
 * Each action's word and mark come from one table, so an action added to
 * `CellAction` without either fails to compile here rather than drawing a
 * nameless or wordless box.
 */
const ACTION_GLYPHS: Readonly<Record<CellAction, LucideIcon>> = {
  open: PENCIL_GLYPH,
  assign: ASSIGN_ITEM_GLYPH,
  export: EXPORT_ITEM_GLYPH,
  delete: DELETE_ITEM_GLYPH,
  apply: PALETTE_GLYPH,
  insert: ADD_GLYPH,
  enable: CHECK_GLYPH,
  configure: SETTINGS_GLYPH,
  status: MONITOR_ACTIVITY_GLYPH,
  remove: DELETE_ITEM_GLYPH,
};

/** The actions whose press destroys a copy, and whose mark the shell paints
 *  `--hot`. Two ids because a package's removal and a theme's deletion are the
 *  same act under the kind's own word. */
const DESTRUCTIVE_ACTIONS: ReadonlySet<CellAction> = new Set([
  "delete",
  "remove",
]);

/** One action's word for the kind that offers it. A kind-specific word wins
 *  where the kind makes the shared action more specific; `remove` is per kind
 *  because each kind names what leaves; the four theme commands keep the
 *  panel's short words. */
export function actionLabel(action: CellAction, kind: string): string {
  const perKind = (
    uiCopy.store.detail.kindActions as Readonly<
      Record<string, Partial<Record<CellAction, string>>>
    >
  )[kind]?.[action];
  if (perKind !== undefined) return perKind;
  if (action === "remove" && isRemovalKind(kind)) {
    return uiCopy.store.detail.remove[kind];
  }
  switch (action) {
    case "open":
    case "assign":
    case "export":
    case "delete":
      return uiCopy.store.item.actions[action];
    case "remove":
      // Unreachable: only a removal kind offers `remove`, and the guard above
      // answers every one of them.
      return uiCopy.store.detail.remove.plugin;
    default:
      return uiCopy.store.detail.actions[action];
  }
}

/** The dialog button, for the foot's wider controls (Install, Submit, the
 *  author's command). The action boxes are `ActionBox`. */
const FOOTER_BUTTON = `${ACTION_BUTTON} disabled:text-faint`;

/**
 * The online half's install reading: one of the three answers in place of
 * the library's actions.
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
  /** **The modal is the press surface for this item**, so a hold the host
   *  answered from here must be drawn here: the page's notice is behind the
   *  modal. Another item's hold is not this one's answer. */
  const held = install.held?.id === item.id ? install.held.held : undefined;
  return (
    <Fragment>
      {held === undefined ? null : (
        <HeldUpdateNotice
          held={held}
          heading={uiCopy.store.install.reviewHeading}
          reasonsLabel={uiCopy.store.install.reviewReasons}
          approveLabel={uiCopy.store.install.reviewApprove}
          dismissLabel={uiCopy.store.install.reviewDismiss}
          onApprove={install.onApproveUpdate}
          onDismiss={install.onDismissUpdate}
        />
      )}
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
 * store, beside the actions that keep it on this PC.
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

/** A collection's install reading and its one action.
 *
 *  **Install and Update are the existing install press**, because the host runs
 *  the same pre-flight either way. The word and the count come from
 *  `collectionStateOf` over the origin register: a collection installs its
 *  includes and never holds an origin of its own, so `installStateOf` cannot
 *  answer for it.
 */
function CollectionFooter(props: {
  readonly item: StoreItem;
  readonly state: CollectionState | undefined;
  readonly stateRead: boolean;
  readonly originsFailure:
    | { readonly message: string; readonly onRetry: () => void }
    | undefined;
  readonly originsLoading: boolean;
  readonly install: InstallControl;
  /** Opens the install sheet, which owns the chosen set and each member's own
   *  removal. */
  readonly onOpenSheet: () => void;
}): React.JSX.Element {
  const { item, state, install } = props;
  const busy = install.installingIds.has(item.id);
  const refusal =
    install.refusal?.id === item.id ? install.refusal.message : undefined;

  return (
    <span className="flex flex-col gap-[var(--space-8)]">
      <span className="flex flex-wrap items-center gap-[var(--space-8)]">
        {props.originsFailure !== undefined ? (
          <span
            data-yunari-store-collection-state="failed"
            className="flex flex-col items-start gap-[var(--space-4)] text-xs text-warn"
          >
            {props.originsFailure.message}
            <button
              type="button"
              data-yunari-store-collection-retry=""
              onClick={props.originsFailure.onRetry}
              className="text-xs text-accent underline hover:text-text"
            >
              {uiCopy.store.retry}
            </button>
          </span>
        ) : !props.stateRead || state === undefined ? (
          <span
            data-yunari-store-collection-state={
              props.originsLoading ? "loading" : "unavailable"
            }
            className="text-xs text-muted"
          >
            {props.originsLoading
              ? uiCopy.store.detail.collectionStateLoading
              : uiCopy.store.detail.collectionStateUnavailable}
          </span>
        ) : state.state === "absent" ? (
          <button
            type="button"
            data-yunari-store-collection-install="install"
            disabled={busy}
            aria-busy={busy}
            onClick={props.onOpenSheet}
            className={FOOTER_BUTTON}
          >
            {uiCopy.store.cell.installStates.install}
          </button>
        ) : (
          <>
            {state.state === "partial" ? (
              <span
                data-yunari-store-collection-count=""
                className="text-xs text-muted"
              >
                {uiCopy.store.cell.pack.installed(state.installed, state.total)}
              </span>
            ) : null}
            <button
              type="button"
              data-yunari-store-collection-install="update"
              disabled={busy}
              aria-busy={busy}
              onClick={props.onOpenSheet}
              className={FOOTER_BUTTON}
            >
              {uiCopy.store.cell.installStates.update}
            </button>
          </>
        )}
      </span>
      {refusal === undefined ? null : (
        <span
          data-yunari-store-item-install-refusal=""
          className="max-w-[40ch] text-xs text-warn"
        >
          {refusal}
        </span>
      )}
      <ActionBox
        id="yunari-store-item-remove"
        data={{ "data-yunari-store-item-action": "remove" }}
        icon={ACTION_GLYPHS.remove}
        label={actionLabel("remove", "collection")}
        destructive
        onClick={props.onOpenSheet}
      />
    </span>
  );
}

/** The panel's foot: the actions the open member's kind allows, the author's
 *  command and the submission above them, or a collection's install reading and
 *  Remove members in their place.
 *
 *  **A theme's catalogue copy keeps the online half's install reading** rather
 *  than the library's four actions, because installing is what a person does to
 *  a theme they do not hold; a member card's own actions are drawn beside the
 *  package's install reading when the package has one. */
export function PanelFoot(props: {
  readonly item: StoreItem;
  readonly card: StoreCard;
  readonly kind: string;
  readonly collectionState: CollectionState | undefined;
  readonly collectionStateRead: boolean;
  readonly originsFailure:
    | { readonly message: string; readonly onRetry: () => void }
    | undefined;
  readonly originsLoading: boolean;
  readonly install: InstallControl;
  readonly submit: SubmitControl;
  readonly onAction: (action: CellAction, card: StoreCard) => void;
  /** Opens the collection install sheet from the foot's Install press. */
  readonly onOpenSheet: () => void;
  /** The inline display choice, above the actions that opened it. */
  readonly assign?: React.ReactNode;
  /** What the surface said about the last action it could not run. Drawn here
   *  because the modal covers the listing's own notice. */
  readonly notice?: string | undefined;
}): React.JSX.Element {
  const { item, kind, install, submit, onAction } = props;
  const installState = installStateOf(item);
  const actions = actionsFor(kind);
  const isCollection = kind === "collection";
  /** **An installed dashboard theme keeps its four commands**: the library copy
   *  the join named (`installedId`) is what the host's theme routes act on. An
   *  app theme has no write route, so it keeps the online reading alone. */
  const installedThemeCommands =
    kind === "dashboard-theme" && item.installedId !== undefined;
  const onlineThemeInstall =
    !isCollection &&
    (kind === "dashboard-theme" || kind === "editor-theme") &&
    installState !== "none" &&
    !installedThemeCommands;
  const showSubmit = kind === "dashboard-theme" && installState === "none";
  return (
    <span className="flex flex-none flex-col gap-[var(--space-8)] border-t border-edge px-[var(--space-16)] py-[var(--space-12)]">
      {props.notice === undefined ? null : (
        <span
          data-yunari-store-item-action-notice=""
          role="status"
          className="text-xs text-warn"
        >
          {props.notice}
        </span>
      )}{" "}
      {props.assign === undefined ? null : (
        <span
          data-yunari-store-item-assign=""
          className="flex flex-col gap-[var(--space-8)]"
        >
          {props.assign}
        </span>
      )}
      {isCollection ? (
        <CollectionFooter
          item={item}
          state={props.collectionState}
          stateRead={props.collectionStateRead}
          originsFailure={props.originsFailure}
          originsLoading={props.originsLoading}
          install={install}
          onOpenSheet={props.onOpenSheet}
        />
      ) : (
        <>
          {showSubmit ? (
            <span className="flex flex-wrap items-center gap-[var(--space-8)]">
              <SubmitFooter item={item} submit={submit} />
            </span>
          ) : null}
          {onlineThemeInstall ? (
            <InstallFooter item={item} state={installState} install={install} />
          ) : (
            <>
              {actions.length === 0 ? null : (
                <span className="flex flex-wrap gap-[var(--space-6)]">
                  {actions.map((action) => {
                    const reason = actionDisabledReason(
                      action,
                      kind,
                      actionLabel(action, kind),
                      item,
                    );
                    const controlId = `yunari-store-item-${action}`;
                    return (
                      <ActionBox
                        key={action}
                        id={controlId}
                        data={{ "data-yunari-store-item-action": action }}
                        icon={ACTION_GLYPHS[action]}
                        label={actionLabel(action, kind)}
                        {...(DESTRUCTIVE_ACTIONS.has(action)
                          ? { destructive: true }
                          : {})}
                        disabled={reason !== undefined}
                        {...(reason === undefined
                          ? {}
                          : { describedById: `${controlId}-reason` })}
                        onClick={() => onAction(action, props.card)}
                      />
                    );
                  })}
                </span>
              )}
              {actions.map((action) => {
                const reason = actionDisabledReason(
                  action,
                  kind,
                  actionLabel(action, kind),
                  item,
                );
                return reason === undefined ? null : (
                  <span
                    key={action}
                    id={`yunari-store-item-${action}-reason`}
                    className="sr-only"
                  >
                    {reason}
                  </span>
                );
              })}
              {installState === "none" ? null : (
                <InstallFooter
                  item={item}
                  state={installState}
                  install={install}
                />
              )}
            </>
          )}
        </>
      )}
    </span>
  );
}
