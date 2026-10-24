import { expect, it, vi } from "vitest";
import {
  createSourcesClient,
  SourceRefusedError,
  type SourceRow,
} from "./sources-client.js";

/**
 * The sources seam's own contract: what each route's answer is read as, and
 * what each write puts on the wire.
 *
 * **Read here rather than only through the section**, because the section is
 * handed a fake and the two would agree with each other while disagreeing with
 * the host. The shapes below are `packages/host/src/server.ts`'s own answers.
 */

/** A host that answers one route and records what it was asked. */
function host(answer: (url: string, init?: RequestInit) => Response): {
  readonly fetch: typeof fetch;
  readonly calls: { readonly method: string; readonly url: string }[];
  readonly bodies: unknown[];
} {
  const calls: { readonly method: string; readonly url: string }[] = [];
  const bodies: unknown[] = [];
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ method: init?.method ?? "GET", url: String(input) });
      if (typeof init?.body === "string") bodies.push(JSON.parse(init.body));
      return answer(String(input), init);
    },
  );
  return { fetch: fetcher as unknown as typeof fetch, calls, bodies };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** One source as the list route answers it, with the health beside it. */
const ROW: SourceRow = {
  id: "fixture",
  name: "Fixture",
  url: "http://127.0.0.1:4291/data",
  intervalMs: 60_000,
  timeoutMs: 5_000,
  auth: { kind: "query", queryName: "apikey", credentialId: "fixture-key" },
  fields: [
    {
      id: "cpu-load",
      label: "CPU load",
      pointer: "/cpu/load",
      type: "number",
    },
  ],
  fieldCount: 1,
  health: "ok",
  lastError: null,
  lastSuccessAt: "2026-10-24T10:00:00.000Z",
};

it("reads each source with its health, keeping only the shapes it can draw", async () => {
  const { fetch, calls } = host(() =>
    json({
      sources: [
        ROW,
        // A source with no id cannot be named by a row, so it is dropped.
        { name: "nameless" },
        // A health this build does not know reads as waiting, not as ok.
        { ...ROW, id: "unknown-health", health: "something-new" },
        {
          ...ROW,
          id: "with-junk-field",
          fields: [{ ...ROW.fields[0] }, { id: "bad-type", type: "date" }],
          fieldCount: 2,
        },
      ],
      issues: [],
    }),
  );

  const rows = await createSourcesClient(fetch).list();

  expect(calls).toEqual([{ method: "GET", url: "/api/sources" }]);
  expect(rows.map((row) => row.id)).toEqual([
    "fixture",
    "unknown-health",
    "with-junk-field",
  ]);
  expect(rows[0]?.health).toBe("ok");
  expect(rows[0]?.lastError).toBeNull();
  expect(rows[0]?.lastSuccessAt).toBe("2026-10-24T10:00:00.000Z");
  expect(rows[1]?.health).toBe("waiting");
  // The field the renderer cannot honour is dropped rather than printed, but
  // the route's own count is kept: the row says how many the host holds.
  expect(rows[2]?.fields.map((field) => field.id)).toEqual(["cpu-load"]);
  expect(rows[2]?.fieldCount).toBe(2);
});

it("sends the whole source and never the read-only health a list row carries", async () => {
  const { fetch, calls, bodies } = host(() => json({ ok: true }));

  await createSourcesClient(fetch).save(ROW);

  expect(calls).toEqual([{ method: "PUT", url: "/api/sources/fixture" }]);
  // Replace semantics: every authored key travels, and the route would refuse
  // `health`, `fieldCount`, `lastError` or `lastSuccessAt` as unknown keys.
  expect(bodies[0]).toEqual({
    id: "fixture",
    name: "Fixture",
    url: "http://127.0.0.1:4291/data",
    intervalMs: 60_000,
    timeoutMs: 5_000,
    auth: { kind: "query", queryName: "apikey", credentialId: "fixture-key" },
    fields: [
      {
        id: "cpu-load",
        label: "CPU load",
        pointer: "/cpu/load",
        type: "number",
      },
    ],
  });
});

it("rejects a refused save with the route's field and reason", async () => {
  const { fetch } = host(() =>
    json(
      {
        ok: false,
        field: "fixture",
        reason: 'source "fixture" field "cpu-load" pointer must be a string',
      },
      400,
    ),
  );

  const failure = await createSourcesClient(fetch)
    .save(ROW)
    .catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(SourceRefusedError);
  expect(failure).toMatchObject({
    field: "fixture",
    reason: 'source "fixture" field "cpu-load" pointer must be a string',
  });
});

it("keeps a plain-text refusal as the host's own sentence", async () => {
  const { fetch } = host(
    () =>
      new Response("That source id is not valid.", {
        status: 413,
      }),
  );

  const failure = await createSourcesClient(fetch)
    .save(ROW)
    .catch((error: unknown) => error);

  expect(failure).not.toBeInstanceOf(SourceRefusedError);
  expect((failure as Error).message).toBe("That source id is not valid.");
});

it("answers which credential a delete left unreferenced", async () => {
  const { fetch, calls } = host(() =>
    json({ ok: true, unreferencedCredential: "fixture-key" }),
  );

  const answer = await createSourcesClient(fetch).remove("fixture");

  expect(calls).toEqual([{ method: "DELETE", url: "/api/sources/fixture" }]);
  expect(answer).toEqual({ unreferencedCredential: "fixture-key" });
});

it("reads the test route's status, elapsed time and mapped values", async () => {
  const { fetch, calls } = host(() =>
    json({
      ok: true,
      status: 200,
      elapsedMs: 12,
      values: [{ id: "cpu-load", value: "42.5" }],
    }),
  );

  const result = await createSourcesClient(fetch).test("fixture");

  expect(calls).toEqual([{ method: "POST", url: "/api/sources/fixture/test" }]);
  expect(result).toEqual({
    ok: true,
    status: 200,
    elapsedMs: 12,
    values: [{ id: "cpu-load", value: "42.5" }],
  });
});
