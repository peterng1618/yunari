import fs from "node:fs/promises";
import type http from "node:http";
import path from "node:path";
import {
  contentTypeFor,
  realStaticPath,
  resolveStaticPath,
} from "../serve/static-path.js";

/** The one sentence a caller gets while another theme-sized body is arriving. */
export const LARGE_BODY_BUSY = "Another large upload is still in progress.";

/** Refusal a full gate raises, so a route can tell it from a body over the cap. */
export class LargeBodyBusyError extends Error {}

/**
 * One slot for theme-sized bodies, by default.
 *
 * A body is buffered whole before it is parsed, and two theme-sized imports in
 * flight at once is a memory cost an idle host should not be asked to pay.
 * The second caller is refused rather than queued: the browser retries a 429,
 * whereas a queued request would hold its socket for as long as the first one
 * took.
 */
export function createLargeBodyGate(maxConcurrent = 1): {
  run<T>(work: () => Promise<T>): Promise<T>;
} {
  let inFlight = 0;

  return {
    async run<T>(work: () => Promise<T>): Promise<T> {
      if (inFlight >= maxConcurrent) throw new LargeBodyBusyError();

      inFlight += 1;

      try {
        return await work();
      } finally {
        inFlight -= 1;
      }
    },
  };
}

/** Bounded JSON body for admin writes; a runaway body must not be buffered. */
export async function readBody(
  request: http.IncomingMessage,
  limit = 64 * 1024,
): Promise<string> {
  const chunks: Buffer[] = [];
  let received = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as string);
    received += buffer.byteLength;

    if (received > limit) {
      throw new Error("That request body is too large.");
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

/** The bounded binary counterpart of {@link readBody}: a package is bytes, and
 *  decoding them as text would destroy them. */
export async function readBytes(
  request: http.IncomingMessage,
  limit: number,
): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let received = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as string);
    received += buffer.byteLength;

    if (received > limit) {
      throw new Error("That request body is too large.");
    }

    chunks.push(buffer);
  }

  return new Uint8Array(Buffer.concat(chunks));
}

export function sendJson(
  response: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);

  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(payload);
}

export function sendHtml(
  response: http.ServerResponse,
  status: number,
  body: string,
): void {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(body);
}

/** A root certificate is a file a device installs, not a document it reads, so
 *  it is served as one. The media type is what makes a phone offer to install
 *  it rather than render it as text, and it is the type the operating systems
 *  themselves use for a `.crt`. */
export function sendCertificate(
  response: http.ServerResponse,
  body: string,
  fingerprint: string,
): void {
  response.writeHead(200, {
    "content-type": "application/x-x509-ca-cert",
    "content-disposition": 'attachment; filename="yunari-ca.crt"',
    // Beside the bytes rather than inside them, so a device can compare the
    // fingerprint it was told before it installs what it was sent.
    "x-yunari-ca-sha256": fingerprint,
  });
  response.end(body);
}

export function sendText(
  response: http.ServerResponse,
  status: number,
  body: string,
): void {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(body);
}

/**
 * Whether an error is this machine's rather than the caller's, as far as an
 * errno can say.
 *
 * A filesystem refusal carries an errno `code`, and its message names an
 * absolute path; a store's validation message does not. **Errno is not the only
 * platform shape**: the trash wraps a failed child process in a `TrashRefusal`,
 * which has no code to check for, so its route tests that class too.
 */
export function isPlatformError(
  error: unknown,
): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    typeof (error as NodeJS.ErrnoException).code === "string"
  );
}

/** A route module's answer, written as the node response this server speaks. */
export async function writeWebResponse(
  response: http.ServerResponse,
  answered: Response,
): Promise<void> {
  response.writeHead(answered.status, {
    // Every route that answers this way keeps its own cache rule, and the two
    // it can say are the two the host ever sets.
    "content-type":
      answered.headers.get("content-type") ?? "text/plain; charset=utf-8",
    "cache-control": answered.headers.get("cache-control") ?? "no-store",
  });
  response.end(Buffer.from(await answered.arrayBuffer()));
}

/**
 * Whether the request already holds this representation. `*` covers "any", and
 * `W/` is the weak form a cache may send for a strong validator.
 */
function matchesEtag(request: http.IncomingMessage, etag: string): boolean {
  const header = request.headers["if-none-match"];

  if (header === undefined) return false;

  return header
    .split(",")
    .map((value) => value.trim())
    .some((value) => value === "*" || value === etag || value === `W/${etag}`);
}

/**
 * Serves a bundle file. An extension-less path is a client route and may fall
 * back to `index.html` — but only where the bundle actually has client routes.
 * The editor does; the player is one document, and answering every unmatched
 * path with it hands an operator a live display for a typo, which is harder to
 * notice than a 404 and impossible to debug from the page.
 *
 * The request is taken because a bundle file is cacheable: the ETag is the
 * `stat`, and `If-None-Match` answers 304 with the type and no body.
 */
export async function serveStatic(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  root: string,
  urlPath: string,
  missingBundleHint: string,
  clientRoutes = true,
): Promise<void> {
  const resolved = resolveStaticPath(root, urlPath);

  if (resolved === undefined) {
    sendText(response, 403, "Forbidden");
    return;
  }

  // The URL a resolved candidate would have been requested by, so the same
  // containment rules decide every candidate rather than only the first.
  const urlOf = (candidate: string): string =>
    `/${path.relative(path.resolve(root), candidate).split(path.sep).join("/")}`;

  const relative = path.relative(path.resolve(root), resolved);
  const namesDotfile = relative
    .split(path.sep)
    .some((part) => part.startsWith("."));

  const candidates = [resolved];

  // A dotfile never falls back to the document: `/.env` has no extension, and
  // index.html is not the answer to a path no build writes.
  if (clientRoutes && !namesDotfile && path.extname(resolved) === "") {
    candidates.push(
      path.join(resolved, "index.html"),
      path.join(root, "index.html"),
    );
  }

  for (const candidate of candidates) {
    const real = await realStaticPath(root, urlOf(candidate));

    if (real === undefined) continue;

    let info: Awaited<ReturnType<typeof fs.stat>>;

    try {
      info = await fs.stat(real);
    } catch {
      continue;
    }

    // A link the realpath would have followed is already refused; a directory
    // is not a body, and `fs.readFile` on one is a platform-dependent error.
    if (!info.isFile()) continue;

    const headers = {
      "content-type": contentTypeFor(candidate),
      // Entry HTML must not retain references to an old build.
      "cache-control":
        path.extname(candidate) === ".html" ? "no-store" : "no-cache",
      etag: `"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`,
    };

    if (matchesEtag(request, headers.etag)) {
      response.writeHead(304, headers);
      response.end();
      return;
    }

    let body: Buffer;

    try {
      body = await fs.readFile(real);
    } catch {
      continue;
    }

    response.writeHead(200, headers);
    response.end(body);
    return;
  }

  // The hint is only true when the bundle itself is missing its entry; a file
  // that simply is not in a built bundle must not send the reader rebuilding
  // one they already built.
  const built = await fs
    .stat(path.join(root, "index.html"))
    .then(() => true)
    .catch(() => false);

  sendText(response, 404, built ? "Not found." : missingBundleHint);
}
