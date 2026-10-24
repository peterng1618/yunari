import { describe, expect, it } from "vitest";
import { json, redirect, serve, sourceOf } from "./fetch-source.fixture.js";
import { fetchSource } from "./fetch-source.js";

/**
 * Redirect and destination policy. Split from the request/answer suite because
 * this is where a user-typed address can turn into a different host, and the
 * case set is about hops rather than about one request.
 */

describe("fetchSource redirects", () => {
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

  it("refuses a Location that carries userinfo", async () => {
    const { fetchImpl, calls } = serve(() =>
      redirect("http://user:pass@127.0.0.2:8080/next"),
    );

    const outcome = await fetchSource(
      sourceOf({ url: "http://127.0.0.1:8080/start" }),
      undefined,
      fetchImpl,
      () => 0,
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/credentials/i);
    expect(calls).toHaveLength(1);
  });

  it("keeps the credential and headers across a same-origin redirect", async () => {
    const { fetchImpl, calls } = serve(({ url }) =>
      url.pathname === "/start" ? redirect("/next") : json({}),
    );

    await fetchSource(
      sourceOf({
        url: "http://127.0.0.1:8080/start",
        headers: { "x-api-key": "static-secret" },
        auth: { kind: "bearer", credentialId: "c" },
      }),
      "sekrit",
      fetchImpl,
      () => 0,
    );

    expect(calls[1]?.headers.get("authorization")).toBe("Bearer sekrit");
    expect(calls[1]?.headers.get("x-api-key")).toBe("static-secret");
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

  it("drops every source header when the redirect changes the origin", async () => {
    // A named header is often a secret even when it is not `Authorization`;
    // browser stripping would keep `x-api-key` and send it to the new origin.
    const { fetchImpl, calls } = serve(({ url }) =>
      url.hostname === "127.0.0.1"
        ? redirect("http://127.0.0.2:8080/next")
        : json({}),
    );

    const outcome = await fetchSource(
      sourceOf({
        url: "http://127.0.0.1:8080/start",
        headers: {
          Authorization: "token static",
          "x-api-key": "static-secret",
        },
      }),
      undefined,
      fetchImpl,
      () => 0,
    );

    expect(outcome.ok).toBe(true);
    expect(calls[0]?.headers.get("x-api-key")).toBe("static-secret");
    expect(calls[0]?.headers.get("authorization")).toBe("token static");
    expect(calls[1]?.headers.get("x-api-key")).toBeNull();
    expect(calls[1]?.headers.get("authorization")).toBeNull();
  });
});

describe("fetchSource refused destinations", () => {
  it("refuses cloud metadata and link-local addresses without connecting", async () => {
    for (const url of [
      "http://169.254.169.254/latest/meta-data",
      "http://169.254.1.1/",
      "http://[fe80::1]/",
      // `::ffff:169.254.169.254` canonicalises to `::ffff:a9fe:a9fe`.
      "http://[::ffff:169.254.169.254]/",
      // The same address inside NAT64 and 6to4 translation prefixes.
      "http://[64:ff9b::a9fe:a9fe]/",
      "http://[2002:a9fe:a9fe::]/",
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
      // Translation prefixes are decoded, not refused wholesale: these are
      // 8.8.8.8, an address the check has no business blocking.
      "http://[64:ff9b::808:808]/",
      "http://[2002:808:808::]/",
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

  it("resolves a hostname and allows it when every address is private", async () => {
    // `localhost` goes through the real resolver (::1 and 127.0.0.1), so this
    // is the one case that exercises `lookup` rather than a literal address.
    const { fetchImpl, calls } = serve(() => json({}));

    const outcome = await fetchSource(
      sourceOf({ url: "http://localhost:8080/" }),
      undefined,
      fetchImpl,
      () => 0,
    );

    expect(outcome.ok).toBe(true);
    expect(calls).toHaveLength(1);
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
