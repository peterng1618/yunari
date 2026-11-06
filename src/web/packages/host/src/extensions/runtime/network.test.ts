import { describe, expect, it, vi } from "vitest";
import {
  guardedFetch,
  type HostLookup,
} from "../../providers/custom/fetch-source.js";

/**
 * A plugin's fetch is mediated: the manifest declares the hosts, the same
 * address policy runs on every hop, and nothing dials before the check. Every
 * seam here is fake, so no case reaches the network.
 */

const PUBLIC = [{ address: "93.184.216.34", family: 4 }] as const;

function publicResolve(): HostLookup & { readonly calls: string[] } {
  const calls: string[] = [];
  const resolve = async (host: string) => {
    calls.push(host);
    return PUBLIC;
  };
  return Object.assign(resolve, { calls });
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

interface Call {
  readonly url: URL;
  readonly init: RequestInit;
}

function serve(handler: (call: Call) => Response): {
  readonly fetchImpl: typeof fetch;
  readonly calls: Call[];
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
    const call = { url, init: init ?? {} };
    calls.push(call);
    return handler(call);
  };
  return { fetchImpl, calls };
}

const signal = (): AbortSignal => new AbortController().signal;

describe("guardedFetch", () => {
  it("refuses an undeclared host before resolving or dialling", async () => {
    const resolve = publicResolve();
    const fetchImpl = vi.fn<typeof fetch>();

    const outcome = await guardedFetch({
      url: "https://evil.test/x",
      allowedHosts: ["api.acme.test"],
      signal: signal(),
      maxBytes: 1024,
      fetchImpl,
      resolve,
    });

    expect(outcome).toMatchObject({
      ok: false,
      reason: expect.stringContaining("not declared"),
    });
    expect(resolve.calls).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("compares a declared host case-insensitively and ignores the port", async () => {
    const { fetchImpl, calls } = serve(() => json({ ok: true }));

    const outcome = await guardedFetch({
      url: "https://api.acme.test:8443/x",
      allowedHosts: ["API.ACME.TEST"],
      signal: signal(),
      maxBytes: 1024,
      fetchImpl,
      resolve: publicResolve(),
    });

    expect(outcome).toMatchObject({ ok: true, body: { ok: true } });
    expect(calls).toHaveLength(1);
  });

  it("re-checks the declared host on every redirect hop", async () => {
    const { fetchImpl, calls } = serve(() => redirect("https://evil.test/x"));

    const outcome = await guardedFetch({
      url: "https://api.acme.test/start",
      allowedHosts: ["api.acme.test"],
      signal: signal(),
      maxBytes: 1024,
      fetchImpl,
      resolve: publicResolve(),
    });

    expect(outcome).toMatchObject({
      ok: false,
      reason: expect.stringContaining("not declared"),
    });
    expect(calls).toHaveLength(1);
  });

  it("refuses a redirect that changes the scheme", async () => {
    const { fetchImpl, calls } = serve(() =>
      redirect("http://api.acme.test/next"),
    );

    const outcome = await guardedFetch({
      url: "https://api.acme.test/start",
      allowedHosts: ["api.acme.test"],
      signal: signal(),
      maxBytes: 1024,
      fetchImpl,
      resolve: publicResolve(),
    });

    expect(outcome).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/scheme/i),
    });
    expect(calls).toHaveLength(1);
  });

  it("refuses a redirect whose Location carries userinfo", async () => {
    const { fetchImpl, calls } = serve(() =>
      redirect("https://user:pass@api.acme.test/next"),
    );

    const outcome = await guardedFetch({
      url: "https://api.acme.test/start",
      allowedHosts: ["api.acme.test"],
      signal: signal(),
      maxBytes: 1024,
      fetchImpl,
      resolve: publicResolve(),
    });

    expect(outcome).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/credentials/i),
    });
    expect(calls).toHaveLength(1);
  });

  it("refuses more than three redirects by default", async () => {
    const { fetchImpl, calls } = serve(({ url }) =>
      redirect(`/${Number(url.pathname.slice(1)) + 1}`),
    );

    const outcome = await guardedFetch({
      url: "https://api.acme.test/0",
      allowedHosts: ["api.acme.test"],
      signal: signal(),
      maxBytes: 1024,
      fetchImpl,
      resolve: publicResolve(),
    });

    expect(outcome).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/redirect/i),
    });
    expect(calls).toHaveLength(4);
  });

  it("refuses a scheme other than http or https", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    const outcome = await guardedFetch({
      url: "ftp://api.acme.test/x",
      allowedHosts: ["api.acme.test"],
      signal: signal(),
      maxBytes: 1024,
      fetchImpl,
      resolve: publicResolve(),
    });

    expect(outcome).toMatchObject({ ok: false, reason: /http/i });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a URL carrying userinfo", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    const outcome = await guardedFetch({
      url: "https://user:pass@api.acme.test/x",
      allowedHosts: ["api.acme.test"],
      signal: signal(),
      maxBytes: 1024,
      fetchImpl,
      resolve: publicResolve(),
    });

    expect(outcome).toMatchObject({ ok: false, reason: /credentials/i });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses link-local and metadata addresses even when private is allowed", async () => {
    for (const url of [
      "http://169.254.169.254/latest/meta-data",
      "http://[fe80::1]/",
    ]) {
      const { fetchImpl, calls } = serve(() => json({}));

      const outcome = await guardedFetch({
        url,
        allowedHosts: ["169.254.169.254", "fe80::1"],
        signal: signal(),
        maxBytes: 1024,
        fetchImpl,
        allowPrivateOrigin: true,
        resolve: publicResolve(),
      });

      expect(outcome).toMatchObject({
        ok: false,
        reason: /link-local/i,
      });
      expect(calls).toHaveLength(0);
    }
  });

  it("refuses a private address unless the origin is allowed", async () => {
    const refused = await guardedFetch({
      url: "https://127.0.0.1/x",
      allowedHosts: ["127.0.0.1"],
      signal: signal(),
      maxBytes: 1024,
      fetchImpl: vi.fn<typeof fetch>(),
      resolve: publicResolve(),
    });
    expect(refused).toMatchObject({ ok: false, reason: /private|loopback/i });

    const { fetchImpl, calls } = serve(() => json({ ok: true }));
    const allowed = await guardedFetch({
      url: "https://127.0.0.1/x",
      allowedHosts: ["127.0.0.1"],
      signal: signal(),
      maxBytes: 1024,
      fetchImpl,
      allowPrivateOrigin: true,
      resolve: publicResolve(),
    });
    expect(allowed).toMatchObject({ ok: true, body: { ok: true } });
    expect(calls).toHaveLength(1);
  });

  it("caps the body at the caller's maxBytes as it arrives", async () => {
    const chunk = new TextEncoder().encode("0123456789abcdef");
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
      },
    });
    const { fetchImpl } = serve(
      () =>
        new Response(body, {
          headers: { "content-type": "application/json" },
        }),
    );

    const outcome = await guardedFetch({
      url: "https://api.acme.test/x",
      allowedHosts: ["api.acme.test"],
      signal: signal(),
      maxBytes: 10,
      fetchImpl,
      resolve: publicResolve(),
    });

    expect(outcome).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/more than 10 bytes/),
    });
  });

  it("sends the caller's method, headers and body and injects no credential", async () => {
    const { fetchImpl, calls } = serve(() => json({ ok: true }));

    await guardedFetch({
      url: "https://api.acme.test/x",
      allowedHosts: ["api.acme.test"],
      signal: signal(),
      maxBytes: 1024,
      method: "POST",
      headers: { "x-api-key": "plugin's own" },
      body: "a=1",
      fetchImpl,
      resolve: publicResolve(),
    });

    const call = calls[0];
    expect(call?.init.method).toBe("POST");
    expect(call?.init.body).toBe("a=1");
    const headers = new Headers(call?.init.headers);
    expect(headers.get("x-api-key")).toBe("plugin's own");
    expect(headers.get("authorization")).toBeNull();
  });

  it("refuses a non-JSON answer", async () => {
    const { fetchImpl } = serve(
      () =>
        new Response("<html></html>", {
          headers: { "content-type": "text/html" },
        }),
    );

    const outcome = await guardedFetch({
      url: "https://api.acme.test/x",
      allowedHosts: ["api.acme.test"],
      signal: signal(),
      maxBytes: 1024,
      fetchImpl,
      resolve: publicResolve(),
    });

    expect(outcome).toMatchObject({
      ok: false,
      reason: expect.stringContaining("text/html"),
    });
  });
});
