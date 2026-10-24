import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import type { CustomSource } from "../../settings/sources.js";
import { fetchSource } from "./fetch-source.js";

/** 1 MiB: the spec's cap, not a tuning knob. */
const MiB = 1024 * 1024;

interface SourcePatch {
  readonly id?: string;
  readonly url?: string;
  readonly timeoutMs?: number;
  readonly query?: Readonly<Record<string, string>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly auth?: NonNullable<CustomSource["auth"]>;
}

function sourceOf(patch: SourcePatch = {}): CustomSource {
  return {
    id: patch.id ?? "src",
    name: "Source",
    url: patch.url ?? "http://127.0.0.1:8080/data",
    intervalMs: 60_000,
    timeoutMs: patch.timeoutMs ?? 5_000,
    ...(patch.query === undefined ? {} : { query: patch.query }),
    ...(patch.headers === undefined ? {} : { headers: patch.headers }),
    ...(patch.auth === undefined ? {} : { auth: patch.auth }),
    fields: [],
  };
}

function json(value: unknown, type = "application/json"): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": type },
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

interface Call {
  readonly url: URL;
  readonly headers: Headers;
  readonly init: RequestInit;
}

/** A `fetch` seam that records what the client asked for. */
function serve(handler: (call: Call) => Response | Promise<Response>): {
  fetchImpl: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    const call: Call = {
      url,
      headers: new Headers(init?.headers),
      init: init ?? {},
    };
    calls.push(call);
    return handler(call);
  };

  return { fetchImpl, calls };
}

/** A first-in-first-out socket the test closes by hand. */
function listen(handler: RequestListener): Promise<{
  origin: string;
  close: () => Promise<void>;
}> {
  const server = createServer(handler);
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        close: () => {
          server.closeAllConnections();
          return new Promise<void>((done, reject) => {
            server.close((error) =>
              error === undefined ? done() : reject(error),
            );
          });
        },
      });
    }),
  );
}

/** A JSON body delivered in chunks, so the cap is crossed mid-stream. */
function streamed(
  text: string,
  chunkSize: number,
  onCancel?: () => void,
): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, bytes.length);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
    cancel() {
      onCancel?.();
    },
  });
}

/** An endless JSON-ish stream, so a stream that closes itself cannot be
 *  mistaken for the client's own abort. */
function endlessChunk(
  chunkSize: number,
  onCancel: () => void,
): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(chunkSize).fill(0x61);

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(chunk);
    },
    cancel() {
      onCancel();
    },
  });
}

describe("fetchSource", () => {
  describe("the request", () => {
    it("is a bodyless GET that never delegates redirect following", async () => {
      const { fetchImpl, calls } = serve(() => json({ ok: true }));

      const outcome = await fetchSource(
        sourceOf(),
        "sekrit",
        fetchImpl,
        () => 0,
      );

      expect(outcome).toEqual({ ok: true, body: { ok: true }, elapsedMs: 0 });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.init.method).toBeUndefined();
      expect(calls[0]?.init.body).toBeUndefined();
      expect(calls[0]?.init.redirect).toBe("manual");
      expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    });

    it("cannot express another method or a request body", () => {
      // The shape is the refusal: a caller has no parameter through which to
      // declare a method or a body, so no other request can be built.
      type SourceKeys = keyof CustomSource;
      const method: "method" extends SourceKeys ? true : false = false;
      const body: "body" extends SourceKeys ? true : false = false;
      expect(method).toBe(false);
      expect(body).toBe(false);
    });

    it("adds the source's query and its bearer credential", async () => {
      const { fetchImpl, calls } = serve(() => json({}));

      await fetchSource(
        sourceOf({
          url: "http://127.0.0.1:8080/data",
          query: { q: "1" },
          auth: { kind: "bearer", credentialId: "c" },
        }),
        "sekrit",
        fetchImpl,
        () => 0,
      );

      expect(calls[0]?.url.searchParams.get("q")).toBe("1");
      expect(calls[0]?.headers.get("authorization")).toBe("Bearer sekrit");
    });

    it("encodes basic, header and query credentials", async () => {
      const cases: Array<{
        auth: NonNullable<CustomSource["auth"]>;
        check: (call: Call) => void;
      }> = [
        {
          auth: { kind: "basic", credentialId: "c" },
          check: (call) =>
            expect(call.headers.get("authorization")).toBe(
              `Basic ${Buffer.from("user:pass").toString("base64")}`,
            ),
        },
        {
          auth: { kind: "header", credentialId: "c", headerName: "x-api-key" },
          check: (call) =>
            expect(call.headers.get("x-api-key")).toBe("user:pass"),
        },
        {
          auth: { kind: "query", credentialId: "c", queryName: "api_key" },
          check: (call) =>
            expect(call.url.searchParams.get("api_key")).toBe("user:pass"),
        },
      ];

      for (const { auth, check } of cases) {
        const { fetchImpl, calls } = serve(() => json({}));
        await fetchSource(sourceOf({ auth }), "user:pass", fetchImpl, () => 0);
        const call = calls[0];
        if (call !== undefined) check(call);
      }
    });

    it("refuses an auth block whose credential is absent", async () => {
      const { fetchImpl, calls } = serve(() => json({}));

      const outcome = await fetchSource(
        sourceOf({ auth: { kind: "bearer", credentialId: "c" } }),
        undefined,
        fetchImpl,
        () => 0,
      );

      expect(outcome.ok).toBe(false);
      expect(calls).toHaveLength(0);
    });

    it("measures elapsed time from the injected clock", async () => {
      const { fetchImpl } = serve(() => json({}));
      let clock = 1_000;
      const nowMs = () => (clock += 7);

      const outcome = await fetchSource(
        sourceOf(),
        undefined,
        fetchImpl,
        nowMs,
      );

      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.elapsedMs).toBe(7);
    });
  });

  describe("the answer", () => {
    it("reports a non-2xx status instead of a value", async () => {
      const { fetchImpl } = serve(
        () =>
          new Response("nope", {
            status: 503,
            headers: { "content-type": "text/plain" },
          }),
      );

      const outcome = await fetchSource(
        sourceOf(),
        undefined,
        fetchImpl,
        () => 0,
      );

      expect(outcome).toEqual({
        ok: false,
        status: 503,
        reason: expect.stringContaining("503"),
      });
    });

    it("refuses a non-JSON content type and names what arrived", async () => {
      const { fetchImpl } = serve(
        () =>
          new Response("<html></html>", {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
      );

      const outcome = await fetchSource(
        sourceOf(),
        undefined,
        fetchImpl,
        () => 0,
      );

      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.reason).toContain("text/html");
    });

    it("accepts application/json and a +json media type", async () => {
      for (const type of ["application/json", "application/vnd.api+json"]) {
        const { fetchImpl } = serve(() => json({ a: 1 }, type));
        const outcome = await fetchSource(
          sourceOf(),
          undefined,
          fetchImpl,
          () => 0,
        );
        expect(outcome.ok).toBe(true);
      }
    });

    it("refuses a body that is not JSON", async () => {
      const { fetchImpl } = serve(
        () =>
          new Response("{not json", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      );

      const outcome = await fetchSource(
        sourceOf(),
        undefined,
        fetchImpl,
        () => 0,
      );

      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.reason).toMatch(/JSON/i);
    });
  });

  describe("the 1 MiB body cap", () => {
    const payload = (bytes: number) => `"${"a".repeat(bytes - 2)}"`;

    it("accepts exactly 1 MiB", async () => {
      const text = payload(MiB);
      expect(Buffer.byteLength(text)).toBe(MiB);

      const { fetchImpl } = serve(
        () =>
          new Response(streamed(text, 64 * 1024), {
            headers: { "content-type": "application/json" },
          }),
      );

      const outcome = await fetchSource(
        sourceOf(),
        undefined,
        fetchImpl,
        () => 0,
      );

      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.body).toBe("a".repeat(MiB - 2));
    });

    it("refuses 1 MiB + 1 byte as it arrives and cancels the stream", async () => {
      let cancelled = false;

      const { fetchImpl } = serve(
        () =>
          new Response(
            endlessChunk(64 * 1024, () => {
              cancelled = true;
            }),
            { headers: { "content-type": "application/json" } },
          ),
      );

      const outcome = await fetchSource(
        sourceOf(),
        undefined,
        fetchImpl,
        () => 0,
      );

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.reason).toMatch(/larger|1 MiB|1048576/i);
      expect(cancelled).toBe(true);
    });
  });

  describe("the deadline", () => {
    it("aborts a request that never answers", async () => {
      const fetchImpl: typeof fetch = (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        });

      const outcome = await fetchSource(
        sourceOf({ timeoutMs: 25 }),
        undefined,
        fetchImpl,
        () => 0,
      );

      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.reason).toMatch(/time/i);
    });

    it("aborts the body read, not only the headers", async () => {
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        pull() {
          return new Promise<void>(() => undefined);
        },
        cancel() {
          cancelled = true;
        },
      });

      const fetchImpl: typeof fetch = async () =>
        new Response(body, { headers: { "content-type": "application/json" } });

      const outcome = await fetchSource(
        sourceOf({ timeoutMs: 25 }),
        undefined,
        fetchImpl,
        () => 0,
      );

      expect(outcome.ok).toBe(false);
      expect(cancelled).toBe(true);
    });
  });

  describe("redirects", () => {
    it("follows three same-scheme hops", async () => {
      const { fetchImpl, calls } = serve(({ url }) => {
        const path = url.pathname;
        if (path === "/0") return redirect("/1");
        if (path === "/1") return redirect("/2");
        if (path === "/2") return redirect("/3");
        return json({ done: true });
      });

      const outcome = await fetchSource(
        sourceOf({ url: "http://127.0.0.1:8080/0" }),
        undefined,
        fetchImpl,
        () => 0,
      );

      expect(outcome.ok).toBe(true);
      expect(calls.map((call) => call.url.pathname)).toEqual([
        "/0",
        "/1",
        "/2",
        "/3",
      ]);
    });

    it("refuses the fourth redirect", async () => {
      const { fetchImpl, calls } = serve(({ url }) =>
        redirect(`/${Number(url.pathname.slice(1)) + 1}`),
      );

      const outcome = await fetchSource(
        sourceOf({ url: "http://127.0.0.1:8080/0" }),
        undefined,
        fetchImpl,
        () => 0,
      );

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.reason).toMatch(/redirect/i);
      expect(calls).toHaveLength(4);
    });

    it("refuses a scheme change, including an https downgrade", async () => {
      for (const start of [
        "https://127.0.0.1:8443/start",
        "http://127.0.0.1:8080/start",
      ]) {
        const { fetchImpl, calls } = serve(() =>
          redirect(
            start.startsWith("https")
              ? "http://127.0.0.1:8080/next"
              : "https://127.0.0.1:8443/next",
          ),
        );

        const outcome = await fetchSource(
          sourceOf({ url: start }),
          undefined,
          fetchImpl,
          () => 0,
        );

        expect(outcome.ok).toBe(false);
        if (!outcome.ok) expect(outcome.reason).toMatch(/redirect|scheme/i);
        expect(calls).toHaveLength(1);
      }
    });

    it("keeps the credential across a same-origin redirect", async () => {
      const { fetchImpl, calls } = serve(({ url }) =>
        url.pathname === "/start" ? redirect("/next") : json({}),
      );

      await fetchSource(
        sourceOf({
          url: "http://127.0.0.1:8080/start",
          auth: { kind: "bearer", credentialId: "c" },
        }),
        "sekrit",
        fetchImpl,
        () => 0,
      );

      expect(calls[1]?.headers.get("authorization")).toBe("Bearer sekrit");
    });

    it("drops the credential when the redirect changes the origin", async () => {
      const { fetchImpl, calls } = serve(({ url }) =>
        url.hostname === "127.0.0.1"
          ? redirect("http://127.0.0.2:8080/next")
          : json({}),
      );

      const outcome = await fetchSource(
        sourceOf({
          url: "http://127.0.0.1:8080/start",
          auth: { kind: "bearer", credentialId: "c" },
        }),
        "sekrit",
        fetchImpl,
        () => 0,
      );

      expect(outcome.ok).toBe(true);
      expect(calls[0]?.headers.get("authorization")).toBe("Bearer sekrit");
      expect(calls[1]?.headers.get("authorization")).toBeNull();
    });

    it("drops a plain Authorization header across origins too", async () => {
      const { fetchImpl, calls } = serve(({ url }) =>
        url.hostname === "127.0.0.1"
          ? redirect("http://127.0.0.2:8080/next")
          : json({}),
      );

      await fetchSource(
        sourceOf({
          url: "http://127.0.0.1:8080/start",
          headers: { Authorization: "token static" },
        }),
        undefined,
        fetchImpl,
        () => 0,
      );

      expect(calls[0]?.headers.get("authorization")).toBe("token static");
      expect(calls[1]?.headers.get("authorization")).toBeNull();
    });
  });

  describe("refused destinations", () => {
    it("refuses cloud metadata and link-local addresses without connecting", async () => {
      for (const url of [
        "http://169.254.169.254/latest/meta-data",
        "http://169.254.1.1/",
        "http://[fe80::1]/",
      ]) {
        const { fetchImpl, calls } = serve(() => json({}));

        const outcome = await fetchSource(
          sourceOf({ url }),
          undefined,
          fetchImpl,
          () => 0,
        );

        expect(outcome.ok).toBe(false);
        if (!outcome.ok) expect(outcome.reason).toMatch(/link-local/i);
        expect(calls).toHaveLength(0);
      }
    });

    it("allows loopback and private LAN addresses", async () => {
      for (const url of [
        "http://127.0.0.1:8080/",
        "http://192.168.1.20:8080/",
        "http://10.1.2.3:8080/",
        "http://[::1]:8080/",
      ]) {
        const { fetchImpl, calls } = serve(() => json({}));

        const outcome = await fetchSource(
          sourceOf({ url }),
          undefined,
          fetchImpl,
          () => 0,
        );

        expect(outcome.ok).toBe(true);
        expect(calls).toHaveLength(1);
      }
    });

    it("re-validates the destination on a redirect hop", async () => {
      const { fetchImpl, calls } = serve(() =>
        redirect("http://169.254.169.254/latest/meta-data"),
      );

      const outcome = await fetchSource(
        sourceOf({ url: "http://127.0.0.1:8080/start" }),
        undefined,
        fetchImpl,
        () => 0,
      );

      expect(outcome.ok).toBe(false);
      expect(calls).toHaveLength(1);
    });
  });

  describe("concurrency", () => {
    it("runs at most four requests across the process", async () => {
      let active = 0;
      let peak = 0;
      let open: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });

      const fetchImpl: typeof fetch = async () => {
        active++;
        peak = Math.max(peak, active);
        await gate;
        active--;
        return json({});
      };

      const calls = [0, 1, 2, 3, 4].map((n) =>
        fetchSource(
          sourceOf({ id: `s${n}`, url: `http://127.0.0.1:900${n}/` }),
          undefined,
          fetchImpl,
          () => 0,
        ),
      );

      // Long enough for every caller that is allowed to start to have reached
      // the gate; one more would have raised the peak.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(peak).toBe(4);
      expect(active).toBe(4);

      open();
      for (const outcome of await Promise.all(calls)) {
        expect(outcome.ok).toBe(true);
      }
      expect(peak).toBe(4);
    });

    it("serialises two fetches of the same source", async () => {
      let active = 0;
      let peak = 0;
      const gates: (() => void)[] = [];

      const fetchImpl: typeof fetch = async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => gates.push(resolve));
        active--;
        return json({});
      };

      const source = sourceOf({ id: "same", url: "http://127.0.0.1:8080/" });
      const results = [
        fetchSource(source, undefined, fetchImpl, () => 0),
        fetchSource(source, undefined, fetchImpl, () => 0),
      ];

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(peak).toBe(1);
      expect(gates).toHaveLength(1);

      gates[0]?.();
      await vi.waitFor(() => expect(gates).toHaveLength(2));
      gates[1]?.();

      for (const outcome of await Promise.all(results)) {
        expect(outcome.ok).toBe(true);
      }
      expect(peak).toBe(1);
    });
  });

  describe("secrets", () => {
    it("never carries the credential into a reason", async () => {
      const fetchImpl: typeof fetch = async () => {
        throw new Error("refused http://127.0.0.1:8080/x while sending sekrit");
      };

      const outcome = await fetchSource(
        sourceOf({ auth: { kind: "bearer", credentialId: "c" } }),
        "sekrit",
        fetchImpl,
        () => 0,
      );

      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.reason).not.toContain("sekrit");
      expect(outcome.reason).toContain("its configured address");
    });
  });

  describe("a real loopback server", () => {
    it("fetches a JSON answer over a real socket", async () => {
      const origin = await listen((_request, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"temp":21.5}');
      });

      try {
        const outcome = await fetchSource(
          sourceOf({ url: `${origin.origin}/data` }),
          undefined,
          fetch,
          () => Date.now(),
        );

        expect(outcome).toEqual({
          ok: true,
          body: { temp: 21.5 },
          elapsedMs: expect.any(Number),
        });
      } finally {
        await origin.close();
      }
    });

    it("stops reading a real stream past 1 MiB", async () => {
      const total = 8 * MiB;
      const chunk = Buffer.alloc(64 * 1024, 0x61);
      let written = 0;
      let closed = false;

      const origin = await listen((_request, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.on("close", () => {
          closed = true;
        });
        response.on("error", () => undefined);

        const pump = () => {
          while (!closed && written < total) {
            written += chunk.length;
            if (!response.write(chunk)) {
              response.once("drain", pump);
              return;
            }
          }
          if (!closed) response.end();
        };

        pump();
      });

      try {
        const outcome = await fetchSource(
          sourceOf({ url: `${origin.origin}/big`, timeoutMs: 5_000 }),
          undefined,
          fetch,
          () => Date.now(),
        );

        expect(outcome.ok).toBe(false);
        // The client hung up rather than draining the whole reply: the cap was
        // enforced against the socket, not measured after buffering it.
        expect(written).toBeLessThan(total);
        await vi.waitFor(() => expect(closed).toBe(true));
      } finally {
        await origin.close();
      }
    });
  });
});
