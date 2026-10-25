import { getMigrations } from "better-auth/db/migration";
import { isLoopbackOrigin, returnPage } from "./auth/return-page.js";
import { sessionOf } from "./auth/session.js";
import { createAuth } from "./auth.js";
import type { Env } from "./env.js";
import { handleAdmin } from "./routes/admin.js";
import { handleMe } from "./routes/me.js";
import { handlePublic } from "./routes/public.js";
import { cleanupPending } from "./storage/cleanup.js";

const AUTH_PREFIX = "/api/auth/";
const PROVIDERS = new Set(["github", "google"]);
const STATE_LIMIT = 256;

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/health") {
      return Response.json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/migrate") {
      return migrate(request, env);
    }
    if (url.pathname.startsWith(AUTH_PREFIX)) {
      return createAuth(env).handler(request);
    }
    if (request.method === "GET" && url.pathname === "/api/me") {
      return me(request, env);
    }
    if (request.method === "GET" && url.pathname === "/auth/start") {
      return start(env, url);
    }
    if (request.method === "GET" && url.pathname === "/auth/return") {
      const host = url.searchParams.get("host");
      return host !== null && isLoopbackOrigin(host)
        ? returnPage()
        : new Response("Bad request", { status: 400 });
    }
    const meResponse = await handleMe(request, env, url);
    if (meResponse !== undefined) return meResponse;
    const adminResponse = await handleAdmin(request, env, url);
    if (adminResponse !== undefined) return adminResponse;
    const publicResponse = await handlePublic(request, env, url);
    if (publicResponse !== undefined) return publicResponse;
    return new Response("Not found", { status: 404 });
  },
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(cleanupPending(env, new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;

/**
 * Better Auth creates only the tables it is missing, so a re-run on an already
 * migrated database still answers 200. D1 has no interactive transactions; the
 * runner does not need one.
 */
async function migrate(request: Request, env: Env): Promise<Response> {
  const token = request.headers.get("x-migrate-token");
  if (token === null) return new Response("Not found", { status: 404 });
  if (token !== env.MIGRATE_TOKEN)
    return new Response("Forbidden", { status: 403 });
  const { runMigrations } = await getMigrations(createAuth(env).options);
  await runMigrations();
  return Response.json({ ok: true });
}

async function me(request: Request, env: Env): Promise<Response> {
  const session = await sessionOf(request, env);
  if (session === undefined)
    return new Response("Unauthorized", { status: 401 });
  return Response.json({ userId: session.userId, email: session.email });
}

async function start(env: Env, url: URL): Promise<Response> {
  const provider = url.searchParams.get("provider");
  const host = url.searchParams.get("host");
  const state = url.searchParams.get("state") ?? "";
  if (provider === null || !PROVIDERS.has(provider)) return badRequest();
  if (host === null || !isLoopbackOrigin(host)) return badRequest();
  if (state.length > STATE_LIMIT) return badRequest();

  const callbackURL = new URL("/auth/return", env.BETTER_AUTH_URL);
  callbackURL.searchParams.set("host", host);
  callbackURL.searchParams.set("state", state);
  const { url: providerUrl } = await createAuth(env).api.signInSocial({
    body: {
      provider: provider as "github" | "google",
      callbackURL: callbackURL.toString(),
    },
  });
  if (providerUrl === undefined) {
    return new Response("Sign-in unavailable", { status: 502 });
  }
  return Response.redirect(providerUrl, 302);
}

function badRequest(): Response {
  return new Response("Bad request", { status: 400 });
}
