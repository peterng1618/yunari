import type { AssetPage } from "@yunari/renderer-core";
import type * as React from "react";
import { Fragment } from "react";
import { Dialog } from "../components/ui/dialog.js";
import { uiCopy } from "../ui-copy.js";
import type { TabMessage } from "./finder-model.js";
import { FinderState } from "./finder-state.js";
import { FinderSkeleton } from "./skeleton.js";

function failureSentence(
  page: AssetPage,
  labelOf: (source: string) => string,
): React.ReactNode {
  const failure = page.failure;
  if (failure === undefined) return null;
  const label = labelOf(page.source);
  return failure.reason === "needs-credential" ? (
    <span key={page.source} data-yunari-asset-needs-credential={page.source}>
      {uiCopy.assets.needsCredential(label)}{" "}
    </span>
  ) : (
    <span key={page.source} data-yunari-asset-failure={page.source}>
      {uiCopy.assets.sourceFailed(label, failure.message)}{" "}
    </span>
  );
}

/** One line, in priority order, in the frame's footer. */
export function FinderStatus(props: {
  readonly local: boolean;
  readonly grid: boolean;
  readonly localMessage: TabMessage | undefined;
  readonly message: TabMessage | undefined;
  readonly loading: boolean;
  readonly enabledCount: number;
  readonly failures: readonly AssetPage[];
  readonly shownCount: number;
  readonly sourceCount: number;
  readonly more: boolean;
  readonly labelOf: (source: string) => string;
  readonly onRetry: () => void;
}): React.ReactNode {
  if (props.local) {
    return props.localMessage === undefined ? undefined : (
      <span data-yunari-asset-message="">{props.localMessage.text}</span>
    );
  }
  if (!props.grid) return undefined;
  if (props.message !== undefined) {
    return <span data-yunari-asset-message="">{props.message.text}</span>;
  }
  if (props.loading) return uiCopy.assets.searching(props.enabledCount);
  if (props.failures.length > 0) {
    return (
      <>
        {props.failures.map((page) => (
          <Fragment key={page.source}>
            {failureSentence(page, props.labelOf)}
          </Fragment>
        ))}
        {props.failures.some((page) => page.failure?.reason === "failed") ? (
          <button
            type="button"
            data-yunari-asset-retry=""
            onClick={props.onRetry}
            className="underline"
          >
            {uiCopy.assets.retry}
          </button>
        ) : null}
      </>
    );
  }
  if (props.shownCount > 0) {
    return `${uiCopy.assets.results(props.shownCount, props.sourceCount)}${
      props.more ? "" : ` · ${uiCopy.assets.endOfResults}`
    }`;
  }
  return undefined;
}

/** The frame's content when the grid has nothing to draw: a switched-off kind,
 *  the first answer still out, a refused key or a question with no rows. */
export function FinderEmptyState(props: {
  readonly kindSourcesOff: boolean;
  readonly pendingFirst: boolean;
  readonly failures: readonly AssetPage[];
  readonly onOpenConnections?: () => void;
  readonly onRetry: () => void;
  readonly hasRows: boolean;
  readonly query: string;
  readonly onClearQuery: () => void;
}): React.ReactNode {
  if (props.kindSourcesOff) {
    return (
      <div data-yunari-asset-kind-off="">
        <FinderState message={uiCopy.assets.kindSourcesOff} />
      </div>
    );
  }
  if (props.pendingFirst) {
    return (
      <div
        data-yunari-asset-loading=""
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <FinderSkeleton />
      </div>
    );
  }
  // A missing key is not the query's fault, and retrying cannot install one:
  // the body offers the control that can.
  if (
    props.failures.length > 0 &&
    props.failures.every((page) => page.failure?.reason === "needs-credential")
  ) {
    return (
      <div data-yunari-asset-needs-key="">
        <FinderState
          message={uiCopy.assets.needsKeyBody}
          {...(props.onOpenConnections === undefined
            ? {}
            : {
                action: {
                  label: uiCopy.assets.connectionsAction,
                  onClick: props.onOpenConnections,
                },
              })}
        />
      </div>
    );
  }
  if (props.failures.length > 0) {
    return (
      <div data-yunari-asset-failed="">
        <FinderState
          message={uiCopy.assets.emptyAfterFailure}
          action={{ label: uiCopy.assets.retry, onClick: props.onRetry }}
        />
      </div>
    );
  }
  // The tab's filter can hide every row an answer did bring; that is not a
  // failed question, so the query is not offered for clearing.
  if (props.hasRows) {
    return (
      <div data-yunari-asset-empty="">
        <FinderState message={uiCopy.assets.noResults} />
      </div>
    );
  }
  if (props.query === "") {
    return (
      <div data-yunari-asset-nothing="">
        <FinderState message={uiCopy.assets.nothingToBrowse} />
      </div>
    );
  }
  return (
    <div data-yunari-asset-empty="">
      <FinderState
        message={uiCopy.assets.noResults}
        action={{
          label: uiCopy.assets.clearQuery,
          onClick: props.onClearQuery,
          data: { "data-yunari-asset-clear-query": "" },
        }}
      />
    </div>
  );
}

/** The finder before its grid exists: the listing is out, the host is absent,
 *  or no category has a source. */
export function FinderPlaceholderDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly state: "loading" | "failed" | "no-source";
}): React.JSX.Element {
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      label={uiCopy.assets.title}
      closeLabel={uiCopy.assets.close}
      closeIcon
      className="editor-shell-dialog--finder"
    >
      {props.state === "failed" ? (
        <p
          className="p-[var(--space-16)] text-sm text-muted"
          data-yunari-asset-host-failure=""
        >
          {uiCopy.assets.hostUnavailable}
        </p>
      ) : props.state === "loading" ? (
        <div
          data-yunari-asset-listing-skeleton=""
          className="min-h-0 flex-1 overflow-y-auto p-[var(--space-16)]"
        >
          <FinderSkeleton />
        </div>
      ) : (
        <p className="p-[var(--space-16)] text-sm text-muted">
          {uiCopy.assets.noSource}
        </p>
      )}
    </Dialog>
  );
}
