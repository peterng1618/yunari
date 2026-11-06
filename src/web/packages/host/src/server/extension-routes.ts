import type http from "node:http";
import type { ProviderOrder } from "../extensions/provider-order.js";
import type { ExtensionService } from "../extensions/service.js";
import { readBody, readBytes, sendJson, sendText } from "./http.js";
import { isForeignOrigin, isLoopbackRemote } from "./identity.js";

const PREFIX = "/api/extensions";

/** The whole plugin archive is buffered before it is unzipped, so the wire cap
 *  is the package cap. */
export const MAX_EXTENSION_INSTALL_BYTES = 64 * 1024 * 1024;
const MAX_CONSENT_BYTES = 64 * 1024;
const MAX_PROVIDER_ORDER_BYTES = 64 * 1024;

export interface ExtensionRouteDeps {
  readonly extensions: ExtensionService | undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function declaredLength(request: http.IncomingMessage): number | undefined {
  const raw = request.headers["content-length"];
  if (raw === undefined) return undefined;
  const value = Number.parseInt(Array.isArray(raw) ? (raw[0] ?? "") : raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** The plugin key a keyed path names, or nothing when a segment is empty or
 *  not valid percent-encoding. The key keeps its `publisher/id` form. */
function keyOf(segments: readonly string[]): string | undefined {
  try {
    const publisher = decodeURIComponent(segments[0] ?? "");
    const id = decodeURIComponent(segments[1] ?? "");
    if (publisher === "" || id === "") return undefined;
    return `${publisher}/${id}`;
  } catch {
    return undefined;
  }
}

/**
 * The extension manager's routes: every one is loopback-only and
 * origin-checked, because installing a plugin hands this PC's owner a piece of
 * code. The router's own same-origin guard only covers loopback callers, so
 * both checks live here as well.
 */
export function createExtensionRoutes(
  deps: ExtensionRouteDeps,
): (
  request: http.IncomingMessage,
  response: http.ServerResponse,
  url: URL,
) => Promise<boolean> {
  const { extensions } = deps;

  return async function handleExtensionRoutes(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`))
      return false;

    if (!isLoopbackRemote(request.socket.remoteAddress)) {
      sendText(response, 403, "Extensions are available on this PC only.");
      return true;
    }

    if (isForeignOrigin(request)) {
      sendText(response, 403, "Extensions are not available to another page.");
      return true;
    }

    if (extensions === undefined) {
      sendText(response, 503, "This host manages no extensions.");
      return true;
    }

    if (url.pathname === PREFIX) {
      if (request.method !== "GET") {
        sendText(response, 405, "Only GET is supported.");
        return true;
      }
      sendJson(response, 200, { extensions: await extensions.list() });
      return true;
    }

    if (url.pathname === `${PREFIX}/provider-order`) {
      if (request.method === "GET") {
        sendJson(response, 200, await extensions.readProviderOrder());
        return true;
      }

      if (request.method !== "PUT") {
        sendText(response, 405, "Only GET and PUT are supported.");
        return true;
      }

      const declared = declaredLength(request);
      if (declared !== undefined && declared > MAX_PROVIDER_ORDER_BYTES) {
        sendText(response, 413, "That provider order is too large.");
        return true;
      }

      let body: string;
      try {
        body = await readBody(request, MAX_PROVIDER_ORDER_BYTES);
      } catch (error) {
        // A chunked body carries no content-length, so the cap is enforced
        // while it arrives; that refusal is a size refusal, not a bad shape.
        if (error instanceof Error && error.message.includes("too large")) {
          sendText(response, 413, "That provider order is too large.");
          return true;
        }
        sendJson(response, 400, {
          ok: false,
          message: "That provider order is not readable.",
        });
        return true;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        sendJson(response, 400, {
          ok: false,
          message: "That provider order is not readable.",
        });
        return true;
      }

      const result = await extensions.writeProviderOrder(
        parsed as ProviderOrder,
      );
      sendJson(response, result.ok ? 200 : 400, result);
      return true;
    }

    if (url.pathname === `${PREFIX}/install`) {
      if (request.method !== "POST") {
        sendText(response, 405, "Only POST is supported.");
        return true;
      }

      const declared = declaredLength(request);
      if (declared !== undefined && declared > MAX_EXTENSION_INSTALL_BYTES) {
        sendText(response, 413, "That plugin package is too large.");
        return true;
      }

      let bytes: Uint8Array;
      try {
        bytes = await readBytes(request, MAX_EXTENSION_INSTALL_BYTES);
      } catch {
        sendText(response, 413, "That plugin package is too large.");
        return true;
      }

      const installed = await extensions.install(bytes);
      if (!installed.ok) {
        // The installer's message is bounded but can name a real path or an
        // internal file; it stays on this machine.
        if (installed.message !== undefined) console.error(installed.message);
        sendJson(response, 400, {
          ok: false,
          message: "That plugin could not be installed.",
        });
        return true;
      }

      // The installer's record names a directory on this PC. The browser gets
      // the listed shape instead, which never carries one.
      const listed = (await extensions.list()).find(
        (extension) => extension.key === installed.plugin?.key,
      );
      if (listed === undefined) {
        sendJson(response, 500, {
          ok: false,
          message: "That plugin could not be installed.",
        });
        return true;
      }

      sendJson(response, 200, { ok: true, plugin: listed });
      return true;
    }

    const segments = url.pathname.slice(PREFIX.length + 1).split("/");
    const consent =
      segments.length === 3 && segments[2] === "consent" && segments[1] !== "";

    if (consent) {
      if (request.method !== "POST") {
        sendText(response, 405, "Only POST is supported.");
        return true;
      }

      const key = keyOf(segments);
      if (key === undefined) {
        sendJson(response, 400, {
          ok: false,
          message: "That is not a plugin key.",
        });
        return true;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(await readBody(request, MAX_CONSENT_BYTES));
      } catch {
        sendJson(response, 400, {
          ok: false,
          message: "That consent is not readable JSON.",
        });
        return true;
      }

      const fingerprint = isRecord(parsed) ? parsed["fingerprint"] : undefined;
      if (typeof fingerprint !== "string") {
        sendJson(response, 400, {
          ok: false,
          message: "That consent does not name a fingerprint.",
        });
        return true;
      }

      sendJson(response, 200, await extensions.grantConsent(key, fingerprint));
      return true;
    }

    if (segments.length === 2) {
      if (request.method !== "DELETE") {
        sendText(response, 405, "Only DELETE is supported.");
        return true;
      }

      const key = keyOf(segments);
      if (key === undefined) {
        sendJson(response, 400, {
          ok: false,
          message: "That is not a plugin key.",
        });
        return true;
      }

      await extensions.remove(key);
      sendJson(response, 200, { ok: true });
      return true;
    }

    sendText(response, 404, "Not found.");
    return true;
  };
}
