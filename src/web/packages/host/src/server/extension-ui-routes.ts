import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import type http from "node:http";
import path from "node:path";
import type { ExtensionService } from "../extensions/service.js";
import { sendText } from "./http.js";
import { isLoopbackRemote } from "./identity.js";

/** The one policy every plugin UI answer carries. `frame-ancestors 'self'`
 *  keeps another page from framing the host's own UI files; the editor's
 *  sandboxed frame still loads them because the host is their origin. */
export const EXTENSION_UI_CSP =
  "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; frame-ancestors 'self'";

const PREFIX = "/api/extensions/";
const UI = "ui";

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

export interface ExtensionUiRouteDeps {
  readonly service: ExtensionService;
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative !== "" &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

/** Each segment is decoded before it is joined, and a decoded separator or dot
 *  segment is refused: a route that decoded after `path.resolve` would let
 *  `%2f` and `%2e%2e` become a path the plugin never shipped. */
function readSegments(segments: readonly string[]): string[] | undefined {
  const decoded: string[] = [];
  for (const segment of segments) {
    let value: string;
    try {
      value = decodeURIComponent(segment);
    } catch {
      return undefined;
    }
    if (
      value === "" ||
      value === "." ||
      value === ".." ||
      value.includes("/") ||
      value.includes("\\") ||
      value.includes("\0")
    )
      return undefined;
    decoded.push(value);
  }
  return decoded;
}

function headersFor(file: string, size: number): http.OutgoingHttpHeaders {
  const type = MIME[path.extname(file).toLowerCase()];
  return {
    "content-type": type ?? "application/octet-stream",
    "content-length": size,
    "content-security-policy": EXTENSION_UI_CSP,
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
    ...(type === undefined
      ? { "content-disposition": 'attachment; filename="download"' }
      : {}),
  };
}

/**
 * Plugin UI files: `GET /api/extensions/:publisher/:id/ui/*`.
 *
 * The caller names a key, never a directory. The installed record supplies the
 * install root, every segment is decoded and bounded before it is joined, and
 * the final path is refused unless `lstat` says it is a regular file and
 * `realpath` says it still lives under the install tree. Only then are bytes
 * read. The route is loopback-only, like every other management surface.
 */
export async function handleExtensionUiRoutes(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  url: URL,
  deps: ExtensionUiRouteDeps,
): Promise<boolean> {
  if (!url.pathname.startsWith(PREFIX)) return false;

  const segments = url.pathname.slice(PREFIX.length).split("/");
  if (segments.length < 4 || segments[2] !== UI) return false;

  if (!isLoopbackRemote(request.socket.remoteAddress)) {
    sendText(response, 403, "Plugin UI is available on this PC only.");
    return true;
  }

  if (request.method !== "GET") {
    sendText(response, 405, "Only GET is supported.");
    return true;
  }

  const keySegments = readSegments(segments.slice(0, 2));
  const fileSegments =
    keySegments === undefined ? undefined : readSegments(segments.slice(3));
  if (keySegments === undefined || fileSegments === undefined) {
    sendText(response, 404, "Not found.");
    return true;
  }

  const plugin = await deps.service.installedPlugin(
    `${keySegments[0]}/${keySegments[1]}`,
  );
  if (plugin === undefined) {
    sendText(response, 404, "Not found.");
    return true;
  }

  const root = path.resolve(plugin.directory);
  const target = path.resolve(root, ...fileSegments);
  if (!inside(root, target)) {
    sendText(response, 404, "Not found.");
    return true;
  }

  try {
    const stat = await lstat(target);
    // A symlink is not a regular file, and a directory is not a document.
    if (!stat.isFile()) {
      sendText(response, 404, "Not found.");
      return true;
    }

    const [realRoot, realTarget] = await Promise.all([
      realpath(root),
      realpath(target),
    ]);
    if (!inside(realRoot, realTarget)) {
      sendText(response, 404, "Not found.");
      return true;
    }

    response.writeHead(200, headersFor(target, stat.size));
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(realTarget);
      stream.on("error", reject);
      stream.on("end", resolve);
      stream.pipe(response);
    });
  } catch {
    // A missing file, a file that vanished between `lstat` and `realpath`, or
    // a filesystem refusal are all the same answer to the browser.
    if (!response.headersSent) sendText(response, 404, "Not found.");
  }
  return true;
}
