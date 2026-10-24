import { describe, expect, it, vi } from "vitest";
import type { CustomSource } from "../../settings/sources.js";
import {
  type Call,
  endlessChunk,
  json,
  listen,
  MiB,
  serve,
  sourceOf,
  streamed,
} from "./fetch-source.fixture.js";
import { fetchSource } from "./fetch-source.js";

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
