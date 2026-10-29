import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { clearCredential } from "../asset-finder/credentials-client.js";
import { plainButtonClasses } from "../components/ui/control-well.js";
import { uiCopy } from "../ui-copy.js";
import { Group } from "./section-group.js";
import { SourceForm } from "./source-form.js";
import {
  type RemovalAnswer,
  SourceRefusedError,
  type SourceRow,
  type SourcesClient,
  type TestResult,
} from "./sources-client.js";
import {
  type Draft,
  draftOf,
  emptyDraft,
  type FieldDraft,
  problem,
  type Refusal,
  sourceOf,
} from "./sources-draft.js";

/**
 * The custom sources this PC reads: the list, one source's form, and the two
 * commands that belong to the host rather than to the editor.
 *
 * **The editor links here; it does not own a source.** The file, the provider
 * and the credential references are the host's, and this section only reads and
 * writes them through the loopback routes. It never shows a credential value:
 * `auth.credentialId` is an id, and the only credential command here is the
 * removal the delete route itself offered.
 *
 * **The address is printed exactly as authored.** The host refuses a URL with a
 * username or password, and a key referenced through `auth` travels in a header
 * or a query the host adds at fetch time — this page never composes one into the
 * address it shows (the sources routes' own rule).
 */

/** A message a person can act on: the host's own words where it sent any. */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function SourcesSection(props: {
  readonly sources: SourcesClient;
  /** The region's own status writer, which is stable because it is a setter. */
  readonly report: (status: string) => void;
}): React.JSX.Element {
  const { sources, report } = props;
  const [rows, setRows] = useState<readonly SourceRow[] | undefined>(undefined);
  /** A read that failed gets its own sentence in the section rather than the
   *  region's status line: the list may still be readable one tick later, and a
   *  failure here is not a failure of the whole Host mode. */
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState<Draft | undefined>(undefined);
  const [editing, setEditing] = useState<SourceRow | undefined>(undefined);
  const [refusal, setRefusal] = useState<Refusal | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<string | undefined>(undefined);
  const [tested, setTested] = useState<
    { readonly id: string; readonly result: TestResult } | undefined
  >(undefined);
  /** The row whose confirmation is showing. */
  const [deleting, setDeleting] = useState<string | undefined>(undefined);
  /** The credential the delete route said nothing references any more. */
  const [credentialOffer, setCredentialOffer] = useState<string | undefined>(
    undefined,
  );

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    sources.list().then(
      (listed) => {
        if (!live) return;
        setRows(listed);
        setLoadError(undefined);
      },
      (error: unknown) => {
        if (live) setLoadError(reason(error));
      },
    );
    return () => {
      live = false;
    };
  }, [sources]);

  const refresh = (): void => {
    void sources.list().then(
      (listed) => {
        if (!mounted.current) return;
        setRows(listed);
        setLoadError(undefined);
      },
      (error: unknown) => {
        if (mounted.current) setLoadError(reason(error));
      },
    );
  };

  const openAdd = (): void => {
    setEditing(undefined);
    setDraft(emptyDraft());
    setRefusal(undefined);
  };

  const openEdit = (row: SourceRow): void => {
    setEditing(row);
    setDraft(draftOf(row));
    setRefusal(undefined);
  };

  const closeForm = (): void => {
    setDraft(undefined);
    setEditing(undefined);
    setRefusal(undefined);
  };

  const change = (next: Partial<Draft>): void => {
    setDraft((current) =>
      current === undefined ? current : { ...current, ...next },
    );
  };

  const changeField = (index: number, next: Partial<FieldDraft>): void => {
    setDraft((current) => {
      if (current === undefined) return current;
      const fields = current.fields.map((field, position) =>
        position === index ? { ...field, ...next } : field,
      );
      return { ...current, fields };
    });
  };

  const submit = (): void => {
    if (draft === undefined || busy) return;
    const found = problem(draft, editing);
    if (found !== undefined) {
      setRefusal(found);
      return;
    }

    const source = sourceOf(draft, editing);
    setBusy(true);
    setRefusal(undefined);
    report(uiCopy.hostSettings.status.saving);
    void sources.save(source).then(
      () => {
        if (!mounted.current) return;
        setBusy(false);
        closeForm();
        report(uiCopy.hostSettings.sources.saved);
        refresh();
      },
      (error: unknown) => {
        if (!mounted.current) return;
        setBusy(false);
        // The route names the source it refused, and the form shows that
        // reason at the form's own edge because it is not one input's answer.
        setRefusal(
          error instanceof SourceRefusedError
            ? { field: error.field, reason: error.reason }
            : { field: "", reason: reason(error) },
        );
        // The status line is the region's own report of the write; leaving it
        // on "Saving…" would outlive the refusal it was waiting for.
        report(uiCopy.hostSettings.status.failed(reason(error)));
      },
    );
  };

  const remove = (row: SourceRow): void => {
    report(uiCopy.hostSettings.sources.deleting);
    void sources.remove(row.id).then(
      (answer: RemovalAnswer) => {
        if (!mounted.current) return;
        setDeleting(undefined);
        setRows((current) =>
          current === undefined
            ? current
            : current.filter((entry) => entry.id !== row.id),
        );
        report(uiCopy.hostSettings.sources.removed(row.name || row.id));
        if (answer.unreferencedCredential !== null) {
          setCredentialOffer(answer.unreferencedCredential);
        }
      },
      (error: unknown) => {
        if (!mounted.current) return;
        report(uiCopy.hostSettings.sources.deleteFailed(reason(error)));
      },
    );
  };

  const runTest = (row: SourceRow): void => {
    setTesting(row.id);
    setTested(undefined);
    void sources.test(row.id).then(
      (result) => {
        if (!mounted.current) return;
        setTesting(undefined);
        setTested({ id: row.id, result });
      },
      (error: unknown) => {
        if (!mounted.current) return;
        setTesting(undefined);
        setTested({
          id: row.id,
          result: {
            ok: false,
            elapsedMs: 0,
            values: [],
            reason: reason(error),
          },
        });
      },
    );
  };

  const removeCredential = (id: string): void => {
    void clearCredential(id).then(
      (result) => {
        if (!mounted.current) return;
        setCredentialOffer(undefined);
        report(
          result.ok
            ? uiCopy.hostSettings.sources.credentialRemoved
            : uiCopy.hostSettings.sources.credentialFailed(result.message),
        );
      },
      (error: unknown) => {
        if (!mounted.current) return;
        report(uiCopy.hostSettings.sources.credentialFailed(reason(error)));
      },
    );
  };

  const copy = uiCopy.hostSettings.sources;

  return (
    <Group testId="sources" name={copy.heading} hint={copy.hint}>
      {loadError === undefined ? null : (
        <p role="alert" className="text-xs text-muted">
          {loadError}
        </p>
      )}

      {rows === undefined ? null : rows.length === 0 ? (
        <p className="text-xs text-muted">{copy.empty}</p>
      ) : (
        rows.map((row) => (
          <div
            key={row.id}
            data-yunari-source-row={row.id}
            className="flex flex-col gap-[var(--space-4)] rounded-lg border border-edge bg-panel-2 px-[var(--space-10)] py-[var(--space-8)]"
          >
            <div className="flex items-center gap-[var(--space-8)]">
              <span className="min-w-0 flex-1 text-xs text-text">
                {row.name === "" ? row.id : row.name}
              </span>
              <span className="text-2xs text-faint">{row.id}</span>
              <span
                data-yunari-source-health={row.health}
                className="text-2xs text-muted"
              >
                {copy.health[row.health]}
              </span>
            </div>
            {/* The authored address, never one a credential was spelled into. */}
            <p
              data-yunari-source-row-url={row.id}
              className="m-0 text-2xs break-all text-muted"
            >
              {row.url}
            </p>
            <p className="m-0 text-2xs text-faint">
              {copy.fieldCount(row.fieldCount)}
              {" · "}
              {row.lastSuccessAt === null
                ? copy.neverRead
                : copy.lastSuccess(row.lastSuccessAt)}
            </p>
            {row.lastError === null ? null : (
              <p
                data-yunari-source-last-error={row.id}
                className="m-0 text-2xs text-muted"
              >
                {row.lastError}
              </p>
            )}
            <div className="flex flex-wrap gap-[var(--space-6)]">
              <button
                type="button"
                data-yunari-source-edit={row.id}
                aria-label={copy.editSource(row.name || row.id)}
                className={plainButtonClasses}
                onClick={() => openEdit(row)}
              >
                {copy.edit}
              </button>
              <button
                type="button"
                data-yunari-source-test={row.id}
                aria-label={copy.testSource(row.name || row.id)}
                className={plainButtonClasses}
                disabled={testing === row.id}
                onClick={() => runTest(row)}
              >
                {testing === row.id ? copy.testing : copy.test}
              </button>
              <button
                type="button"
                data-yunari-source-delete={row.id}
                aria-label={copy.deleteSource(row.name || row.id)}
                className={plainButtonClasses}
                onClick={() => setDeleting(row.id)}
              >
                {copy.remove}
              </button>
            </div>

            {tested?.id === row.id ? (
              <p
                data-yunari-source-test-result={row.id}
                className="m-0 text-2xs text-muted"
              >
                {copy.testLine(
                  tested.result.ok,
                  tested.result.status,
                  tested.result.elapsedMs,
                  tested.result.values,
                  tested.result.reason,
                )}
              </p>
            ) : null}

            {deleting === row.id ? (
              <div
                data-yunari-source-confirm={row.id}
                className="flex flex-col gap-[var(--space-6)] rounded-md border border-edge p-[var(--space-8)]"
              >
                <p className="m-0 text-2xs text-muted">
                  {copy.removeAsk(row.name || row.id)}
                </p>
                <div className="flex gap-[var(--space-6)]">
                  <button
                    type="button"
                    data-yunari-source-confirm-delete={row.id}
                    className={plainButtonClasses}
                    onClick={() => remove(row)}
                  >
                    {copy.confirmRemove}
                  </button>
                  <button
                    type="button"
                    data-yunari-source-confirm-cancel={row.id}
                    className={plainButtonClasses}
                    onClick={() => setDeleting(undefined)}
                  >
                    {copy.keep}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ))
      )}

      {credentialOffer === undefined ? null : (
        <div
          data-yunari-source-credential-offer={credentialOffer}
          className="flex flex-col gap-[var(--space-6)] rounded-md border border-edge p-[var(--space-8)]"
        >
          <p className="m-0 text-2xs text-muted">
            {copy.credentialAsk(credentialOffer)}
          </p>
          <div className="flex gap-[var(--space-6)]">
            <button
              type="button"
              data-yunari-source-remove-credential=""
              className={plainButtonClasses}
              onClick={() => removeCredential(credentialOffer)}
            >
              {copy.removeCredential}
            </button>
            <button
              type="button"
              data-yunari-source-keep-credential=""
              className={plainButtonClasses}
              onClick={() => setCredentialOffer(undefined)}
            >
              {copy.keepCredential}
            </button>
          </div>
        </div>
      )}

      {draft === undefined ? (
        <button
          type="button"
          data-yunari-source-add=""
          className={plainButtonClasses}
          onClick={openAdd}
        >
          {copy.add}
        </button>
      ) : (
        <SourceForm
          draft={draft}
          editing={editing}
          busy={busy}
          refusal={refusal}
          onChange={change}
          onChangeField={changeField}
          onSubmit={submit}
          onCancel={closeForm}
        />
      )}
    </Group>
  );
}
