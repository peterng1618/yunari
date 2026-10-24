import type * as React from "react";
import { useEffect, useId, useRef, useState } from "react";
import { clearCredential } from "../asset-finder/credentials-client.js";
import { plainButtonClasses } from "../components/ui/control-well.js";
import { uiCopy } from "../ui-copy.js";
import { Group } from "./section-group.js";
import {
  type RemovalAnswer,
  type Source,
  type SourceField,
  SourceRefusedError,
  type SourceRow,
  type SourcesClient,
  type TestResult,
} from "./sources-client.js";

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
 * address it shows (`docs/decisions`, the sources routes' own rule).
 */

/** The host's limits, restated because the editor has no dependency on the host
 *  package. **The owner is `packages/host/src/settings/sources.ts`**; the route's
 *  `400 {field, reason}` is the authority and these checks only save a round
 *  trip. Keep them in step with that file rather than widening them here. */
const SOURCE_ID = /^[a-z0-9_-]{1,32}$/;
const MAX_FIELDS = 64;
const MIN_INTERVAL_S = 10;
const MAX_INTERVAL_S = 86_400;
const DEFAULT_INTERVAL_S = 60;
const MIN_TIMEOUT_S = 1;
const MAX_TIMEOUT_S = 10;
const DEFAULT_TIMEOUT_S = 5;

/** A refusal the form is showing, beside the field that caused it where the
 *  field is one the form names. */
interface Refusal {
  readonly field: string;
  readonly reason: string;
}

interface FieldDraft {
  readonly id: string;
  readonly label: string;
  readonly pointer: string;
  readonly type: SourceField["type"];
  readonly unit: string;
}

interface Draft {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly interval: string;
  readonly timeout: string;
  readonly fields: readonly FieldDraft[];
}

function emptyField(): FieldDraft {
  return { id: "", label: "", pointer: "", type: "number", unit: "" };
}

function draftOf(row: SourceRow): Draft {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    interval: String(row.intervalMs / 1000),
    timeout: String(row.timeoutMs / 1000),
    fields: row.fields.map((field) => ({
      id: field.id,
      label: field.label,
      pointer: field.pointer,
      type: field.type,
      unit: field.unit ?? "",
    })),
  };
}

function emptyDraft(): Draft {
  return {
    id: "",
    name: "",
    url: "",
    interval: String(DEFAULT_INTERVAL_S),
    timeout: String(DEFAULT_TIMEOUT_S),
    // No field until the author adds one: a row with a blank id would be a
    // refusal the form invented rather than one they typed.
    fields: [],
  };
}

function wholeSeconds(
  value: string,
  min: number,
  max: number,
): number | undefined {
  if (!/^\d+$/.test(value.trim())) return undefined;
  const seconds = Number(value.trim());
  return Number.isInteger(seconds) && seconds >= min && seconds <= max
    ? seconds
    : undefined;
}

/** The first thing wrong with the form, in the host's own terms. Each answer
 *  names the form field it belongs beside, so the reason can be shown there. */
function problem(draft: Draft): Refusal | undefined {
  const copy = uiCopy.hostSettings.sources;
  if (!SOURCE_ID.test(draft.id)) {
    return { field: "id", reason: copy.invalidId };
  }

  let url: URL;
  try {
    url = new URL(draft.url);
  } catch {
    return { field: "url", reason: copy.invalidUrl };
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== ""
  ) {
    return { field: "url", reason: copy.invalidUrl };
  }

  if (
    wholeSeconds(draft.interval, MIN_INTERVAL_S, MAX_INTERVAL_S) === undefined
  ) {
    return {
      field: "interval",
      reason: copy.invalidInterval(MIN_INTERVAL_S, MAX_INTERVAL_S),
    };
  }
  if (wholeSeconds(draft.timeout, MIN_TIMEOUT_S, MAX_TIMEOUT_S) === undefined) {
    return {
      field: "timeout",
      reason: copy.invalidTimeout(MIN_TIMEOUT_S, MAX_TIMEOUT_S),
    };
  }

  if (draft.fields.length > MAX_FIELDS) {
    return { field: "fields", reason: copy.tooManyFields(MAX_FIELDS) };
  }

  const seen = new Set<string>();
  for (const field of draft.fields) {
    if (!SOURCE_ID.test(field.id)) {
      return { field: "fields", reason: copy.invalidFieldId(field.id) };
    }
    if (seen.has(field.id)) {
      return { field: "fields", reason: copy.duplicateField(field.id) };
    }
    seen.add(field.id);
  }

  return undefined;
}

/** The wire object, keeping the parts the form does not edit when it is editing
 *  an existing row: the route replaces the whole source, so a save that dropped
 *  `auth` would unbind the credential the row already had. */
function sourceOf(draft: Draft, base: SourceRow | undefined): Source {
  return {
    id: draft.id,
    name: draft.name,
    url: draft.url,
    ...(base?.query === undefined ? {} : { query: base.query }),
    ...(base?.headers === undefined ? {} : { headers: base.headers }),
    intervalMs: Number(draft.interval) * 1000,
    timeoutMs: Number(draft.timeout) * 1000,
    ...(base?.auth === undefined ? {} : { auth: base.auth }),
    fields: draft.fields.map((field) => ({
      id: field.id,
      label: field.label,
      pointer: field.pointer,
      type: field.type,
      ...(field.unit.trim() === "" ? {} : { unit: field.unit.trim() }),
    })),
  };
}

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
    const found = problem(draft);
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
      },
    );
  };

  const remove = (row: SourceRow): void => {
    report(uiCopy.hostSettings.status.saving);
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
        report(uiCopy.hostSettings.status.failed(reason(error)));
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
  const inline = (field: string): string | undefined =>
    refusal?.field === field ? refusal.reason : undefined;
  /** A reason whose field this form does not own — the host names the source,
   *  not the input — is shown at the form's edge rather than under a field the
   *  author did not fill. */
  const formReason =
    refusal === undefined ||
    refusal.field === "id" ||
    refusal.field === "url" ||
    refusal.field === "interval" ||
    refusal.field === "timeout"
      ? undefined
      : refusal.reason;

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
                className={plainButtonClasses}
                onClick={() => openEdit(row)}
              >
                {copy.edit}
              </button>
              <button
                type="button"
                data-yunari-source-test={row.id}
                className={plainButtonClasses}
                disabled={testing === row.id}
                onClick={() => runTest(row)}
              >
                {testing === row.id ? copy.testing : copy.test}
              </button>
              <button
                type="button"
                data-yunari-source-delete={row.id}
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
        <form
          data-yunari-source-form={editing?.id ?? "new"}
          className="flex flex-col gap-[var(--space-6)] rounded-lg border border-edge bg-panel-2 p-[var(--space-10)]"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <FormField
            label={copy.id}
            value={draft.id}
            reason={inline("id")}
            attribute="data-yunari-source-id"
            onChange={(id) => change({ id })}
          />
          <FormField
            label={copy.name}
            value={draft.name}
            attribute="data-yunari-source-name"
            onChange={(name) => change({ name })}
          />
          <FormField
            label={copy.url}
            value={draft.url}
            hint={copy.urlHint}
            reason={inline("url")}
            attribute="data-yunari-source-url"
            onChange={(url) => change({ url })}
          />
          <FormField
            label={copy.interval}
            value={draft.interval}
            hint={copy.seconds}
            reason={inline("interval")}
            attribute="data-yunari-source-interval"
            onChange={(interval) => change({ interval })}
          />
          <FormField
            label={copy.timeout}
            value={draft.timeout}
            hint={copy.seconds}
            reason={inline("timeout")}
            attribute="data-yunari-source-timeout"
            onChange={(timeout) => change({ timeout })}
          />

          <h3 className="m-0 pt-[var(--space-4)] text-2xs font-semibold tracking-[0.11em] text-muted uppercase">
            {copy.fields}
          </h3>
          {draft.fields.map((field, index) => (
            <div
              // The index is the row's identity here: the author is editing an
              // id the row may not have yet, so the id cannot key it.
              key={index}
              data-yunari-source-field={String(index)}
              className="flex flex-col gap-[var(--space-4)] rounded-md border border-edge p-[var(--space-8)]"
            >
              <FormField
                label={copy.fieldId}
                value={field.id}
                attribute="data-yunari-source-field-id"
                onChange={(id) => changeField(index, { id })}
              />
              <FormField
                label={copy.fieldLabel}
                value={field.label}
                attribute="data-yunari-source-field-label"
                onChange={(label) => changeField(index, { label })}
              />
              <FormField
                label={copy.fieldPointer}
                value={field.pointer}
                attribute="data-yunari-source-field-pointer"
                onChange={(pointer) => changeField(index, { pointer })}
              />
              <div className="flex flex-col gap-[var(--space-4)]">
                <label
                  className="text-xs text-muted"
                  htmlFor={`yunari-source-type-${index}`}
                >
                  {copy.fieldType}
                </label>
                <select
                  id={`yunari-source-type-${index}`}
                  data-yunari-source-field-type={String(index)}
                  value={field.type}
                  onChange={(event) =>
                    changeField(index, {
                      type: event.target.value as FieldDraft["type"],
                    })
                  }
                  className="h-[26px] rounded-md border border-edge bg-panel-1 px-[var(--space-6)] text-sm text-text"
                >
                  <option value="number">{copy.types.number}</option>
                  <option value="text">{copy.types.text}</option>
                  <option value="boolean">{copy.types.boolean}</option>
                </select>
              </div>
              <FormField
                label={copy.fieldUnit}
                value={field.unit}
                attribute="data-yunari-source-field-unit"
                onChange={(unit) => changeField(index, { unit })}
              />
              <button
                type="button"
                data-yunari-source-remove-field={String(index)}
                aria-label={copy.removeField(field.id)}
                className={plainButtonClasses}
                onClick={() =>
                  change({
                    fields: draft.fields.filter(
                      (_, position) => position !== index,
                    ),
                  })
                }
              >
                {copy.remove}
              </button>
            </div>
          ))}
          <button
            type="button"
            data-yunari-source-add-field=""
            className={plainButtonClasses}
            onClick={() => change({ fields: [...draft.fields, emptyField()] })}
          >
            {copy.addField}
          </button>

          {formReason === undefined ? null : (
            <p
              role="alert"
              data-yunari-source-error=""
              className="m-0 text-xs text-muted"
            >
              {formReason}
            </p>
          )}

          <div className="flex gap-[var(--space-6)]">
            <button
              type="submit"
              data-yunari-source-save=""
              className={plainButtonClasses}
              disabled={busy}
            >
              {busy ? uiCopy.hostSettings.status.saving : copy.save}
            </button>
            <button
              type="button"
              data-yunari-source-cancel=""
              className={plainButtonClasses}
              onClick={closeForm}
            >
              {copy.cancel}
            </button>
          </div>
        </form>
      )}
    </Group>
  );
}

/**
 * One labelled text input in a source's form.
 *
 * Not `ControlText`: that control commits on blur and holds the authored value,
 * and a source form is submitted whole — the draft is the form's until Save.
 */
function FormField(props: {
  readonly label: string;
  readonly value: string;
  readonly attribute: string;
  readonly hint?: string | undefined;
  readonly reason?: string | undefined;
  readonly onChange: (value: string) => void;
}): React.JSX.Element {
  const id = useId();
  return (
    <div className="flex flex-col gap-[var(--space-4)]">
      <label className="text-xs text-muted" htmlFor={id}>
        {props.label}
      </label>
      <input
        id={id}
        {...{ [props.attribute]: "" }}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className="h-[26px] rounded-md border border-edge bg-panel-1 px-[var(--space-6)] text-sm text-text"
      />
      {props.hint === undefined ? null : (
        <p className="m-0 text-2xs text-faint">{props.hint}</p>
      )}
      {props.reason === undefined ? null : (
        <p role="alert" className="m-0 text-2xs text-muted">
          {props.reason}
        </p>
      )}
    </div>
  );
}
