import http from "node:http";
import https from "node:https";
import net from "node:net";
import {
  type AssignableGroup,
  SAMPLE_STREAM_PATH,
} from "@yunari/renderer-core";
import { handleAssetRoutes } from "./assets/routes.js";
import {
  createPendingStates,
  handleCatalogueRoutes,
} from "./catalogue/routes.js";
import { DEFAULT_THEMES_DIR } from "./cli/args.js";
import type { ListenableServer } from "./cli/net.js";
import { createPanelFamilyRegistry } from "./panels/panel-families.js";
import type { DeviceAssignment } from "./providers/lhm-mapping.js";
import { createPublishedStore } from "./serve/published.js";
import { createDisplayRoutes } from "./server/displays-routes.js";
import { createExtensionRoutes } from "./server/extension-routes.js";
import { handleExtensionUiRoutes } from "./server/extension-ui-routes.js";
import {
  createLargeBodyGate,
  readBody,
  sendJson,
  sendText,
  writeWebResponse,
} from "./server/http.js";
import {
  allowed,
  isForeignOrigin,
  isLoopbackRemote,
  refusesLoopbackApi,
  resolveStoreOrigin,
} from "./server/identity.js";
import { DEFAULT_SAMPLE_INTERVAL_MS } from "./server/limits.js";
import { createMediaRoutes } from "./server/media-routes.js";
import type { HostServer, HostServerOptions } from "./server/options.js";
import { handlePackRoutes } from "./server/pack-routes.js";
import { createPageRoutes } from "./server/pages-routes.js";
import { createPairingRoutes } from "./server/pairing-routes.js";
import { createSecretRoutes } from "./server/secrets-routes.js";
import { createSettingsRoutes } from "./server/settings-routes.js";
import {
  createStreaming,
  type StoredDeviceSettings,
} from "./server/streaming.js";
import { createThemeWrites } from "./server/theme-writes.js";
import { createThemeRoutes } from "./server/themes-routes.js";
import { createWallpaperRoutes } from "./server/wallpaper-routes.js";
import { createPairingCodeStore } from "./session/pairing-code.js";
import { assignedThemeFor } from "./settings/active-theme.js";
import { KNOWN_CREDENTIALS } from "./settings/credentials-registry.js";
import { DEFAULT_DISPLAY } from "./settings/displays.js";
import { listMonitors } from "./settings/monitors.js";
import { createThemeStore } from "./themes/store.js";
import { certificateFingerprintSha256 } from "./tls/authority.js";

/** HTTP routing for bundles, discovery, sample streaming, and theme packages. */

export { createLargeBodyGate, readBody } from "./server/http.js";
export {
  displayFor,
  displayKeyFor,
  hostnameOf,
  isForeignOrigin,
  isLoopbackName,
  isLoopbackRemote,
  refusesLoopbackApi,
  resolveStoreOrigin,
} from "./server/identity.js";
export {
  CA_CERTIFICATE_PATH,
  DEFAULT_SAMPLE_INTERVAL_MS,
  MAX_STREAM_CONNECTIONS,
  MAX_STREAM_CONNECTIONS_PER_DISPLAY,
  MAX_STREAM_KEY_BYTES,
  MAX_STREAM_KEYS,
  MAX_THEME_UPLOAD_BYTES,
  MAX_VIDEO_SOURCE_BYTES,
} from "./server/limits.js";
export type {
  BundleRoots,
  HostingPeer,
  HostingState,
  HostServer,
  HostServerOptions,
  SourceRouteOptions,
} from "./server/options.js";

/** The first byte of a TLS handshake, and not a byte any HTTP request method
 *  begins with. */
const TLS_HANDSHAKE_BYTE = 0x16;

/** How long an accepted socket may stay silent before this port destroys it:
 *  long enough for a phone to start a handshake, short enough that a client
 *  holding a connection slot without saying anything gives it back. */
const HANDSHAKE_TIMEOUT_MS = 5_000;

/** Sockets this port holds at once. Below the operating system's own accept
 *  backlog, so a flood is refused here rather than exhausting file handles. */
const MAX_SOCKET_CONNECTIONS = 256;

/**
 * One port, two protocols.
 *
 * A display's secure origin and the pairing link the host already prints
 * (`http://<lan-ip>:<port>`) have to be the same port: one listener on one port
 * is one thing to find, and a second port would be a second one. So the first
 * byte on a socket decides who owns it: `0x16` is a TLS ClientHello, and
 * anything else is HTTP.
 *
 * **Plain http is a cost here, not a feature.** On a LAN it is an origin with
 * no wake lock and no service worker, so a display cannot stay awake or install
 * as an app there. It is kept only because the pairing link that points at it
 * carries the LAN address a display types; a display reaches the secure origin
 * by typing `https` in front of that address.
 */
export function createPortListener(
  plain: http.Server,
  secure: https.Server,
): ListenableServer {
  /** Sockets this port accepted, so a move can drop them all. */
  const accepted = new Set<net.Socket>();

  const listener = net.createServer({ pauseOnConnect: true }, (socket) => {
    accepted.add(socket);
    socket.once("close", () => accepted.delete(socket));

    // Nothing bounds a socket that has said nothing: neither inner server has
    // seen it, so neither one's own timeout applies. Cleared at handover below,
    // before any byte this connection does send can be called idle.
    socket.setTimeout(HANDSHAKE_TIMEOUT_MS, () => socket.destroy());

    socket.once("readable", () => {
      const first = socket.read(1) as Buffer | null;

      if (first === null) {
        socket.destroy();
        return;
      }

      // The socket is no longer this port's to time: from here it is a request
      // the inner server's own timeouts govern.
      socket.setTimeout(0);

      // Put the byte back before handing the socket over: the inner server
      // parses it as though it had accepted the connection itself.
      socket.unshift(first);
      const owner = first[0] === TLS_HANDSHAKE_BYTE ? secure : plain;
      owner.emit("connection", socket);
    });
  });

  /** A silence this port will not keep: enough for a client to start a
   *  handshake, short enough that a caller holding a slot says why. */
  listener.maxConnections = MAX_SOCKET_CONNECTIONS;

  return Object.assign(listener, {
    closeAllConnections(): void {
      for (const socket of accepted) socket.destroy();
    },
  }) as ListenableServer;
}

export function createHostServer(options: HostServerOptions): HostServer {
  const registry = options.registry;
  const themeStore = options.themeStore ?? createThemeStore(DEFAULT_THEMES_DIR);
  const intervalMs = options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS;
  const now = options.now ?? (() => Date.now());
  const displays = options.displays;
  const monitors = options.monitors ?? listMonitors;
  /** The one registry this server resolves driver rows from: the routes, the
   *  preview and the attached list must agree on which family owns a device. */
  const panelFamilies = options.panelFamilies ?? createPanelFamilyRegistry();
  const panelsAttached =
    options.attachedPanels ?? (() => panelFamilies.attached());
  const pairingCodes = options.pairingCodes ?? createPairingCodeStore();
  const extensions = options.extensions;
  const pluginSettings = options.pluginSettings;
  const saved = options.rememberLan;
  const devices = options.devices;
  const display = options.display;
  const weather = options.weather;
  const fontFavorites = options.fontFavorites;
  const credentials = options.credentials;
  const sourceRoutes = options.sources;
  const baseCredentials = options.knownCredentials ?? KNOWN_CREDENTIALS;
  const assets = options.assets;
  const artwork = options.artwork;
  const gameArtwork = options.gameArtwork;
  const gameCoverCacheDir = options.gameCoverCacheDir;
  const wallpaperEngine = options.wallpaperEngine;
  const activeTheme = options.activeTheme;
  const thumbnails = options.thumbnails;
  const themeMedia = options.themeMedia;
  const fetcher = options.fetch;
  const themeSettings = options.themeSettings;
  const themeOrigins = options.themeOrigins;
  const published = options.published ?? createPublishedStore();
  const widgetPacks = options.widgetPacks;
  const pathPresets = options.pathPresets;
  const caCertificate = options.caCertificate;
  /** Hashed from the bytes being served, once per server: a value passed
   *  alongside them could describe a different certificate. */
  const caFingerprint =
    caCertificate === undefined
      ? undefined
      : certificateFingerprintSha256(caCertificate);
  const storeOrigin = resolveStoreOrigin(
    options.storeOrigin ?? process.env.YUNARI_STORE_ORIGIN,
  );
  const storeSession = options.storeSession;
  /** The store sign-in states this server minted, so another instance in the
   *  same process cannot redeem them. */
  const storeSignInStates = createPendingStates();
  /** Theme-sized bodies, one at a time; see `createLargeBodyGate`. */
  const largeBody = createLargeBodyGate();

  /**
   * The move a PUT asked for, run once that PUT's answer is on the wire. Its
   * refusal is state rather than a status for the same reason: the request that
   * asked for the move cannot be answered with its outcome, so the next GET
   * reads `refusal` back.
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
   * it holds, and the answers it gave for that theme. `stored` is the tick's
   * one read of the settings: they are this PC's, not the display's. Nothing
   * is held between ticks — a consumer who reassigns a device is served it on
   * that display's next sample.
   */
  async function currentAssignment(
    display: string,
    stored: StoredDeviceSettings,
  ): Promise<DeviceAssignment> {
    // The theme this display holds, else the default's — the same fallback
    // `assignedThemeFor` makes, and what keeps a theme chosen through
    // `/api/themes/active` (which still writes `default`, ruling 38) applying
    // to a display that holds none of its own (ruling 44).
    const chosen =
      activeTheme === undefined
        ? undefined
        : await assignedThemeFor(activeTheme, display, async () => true);
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

    // The group is `AssignableGroup` from renderer-core, not a union
    // re-spelled here: the owner is `ASSIGNABLE_GROUPS` (renderer-core),
    // and a fourth group added there must reach this path rather than needing a
    // second edit nobody would make.
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
    handle(request, response).catch((error: unknown) => {
      // The reason names this machine's own files, and this route answers LAN
      // callers too: the console keeps it, the body does not.
      console.error(error);

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
  // always brings one; the unit suite does not, and a route answers the
  // same either way.
  const server: ListenableServer =
    secure === undefined ? plain : createPortListener(plain, secure);

  const streaming = createStreaming({
    registry,
    now,
    intervalMs,
    devices,
    displays,
    currentAssignment,
  });
  const { connections } = streaming;

  const pageRoutes = createPageRoutes({
    options,
    themeStore,
    activeTheme,
    caFingerprint,
  });
  const displayRoutes = createDisplayRoutes({
    options,
    monitors,
    panelsAttached,
    panelFamilies,
    server,
  });
  const pairingRoutes = createPairingRoutes({ displays, pairingCodes });
  const extensionRoutes = createExtensionRoutes({
    extensions,
    settings: pluginSettings,
  });
  const settingsRoutes = createSettingsRoutes({
    options,
    devices,
    display,
    weather,
    fontFavorites,
    published,
    themeStore,
    activeTheme,
    fetcher,
    connections,
    lastUnmapped: streaming.lastUnmapped,
    moveLan,
  });
  const secretRoutes = createSecretRoutes({
    sourceRoutes,
    credentials,
    baseCredentials,
    fetcher,
    now,
  });
  const mediaRoutes = createMediaRoutes({
    options,
    artwork,
    gameArtwork,
    gameCoverCacheDir,
  });
  const themeRoutes = createThemeRoutes({
    options,
    themeStore,
    activeTheme,
    themeSettings,
    themeOrigins,
    thumbnails,
    themeMedia,
    panelFamilies,
  });
  const themeWrites = createThemeWrites({
    options,
    themeStore,
    themeOrigins,
    thumbnails,
    themeMedia,
    fetcher,
    largeBody,
    published,
    now,
    storeOrigin,
    storeSession,
  });
  const wallpaperRoutes = createWallpaperRoutes({ wallpaperEngine, largeBody });

  async function handle(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", "http://host.invalid");

    // One same-origin decision ahead of every route branch: the route-by-route
    // checks left routes reachable by a page that rebound a name to loopback.
    if (refusesLoopbackApi(request, url)) {
      sendText(response, 403, "That request is from another origin.");
      return;
    }

    if (await pageRoutes.handleEntry(request, response, url)) return;

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

    if (await displayRoutes(request, response, url)) return;
    if (await pairingRoutes(request, response, url)) return;

    if (url.pathname === SAMPLE_STREAM_PATH) {
      if (!(await allowed(request, displays))) {
        sendText(response, 403, "This display is not paired with the host.");
        return;
      }
      await streaming.openStream(request, response, url);
      return;
    }

    if (await settingsRoutes(request, response, url)) return;
    if (await secretRoutes(request, response, url)) return;

    // The asset finder's four routes. Mounted whenever the path names one, so
    // a host that serves no source answers 503 rather than the static 404 —
    // except the trash, which needs no source.
    if (
      url.pathname === "/api/assets/sources" ||
      url.pathname === "/api/assets/search" ||
      url.pathname === "/api/assets/bytes" ||
      url.pathname === "/api/assets/trash"
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

    if (await mediaRoutes(request, response, url)) return;

    if (await pageRoutes.handleSessionExchange(request, response, url)) return;
    if (await pageRoutes.guardDisplay(request, response, url)) return;

    if (await themeRoutes(request, response, url)) return;
    if (await wallpaperRoutes(request, response, url)) return;

    // Installed widget packs: the library listing, import, download and remove.
    if (
      await handlePackRoutes({
        request,
        response,
        url,
        store: widgetPacks,
        pathPresets,
        largeBody,
      })
    )
      return;

    // The submission and the stored theme's open/save/remove. The submission
    // is a module of its own for the reason the store sign-in routes are.
    if (await themeWrites(request, response, url)) return;

    // Plugin UI files are read through the installed record, never a path the
    // caller supplied, so they are answered before the manager route that owns
    // the rest of `/api/extensions`.
    if (
      extensions !== undefined &&
      (await handleExtensionUiRoutes(request, response, url, {
        service: extensions,
      }))
    )
      return;

    if (await extensionRoutes(request, response, url)) return;

    if (request.method !== "GET") {
      sendText(response, 405, "Only GET is supported.");
      return;
    }

    if (url.pathname === "/api/sensors") {
      // Measuring reads every provider, so only a caller that asked for it pays
      // for it: a display loading the catalogue keeps the descriptor-only answer
      // and does not start acquisition it will never use.
      if (url.searchParams.get("measured") === "1") {
        const catalogue = await registry.measure(now());
        sendJson(response, 200, catalogue);
        return;
      }

      sendJson(response, 200, { sensors: await registry.describe() });
      return;
    }

    await pageRoutes.handleAdmin(request, response, url);
  }

  return {
    server,
    get connectionCount() {
      return connections.size;
    },
    close(): Promise<void> {
      streaming.stop();

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
