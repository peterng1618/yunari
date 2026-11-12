import type http from "node:http";
import {
  BridgeRequestError,
  DeviceNotFoundError,
  type SignalRgbBridge,
} from "../signalrgb/bridge.js";
import { readBody, sendJson, sendText } from "./http.js";
import { isLoopbackRemote } from "./identity.js";

/**
 * The SignalRGB bridge's HTTP surface, exactly as `docs/signalrgb-bridge.md`
 * states it: the device descriptor, controls, telemetry and lighting mode.
 *
 * **Loopback only**, like the editor routes: a LAN client has no business
 * driving this PC's LEDs or fans. The handler never opens hardware; every
 * write reaches the one panel instance the manager holds.
 */
export interface DeviceRouteDeps {
  /** The running bridge, read per request: it is built after the server so it
   *  can see the panel manager. */
  readonly bridge: () => SignalRgbBridge | undefined;
}

export function createDeviceRoutes(
  deps: DeviceRouteDeps,
): (
  request: http.IncomingMessage,
  response: http.ServerResponse,
  url: URL,
) => Promise<boolean> {
  return async function handleDeviceRoutes(request, response, url) {
    if (!url.pathname.startsWith("/api/devices")) return false;

    // `GET /api/devices` is the assignment surface's: its answer carries the
    // descriptor too (see `settings-routes`), so this module owns only the
    // subpaths that act on one device.
    if (url.pathname === "/api/devices") return false;

    if (!isLoopbackRemote(request.socket.remoteAddress)) {
      sendText(response, 403, "Device control is available on this PC only.");
      return true;
    }

    const bridge = deps.bridge();
    if (bridge === undefined) {
      // No receiver means no seam, not an empty device list: a consumer must
      // be able to tell "nothing attached" from "the bridge is not running".
      sendText(response, 404, "The SignalRGB bridge is not running.");
      return true;
    }

    const match = url.pathname.match(
      /^\/api\/devices\/([^/]+)\/(controls|telemetry|lighting-mode)$/,
    );
    if (match === null) return false;

    const id = decodeURIComponent(match[1] ?? "");
    const action = match[2];

    if (action === "telemetry") {
      if (request.method !== "GET") {
        sendText(response, 405, "This path supports GET.");
        return true;
      }

      try {
        sendJson(response, 200, await bridge.telemetry(id));
      } catch (error) {
        if (answerError(response, error)) return true;
        throw error;
      }
      return true;
    }

    if (request.method !== "POST") {
      sendText(response, 405, "This path supports POST.");
      return true;
    }

    let input: unknown;
    try {
      input = JSON.parse(await readBody(request));
    } catch (error) {
      sendText(
        response,
        400,
        error instanceof SyntaxError
          ? "That is not a JSON body."
          : error instanceof Error
            ? error.message
            : String(error),
      );
      return true;
    }

    try {
      if (action === "controls") {
        await bridge.controls(id, input);
      } else {
        await bridge.lightingMode(id, input);
      }
    } catch (error) {
      if (answerError(response, error)) return true;
      throw error;
    }

    response.statusCode = 204;
    response.end();
    return true;
  };
}

/** Answers a refusal the seam names, and says whether it did. */
function answerError(response: http.ServerResponse, error: unknown): boolean {
  if (error instanceof BridgeRequestError) {
    sendText(response, 400, error.message);
    return true;
  }

  if (error instanceof DeviceNotFoundError) {
    sendText(response, 404, error.message);
    return true;
  }

  return false;
}
