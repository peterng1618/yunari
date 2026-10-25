import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import type { MineEntry } from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import type { KeyProtector } from "../settings/os-key-protector.js";
import { createSecretStore } from "../settings/secret-store.js";
import {
  createStoreSessionStore,
  type StoreSession,
  type StoreSessionStore,
} from "../settings/store-session.js";
import {
  type CatalogueRouteDeps,
  createPendingStates,
  handleCatalogueRoutes,
} from "./routes.js";

const ORIGIN = "https://store.test";
const TOKEN = "session/token.value";
const ITEM_ID = "3f2a1c9e-8b7d-4c6a-9e0f-1a2b3c4d5e6f";

/** A reversible protector, so this suite never needs an OS keyring. */
const fakeKeyProtector: KeyProtector = {
  available: async () => true,
  wrap: async (key) => Uint8Array.from(key, (byte) => byte ^ 0x5a),
  unwrap: async (wrapped) => Uint8Array.from(wrapped, (byte) => byte ^ 0x5a),
};

const held: StoreSession = {
  token: TOKEN,
  userId: "user-1",
  email: "author@example.com",
  obtainedAt: "2026-10-01T00:00:00.000Z",
};

const SIGNED_IN: StoreSessionStore = {
  read: async () => held,
  write: async () => undefined,
  clear: async () => undefined,
};

const SIGNED_OUT: StoreSessionStore = {
  read: async () => undefined,
  write: async () => undefined,
  clear: async () => undefined,
};

const ENTRY: MineEntry = {
  id: ITEM_ID,
  kind: "dashboard-theme",
  name: "Mine",
  version: "1.0.1",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
  downloads: 2,
  favorites: 3,
  packageUrl: `${ORIGIN}/catalogue/${ITEM_ID}/1.0.1.zip`,
  thumbnail: `catalogue/${ITEM_ID}/thumbnail.png`,
  facets: {
    author: "Huy",
    colourMode: "dark",
    sensors: [],
    tags: ["minimal"],
    orientation: "landscape",
    aspect: "16:9",
    width: 1280,
    height: 720,
  },
  status: "unpublished",
  statusReason: "Not ready",
};

interface Call {
  readonly url: string;
  readonly method: string;
  readonly authorization: string | null;
}

type Fetch = typeof globalThis.fetch;

/** The Worker, answering each proxied path; every call is recorded. */
function worker(answer: (call: Call) => Response): {
  readonly calls: Call[];
  readonly fetch: Fetch;
} {
  const calls: Call[] = [];
  return {
    calls,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const call = {
        url: String(input),
        method: init?.method ?? "GET",
        authorization: new Headers(init?.headers).get("authorization"),
      };
      calls.push(call);
      return answer(call);
    }) as Fetch,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function deps(
  fetch: Fetch,
  session: StoreSessionStore = SIGNED_IN,
): CatalogueRouteDeps {
  return {
    origin: ORIGIN,
    sessionStore: session,
    fetch,
    states: createPendingStates(),
  };
}

/** The module, called the way the host server calls it. */
function call(
  path: string,
  options: {
    readonly fetch: Fetch;
    readonly method?: string;
    readonly session?: StoreSessionStore;
    readonly remoteAddress?: string;
    readonly origin?: string;
  },
): Promise<Response | undefined> {
  const request = {
    method: options.method ?? "GET",
    headers: {
      host: "127.0.0.1:5173",
      ...(options.origin === undefined ? {} : { origin: options.origin }),
    },
    socket: { remoteAddress: options.remoteAddress ?? "127.0.0.1" },
  } as unknown as IncomingMessage;

  return handleCatalogueRoutes(
    request,
    new URL(`http://127.0.0.1:5173${path}`),
    deps(options.fetch, options.session),
  );
}

describe("the store author proxies", () => {
  it("proxies the Mine listing with the stored token and hands the entries back", async () => {
    const workerApi = worker(() => json({ entries: [ENTRY] }));

    const response = await call("/api/store/mine", { fetch: workerApi.fetch });

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ entries: [ENTRY] });
    expect(workerApi.calls).toEqual([
      {
        url: `${ORIGIN}/api/me/items`,
        method: "GET",
        authorization: `Bearer ${TOKEN}`,
      },
    ]);
  });

  it("401s the Mine listing without a stored session and calls nothing", async () => {
    const workerApi = worker(() => json({ entries: [] }));

    const response = await call("/api/store/mine", {
      fetch: workerApi.fetch,
      session: SIGNED_OUT,
    });

    expect(response?.status).toBe(401);
    const body = await response?.text();
    expect(JSON.parse(body ?? "null")).toMatchObject({ ok: false });
    expect(workerApi.calls).toEqual([]);
    expect(body).not.toContain(TOKEN);
  });

  it("proxies unpublish and publish under the item with the stored token", async () => {
    const workerApi = worker((call) =>
      json({
        ok: true,
        status: call.url.endsWith("/unpublish") ? "unpublished" : "published",
      }),
    );

    for (const action of ["unpublish", "publish"] as const) {
      const response = await call(`/api/store/items/${ITEM_ID}/${action}`, {
        fetch: workerApi.fetch,
        method: "POST",
      });
      expect(response?.status).toBe(200);
      expect(await response?.json()).toEqual({
        ok: true,
        status: action === "unpublish" ? "unpublished" : "published",
      });
    }

    expect(workerApi.calls).toEqual([
      {
        url: `${ORIGIN}/api/me/items/${ITEM_ID}/unpublish`,
        method: "POST",
        authorization: `Bearer ${TOKEN}`,
      },
      {
        url: `${ORIGIN}/api/me/items/${ITEM_ID}/publish`,
        method: "POST",
        authorization: `Bearer ${TOKEN}`,
      },
    ]);
  });

  it("refuses an id that is not a catalogue UUID before the Worker sees it", async () => {
    const workerApi = worker(() => json({ ok: true, status: "published" }));

    for (const id of ["not-a-uuid", "..%2Fadmin"]) {
      const response = await call(`/api/store/items/${id}/unpublish`, {
        fetch: workerApi.fetch,
        method: "POST",
      });
      expect(response?.status).toBe(400);
    }
    expect(workerApi.calls).toEqual([]);
  });

  it("401s author proxies without a stored session", async () => {
    const workerApi = worker(() => json({ ok: true, status: "unpublished" }));

    const response = await call(`/api/store/items/${ITEM_ID}/unpublish`, {
      fetch: workerApi.fetch,
      method: "POST",
      session: SIGNED_OUT,
    });

    expect(response?.status).toBe(401);
    expect(workerApi.calls).toEqual([]);
  });

  it("forgets the stored session when the Worker answers 401", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "yunari-store-401-"));
    try {
      const store = createStoreSessionStore(
        dir,
        createSecretStore(dir, fakeKeyProtector),
      );
      await store.write(held);
      const refused = worker(
        () => new Response("Session expired", { status: 401 }),
      );

      const response = await call("/api/store/mine", {
        fetch: refused.fetch,
        session: store,
      });
      expect(response?.status).toBe(401);
      expect(JSON.parse((await response?.text()) ?? "null")).toMatchObject({
        ok: false,
      });

      // The stored token is spent, so the file is gone and the settings page
      // it feeds now says signed out.
      await expect(
        readFile(path.join(dir, "store-session.bin"), "utf8"),
      ).rejects.toThrow();
      const state = await call("/api/store/session", {
        fetch: refused.fetch,
        session: store,
      });
      expect(await state?.json()).toEqual({ signedIn: false });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps the Worker's status for a refusal and answers 502 when unreachable", async () => {
    const refused = worker(
      () => new Response("Broken preview", { status: 403 }),
    );
    const response = await call(`/api/store/items/${ITEM_ID}/publish`, {
      fetch: refused.fetch,
      method: "POST",
    });
    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({
      ok: false,
      message: "Broken preview",
    });

    const unreachable = worker(() => {
      throw new Error("offline");
    });
    const offline = await call("/api/store/mine", {
      fetch: unreachable.fetch,
    });
    expect(offline?.status).toBe(502);
    const body = (await offline?.json()) as {
      readonly ok?: boolean;
      readonly message?: unknown;
    };
    expect(body).toMatchObject({ ok: false });
    expect(typeof body.message).toBe("string");
  });

  it("keeps the loopback-only guard it shares with the sign-in routes", async () => {
    const workerApi = worker(() => json({ entries: [] }));

    const foreign = await call("/api/store/mine", {
      fetch: workerApi.fetch,
      remoteAddress: "192.168.1.50",
    });
    expect(foreign?.status).toBe(403);

    const crossOrigin = await call("/api/store/mine", {
      fetch: workerApi.fetch,
      origin: "https://evil.example",
    });
    expect(crossOrigin?.status).toBe(403);

    expect(workerApi.calls).toEqual([]);
  });
});
