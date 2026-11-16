import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { readCollectionPackage } from "@yunari/theme-package";
import { describe, expect, it } from "vitest";
import type { ThemeStore } from "../themes/store.js";
import {
  handleSubmitRoute,
  SUBMIT_PATH,
  type SubmitRouteDeps,
} from "./submit.js";

/**
 * The collection half of the submit route: the browser posts a draft, and the
 * host packages it, revalidates every include against the published catalogue,
 * and drives the Worker's existing pack routes with its own token.
 */

const MEMBER_ID = "3f2a1c9e-8b7d-4c6a-9e0f-1a2b3c4d5e6f";
const OTHER_ID = "7c9d2b1a-4e5f-4a8b-9c0d-1e2f3a4b5c6d";
const ORIGIN = "https://store.test";
const UPLOAD_URL = "https://store.test/api/me/uploads/1";

/** One published catalogue entry, every field the reader holds. */
function entry(id: string, kind = "dashboard-theme"): Record<string, unknown> {
  return {
    id,
    kind,
    name: `Item ${id.slice(0, 4)}`,
    version: "1.0.0",
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-02T00:00:00Z",
    downloads: 0,
    favorites: 0,
    packageUrl: `https://store.test/catalogue/${id}/1.0.0.zip`,
    thumbnail: `catalogue/${id}/thumbnail.png`,
    facets: {
      author: "ada",
      colourMode: "dark",
      sensors: [],
      tags: [],
      orientation: "landscape",
      aspect: "16:9",
      width: 1920,
      height: 1080,
    },
    members: [],
  };
}

function requestOf(body: unknown): IncomingMessage {
  const stream = Readable.from([
    Buffer.from(JSON.stringify(body)),
  ]) as unknown as IncomingMessage;
  stream.method = "POST";
  stream.headers = {
    host: "127.0.0.1:39231",
    "content-type": "application/json",
  };
  Object.assign(stream, { socket: { remoteAddress: "127.0.0.1" } });
  return stream;
}

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: string | undefined;
}

/** The store as this test answers it: one catalogue document, and the pack
 *  routes the host drives. Every call is recorded so a case can assert what was
 *  and was not sent. */
function storeOf(options: {
  readonly entries: readonly Record<string, unknown>[];
  readonly indexOk?: boolean;
}) {
  const calls: Call[] = [];
  const fetcher = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? "GET";
    const body =
      typeof init?.body === "string"
        ? init.body
        : init?.body === undefined
          ? undefined
          : "<bytes>";
    calls.push({ url, method, body });

    if (url === `${ORIGIN}/index.json`) {
      if (options.indexOk === false) {
        return new Response("nope", { status: 500 });
      }
      return new Response(
        JSON.stringify({
          generatedAt: "2026-11-16T00:00:00Z",
          entries: options.entries,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.endsWith("/versions")) {
      return new Response(
        JSON.stringify({
          version: "1.0.0",
          status: "pending",
          uploadUrl: UPLOAD_URL,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url === UPLOAD_URL) return new Response(null, { status: 200 });
    if (url.endsWith("/finalize")) {
      return new Response(
        JSON.stringify({ ok: true, status: "pending", version: "1.0.0" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

function depsOf(fetcher: typeof fetch): SubmitRouteDeps {
  return {
    origin: ORIGIN,
    sessionStore: {
      read: async () => ({ token: "session-token" }),
      clear: async () => undefined,
    } as unknown as SubmitRouteDeps["sessionStore"],
    themeStore: undefined as unknown as ThemeStore,
    thumbnails: undefined,
    fetch: fetcher,
    now: () => new Date("2026-11-16T00:00:00Z"),
  };
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    kind: "collection",
    name: "Ops pack",
    description: "Everything an ops desk needs.",
    includes: [{ id: MEMBER_ID, optional: false }],
    ...overrides,
  };
}

async function submit(body: unknown, deps: SubmitRouteDeps) {
  return handleSubmitRoute(
    requestOf(body),
    new URL(SUBMIT_PATH, "http://x"),
    deps,
  );
}

describe("the collection submission route", () => {
  it("packages the draft the host read and drives the pack routes", async () => {
    const store = storeOf({ entries: [entry(MEMBER_ID)] });
    const answered = await submit(draft(), depsOf(store.fetcher));
    expect(answered?.status).toBe(200);

    const versionCall = store.calls.find((call) =>
      call.url.endsWith("/versions"),
    );
    expect(versionCall?.body).toBeDefined();
    const header = JSON.parse(versionCall?.body ?? "{}") as Record<
      string,
      unknown
    >;
    expect(header["kind"]).toBe("collection");
    expect(header["name"]).toBe("Ops pack");
    expect(header["version"]).toBe("1.0.0");
    expect(header["metadata"]).toEqual({
      name: "Ops pack",
      description: "Everything an ops desk needs.",
      includes: [{ id: MEMBER_ID, optional: false }],
    });

    const uploadCall = store.calls.find((call) => call.url === UPLOAD_URL);
    expect(uploadCall?.method).toBe("PUT");

    const finalized = store.calls.find((call) =>
      call.url.endsWith("/finalize"),
    );
    expect(finalized?.url).toContain("/api/me/items/");
    expect(JSON.parse(finalized?.body ?? "{}")).toMatchObject({
      thumbnail: expect.stringMatching(/^iVBOR/),
    });

    expect(await answered?.json()).toEqual({
      ok: true,
      status: "pending",
      version: { from: null, to: "1.0.0", level: "initial" },
    });
  });

  it("uploads bytes the format's own reader accepts, with their digest", async () => {
    const store = storeOf({ entries: [entry(MEMBER_ID)] });
    let uploaded: Uint8Array | undefined;
    const fetcher = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === UPLOAD_URL && init?.body !== undefined) {
        uploaded = init.body as unknown as Uint8Array;
      }
      return store.fetcher(input as string, init);
    }) as unknown as typeof fetch;

    const answered = await submit(draft(), depsOf(fetcher));
    expect(answered?.status).toBe(200);

    const bytes = uploaded;
    expect(bytes).toBeDefined();
    const read = readCollectionPackage(bytes as Uint8Array);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.package.name).toBe("Ops pack");
    expect(read.package.includes).toEqual([{ id: MEMBER_ID, optional: false }]);

    const headerCall = store.calls.find((call) =>
      call.url.endsWith("/versions"),
    );
    const header = JSON.parse(headerCall?.body ?? "{}") as Record<
      string,
      unknown
    >;
    expect(header["sha256"]).toBe(
      createHash("sha256")
        .update(bytes as Uint8Array)
        .digest("hex"),
    );
    expect(header["bytes"]).toBe((bytes as Uint8Array).byteLength);
  });

  it("refuses an include the catalogue does not list, before any upload", async () => {
    const store = storeOf({ entries: [entry(MEMBER_ID)] });
    const answered = await submit(
      draft({ includes: [{ id: OTHER_ID, optional: false }] }),
      depsOf(store.fetcher),
    );
    expect(answered?.status).toBe(400);
    expect(await answered?.json()).toEqual({
      ok: false,
      message: `The collection includes "${OTHER_ID}", which is not a published item.`,
    });
    expect(store.calls.some((call) => call.url.endsWith("/versions"))).toBe(
      false,
    );
    expect(store.calls.some((call) => call.url === UPLOAD_URL)).toBe(false);
  });

  it("refuses a collection as a member, by name", async () => {
    const store = storeOf({
      entries: [entry(MEMBER_ID, "collection")],
    });
    const answered = await submit(draft(), depsOf(store.fetcher));
    expect(answered?.status).toBe(400);
    expect(await answered?.json()).toEqual({
      ok: false,
      message: `The collection includes "${MEMBER_ID}", which is itself a collection; collections are one level deep.`,
    });
  });

  it("refuses a draft the format reader refuses, without calling anything", async () => {
    const store = storeOf({ entries: [entry(MEMBER_ID)] });
    const answered = await submit(draft({ name: "" }), depsOf(store.fetcher));
    expect(answered?.status).toBe(400);
    const body = (await answered?.json()) as { message: string };
    expect(body.message).toContain("name");
    expect(store.calls).toEqual([]);
  });

  it("refuses when the catalogue cannot be read", async () => {
    const store = storeOf({ entries: [], indexOk: false });
    const answered = await submit(draft(), depsOf(store.fetcher));
    expect(answered?.status).toBe(502);
  });
});
