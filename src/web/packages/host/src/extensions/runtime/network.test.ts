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

    expect(outcome).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/http/i),
    });
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

    expect(outcome).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/credentials/i),
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a declared host that resolves to link-local or metadata", async () => {
    const cases = [
      { host: "metadata.test", address: "169.254.169.254", family: 4 },
      { host: "link-local.test", address: "fe80::1", family: 6 },
    ] as const;

    for (const entry of cases) {
      const fetchImpl = vi.fn<typeof fetch>();
      const resolve = async () => [
        { address: entry.address, family: entry.family },
      ];

      const outcome = await guardedFetch({
        url: `http://${entry.host}/x`,
        allowedHosts: [entry.host],
        signal: signal(),
        maxBytes: 1024,
        fetchImpl,
        allowPrivateOrigin: true,
        resolve,
      });

      expect(outcome).toMatchObject({
        ok: false,
        reason: expect.stringMatching(/link-local/i),
      });
      expect(fetchImpl, entry.host).not.toHaveBeenCalled();
    }
  });

  it("refuses a declared host that resolves to a private address unless allowed", async () => {
    const resolve = async () => [{ address: "10.0.0.1", family: 4 }];
    const refusedFetch = vi.fn<typeof fetch>();

    const refused = await guardedFetch({
      url: "https://private.test/x",
      allowedHosts: ["private.test"],
      signal: signal(),
      maxBytes: 1024,
      fetchImpl: refusedFetch,
      resolve,
    });
    expect(refused).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/private|loopback/i),
    });
    expect(refusedFetch).not.toHaveBeenCalled();

    const { fetchImpl, calls } = serve(() => json({ ok: true }));
    const allowed = await guardedFetch({
      url: "https://private.test/x",
      allowedHosts: ["private.test"],
      signal: signal(),
      maxBytes: 1024,
      fetchImpl,
      allowPrivateOrigin: true,
      resolve,
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

  it("drops the plugin's body and headers on a cross-origin redirect", async () => {
    const { fetchImpl, calls } = serve(({ url }) =>
      url.hostname === "api.acme.test"
        ? redirect("https://cdn.acme.test/next")
        : json({ ok: true }),
    );

    const outcome = await guardedFetch({
      url: "https://api.acme.test/start",
      allowedHosts: ["api.acme.test", "cdn.acme.test"],
      signal: signal(),
      maxBytes: 1024,
      method: "POST",
      headers: { "x-api-key": "plugin's own" },
      body: "token=abc",
      fetchImpl,
      resolve: publicResolve(),
    });

    expect(outcome).toMatchObject({ ok: true, body: { ok: true } });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.init.body).toBe("token=abc");
    expect(calls[1]?.init.body).toBeUndefined();
    expect(new Headers(calls[1]?.init.headers).get("x-api-key")).toBeNull();
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
