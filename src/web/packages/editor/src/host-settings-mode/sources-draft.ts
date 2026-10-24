import { uiCopy } from "../ui-copy.js";
import type { Source, SourceField, SourceRow } from "./sources-client.js";

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
export interface Refusal {
  readonly field: string;
  readonly reason: string;
}

export interface FieldDraft {
  readonly id: string;
  readonly label: string;
  readonly pointer: string;
  readonly type: SourceField["type"];
  readonly unit: string;
  /** The stored field this row was opened from. The form shows five of its
   *  properties; the rest travel through an edit untouched because the route
   *  replaces the whole source. Absent on a field the author just added. */
  readonly original?: SourceField;
}

export interface Draft {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly interval: string;
  readonly timeout: string;
  readonly fields: readonly FieldDraft[];
}

export function emptyField(): FieldDraft {
  return { id: "", label: "", pointer: "", type: "number", unit: "" };
}

export function draftOf(row: SourceRow): Draft {
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
      original: field,
    })),
  };
}

export function emptyDraft(): Draft {
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
export function problem(
  draft: Draft,
  stored: SourceRow | undefined,
): Refusal | undefined {
  const copy = uiCopy.hostSettings.sources;
  // A rename is a new source, not an edit: the id is embedded in every theme
  // key that reads `custom.<id>.<field>`. The field is read-only while editing,
  // and this is the guard for a draft that reached here some other way.
  if (stored !== undefined && draft.id !== stored.id) {
    return { field: "id", reason: copy.idFixed };
  }
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

/**
 * One field as the wire carries it: the stored object underneath, so every
 * property the form does not show survives the replace, and the draft's own
 * five over it.
 *
 * `unit` is the one shown property that may be removed, so it is taken off the
 * stored object rather than left to be overridden only when the draft has one.
 */
function mergedField(field: FieldDraft): SourceField {
  const stored: Partial<SourceField> =
    field.original === undefined
      ? {}
      : (Object.fromEntries(
          Object.entries(field.original).filter(([key]) => key !== "unit"),
        ) as Partial<SourceField>);
  const unit = field.unit.trim();
  return {
    ...stored,
    id: field.id,
    label: field.label,
    pointer: field.pointer,
    type: field.type,
    ...(unit === "" ? {} : { unit }),
  };
}

/** The wire object, keeping the parts the form does not edit when it is editing
 *  an existing row: the route replaces the whole source, so a save that dropped
 *  `auth` would unbind the credential the row already had, and a save that
 *  rebuilt fields from the five shown would drop `family`, `unitKind`, `scale`,
 *  `offset` and `expectedTier`.
 *
 * **The stored id is the id written**, because a rename would append a second
 * source rather than change the first. */
export function sourceOf(draft: Draft, base: SourceRow | undefined): Source {
  return {
    id: base?.id ?? draft.id,
    name: draft.name,
    url: draft.url,
    ...(base?.query === undefined ? {} : { query: base.query }),
    ...(base?.headers === undefined ? {} : { headers: base.headers }),
    intervalMs: Number(draft.interval) * 1000,
    timeoutMs: Number(draft.timeout) * 1000,
    ...(base?.auth === undefined ? {} : { auth: base.auth }),
    fields: draft.fields.map(mergedField),
  };
}
