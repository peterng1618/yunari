import type http from "node:http";
import type { PathPreset } from "@yunari/theme-package";
import { isPackId, type WidgetPackStore } from "../packs/widget-packs.js";
import {
  MAX_PATH_PRESET_PACK_BYTES,
  type PathPresetStore,
} from "../presets/path-presets.js";
import { UnreadableJsonFileError } from "../settings/json-file.js";
import {
  isPlatformError,
  LARGE_BODY_BUSY,
  LargeBodyBusyError,
  readBody,
  readBytes,
  sendJson,
  sendText,
} from "./http.js";
import { isForeignOrigin, isLoopbackRemote } from "./identity.js";
import { MAX_WIDGET_PACK_BYTES } from "./limits.js";

const PREFIX = "/api/widget-packs";
const PATH_PRESETS = "/api/path-presets";

export interface PackRouteDeps {
  readonly request: http.IncomingMessage;
  readonly response: http.ServerResponse;
  readonly url: URL;
  readonly store: WidgetPackStore | undefined;
  /** The author's path presets, served from the same dispatch as the widget
   *  packs. Omitted when this host serves none. */
  readonly pathPresets?: PathPresetStore | undefined;
  /** The same one-slot gate theme uploads use, so a pack body and a theme body
   *  are never buffered together; a second caller is answered 429. Omitted runs
   *  the read directly. */
  readonly largeBody?: { run<T>(work: () => Promise<T>): Promise<T> };
}

/**
 * The pack surface: widget packs and path preset packs.
 *
 * Every route here is loopback admin — a pack is this PC's library — and the
 * writes additionally refuse a foreign origin, so a page that rebound a name to
 * loopback cannot import into or delete from it. Matched as one handler so the
 * two surfaces share one prefix parser rather than adding a second.
 */
export async function handlePackRoutes(deps: PackRouteDeps): Promise<boolean> {
  const { url } = deps;
  if (
    url.pathname === PATH_PRESETS ||
    url.pathname.startsWith(`${PATH_PRESETS}/`)
  ) {
    return handlePathPresetRoutes(deps);
  }
  if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) {
    return false;
  }
  return handleWidgetPackRoutes(deps);
}

async function handleWidgetPackRoutes(deps: PackRouteDeps): Promise<boolean> {
  const { request, response, url, store } = deps;

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

/** A write must come from this machine's own page, not merely its address. */
function refusesPathPresetWrite(
  request: http.IncomingMessage,
  response: http.ServerResponse,
): boolean {
  if (!isForeignOrigin(request)) return false;
  sendText(response, 403, "That request is from another origin.");
  return true;
}

/** Parses a bounded JSON body, answering the caller itself when it cannot.
 *  The path preset writes take the pack bound: one preset's data may be larger
 *  than the admin routes' 64 KiB default, and a legal store input must not be
 *  refused by its transport first. */
async function readJsonBody(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  limit = 64 * 1024,
): Promise<unknown | undefined> {
  let raw: string;
  try {
    raw = await readBody(request, limit);
  } catch {
    // `readBody`'s only refusal is its size limit.
    sendText(response, 413, "That request body is too large.");
    return undefined;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    sendText(response, 400, "That request is not JSON.");
    return undefined;
  }
}

/** The store's own sentence for input it refused; a file fault is this
 *  machine's and is logged rather than returned with its path. */
function sendStoreFailure(response: http.ServerResponse, error: unknown): void {
  if (isPlatformError(error) || error instanceof UnreadableJsonFileError) {
    console.error(error);
    sendText(response, 500, "The path presets could not be saved.");
    return;
  }
  sendText(
    response,
    400,
    error instanceof Error ? error.message : String(error),
  );
}

function routeId(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  try {
    const id = decodeURIComponent(raw);
    return id === "" ? undefined : id;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The path preset surface: the author's list plus the packs installed into it.
 *
 * Matched before the id route so `packs`, `builtins` and `migrate` are never
 * read as a preset id. A malformed body or a store refusal is the caller's
 * 4xx with the store's sentence; a fault on this machine is logged and
 * answered without naming a path.
 */
async function handlePathPresetRoutes(deps: PackRouteDeps): Promise<boolean> {
  const { request, response, url, pathPresets } = deps;

  if (!isLoopbackRemote(request.socket.remoteAddress)) {
    sendText(response, 403, "Path presets are available on this PC only.");
    return true;
  }

  if (pathPresets === undefined) {
    sendText(response, 404, "Path presets are not enabled on this host.");
    return true;
  }

  if (url.pathname === PATH_PRESETS) {
    if (request.method === "GET") {
      sendJson(response, 200, await pathPresets.read());
      return true;
    }
    if (request.method === "POST") {
      if (refusesPathPresetWrite(request, response)) return true;
      const body = await readJsonBody(
        request,
        response,
        MAX_PATH_PRESET_PACK_BYTES,
      );
      if (body === undefined) return true;
      if (!isRecord(body)) {
        sendText(response, 400, "A path preset needs a name and path data.");
        return true;
      }
      const label = body["label"];
      const data = body["data"];
      if (typeof label !== "string" || typeof data !== "string") {
        sendText(response, 400, "A path preset needs a name and path data.");
        return true;
      }
      try {
        sendJson(response, 200, await pathPresets.addUser({ label, data }));
      } catch (error) {
        sendStoreFailure(response, error);
      }
      return true;
    }
    sendText(response, 405, "Only GET and POST are supported.");
    return true;
  }

  // Pack bytes are bounded by the store's own cap, refused before JSON.parse.
  if (url.pathname === `${PATH_PRESETS}/packs`) {
    if (request.method !== "POST") {
      sendText(response, 405, "Only POST is supported.");
      return true;
    }
    if (refusesPathPresetWrite(request, response)) return true;

    let bytes: Uint8Array;
    try {
      const read = () => readBytes(request, MAX_PATH_PRESET_PACK_BYTES);
      bytes = await (deps.largeBody === undefined
        ? read()
        : deps.largeBody.run(read));
    } catch (error) {
      if (error instanceof LargeBodyBusyError) {
        sendText(response, 429, LARGE_BODY_BUSY);
        return true;
      }
      sendText(response, 413, "That path preset pack is too large to import.");
      return true;
    }

    try {
      sendJson(response, 200, await pathPresets.addPack(bytes));
    } catch (error) {
      sendStoreFailure(response, error);
    }
    return true;
  }

  if (url.pathname === `${PATH_PRESETS}/builtins/restore`) {
    if (request.method !== "POST") {
      sendText(response, 405, "Only POST is supported.");
      return true;
    }
    if (refusesPathPresetWrite(request, response)) return true;
    try {
      await pathPresets.restoreBuiltins();
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendStoreFailure(response, error);
    }
    return true;
  }

  const builtinRemoval = url.pathname.match(
    /^\/api\/path-presets\/builtins\/([^/]+)\/remove$/,
  );
  if (builtinRemoval !== null) {
    if (request.method !== "POST") {
      sendText(response, 405, "Only POST is supported.");
      return true;
    }
    if (refusesPathPresetWrite(request, response)) return true;
    const id = routeId(builtinRemoval[1]);
    if (id === undefined) {
      sendText(response, 400, "Invalid path preset id.");
      return true;
    }
    try {
      await pathPresets.removeBuiltin(id);
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendStoreFailure(response, error);
    }
    return true;
  }

  if (url.pathname === `${PATH_PRESETS}/migrate`) {
    if (request.method !== "POST") {
      sendText(response, 405, "Only POST is supported.");
      return true;
    }
    if (refusesPathPresetWrite(request, response)) return true;
    const body = await readJsonBody(
      request,
      response,
      MAX_PATH_PRESET_PACK_BYTES,
    );
    if (body === undefined) return true;
    if (
      !isRecord(body) ||
      !Array.isArray(body["presets"]) ||
      !Array.isArray(body["removedBuiltins"])
    ) {
      sendText(
        response,
        400,
        "A migration needs a list of presets and removed built-in ids.",
      );
      return true;
    }
    try {
      sendJson(
        response,
        200,
        await pathPresets.migrate({
          presets: body["presets"] as readonly PathPreset[],
          removedBuiltins: body["removedBuiltins"] as readonly string[],
        }),
      );
    } catch (error) {
      sendStoreFailure(response, error);
    }
    return true;
  }

  const packRemoval = url.pathname.match(
    /^\/api\/path-presets\/packs\/([^/]+)$/,
  );
  if (packRemoval !== null) {
    if (request.method !== "DELETE") {
      sendText(response, 405, "Only DELETE is supported.");
      return true;
    }
    if (refusesPathPresetWrite(request, response)) return true;
    const packId = routeId(packRemoval[1]);
    if (packId === undefined) {
      sendText(response, 400, "Invalid path preset pack id.");
      return true;
    }
    try {
      await pathPresets.removePack(packId);
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendStoreFailure(response, error);
    }
    return true;
  }

  const removal = url.pathname.match(/^\/api\/path-presets\/([^/]+)$/);
  if (removal !== null) {
    if (request.method !== "DELETE") {
      sendText(response, 405, "Only DELETE is supported.");
      return true;
    }
    if (refusesPathPresetWrite(request, response)) return true;
    const id = routeId(removal[1]);
    if (id === undefined) {
      sendText(response, 400, "Invalid path preset id.");
      return true;
    }
    try {
      await pathPresets.remove(id);
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendStoreFailure(response, error);
    }
    return true;
  }

  sendText(response, 404, "Not found.");
  return true;
}
