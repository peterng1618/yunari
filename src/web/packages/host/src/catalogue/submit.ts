import type { IncomingMessage } from "node:http";
import { isForeignOrigin, isLoopbackRemote, readBody } from "../server.js";
import type { StoreSessionStore } from "../settings/store-session.js";
import type { ThemeStore } from "../themes/store.js";
import { createStoreClient, StoreClientError } from "../themes/store-client.js";
import { submissionFiles } from "../themes/submission.js";
import type { ThumbnailStore } from "../themes/thumbnails.js";

/**
 * The submission route, kept out of `server.ts` for the reason the store
 * sign-in routes are: that file is already past the size a reader can hold.
 *
 * The browser sends one id; the host does the rest — read the library theme,
 * bump it against the Worker's baseline, request a version, PUT the package
 * through the Worker's upload route and finalize with the thumbnail. The
 * session token reaches this module and the `Authorization` header, and
 * nothing else.
 */

export const SUBMIT_PATH = "/api/themes/submit";

/** The one refusal a body over the limit gets. */
const TOO_LARGE = "That submission request is too large.";
const NOT_JSON = "That submission request is not JSON.";
const NO_ID = "A submission needs the id of a library theme.";
const NO_SESSION = "Sign in to the store before submitting.";
const NO_STORE = "This host has no store to submit to.";

export interface SubmitRouteDeps {
  /** The Worker's origin. Absent when this host has no store to submit to. */
  readonly origin: string | undefined;
  readonly sessionStore: StoreSessionStore | undefined;
  readonly themeStore: ThemeStore;
  readonly thumbnails: ThumbnailStore | undefined;
  readonly fetch: typeof fetch;
  readonly now: () => Date;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** The status a thrown store refusal deserves: the session's own refusal is a
 *  sign-in problem, a 4xx is the author's submission being refused, and
 *  everything else is the store being unreachable. A 401 from an authenticated
 *  call spends the stored session, so the next press asks for a sign-in rather
 *  than repeating it. Every call here is authenticated, the upload included. */
async function refusal(
  error: unknown,
  store: StoreSessionStore | undefined,
  authenticatedCall: boolean,
): Promise<Response> {
  if (error instanceof StoreClientError) {
    if (authenticatedCall && error.status === 401) await store?.clear();
    const status =
      error.status === 401 || error.status === 403
        ? 401
        : error.status >= 400 && error.status < 500
          ? 400
          : 502;
    return json(status, { ok: false, message: error.message });
  }
  return json(502, {
    ok: false,
    message: "The store could not be reached; submit again when it is.",
  });
}

export async function handleSubmitRoute(
  request: IncomingMessage,
  url: URL,
  deps: SubmitRouteDeps,
): Promise<Response | undefined> {
  if (url.pathname !== SUBMIT_PATH) return undefined;

  if (request.method !== "POST") return text(405, "Only POST is supported.");
  // It acts as the author's store account, so it carries the sign-in routes'
  // guards in their order: loopback, origin, Host.
  if (!isLoopbackRemote(request.socket.remoteAddress)) {
    return text(403, "Theme submission is local to this PC only.");
  }
  if (isForeignOrigin(request)) {
    return text(403, "That request is from another origin.");
  }

  const origin = deps.origin;
  if (origin === undefined) return text(503, NO_STORE);

  const session =
    deps.sessionStore === undefined
      ? undefined
      : await deps.sessionStore.read();
  if (session === undefined) {
    return json(401, { ok: false, message: NO_SESSION });
  }

  let raw: string;
  try {
    raw = await readBody(request);
  } catch {
    return text(413, TOO_LARGE);
  }

  let id: string | undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    const value =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)["id"]
        : undefined;
    if (typeof value === "string" && value !== "") id = value;
  } catch {
    return text(400, NOT_JSON);
  }
  if (id === undefined) return text(400, NO_ID);

  const client = createStoreClient({
    origin,
    token: session.token,
    fetch: deps.fetch,
  });

  let plan: Awaited<ReturnType<typeof submissionFiles>>;
  try {
    plan = await submissionFiles(id, deps.themeStore, {
      ...(deps.thumbnails === undefined ? {} : { thumbnails: deps.thumbnails }),
      now: () => deps.now(),
      client,
    });
  } catch (error) {
    return refusal(error, deps.sessionStore, true);
  }
  if (!plan.ok) {
    return json(400, { ok: false, message: plan.message });
  }

  // The upload is the Worker's own authenticated route, so its 401 is the
  // same session refusal every other call's is.
  try {
    await client.upload(plan.files.uploadUrl, plan.files.packageBytes);
  } catch (error) {
    return refusal(error, deps.sessionStore, true);
  }

  try {
    const finalized = await client.finalize(
      id,
      plan.files.version,
      plan.files.thumbnailBytes,
    );
    return json(200, {
      ok: true,
      status: finalized.status,
      version: {
        from: plan.files.from ?? null,
        to: plan.files.version,
        level: plan.files.level,
      },
    });
  } catch (error) {
    return refusal(error, deps.sessionStore, true);
  }
}
