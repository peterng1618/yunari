import type { InstalledExtension } from "@yunari/extension-api";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * The editor's half of the extension manager routes.
 *
 * Every route is loopback-only on the host, so the browser never holds a
 * credential: it sends the archive bytes or a host-computed fingerprint and
 * reads the typed listing back. A failure is a sentence, never a throw at the
 * page.
 */
export interface EditorProviderOrder {
  readonly version: 1;
  readonly pluginOrder: readonly string[];
}

export type ClientAnswer =
  | { readonly ok: true; readonly message?: string }
  | { readonly ok: false; readonly message: string };

export interface ExtensionClient {
  list(): Promise<readonly InstalledExtension[]>;
  install(bytes: Uint8Array): Promise<ClientAnswer>;
  grant(key: string, fingerprint: string): Promise<ClientAnswer>;
  remove(key: string): Promise<void>;
  readProviderOrder(): Promise<EditorProviderOrder>;
  writeProviderOrder(order: EditorProviderOrder): Promise<ClientAnswer>;
}

export interface ClientOptions {
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
}

const EMPTY_ORDER: EditorProviderOrder = { version: 1, pluginOrder: [] };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `publisher/id`, each segment encoded. A key with no publisher is a local
 *  install, which is the only publisher this host mints itself. */
export function keyPath(key: string): string {
  const at = key.indexOf("/");
  const publisher = at === -1 ? "local" : key.slice(0, at);
  const id = at === -1 ? key : key.slice(at + 1);
  return `${encodeURIComponent(publisher)}/${encodeURIComponent(id)}`;
}

async function readAnswer(response: Response): Promise<ClientAnswer> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  const record =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Readonly<Record<string, unknown>>)
      : undefined;

  if (response.ok) {
    return record?.["ok"] === false
      ? {
          ok: false,
          message:
            typeof record["message"] === "string"
              ? record["message"]
              : "The host refused that change.",
        }
      : { ok: true };
  }

  const message = record?.["message"];
  return {
    ok: false,
    message:
      typeof message === "string" && message !== ""
        ? message
        : `The host answered ${response.status}.`,
  };
}

export function createExtensionClient(
  options?: ClientOptions,
): ExtensionClient {
  const fetcher = options?.fetch ?? globalThis.fetch.bind(globalThis);
  const url = (path: string): string => `${options?.baseUrl ?? ""}${path}`;
  const json = { "content-type": "application/json" };

  return {
    async list() {
      const response = await fetcher(url("/api/extensions"), {
        credentials: "same-origin",
      });
      if (!response.ok)
        throw new Error(`The host answered ${response.status}.`);
      const body = (await response.json()) as { extensions?: unknown };
      if (!Array.isArray(body.extensions))
        throw new Error("The host's extension listing is not readable.");
      return body.extensions as readonly InstalledExtension[];
    },

    async install(bytes) {
      // A fresh ArrayBuffer-backed copy: `fetch` accepts a BufferSource, and a
      // view over a possibly shared buffer is not one.
      const body = new Uint8Array(bytes.byteLength);
      body.set(bytes);
      const response = await fetcher(url("/api/extensions/install"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/octet-stream" },
        body,
      });
      return readAnswer(response);
    },

    async grant(key, fingerprint) {
      const response = await fetcher(
        url(`/api/extensions/${keyPath(key)}/consent`),
        {
          method: "POST",
          credentials: "same-origin",
          headers: json,
          body: JSON.stringify({ fingerprint }),
        },
      );
      return readAnswer(response);
    },

    async remove(key) {
      const response = await fetcher(url(`/api/extensions/${keyPath(key)}`), {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok)
        throw new Error(`The host answered ${response.status}.`);
    },

    async readProviderOrder() {
      const response = await fetcher(url("/api/extensions/provider-order"), {
        credentials: "same-origin",
      });
      if (!response.ok)
        throw new Error(`The host answered ${response.status}.`);
      const body = (await response.json()) as Partial<EditorProviderOrder>;
      return body.version === 1 && Array.isArray(body.pluginOrder)
        ? { version: 1, pluginOrder: body.pluginOrder }
        : EMPTY_ORDER;
    },

    async writeProviderOrder(order) {
      const response = await fetcher(url("/api/extensions/provider-order"), {
        method: "PUT",
        credentials: "same-origin",
        headers: json,
        body: JSON.stringify(order),
      });
      return readAnswer(response);
    },
  };
}

export interface ExtensionsState {
  readonly extensions: readonly InstalledExtension[];
  readonly providerOrder: EditorProviderOrder;
  readonly error: string | undefined;
  readonly busy: boolean;
  readonly refresh: () => Promise<void>;
  readonly install: (file: File) => Promise<void>;
  readonly grant: (key: string, fingerprint: string) => Promise<void>;
  readonly remove: (key: string) => Promise<void>;
  readonly reorderProvider: (key: string, direction: -1 | 1) => Promise<void>;
}

/**
 * The one owner of the extension listing and the provider order.
 *
 * Every mutation refreshes both, because the host recomputes consent and the
 * provider set on its side; the page never merges a local guess into either.
 */
export function useExtensions(client?: ExtensionClient): ExtensionsState {
  const api = useMemo(() => client ?? createExtensionClient(), [client]);
  const [extensions, setExtensions] = useState<readonly InstalledExtension[]>(
    [],
  );
  const [providerOrder, setProviderOrder] =
    useState<EditorProviderOrder>(EMPTY_ORDER);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [listing, order] = await Promise.all([
        api.list(),
        api.readProviderOrder(),
      ]);
      setExtensions(listing);
      setProviderOrder(order);
      setError(undefined);
    } catch (failure: unknown) {
      setError(messageOf(failure));
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (work: () => Promise<ClientAnswer | void>): Promise<void> => {
      setBusy(true);
      try {
        const answer = await work();
        if (answer !== undefined && !answer.ok) {
          setError(answer.message);
          return;
        }
        setError(undefined);
        await refresh();
      } catch (failure: unknown) {
        setError(messageOf(failure));
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const install = useCallback(
    async (file: File): Promise<void> => {
      await run(async () => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        return api.install(bytes);
      });
    },
    [api, run],
  );

  const grant = useCallback(
    async (key: string, fingerprint: string): Promise<void> => {
      await run(() => api.grant(key, fingerprint));
    },
    [api, run],
  );

  const remove = useCallback(
    async (key: string): Promise<void> => {
      await run(async () => {
        await api.remove(key);
      });
    },
    [api, run],
  );

  const reorderProvider = useCallback(
    async (key: string, direction: -1 | 1): Promise<void> => {
      const current = providerOrder.pluginOrder;
      const index = current.indexOf(key);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= current.length) return;

      const next = [...current];
      next[index] = current[target] as string;
      next[target] = key;

      await run(() =>
        api.writeProviderOrder({ version: 1, pluginOrder: next }),
      );
    },
    [api, providerOrder.pluginOrder, run],
  );

  return useMemo(
    () => ({
      extensions,
      providerOrder,
      error,
      busy,
      refresh,
      install,
      grant,
      remove,
      reorderProvider,
    }),
    [
      busy,
      error,
      extensions,
      grant,
      install,
      providerOrder,
      refresh,
      remove,
      reorderProvider,
    ],
  );
}
