/**
 * The editor's seam to the host's custom HTTP sources.
 *
 * **Every call is a route the host already serves** — `GET /api/sources`, `PUT
 * /api/sources/:id`, `DELETE /api/sources/:id` and `POST /api/sources/:id/test`
 * — and the shapes here are `packages/host/src/server.ts`'s own answers. The
 * editor links to this surface rather than owning a source: the file, the
 * provider and the credential references live on the host.
 *
 * **A credential value never crosses this client.** A source carries
 * `auth.credentialId`, an id; the value stays in the host's own store, and the
 * test route answers mapped values rather than a request the browser builds.
 */

/** Which of the three states the provider reports a source in. */
export type SourceHealth = "ok" | "error" | "waiting";

/** One reading a source publishes, authored on the host. */
export interface SourceField {
  readonly id: string;
  readonly label: string;
  readonly pointer: string;
  readonly type: "number" | "text" | "boolean";
  readonly family?: string;
  readonly unit?: string;
  readonly unitKind?: string;
  readonly scale?: number;
  readonly offset?: number;
  readonly expectedTier?: "baseline" | "extended";
}

/** How a source proves it is itself. Only the reference is here, never a value. */
export interface SourceAuth {
  readonly kind: "none" | "bearer" | "basic" | "header" | "query";
  readonly credentialId?: string;
  readonly headerName?: string;
  readonly queryName?: string;
}

/** A source as the file holds it — the shape a write sends. */
export interface Source {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly intervalMs: number;
  readonly timeoutMs: number;
  readonly auth?: SourceAuth;
  readonly fields: readonly SourceField[];
}

/** A source as the list route reports it: the file's entry, plus its health. */
export interface SourceRow extends Source {
  readonly fieldCount: number;
  readonly health: SourceHealth;
  /** Already redacted by the host before it reaches a browser. */
  readonly lastError: string | null;
  readonly lastSuccessAt: string | null;
}

/** One mapped field's value from the test route. */
export interface SourceTestValue {
  readonly id: string;
  readonly value: string;
}

/** What `POST /api/sources/:id/test` answered. It stores nothing. */
export interface TestResult {
  readonly ok: boolean;
  readonly status?: number;
  readonly elapsedMs: number;
  readonly values: readonly SourceTestValue[];
  readonly reason?: string;
}

/** What `DELETE /api/sources/:id` answered about a credential it left behind. */
export interface RemovalAnswer {
  /** The credential no source references any more, or `null` when one still
   *  does. The section may offer to remove it; it never reads its value. */
  readonly unreferencedCredential: string | null;
}

/**
 * A write the host refused about one source or field, with its own words.
 *
 * The route answers `400 {ok: false, field, reason}` for a refusal it can name.
 * `field` is the source id the host's validation reported, which is the field
 * the form shows the reason beside.
 */
export class SourceRefusedError extends Error {
  readonly field: string;
  readonly reason: string;

  constructor(field: string, reason: string) {
    super(reason);
    this.name = "SourceRefusedError";
    this.field = field;
    this.reason = reason;
  }
}

export interface SourcesClient {
  list(): Promise<readonly SourceRow[]>;
  save(source: Source): Promise<void>;
  /** Deletes and answers which credential, if any, nothing references now. */
  remove(id: string): Promise<RemovalAnswer>;
  test(id: string): Promise<TestResult>;
}

const HEALTH: ReadonlySet<string> = new Set(["ok", "error", "waiting"]);
const AUTH_KINDS: ReadonlySet<string> = new Set([
  "none",
  "bearer",
  "basic",
  "header",
  "query",
]);
const FIELD_TYPES: ReadonlySet<string> = new Set(["number", "text", "boolean"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readTextRecord(
  value: unknown,
): Readonly<Record<string, string>> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.some(([, entry]) => typeof entry !== "string")) return undefined;
  return Object.fromEntries(entries) as Record<string, string>;
}

function readAuth(value: unknown): SourceAuth | undefined {
  if (!isRecord(value)) return undefined;
  const kind = value["kind"];
  if (typeof kind !== "string" || !AUTH_KINDS.has(kind)) return undefined;
  const credentialId = text(value["credentialId"]);
  const headerName = text(value["headerName"]);
  const queryName = text(value["queryName"]);
  return {
    kind: kind as SourceAuth["kind"],
    ...(credentialId === undefined ? {} : { credentialId }),
    ...(headerName === undefined ? {} : { headerName }),
    ...(queryName === undefined ? {} : { queryName }),
  };
}

function readField(value: unknown): SourceField | undefined {
  if (!isRecord(value)) return undefined;
  const id = text(value["id"]);
  const label = text(value["label"]);
  const pointer = text(value["pointer"]);
  const type = value["type"];
  if (
    id === undefined ||
    label === undefined ||
    pointer === undefined ||
    typeof type !== "string" ||
    !FIELD_TYPES.has(type)
  ) {
    return undefined;
  }

  const family = text(value["family"]);
  const unit = text(value["unit"]);
  const unitKind = text(value["unitKind"]);
  const scale = finite(value["scale"]);
  const offset = finite(value["offset"]);
  const expectedTier =
    value["expectedTier"] === "baseline" || value["expectedTier"] === "extended"
      ? value["expectedTier"]
      : undefined;

  return {
    id,
    label,
    pointer,
    type: type as SourceField["type"],
    ...(family === undefined ? {} : { family }),
    ...(unit === undefined ? {} : { unit }),
    ...(unitKind === undefined ? {} : { unitKind }),
    ...(scale === undefined ? {} : { scale }),
    ...(offset === undefined ? {} : { offset }),
    ...(expectedTier === undefined ? {} : { expectedTier }),
  };
}

/** Keeping only the fields this build can draw: the host normalized its own
 *  file, so a shape it does not answer is one no row here could name. */
function readFields(value: unknown): readonly SourceField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const field = readField(entry);
    return field === undefined ? [] : [field];
  });
}

function readSource(value: unknown): SourceRow | undefined {
  if (!isRecord(value)) return undefined;

  const id = text(value["id"]);
  const name = text(value["name"]);
  const url = text(value["url"]);
  const intervalMs = finite(value["intervalMs"]);
  const timeoutMs = finite(value["timeoutMs"]);
  if (
    id === undefined ||
    name === undefined ||
    url === undefined ||
    intervalMs === undefined ||
    timeoutMs === undefined
  ) {
    return undefined;
  }

  const query = readTextRecord(value["query"]);
  const headers = readTextRecord(value["headers"]);
  const auth = readAuth(value["auth"]);
  const fields = readFields(value["fields"]);
  const fieldCount = finite(value["fieldCount"]);
  const health = value["health"];
  const lastError = text(value["lastError"]);
  const lastSuccessAt = text(value["lastSuccessAt"]);

  return {
    id,
    name,
    url,
    ...(query === undefined ? {} : { query }),
    ...(headers === undefined ? {} : { headers }),
    intervalMs,
    timeoutMs,
    ...(auth === undefined ? {} : { auth }),
    fields,
    fieldCount: fieldCount ?? fields.length,
    health:
      typeof health === "string" && HEALTH.has(health)
        ? (health as SourceHealth)
        : "waiting",
    lastError: lastError ?? null,
    lastSuccessAt: lastSuccessAt ?? null,
  };
}

function readTestValues(value: unknown): readonly SourceTestValue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const id = text(entry["id"]);
    const shown = text(entry["value"]);
    return id === undefined || shown === undefined
      ? []
      : [{ id, value: shown }];
  });
}

function readTestResult(body: unknown): TestResult {
  const record = isRecord(body) ? body : {};
  const status = finite(record["status"]);
  const reason = text(record["reason"]);
  return {
    ok: record["ok"] === true,
    ...(status === undefined ? {} : { status }),
    elapsedMs: finite(record["elapsedMs"]) ?? 0,
    values: readTestValues(record["values"]),
    ...(reason === undefined ? {} : { reason }),
  };
}

/** A refusal is the host's own words where it sent any, so the person reads the
 *  reason rather than a status code. */
async function refusal(response: Response, what: string): Promise<Error> {
  const body = await response.text().catch(() => "");
  return new Error(body.trim() === "" ? `${what} (${response.status}).` : body);
}

/** The whole source object, keeping only the keys the route admits: a list row
 *  carries `health` and its neighbours, and the host refuses an unknown key. */
function writeBody(source: Source): Record<string, unknown> {
  return {
    id: source.id,
    name: source.name,
    url: source.url,
    ...(source.query === undefined ? {} : { query: source.query }),
    ...(source.headers === undefined ? {} : { headers: source.headers }),
    intervalMs: source.intervalMs,
    timeoutMs: source.timeoutMs,
    ...(source.auth === undefined ? {} : { auth: source.auth }),
    fields: source.fields,
  };
}

export function createSourcesClient(
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): SourcesClient {
  return {
    async list(): Promise<readonly SourceRow[]> {
      const response = await fetcher("/api/sources");
      if (!response.ok) {
        throw await refusal(response, "Could not read the custom sources");
      }
      const body: unknown = await response.json();
      const sources = isRecord(body) ? body["sources"] : undefined;
      if (!Array.isArray(sources)) return [];
      return sources.flatMap((entry) => {
        const row = readSource(entry);
        return row === undefined ? [] : [row];
      });
    },

    async save(source) {
      const response = await fetcher(
        `/api/sources/${encodeURIComponent(source.id)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(writeBody(source)),
        },
      );
      if (response.ok) return;

      const body = await response.text().catch(() => "");
      if (response.status === 400) {
        try {
          const refused = JSON.parse(body) as unknown;
          if (isRecord(refused) && refused["ok"] === false) {
            const field = text(refused["field"]);
            const reason = text(refused["reason"]);
            if (field !== undefined && reason !== undefined) {
              throw new SourceRefusedError(field, reason);
            }
          }
        } catch (error: unknown) {
          if (error instanceof SourceRefusedError) throw error;
        }
      }

      throw new Error(
        body.trim() === ""
          ? `Could not save the source (${response.status}).`
          : body,
      );
    },

    async remove(id): Promise<RemovalAnswer> {
      const response = await fetcher(`/api/sources/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw await refusal(response, "Could not delete the source");
      }
      const body: unknown = await response.json().catch(() => undefined);
      const credential = isRecord(body)
        ? text(body["unreferencedCredential"])
        : undefined;
      return { unreferencedCredential: credential ?? null };
    },

    async test(id): Promise<TestResult> {
      const response = await fetcher(
        `/api/sources/${encodeURIComponent(id)}/test`,
        { method: "POST" },
      );
      if (!response.ok) {
        throw await refusal(response, "Could not test the source");
      }
      return readTestResult(await response.json());
    },
  };
}
