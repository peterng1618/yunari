import type http from "node:http";
import type { DisplayPresentation } from "@yunari/renderer-core";
import { newToken } from "../session/pairing.js";
import type { PairingCodeStore } from "../session/pairing-code.js";
import { normalizePresentation } from "../settings/display-presentation.js";
import { type DisplayStore, mintedDisplayId } from "../settings/displays.js";
import { readBody, sendJson, sendText } from "./http.js";
import { isLoopbackRemote, peerOf, sessionCookie } from "./identity.js";

/** One refusal for every way a code can fail — unknown, expired, spent or
 *  simply wrong. A caller that could tell them apart could search the space. */
const NO_PAIRING_CODE =
  "That pairing code is not the one this host is showing.";

export interface PairingRouteDeps {
  readonly displays: DisplayStore | undefined;
  readonly pairingCodes: PairingCodeStore;
}

export function createPairingRoutes(
  deps: PairingRouteDeps,
): (
  request: http.IncomingMessage,
  response: http.ServerResponse,
  url: URL,
) => Promise<boolean> {
  const { displays, pairingCodes } = deps;

  return async function handlePairingRoutes(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    // The one-time exchange a display makes after claiming a token, so the
    // credential leaves the address bar and becomes a cookie the browser sends
    // by itself. **Not behind the pairing block's loopback gate**: the pairing
    // page runs on the display, which is off this PC, and the request is
    // same-origin there — so it needs no CORS surface and no credential of its
    // own, only the token it just minted.
    //
    // **The JSON media type is the origin guard.** Any page can POST here with
    // a `text/plain` body and no preflight, which would let it set this
    // origin's session cookie. Requiring `application/json` forces a preflight
    // this host never answers, and every refusal here is `no-store` so a
    // crediting answer never survives in a cache.
    if (url.pathname === "/api/session" && request.method === "POST") {
      const refuse = (status: number, message: string): void => {
        response.setHeader("cache-control", "no-store");
        sendText(response, status, message);
      };

      if (displays === undefined) {
        refuse(404, "Pairing is not enabled on this host.");
        return true;
      }

      const mediaType = request.headers["content-type"]
        ?.split(";")[0]
        ?.trim()
        .toLowerCase();

      if (mediaType !== "application/json") {
        refuse(415, "That request must be JSON.");
        return true;
      }

      let text: string;

      try {
        text = await readBody(request);
      } catch (error) {
        // The bound's own refusal, not a parse failure: swallowing it would
        // call an oversized body malformed JSON and hide what happened.
        refuse(
          400,
          error instanceof Error
            ? error.message
            : "That request body could not be read.",
        );
        return true;
      }

      let parsed: unknown;

      try {
        parsed = JSON.parse(text);
      } catch {
        // Fixed, never the parser's words: the message quotes the start of the
        // body, and a caller in the middle of pairing must not be answered the
        // first bytes of its own token.
        refuse(400, "That request body is not valid JSON.");
        return true;
      }

      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        refuse(400, "That is not a session request.");
        return true;
      }

      const offered = (parsed as { readonly token?: unknown }).token;

      if (typeof offered !== "string" || offered === "") {
        refuse(400, "A token is required.");
        return true;
      }

      // The store owns what a live token is; a token it does not hold is
      // answered as the credential it is — refused, with no cookie set.
      if ((await displays.authenticate(offered)) === undefined) {
        refuse(401, "That token is not one this host issued.");
        return true;
      }

      response.writeHead(302, {
        location: "/",
        "set-cookie": sessionCookie(offered, request),
        "cache-control": "no-store",
      });
      response.end();
      return true;
    }

    // Pairing is an admin action: it mints display credentials, so it stays
    // loopback-only even when the server is LAN-reachable.
    if (!url.pathname.startsWith("/api/pairing")) return false;

    // The one exception, and the reason a camera-less display can pair at
    // all: the claim exchanges a code for a credential, so it is reached by a
    // device that has no credential, and it answers before the gate the rest
    // of this block is behind.
    if (url.pathname === "/api/pairing/claim" && request.method === "POST") {
      if (displays === undefined) {
        sendText(response, 404, "Pairing is not enabled on this host.");
        return true;
      }

      let asked: {
        readonly code?: unknown;
        readonly label?: unknown;
        readonly shape?: unknown;
        readonly rotation?: unknown;
      };

      try {
        const parsed: unknown = JSON.parse(await readBody(request));
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          throw new Error("That is not a pairing request.");
        }
        asked = parsed as {
          readonly code?: unknown;
          readonly label?: unknown;
          readonly shape?: unknown;
          readonly rotation?: unknown;
        };
      } catch (error) {
        sendText(
          response,
          400,
          error instanceof Error ? error.message : String(error),
        );
        return true;
      }

      if (typeof asked.code !== "string") {
        sendText(response, 400, "A pairing code is required.");
        return true;
      }

      if (typeof asked.label !== "string") {
        sendText(response, 400, "A display name is required.");
        return true;
      }

      // The store's own label→id rule, asked **before** the code is claimed:
      // a name it would refuse is the caller's to fix, and claiming first
      // would spend the window on a name nobody could have used.
      let presentation: DisplayPresentation;

      try {
        mintedDisplayId(asked.label);
        // The record's own presentation rule, for the same reason and at the
        // same point: a shape or angle it would refuse must not spend the code.
        presentation = normalizePresentation(asked.shape, asked.rotation);
      } catch (error) {
        sendText(
          response,
          400,
          error instanceof Error ? error.message : String(error),
        );
        return true;
      }

      const claimed = await pairingCodes.claim(
        asked.code,
        request.socket.remoteAddress ?? "unknown",
      );

      if (!claimed) {
        sendText(response, 404, NO_PAIRING_CODE);
        return true;
      }

      // A durable credential (ruling 12): the code is the only short-lived
      // secret in this exchange, and what it buys lasts until the owner
      // removes the client by name.
      const token = newToken();
      const display = await displays.create(asked.label, token, presentation);
      sendJson(response, 200, { displayId: display.id, token });
      return true;
    }

    if (!isLoopbackRemote(request.socket.remoteAddress)) {
      sendText(response, 403, "Pairing is available on this PC only.");
      return true;
    }

    if (displays === undefined) {
      sendText(response, 404, "Pairing is not enabled on this host.");
      return true;
    }

    // The owner's explicit renewal: a new window replaces the live one and
    // clears the penalty table, so a code that has run its ten minutes is not
    // a host restart. A read still never rotates — only this POST does.
    if (url.pathname === "/api/pairing/code" && request.method === "POST") {
      const fresh = pairingCodes.mint();
      sendJson(response, 200, {
        code: fresh.code,
        expiresAt: fresh.expiresAt,
      });
      return true;
    }

    // A read, not a rotation: a second read of a live window answers the same
    // code rather than minting another, so nothing can move the code out from
    // under whoever is typing it (R16). Only an absent or expired window
    // mints one.
    if (url.pathname === "/api/pairing/code" && request.method === "GET") {
      const live = pairingCodes.currentOrMint();
      sendJson(response, 200, { code: live.code, expiresAt: live.expiresAt });
      return true;
    }

    if (url.pathname === "/api/pairing/sessions" && request.method === "GET") {
      const known = await displays.list();
      sendJson(response, 200, { displays: known.map(peerOf) });
      return true;
    }

    if (url.pathname === "/api/pairing/sessions" && request.method === "POST") {
      // The credential is answered exactly once: only its hash is stored, so
      // this is the one moment it can be handed to the display it belongs to.
      const token = newToken();
      const known = url.searchParams.get("displayId");

      // Rotation replaces what proves the display is itself and keeps the
      // record: everything else — a theme, a set of answers — is keyed by the
      // id, so a re-pairing that minted a second display would orphan it.
      if (known !== null) {
        const rotated = await displays.rotate(known, token);

        if (rotated === undefined) {
          sendText(response, 404, "No such display.");
          return true;
        }

        sendJson(response, 201, { display: peerOf(rotated), token });
        return true;
      }

      const label = url.searchParams.get("label") ?? "display";
      // A label the store would refuse is answered rather than thrown: the
      // store's own rules decide, so the route and the file agree, and the
      // author is told which rule they broke instead of a 500.
      try {
        mintedDisplayId(label);
      } catch (error) {
        sendText(
          response,
          400,
          error instanceof Error ? error.message : String(error),
        );
        return true;
      }

      const display = await displays.create(label, token);
      sendJson(response, 201, { display: peerOf(display), token });
      return true;
    }

    sendText(response, 405, "Only GET and POST are supported.");
    return true;
  };
}
