import type http from "node:http";
import { knownTimeZones } from "@yunari/renderer-core";
import { redactForBrowser } from "../providers/provider.js";
import { unionOfKeys } from "../providers/registry.js";
import { WEATHER_BACKENDS } from "../providers/weather/backends.js";
import type { PublishedStore } from "../serve/published.js";
import type { ActiveThemeStore } from "../settings/active-theme.js";
import type { DeviceSettingsStore } from "../settings/devices.js";
import type { DisplaySettingsStore } from "../settings/display.js";
import type { FontFavoritesStore } from "../settings/font-favorites.js";
import {
  searchWeatherPlaces,
  type WeatherSettingsStore,
} from "../settings/weather.js";
import type { ThemeStore } from "../themes/store.js";
import type { SseConnection } from "../transport/sse.js";
import { isPlatformError, readBody, sendJson, sendText } from "./http.js";
import {
  allowed,
  assignedThemeForDisplay,
  displayKeyFor,
  isForeignOrigin,
  isLoopbackRemote,
  peerOf,
  presentationForDisplay,
} from "./identity.js";
import type { HostingState, HostServerOptions } from "./options.js";

/** A search term longer than this is a paste, not a place. */
const MAX_PLACE_QUERY_LENGTH = 200;

const NO_HOSTING: HostingState = {
  lan: false,
  address: null,
  name: null,
  port: null,
  refusal: null,
};

export interface SettingsRouteDeps {
  readonly options: HostServerOptions;
  readonly devices: DeviceSettingsStore | undefined;
  readonly display: DisplaySettingsStore | undefined;
  readonly weather: WeatherSettingsStore | undefined;
  readonly fontFavorites: FontFavoritesStore | undefined;
  readonly published: PublishedStore;
  readonly themeStore: ThemeStore;
  readonly activeTheme: ActiveThemeStore | undefined;
  readonly fetcher: typeof fetch | undefined;
  readonly connections: Set<SseConnection>;
  readonly lastUnmapped: () => readonly string[];
  readonly moveLan: (on: boolean) => Promise<void>;
}

/**
 * The machine-fact settings routes: device assignments, display preferences,
 * weather, the published revision, font favourites, health and LAN hosting.
 */
export function createSettingsRoutes(
  deps: SettingsRouteDeps,
): (
  request: http.IncomingMessage,
  response: http.ServerResponse,
  url: URL,
) => Promise<boolean> {
  const {
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
    lastUnmapped,
    moveLan,
  } = deps;
  const displays = options.displays;

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

  return async function handleSettingsRoutes(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    // Device assignments are an admin action, like pairing: they change what
    // every display shows, so they stay loopback-only.
    if (url.pathname.startsWith("/api/devices")) {
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(
          response,
          403,
          "Device settings are available on this PC only.",
        );
        return true;
      }

      if (devices === undefined) {
        sendText(
          response,
          404,
          "Device settings are not enabled on this host.",
        );
        return true;
      }

      if (url.pathname === "/api/devices" && request.method === "GET") {
        sendJson(response, 200, {
          available: await availableDevices(),
          assigned: await devices.read(),
        });
        return true;
      }

      if (url.pathname === "/api/devices" && request.method === "PUT") {
        try {
          const body = JSON.parse(await readBody(request)) as unknown;
          const saved = await devices.write(body);
          sendJson(response, 200, { ok: true, assigned: saved });
        } catch (error: unknown) {
          // The store's own file failures name this machine's paths; the
          // detail goes to the host's console, not to the caller.
          if (isPlatformError(error)) {
            console.error(error);
            sendText(
              response,
              400,
              "The device assignments could not be saved.",
            );
            return true;
          }
          sendText(
            response,
            400,
            error instanceof Error ? error.message : String(error),
          );
        }
        return true;
      }

      sendText(response, 405, "Only GET and PUT are supported.");
      return true;
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
        return true;
      }

      if (request.method === "GET") {
        if (
          !isLoopbackRemote(request.socket.remoteAddress) &&
          !(await allowed(request, displays))
        ) {
          sendText(response, 403, "This display is not paired with the host.");
          return true;
        }

        // The zones travel with the setting: the page is dependency-free source
        // and cannot resolve them any other way.
        sendJson(response, 200, {
          settings: await display.read(),
          zones: knownTimeZones(),
        });
        return true;
      }

      if (request.method === "PUT") {
        if (!isLoopbackRemote(request.socket.remoteAddress)) {
          sendText(
            response,
            403,
            "Display settings are available on this PC only.",
          );
          return true;
        }

        try {
          const body = JSON.parse(await readBody(request)) as unknown;
          // **An omitted bag is not a request to clear it.** The dependency-free
          // `/settings` page predates unit preferences and sends only the fields
          // it draws; the route replaces the whole object, so passing that body
          // through erased units the editor had stored. A caller that means to
          // clear them sends `units: {}`.
          const merged =
            typeof body === "object" &&
            body !== null &&
            !Array.isArray(body) &&
            !("units" in body)
              ? { ...body, units: (await display.read()).units }
              : body;
          const saved = await display.write(merged);
          options.onDisplayChange?.(saved);
          sendJson(response, 200, { ok: true, settings: saved });
        } catch (error: unknown) {
          if (isPlatformError(error)) {
            console.error(error);
            sendText(response, 400, "The display settings could not be saved.");
            return true;
          }
          sendText(
            response,
            400,
            error instanceof Error ? error.message : String(error),
          );
        }
        return true;
      }

      sendText(response, 405, "Only GET and PUT are supported.");
      return true;
    }

    // Weather's place, backend and cadence are this PC's own facts, like the
    // display preferences above: a display never reads them, and a place search
    // spends this host's request on a person's own act.
    if (
      url.pathname === "/api/weather/settings" ||
      url.pathname === "/api/weather/places"
    ) {
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(
          response,
          403,
          "Weather settings are available on this PC only.",
        );
        return true;
      }

      if (weather === undefined) {
        sendText(
          response,
          404,
          "Weather settings are not enabled on this host.",
        );
        return true;
      }

      if (url.pathname === "/api/weather/settings") {
        if (request.method === "GET") {
          const settings = await weather.read();
          const backend = WEATHER_BACKENDS[settings.provider];
          // The credit belongs to the backend the settings name: the page's
          // link is the backend's own terms, which OpenWeather requires beside
          // its wording.
          sendJson(response, 200, {
            settings,
            attribution: { text: backend.attribution, url: backend.termsUrl },
          });
          return true;
        }

        if (request.method === "PUT") {
          let raw: string;

          try {
            raw = await readBody(request);
          } catch (error: unknown) {
            // The body's size is its own refusal: a body this host will not
            // read is not a malformed one it read and rejected.
            sendText(
              response,
              413,
              error instanceof Error ? error.message : String(error),
            );
            return true;
          }

          let body: unknown;

          try {
            body = JSON.parse(raw) as unknown;
          } catch {
            sendText(response, 400, "That request body is not JSON.");
            return true;
          }

          try {
            // The store normalizes before it touches the file, and its refusal
            // names the field: a bad write leaves the stored one in place.
            const saved = await weather.write(body);
            const backend = WEATHER_BACKENDS[saved.provider];
            sendJson(response, 200, {
              ok: true,
              settings: saved,
              attribution: { text: backend.attribution, url: backend.termsUrl },
            });
          } catch (error: unknown) {
            if (isPlatformError(error)) {
              console.error(error);
              sendText(
                response,
                400,
                "The weather settings could not be saved.",
              );
              return true;
            }
            sendText(
              response,
              400,
              error instanceof Error ? error.message : String(error),
            );
          }
          return true;
        }

        sendText(response, 405, "Only GET and PUT are supported.");
        return true;
      }

      if (request.method !== "GET") {
        sendText(response, 405, "Only GET is supported.");
        return true;
      }

      // A foreign page must not spend this PC's outbound request: the search
      // is an admin action like the write above it, not a display's read.
      if (isForeignOrigin(request)) {
        sendText(
          response,
          403,
          "Weather settings are not available to another page.",
        );
        return true;
      }

      const query = url.searchParams.get("q")?.trim() ?? "";

      if (query === "") {
        sendText(response, 400, 'The "q" search term is required.');
        return true;
      }

      if (query.length > MAX_PLACE_QUERY_LENGTH) {
        sendText(
          response,
          400,
          `The "q" search term must be ${MAX_PLACE_QUERY_LENGTH} characters at most.`,
        );
        return true;
      }

      try {
        // The injected fetcher is the asset routes' own, so a route case never
        // reaches the network and this host makes one kind of outbound call.
        sendJson(response, 200, {
          places: await searchWeatherPlaces(fetcher ?? fetch, query),
        });
      } catch (error: unknown) {
        // Redacted and bounded: geocoding needs no key, but an upstream's
        // transport words are still not a browser's to read.
        sendText(
          response,
          502,
          redactForBrowser(
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
      return true;
    }

    // One number, so a display can tell that the theme it shows was saved — and
    // the theme it was assigned, so an assignment made at the host reaches a
    // display nobody walks to. A display read, so it is behind the same guard:
    // what this PC is holding is not something the network enumerates.
    if (url.pathname === "/api/published") {
      if (
        !isLoopbackRemote(request.socket.remoteAddress) &&
        !(await allowed(request, displays))
      ) {
        sendText(response, 403, "This display is not paired with the host.");
        return true;
      }

      const live = published.read();
      const key = await displayKeyFor(request, url, displays);
      // The player reads its glass and its mounting angle from this poll rather
      // than from routes of its own: it is the request a display already makes.
      const presentation = await presentationForDisplay(key, displays);
      let theme: string | null = null;

      // A request that named a theme is on a link, and the link is the person's
      // own instruction for that page: an assignment must not move it, so the
      // host answers none rather than one the follower would act on — and pays
      // no listing for an answer it discards.
      if (!url.searchParams.has("theme")) {
        theme =
          (await assignedThemeForDisplay(activeTheme, key, (id) =>
            themeStore.exists(id),
          )) ?? null;
      }

      sendJson(response, 200, {
        id: live?.id ?? null,
        revision: published.revision(),
        display: {
          theme,
          shape: presentation.shape,
          rotation: presentation.rotation,
        },
      });
      return true;
    }

    // Which curated trios this author reaches for. Author state about this PC,
    // beside the display preferences and out of every theme package; the same
    // asymmetry as `/api/display`, so a paired display may read what this PC
    // holds and only this PC may change it.
    if (url.pathname === "/api/font-favorites") {
      if (fontFavorites === undefined) {
        sendText(response, 404, "Font favorites are not enabled on this host.");
        return true;
      }

      if (request.method === "GET") {
        if (
          !isLoopbackRemote(request.socket.remoteAddress) &&
          !(await allowed(request, displays))
        ) {
          sendText(response, 403, "This display is not paired with the host.");
          return true;
        }

        sendJson(response, 200, { favorites: await fontFavorites.read() });
        return true;
      }

      if (request.method === "PUT") {
        if (!isLoopbackRemote(request.socket.remoteAddress)) {
          sendText(
            response,
            403,
            "Font favorites are available on this PC only.",
          );
          return true;
        }

        try {
          const body = JSON.parse(await readBody(request)) as unknown;
          // The answer is what the editor repaints from, so it carries the
          // stored list rather than an echo of what was sent.
          const favorites = await fontFavorites.write(body);
          sendJson(response, 200, { favorites });
        } catch (error: unknown) {
          if (isPlatformError(error)) {
            console.error(error);
            sendText(response, 400, "The font favorites could not be saved.");
            return true;
          }
          sendText(
            response,
            400,
            error instanceof Error ? error.message : String(error),
          );
        }
        return true;
      }

      sendText(response, 405, "Only GET and PUT are supported.");
      return true;
    }

    if (url.pathname === "/api/health") {
      // A display's liveness probe needs a heartbeat, not this machine's device
      // count, sensor keys and pairing state. Detail stays on loopback.
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendJson(response, 200, { ok: true });
        return true;
      }

      let weatherProblem: string | undefined;

      if (weather !== undefined) {
        // The read is what refreshes the reason: health is a poll, not a file
        // watch, and a rewritten valid file has to clear it.
        await weather.read();
        const problem = weather.problem();
        // The detail is a browser's to read even on loopback, and a read
        // error's own message carries the path it failed on — the person's
        // home directory.
        weatherProblem =
          problem === undefined ? undefined : redactForBrowser(problem);
      }

      sendJson(response, 200, {
        displays: connections.size,
        polling: unionOfKeys(
          [...connections].map((connection) => connection.semanticKeys),
        ),
        unmapped: lastUnmapped(),
        pairing: displays !== undefined,
        ...(weatherProblem === undefined ? {} : { weather: weatherProblem }),
      });
      return true;
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
        return true;
      }

      const binding = options.hosting;

      if (request.method === "PUT") {
        if (binding === undefined) {
          sendText(response, 409, "This host cannot move its binding.");
          return true;
        }

        let body: { readonly lan?: unknown };
        try {
          body = JSON.parse(await readBody(request)) as {
            readonly lan?: unknown;
          };
        } catch {
          sendText(response, 400, "That is not a hosting setting.");
          return true;
        }

        if (typeof body.lan !== "boolean") {
          sendText(response, 400, "Hosting is on or off, and nothing else.");
          return true;
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
          displays: ((await displays?.list()) ?? []).map(peerOf),
        });
        return true;
      }

      if (request.method !== "GET") {
        sendText(response, 405, "Only GET and PUT are supported.");
        return true;
      }

      // A reader that follows a move sees where it landed rather than where it
      // started: the move runs after the PUT's answer, so it can still be in
      // flight here.
      await binding?.idle();

      sendJson(response, 200, {
        ...((await binding?.state()) ?? NO_HOSTING),
        displays: ((await displays?.list()) ?? []).map(peerOf),
      });
      return true;
    }

    return false;
  };
}
