import type {
  CatalogueStatus,
  FabricThemeEnvelope,
  MineEntry,
} from "@yunari/renderer-core";

/**
 * The author's half of the store, as the host calls it.
 *
 * Every method returns the Worker's payload and **throws** `StoreClientError`
 * on a non-2xx — the one exception is `baseline`, whose 404 is a first
 * submission rather than a failure and answers `undefined`. The token goes in
 * the `Authorization` header on every call, the upload route included.
 */

export class StoreClientError extends Error {
  /** The Worker's HTTP status; 0 when it could not be reached at all. */
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "StoreClientError";
    this.status = status;
  }
}

export interface StoreBaseline {
  readonly version: string;
  readonly createdAt: string;
  readonly envelope: FabricThemeEnvelope;
  readonly status: CatalogueStatus;
}

export interface VersionPlan {
  readonly version: string;
  readonly status: CatalogueStatus;
  readonly uploadUrl: string;
}

export interface FinalizedVersion {
  readonly ok: true;
  readonly status: CatalogueStatus;
  readonly version: string;
}

/** The Worker's answer to unpublish or republish: the state it landed in. */
export interface Transitioned {
  readonly ok: true;
  readonly status: CatalogueStatus;
}

export interface StoreClient {
  /** The latest stored version in any state, or undefined when there is none. */
  baseline(id: string): Promise<StoreBaseline | undefined>;
  createVersion(
    id: string,
    input: { readonly envelope: FabricThemeEnvelope; readonly name: string },
  ): Promise<VersionPlan>;
  /** PUT the package through the Worker's authenticated upload route. */
  upload(url: string, bytes: Uint8Array): Promise<void>;
  finalize(
    id: string,
    version: string,
    thumbnail: Uint8Array,
  ): Promise<FinalizedVersion>;
  unpublish(id: string): Promise<Transitioned>;
  publish(id: string): Promise<Transitioned>;
  mine(): Promise<{ readonly entries: readonly MineEntry[] }>;
  favorite(id: string, on: boolean): Promise<{ readonly favorites: number }>;
}

/**
 * The Worker's sentence for a refusal.
 *
 * Admin and author refusals are plain text, a few public paths answer JSON, and
 * an empty body says nothing — so all three shapes are read rather than one
 * being assumed, and a body with no sentence falls back to its status.
 */
function sentenceOf(text: string, status: number): string {
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === "object" && body !== null) {
      const { message, error } = body as Record<string, unknown>;
      if (typeof message === "string" && message !== "") return message;
      if (typeof error === "string" && error !== "") return error;
    }
  } catch {
    // Plain text, which is the usual refusal.
  }

  const trimmed = text.trim();
  return trimmed === "" ? `The store answered HTTP ${status}.` : trimmed;
}

async function payload<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    throw new StoreClientError(
      sentenceOf(text, response.status),
      response.status,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new StoreClientError(
      "The store answered something that is not JSON.",
      response.status,
    );
  }
}

export function createStoreClient(options: {
  readonly origin: string;
  readonly token: string;
  readonly fetch?: typeof fetch;
}): StoreClient {
  const { origin, token } = options;
  const doFetch = options.fetch ?? globalThis.fetch;

  async function send(
    path: string,
    method: string,
    body?: unknown,
  ): Promise<Response> {
    try {
      return await doFetch(new URL(path, origin), {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new StoreClientError("The store could not be reached.", 0);
    }
  }

  const itemPath = (id: string) => `/api/me/items/${encodeURIComponent(id)}`;

  return {
    async baseline(id) {
      const response = await send(`${itemPath(id)}/baseline`, "GET");
      if (response.status === 404) {
        await response.body?.cancel().catch(() => undefined);
        return undefined;
      }
      return payload<StoreBaseline>(response);
    },

    createVersion(id, input) {
      return send(`${itemPath(id)}/versions`, "POST", input).then((response) =>
        payload<VersionPlan>(response),
      );
    },

    async upload(url, bytes) {
      let response: Response;
      try {
        // A view over the package's own buffer, which `fetch` accepts as a body
        // at runtime; the cast is the lib's narrower `BodyInit`, not a copy.
        // The Worker refuses an upload with no `content-length`, and `fetch`
        // does not derive one from the typed array.
        response = await doFetch(url, {
          method: "PUT",
          headers: {
            authorization: `Bearer ${token}`,
            "content-length": String(bytes.byteLength),
          },
          body: bytes as unknown as BodyInit,
        });
      } catch {
        throw new StoreClientError("The store could not be reached.", 0);
      }
      if (!response.ok) {
        const text = await response.text();
        throw new StoreClientError(
          sentenceOf(text, response.status),
          response.status,
        );
      }
      await response.body?.cancel().catch(() => undefined);
    },

    finalize(id, version, thumbnail) {
      return send(
        `${itemPath(id)}/versions/${encodeURIComponent(version)}/finalize`,
        "POST",
        { thumbnail: Buffer.from(thumbnail).toString("base64") },
      ).then((response) => payload<FinalizedVersion>(response));
    },

    unpublish(id) {
      return send(`${itemPath(id)}/unpublish`, "POST").then((response) =>
        payload<Transitioned>(response),
      );
    },

    publish(id) {
      return send(`${itemPath(id)}/publish`, "POST").then((response) =>
        payload<Transitioned>(response),
      );
    },

    mine() {
      return send("/api/me/items", "GET").then((response) =>
        payload<{ entries: readonly MineEntry[] }>(response),
      );
    },

    favorite(id, on) {
      return send(`${itemPath(id)}/favorite`, on ? "PUT" : "DELETE").then(
        (response) => payload<{ favorites: number }>(response),
      );
    },
  };
}
