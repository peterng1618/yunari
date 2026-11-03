import type http from "node:http";
import {
  type DisplayShape,
  themeAssetContentType,
} from "@yunari/renderer-core";
import { familyFor } from "../panels/panel-families.js";
import type { ActiveThemeStore } from "../settings/active-theme.js";
import {
  DEFAULT_DISPLAY,
  type DisplayKind,
  type DisplayStore,
  LOCAL_DISPLAY_ID,
} from "../settings/displays.js";
import { requiredDeviceGroups } from "../settings/required-devices.js";
import type { ThemeOriginsStore } from "../settings/theme-origins.js";
import type { ThemeSettingsStore } from "../settings/theme-settings.js";
import { isValidThemeId, type ThemeStore } from "../themes/store.js";
import { SHIPPED_TEMPLATES } from "../themes/templates.js";
import type { ThemeMedia } from "../themes/theme-media.js";
import type { ThumbnailStore } from "../themes/thumbnails.js";
import { isPlatformError, readBody, sendJson, sendText } from "./http.js";
import { displayFor, isLoopbackRemote, knownDisplayKey } from "./identity.js";
import { MAX_THUMBNAIL_BYTES } from "./limits.js";
import type { HostServerOptions } from "./options.js";
import { servePanelPreview } from "./panel-preview-route.js";
import { serveThumbnailCapture } from "./thumbnail-capture-route.js";

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
  /** The glass and mounting angle; `this-pc` answers rect/0. */
  readonly shape: DisplayShape;
  readonly rotation: number;
  /** Present for a display this host drives over a panel's own cable: what its
   *  device is doing, and the commands its driver accepts. Absent for a paired
   *  browser and for a local monitor, which the host does not open. */
  readonly panel?: {
    readonly status: "connected" | "connecting" | "disconnected";
    readonly commands: readonly string[];
    /** The raster size the family declares, so a consumer can size a preview
     *  without opening the device. Absent when no driver claims the ids. */
    readonly geometry?: { readonly width: number; readonly height: number };
  };
}

/**
 * What the map calls `this-pc`, the machine itself.
 *
 * Never read from the display store: `this-pc` is the machine rather than a
 * client anyone paired, so it has no record whose label could be taken. The
 * word matches the heading the host's own pages already use (`public/settings.html`).
 */
const LOCAL_DISPLAY_LABEL = "Host";

export interface ThemeRouteDeps {
  readonly options: HostServerOptions;
  readonly themeStore: ThemeStore;
  readonly activeTheme: ActiveThemeStore | undefined;
  readonly themeSettings: ThemeSettingsStore | undefined;
  readonly themeOrigins: ThemeOriginsStore | undefined;
  readonly thumbnails: ThumbnailStore | undefined;
  readonly themeMedia: ThemeMedia | undefined;
}

/**
 * The theme library's read surface: the listing, the active-theme map, declared
 * assets, per-theme answers, thumbnails and the display-facing document.
 */
export function createThemeRoutes(
  deps: ThemeRouteDeps,
): (
  request: http.IncomingMessage,
  response: http.ServerResponse,
  url: URL,
) => Promise<boolean> {
  const {
    options,
    themeStore,
    activeTheme,
    themeSettings,
    themeOrigins,
    thumbnails,
    themeMedia,
  } = deps;
  const displays: DisplayStore | undefined = options.displays;

  /**
   * The map `/api/themes/active` reads and writes: every display with the theme
   * it holds, and the default a display with no entry of its own falls to.
   *
   * The Host is always present and always first, because it is the display the
   * person reading the page is looking at. A stored record with that id is not
   * possible — the store refuses to mint it — so it is added rather than found.
   */
  async function activeThemeMap(
    store: ActiveThemeStore,
    available: readonly { readonly id: string }[],
  ): Promise<{
    readonly default: string | null;
    readonly displays: readonly ActiveDisplay[];
    /** True when `display-clients.json` is there and unusable. The list is then
     *  fail-closed and empty, and every write refuses — two facts a settings
     *  surface must be able to tell apart from an empty library of displays. */
    readonly displayFileUnreadable: boolean;
  }> {
    const holds = await store.readAll(async (id) =>
      available.some((entry) => entry.id === id),
    );
    // Through `state()` rather than `list()`: the second half is what a settings
    // surface needs, and asking twice could see two different files.
    const displayState = await displays?.state();
    const records = displayState?.displays ?? [];

    return {
      default: holds[DEFAULT_DISPLAY] ?? null,
      displayFileUnreadable: displayState?.unreadable === true,
      displays: [
        {
          id: LOCAL_DISPLAY_ID,
          label: LOCAL_DISPLAY_LABEL,
          kind: "local",
          theme: holds[LOCAL_DISPLAY_ID] ?? null,
          shape: "rect",
          rotation: 0,
        },
        ...records.map((record) => {
          const family =
            record.panel === undefined
              ? undefined
              : familyFor(record.panel.vendorId, record.panel.productId);

          return {
            id: record.id,
            label: record.label,
            kind: record.kind,
            theme: holds[record.id] ?? null,
            shape: record.shape,
            rotation: record.rotation ?? 0,
            // A panel is the one display whose state this host owns: the
            // surface reads whether the device is open and which commands its
            // driver takes, so it can draw a status and a reconnect for a panel
            // that is not attached at all.
            ...(options.panels === undefined || record.kind !== "panel"
              ? {}
              : {
                  panel: {
                    status: options.panels.status(record.id),
                    // A disconnect is the owner's decision, not a missing
                    // device: the surface says the panel stays off rather
                    // than promising the retry loop will bring it back.
                    stopped: options.panels.stopped(record.id),
                    commands: family?.commands ?? [],
                    ...(family === undefined
                      ? {}
                      : { geometry: family.geometry }),
                  },
                }),
          };
        }),
      ],
    };
  }

  return async function handleThemeRoutes(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (url.pathname === "/api/themes") {
      if (request.method !== "GET") {
        sendText(response, 405, "Only GET is supported.");
        return true;
      }
      // A paired display chooses its own theme, so it reads the library it is
      // offered — but only the two fields a chooser names a row by. Costs,
      // ground, origin, facets and a template list describe this PC's library
      // and stay the admin page's business (`vg-758`).
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        const themes = await themeStore.list();
        sendJson(response, 200, {
          themes: themes.map((entry) => ({ id: entry.id, name: entry.name })),
        });
        return true;
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
      return true;
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
        return true;
      }

      const loopback = isLoopbackRemote(request.socket.remoteAddress);

      if (request.method === "GET") {
        if (!loopback) {
          sendText(response, 403, "Settings are available on this PC only.");
          return true;
        }

        const available = await themeStore.list();
        // A theme with no picture has none to request: the page draws its
        // fallback directly when the listing says so, instead of costing a 404
        // per theme on every clean load (`vg-655`).
        const listed = await Promise.all(
          available.map(async (theme) => ({
            ...theme,
            ...(thumbnails !== undefined && (await thumbnails.has(theme.id))
              ? { thumbnail: true as const }
              : {}),
          })),
        );
        sendJson(response, 200, {
          ...(await activeThemeMap(activeTheme, available)),
          themes: listed,
          templates: SHIPPED_TEMPLATES,
        });
        return true;
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
          return true;
        }

        const id = body.id;

        if (typeof id !== "string") {
          sendText(response, 400, "An id is required.");
          return true;
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
            return true;
          }

          key = named;
        } else {
          const record = await displayFor(request, displays);

          if (record === undefined) {
            sendText(
              response,
              403,
              "This display is not paired with the host.",
            );
            return true;
          }

          key = record.id;
        }

        // Only a display this host holds can be given a theme, so a typo is a
        // 404 rather than a new key in the file that no display would read.
        if (loopback && !(await knownDisplayKey(key, displays))) {
          sendText(response, 404, "No such display.");
          return true;
        }

        const available = await themeStore.list();

        // Only a theme that exists can be chosen.
        if (!available.some((entry) => entry.id === id)) {
          sendText(response, 404, "No such theme.");
          return true;
        }

        await activeTheme.write(key, id);

        // A panel plays its theme itself, so a new assignment is a new clip and
        // nothing re-reads it while the old runner is alive. The restart is what
        // makes the assignment visible on the glass, and it is awaited because
        // the device has to be released before it is claimed again — an
        // unawaited close is a reopen that fails with error 5.
        const panels = options.panels;
        const assigned =
          panels === undefined ? undefined : await displays?.find(key);

        if (panels !== undefined && assigned?.kind === "panel") {
          await panels.refresh(key);
        }

        sendJson(response, 200, {
          ok: true,
          ...(await activeThemeMap(activeTheme, available)),
        });
        return true;
      }

      sendText(response, 405, "Only GET and PUT are supported.");
      return true;
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
        return true;
      }
      let id: string;
      let assetPath: string;
      try {
        id = decodeURIComponent(assetMatch[1] ?? "");
        assetPath = decodeURIComponent(assetMatch[2] ?? "");
      } catch {
        sendText(response, 400, "Invalid theme asset path.");
        return true;
      }
      const found = await themeStore.readAsset(id, assetPath);
      if (found === undefined) {
        sendText(response, 404, "Theme asset not found.");
        return true;
      }
      const contentType = themeAssetContentType({
        kind: found.kind,
        path: assetPath,
      });
      if (contentType === undefined) {
        // The declared kind is the authority on what these bytes are. A path it
        // does not admit is a package the host cannot serve the way it says,
        // so nothing is served rather than a type the path chose.
        sendText(response, 415, "That asset's kind and path disagree.");
        return true;
      }
      response.writeHead(200, {
        "content-type": contentType,
        // The kind decided the media type; the browser must not redecide it by
        // sniffing, and the bytes stay inert even if they are a document.
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox; default-src 'none'",
        "cache-control": "no-store",
      });
      response.end(Buffer.from(found.bytes));
      return true;
    }

    // A theme's own answers: which devices *this* theme reads (§145).
    const answersMatch = url.pathname.match(
      /^\/api\/themes\/([^/]+)\/answers$/,
    );
    if (answersMatch) {
      const rawId = decodeURIComponent(answersMatch[1] ?? "");

      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(response, 403, "Settings are available on this PC only.");
        return true;
      }

      if (themeSettings === undefined || !isValidThemeId(rawId)) {
        sendText(response, 404, "No per-theme settings on this host.");
        return true;
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
        return true;
      }

      if (request.method === "GET") {
        const envelope = await themeStore.readEnvelope(rawId);
        sendJson(response, 200, {
          answers: await themeSettings.read(named, rawId),
          required: requiredDeviceGroups(envelope),
        });
        return true;
      }

      if (request.method === "PUT") {
        try {
          const body = JSON.parse(await readBody(request)) as unknown;
          const saved = await themeSettings.write(named, rawId, body);
          sendJson(response, 200, { ok: true, answers: saved });
        } catch (error) {
          // A body the parser or the store's rules refused is the caller's; a
          // failed write names this machine's file and says so only here.
          if (isPlatformError(error)) {
            console.error(error);
            sendText(response, 500, "The theme's answers could not be saved.");
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

    // A panel's own view of the theme video. The page it renders shows no
    // picture or a picture scaled to its glass, so it is served a derived
    // still or a device-sized clip instead of the theme's full-size source.
    // A name the cache does not hold is generated here, before the page can
    // load anything: the cache name is the invalidation check.
    const posterMatch = url.pathname.match(/^\/api\/themes\/([^/]+)\/poster$/);
    if (posterMatch) {
      if (request.method !== "GET") {
        sendText(response, 405, "Only GET is supported.");
        return true;
      }
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(response, 403, "Theme media is available on this PC only.");
        return true;
      }
      const rawId = decodeURIComponent(posterMatch[1] ?? "");
      if (!isValidThemeId(rawId)) {
        sendText(response, 400, "Invalid theme id.");
        return true;
      }
      const envelope =
        themeMedia === undefined
          ? undefined
          : await themeStore.readEnvelope(rawId);
      const media =
        themeMedia === undefined || envelope === undefined
          ? undefined
          : await themeMedia.still(rawId, envelope);
      if (media === undefined) {
        // No video background, or the frame could not be taken. The page falls
        // back to the theme's own asset, which is the behaviour before this
        // route existed.
        sendText(response, 404, "No poster for that theme.");
        return true;
      }
      response.writeHead(200, {
        "content-type": "image/png",
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
      });
      response.end(Buffer.from(media.bytes));
      return true;
    }

    const panelVideoMatch = url.pathname.match(
      /^\/api\/themes\/([^/]+)\/panel-video$/,
    );
    if (panelVideoMatch) {
      if (request.method !== "GET") {
        sendText(response, 405, "Only GET is supported.");
        return true;
      }
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(response, 403, "Theme media is available on this PC only.");
        return true;
      }
      const rawId = decodeURIComponent(panelVideoMatch[1] ?? "");
      if (!isValidThemeId(rawId)) {
        sendText(response, 400, "Invalid theme id.");
        return true;
      }
      const size = panelPixelSize(url.searchParams);
      if (size === undefined) {
        sendText(response, 400, "A panel size needs whole width and height.");
        return true;
      }
      const envelope =
        themeMedia === undefined
          ? undefined
          : await themeStore.readEnvelope(rawId);
      const media =
        themeMedia === undefined || envelope === undefined
          ? undefined
          : await themeMedia.panelVideo(rawId, envelope, size);
      if (media === undefined) {
        sendText(response, 404, "No panel clip for that theme.");
        return true;
      }
      response.writeHead(200, {
        "content-type": "video/mp4",
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
      });
      response.end(Buffer.from(media.bytes));
      return true;
    }

    // A panel-sized PNG of a theme, for an authoring tool that has to see the
    // glass before deploying. It renders through the panels' own browser and
    // never opens the device: a preview must not take a panel away from the
    // theme it is showing.
    const previewMatch = url.pathname.match(
      /^\/api\/themes\/([^/]+)\/panel-preview$/,
    );
    if (previewMatch) {
      if (request.method !== "GET") {
        sendText(response, 405, "Only GET is supported.");
        return true;
      }
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(
          response,
          403,
          "Panel previews are available on this PC only.",
        );
        return true;
      }
      const rawId = decodeURIComponent(previewMatch[1] ?? "");
      if (!isValidThemeId(rawId)) {
        sendText(response, 400, "Invalid theme id.");
        return true;
      }
      const panels = options.panels;
      if (panels === undefined) {
        sendText(response, 503, "This host drives no panels.");
        return true;
      }

      await servePanelPreview({
        response,
        rawId,
        display: url.searchParams.get("display"),
        clip: url.searchParams.get("clip") === "1",
        themeStore,
        displays,
        panels,
      });
      return true;
    }

    // An authoring client with no canvas asks the host to photograph the theme
    // through the player's own renderer.
    const thumbCaptureMatch = url.pathname.match(
      /^\/api\/themes\/([^/]+)\/thumbnail\/capture$/,
    );
    if (thumbCaptureMatch) {
      if (request.method !== "POST") {
        sendText(response, 405, "Only POST is supported.");
        return true;
      }
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(response, 403, "Theme modification is loopback only.");
        return true;
      }

      await serveThumbnailCapture({
        response,
        rawId: decodeURIComponent(thumbCaptureMatch[1] ?? ""),
        themeStore,
        thumbnails,
        panels: options.panels,
      });
      return true;
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
          return true;
        }

        response.writeHead(200, {
          "content-type": "image/png",
          "cache-control": "no-cache",
        });
        response.end(bytes);
        return true;
      }

      if (request.method === "PUT") {
        if (!isLoopbackRemote(request.socket.remoteAddress)) {
          sendText(response, 403, "Theme modification is loopback only.");
          return true;
        }

        const store = thumbnails;

        if (store === undefined || !isValidThemeId(rawId)) {
          sendText(response, 400, "Invalid theme id.");
          return true;
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
              return true;
            }

            chunks.push(buffer);
          }

          await store.write(rawId, new Uint8Array(Buffer.concat(chunks)));
          sendJson(response, 200, { ok: true });
        } catch (error) {
          // A PNG the store would not read is the caller's; a write it could
          // not perform is this machine's, and its path stays off the wire.
          if (isPlatformError(error)) {
            console.error(error);
            sendText(response, 500, "That thumbnail could not be saved.");
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

    const docMatch = url.pathname.match(/^\/api\/themes\/([^/]+)\/document$/);
    if (docMatch) {
      if (request.method !== "GET") {
        sendText(response, 405, "Only GET is supported.");
        return true;
      }
      const rawId = decodeURIComponent(docMatch[1] ?? "");
      if (!isValidThemeId(rawId)) {
        sendText(response, 400, "Invalid theme id.");
        return true;
      }

      // A display's view of the document: a theme that does not validate is
      // one it cannot serve, which is the same answer as a theme that is not
      // there — not the 422 the editor's own open gets. The stored document is
      // the only source: what a display follows moves when a save moves it.
      const envelope = await themeStore.readEnvelope(rawId);
      if (envelope === undefined) {
        sendText(response, 404, "Theme not found.");
        return true;
      }
      sendJson(response, 200, envelope);
      return true;
    }

    return false;
  };
}

/** The panel box a clip is scaled into, or nothing when the query is not two
 *  whole pixel sizes. 4096 is the video envelope's own long edge; a device
 *  beyond it is not a panel this build knows. */
function panelPixelSize(
  params: URLSearchParams,
): { readonly width: number; readonly height: number } | undefined {
  const width = params.get("width");
  const height = params.get("height");
  if (width === null || height === null) return undefined;
  if (!/^\d{1,4}$/u.test(width) || !/^\d{1,4}$/u.test(height)) return undefined;
  const parsed = { width: Number(width), height: Number(height) };
  return parsed.width > 0 &&
    parsed.height > 0 &&
    parsed.width <= 4096 &&
    parsed.height <= 4096
    ? parsed
    : undefined;
}
