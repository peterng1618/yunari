import type http from "node:http";
import { CATALOGUE_ORIGIN, type DisplayShape } from "@yunari/renderer-core";
import type { ActiveThemeStore } from "../settings/active-theme.js";
import { assignedThemeFor } from "../settings/active-theme.js";
import {
  DEFAULT_DISPLAY,
  type DisplayRecord,
  type DisplayStore,
} from "../settings/displays.js";
import type { HostingPeer } from "./options.js";

/** Non-loopback displays present this header; loopback never needs to. */
const SESSION_HEADER = "x-yunari-session";

/** The cookie a paired display keeps instead of a token in its URL. Never
 *  readable by a script: the display only has to carry it. */
const SESSION_COOKIE = "yunari_session";

/** Recognizes loopback forms Node may report. */
export function isLoopbackRemote(address: string | undefined): boolean {
  if (address === undefined) {
    return false;
  }

  const normalized = address.replace(/^::ffff:/, "");

  return normalized === "127.0.0.1" || normalized === "::1";
}

/** The hostname an authority (`host:port`, `[::1]:port`) names, or nothing. */
export function hostnameOf(authority: string): string | undefined {
  try {
    return new URL(`http://${authority}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** A name that can only mean this machine. */
export function isLoopbackName(name: string | undefined): boolean {
  if (name === undefined) return false;
  return (
    name === "localhost" || name === "[::1]" || /^127(\.\d{1,3}){3}$/.test(name)
  );
}

/**
 * The store origin a host may talk to.
 *
 * The session token is sent here, so a mis-set variable must not be able to
 * point it at another host: only the compiled catalogue origin, or a loopback
 * address for a Worker under test, survives. Anything else is answered as if
 * the variable were unset.
 */
export function resolveStoreOrigin(
  raw: string | undefined,
): string | undefined {
  if (raw === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.origin === CATALOGUE_ORIGIN) return url.origin;
  if (url.protocol === "http:" && isLoopbackName(url.hostname))
    return url.origin;
  return undefined;
}

/**
 * Whether a loopback request asks an admin route it has not proved it may
 * reach.
 *
 * A browser lured to another name can resolve that name to 127.0.0.1, so the
 * peer is loopback while the request is not this machine's page. `Host` and
 * `Origin` are what such a page cannot forge, so the existing same-origin rule
 * answers once here rather than route by route, which missed some.
 * A non-loopback peer is untouched.
 *
 * `/api/host` is the one exemption, because a re-find sweep is cross-origin.
 */
export function refusesLoopbackApi(
  request: http.IncomingMessage,
  url: URL,
): boolean {
  return (
    url.pathname.startsWith("/api/") &&
    url.pathname !== "/api/host" &&
    isLoopbackRemote(request.socket.remoteAddress) &&
    isForeignOrigin(request)
  );
}

/**
 * Whether a request states an origin other than its own.
 *
 * A page in another origin can reach a loopback route with a `text/plain` POST
 * that needs no preflight, and the browser's own `Origin` header is the one
 * fact that page cannot forge. An absent `Origin` stays allowed: curl, the
 * host's tooling and a same-origin navigation all send none, and every other
 * route treats that as the same-origin case.
 *
 * **The `Host` must also be a loopback name.** Origin and Host agreeing is not
 * enough on its own: a page served from `http://evil.example:5173`, whose name
 * later resolves to 127.0.0.1, sends both headers naming itself and would
 * otherwise pass. Every route that changes something — install, device start,
 * poll, sign-out and submit — calls this, because a request to `localhost` that
 * the page did not mean to make is that page acting as this machine.
 */
export function isForeignOrigin(request: http.IncomingMessage): boolean {
  const host = request.headers.host;
  if (host === undefined || !isLoopbackName(hostnameOf(host))) return true;

  const origin = request.headers.origin;
  if (origin === undefined) return false;

  try {
    return new URL(origin).host.toLowerCase() !== host.toLowerCase();
  } catch {
    return true;
  }
}

/** One named value from a request's cookie header, or nothing. */
function cookieValue(
  cookie: string | undefined,
  name: string,
): string | undefined {
  if (cookie === undefined) return undefined;

  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");

    if (key !== name) continue;

    try {
      return decodeURIComponent(rest.join("="));
    } catch {
      // A malformed escape is a caller's typo, not a reason to fail the request.
      return undefined;
    }
  }

  return undefined;
}

/**
 * A request's credential: the cookie first, then the header, or nothing.
 *
 * **The cookie outranks the header because it is the fresher credential.** This
 * host set it, and only this host can. The header remains for the host's own
 * tooling and for a player that has no cookie yet, but it can be stale: a page
 * that stored a token before its display was retired and re-paired keeps
 * sending the old one, and reading the header first let it outrank the fresh
 * cookie and refuse the load until someone reloaded by hand.
 *
 * **A query token is deliberately absent.** It is read only by the root route,
 * which exchanges it for the cookie and redirects it out of the address bar.
 * Refusing it everywhere else keeps a credential out of logs and history.
 */
export function tokenFor(request: http.IncomingMessage): string | undefined {
  const header = request.headers[SESSION_HEADER];
  const fromCookie = cookieValue(request.headers.cookie, SESSION_COOKIE);
  const cookie = fromCookie === "" ? undefined : fromCookie;

  // `yunari_session=` is an empty value, not a credential. This host never
  // writes one, but `??` alone would treat it as present and shadow a valid
  // header behind it.
  return cookie ?? (Array.isArray(header) ? header[0] : header);
}

/**
 * The `Set-Cookie` value that makes a display's token a credential the browser
 * carries for it.
 *
 * **`Max-Age` is load-bearing.** A display is a fixed appliance, and without a
 * lifetime the cookie dies with the browser process: the stored token
 * authenticates `fetch` only, while a document navigation and an `EventSource`
 * cannot set a header, so after a reboot the display's own page would be
 * refused and never load — re-pairing it after every restart is the worse
 * failure. 400 days is the longest lifetime a browser honours. A cookie that
 * outlives its pairing is still refused by the normal `401`/`403` display
 * check, which sends the owner back to pairing.
 *
 * `Secure` only over TLS: on plain http the browser would drop the cookie and
 * the display would never pair.
 */
export function sessionCookie(
  token: string,
  request: http.IncomingMessage,
): string {
  const secure = (request.socket as { encrypted?: boolean }).encrypted === true;

  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=34560000; HttpOnly; SameSite=Strict; Path=/${secure ? "; Secure" : ""}`;
}

/** A display as a surface may see it. */
export function peerOf(record: DisplayRecord): HostingPeer {
  const { tokenHash: _hash, ...peer } = record;
  return peer;
}

/**
 * The display a request is, or `undefined` when it is not one — the single place
 * a request becomes a display, so the credential is checked once.
 *
 * **Loopback answers `undefined` on purpose.** It is trusted admin and never
 * paired, so it has no record to return: the *key* is minted where a key is
 * needed, not fabricated here with a `createdAt` nobody wrote. A credential
 * matching no display is `undefined` too, and the caller refuses it as it
 * refuses a missing credential.
 */
export async function displayFor(
  request: http.IncomingMessage,
  displays: DisplayStore | undefined,
): Promise<DisplayRecord | undefined> {
  if (
    displays === undefined ||
    isLoopbackRemote(request.socket.remoteAddress)
  ) {
    return undefined;
  }

  const token = tokenFor(request);

  if (token === undefined) {
    return undefined;
  }

  const record = await displays.authenticate(token);

  if (record === undefined) {
    return undefined;
  }

  // `lastSeenAt` costs a write here rather than a second polling loop. A request
  // that resolves its display twice — the pairing guard, then the root route —
  // pays it twice, which a page load can afford; a memo would be request-scoped
  // state this function does not otherwise hold. A refused write is dropped:
  // bookkeeping must not fail the request it rode in on.
  await displays
    .touch(record.id, new Date().toISOString())
    .catch(() => undefined);

  return record;
}

/**
 * The display a request is served as, which is the key its theme is stored
 * under. Not `displayFor` with a fallback: a request with no identity of its
 * own is served as the default, which is a key rather than a display.
 *
 * **`?display=` names local displays only, and that restriction is the security
 * property rather than a nicety.** A local monitor has no credential, so the
 * parameter is the only thing that could identify it — and so the only thing
 * that could impersonate one. Two rules close that: it is read only on
 * loopback, and matched only against records whose kind is `local`. A paired
 * display is reached by the credential it was given and by nothing else, which
 * is the reason that credential exists.
 *
 * **A request that resolves to a local display is a sighting of it.** Such a
 * display has no credential, so this is the only way it can be seen to be up —
 * and the launcher reads `lastSeenAt` to tell a window that is running from one
 * a killed host left behind. Without the write here, a host restarted after
 * being killed opens a second window on a monitor that already has one.
 */
export async function displayKeyFor(
  request: http.IncomingMessage,
  url: URL,
  displays: DisplayStore | undefined,
): Promise<string> {
  if (isLoopbackRemote(request.socket.remoteAddress)) {
    const named = url.searchParams.get("display");
    const record = named === null ? undefined : await displays?.find(named);

    // A credentialless display: the host's own monitor, or a panel the host
    // drives. Both are reached only from this PC, which is what makes naming one
    // an admin act rather than a client claiming an identity.
    if (
      record !== undefined &&
      (record.kind === "local" || record.kind === "panel")
    ) {
      // A refused write is dropped, as it is in `displayFor`: bookkeeping must
      // not fail the request it rode in on.
      await displays
        ?.touch(record.id, new Date().toISOString())
        .catch(() => undefined);
      return record.id;
    }

    return DEFAULT_DISPLAY;
  }

  return (await displayFor(request, displays))?.id ?? DEFAULT_DISPLAY;
}

/** A BCP-47-shaped tag, bounded: enough for `de`, `de-DE`, `zh-Hant-TW`. */
const LANGUAGE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
/** The published schema's `metadata.themeLanguage` ceiling (`maxLength: 64`). */
const MAX_LANGUAGE_LENGTH = 64;

/**
 * The language a display declares on its stream URL, or none.
 *
 * The player sends the theme it has already loaded; the host never reads a
 * theme record to learn it. A malformed or over-long value is dropped rather
 * than refused — a display that mistranslates its own text still opens.
 */
export function streamLanguage(url: URL): string | undefined {
  const language = url.searchParams.get("lang");

  if (
    language === null ||
    language.length > MAX_LANGUAGE_LENGTH ||
    !LANGUAGE_TAG.test(language)
  ) {
    return undefined;
  }

  return language;
}

/**
 * The glass and mounting angle of the display behind a key.
 *
 * `default` is not a record, so it answers the upright rectangle it is handed,
 * and every other key is a record whose own presentation wins. A stored upright
 * angle is answered as `0` because the record omits it.
 */
export async function presentationForDisplay(
  key: string,
  displays: DisplayStore | undefined,
): Promise<{ readonly shape: DisplayShape; readonly rotation: number }> {
  const record =
    key === DEFAULT_DISPLAY ? undefined : await displays?.find(key);

  return {
    shape: record?.shape ?? "rect",
    rotation: record?.rotation ?? 0,
  };
}

/**
 * Whether a key a loopback request named is one this host can hold a theme or a
 * set of answers for.
 *
 * `default` is a key in its own right — it is what a display with no choice of
 * its own falls to — so it is not a record and is not refused for the lack of
 * one. Everything else must be a display this host holds, so a typo is a 404
 * rather than a key nothing will ever read.
 *
 * **Not `displayKeyFor`.** That answers the request a display makes about
 * itself, where `?display=` may name a local record and nothing else, because
 * the parameter is the one thing that could impersonate a credential-less
 * monitor. The routes that call this one are loopback-only admin, and the
 * host's own page has to reach a paired display.
 */
export async function knownDisplayKey(
  key: string,
  displays: DisplayStore | undefined,
): Promise<boolean> {
  if (key === DEFAULT_DISPLAY) return true;
  return ((await displays?.list()) ?? []).some((record) => record.id === key);
}

/** Loopback is trusted admin; anything else must present a live credential. */
export async function allowed(
  request: http.IncomingMessage,
  displays: DisplayStore | undefined,
): Promise<boolean> {
  if (isLoopbackRemote(request.socket.remoteAddress)) {
    return true;
  }

  return (await displayFor(request, displays)) !== undefined;
}

/**
 * The theme the display was assigned, or the default's when it holds no entry
 * of its own — and none when that too is unset, which leaves the caller to
 * decide what to show. A display nobody has assigned a theme to is an unpaired
 * client, and `default` is the display such a client is served as.
 *
 * The key rather than the request, so a caller that also needs the key — the
 * poll, which answers it beside the theme — resolves the display once. A
 * local display's resolution is a write, and paying for it twice per poll is
 * a cost this signature exists not to have.
 */
export async function assignedThemeForDisplay(
  activeTheme: ActiveThemeStore | undefined,
  display: string,
  exists: (id: string) => Promise<boolean>,
): Promise<string | undefined> {
  if (activeTheme === undefined) {
    return undefined;
  }

  return assignedThemeFor(activeTheme, display, exists);
}
