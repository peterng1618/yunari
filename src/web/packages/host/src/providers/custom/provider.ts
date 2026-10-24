import type { SampleEntry, UnitKind, ValueKind } from "@yunari/renderer-core";
import type { CredentialStore } from "../../settings/credentials.js";
import type {
  CustomField,
  CustomSource,
  SourceIssue,
  SourceStore,
} from "../../settings/sources.js";
import type {
  ProviderHealth,
  SensorDescriptor,
  SensorProvider,
} from "../provider.js";
import { redactForBrowser } from "../provider.js";
import { fetchSource } from "./fetch-source.js";
import { resolvePointer } from "./pointer.js";

/**
 * User-authored HTTP JSON sources as semantic readings.
 *
 * `sample()` is a cache read: a display asking for one of a source's keys
 * records demand, and one timer per source fetches at that source's own
 * interval. A source is never fetched while nothing asks for it, and a failing
 * source costs only its own keys. Decision 0099 records why providers own their
 * clocks rather than the host's poll cycle.
 */

const PROVIDER_ID = "custom";

/** Missed intervals after which a last good value is stale rather than fresh. */
const STALE_INTERVALS = 3;
/** The same grace bounds how long a source keeps polling with no demand. */
const DEMAND_GRACE_INTERVALS = 3;

const WAITING_MESSAGE = "Waiting for the first reading.";
const STALE_MESSAGE = "The last reading is out of date.";
const MISSING_CREDENTIAL = "credential is missing";

const VALUE_KIND: Readonly<Record<CustomField["type"], ValueKind>> = {
  number: "number",
  text: "text",
  boolean: "boolean",
};

/** A field's semantic key: validated id segments, so the key is unambiguous. */
export function customFieldKey(sourceId: string, fieldId: string): string {
  return `${PROVIDER_ID}.${sourceId}.${fieldId}`;
}

type FieldReading =
  | { readonly kind: "value"; readonly value: number | string | boolean }
  | { readonly kind: "missing"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

interface CachedReading {
  readonly fetchedAtMs: number;
  readonly fields: ReadonlyMap<string, FieldReading>;
}

interface SourceRuntime {
  readonly source: CustomSource;
  /** Keyed by semantic key, so a sample maps straight to its field. */
  readonly fields: ReadonlyMap<string, CustomField>;
  readonly descriptors: readonly SensorDescriptor[];
  active: boolean;
  timer: ReturnType<typeof setInterval> | undefined;
  lastDemandMs: number;
  reading: CachedReading | undefined;
  /** Already redacted; may reach `health()` and a sample message. */
  failure: string | undefined;
  inFlight: boolean;
  abort: AbortController | undefined;
}

export interface CustomSourceProviderOptions {
  readonly sources: SourceStore;
  readonly credentials: CredentialStore;
  readonly fetcher?: typeof fetch;
  readonly now?: () => number;
}

/** The longest pointer a reason quotes, so a hand-written one cannot turn one
 *  line into a paragraph. */
const MAX_POINTER_CHARS = 64;
/** A reason is one line on a fixed strip; the pointer counts against it. */
const MESSAGE_MAX_CHARS = 120;

/** RFC 6901: empty, or segments of `/` plus text with only `~0`/`~1` escapes. */
const POINTER_GRAMMAR = /^(?:\/(?:[^/~]|~[01])*)*$/;

/**
 * A pointer is user-authored configuration, the same trust class as a source's
 * name and a field's label, so it is quoted verbatim — bounded to a line, with
 * a replacer function so `$&`-style text stays literal. Only a value that
 * fails the JSON-Pointer grammar is malformed config rather than a location,
 * and then the field id names it. The sentence around the pointer is still
 * redacted; the pointer is the user's own text rather than a third-party
 * error.
 */
function messageWithPointer(
  sentence: (subject: string) => string,
  field: CustomField,
): string {
  const { pointer } = field;
  const bounded =
    pointer.length > MAX_POINTER_CHARS
      ? `${pointer.slice(0, MAX_POINTER_CHARS)}…`
      : pointer;
  const subject = !POINTER_GRAMMAR.test(pointer)
    ? `field "${field.id}"`
    : pointer === ""
      ? "the whole document"
      : `the pointer ${bounded}`;

  const placeholder = "\u0000";
  return redactForBrowser(sentence(placeholder))
    .replace(placeholder, () => subject)
    .slice(0, MESSAGE_MAX_CHARS);
}

function missingPointer(field: CustomField): FieldReading {
  return {
    kind: "missing",
    message: messageWithPointer(
      (at) => `The value at ${at} is missing from the source's response.`,
      field,
    ),
  };
}

function mismatched(field: CustomField, expected: string): FieldReading {
  return {
    kind: "error",
    message: messageWithPointer(
      (at) => `The value at ${at} did not match; expected ${expected}.`,
      field,
    ),
  };
}

/** One field's reading, scaled/offset here and only here. */
function readField(field: CustomField, body: unknown): FieldReading {
  const resolved = resolvePointer(body, field.pointer);
  if (!resolved.found) return missingPointer(field);

  const value = resolved.value;

  switch (field.type) {
    case "number": {
      if (typeof value !== "number") return mismatched(field, "a number");
      const scaled = value * (field.scale ?? 1) + (field.offset ?? 0);
      if (!Number.isFinite(scaled)) return mismatched(field, "a finite number");
      return { kind: "value", value: scaled };
    }
    case "text":
      return typeof value === "string"
        ? { kind: "value", value }
        : mismatched(field, "text");
    case "boolean":
      return typeof value === "boolean"
        ? { kind: "value", value }
        : mismatched(field, "a boolean");
  }
}

function readFields(
  source: CustomSource,
  body: unknown,
): ReadonlyMap<string, FieldReading> {
  return new Map(
    source.fields.map((field) => [field.id, readField(field, body)] as const),
  );
}

function descriptorOf(
  source: CustomSource,
  field: CustomField,
): SensorDescriptor {
  return {
    sensorId: `${PROVIDER_ID}:${source.id}:${field.id}`,
    semanticKey: customFieldKey(source.id, field.id),
    label: field.label,
    family: field.family ?? "custom",
    tier: field.expectedTier ?? "extended",
    valueKind: VALUE_KIND[field.type],
    ...(field.unit === undefined ? {} : { unit: field.unit }),
    ...(field.unitKind === undefined
      ? {}
      : { unitKind: field.unitKind as UnitKind }),
  };
}

type CredentialResult =
  | { readonly ok: true; readonly value: string | undefined }
  | { readonly ok: false };

export class CustomSourceProvider implements SensorProvider {
  readonly id = PROVIDER_ID;
  readonly label = "Custom sources";

  readonly #store: SourceStore;
  readonly #credentials: CredentialStore;
  readonly #fetcher: typeof fetch;
  readonly #now: () => number;

  #runtimes = new Map<string, SourceRuntime>();
  #issues: readonly SourceIssue[] = [];
  #sourceCount = 0;
  #reloadGeneration = 0;
  /** `stop()` is a teardown: a reload that was already reading must not revive
   *  the provider behind it. */
  #stopped = false;

  constructor(options: CustomSourceProviderOptions) {
    this.#store = options.sources;
    this.#credentials = options.credentials;
    this.#fetcher = options.fetcher ?? fetch;
    this.#now = options.now ?? (() => Date.now());
  }

  /**
   * Re-reads the store and replaces descriptors and timers. A source that
   * survives the edit starts undemanded, so the next sample starts one timer
   * rather than inheriting the old one. Called at startup and after a write.
   */
  async reload(): Promise<void> {
    const generation = ++this.#reloadGeneration;
    const file = await this.#store.read();
    // A second reload overtook this read, or the provider was stopped while the
    // read was pending; neither may apply this file.
    if (this.#stopped || generation !== this.#reloadGeneration) return;

    for (const runtime of this.#runtimes.values()) this.#retire(runtime);
    this.#runtimes = new Map();
    this.#issues = file.issues;
    this.#sourceCount = file.sources.length;

    for (const source of file.sources) {
      const fields = new Map<string, CustomField>();
      const descriptors = source.fields.map((field) => {
        const descriptor = descriptorOf(source, field);
        fields.set(descriptor.semanticKey, field);
        return descriptor;
      });

      this.#runtimes.set(source.id, {
        source,
        fields,
        descriptors,
        active: true,
        timer: undefined,
        lastDemandMs: Number.NEGATIVE_INFINITY,
        reading: undefined,
        failure: undefined,
        inFlight: false,
        abort: undefined,
      });
    }
  }

  async describe(): Promise<readonly SensorDescriptor[]> {
    return [...this.#runtimes.values()].flatMap(
      (runtime) => runtime.descriptors,
    );
  }

  async sample(
    semanticKeys: readonly string[],
    nowMs: number,
  ): Promise<readonly SampleEntry[]> {
    const wanted = new Set(semanticKeys);
    const entries: SampleEntry[] = [];

    for (const runtime of this.#runtimes.values()) {
      const matched = runtime.descriptors.filter((descriptor) =>
        wanted.has(descriptor.semanticKey),
      );
      if (matched.length === 0) continue;

      this.#demand(runtime, nowMs);
      for (const descriptor of matched) {
        entries.push(this.#entryOf(runtime, descriptor, nowMs));
      }
    }

    return entries;
  }

  health(): ProviderHealth {
    if (this.#sourceCount === 0) {
      const issue = this.#issues[0];
      return {
        available: false,
        message:
          issue === undefined
            ? "No custom sources are configured."
            : redactForBrowser(issue.reason),
      };
    }

    if (this.#issues.length > 0) {
      const count = this.#issues.length;
      return {
        available: true,
        message: `${count} issue${count === 1 ? "" : "s"} in sources.json; see that file in the settings folder.`,
      };
    }

    for (const runtime of this.#runtimes.values()) {
      if (runtime.failure !== undefined) {
        return { available: true, message: runtime.failure };
      }
    }

    return { available: true };
  }

  /**
   * Every timer gone, every in-flight request aborted, and any reload still
   * waiting on the store refused when it lands: a stopped provider has no
   * descriptors, no sources and nothing to fetch.
   */
  stop(): void {
    this.#stopped = true;
    this.#reloadGeneration += 1;
    for (const runtime of this.#runtimes.values()) this.#retire(runtime);
    this.#runtimes.clear();
    this.#sourceCount = 0;
    this.#issues = [];
  }

  #retire(runtime: SourceRuntime): void {
    runtime.active = false;
    this.#clearTimer(runtime);
    runtime.abort?.abort();
  }

  #clearTimer(runtime: SourceRuntime): void {
    if (runtime.timer === undefined) return;
    clearInterval(runtime.timer);
    runtime.timer = undefined;
  }

  /**
   * A sample is the demand signal. The first one starts the timer and fetches
   * at once, so a newly bound key gets a reading without waiting an interval.
   */
  #demand(runtime: SourceRuntime, nowMs: number): void {
    runtime.lastDemandMs = nowMs;
    if (!runtime.active || runtime.timer !== undefined) return;

    runtime.timer = setInterval(
      () => this.#tick(runtime),
      runtime.source.intervalMs,
    );
    // A host whose displays are idle still exits on its own.
    (runtime.timer as { unref?: () => void }).unref?.();
    void this.#fetch(runtime);
  }

  #tick(runtime: SourceRuntime): void {
    if (!runtime.active) return;

    if (
      this.#now() - runtime.lastDemandMs >
      DEMAND_GRACE_INTERVALS * runtime.source.intervalMs
    ) {
      this.#clearTimer(runtime);
      return;
    }

    void this.#fetch(runtime);
  }

  async #fetch(runtime: SourceRuntime): Promise<void> {
    if (!runtime.active || runtime.inFlight) return;

    runtime.inFlight = true;
    const abort = new AbortController();
    runtime.abort = abort;

    try {
      const credential = await this.#credentialOf(runtime.source);

      if (!credential.ok) {
        if (runtime.active) runtime.failure = MISSING_CREDENTIAL;
        return;
      }

      const outcome = await fetchSource(
        runtime.source,
        credential.value,
        this.#fetcherFor(abort),
        this.#now,
      );

      // A reload or stop retired this runtime while the request was in flight.
      if (!runtime.active) return;

      if (outcome.ok) {
        runtime.reading = {
          fetchedAtMs: this.#now(),
          fields: readFields(runtime.source, outcome.body),
        };
        runtime.failure = undefined;
      } else {
        runtime.failure = redactForBrowser(outcome.reason);
      }
    } catch (error: unknown) {
      if (runtime.active) {
        runtime.failure = redactForBrowser(
          error instanceof Error ? error.message : String(error),
        );
      }
    } finally {
      runtime.inFlight = false;
      runtime.abort = undefined;
    }
  }

  /**
   * Resolved at fetch time and only here: the store stays the owner of the
   * secret, and a missing one is a reason rather than a request without it.
   */
  async #credentialOf(source: CustomSource): Promise<CredentialResult> {
    const auth = source.auth;
    if (auth === undefined || auth.kind === "none") {
      return { ok: true, value: undefined };
    }
    if (auth.credentialId === undefined) return { ok: false };

    const value = await this.#credentials.valueOf(auth.credentialId);
    return value === undefined ? { ok: false } : { ok: true, value };
  }

  /** The request's own deadline plus this runtime's abort, so `stop()` cuts a
   *  fetch that is already dialling. */
  #fetcherFor(abort: AbortController): typeof fetch {
    return ((input, init) => {
      const signal = init?.signal;
      const combined =
        signal === null || signal === undefined
          ? abort.signal
          : AbortSignal.any([signal, abort.signal]);
      return this.#fetcher(input, { ...init, signal: combined });
    }) as typeof fetch;
  }

  #entryOf(
    runtime: SourceRuntime,
    descriptor: SensorDescriptor,
    nowMs: number,
  ): SampleEntry {
    const field = runtime.fields.get(descriptor.semanticKey);
    const timestamp = new Date(nowMs).toISOString();
    const base = { sensorId: descriptor.sensorId, timestamp };
    const reading = runtime.reading;
    const fieldReading =
      field === undefined ? undefined : reading?.fields.get(field.id);

    if (fieldReading === undefined) {
      return {
        semanticKey: descriptor.semanticKey,
        sample: {
          ...base,
          status: runtime.failure === undefined ? "missing" : "error",
          message: runtime.failure ?? WAITING_MESSAGE,
        },
      };
    }

    if (fieldReading.kind !== "value") {
      return {
        semanticKey: descriptor.semanticKey,
        sample: {
          ...base,
          status: fieldReading.kind,
          message: fieldReading.message,
        },
      };
    }

    if (
      reading !== undefined &&
      nowMs - reading.fetchedAtMs >= STALE_INTERVALS * runtime.source.intervalMs
    ) {
      return {
        semanticKey: descriptor.semanticKey,
        sample: { ...base, status: "stale", message: STALE_MESSAGE },
      };
    }

    const unit = field?.unit;

    switch (field?.type) {
      case "number":
        return {
          semanticKey: descriptor.semanticKey,
          sample: {
            ...base,
            status: "ok",
            value: fieldReading.value as number,
            ...(unit === undefined ? {} : { unit }),
          },
        };
      case "text":
        return {
          semanticKey: descriptor.semanticKey,
          sample: {
            ...base,
            status: "ok",
            textValue: fieldReading.value as string,
          },
        };
      case "boolean":
        return {
          semanticKey: descriptor.semanticKey,
          sample: {
            ...base,
            status: "ok",
            booleanValue: fieldReading.value as boolean,
          },
        };
      default:
        return {
          semanticKey: descriptor.semanticKey,
          sample: { ...base, status: "missing", message: WAITING_MESSAGE },
        };
    }
  }
}
