import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type SensorTier,
  UNIT_KINDS,
  type UnitKind,
} from "@yunari/renderer-core";

/**
 * Custom HTTP sources, authored on the host and read by the custom provider.
 *
 * The file holds references only: `auth.credentialId` names an entry in
 * `credentials.json`, whose value never leaves the host process. Validation is
 * a pure function so the settings page and the store refuse the same input.
 */
export interface CustomField {
  readonly id: string;
  readonly label: string;
  readonly pointer: string;
  readonly type: "number" | "text" | "boolean";
  readonly family?: string;
  readonly unit?: string;
  readonly unitKind?: UnitKind;
  readonly scale?: number;
  readonly offset?: number;
  readonly expectedTier?: SensorTier;
}

export interface CustomSource {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly intervalMs: number;
  readonly timeoutMs: number;
  readonly auth?: {
    readonly kind: "none" | "bearer" | "basic" | "header" | "query";
    readonly credentialId?: string;
    readonly headerName?: string;
    readonly queryName?: string;
  };
  readonly fields: readonly CustomField[];
}

export interface SourceIssue {
  readonly sourceId: string;
  readonly reason: string;
}

export interface SourceFile {
  readonly sources: readonly CustomSource[];
  readonly issues: readonly SourceIssue[];
}

export interface SourceStore {
  /** The validated projection of the file, with every entry it skipped. */
  read(): Promise<SourceFile>;
  /** Persists the object as given — never the projection — and reports what a
   *  read would skip, so an entry the store cannot parse is not dropped. */
  write(input: unknown): Promise<SourceFile>;
  /**
   * Read-raw, mutate, save, all inside the store's one queue, so a read and a
   * write from two requests cannot interleave. Returns the saved file's
   * validated projection. Returning the object the mutator was given skips the
   * save, which is how a route refuses to rewrite a file it did not change.
   */
  update(mutate: (raw: unknown) => unknown): Promise<SourceFile>;
}

/** A refusal raised by an `update` mutator: nothing is written. */
export class SourceUpdateRefused extends Error {
  readonly issue: SourceIssue;

  constructor(issue: SourceIssue) {
    super(issue.reason);
    this.name = "SourceUpdateRefused";
    this.issue = issue;
  }
}

/** A test seam for the atomic-write proof; production always renames. */
export interface SourceStoreOptions {
  readonly rename?: (from: string, to: string) => Promise<void>;
}

const FILE = "sources.json";
const ID = /^[a-z0-9_-]{1,32}$/;
const MAX_SOURCES = 32;
const MAX_FIELDS = 64;
const INTERVAL_MIN = 10_000;
const INTERVAL_MAX = 86_400_000;
const INTERVAL_DEFAULT = 60_000;
const TIMEOUT_MIN = 1_000;
const TIMEOUT_MAX = 10_000;

const SOURCE_KEYS: ReadonlySet<string> = new Set([
  "id",
  "name",
  "url",
  "query",
  "headers",
  "intervalMs",
  "timeoutMs",
  "auth",
  "fields",
]);

const FIELD_KEYS: ReadonlySet<string> = new Set([
  "id",
  "label",
  "pointer",
  "type",
  "family",
  "unit",
  "unitKind",
  "scale",
  "offset",
  "expectedTier",
]);

const AUTH_KEYS: ReadonlySet<string> = new Set([
  "kind",
  "credentialId",
  "headerName",
  "queryName",
]);

/** The conversion kinds the vocabulary declares, imported rather than copied so
 *  the wire refuses exactly what the renderer cannot honour. */
const UNIT_KIND_SET: ReadonlySet<string> = new Set(UNIT_KINDS);

type Auth = NonNullable<CustomSource["auth"]>;

type Checked<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

function fail(reason: string): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownKey(
  raw: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  owner: string,
): string | undefined {
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) return `${owner} has an unknown key "${key}"`;
  }
  return undefined;
}

/** A header or query map, built through `Object.fromEntries` so `__proto__` is
 *  stored as a key rather than reaching the record's prototype. */
function asTextRecord(
  value: unknown,
  label: string,
): Checked<Readonly<Record<string, string>>> {
  if (!isObject(value)) return fail(`${label} must be an object of strings`);

  const pairs: [string, string][] = [];

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      return fail(`${label}["${key}"] must be a string`);
    }
    pairs.push([key, entry]);
  }

  return { ok: true, value: Object.fromEntries(pairs) };
}

function asDuration(
  value: unknown,
  label: string,
  min: number,
  max: number,
  fallback?: number,
): Checked<number> {
  if (value === undefined) {
    return fallback === undefined
      ? fail(`${label} is required (${min}..${max} ms)`)
      : { ok: true, value: fallback };
  }

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    return fail(`${label} must be ${min}..${max} ms`);
  }

  return { ok: true, value };
}

function asAuth(value: unknown, owner: string): Checked<Auth> {
  if (!isObject(value)) return fail(`${owner} auth must be an object`);

  const unknown = unknownKey(value, AUTH_KEYS, `${owner} auth`);
  if (unknown !== undefined) return fail(unknown);

  const kind = value.kind;
  if (
    kind !== "none" &&
    kind !== "bearer" &&
    kind !== "basic" &&
    kind !== "header" &&
    kind !== "query"
  ) {
    return fail(`${owner} auth kind must be none|bearer|basic|header|query`);
  }

  const credentialId = value.credentialId;
  if (credentialId !== undefined) {
    if (typeof credentialId !== "string" || !ID.test(credentialId)) {
      return fail(`${owner} credentialId must match [a-z0-9_-]{1,32}`);
    }
  }

  const headerName = value.headerName;
  if (
    headerName !== undefined &&
    (typeof headerName !== "string" || headerName === "")
  ) {
    return fail(`${owner} headerName must be a non-empty string`);
  }

  const queryName = value.queryName;
  if (
    queryName !== undefined &&
    (typeof queryName !== "string" || queryName === "")
  ) {
    return fail(`${owner} queryName must be a non-empty string`);
  }

  if (kind === "header" && headerName === undefined) {
    return fail(`${owner} auth kind "header" needs a headerName`);
  }

  if (kind === "query" && queryName === undefined) {
    return fail(`${owner} auth kind "query" needs a queryName`);
  }

  return {
    ok: true,
    value: {
      kind,
      ...(credentialId === undefined ? {} : { credentialId }),
      ...(headerName === undefined ? {} : { headerName }),
      ...(queryName === undefined ? {} : { queryName }),
    },
  };
}

function asField(
  value: unknown,
  owner: string,
  seen: Set<string>,
): Checked<CustomField> {
  if (!isObject(value)) return fail(`${owner} is not an object`);

  const unknown = unknownKey(value, FIELD_KEYS, owner);
  if (unknown !== undefined) return fail(unknown);

  const id = value.id;
  if (typeof id !== "string" || !ID.test(id)) {
    return fail(`${owner} id must match [a-z0-9_-]{1,32}`);
  }

  const fieldOwner = `${owner} field "${id}"`;

  if (seen.has(id)) return fail(`${fieldOwner} repeats an id`);
  seen.add(id);

  if (typeof value.label !== "string") {
    return fail(`${fieldOwner} label must be a string`);
  }

  if (typeof value.pointer !== "string") {
    return fail(`${fieldOwner} pointer must be a string`);
  }

  const type = value.type;
  if (type !== "number" && type !== "text" && type !== "boolean") {
    return fail(`${fieldOwner} type must be number|text|boolean`);
  }

  const family = value.family;
  if (family !== undefined && typeof family !== "string") {
    return fail(`${fieldOwner} family must be a string`);
  }

  const unit = value.unit;
  if (unit !== undefined && typeof unit !== "string") {
    return fail(`${fieldOwner} unit must be a string`);
  }

  const unitKind = value.unitKind;
  if (unitKind !== undefined) {
    if (typeof unitKind !== "string" || !UNIT_KIND_SET.has(unitKind)) {
      return fail(`${fieldOwner} unitKind is not a known kind`);
    }
  }

  const scale = value.scale;
  if (
    scale !== undefined &&
    (typeof scale !== "number" || !Number.isFinite(scale))
  ) {
    return fail(`${fieldOwner} scale must be a number`);
  }

  const offset = value.offset;
  if (
    offset !== undefined &&
    (typeof offset !== "number" || !Number.isFinite(offset))
  ) {
    return fail(`${fieldOwner} offset must be a number`);
  }

  const expectedTier = value.expectedTier;
  if (
    expectedTier !== undefined &&
    expectedTier !== "baseline" &&
    expectedTier !== "extended"
  ) {
    return fail(`${fieldOwner} expectedTier must be baseline|extended`);
  }

  return {
    ok: true,
    value: {
      id,
      label: value.label,
      pointer: value.pointer,
      type,
      ...(family === undefined ? {} : { family }),
      ...(unit === undefined ? {} : { unit }),
      ...(unitKind === undefined ? {} : { unitKind: unitKind as UnitKind }),
      ...(scale === undefined ? {} : { scale }),
      ...(offset === undefined ? {} : { offset }),
      ...(expectedTier === undefined ? {} : { expectedTier }),
    },
  };
}

function asSource(value: unknown): Checked<CustomSource> {
  if (!isObject(value)) return fail("source is not an object");

  const rawId = value.id;
  if (typeof rawId !== "string" || !ID.test(rawId)) {
    return fail(
      `source id "${typeof rawId === "string" ? rawId : ""}" must match [a-z0-9_-]{1,32}`,
    );
  }

  const owner = `source "${rawId}"`;

  const unknown = unknownKey(value, SOURCE_KEYS, owner);
  if (unknown !== undefined) return fail(unknown);

  if (typeof value.name !== "string")
    return fail(`${owner} name must be a string`);

  let url: URL;
  if (typeof value.url !== "string")
    return fail(`${owner} url must be a string`);

  try {
    url = new URL(value.url);
  } catch {
    return fail(`${owner} url must be an http or https URL`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return fail(`${owner} url must be an http or https URL`);
  }

  if (url.username !== "" || url.password !== "") {
    return fail(`${owner} url must carry no username or password`);
  }

  let query: Readonly<Record<string, string>> | undefined;
  if (value.query !== undefined) {
    const checked = asTextRecord(value.query, `${owner} query`);
    if (!checked.ok) return checked;
    query = checked.value;
  }

  let headers: Readonly<Record<string, string>> | undefined;
  if (value.headers !== undefined) {
    const checked = asTextRecord(value.headers, `${owner} headers`);
    if (!checked.ok) return checked;
    headers = checked.value;
  }

  const interval = asDuration(
    value.intervalMs,
    `${owner} intervalMs`,
    INTERVAL_MIN,
    INTERVAL_MAX,
    INTERVAL_DEFAULT,
  );
  if (!interval.ok) return interval;

  const timeout = asDuration(
    value.timeoutMs,
    `${owner} timeoutMs`,
    TIMEOUT_MIN,
    TIMEOUT_MAX,
  );
  if (!timeout.ok) return timeout;

  let auth: Auth | undefined;
  if (value.auth !== undefined) {
    const checked = asAuth(value.auth, owner);
    if (!checked.ok) return checked;
    auth = checked.value;
  }

  if (!Array.isArray(value.fields))
    return fail(`${owner} fields must be an array`);
  if (value.fields.length > MAX_FIELDS) {
    return fail(
      `${owner} has ${value.fields.length} fields; the limit is ${MAX_FIELDS}`,
    );
  }

  const fields: CustomField[] = [];
  const fieldIds = new Set<string>();

  for (const raw of value.fields) {
    const checked = asField(raw, owner, fieldIds);
    if (!checked.ok) return checked;
    fields.push(checked.value);
  }

  return {
    ok: true,
    value: {
      id: rawId,
      name: value.name,
      // The parsed href, so a typed `HTTP://Host:80/x` or stray whitespace is
      // stored canonically; validation and the fetch then read one address.
      url: url.href,
      ...(query === undefined ? {} : { query }),
      ...(headers === undefined ? {} : { headers }),
      intervalMs: interval.value,
      timeoutMs: timeout.value,
      ...(auth === undefined ? {} : { auth }),
      fields,
    },
  };
}

/**
 * The file's sources, with every rejected entry reported and every valid one
 * kept. Never throws: a bad source costs its own entry, not the host.
 */
export function normalizeSources(input: unknown): SourceFile {
  if (!isObject(input) || !Array.isArray(input.sources)) {
    return {
      sources: [],
      issues: [
        {
          sourceId: "",
          reason: "sources.json must be an object with a sources array",
        },
      ],
    };
  }

  const sources: CustomSource[] = [];
  const issues: SourceIssue[] = [];
  const ids = new Set<string>();

  for (const raw of input.sources) {
    const checked = asSource(raw);

    if (!checked.ok) {
      const sourceId =
        isObject(raw) && typeof raw.id === "string" ? raw.id : "";
      issues.push({ sourceId, reason: checked.reason });
      continue;
    }

    const { id } = checked.value;

    if (ids.has(id)) {
      issues.push({ sourceId: id, reason: `source "${id}" repeats an id` });
      continue;
    }

    if (sources.length >= MAX_SOURCES) {
      issues.push({
        sourceId: id,
        reason: `source "${id}" exceeds the ${MAX_SOURCES}-source limit`,
      });
      continue;
    }

    ids.add(id);
    sources.push(checked.value);
  }

  return { sources, issues };
}

async function readSources(file: string): Promise<SourceFile> {
  const raw = await readRaw(file);
  if (!raw.ok) {
    return { sources: [], issues: [{ sourceId: "", reason: raw.reason }] };
  }
  return normalizeSources(raw.value);
}

type RawRead =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string };

/** The file as authored, without the validated projection. No file is an empty
 *  document; a file that cannot be read or parsed is a refusal rather than an
 *  empty one, because writing it would drop what is there. */
async function readRaw(file: string): Promise<RawRead> {
  let text: string;

  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, value: { sources: [] } };
    }
    return { ok: false, reason: "sources.json could not be read" };
  }

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, reason: "sources.json is not valid JSON" };
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The raw `sources` array of a file value, as authored. */
export function sourceEntries(raw: unknown): readonly unknown[] {
  const record = asRecord(raw);
  return record !== undefined && Array.isArray(record.sources)
    ? record.sources
    : [];
}

/** A raw entry's own object id, even when the rest of the entry is refused. */
export function sourceEntryId(entry: unknown): string | undefined {
  const id = asRecord(entry)?.id;
  return typeof id === "string" ? id : undefined;
}

/** A raw entry's credential reference, even when the entry is refused. */
export function sourceEntryCredentialId(entry: unknown): string | undefined {
  const credentialId = asRecord(asRecord(entry)?.auth)?.credentialId;
  return typeof credentialId === "string" ? credentialId : undefined;
}

/** Replaces the raw entry with this id in place, or appends it. Every other
 *  entry — valid or refused — is kept exactly as it was. */
export function withSourceEntry(raw: unknown, candidate: unknown): unknown {
  const entries = [...sourceEntries(raw)];
  const id = sourceEntryId(candidate);
  const index =
    id === undefined
      ? -1
      : entries.findIndex((entry) => sourceEntryId(entry) === id);

  if (index === -1) entries.push(candidate);
  else entries[index] = candidate;

  return { sources: entries };
}

/** Removes the raw entry whose object id matches, so a malformed entry is still
 *  removable. Returns the input unchanged when nothing matches. */
export function withoutSourceEntry(
  raw: unknown,
  id: string,
): { readonly raw: unknown; readonly removed: unknown | undefined } {
  const entries = [...sourceEntries(raw)];
  const index = entries.findIndex((entry) => sourceEntryId(entry) === id);
  if (index === -1) return { raw, removed: undefined };

  const removed = entries[index];
  entries.splice(index, 1);
  return { raw: { sources: entries }, removed };
}

export function createSourceStore(
  directory: string,
  options: SourceStoreOptions = {},
): SourceStore {
  const file = path.join(directory, FILE);

  // Written beside the target and renamed over it, so a crash mid-write loses
  // the write rather than every source. Readers queue with the mutators
  // because on Windows a rename over an open file fails with EPERM.
  const temporary = `${file}.tmp`;
  const replace = options.rename ?? rename;

  const save = async (input: unknown): Promise<void> => {
    await mkdir(directory, { recursive: true });
    try {
      await writeFile(temporary, `${JSON.stringify(input, null, 2)}\n`, "utf8");
      await replace(temporary, file);
    } catch (error) {
      // A failed save must not leave the next attempt reading a stale temp
      // file as if it were the write that failed.
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  };

  let writing: Promise<unknown> = Promise.resolve();
  const writeExclusively = <T>(work: () => Promise<T>): Promise<T> => {
    const next = writing.then(work, work);
    writing = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const applyUpdate = async (
    mutate: (raw: unknown) => unknown,
  ): Promise<SourceFile> => {
    const raw = await readRaw(file);
    if (!raw.ok) throw new Error(raw.reason);

    const next = mutate(raw.value);
    if (next !== raw.value) await save(next);
    return normalizeSources(next);
  };

  return {
    read() {
      return writeExclusively(() => readSources(file));
    },

    write(input) {
      // An envelope the store cannot read as a file is refused rather than
      // persisted: `null` or an object with no `sources` array would replace a
      // populated file with something the next read can only report and skip.
      if (!isObject(input) || !Array.isArray(input.sources)) {
        return Promise.resolve(normalizeSources(input));
      }

      return writeExclusively(async () => {
        await save(input);
        return normalizeSources(input);
      });
    },

    update(mutate) {
      return writeExclusively(() => applyUpdate(mutate));
    },
  };
}
