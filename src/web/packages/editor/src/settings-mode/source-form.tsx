import type * as React from "react";
import { useId } from "react";
import { plainButtonClasses } from "../components/ui/control-well.js";
import { uiCopy } from "../ui-copy.js";
import type { SourceRow } from "./sources-client.js";
import {
  type Draft,
  emptyField,
  type FieldDraft,
  type Refusal,
} from "./sources-draft.js";

/**
 * One source's add/edit form. The draft is the form's until Save: every input
 * writes the draft, and the section owns the commit and the write.
 */
export function SourceForm(props: {
  readonly draft: Draft;
  readonly editing: SourceRow | undefined;
  readonly busy: boolean;
  readonly refusal: Refusal | undefined;
  readonly onChange: (next: Partial<Draft>) => void;
  readonly onChangeField: (index: number, next: Partial<FieldDraft>) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const { draft, editing, refusal } = props;
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
    <form
      data-yunari-source-form={editing?.id ?? "new"}
      className="flex flex-col gap-[var(--space-6)] rounded-lg border border-edge bg-panel-2 p-[var(--space-10)]"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      <FormField
        label={copy.id}
        value={draft.id}
        hint={editing === undefined ? undefined : copy.idFixed}
        reason={inline("id")}
        readOnly={editing !== undefined}
        attribute="data-yunari-source-id"
        onChange={(id) => props.onChange({ id })}
      />
      <FormField
        label={copy.name}
        value={draft.name}
        attribute="data-yunari-source-name"
        onChange={(name) => props.onChange({ name })}
      />
      <FormField
        label={copy.url}
        value={draft.url}
        hint={copy.urlHint}
        reason={inline("url")}
        attribute="data-yunari-source-url"
        onChange={(url) => props.onChange({ url })}
      />
      <FormField
        label={copy.interval}
        value={draft.interval}
        hint={copy.seconds}
        reason={inline("interval")}
        attribute="data-yunari-source-interval"
        onChange={(interval) => props.onChange({ interval })}
      />
      <FormField
        label={copy.timeout}
        value={draft.timeout}
        hint={copy.seconds}
        reason={inline("timeout")}
        attribute="data-yunari-source-timeout"
        onChange={(timeout) => props.onChange({ timeout })}
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
            onChange={(id) => props.onChangeField(index, { id })}
          />
          <FormField
            label={copy.fieldLabel}
            value={field.label}
            attribute="data-yunari-source-field-label"
            onChange={(label) => props.onChangeField(index, { label })}
          />
          <FormField
            label={copy.fieldPointer}
            value={field.pointer}
            attribute="data-yunari-source-field-pointer"
            onChange={(pointer) => props.onChangeField(index, { pointer })}
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
                props.onChangeField(index, {
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
            onChange={(unit) => props.onChangeField(index, { unit })}
          />
          <button
            type="button"
            data-yunari-source-remove-field={String(index)}
            aria-label={copy.removeField(field.id)}
            className={plainButtonClasses}
            onClick={() =>
              props.onChange({
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
        onClick={() =>
          props.onChange({ fields: [...draft.fields, emptyField()] })
        }
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
          disabled={props.busy}
        >
          {props.busy ? uiCopy.hostSettings.status.saving : copy.save}
        </button>
        <button
          type="button"
          data-yunari-source-cancel=""
          className={plainButtonClasses}
          onClick={props.onCancel}
        >
          {copy.cancel}
        </button>
      </div>
    </form>
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
  /** A value the form shows but does not change — the source id while editing. */
  readonly readOnly?: boolean;
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
        readOnly={props.readOnly}
        onChange={(event) => props.onChange(event.target.value)}
        className="h-[26px] rounded-md border border-edge bg-panel-1 px-[var(--space-6)] text-sm text-text"
      />
      {props.hint === undefined ? null : (
        <p className="m-0 text-2xs text-faint">{props.hint}</p>
      )}
      {props.reason === undefined ? null : (
        <p
          role="alert"
          data-yunari-source-field-reason=""
          className="m-0 text-2xs text-muted"
        >
          {props.reason}
        </p>
      )}
    </div>
  );
}
