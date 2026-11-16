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
 * reuses the author's existing listing when the name matches, and drives the
 * Worker's existing pack routes with its own token.
 */

const MEMBER_ID = "3f2a1c9e-8b7d-4c6a-9e0f-1a2b3c4d5e6f";
const OTHER_ID = "7c9d2b1a-4e5f-4a8b-9c0d-1e2f3a4b5c6d";
const ORIGIN = "https://store.test";
const UPLOAD_URL = "https://store.test/api/me/uploads/1";

/** One catalogue entry, every field the reader holds. */
function entry(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    kind: "dashboard-theme",
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
    ...overrides,
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

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

/** The store as this test answers it: the catalogue, the author's own rows, one
 *  member's picture, and the pack routes the host drives. Every call is recorded
 *  so a case can assert what was and was not sent. */
function storeOf(options: {
  readonly entries: readonly Record<string, unknown>[];
  readonly mine?: readonly Record<string, unknown>[];
  readonly indexOk?: boolean;
  readonly thumbnailOk?: boolean;
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
      return json({
        generatedAt: "2026-11-16T00:00:00Z",
        entries: options.entries,
      });
    }
    if (url === `${ORIGIN}/api/me/items`) {
      return json({ entries: options.mine ?? [] });
    }
    for (const item of options.entries) {
      if (url === `${ORIGIN}/${String(item["thumbnail"])}`) {
        return options.thumbnailOk === false
          ? new Response("missing", { status: 404 })
          : new Response(PNG, { status: 200 });
      }
    }
    if (url.endsWith("/versions")) {
      const asked = JSON.parse(body ?? "{}") as { readonly version?: string };
      return json({
        version: asked.version,
        status: "pending",
        uploadUrl: UPLOAD_URL,
      });
    }
    if (url === UPLOAD_URL) return new Response(null, { status: 200 });
    if (url.endsWith("/finalize")) {
      return json({ ok: true, status: "pending", version: "1.0.0" });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
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

/** The version request's header, parsed. */
function headerOf(calls: readonly Call[]): Record<string, unknown> {
  const call = calls.find((one) => one.url.endsWith("/versions"));
  return JSON.parse(call?.body ?? "{}") as Record<string, unknown>;
}

describe("the collection submission route", () => {
  it("packages the draft the host read and drives the pack routes", async () => {
    const store = storeOf({ entries: [entry(MEMBER_ID)] });
    const answered = await submit(draft(), depsOf(store.fetcher));
    expect(answered?.status).toBe(200);

    const header = headerOf(store.calls);
    expect(header["kind"]).toBe("collection");
    expect(header["name"]).toBe("Ops pack");
    expect(header["version"]).toBe("1.0.0");
    expect(header["metadata"]).toEqual({
      name: "Ops pack",
      description: "Everything an ops desk needs.",
      includes: [{ id: MEMBER_ID, optional: false }],
    });

    expect(store.calls.find((call) => call.url === UPLOAD_URL)?.method).toBe(
      "PUT",
    );
    expect(
      store.calls.find((call) => call.url.endsWith("/finalize"))?.url,
    ).toContain("/api/me/items/");

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

    expect((await submit(draft(), depsOf(fetcher)))?.status).toBe(200);

    const bytes = uploaded;
    expect(bytes).toBeDefined();
    const read = readCollectionPackage(bytes as Uint8Array);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.package.name).toBe("Ops pack");
    expect(read.package.includes).toEqual([{ id: MEMBER_ID, optional: false }]);

    const header = headerOf(store.calls);
    expect(header["sha256"]).toBe(
      createHash("sha256")
        .update(bytes as Uint8Array)
        .digest("hex"),
    );
    expect(header["bytes"]).toBe((bytes as Uint8Array).byteLength);
  });

  it("covers the collection with its first required member's published picture", async () => {
    const optional = entry(OTHER_ID);
    const store = storeOf({ entries: [entry(MEMBER_ID), optional] });
    let finalized: Record<string, unknown> = {};
    const fetcher = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith("/finalize")) {
        finalized = JSON.parse(String(init?.body)) as Record<string, unknown>;
      }
      return store.fetcher(input as string, init);
    }) as unknown as typeof fetch;

    const answered = await submit(
      draft({
        includes: [
          { id: OTHER_ID, optional: true },
          { id: MEMBER_ID, optional: false },
        ],
      }),
      depsOf(fetcher),
    );
    expect(answered?.status).toBe(200);
    expect(
      store.calls.some(
        (call) => call.url === `${ORIGIN}/catalogue/${MEMBER_ID}/thumbnail.png`,
      ),
    ).toBe(true);
    // The picture uploaded is the member's own bytes, not a stand-in.
    expect(Buffer.from(String(finalized["thumbnail"]), "base64")).toEqual(
      Buffer.from(PNG),
    );
  });

  it("refuses when the cover cannot be fetched, naming the member", async () => {
    const store = storeOf({
      entries: [entry(MEMBER_ID, { name: "Wall" })],
      thumbnailOk: false,
    });
    const answered = await submit(draft(), depsOf(store.fetcher));
    expect(answered?.status).toBe(502);
    expect(await answered?.json()).toEqual({
      ok: false,
      message:
        'The collection\'s cover could not be fetched from "Wall", so this collection was not submitted.',
    });
    expect(store.calls.some((call) => call.url.endsWith("/versions"))).toBe(
      false,
    );
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
      entries: [entry(MEMBER_ID, { kind: "collection" })],
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

  it("adds a version to the author's collection with the same name", async () => {
    const existingId = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
    const store = storeOf({
      entries: [entry(MEMBER_ID)],
      mine: [
        entry(existingId, {
          kind: "collection",
          name: "Ops pack",
          version: "1.0.0",
          status: "published",
        }),
      ],
    });
    const answered = await submit(draft(), depsOf(store.fetcher));
    expect(answered?.status).toBe(200);

    const versions = store.calls.filter((call) =>
      call.url.endsWith("/versions"),
    );
    expect(versions).toHaveLength(1);
    expect(versions[0]?.url).toContain(`/api/me/items/${existingId}/`);
    const header = headerOf(store.calls);
    expect(header["version"]).toBe("1.1.0");
    expect(await answered?.json()).toEqual({
      ok: true,
      status: "pending",
      version: { from: "1.0.0", to: "1.1.0", level: "minor" },
    });
  });

  it("mints a new listing when no collection has that name", async () => {
    const store = storeOf({
      entries: [entry(MEMBER_ID)],
      mine: [entry(MEMBER_ID, { name: "Something else", status: "published" })],
    });
    const answered = await submit(draft(), depsOf(store.fetcher));
    expect(answered?.status).toBe(200);
    expect(headerOf(store.calls)["version"]).toBe("1.0.0");
    expect(
      store.calls.filter((call) => call.url.endsWith("/versions")),
    ).toHaveLength(1);
  });
});
