import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import {
  createBatch,
  knownTimeZones,
  SAMPLE_STREAM_PATH,
  validateFabricThemeEnvelope,
} from "@yunari/renderer-core";
import type { ChartRefreshRate } from "@yunari/scene-fabric";
import { type AssetRouteOptions, handleAssetRoutes } from "./assets/routes.js";
import {
  createPendingStates,
  handleCatalogueRoutes,
} from "./catalogue/routes.js";
import { handleSubmitRoute } from "./catalogue/submit.js";
import { DEFAULT_THEMES_DIR } from "./cli/args.js";
import type { HostBinding } from "./cli/hosting.js";
import type { ListenableServer } from "./cli/net.js";
import type { DeviceAssignment } from "./providers/lhm-mapping.js";
import {
  type DisplayAsk,
  groupByAssignment,
  ProviderRegistry,
  unionOfKeys,
} from "./providers/registry.js";
import type { Launcher } from "./serve/display-launcher.js";
import {
  createPublishedStore,
  type PublishedStore,
} from "./serve/published.js";
import {
  contentTypeFor,
  needsTrailingSlash,
  resolveStaticPath,
} from "./serve/static-path.js";
import { newToken } from "./session/pairing.js";
import {
  createPairingCodeStore,
  type PairingCodeStore,
} from "./session/pairing-code.js";
import type { ActiveThemeStore } from "./settings/active-theme.js";
import { type CredentialStore, hintOf } from "./settings/credentials.js";
import {
  type CredentialRow,
  KNOWN_CREDENTIALS,
  type KnownCredential,
} from "./settings/credentials-registry.js";
import {
  type AssignableGroup,
  type DeviceSettingsStore,
  EMPTY_DEVICE_SETTINGS,
} from "./settings/devices.js";
import type {
  DisplaySettings,
  DisplaySettingsStore,
} from "./settings/display.js";
import type {
  DisplayKind,
  DisplayPatch,
  DisplayRecord,
  DisplayStore,
} from "./settings/displays.js";
import {
  chartFpsFor,
  DEFAULT_DISPLAY,
  LOCAL_DISPLAY_ID,
  MonitorAlreadyHeldError,
  mintedDisplayId,
  normalizeMonitor,
  normalizePatch,
} from "./settings/displays.js";
import type { FontFavoritesStore } from "./settings/font-favorites.js";
import type { HostRecord } from "./settings/host-record.js";
import { listMonitors, type Monitor } from "./settings/monitors.js";
import { requiredDeviceGroups } from "./settings/required-devices.js";
import type { StoreSessionStore } from "./settings/store-session.js";
import type { ThemeOriginsStore } from "./settings/theme-origins.js";
import type { ThemeSettingsStore } from "./settings/theme-settings.js";
import { importThemePackage } from "./themes/import.js";
import {
  type InstallRequest,
  installCatalogueItem,
  parseInstallRequest,
} from "./themes/install.js";
import {
  type NormalizeAspect,
  normalizeVideo,
} from "./themes/normalize-video.js";
import {
  createThemeStore,
  isValidThemeId,
  ThemeAssetLimitError,
  ThemeConflictError,
  type ThemeStore,
  ThemeTooLargeError,
  ThemeValidationError,
} from "./themes/store.js";
import { SHIPPED_TEMPLATES } from "./themes/templates.js";
import type { ThumbnailStore } from "./themes/thumbnails.js";
import {
  type DecodedThemeSave,
  decodeThemeSave,
  encodeThemeContent,
} from "./themes/wire.js";
import { SseConnection } from "./transport/sse.js";
import type { WallpaperEngineSource } from "./wallpaper-engine/source.js";

/** HTTP routing for bundles, discovery, sample streaming, and theme packages. */

/** Non-loopback displays present this header; loopback never needs to. */
const SESSION_HEADER = "x-yunari-session";

/** One refusal for every way a code can fail — unknown, expired, spent or
 *  simply wrong. A caller that could tell them apart could search the space. */
const NO_PAIRING_CODE =
  "That pairing code is not the one this host is showing.";

/** What a theme read answers: the stored record, or undefined for a theme the
 *  store will not serve. */
type ThemeRecord = Awaited<ReturnType<ThemeStore["read"]>>;

/**
 * One row of the display map `/api/themes/active` answers: a display and the
 * theme it holds.
 *
 * `kind` travels because the host page's warning table is keyed on it, and a
 * page cannot ask a display what it is.
 */
interface ActiveDisplay {
  readonly id: string;
  readonly label: string;
  readonly kind: DisplayKind;
  readonly theme: string | null;
}

/**
 * What the map calls `this-pc`, the machine itself.
 *
 * Never read from the display store: `this-pc` is the machine rather than a
 * client anyone paired, so it has no record whose label could be taken. The
 * word matches the heading the host's own pages already use (`public/settings.html`).
 */
const LOCAL_DISPLAY_LABEL = "This PC";

export interface BundleRoots {
  readonly player: string;
  readonly editor: string;
  /** Admin pages served from source (no build step), e.g. the settings page. */
  readonly admin?: string;
}

export interface HostServerOptions {
  readonly registry: ProviderRegistry;
  readonly bundles: BundleRoots;
  readonly themeStore?: ThemeStore;
  /** Chosen baseline cadence; not a measured performance budget. */
  readonly sampleIntervalMs?: number;
  readonly now?: () => number;
  /** The displays this host knows, and the credentials that prove one is itself.
   *  Omit to disable pairing entirely: a loopback-only server needs none, and a
   *  non-loopback display is then refused rather than trusted. */
  readonly displays?: DisplayStore;
  /** The one-time code a display with no camera types, and the window it is
   *  valid in. Supplied so the launcher can print a link carrying the same code
   *  the claim route accepts; a caller with no launcher gets a store of its
   *  own, which is what the unit suite wants. */
  readonly pairingCodes?: PairingCodeStore;
  /** Device assignments (§145). Omit to keep defaults with no configuration. */
  readonly devices?: DeviceSettingsStore;
  /** Per-theme answers. Omitted when the host stores none. */
  readonly themeSettings?: ThemeSettingsStore;
  /** Where each library theme came from. Omitted when the host records none,
   *  which is what a caller that only serves its own themes wants. */
  readonly themeOrigins?: ThemeOriginsStore;
  /** Theme thumbnails. Omitted when the host stores none. */
  readonly thumbnails?: ThumbnailStore;
  /** The fetcher the install route uses. Omitted uses the global; supplied so a
   *  route test can install without a network. */
  readonly fetch?: typeof fetch;
  /** The Worker's origin, as the store session routes reach it. Omitted falls
   *  back to `YUNARI_STORE_ORIGIN`; without either, those routes say the host
   *  has no store rather than inventing an address. */
  readonly storeOrigin?: string;
  /** The store session this host holds. Omitted when it keeps none. */
  readonly storeSession?: StoreSessionStore;
  /** Which theme this host displays. Omitted when the host keeps no choice. */
  readonly activeTheme?: ActiveThemeStore;
  /** The consumer's display preferences. Omit when the host stores none. */
  readonly display?: DisplaySettingsStore;
  /** Which curated font trios this author favours. Omit when the host stores
   *  none — the route then reports that rather than serving an empty list. */
  readonly fontFavorites?: FontFavoritesStore;
  /** Provider credentials. Omit when the host stores none — the routes then
   *  say so rather than accepting a key that is dropped. */
  readonly credentials?: CredentialStore;
  /** The credential ids this host knows. Omitted uses the shipped table, which
   *  is empty in v1; supplied so a route test can hold a cookie fixture. */
  readonly knownCredentials?: readonly KnownCredential[];
  /** The asset finder's sources. Omitted when this host serves none; the
   *  routes then say so rather than falling through to the static 404. */
  readonly assets?: AssetRouteOptions;
  /** The Wallpaper Engine library on this PC. Omitted when this host serves
   *  none, and the listing then says it is not installed. */
  readonly wallpaperEngine?: WallpaperEngineSource;
  /** Called after a display change so providers read readings the new way. */
  readonly onDisplayChange?: (settings: DisplaySettings) => void;
  /** Devices a consumer may choose between. Omitted when none are known. */
  readonly describeDevices?: () => Promise<{
    readonly gpus: readonly { readonly id: string; readonly name: string }[];
    readonly disks: readonly { readonly id: string; readonly name: string }[];
  }>;
  /** What is attached to this PC right now (§ "The host's own monitors"), for
   *  the owner to point a local display at. Omitted uses the real `graphics()`
   *  probe; supplied so a case can hold a fixture rather than this machine's
   *  screens, and so a host that enumerates its own way can say so. */
  readonly monitors?: () => Promise<readonly Monitor[]>;
  /** The host's own windows on its local monitors, so a display that is added
   *  gets one and one that is removed loses it. Omitted when this host opens no
   *  windows; the records are then managed without any. **Included as
   *  `undefined` explicitly** because the launcher needs the port the socket
   *  actually took, so `main` hands over a getter read per request — the same
   *  reason `hosting` is one. */
  readonly launcher?: Launcher | undefined;
  /** Registers this host to start at sign-in, so every local monitor comes back
   *  after a reboot. Omitted when this host cannot register itself: the route
   *  then says so rather than reporting a registration that did not happen. */
  readonly registerAutostart?: () => Promise<{
    readonly ok: boolean;
    readonly message: string;
  }>;
  /** Where a phone should point, whether it can reach this host at all, and how
   *  to move it there. Supplied rather than introspected: `server.address()` is
   *  null for a server that is not listening, which is every test, and the
   *  thing that binds the socket is the thing that knows.
   *
   *  Omitted when this host cannot move its binding; the route then refuses
   *  rather than pretending it moved. **Included as `undefined` explicitly**
   *  because the binding needs the port and the port needs the server, so the
   *  host hands over a getter that is read per request. */
  readonly hosting?: HostBinding | undefined;
  /** Persist the choice so the next run obeys it. Omitted when the host
   *  remembers nothing; the binding still moves for this run. */
  readonly rememberLan?: (on: boolean) => Promise<void>;
  /** The document an author is publishing, held in memory. Omitted when the
   *  host keeps none; every display then shows the stored theme. */
  readonly published?: PublishedStore;
  /** The leaf and its key. Omitted only by the unit suite: the launcher always
   *  brings one, because a display that cannot hold a wake lock or register a
   *  service worker is the failure `vg-580` exists to remove, and it is the
   *  origin rather than any route that decides it. See `docs/decisions/0070`. */
  readonly tls?: { readonly key: string; readonly cert: string };
  /** The root a display installs, served at `CA_CERTIFICATE_PATH`. Omitted when
   *  the host has none to offer, and the route then says so. */
  readonly caCertificate?: string;
  /** Which host this app folder is (§ "Finding the host after its address
   *  changes"), answered by `GET /api/host`. Omitted when this host has no
   *  identity: the route is then not registered at all, because an id minted to
   *  fill the answer is one no display could have stored. */
  readonly host?: HostRecord;
}

/** Where a display downloads the root it has to trust.
 *
 *  **Deliberately outside every check the router makes below**: the device
 *  fetching this has not been paired yet, and is looking at a browser
 *  certificate warning while it does — a session and a trusted certificate are
 *  precisely what it cannot present. The root is public by construction; its
 *  key is never served and never leaves this machine. */
export const CA_CERTIFICATE_PATH = "/yunari-ca.crt";

export interface HostingState {
  /** True when this host is reachable beyond loopback right now. */
  readonly lan: boolean;
  /** The address a phone should use, or null when there is none. */
  readonly address: string | null;
  /** The port this host is bound to, or null when it is not bound. */
  readonly port: number | null;
  /** The last move the host refused, in its own words, or null. A refusal can
   *  never ride the answer that asked for the move — the asker reads it here
   *  on the next GET. Cleared by the next move that lands. */
  readonly refusal: string | null;
}

/** A paired display as a surface may see it: the record **minus its credential
 *  hash**. The hash exists so the file is a list of displays rather than a set
 *  of credentials, and echoing it would undo exactly that. */
export type HostingPeer = Omit<DisplayRecord, "tokenHash">;

const NO_HOSTING: HostingState = {
  lan: false,
  address: null,
  port: null,
  refusal: null,
};

export interface HostServer {
  readonly server: ListenableServer;
  readonly connectionCount: number;
  close(): Promise<void>;
}

export const DEFAULT_SAMPLE_INTERVAL_MS = 1000;
/** A save is JSON with base64 assets, so the wire is a third larger than the
 *  archive it replaced; the store enforces its own bounds on the decoded side. */
export const MAX_THEME_UPLOAD_BYTES = 96 * 1024 * 1024;
/** A dashboard screenshot; the store enforces the same bound. */
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

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

/** A request's credential, from a header (fetch) or query (EventSource cannot
 *  set request headers, so the stream carries it in the URL). */
function tokenFor(request: http.IncomingMessage, url: URL): string | undefined {
  const header = request.headers[SESSION_HEADER];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  return fromHeader ?? url.searchParams.get("session") ?? undefined;
}

/** A display as a surface may see it. */
function peerOf(record: DisplayRecord): HostingPeer {
  const { tokenHash: _hash, ...peer } = record;
  return peer;
}

/**
 * The display a request is, or `undefined` when it is not one — the single place
 * a request becomes a display, so the credential is checked once.
 *
 * **Loopback answers `undefined` on purpose.** It is trusted admin and never
 * paired, and the reserved `this-pc` has no record to return (spec § "One map"):
 * the *key* is minted where a key is needed, not fabricated here with a
 * `createdAt` nobody wrote. A `?session=` value matching no display is
 * `undefined` too, and the caller refuses it as it refuses a missing credential.
 */
export async function displayFor(
  request: http.IncomingMessage,
  url: URL,
  displays: DisplayStore | undefined,
): Promise<DisplayRecord | undefined> {
  if (
    displays === undefined ||
    isLoopbackRemote(request.socket.remoteAddress)
  ) {
    return undefined;
  }

  const token = tokenFor(request, url);

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
 * under. Not `displayFor` with a fallback, because loopback is a display of its
 * own: it is this PC, which is never paired and has no record to return.
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

    if (record !== undefined && record.kind === "local") {
      // A refused write is dropped, as it is in `displayFor`: bookkeeping must
      // not fail the request it rode in on.
      await displays
        ?.touch(record.id, new Date().toISOString())
        .catch(() => undefined);
      return record.id;
    }

    return LOCAL_DISPLAY_ID;
  }

  return (await displayFor(request, url, displays))?.id ?? DEFAULT_DISPLAY;
}

/**
 * The rate the display behind a key repaints its charts at.
 *
 * The key is not always a record. `this-pc` is this machine's own monitor and
 * `default` is an unpaired client, and neither is ever minted — so each answers
 * the default its own kind would carry, which is the one thing `chartFpsFor` is
 * for. Everything else is a record id, and the record's own rate wins.
 */
async function chartFpsForDisplay(
  key: string,
  displays: DisplayStore | undefined,
): Promise<ChartRefreshRate> {
  const record =
    key === LOCAL_DISPLAY_ID || key === DEFAULT_DISPLAY
      ? undefined
      : await displays?.find(key);

  return chartFpsFor(
    record ?? { kind: key === DEFAULT_DISPLAY ? "paired" : "local" },
  );
}

/**
 * Whether a key a loopback request named is one this host can hold a theme or a
 * set of answers for.
 *
 * The two reserved words are keys in their own right — `default` is what a
 * display with no choice of its own falls to, `this-pc` is the machine — so
 * neither is a record and neither is refused for the lack of one. Everything
 * else must be a display this host holds, so a typo is a 404 rather than a key
 * nothing will ever read.
 *
 * **Not `displayKeyFor`.** That answers the request a display makes about
 * itself, where `?display=` may name a local record and nothing else, because
 * the parameter is the one thing that could impersonate a credential-less
 * monitor. The routes that call this one are loopback-only admin, and the
 * host's own page has to reach a paired display.
 */
async function knownDisplayKey(
  key: string,
  displays: DisplayStore | undefined,
): Promise<boolean> {
  if (key === DEFAULT_DISPLAY || key === LOCAL_DISPLAY_ID) return true;
  return ((await displays?.list()) ?? []).some((record) => record.id === key);
}

/** `undefined` when absent, `null` when present but not two positive numbers. */
function parseAspect(value: unknown): NormalizeAspect | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null) return null;
  const { width, height } = value as { width?: unknown; height?: unknown };
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    return null;
  return { width, height };
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
async function readBytes(
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

function sendJson(
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

/**
 * The dashboard's first-run state. Plain HTML with no build step and no
 * dependency, matching the settings page.
 */
function firstRunPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>Yunari</title>
    <!-- The host's own pages are separate documents from the two bundles, so
         they need their own copy of the mark: without a link the browser
         probes \`/favicon.ico\` and logs a 404 on every load. The same file the
         editor and the player keep, taken rather than authored. -->
    <link rel="icon" type="image/svg+xml" href="/settings/favicon.svg" />
    <style>
      html, body { margin: 0; height: 100%; }
      body {
        display: grid;
        place-items: center;
        background: #14161c;
        color: #e8ecf3;
        font: 15px/1.6 system-ui, sans-serif;
        text-align: center;
        padding: 24px;
      }
      h1 { font-size: 22px; letter-spacing: 0.02em; margin: 0 0 8px; }
      p { color: #8a97ab; margin: 0 0 24px; max-width: 34em; }
      a {
        display: inline-block;
        padding: 10px 18px;
        border-radius: 8px;
        background: #e8ecf3;
        color: #14161c;
        font-weight: 600;
        text-decoration: none;
      }
      code { color: #b5c6c0; }
    </style>
  </head>
  <body>
    <main>
      <h1>No dashboard yet</h1>
      <p>
        This PC has no saved theme, so there is nothing to display. Open the
        editor to start from the ${SHIPPED_TEMPLATES[0]?.name ?? "template"},
        or build one of your own, then save it to this PC's library.
      </p>
      <a href="/editor/">Open the editor</a>
    </main>
  </body>
</html>`;
}

function sendHtml(
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
function sendCertificate(response: http.ServerResponse, body: string): void {
  response.writeHead(200, {
    "content-type": "application/x-x509-ca-cert",
    "content-disposition": 'attachment; filename="yunari-ca.crt"',
  });
  response.end(body);
}

function sendText(
  response: http.ServerResponse,
  status: number,
  body: string,
): void {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(body);
}

/** A route module's answer, written as the node response this server speaks. */
async function writeWebResponse(
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
 * Serves a bundle file. An extension-less path is a client route and may fall
 * back to `index.html` — but only where the bundle actually has client routes.
 * The editor does; the player is one document, and answering every unmatched
 * path with it hands an operator a live display for a typo, which is harder to
 * notice than a 404 and impossible to debug from the page.
 */
async function serveStatic(
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

  const candidates = [resolved];

  if (clientRoutes && path.extname(resolved) === "") {
    candidates.push(
      path.join(resolved, "index.html"),
      path.join(root, "index.html"),
    );
  }

  for (const candidate of candidates) {
    try {
      const body = await fs.readFile(candidate);

      response.writeHead(200, {
        "content-type": contentTypeFor(candidate),
        // Entry HTML must not retain references to an old build.
        "cache-control":
          path.extname(candidate) === ".html" ? "no-store" : "no-cache",
      });
      response.end(body);
      return;
    } catch {
      continue;
    }
  }

  // The hint is only true when the bundle itself is missing its entry; a file
  // that simply is not in a built bundle must not send the reader rebuilding
  // one they already built. See ADR-0018.
  const built = await fs
    .stat(path.join(root, "index.html"))
    .then(() => true)
    .catch(() => false);

  sendText(response, 404, built ? "Not found." : missingBundleHint);
}

/** The first byte of a TLS handshake, and not a byte any HTTP request method
 *  begins with. */
const TLS_HANDSHAKE_BYTE = 0x16;

/**
 * One port, two protocols.
 *
 * A display's secure origin and the pairing link the host already prints
 * (`http://<lan-ip>:<port>`) have to be the same port, because one listener on
 * one port is what §145 asks for and a second port would be a second thing to
 * find. So the first byte on a socket decides who owns it: `0x16` is a TLS
 * ClientHello, and anything else is HTTP.
 *
 * **Plain http is a cost here, not a feature.** On a LAN it is an origin with
 * no wake lock and no service worker — the state `vg-580` exists to remove —
 * and it is kept only because the pairing link that points at it belongs to the
 * per-display-themes spec, which owns what that link should carry. A display
 * reaches the secure origin by typing `https` in front of the address until
 * then. Recorded in `docs/decisions/0070`.
 */
function createPortListener(
  plain: http.Server,
  secure: https.Server,
): ListenableServer {
  /** Sockets this port accepted, by the one name a connection has. */
  const handed = new Map<string, net.Socket>();
  /** Those with a response in flight, which are not idle. */
  const answering = new Set<net.Socket>();

  /**
   * The four-tuple, which is what a connection *is*.
   *
   * **Object identity does not survive the handover.** An https server does not
   * report the socket this port accepted: its `request` event carries a
   * `tls.TLSSocket` wrapping it, so a set of accepted sockets never matches one
   * of those, the mid-response guard is a no-op, and over TLS this port prunes
   * a response in flight — the exact case the guard exists for. Measured over a
   * real TLS socket: the two objects differ and their `remoteAddress`,
   * `remotePort`, `localAddress` and `localPort` are equal; over plain http they
   * are the same object. Nothing private is needed for that, and nothing
   * private may be used: `TLSSocket#_parent` is not a contract.
   */
  const nameOf = (socket: net.Socket): string =>
    `${socket.remoteAddress}:${socket.remotePort}:${socket.localAddress}:${socket.localPort}`;

  const listener = net.createServer({ pauseOnConnect: true }, (socket) => {
    // Captured once: a closed socket stops reporting its own addresses, and a
    // name recomputed from it then would not be the one it was filed under.
    const name = nameOf(socket);
    handed.set(name, socket);
    socket.once("close", () => handed.delete(name));

    socket.once("readable", () => {
      const first = socket.read(1) as Buffer | null;

      if (first === null) {
        socket.destroy();
        return;
      }

      // Put the byte back before handing the socket over: the inner server
      // parses it as though it had accepted the connection itself.
      socket.unshift(first);
      const owner = first[0] === TLS_HANDSHAKE_BYTE ? secure : plain;
      owner.emit("connection", socket);
    });
  });

  // **The pruning the binding asks for is this port's, not an inner server's.**
  // A server handed sockets by `emit("connection")` never builds the connection
  // registry its own `closeIdleConnections()` reads — that registry is made when
  // a server *listens*, and neither inner server ever does. Measured: with the
  // pruning delegated to them, the move's `close()` never resolved, because the
  // browser's keep-alive socket was invisible to both inner servers and the port
  // waited on it forever, so the editor's host switch stayed off (`vg-173`'s
  // shape, arrived at from the other end). This port accepted the sockets, so
  // this port closes them, and it learns which are mid-response from the inner
  // servers' own `request` events rather than from a private field.
  for (const owner of [plain, secure]) {
    owner.on("request", (request, response) => {
      const accepted = handed.get(nameOf(request.socket));

      // Not one of ours, so not one this port will ever prune.
      if (accepted === undefined) return;

      const done = (): void => {
        answering.delete(accepted);
      };

      answering.add(accepted);
      // `finish` and not only `close`: a keep-alive response is finished and
      // idle long before its socket closes, and the move is triggered from
      // exactly that moment — a socket held until `close` would leave
      // `server.close()` waiting on the connection that is asking to move.
      response.once("finish", done);
      response.once("close", done);
    });
  }

  return Object.assign(listener, {
    closeIdleConnections(): void {
      for (const socket of [...handed.values()]) {
        if (!answering.has(socket)) socket.destroy();
      }
    },
    closeAllConnections(): void {
      for (const socket of [...handed.values()]) socket.destroy();
    },
  }) as ListenableServer;
}

export function createHostServer(options: HostServerOptions): HostServer {
  const { registry, bundles } = options;
  const themeStore = options.themeStore ?? createThemeStore(DEFAULT_THEMES_DIR);
  const intervalMs = options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS;
  const now = options.now ?? (() => Date.now());
  const connections = new Set<SseConnection>();
  /** Keys no provider answered in the last poll; surfaced through `/api/health`. */
  let lastUnmapped: readonly string[] = [];
  const displays = options.displays;
  const monitors = options.monitors ?? listMonitors;
  const pairingCodes = options.pairingCodes ?? createPairingCodeStore();
  const saved = options.rememberLan;
  const devices = options.devices;
  const display = options.display;
  const fontFavorites = options.fontFavorites;
  const credentials = options.credentials;
  const knownCredentials = options.knownCredentials ?? KNOWN_CREDENTIALS;
  const assets = options.assets;
  const wallpaperEngine = options.wallpaperEngine;
  const activeTheme = options.activeTheme;
  const thumbnails = options.thumbnails;
  const fetcher = options.fetch;
  const themeSettings = options.themeSettings;
  const themeOrigins = options.themeOrigins;
  const published = options.published ?? createPublishedStore();
  const caCertificate = options.caCertificate;
  const hostRecord = options.host;
  const storeOrigin = options.storeOrigin ?? process.env.YUNARI_STORE_ORIGIN;
  const storeSession = options.storeSession;
  /** The store sign-in states this server minted, so another instance in the
   *  same process cannot redeem them. */
  const storeSignInStates = createPendingStates();

  /**
   * The move a PUT asked for, run once that PUT's answer is on the wire. Its
   * refusal is state rather than a status for the same reason: the request that
   * asked for the move cannot be answered with its outcome, so the next GET
   * reads `refusal` back (vg-173).
   */
  async function moveLan(on: boolean): Promise<void> {
    const outcome = await options.hosting?.setLan(on);
    // A refused binding moved nothing, so nothing is remembered.
    if (outcome?.ok === true) await saved?.(on);
  }

  /**
   * Assignments in the shape providers consume; unset groups mean defaults.
   *
   * Resolved for one display, because both inputs are per display: which theme
   * it holds, and the answers it gave for that theme. Nothing is held between
   * ticks — a consumer who reassigns a device is served it on that display's
   * next sample.
   */
  async function currentAssignment(display: string): Promise<DeviceAssignment> {
    const stored =
      devices === undefined ? EMPTY_DEVICE_SETTINGS : await devices.read();

    // The theme this display holds, else the default's — the same fallback
    // `assignedThemeFor` makes, and what keeps a theme chosen through
    // `/api/themes/active` (which still writes `default`, ruling 38) applying
    // to a display that holds none of its own (ruling 44).
    const chosen =
      activeTheme === undefined
        ? undefined
        : ((await activeTheme.read(display, async () => true)) ??
          (display === DEFAULT_DISPLAY
            ? undefined
            : await activeTheme.read(DEFAULT_DISPLAY, async () => true)));
    // Global answers describe this PC; a theme may override one for itself.
    // Only where a theme differs is an answer stored, so a consumer who set the
    // system disk once is not asked again by every theme that reads a disk.
    const perTheme =
      chosen === undefined || themeSettings === undefined
        ? {}
        : await themeSettings.read(display, chosen);
    // The default's answers stand in where the display gave none of its own, for
    // the reason its theme does: the settings page still writes them under
    // `default`, and a theme answer set there is an answer for every display
    // showing that theme (ruling 44).
    const shared =
      chosen === undefined ||
      themeSettings === undefined ||
      display === DEFAULT_DISPLAY
        ? {}
        : await themeSettings.read(DEFAULT_DISPLAY, chosen);

    // The group is the settings module's `AssignableGroup`, not a union
    // re-spelled here: the owner is `ASSIGNABLE_GROUPS` (`settings/devices.ts`),
    // and a fourth group added there must reach this path rather than needing a
    // second edit nobody would make (vg-189).
    const pick = (group: AssignableGroup): string | undefined =>
      perTheme[group] ?? shared[group] ?? stored.assigned[group];

    const gpu = pick("gpu");
    const systemDisk = pick("system-disk");
    const dataDisk = pick("data-disk");

    return {
      ...(gpu === undefined ? {} : { gpu }),
      ...(systemDisk === undefined ? {} : { systemDisk }),
      ...(dataDisk === undefined ? {} : { dataDisk }),
      // The consumer's chosen names ride with the choice, so a rename reaches
      // the caption and the readings it names in the same publish.
      names: stored.names,
    };
  }

  /**
   * The devices a consumer can choose between, discovered from the providers
   * rather than guessed at. An unconfigured machine returns empty groups, which
   * the settings UI reports as "only one device found" rather than as an error.
   */
  async function availableDevices(): Promise<{
    readonly gpus: readonly { readonly id: string; readonly name: string }[];
    readonly disks: readonly { readonly id: string; readonly name: string }[];
  }> {
    const describe_devices = options.describeDevices;

    if (describe_devices === undefined) {
      return { gpus: [], disks: [] };
    }

    try {
      return await describe_devices();
    } catch {
      // A provider that cannot answer leaves the lists empty, never fails the page.
      return { gpus: [], disks: [] };
    }
  }

  /** Loopback is trusted admin; anything else must present a live credential. */
  async function allowed(
    request: http.IncomingMessage,
    url: URL,
  ): Promise<boolean> {
    if (isLoopbackRemote(request.socket.remoteAddress)) {
      return true;
    }

    return (await displayFor(request, url, displays)) !== undefined;
  }

  /**
   * The stored theme, with a document that exists but cannot be served —
   * one that does not validate, and one past the size bound — answered as the
   * same absence one that is not there is. Every read that is not the open route
   * wants this: a display, an asset lookup, the active-theme resolution and
   * every existence check can serve neither, and a corrupt or oversized theme
   * must not turn a listing or a page into a 500. The open route reads the
   * store directly so it can tell the three apart (decisions/0043, 0084).
   */
  async function readThemeOrAbsent(id: string): Promise<ThemeRecord> {
    try {
      return await themeStore.read(id);
    } catch (error) {
      if (
        error instanceof ThemeValidationError ||
        error instanceof ThemeTooLargeError
      ) {
        return undefined;
      }
      throw error;
    }
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
  async function assignedThemeFor(
    display: string,
    exists: (id: string) => Promise<boolean>,
  ): Promise<string | undefined> {
    if (activeTheme === undefined) {
      return undefined;
    }

    const own = await activeTheme.read(display, exists);

    return (
      own ??
      (display === DEFAULT_DISPLAY
        ? undefined
        : await activeTheme.read(DEFAULT_DISPLAY, exists))
    );
  }

  /**
   * The map `/api/themes/active` reads and writes: every display with the theme
   * it holds, and the default a display with no entry of its own falls to.
   *
   * This PC is always present and always first, because it is the display the
   * person reading the page is looking at. A stored record with that id is not
   * possible — the store refuses to mint it — so it is added rather than found.
   */
  async function activeThemeMap(
    store: ActiveThemeStore,
    available: readonly { readonly id: string }[],
  ): Promise<{
    readonly default: string | null;
    readonly displays: readonly ActiveDisplay[];
  }> {
    const holds = await store.readAll(async (id) =>
      available.some((entry) => entry.id === id),
    );
    const records = (await displays?.list()) ?? [];

    return {
      default: holds[DEFAULT_DISPLAY] ?? null,
      displays: [
        {
          id: LOCAL_DISPLAY_ID,
          label: LOCAL_DISPLAY_LABEL,
          kind: "local",
          theme: holds[LOCAL_DISPLAY_ID] ?? null,
        },
        ...records.map((record) => ({
          id: record.id,
          label: record.label,
          kind: record.kind,
          theme: holds[record.id] ?? null,
        })),
      ],
    };
  }

  /**
   * The one place a request becomes a response, and the one place a rejected
   * handler is stopped.
   *
   * **A rejection here would be an uncaught exception**, and Node ends the
   * process on one: every refusal a store can make — a file it could not read, a
   * label it would not mint — would take the listener down with it and leave the
   * host gone until someone started it again. So the response is answered
   * instead, with the reason kept out of the body: it names this machine's own
   * files, and this route answers LAN callers too. Both servers share this
   * wrapper, so neither can reach the process.
   */
  const route = (
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): void => {
    handle(request, response).catch(() => {
      // A response already on the wire cannot be replaced; ending the connection
      // is all that is left.
      if (response.headersSent || response.writableEnded) {
        response.destroy();
        return;
      }

      sendText(response, 500, "The host could not answer that request.");
    });
  };

  const plain = http.createServer(route);
  const secure =
    options.tls === undefined
      ? undefined
      : https.createServer(options.tls, route);

  // One port, and both protocols when a certificate is present. The launcher
  // always brings one (0070); the unit suite does not, and a route answers the
  // same either way.
  const server: ListenableServer =
    secure === undefined ? plain : createPortListener(plain, secure);

  async function handle(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", "http://host.invalid");

    // Before every gate below, and before pairing in particular: a device
    // reading this is being asked to trust the host, which is the step that has
    // to come first.
    if (url.pathname === CA_CERTIFICATE_PATH && request.method === "GET") {
      if (caCertificate === undefined) {
        sendText(response, 404, "This host serves no certificate of its own.");
        return;
      }

      sendCertificate(response, caCertificate);
      return;
    }

    // The page a device with no credential opens, so it answers before every
    // gate below. It is served from the admin root the settings page shares —
    // source, not a bundle — and it carries no reading of its own: the code it
    // was opened with is what pairs the device, and the exchange is its only
    // call.
    if (url.pathname === "/pair" && request.method === "GET") {
      if (bundles.admin === undefined) {
        sendText(
          response,
          404,
          "The pairing page is missing from this installation.",
        );
        return;
      }

      await serveStatic(
        response,
        bundles.admin,
        "/pair.html",
        "The pairing page is missing from this installation.",
      );
      return;
    }

    // The store session: signing in, coming back, reading the state and
    // signing out. In a module of its own, because this file is already past
    // the size a reader can hold.
    const answered = await handleCatalogueRoutes(request, url, {
      origin: storeOrigin,
      sessionStore: storeSession,
      fetch: options.fetch ?? fetch,
      states: storeSignInStates,
    });
    if (answered !== undefined) {
      await writeWebResponse(response, answered);
      return;
    }

    // **The one route an unpaired client may read**, and the reason a display
    // that has lost its host's address can find it again: a re-find sweep asks
    // every host on the network who it is and keeps the one whose id it stored.
    // So it answers before every gate below — the display guard in particular —
    // and its body is fixed by that promise: the identity, the port, and nothing
    // else this host holds. The name is one character from `/api/hosting`, the
    // LAN on/off setting, deliberately and not by accident (R24). A host with no
    // identity is not registered at all, for the reason the `host` option gives.
    if (
      hostRecord !== undefined &&
      url.pathname === "/api/host" &&
      request.method === "GET"
    ) {
      // **Cross-origin, and this route alone.** A sweep reaches hosts by their
      // LAN addresses, so every one of those reads is cross-origin and a browser
      // refuses it without this header. It is set on this response rather than in
      // `sendJson` on purpose: a shared writer that could turn CORS on is one
      // edit away from making every route in this file cross-origin readable,
      // and this route is meant to be the single deliberate exception (R25).
      // No `Access-Control-Allow-Credentials`: a sweep sends no credential, and
      // a wildcard origin with credentials is refused by browsers anyway.
      response.setHeader("Access-Control-Allow-Origin", "*");

      // The port comes from the socket, never from an option or the binding: a
      // host that fell back to the next port must answer the port a display
      // actually has to dial. Null for a server that is not listening, the same
      // honest absence `/api/hosting` reports.
      const address = server.address();

      sendJson(response, 200, {
        id: hostRecord.id,
        name: hostRecord.name,
        port:
          typeof address === "object" && address !== null ? address.port : null,
      });
      return;
    }

    // Pairing is an admin action: it mints display credentials, so it stays
    // loopback-only even when the server is LAN-reachable.
    if (url.pathname.startsWith("/api/pairing")) {
      // The one exception, and the reason a camera-less display can pair at
      // all: the claim exchanges a code for a credential, so it is reached by a
      // device that has no credential, and it answers before the gate the rest
      // of this block is behind.
      if (url.pathname === "/api/pairing/claim" && request.method === "POST") {
        if (displays === undefined) {
          sendText(response, 404, "Pairing is not enabled on this host.");
          return;
        }

        let asked: { readonly code?: unknown; readonly label?: unknown };

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
          };
        } catch (error) {
          sendText(
            response,
            400,
            error instanceof Error ? error.message : String(error),
          );
          return;
        }

        if (typeof asked.code !== "string") {
          sendText(response, 400, "A pairing code is required.");
          return;
        }

        if (typeof asked.label !== "string") {
          sendText(response, 400, "A display name is required.");
          return;
        }

        // The store's own label→id rule, asked **before** the code is claimed:
        // a name it would refuse is the caller's to fix, and claiming first
        // would spend the window on a name nobody could have used.
        try {
          mintedDisplayId(asked.label);
        } catch (error) {
          sendText(
            response,
            400,
            error instanceof Error ? error.message : String(error),
          );
          return;
        }

        const claimed = await pairingCodes.claim(
          asked.code,
          request.socket.remoteAddress ?? "unknown",
        );

        if (!claimed) {
          sendText(response, 404, NO_PAIRING_CODE);
          return;
        }

        // A durable credential (ruling 12): the code is the only short-lived
        // secret in this exchange, and what it buys lasts until the owner
        // removes the client by name.
        const token = newToken();
        const display = await displays.create(asked.label, token);
        sendJson(response, 200, { displayId: display.id, token });
        return;
      }

      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(response, 403, "Pairing is available on this PC only.");
        return;
      }

      if (displays === undefined) {
        sendText(response, 404, "Pairing is not enabled on this host.");
        return;
      }

      // A read, not a rotation: a second read of a live window answers the same
      // code rather than minting another, so nothing can move the code out from
      // under whoever is typing it (R16). Only an absent or expired window
      // mints one.
      if (url.pathname === "/api/pairing/code" && request.method === "GET") {
        const live = pairingCodes.current() ?? pairingCodes.mint();
        sendJson(response, 200, { code: live.code, expiresAt: live.expiresAt });
        return;
      }

      if (
        url.pathname === "/api/pairing/sessions" &&
        request.method === "GET"
      ) {
        const known = await displays.list();
        sendJson(response, 200, { displays: known.map(peerOf) });
        return;
      }

      if (
        url.pathname === "/api/pairing/sessions" &&
        request.method === "POST"
      ) {
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
            return;
          }

          sendJson(response, 201, { display: peerOf(rotated), token });
          return;
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
          return;
        }

        const display = await displays.create(label, token);
        sendJson(response, 201, { display: peerOf(display), token });
        return;
      }

      sendText(response, 405, "Only GET and POST are supported.");
      return;
    }

    // A display's own record, addressed by the id a rename never moves. Removing
    // one takes its credential with it — revoking *is* removing (ruling 12) —
    // which is why there is no second route that revokes.
    if (url.pathname.startsWith("/api/displays")) {
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(response, 403, "Displays are available on this PC only.");
        return;
      }

      if (displays === undefined) {
        sendText(
          response,
          404,
          "Display management is not enabled on this host.",
        );
        return;
      }

      // Before the id below, because neither is a reserved id: a display named
      // "Monitors" or "Autostart" legitimately mints one (`mintedDisplayId`), so
      // these routes have to be found before anything reads the segment as an id.
      if (
        url.pathname === "/api/displays/monitors" &&
        request.method === "GET"
      ) {
        sendJson(response, 200, { monitors: await monitors() });
        return;
      }

      // The host, not a monitor: one entry at sign-in covers every local display
      // including one added later. The answer is the registrar's own message,
      // because that is what the surface has to show.
      if (
        url.pathname === "/api/displays/autostart" &&
        request.method === "POST"
      ) {
        const register = options.registerAutostart;

        if (register === undefined) {
          sendText(
            response,
            404,
            "This host cannot register itself to start at sign-in.",
          );
          return;
        }

        // A registration the OS refused is not a bad request: the outcome
        // travels with its own message either way.
        sendJson(response, 200, await register());
        return;
      }

      // A local monitor: the host's own screen, so it is specified rather than
      // paired and has no credential to answer with.
      if (url.pathname === "/api/displays" && request.method === "POST") {
        let body: { readonly label: string; readonly monitor: unknown };

        try {
          const parsed: unknown = JSON.parse(await readBody(request));
          if (
            typeof parsed !== "object" ||
            parsed === null ||
            Array.isArray(parsed)
          ) {
            throw new Error("That is not a display setting.");
          }
          body = parsed as {
            readonly label: string;
            readonly monitor: unknown;
          };
        } catch (error) {
          sendText(
            response,
            400,
            error instanceof Error ? error.message : String(error),
          );
          return;
        }

        // The hint's own rule, from the store that has to read it back: a record
        // the file would drop on the next read must not be written at all.
        const monitor = normalizeMonitor(body.monitor);

        if (monitor === undefined) {
          sendText(
            response,
            400,
            "A local display needs the monitor it is on.",
          );
          return;
        }

        let display: DisplayRecord;

        try {
          display = await displays.createLocal(body.label, monitor);
        } catch (error) {
          // A monitor a local display already holds is the request conflicting
          // with what this host holds, not a body the store would not read —
          // and it is a conflict rather than a success, because two records for
          // one screen would put two windows on it.
          sendText(
            response,
            error instanceof MonitorAlreadyHeldError ? 409 : 400,
            error instanceof Error ? error.message : String(error),
          );
          return;
        }

        // The window is the host's own, so it opens one now: a display the owner
        // just added is the one case `lastSeenAt` cannot speak for.
        await options.launcher?.reconcile();

        sendJson(response, 201, { display: peerOf(display) });
        return;
      }

      const match = url.pathname.match(/^\/api\/displays\/([^/]+)$/);
      const id =
        match === null ? undefined : decodeURIComponent(match[1] ?? "");

      if (id !== undefined && request.method === "PATCH") {
        let patch: DisplayPatch;

        try {
          const parsed: unknown = JSON.parse(await readBody(request));
          // A body that is not an object holds no patch, and reading a field
          // off one would be a TypeError rather than a refusal.
          if (
            typeof parsed !== "object" ||
            parsed === null ||
            Array.isArray(parsed)
          ) {
            throw new Error("That is not a display setting.");
          }
          patch = parsed as DisplayPatch;
        } catch (error) {
          sendText(
            response,
            400,
            error instanceof Error ? error.message : String(error),
          );
          return;
        }

        // The store's own rules, asked once for both fields: a patch it would
        // refuse is a 400 — the caller's typo, not a host fault, which is what
        // the wrapper's 500 would say — and a refused handler is an uncaught
        // exception in Node. The label rule is `normalizeLabel` and not the id
        // rule: the id was minted when the display was created, a rename mints
        // no other one, and a name the id rule would refuse is still a name.
        try {
          patch = normalizePatch(patch);
        } catch (error) {
          sendText(
            response,
            400,
            error instanceof Error ? error.message : String(error),
          );
          return;
        }

        const updated = await displays.update(id, patch);

        if (updated === undefined) {
          sendText(response, 404, "No such display.");
          return;
        }

        // The answer is the record itself, so a surface redraws one row without
        // refetching the list it already has.
        sendJson(response, 200, peerOf(updated));
        return;
      }

      if (id !== undefined && request.method === "DELETE") {
        // This PC is the display the host *is*, not a client anyone paired: it
        // has no credential to remove, and it is the one display that cannot be
        // re-paired if it goes.
        if (id === LOCAL_DISPLAY_ID) {
          sendText(response, 409, "This PC is not a paired client.");
          return;
        }

        if (!(await displays.remove(id))) {
          sendText(response, 404, "No such display.");
          return;
        }

        // The answers and the theme the display gave go with it: an id is minted
        // again by the next display of that name, and it must not inherit a
        // device or a theme its predecessor chose. Nothing is swept when a store
        // is absent, because nothing was ever written to it.
        await themeSettings?.removeDisplay(id);
        await activeTheme?.clear(id);

        // The window goes with the record, and only a window this host opened
        // is the host's to close.
        options.launcher?.close(id);

        sendJson(response, 200, { ok: true });
        return;
      }

      // Named by the path it answered rather than by the block: a caller told
      // that GET is supported on a path without it is told nothing true.
      const supported =
        url.pathname === "/api/displays/monitors"
          ? "GET"
          : url.pathname === "/api/displays/autostart"
            ? "POST"
            : url.pathname === "/api/displays"
              ? "POST"
              : id === undefined
                ? undefined
                : "PATCH and DELETE";

      if (supported !== undefined) {
        sendText(response, 405, `This path supports ${supported}.`);
        return;
      }

      // A path that is no route of its own — `/api/displays/` or
      // `/api/displays/a/b` — has no method set to state: both routes that need
      // an id need one this path does not carry. It falls through to the answer
      // every unknown path gets rather than asserting methods for it.
    }

    if (url.pathname === SAMPLE_STREAM_PATH) {
      if (!(await allowed(request, url))) {
        sendText(response, 403, "This display is not paired with the host.");
        return;
      }
      await openStream(request, response, url);
      return;
    }

    // Device assignments are an admin action, like pairing: they change what
    // every display shows, so they stay loopback-only.
    if (url.pathname.startsWith("/api/devices")) {
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(
          response,
          403,
          "Device settings are available on this PC only.",
        );
        return;
      }

      if (devices === undefined) {
        sendText(
          response,
          404,
          "Device settings are not enabled on this host.",
        );
        return;
      }

      if (url.pathname === "/api/devices" && request.method === "GET") {
        sendJson(response, 200, {
          available: await availableDevices(),
          assigned: await devices.read(),
        });
        return;
      }

      if (url.pathname === "/api/devices" && request.method === "PUT") {
        try {
          const body = JSON.parse(await readBody(request)) as unknown;
          const saved = await devices.write(body);
          sendJson(response, 200, { ok: true, assigned: saved });
        } catch (error: unknown) {
          sendText(
            response,
            400,
            error instanceof Error ? error.message : String(error),
          );
        }
        return;
      }

      sendText(response, 405, "Only GET and PUT are supported.");
      return;
    }

    // Display preferences are a machine fact, like device assignments, and they
    // stay out of a theme. Changing them is this PC's business; reading them is
    // a display's, which must obey the measurement preference a phone cannot
    // otherwise learn.
    if (url.pathname === "/api/display") {
      if (display === undefined) {
        sendText(
          response,
          404,
          "Display settings are not enabled on this host.",
        );
        return;
      }

      if (request.method === "GET") {
        if (
          !isLoopbackRemote(request.socket.remoteAddress) &&
          !(await allowed(request, url))
        ) {
          sendText(response, 403, "This display is not paired with the host.");
          return;
        }

        // The zones travel with the setting: the page is dependency-free source
        // and cannot resolve them any other way.
        sendJson(response, 200, {
          settings: await display.read(),
          zones: knownTimeZones(),
        });
        return;
      }

      if (request.method === "PUT") {
        if (!isLoopbackRemote(request.socket.remoteAddress)) {
          sendText(
            response,
            403,
            "Display settings are available on this PC only.",
          );
          return;
        }

        try {
          const body = JSON.parse(await readBody(request)) as unknown;
          const saved = await display.write(body);
          options.onDisplayChange?.(saved);
          sendJson(response, 200, { ok: true, settings: saved });
        } catch (error: unknown) {
          sendText(
            response,
            400,
            error instanceof Error ? error.message : String(error),
          );
        }
        return;
      }

      sendText(response, 405, "Only GET and PUT are supported.");
      return;
    }

    // One number, so a display can tell whether what it is showing is still
    // what the author is publishing — and the theme it was assigned, so an
    // assignment made at the host reaches a display nobody walks to. A display
    // read, so it is behind the same guard: what this PC is holding is not
    // something the network enumerates.
    if (url.pathname === "/api/published") {
      if (
        !isLoopbackRemote(request.socket.remoteAddress) &&
        !(await allowed(request, url))
      ) {
        sendText(response, 403, "This display is not paired with the host.");
        return;
      }

      const live = published.read();
      const display = await displayKeyFor(request, url, displays);
      // The player reads its refresh rate from this poll rather than from a
      // route of its own: it is the request a display already makes.
      const chartFps = await chartFpsForDisplay(display, displays);
      let theme: string | null = null;

      // A request that named a theme is on a link, and the link is the person's
      // own instruction for that page: an assignment must not move it, so the
      // host answers none rather than one the follower would act on — and pays
      // no listing for an answer it discards.
      if (!url.searchParams.has("theme")) {
        const available = await themeStore.list();

        theme =
          (await assignedThemeFor(display, async (id) =>
            available.some((entry) => entry.id === id),
          )) ?? null;
      }

      sendJson(response, 200, {
        id: live?.id ?? null,
        revision: published.revision(),
        display: { id: display, theme, chartFps },
      });
      return;
    }

    // Which curated trios this author reaches for. Author state about this PC,
    // beside the display preferences and out of every theme package; the same
    // asymmetry as `/api/display`, so a paired display may read what this PC
    // holds and only this PC may change it.
    if (url.pathname === "/api/font-favorites") {
      if (fontFavorites === undefined) {
        sendText(
          response,
          404,
          "Font favourites are not enabled on this host.",
        );
        return;
      }

      if (request.method === "GET") {
        if (
          !isLoopbackRemote(request.socket.remoteAddress) &&
          !(await allowed(request, url))
        ) {
          sendText(response, 403, "This display is not paired with the host.");
          return;
        }

        sendJson(response, 200, { favorites: await fontFavorites.read() });
        return;
      }

      if (request.method === "PUT") {
        if (!isLoopbackRemote(request.socket.remoteAddress)) {
          sendText(
            response,
            403,
            "Font favourites are available on this PC only.",
          );
          return;
        }

        try {
          const body = JSON.parse(await readBody(request)) as unknown;
          // The answer is what the editor repaints from, so it carries the
          // stored list rather than an echo of what was sent.
          const favorites = await fontFavorites.write(body);
          sendJson(response, 200, { favorites });
        } catch (error: unknown) {
          sendText(
            response,
            400,
            error instanceof Error ? error.message : String(error),
          );
        }
        return;
      }

      sendText(response, 405, "Only GET and PUT are supported.");
      return;
    }

    // Provider credentials. The value is write-only from the browser: the read
    // answers `set` and a four-character hint, never the value, and every method
    // stays on this PC because this file is the one secret the host holds.
    if (
      url.pathname === "/api/credentials" ||
      url.pathname.startsWith("/api/credentials/")
    ) {
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(response, 403, "Credentials are available on this PC only.");
        return;
      }

      if (isForeignOrigin(request)) {
        sendText(
          response,
          403,
          "Credentials are not available to another page.",
        );
        return;
      }

      if (credentials === undefined) {
        sendText(response, 503, "Credentials are not enabled on this host.");
        return;
      }

      if (url.pathname === "/api/credentials") {
        if (request.method !== "GET") {
          sendText(response, 405, "Only GET is supported.");
          return;
        }

        const rows: CredentialRow[] = [];
        for (const known of knownCredentials) {
          const value = await credentials.valueOf(known.id);
          rows.push({
            id: known.id,
            label: known.label,
            set: value !== undefined,
            hint: value === undefined ? "" : hintOf(value),
            verify: known.verify !== undefined,
            helpText: known.help?.text ?? null,
            helpUrl: known.help?.url ?? null,
          });
        }

        sendJson(response, 200, rows);
        return;
      }

      const parts = url.pathname.slice("/api/credentials/".length).split("/");
      const known = knownCredentials.find((entry) => entry.id === parts[0]);

      if (known === undefined) {
        sendText(response, 400, "That credential is not one this host knows.");
        return;
      }

      if (parts.length === 2 && parts[1] === "verify") {
        if (request.method !== "POST") {
          sendText(response, 405, "Only POST is supported.");
          return;
        }

        if (known.verify === undefined) {
          sendText(
            response,
            400,
            `The ${known.label} credential has no check.`,
          );
          return;
        }

        const value = await credentials.valueOf(known.id);
        if (value === undefined) {
          sendJson(response, 200, {
            ok: false,
            message: `${known.label} is not set.`,
          });
          return;
        }

        sendJson(response, 200, await known.verify(value, fetcher ?? fetch));
        return;
      }

      if (parts.length !== 1) {
        sendText(response, 404, "No such credential route.");
        return;
      }

      if (request.method === "PUT") {
        if (known.kind === "cookie") {
          sendText(
            response,
            400,
            "Only bearer credentials are supported (R10).",
          );
          return;
        }

        let value: unknown;
        try {
          value = (JSON.parse(await readBody(request)) as { value?: unknown })
            .value;
        } catch {
          sendText(response, 400, "That request body is not JSON.");
          return;
        }

        if (typeof value !== "string" || value === "") {
          sendText(response, 400, "A credential value is required.");
          return;
        }

        await credentials.write(known.id, value, new Date(now()));
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "DELETE") {
        await credentials.clear(known.id);
        sendJson(response, 200, { ok: true });
        return;
      }

      sendText(response, 405, "Only PUT and DELETE are supported.");
      return;
    }

    // The asset finder's three routes. Mounted whenever the path names one, so
    // a host that serves no source answers 503 rather than the static 404.
    if (
      url.pathname === "/api/assets/sources" ||
      url.pathname === "/api/assets/search" ||
      url.pathname === "/api/assets/bytes"
    ) {
      await handleAssetRoutes({
        request,
        response,
        url,
        loopback: isLoopbackRemote(request.socket.remoteAddress),
        foreignOrigin: isForeignOrigin(request),
        assets,
        fetch: fetcher ?? fetch,
        readBody,
      });
      return;
    }

    if (url.pathname === "/api/health") {
      sendJson(response, 200, {
        displays: connections.size,
        polling: unionOfKeys(
          [...connections].map((connection) => connection.semanticKeys),
        ),
        unmapped: lastUnmapped,
        pairing: displays !== undefined,
      });
      return;
    }

    // Where the phone should go, and the displays this PC has paired, so the
    // editor header can show the address and who is on it. Admin, like the
    // other settings: it names this machine's address and who is paired.
    // Credentials never leave — neither the token nor the hash it is stored as.
    if (url.pathname === "/api/hosting") {
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(
          response,
          403,
          "Hosting settings are available on this PC only.",
        );
        return;
      }

      const binding = options.hosting;

      if (request.method === "PUT") {
        if (binding === undefined) {
          sendText(response, 409, "This host cannot move its binding.");
          return;
        }

        let body: { readonly lan?: unknown };
        try {
          body = JSON.parse(await readBody(request)) as {
            readonly lan?: unknown;
          };
        } catch {
          sendText(response, 400, "That is not a hosting setting.");
          return;
        }

        if (typeof body.lan !== "boolean") {
          sendText(response, 400, "Hosting is on or off, and nothing else.");
          return;
        }

        const wanted = body.lan;

        // **The answer goes first, and it is not the outcome of the move.** One
        // server cannot rebind while the response that asked it to rebind is
        // still on its socket: `close()` waits for that connection, and that
        // connection waits for this response. So the move starts on `finish` —
        // the bytes are with the OS, not merely queued — and an asker that
        // wants to know where it landed reads the GET that follows (vg-173).
        response.once("finish", () => {
          // Displays are holding streams open, and the move destroys every
          // connection left — this one included. The host is what tracks those
          // streams, so the host is what ends them deliberately rather than
          // leaving them to go with the rest (`vg-174`). **Whether that end
          // reaches the display is not established**: `SseConnection.close()`
          // is `response.end()`, and the move destroys the socket just after
          // it.
          for (const connection of connections) {
            connection.close();
          }

          connections.clear();

          void moveLan(wanted).catch(() => {
            // A refusal is reported through `refusal`, never as a rejection.
          });
        });

        // The same redaction the GET makes, for the same reason: a
        // `DisplayRecord` carries `tokenHash`, and this route answers about
        // hosting, not about credentials.
        sendJson(response, 200, {
          ...(await binding.state()),
          sessions: ((await displays?.list()) ?? []).map(peerOf),
        });
        return;
      }

      if (request.method !== "GET") {
        sendText(response, 405, "Only GET and PUT are supported.");
        return;
      }

      // A reader that follows a move sees where it landed rather than where it
      // started: the move runs after the PUT's answer, so it can still be in
      // flight here.
      await binding?.idle();

      sendJson(response, 200, {
        ...((await binding?.state()) ?? NO_HOSTING),
        sessions: ((await displays?.list()) ?? []).map(peerOf),
      });
      return;
    }

    // **The bundle is not dashboard content**, and it comes before this guard
    // because a credential cannot reach it. A credential rides in the query
    // string — `fetch` and `EventSource` carry one and `<script src>` cannot — so
    // a paired phone was served the document and then refused its own scripts
    // with a blank page. The bundle is the same bytes any loopback visitor
    // already has: no reading, no theme, no device in it. Everything this guard
    // exists to protect stays behind it — `/api/themes/**`, the sample stream,
    // `/api/display` — and `/editor` keeps its own loopback guard.
    // See `docs/decisions/0019`.
    const isBundleAsset =
      url.pathname.startsWith("/assets/") ||
      // The browser probes this unprompted and without a token, and the repo
      // already links the mark deliberately so it does not.
      url.pathname === "/favicon.svg" ||
      // The two files an installable display needs, and the browser fetches
      // both itself: `register()` carries no session and a `<link
      // rel="manifest">` fetch carries none either, so a paired phone was
      // refused the manifest and the worker script and the player would not
      // install. Same rule as the assets beside them — bundle bytes, no
      // reading, no theme, no device (docs/decisions/0019, 0071).
      url.pathname === "/manifest.webmanifest" ||
      url.pathname === "/sw.js";

    // Display reads stay open on loopback; from the LAN they need a session so
    // dashboard content is not served to every device on the network.
    if (
      !isBundleAsset &&
      !isLoopbackRemote(request.socket.remoteAddress) &&
      !(await allowed(request, url))
    ) {
      sendText(response, 403, "This display is not paired with the host.");
      return;
    }

    if (url.pathname === "/api/themes") {
      if (request.method !== "GET") {
        sendText(response, 405, "Only GET is supported.");
        return;
      }
      // Templates travel beside the stored themes and are kept out of them: a
      // template has no file, so counting it among the author's own would be
      // counting something the PC does not have.
      //
      // The origins are joined *onto the listed entries*, never the other way
      // round: an entry for a theme the library no longer holds must reach no
      // response, and running the join from the listing is what guarantees that
      // rather than pruning afterwards.
      const themes = await themeStore.list();
      const origins =
        themeOrigins === undefined ? {} : await themeOrigins.read();

      sendJson(response, 200, {
        themes: themes.map((entry) => {
          // `Object.hasOwn`, not a bare read: `__proto__` is a legal theme id,
          // and `origins["__proto__"]` answers `Object.prototype` for a theme
          // that has no origin at all.
          const origin = Object.hasOwn(origins, entry.id)
            ? origins[entry.id]
            : undefined;
          // Absence is the truth, the same way `author` is absent for a theme
          // that declares none — not a key holding undefined.
          return { ...entry, ...(origin === undefined ? {} : { origin }) };
        }),
        templates: SHIPPED_TEMPLATES,
      });
      return;
    }

    // The Wallpaper Engine library this PC holds, and one item's bytes. The
    // browser names an item by its `workshopId`; every path stays in the host
    // (docs/decisions/0097).
    if (url.pathname === "/api/wallpaper-engine") {
      if (request.method !== "GET") {
        sendText(response, 405, "Only GET is supported.");
        return;
      }

      sendJson(
        response,
        200,
        wallpaperEngine === undefined
          ? { available: false, reason: "not-installed" }
          : await wallpaperEngine.listing(),
      );
      return;
    }

    const wallpaperEngineMatch = url.pathname.match(
      /^\/api\/wallpaper-engine\/item\/([^/]+)\/(preview|asset)$/,
    );
    if (wallpaperEngineMatch) {
      if (request.method !== "GET") {
        sendText(response, 405, "Only GET is supported.");
        return;
      }

      let workshopId: string;
      try {
        workshopId = decodeURIComponent(wallpaperEngineMatch[1] ?? "");
      } catch {
        // Malformed percent-encoding names no item, so it is the same answer
        // as any other id the library does not hold.
        sendText(response, 404, "No such wallpaper.");
        return;
      }
      const part = wallpaperEngineMatch[2] === "preview" ? "preview" : "asset";
      const bytes =
        wallpaperEngine === undefined
          ? undefined
          : await wallpaperEngine.bytesOf(workshopId, part);

      if (bytes === undefined) {
        sendText(response, 404, "No such wallpaper.");
        return;
      }

      response.writeHead(200, {
        "content-type": bytes.contentType,
        "cache-control": "no-store",
      });
      response.end(bytes.bytes);
      return;
    }

    // The one write in this surface (R8): unpack the item and start the editor
    // on it. The item id is the whole request — there is no body — so the
    // selection itself is the trigger.
    const wallpaperEngineProject = url.pathname.match(
      /^\/api\/wallpaper-engine\/item\/([^/]+)\/project$/,
    );
    if (wallpaperEngineProject) {
      if (request.method !== "POST") {
        sendText(response, 405, "Only POST is supported.");
        return;
      }

      // Creating a directory and launching a program is admin work, and a page
      // in another origin can reach a loopback route without a credential.
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(response, 403, "Unpacking is available on this PC only.");
        return;
      }
      if (isForeignOrigin(request)) {
        sendText(response, 403, "Unpacking is not available to another page.");
        return;
      }

      let workshopId: string;
      try {
        workshopId = decodeURIComponent(wallpaperEngineProject[1] ?? "");
      } catch {
        sendText(response, 404, "No such wallpaper.");
        return;
      }

      sendJson(
        response,
        200,
        wallpaperEngine === undefined
          ? { ok: false, reason: "no-install" }
          : await wallpaperEngine.project(workshopId),
      );
      return;
    }

    // The files the export step watches, never a walk of the profile.
    if (url.pathname === "/api/wallpaper-engine/exports") {
      if (request.method !== "GET") {
        sendText(response, 405, "Only GET is supported.");
        return;
      }

      const asked = url.searchParams.get("since");
      // A missing or non-integer `since` would offer every old media file on
      // the machine, so absence is refused rather than read as the epoch.
      const since =
        asked !== null && /^[0-9]+$/.test(asked) ? Number(asked) : undefined;

      if (since === undefined || !Number.isSafeInteger(since)) {
        sendText(
          response,
          400,
          "since must be an integer epoch in milliseconds.",
        );
        return;
      }

      sendJson(response, 200, {
        files:
          wallpaperEngine === undefined
            ? []
            : await wallpaperEngine.exportsSince(since),
      });
      return;
    }

    if (url.pathname === "/api/wallpaper-engine/export") {
      if (request.method !== "GET") {
        sendText(response, 405, "Only GET is supported.");
        return;
      }

      const name = url.searchParams.get("name");
      const bytes =
        name === null || wallpaperEngine === undefined
          ? undefined
          : await wallpaperEngine.exportBytes(name);

      if (bytes === undefined) {
        sendText(response, 404, "No such export.");
        return;
      }

      response.writeHead(200, {
        "content-type": bytes.contentType,
        "cache-control": "no-store",
      });
      response.end(bytes.bytes);
      return;
    }

    // Which theme each display shows: one map, read by the host's pages and
    // written one entry at a time.
    //
    // **The read is this PC's and the write is not**, because they are different
    // acts: reading every display's theme is the admin view, while a display
    // choosing a theme for itself is the consumer action this route also serves.
    // The write's authority is derived from the caller and never claimed in the
    // body — loopback names a display because loopback is trusted admin, and a
    // paired session's key is its own authenticated record's id.
    if (url.pathname === "/api/themes/active") {
      if (activeTheme === undefined) {
        sendText(response, 404, "This host keeps no active theme.");
        return;
      }

      const loopback = isLoopbackRemote(request.socket.remoteAddress);

      if (request.method === "GET") {
        if (!loopback) {
          sendText(response, 403, "Settings are available on this PC only.");
          return;
        }

        const available = await themeStore.list();
        sendJson(response, 200, {
          ...(await activeThemeMap(activeTheme, available)),
          themes: available,
          templates: SHIPPED_TEMPLATES,
        });
        return;
      }

      if (request.method === "PUT") {
        let body: { readonly display?: unknown; readonly id?: unknown };

        try {
          const parsed: unknown = JSON.parse(await readBody(request));
          // A body that is not an object holds no choice, and reading a field
          // off one would be a TypeError rather than a refusal.
          if (
            typeof parsed !== "object" ||
            parsed === null ||
            Array.isArray(parsed)
          ) {
            throw new Error("That is not a theme choice.");
          }
          body = parsed as {
            readonly display?: unknown;
            readonly id?: unknown;
          };
        } catch (error) {
          sendText(
            response,
            400,
            error instanceof Error ? error.message : String(error),
          );
          return;
        }

        const id = body.id;

        if (typeof id !== "string") {
          sendText(response, 400, "An id is required.");
          return;
        }

        // The key this write reaches. A paired session names no display: its own
        // record is the one it may write, so a `display` in the body is ignored
        // rather than refused — a client sending both gets the safe answer
        // instead of a distinction it could probe. `default` and `this-pc` are
        // unreachable from a session by construction, not by a check: the key is
        // the request's own id, and the store refuses to mint either word.
        let key: string;

        if (loopback) {
          const named = body.display;

          if (typeof named !== "string") {
            sendText(response, 400, "A display is required.");
            return;
          }

          key = named;
        } else {
          const record = await displayFor(request, url, displays);

          if (record === undefined) {
            sendText(
              response,
              403,
              "This display is not paired with the host.",
            );
            return;
          }

          key = record.id;
        }

        // Only a display this host holds can be given a theme, so a typo is a
        // 404 rather than a new key in the file that no display would read.
        if (loopback && !(await knownDisplayKey(key, displays))) {
          sendText(response, 404, "No such display.");
          return;
        }

        const available = await themeStore.list();

        // Only a theme that exists can be chosen.
        if (!available.some((entry) => entry.id === id)) {
          sendText(response, 404, "No such theme.");
          return;
        }

        await activeTheme.write(key, id);
        sendJson(response, 200, {
          ok: true,
          ...(await activeThemeMap(activeTheme, available)),
        });
        return;
      }

      sendText(response, 405, "Only GET and PUT are supported.");
      return;
    }

    // A declared asset path already begins with `assets/`, so the capture is
    // the whole package-relative path and the lookup is verbatim. The `assets/`
    // anchor is what keeps `/document`, `/answers` and `/thumbnail` out.
    const assetMatch = url.pathname.match(
      /^\/api\/themes\/([^/]+)\/(assets\/.+)$/,
    );
    if (assetMatch) {
      if (request.method !== "GET") {
        sendText(response, 405, "Only GET is supported.");
        return;
      }
      let id: string;
      let assetPath: string;
      try {
        id = decodeURIComponent(assetMatch[1] ?? "");
        assetPath = decodeURIComponent(assetMatch[2] ?? "");
      } catch {
        sendText(response, 400, "Invalid theme asset path.");
        return;
      }
      const record = isValidThemeId(id)
        ? await readThemeOrAbsent(id)
        : undefined;
      const declared = record?.envelope.assets?.find(
        (asset) => asset.path === assetPath,
      );
      const bytes =
        declared === undefined ? undefined : record?.assets[declared.path];
      if (declared === undefined || bytes === undefined) {
        sendText(response, 404, "Theme asset not found.");
        return;
      }
      response.writeHead(200, {
        // A browser will not decode an `<img>` or a `<video>` whose response is
        // not a media type, and never sniffs SVG, so octet-stream here is a
        // packaged image no display can show.
        "content-type": contentTypeFor(declared.path),
        "cache-control": "no-store",
      });
      response.end(Buffer.from(bytes));
      return;
    }

    // A theme's own answers: which devices *this* theme reads (§145).
    const answersMatch = url.pathname.match(
      /^\/api\/themes\/([^/]+)\/answers$/,
    );
    if (answersMatch) {
      const rawId = decodeURIComponent(answersMatch[1] ?? "");

      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(response, 403, "Settings are available on this PC only.");
        return;
      }

      if (themeSettings === undefined || !isValidThemeId(rawId)) {
        sendText(response, 404, "No per-theme settings on this host.");
        return;
      }

      // Which display's answers. The page names the one it is showing for, and
      // a display with no choice of its own is what an unnamed read means — the
      // same default the theme map falls back to.
      //
      // The name is validated against the store rather than resolved the way a
      // display's own request resolves itself (`displayKeyFor`): this route is
      // loopback-only admin, and the page has to reach a paired display, which
      // that resolver refuses to name from a query.
      const named = url.searchParams.get("display") ?? DEFAULT_DISPLAY;

      if (!(await knownDisplayKey(named, displays))) {
        sendText(response, 404, "No such display.");
        return;
      }

      if (request.method === "GET") {
        const record = await readThemeOrAbsent(rawId);
        sendJson(response, 200, {
          answers: await themeSettings.read(named, rawId),
          required: requiredDeviceGroups(record?.envelope),
        });
        return;
      }

      if (request.method === "PUT") {
        try {
          const body = JSON.parse(await readBody(request)) as unknown;
          const saved = await themeSettings.write(named, rawId, body);
          sendJson(response, 200, { ok: true, answers: saved });
        } catch (error) {
          sendText(
            response,
            400,
            error instanceof Error ? error.message : String(error),
          );
        }
        return;
      }

      sendText(response, 405, "Only GET and PUT are supported.");
      return;
    }

    const thumbMatch = url.pathname.match(
      /^\/api\/themes\/([^/]+)\/thumbnail$/,
    );
    if (thumbMatch) {
      const rawId = decodeURIComponent(thumbMatch[1] ?? "");

      if (request.method === "GET") {
        const bytes =
          thumbnails === undefined || !isValidThemeId(rawId)
            ? undefined
            : await thumbnails.read(rawId);

        // No picture is not an error: the library falls back to the theme name.
        if (bytes === undefined) {
          sendText(response, 404, "No thumbnail for that theme.");
          return;
        }

        response.writeHead(200, {
          "content-type": "image/png",
          "cache-control": "no-cache",
        });
        response.end(bytes);
        return;
      }

      if (request.method === "PUT") {
        if (!isLoopbackRemote(request.socket.remoteAddress)) {
          sendText(response, 403, "Theme modification is loopback only.");
          return;
        }

        const store = thumbnails;

        if (store === undefined || !isValidThemeId(rawId)) {
          sendText(response, 400, "Invalid theme id.");
          return;
        }

        try {
          const chunks: Buffer[] = [];
          let received = 0;

          for await (const chunk of request) {
            const buffer = Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(chunk as string);
            received += buffer.byteLength;

            if (received > MAX_THUMBNAIL_BYTES) {
              sendText(response, 413, "That thumbnail is too large.");
              return;
            }

            chunks.push(buffer);
          }

          await store.write(rawId, new Uint8Array(Buffer.concat(chunks)));
          sendJson(response, 200, { ok: true });
        } catch (error) {
          sendText(
            response,
            400,
            error instanceof Error ? error.message : String(error),
          );
        }
        return;
      }

      sendText(response, 405, "Only GET and PUT are supported.");
      return;
    }

    // A package the author brings in is a library write, not a document: the
    // bytes land in the folder and the answer is the id they landed under, so
    // the theme survives the editor closing and appears in the local list. The
    // host reads the package — the browser posts bytes and maps the answer —
    // because the id rule and the no-overwrite rule are the folder's rules
    // (docs/decisions/0078).
    //
    // Matched before `/api/themes/:id`, which would otherwise read `import` as
    // a theme id — the same reason `/api/themes/active` is answered above.
    if (url.pathname === "/api/themes/import") {
      if (request.method !== "POST") {
        sendText(response, 405, "Only POST is supported.");
        return;
      }
      // Importing is a theme modification: a paired phone reads themes, it does
      // not add to the library.
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(response, 403, "Theme modification is loopback only.");
        return;
      }

      let body: Uint8Array;
      try {
        body = await readBytes(request, MAX_THEME_UPLOAD_BYTES);
      } catch {
        sendText(response, 413, "That package is too large to import.");
        return;
      }

      const imported = await importThemePackage(body, {
        store: themeStore,
        ...(thumbnails === undefined ? {} : { thumbnails }),
      });
      if (!imported.ok) {
        // The reader's own reason, carried out rather than replaced: it names
        // which of the package's faults this is, and a sentence composed here
        // would hide that. Nothing was written.
        sendText(response, 400, imported.message);
        return;
      }
      sendJson(response, 200, { ok: true, id: imported.id });
      return;
    }

    // A source video brought into the publish envelope, or copied untouched
    // when it already conforms. Like every theme modification it is this PC's
    // business; the encoder never sees a peer's bytes. Matched before
    // `/api/themes/:id` for the same reason `import` is.
    if (url.pathname === "/api/themes/normalize-video") {
      if (request.method !== "POST") {
        sendText(response, 405, "Only POST is supported.");
        return;
      }
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(response, 403, "Theme modification is loopback only.");
        return;
      }
      if (isForeignOrigin(request)) {
        sendText(response, 403, "That request is from another origin.");
        return;
      }

      let raw: string;
      try {
        raw = await readBody(request, MAX_THEME_UPLOAD_BYTES);
      } catch {
        sendText(response, 413, "That video is too large to normalize.");
        return;
      }

      let body: { bytesBase64?: unknown; fit?: unknown; aspect?: unknown };
      try {
        body = JSON.parse(raw) as {
          bytesBase64?: unknown;
          fit?: unknown;
          aspect?: unknown;
        };
      } catch {
        sendText(response, 400, "That normalize request is not JSON.");
        return;
      }
      if (typeof body.bytesBase64 !== "string") {
        sendText(response, 400, "A normalize needs bytesBase64.");
        return;
      }
      const fit =
        body.fit === undefined
          ? undefined
          : body.fit === "cover" || body.fit === "contain"
            ? body.fit
            : null;
      if (fit === null) {
        sendText(response, 400, "fit must be cover or contain.");
        return;
      }
      const aspect = parseAspect(body.aspect);
      if (aspect === null) {
        sendText(response, 400, "aspect must be a positive width and height.");
        return;
      }

      const normalized = await normalizeVideo(
        new Uint8Array(Buffer.from(body.bytesBase64, "base64")),
        {
          ...(fit === undefined ? {} : { fit }),
          ...(aspect === undefined ? {} : { aspect }),
        },
      );
      if (!normalized.ok) {
        // The normalizer's own sentence: it names which rule was broken, and a
        // sentence composed here would lose that.
        sendJson(response, 200, { ok: false, message: normalized.message });
        return;
      }
      sendJson(response, 200, {
        ok: true,
        bytesBase64: Buffer.from(normalized.bytes).toString("base64"),
        reencoded: normalized.reencoded,
      });
      return;
    }

    // The catalogue's Install action. The host fetches the package because the
    // editor's browser cannot (docs/decisions/0089), and the operation records
    // the origin after the write so the listing can say where a theme came from.
    // Matched here, before `/api/themes/:id`, for the same reason `import` is.
    if (url.pathname === "/api/themes/install") {
      if (request.method !== "POST") {
        sendText(response, 405, "Only POST is supported.");
        return;
      }
      // Installing is a theme modification: a paired phone reads themes, it does
      // not add to the library.
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(response, 403, "Theme modification is loopback only.");
        return;
      }
      // A loopback address is not the same origin: any page can POST here with
      // a body no preflight covers, and this route replaces a library copy.
      if (isForeignOrigin(request)) {
        sendText(response, 403, "That request is from another origin.");
        return;
      }
      // No origin owner, no install: the record is half of what this route
      // promises, and a theme that lands without one reads as a theme that did
      // not come from the catalogue.
      if (themeOrigins === undefined) {
        sendText(response, 503, "This host records no theme origins.");
        return;
      }

      let raw: string;
      try {
        raw = await readBody(request);
      } catch {
        // `readBody`'s only refusal is its size limit; the import route answers
        // the same class of input with 413.
        sendText(response, 413, "That install request is too large.");
        return;
      }

      let install: InstallRequest;
      try {
        const parsed = parseInstallRequest(JSON.parse(raw));
        if (parsed === undefined) {
          sendText(
            response,
            400,
            "An install needs packageUrl, catalogueId, version and kind.",
          );
          return;
        }
        install = parsed;
      } catch {
        sendText(response, 400, "That install request is not JSON.");
        return;
      }

      const installed = await installCatalogueItem(install, {
        store: themeStore,
        origins: themeOrigins,
        ...(thumbnails === undefined ? {} : { thumbnails }),
        ...(fetcher === undefined ? {} : { fetch: fetcher }),
      });
      if (!installed.ok) {
        // The refusing owner's own words. 502 when the remote end failed, 500
        // when this host's own store could not record the install; 400 when the
        // request's address, package or kind is one this build will not take.
        const status =
          installed.stage === "download"
            ? 502
            : installed.stage === "store"
              ? 500
              : 400;
        sendText(response, status, installed.message);
        return;
      }
      sendJson(response, 200, { ok: true, id: installed.id });
      return;
    }

    // The submission: one library theme id, submitted through the Worker as
    // the signed-in author. The handler is a module of its own for the reason
    // the store sign-in routes are.
    const submitted = await handleSubmitRoute(request, url, {
      origin: storeOrigin,
      sessionStore: storeSession,
      themeStore,
      thumbnails,
      fetch: fetcher ?? fetch,
      now: () => new Date(now()),
    });
    if (submitted !== undefined) {
      await writeWebResponse(response, submitted);
      return;
    }

    const docMatch = url.pathname.match(/^\/api\/themes\/([^/]+)\/document$/);
    if (docMatch) {
      if (request.method !== "GET") {
        sendText(response, 405, "Only GET is supported.");
        return;
      }
      const rawId = decodeURIComponent(docMatch[1] ?? "");
      if (!isValidThemeId(rawId)) {
        sendText(response, 400, "Invalid theme id.");
        return;
      }

      // A display showing the theme an author is editing shows the document as
      // it stands, not as it was last saved. The folder it came from is
      // unchanged: this is the display's view, and it lasts as long as the
      // publish does.
      const live = published.read();
      if (live !== undefined && live.id === rawId) {
        sendJson(response, 200, live.envelope);
        return;
      }

      // A display's view of the document: a theme that does not validate is
      // one it cannot serve, which is the same answer as a theme that is not
      // there — not the 422 the editor's own open gets (ADR-0043).
      const record = await readThemeOrAbsent(rawId);
      if (record === undefined) {
        sendText(response, 404, "Theme not found.");
        return;
      }
      sendJson(response, 200, record.envelope);
      return;
    }

    const themeMatch = url.pathname.match(/^\/api\/themes\/([^/]+)$/);
    if (themeMatch) {
      const rawId = decodeURIComponent(themeMatch[1] ?? "");
      if (request.method === "GET") {
        if (!isValidThemeId(rawId)) {
          sendText(response, 400, "Invalid theme id.");
          return;
        }
        let record: ThemeRecord;
        try {
          record = await themeStore.read(rawId);
        } catch (error) {
          // A theme that is present and does not validate is understood and
          // its semantics are invalid, which is exactly 422 — RFC 9110
          // §15.5.21. Not the 404 an absent id gets, and not a 400 that would
          // blame the request: the validator's own issues travel with it, so
          // the editor can report the reason instead of a status number
          // (ADR-0043).
          if (error instanceof ThemeValidationError) {
            sendJson(response, 422, {
              error: `Theme "${rawId}" is stored but does not validate.`,
              issues: error.issues,
            });
            return;
          }
          // A stored document past the size the store will read is understood
          // and too large to serve, which is the same 413 every other themes
          // route answers an over-large thing with — and the author is told the
          // theme is there, which is the half a 404 got wrong (vg-409,
          // decisions/0043). RFC 9110 §15.5.14 frames 413 around *request*
          // content and this is a stored document on a GET; the stretch is
          // taken deliberately, because inventing a second size-ish status
          // would be worse vocabulary than reusing this codebase's own
          // (decisions/0084).
          if (error instanceof ThemeTooLargeError) {
            sendText(response, 413, error.message);
            return;
          }
          throw error;
        }
        if (record === undefined) {
          sendText(response, 404, "Theme not found.");
          return;
        }
        // The editor reads a theme back the way it wrote one, so the pair of
        // routes is symmetric: what a save put in the folder, an open takes out
        // — plus the `base` that says which stored document this is.
        sendJson(response, 200, encodeThemeContent(record, record.base));
        return;
      }

      if (request.method === "PUT") {
        if (!isLoopbackRemote(request.socket.remoteAddress)) {
          sendText(response, 403, "Theme modification is loopback only.");
          return;
        }
        if (!isValidThemeId(rawId)) {
          sendText(response, 400, "Invalid theme id.");
          return;
        }

        let body: string;
        try {
          body = await readBody(request, MAX_THEME_UPLOAD_BYTES);
        } catch {
          sendText(response, 413, "That theme is too large to save.");
          return;
        }

        let decoded: DecodedThemeSave;
        try {
          decoded = decodeThemeSave(body);
        } catch (error) {
          sendText(
            response,
            400,
            error instanceof Error ? error.message : String(error),
          );
          return;
        }

        try {
          const saved = await themeStore.write(rawId, decoded.content, {
            ...(decoded.base === undefined ? {} : { base: decoded.base }),
            overwrite: decoded.overwrite,
          });
          sendJson(response, 200, { ok: true, ...saved });
        } catch (error) {
          // A refusal is not a malformed theme: nothing was written, the
          // stored version is intact, and the author is the one who has to
          // choose what happens next — so it is not dressed as a 400.
          if (error instanceof ThemeConflictError) {
            sendText(response, 409, error.message);
            return;
          }
          // The same 413 this route already answers an oversized body with: the
          // theme is well-formed and the author is the one who has to make it
          // smaller, so it is not dressed as a malformed request either.
          if (error instanceof ThemeAssetLimitError) {
            sendText(response, 413, error.message);
            return;
          }
          sendText(
            response,
            400,
            error instanceof Error ? error.message : String(error),
          );
        }
        return;
      }

      if (request.method === "DELETE") {
        // Removing authored work is this PC's business, like saving it: a
        // paired phone reads themes, it does not lose them.
        if (!isLoopbackRemote(request.socket.remoteAddress)) {
          sendText(response, 403, "Theme modification is loopback only.");
          return;
        }
        if (!isValidThemeId(rawId)) {
          sendText(response, 400, "Invalid theme id.");
          return;
        }

        try {
          // The store moves the folder to the OS trash (docs/decisions/0021) and
          // answers false for anything it would not have listed, so a 404 here
          // means the same "no such theme" an open would have said.
          const removed = await themeStore.remove(rawId);
          // The origin goes only with a removal that happened, because it is a
          // fact about a copy that is on disk. Unguarded, like the display
          // route's `themeSettings?.removeDisplay(id)`: a sweep that throws
          // reaches this handler's catch and answers 500 for a request whose
          // folder is already in the trash — a real fault the caller should
          // hear about, not one to swallow.
          if (removed) await themeOrigins?.removeTheme(rawId);
          sendJson(
            response,
            removed ? 200 : 404,
            removed
              ? { ok: true }
              : { error: `No theme "${rawId}" in this library.` },
          );
        } catch (error) {
          // A trash that refused is not a malformed request: nothing was
          // removed, the theme is exactly where it was, and the author's copy
          // is intact. The reason is the platform's own, so it travels as is.
          sendText(
            response,
            500,
            error instanceof Error ? error.message : String(error),
          );
        }
        return;
      }

      sendText(response, 405, "Only GET, PUT and DELETE are supported.");
      return;
    }

    // Publishing is admin, like a save: it decides what every display shows, and
    // it holds a copy of the author's document in memory. The id rides in the
    // query because the save wire is the editor's existing document and carries
    // none of its own.
    if (url.pathname === "/api/publish") {
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(response, 403, "Publishing is available on this PC only.");
        return;
      }

      if (request.method === "PUT") {
        let decoded: DecodedThemeSave;
        try {
          decoded = decodeThemeSave(
            await readBody(request, MAX_THEME_UPLOAD_BYTES),
          );
        } catch (error) {
          sendText(
            response,
            400,
            error instanceof Error ? error.message : String(error),
          );
          return;
        }

        const id = url.searchParams.get("id") ?? "";
        // A malformed id and an unknown one are different answers, and the save
        // route already draws this line: the first is the caller's mistake, the
        // second is a fact about this library.
        if (!isValidThemeId(id)) {
          sendText(response, 400, "Invalid theme id.");
          return;
        }

        // The assets a display fetches come from the theme's own folder, so a
        // document with no folder would render with holes. Refusing is honest;
        // publishing it anyway is not.
        if ((await readThemeOrAbsent(id)) === undefined) {
          // 404, the same answer `/api/themes/:id` gives for the same fact.
          sendText(
            response,
            404,
            `No theme "${id}" in this library to publish.`,
          );
          return;
        }

        // A publish bypasses `themeStore.write`, so nothing else checks the
        // document, and a display serves whatever it is given.
        const checked = validateFabricThemeEnvelope(decoded.content.envelope);
        if (!checked.ok) {
          sendText(
            response,
            400,
            checked.issues[0]?.message ?? "That document is not a theme.",
          );
          return;
        }

        // A save refuses a document whose own id disagrees with the folder it
        // is written to. Publishing bypasses that too, so the invariant has to
        // be kept here or a display is served an id carrying a document that
        // says it is something else.
        if (checked.envelope.id !== id) {
          sendText(
            response,
            400,
            `That document is "${checked.envelope.id}", not "${id}".`,
          );
          return;
        }

        const revision = published.publish(id, checked.envelope);
        sendJson(response, 200, { ok: true, id, revision });
        return;
      }

      if (request.method === "DELETE") {
        sendJson(response, 200, {
          ok: true,
          id: null,
          revision: published.clear(),
        });
        return;
      }

      if (request.method === "GET") {
        const current = published.read();
        sendJson(response, 200, {
          id: current?.id ?? null,
          revision: published.revision(),
        });
        return;
      }

      sendText(response, 405, "Only GET, PUT and DELETE are supported.");
      return;
    }

    if (request.method !== "GET") {
      sendText(response, 405, "Only GET is supported.");
      return;
    }

    if (url.pathname === "/api/sensors") {
      sendJson(response, 200, { sensors: await registry.describe() });
      return;
    }

    // The settings page is an admin surface: it changes what every display
    // shows, so it stays on this PC like the editor and pairing.
    if (url.pathname === "/settings" || url.pathname.startsWith("/settings/")) {
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(response, 403, "Settings are available on this PC only.");
        return;
      }

      if (bundles.admin === undefined) {
        sendText(response, 404, "No settings page is installed.");
        return;
      }

      await serveStatic(
        response,
        bundles.admin,
        url.pathname === "/settings"
          ? "/settings.html"
          : url.pathname.slice("/settings".length),
        "The settings page is missing from this installation.",
      );
      return;
    }

    if (url.pathname === "/editor" || url.pathname.startsWith("/editor/")) {
      // Editing remains localhost-only even when the display server binds to the LAN.
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(response, 403, "The editor is available on this PC only.");
        return;
      }

      // Preserve the editor mount as the base for relative assets.
      if (needsTrailingSlash(url.pathname, "/editor")) {
        const query = url.search;
        response.writeHead(302, {
          location: `/editor/${query}`,
          "cache-control": "no-store",
        });
        response.end();
        return;
      }

      await serveStatic(
        response,
        bundles.editor,
        url.pathname.slice("/editor".length) || "/",
        "The editor bundle is not built. Run: npx vite build packages/editor",
      );
      return;
    }

    // Host-served player uses a stored theme and live data; standalone preview stays deterministic.
    if (url.pathname === "/" && !url.searchParams.has("data")) {
      // Resolution order, in the consumer's terms: what the author is
      // publishing now, then an explicit link, then the theme this display was
      // assigned, then the default this PC holds, then the only theme if there
      // is exactly one. Several themes and no choice means the library is the
      // right next step.
      const available = await themeStore.list();
      const requested = url.searchParams.get("theme");
      const exists = async (id: string): Promise<boolean> =>
        available.some((entry) => entry.id === id);
      const stored =
        requested === null
          ? await assignedThemeFor(
              await displayKeyFor(request, url, displays),
              exists,
            )
          : undefined;
      const live = published.read()?.id;
      const theme =
        live ??
        requested ??
        stored ??
        (available.length === 1 ? available[0]?.id : undefined);
      // Where the theme came from, because every display arrives carrying one:
      // the player reads this to know whether an assignment may move it at all.
      // Without it, the person's own link and the host's own resolution are the
      // same URL, and the display's poll would be answered `null` for ever.
      const source =
        live !== undefined ? "published" : requested !== null ? "link" : "map";

      if (theme === undefined) {
        // Nothing to show: either a first run, or a choice to make. Both lead
        // the consumer somewhere they can act rather than to an error.
        if (available.length > 0) {
          // Several themes and none chosen. The chooser is one of the host's
          // own pages, sharing the settings page's theme rows, so both show a
          // thumbnail; a second list here would be the copy without one.
          if (bundles.admin !== undefined) {
            await serveStatic(
              response,
              bundles.admin,
              "/library.html",
              "The theme chooser is missing from this installation.",
            );
            return;
          }

          sendText(
            response,
            404,
            "The theme chooser is missing from this installation.",
          );
          return;
        }

        sendHtml(response, 200, firstRunPage());
        return;
      }
      url.searchParams.set("theme", theme);
      url.searchParams.set("data", "live");
      url.searchParams.set("theme-source", source);
      response.writeHead(302, {
        location: `${url.pathname}?${url.searchParams.toString()}`,
        "cache-control": "no-store",
      });
      response.end();
      return;
    }

    await serveStatic(
      response,
      bundles.player,
      url.pathname,
      "The player bundle is not built. Run: npx vite build packages/player",
      // The player is one document. Everything else that reaches here is a path
      // the bundle does not declare, and answering it with a live dashboard is
      // worse than a 404: an operator whose display URL is wrong sees a
      // working display and no reason to look for the reason.
      url.pathname === "/",
    );
  }

  async function openStream(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<void> {
    const keys = (url.searchParams.get("keys") ?? "")
      .split(",")
      .map((key) => key.trim())
      .filter((key) => key.length > 0);

    // Resolving the display reads the store, and a client that leaves during
    // that read has already emitted the `close` the listeners below would have
    // removed this connection on. So the event is kept until there is a
    // connection to remove — a connection nobody drops writes to a socket that
    // is gone on every later tick.
    let gone = false;
    const noteGone = (): void => {
      gone = true;
    };

    request.on("close", noteGone);
    request.on("error", noteGone);

    const display = await displayKeyFor(request, url, displays);
    const connection = new SseConnection(response, keys, display);

    request.off("close", noteGone);
    request.off("error", noteGone);

    if (gone) {
      connection.close();
      return;
    }

    connections.add(connection);

    const drop = (): void => {
      connections.delete(connection);
      connection.close();
    };

    request.on("close", drop);
    request.on("error", drop);
  }

  /**
   * Samples once per distinct assignment and offers each display the payload
   * its own assignment produced.
   *
   * A display's theme and answers are read once per tick however many
   * connections it holds, and two displays holding the same devices share one
   * poll: a poll is this PC's work, and the devices are what it reads.
   */
  async function tick(): Promise<void> {
    if (connections.size === 0) {
      return;
    }

    const byDisplay = new Map<string, SseConnection[]>();

    for (const connection of connections) {
      const held = byDisplay.get(connection.display);

      if (held === undefined) {
        byDisplay.set(connection.display, [connection]);
        continue;
      }

      held.push(connection);
    }

    const asks: DisplayAsk[] = [];

    for (const [display, held] of byDisplay) {
      asks.push({
        display,
        semanticKeys: unionOfKeys(
          held.map((connection) => connection.semanticKeys),
        ),
        assignment: await currentAssignment(display),
      });
    }

    const unmapped = new Set<string>();
    // One clock for the whole cycle: two displays sampled in the same tick are
    // comparable, which is what a batch's `sentAt` and its samples promise.
    const at = now();

    for (const group of groupByAssignment(asks)) {
      const cycle = await registry.sample(
        group.semanticKeys,
        at,
        group.assignment,
      );

      // A key no provider even considers would otherwise be absent from the frame
      // entirely, so a display cannot tell "nothing reports this" from "no data
      // yet" (§97). An explicit gap carries the reason to the display.
      const answered = new Set(cycle.entries.map((entry) => entry.semanticKey));
      const timestamp = new Date(at).toISOString();
      const gaps = cycle.unmapped
        .filter((key) => !answered.has(key))
        .map((key) => ({
          semanticKey: key,
          sample: {
            sensorId: "host:" + key,
            timestamp,
            status: "missing" as const,
            message:
              "no provider on this PC reports that sensor; check the device " +
              "assignment or that its source is running",
          },
        }));

      const payload = JSON.stringify(
        createBatch([...cycle.entries, ...gaps], at),
      );

      for (const key of cycle.unmapped) unmapped.add(key);

      for (const display of group.displays) {
        for (const connection of byDisplay.get(display) ?? []) {
          connection.offer(payload);
        }
      }
    }

    // Recorded for `/api/health` so an unsupported sensor explains itself. Every
    // display's gaps, not the last group's: a sensor nothing reports is
    // unsupported here whatever screen asked.
    lastUnmapped = [...unmapped].sort();
  }

  const timer = setInterval(() => {
    void tick().catch(() => {
      // Provider failures are isolated; keep future cycles running.
    });
  }, intervalMs);

  timer.unref();

  return {
    server,
    get connectionCount() {
      return connections.size;
    },
    close(): Promise<void> {
      clearInterval(timer);

      for (const connection of connections) {
        connection.close();
      }

      connections.clear();

      return new Promise((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}
