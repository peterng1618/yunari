import { env, SELF } from "cloudflare:test";
import type { TestHelpers } from "better-auth/plugins";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createAuth, isTestOrigin } from "../src/auth";

const BASE = "https://store.test";
const LOOPBACK = encodeURIComponent("http://127.0.0.1:5173");

describe("auth", () => {
  beforeAll(async () => {
    // Twice, because the owner may re-run `/migrate` on an already migrated D1.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const migrated = await SELF.fetch(`${BASE}/migrate`, {
        method: "POST",
        headers: { "x-migrate-token": "test-migrate" },
      });
      expect(migrated.status).toBe(200);
    }
  });

  it("refuses a missing or forged bearer session", async () => {
    expect((await SELF.fetch(`${BASE}/api/me`)).status).toBe(401);
    expect(
      (
        await SELF.fetch(`${BASE}/api/me`, {
          headers: { authorization: "Bearer forged.token" },
        })
      ).status,
    ).toBe(401);
  });

  it("accepts a real test session", async () => {
    const auth = createAuth(env);
    const test = ((await auth.$context) as unknown as { test: TestHelpers })
      .test;
    const user = await test.saveUser(
      test.createUser({ email: "a@example.com" }),
    );
    const { headers, cookies } = await test.login({ userId: user.id });
    const answered = await SELF.fetch(`${BASE}/api/me`, { headers });
    expect(answered.status).toBe(200);
    const body = (await answered.json()) as Record<string, unknown>;
    expect(body).toEqual({ userId: user.id, email: "a@example.com" });
    expect(Object.keys(body)).toHaveLength(2);

    // The host sends the signed session token, not a cookie; the same token the
    // test helper signed must authenticate.
    const signed = cookies[0]?.value;
    expect(signed).toBeDefined();
    expect(
      (
        await SELF.fetch(`${BASE}/api/me`, {
          headers: { authorization: `Bearer ${signed}` },
        })
      ).status,
    ).toBe(200);
  });

  it("answers a missing or wrong migrate token with 404 and 403", async () => {
    expect(
      (await SELF.fetch(`${BASE}/migrate`, { method: "POST" })).status,
    ).toBe(404);
    expect(
      (
        await SELF.fetch(`${BASE}/migrate`, {
          method: "POST",
          headers: { "x-migrate-token": "wrong" },
        })
      ).status,
    ).toBe(403);
  });

  it("compares a same-length migrate token in constant time", async () => {
    // The DOM lib shadows the workers-types `SubtleCrypto` that declares it.
    const subtle = crypto.subtle as unknown as {
      timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
    };
    const spy = vi.spyOn(subtle, "timingSafeEqual");
    try {
      // Same length as `test-migrate`, one byte different: two different
      // lengths are answered without a comparison, so only this proves one ran.
      const response = await SELF.fetch(`${BASE}/migrate`, {
        method: "POST",
        headers: { "x-migrate-token": "test-migratX" },
      });
      expect(response.status).toBe(403);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps test helpers off outside a test origin", async () => {
    expect(isTestOrigin(BASE)).toBe(true);
    expect(isTestOrigin("http://127.0.0.1:5173")).toBe(true);
    expect(isTestOrigin("http://localhost:8787")).toBe(true);
    expect(isTestOrigin("https://store.example.com")).toBe(false);
    expect(isTestOrigin("http://example.test")).toBe(false);
    expect(isTestOrigin("not a url")).toBe(false);

    const harness = (await createAuth(env).$context) as unknown as {
      test?: TestHelpers;
    };
    expect(harness.test).toBeDefined();

    const production = (await createAuth({
      ...env,
      BETTER_AUTH_URL: "https://store.example.com",
    }).$context) as unknown as { test?: TestHelpers };
    expect(production.test).toBeUndefined();
  });

  it("starts a social sign-in at the provider", async () => {
    const started = await SELF.fetch(
      `${BASE}/auth/start?provider=github&host=${LOOPBACK}&state=opaque`,
      { redirect: "manual" },
    );
    expect(started.status).toBe(302);
    const location = started.headers.get("location") ?? "";
    expect(
      location.startsWith("https://github.com/login/oauth/authorize"),
    ).toBe(true);
    const expected = new URL("/auth/return", BASE);
    expected.searchParams.set("host", "http://127.0.0.1:5173");
    expected.searchParams.set("state", "opaque");
    // The provider's `redirect_uri` is the Worker's own /api/auth/callback;
    // Better Auth carries our callback destination inside the stored OAuth
    // state. Without host and state there, every real login dies on the return
    // page's 400.
    const providerState = new URL(location).searchParams.get("state");
    expect(providerState).not.toBeNull();
    const stored = await env.DB.prepare(
      "SELECT value FROM verification WHERE identifier = ?",
    )
      .bind(`auth-state:${providerState}`)
      .first<{ value: string }>();
    expect(stored).not.toBeNull();
    const state = JSON.parse(stored?.value ?? "{}") as { callbackURL?: string };
    expect(state.callbackURL).toBe(expected.toString());
    expect(
      (
        await SELF.fetch(
          `${BASE}/auth/start?provider=gitlab&host=${LOOPBACK}&state=opaque`,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await SELF.fetch(
          `${BASE}/auth/start?provider=github&host=${encodeURIComponent("https://evil.example")}&state=opaque`,
        )
      ).status,
    ).toBe(400);
  });

  it("serves the return page only for a loopback host", async () => {
    expect(
      (
        await SELF.fetch(
          `${BASE}/auth/return?host=${encodeURIComponent("http://evil.example:80")}&state=a`,
        )
      ).status,
    ).toBe(400);
    const host = "http://127.0.0.1:5173";
    const state = "state-9f1c";
    const page = await SELF.fetch(
      `${BASE}/auth/return?host=${encodeURIComponent(host)}&state=${state}`,
    );
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    const html = await page.text();
    expect(html).toContain("/api/auth/one-time-token/generate");
    expect(html).toContain('credentials: "include"');
    expect(html).toContain('searchParams.set("token"');
    // The popup comes back to the route that redeems the token, not the root.
    expect(html).toContain("/api/store/auth/return");
    // The page reads host and state at runtime; echoing them would bake a
    // caller-supplied destination into the markup.
    expect(html).not.toContain(host);
    expect(html).not.toContain(state);
  });
});
