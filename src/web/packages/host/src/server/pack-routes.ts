import type http from "node:http";
import { isPackId, type WidgetPackStore } from "../packs/widget-packs.js";
import {
  LARGE_BODY_BUSY,
  LargeBodyBusyError,
  readBytes,
  sendJson,
  sendText,
} from "./http.js";
import { isForeignOrigin, isLoopbackRemote } from "./identity.js";
import { MAX_WIDGET_PACK_BYTES } from "./limits.js";

const PREFIX = "/api/widget-packs";

export interface PackRouteDeps {
  readonly request: http.IncomingMessage;
  readonly response: http.ServerResponse;
  readonly url: URL;
  readonly store: WidgetPackStore | undefined;
  /** The same one-slot gate theme uploads use, so a pack body and a theme body
   *  are never buffered together; a second caller is answered 429. Omitted runs
   *  the read directly. */
  readonly largeBody?: { run<T>(work: () => Promise<T>): Promise<T> };
}

/**
 * The widget pack surface: listing, importing, downloading and removing.
 *
 * Every route here is loopback admin — a pack is this PC's library — and the
 * writes additionally refuse a foreign origin, so a page that rebound a name to
 * loopback cannot import into or delete from it. Matched as one handler so a
 * later surface (path presets) can extend the same dispatch rather than adding
 * a second prefix parser.
 */
export async function handlePackRoutes(deps: PackRouteDeps): Promise<boolean> {
  const { request, response, url, store } = deps;
  if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) {
    return false;
  }

  if (!isLoopbackRemote(request.socket.remoteAddress)) {
    sendText(response, 403, "Widget packs are available on this PC only.");
    return true;
  }

  if (store === undefined) {
    sendText(response, 404, "Widget packs are not enabled on this host.");
    return true;
  }

  if (url.pathname === PREFIX) {
    if (request.method !== "GET") {
      sendText(response, 405, "Only GET is supported.");
      return true;
    }
    sendJson(response, 200, { packs: await store.list() });
    return true;
  }

  // Matched before the id route, which would otherwise read `import` as a pack
  // id — the same order the theme import route keeps.
  if (url.pathname === `${PREFIX}/import`) {
    if (request.method !== "POST") {
      sendText(response, 405, "Only POST is supported.");
      return true;
    }
    if (isForeignOrigin(request)) {
      sendText(response, 403, "That request is from another origin.");
      return true;
    }

    let bytes: Uint8Array;
    try {
      const read = () => readBytes(request, MAX_WIDGET_PACK_BYTES);
      bytes = await (deps.largeBody === undefined
        ? read()
        : deps.largeBody.run(read));
    } catch (error) {
      if (error instanceof LargeBodyBusyError) {
        sendText(response, 429, LARGE_BODY_BUSY);
        return true;
      }
      // The size gate answers before the reader sees a byte of the zip.
      sendText(response, 413, "That widget pack is too large to import.");
      return true;
    }

    const installed = await store.install(bytes);
    if (!installed.ok) {
      // The reader's own sentence: it names which rule the package broke, and
      // nothing was written.
      sendText(response, 400, installed.message);
      return true;
    }
    sendJson(response, 200, { ok: true, pack: installed.pack });
    return true;
  }

  if (url.pathname === `${PREFIX}/`) {
    sendText(response, 400, "Invalid widget pack id.");
    return true;
  }

  const match = url.pathname.match(/^\/api\/widget-packs\/([^/]+)$/);
  if (match === null) {
    sendText(response, 404, "Not found.");
    return true;
  }

  let id: string;
  try {
    id = decodeURIComponent(match[1] ?? "");
  } catch {
    sendText(response, 400, "Invalid widget pack id.");
    return true;
  }
  if (!isPackId(id)) {
    sendText(response, 400, "Invalid widget pack id.");
    return true;
  }

  if (request.method === "GET") {
    const bytes = await store.read(id);
    if (bytes === undefined) {
      sendText(response, 404, "Widget pack not found.");
      return true;
    }
    response.writeHead(200, {
      "content-type": "application/zip",
      "cache-control": "no-store",
      "content-length": String(bytes.byteLength),
    });
    response.end(Buffer.from(bytes));
    return true;
  }

  if (request.method === "DELETE") {
    // Removing is a modification, so the origin is checked beside loopback.
    if (isForeignOrigin(request)) {
      sendText(response, 403, "That request is from another origin.");
      return true;
    }
    // A bundled pack has nothing on disk; its removal is the same no-op the
    // store's contract promises.
    await store.remove(id);
    sendJson(response, 200, { ok: true });
    return true;
  }

  sendText(response, 405, "Only GET and DELETE are supported.");
  return true;
}
