/** A paired display carries its host session in an HttpOnly cookie, which the
 * browser sends for every same-origin request. Loopback displays carry none. */

import { readStoredPairing } from "./host-refind.js";

export interface DisplaySessionToken {
  readonly token: string | undefined;
  /** The page this display is on, which is where its own display and the origin
   * of its theme are read from: a poll has to name the display that asked. */
  readonly pageUrl: string;
  /** Adds the token to a fetch, which can use the header form. The host's own
   * tooling and the player's fetches authenticate this way; the browser cookie
   * covers everything that cannot set a header. */
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  /** The stream URL. An `EventSource` cannot set a header, so it carries no
   * credential at all: the browser attaches the same-origin cookie by itself. */
  streamUrl(path: string, parameters: URLSearchParams): string;
  /** Unchanged. A loader that sets no headers, such as Fabric's image fetch,
   * sends the cookie too, so appending a token would only put the credential
   * back into a URL. Kept as a named no-op so callers read as they did. */
  withToken(url: string): string;
}

/**
 * Whether a display page is this machine's own. A loopback page is trusted
 * without a credential and resolves as this PC, so it has no own-theme write
 * to offer; any other origin is a paired display, because the host refuses a
 * LAN page that is not one.
 *
 * The octet bound below is unreachable through `URL`: an out-of-range quad
 * (`127.0.0.256`) throws before the pattern runs, so the bound states what the
 * predicate means rather than guarding a live path.
 *
 * **`*.localhost` diverges from `server.ts:isLoopbackName`, deliberately.** The
 * host's check does not treat a dotted name as this machine, and this one does.
 * The player's answer only decides whether the theme chooser is offered: a name
 * the host refuses never serves the page at all, so no control here can be one
 * the host would then reject.
 */
export function isLoopbackPage(pageUrl: string): boolean {
  let hostname: string;

  try {
    hostname = new URL(pageUrl).hostname.toLowerCase();
  } catch {
    return false;
  }

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]"
  ) {
    return true;
  }

  const octets = hostname.split(".");

  // A dotted quad only: each octet is bounded, so `127.0.0.256` is not read as
  // loopback just because it starts with `127`.
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  );
}

/**
 * **Reads storage, never writes it.** `rememberPairing` is the single writer,
 * because the identity comes from `GET /api/host` and nowhere else: nothing in
 * the repo emits `host=`, `name=` or `port=`, so a record written here could
 * only carry an empty `hostId` — which reads back as a valid pairing, matches
 * no probe, and would overwrite a good one on any load where the route failed
 * (R72).
 *
 * The URL wins when it carries a token, so a fresh pairing link still replaces
 * a stale stored credential; storage answers only when the URL does not.
 */
export function displaySession(
  pageUrl: string,
  fetcher: typeof fetch,
  storage?: Storage,
): DisplaySessionToken {
  const stored = storage === undefined ? undefined : readStoredPairing(storage);
  const token =
    new URL(pageUrl).searchParams.get("session") ?? stored?.token ?? undefined;

  return {
    token,
    pageUrl,
    fetch(input, init) {
      if (token === undefined) {
        return fetcher(input, init);
      }

      const headers = new Headers(init?.headers);
      headers.set("x-yunari-session", token);
      return fetcher(input, { ...init, headers });
    },
    streamUrl(path, parameters) {
      return `${path}?${parameters.toString()}`;
    },
    withToken(url) {
      return url;
    },
  };
}
