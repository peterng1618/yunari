import type http from "node:http";
import { readFile } from "node:fs/promises";
import { isCatalogueId } from "@yunari/renderer-core";
import { handleSubmitRoute } from "../catalogue/submit.js";
import type { PublishedStore } from "../serve/published.js";
import type { StoreSessionStore } from "../settings/store-session.js";
import type { ThemeOriginsStore } from "../settings/theme-origins.js";
import {
  editorThemePath,
  installCatalogueItem,
  parseCatalogueInstallRequest,
} from "../store/install.js";
import { importThemePackage } from "../themes/import.js";
import {
  type InstallRequest,
  installCatalogueItem as installThemeItem,
  parseInstallRequest,
} from "../themes/install.js";
import { normalizeVideo } from "../themes/normalize-video.js";
import {
  isValidThemeId,
  MAX_ASSET_BYTES,
  ThemeAssetLimitError,
  ThemeConflictError,
  type ThemeStore,
  ThemeTooLargeError,
  ThemeValidationError,
} from "../themes/store.js";
import { backgroundVideoOf, type ThemeMedia } from "../themes/theme-media.js";
import {
  type ThumbnailStore,
  thumbnailCaptureSize,
} from "../themes/thumbnails.js";
import { TrashRefusal } from "../themes/trash.js";
import {
  type DecodedThemeSave,
  decodeThemeSave,
  encodeThemeContent,
} from "../themes/wire.js";
import {
  isPlatformError,
  LARGE_BODY_BUSY,
  LargeBodyBusyError,
  readBody,
  readBytes,
  sendJson,
  sendText,
  writeWebResponse,
} from "./http.js";
import { isForeignOrigin, isLoopbackRemote } from "./identity.js";
import {
  MAX_THEME_UPLOAD_BYTES,
  MAX_VIDEO_SOURCE_BYTES,
  VIDEO_OVER_ASSET_BOUND,
} from "./limits.js";
import type { HostServerOptions } from "./options.js";

/** What a theme read answers: the stored record, or undefined for a theme the
 *  store will not serve. */
type ThemeRecord = Awaited<ReturnType<ThemeStore["read"]>>;

export interface ThemeWriteDeps {
  readonly options: HostServerOptions;
  readonly themeStore: ThemeStore;
  readonly themeOrigins: ThemeOriginsStore | undefined;
  readonly thumbnails: ThumbnailStore | undefined;
  readonly themeMedia: ThemeMedia | undefined;
  readonly fetcher: typeof fetch | undefined;
  readonly largeBody: {
    run<T>(work: () => Promise<T>): Promise<T>;
  };
  readonly published: PublishedStore;
  readonly now: () => number;
  readonly storeOrigin: string | undefined;
  readonly storeSession: StoreSessionStore | undefined;
}

/**
 * The theme library's write surface: package import, video normalization,
 * catalogue install, submission, and the stored theme's open/save/remove.
 */
export function createThemeWrites(
  deps: ThemeWriteDeps,
): (
  request: http.IncomingMessage,
  response: http.ServerResponse,
  url: URL,
) => Promise<boolean> {
  const {
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
  } = deps;

  return async function handleThemeWrites(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    // A package the author brings in is a library write, not a document: the
    // bytes land in the folder and the answer is the id they landed under, so
    // the theme survives the editor closing and appears in the local list. The
    // host reads the package — the browser posts bytes and maps the answer —
    // because the id rule and the no-overwrite rule are the folder's rules.
    //
    // Matched before `/api/themes/:id`, which would otherwise read `import` as
    // a theme id — the same reason `/api/themes/active` is answered above.
    if (url.pathname === "/api/themes/import") {
      if (request.method !== "POST") {
        sendText(response, 405, "Only POST is supported.");
        return true;
      }
      // Importing is a theme modification: a paired phone reads themes, it does
      // not add to the library.
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(response, 403, "Theme modification is loopback only.");
        return true;
      }
      // The central guard already refuses this; kept beside the sibling
      // modification routes as defence in depth.
      if (isForeignOrigin(request)) {
        sendText(response, 403, "That request is from another origin.");
        return true;
      }

      let body: Uint8Array;
      try {
        body = await largeBody.run(() =>
          readBytes(request, MAX_THEME_UPLOAD_BYTES),
        );
      } catch (error) {
        if (error instanceof LargeBodyBusyError) {
          sendText(response, 429, LARGE_BODY_BUSY);
          return true;
        }
        sendText(response, 413, "That package is too large to import.");
        return true;
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
        return true;
      }
      sendJson(response, 200, { ok: true, id: imported.id });
      return true;
    }

    // A source video brought into the publish envelope, or copied untouched
    // when it already conforms. Like every theme modification it is this PC's
    // business; the encoder never sees a peer's bytes. Matched before
    // `/api/themes/:id` for the same reason `import` is.
    if (url.pathname === "/api/themes/normalize-video") {
      if (request.method !== "POST") {
        sendText(response, 405, "Only POST is supported.");
        return true;
      }
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(response, 403, "Theme modification is loopback only.");
        return true;
      }
      if (isForeignOrigin(request)) {
        sendText(response, 403, "That request is from another origin.");
        return true;
      }

      let source: Uint8Array;
      try {
        source = await largeBody.run(() =>
          readBytes(request, MAX_VIDEO_SOURCE_BYTES),
        );
      } catch (error) {
        if (error instanceof LargeBodyBusyError) {
          sendText(response, 429, LARGE_BODY_BUSY);
          return true;
        }
        sendText(response, 413, "That video is too large to normalize.");
        return true;
      }

      // A trim is two query values, not a JSON envelope: the body stays the
      // video's own bytes, so the route still streams one large object.
      const start = url.searchParams.get("startMs");
      const end = url.searchParams.get("endMs");
      let trim:
        | { readonly startMs: number; readonly endMs: number }
        | undefined;
      if (start !== null || end !== null) {
        const startMs = start === null ? Number.NaN : Number(start);
        const endMs = end === null ? Number.NaN : Number(end);
        if (
          !Number.isFinite(startMs) ||
          !Number.isFinite(endMs) ||
          startMs < 0 ||
          endMs <= startMs
        ) {
          sendText(response, 400, "That trim is not a usable range.");
          return true;
        }
        trim = { startMs, endMs };
      }

      const normalized = await normalizeVideo(
        source,
        trim === undefined ? {} : { trim },
      );
      if (!normalized.ok) {
        // The normalizer's own sentence: it names which rule was broken, and a
        // sentence composed here would lose that.
        sendJson(response, 200, { ok: false, message: normalized.message });
        return true;
      }
      // The store refuses an asset over its per-asset bound at save, so the
      // import path refuses it first rather than declaring what cannot persist.
      if (normalized.bytes.byteLength > MAX_ASSET_BYTES) {
        sendJson(response, 200, { ok: false, message: VIDEO_OVER_ASSET_BOUND });
        return true;
      }
      sendJson(response, 200, {
        ok: true,
        bytesBase64: Buffer.from(normalized.bytes).toString("base64"),
        reencoded: normalized.reencoded,
      });
      return true;
    }

    // The catalogue's Install action. The host fetches the package because the
    // editor's browser cannot, and the operation records
    // the origin after the write so the listing can say where a theme came from.
    // Matched here, before `/api/themes/:id`, for the same reason `import` is.
    if (url.pathname === "/api/themes/install") {
      if (request.method !== "POST") {
        sendText(response, 405, "Only POST is supported.");
        return true;
      }
      // Installing is a theme modification: a paired phone reads themes, it does
      // not add to the library.
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(response, 403, "Theme modification is loopback only.");
        return true;
      }
      // A loopback address is not the same origin: any page can POST here with
      // a body no preflight covers, and this route replaces a library copy.
      if (isForeignOrigin(request)) {
        sendText(response, 403, "That request is from another origin.");
        return true;
      }
      // No origin owner, no install: the record is half of what this route
      // promises, and a theme that lands without one reads as a theme that did
      // not come from the catalogue.
      if (themeOrigins === undefined) {
        sendText(response, 503, "This host records no theme origins.");
        return true;
      }

      let raw: string;
      try {
        raw = await readBody(request);
      } catch {
        // `readBody`'s only refusal is its size limit; the import route answers
        // the same class of input with 413.
        sendText(response, 413, "That install request is too large.");
        return true;
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
          return true;
        }
        install = parsed;
      } catch {
        sendText(response, 400, "That install request is not JSON.");
        return true;
      }

      const installed = await installThemeItem(install, {
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
        return true;
      }
      sendJson(response, 200, { ok: true, id: installed.id });
      return true;
    }

    // The store's install for every kind: the dispatcher owns the download,
    // the digest check and each kind's writer. Loopback and origin checks are
    // the same as every other modification on this host.
    if (url.pathname === "/api/store/install") {
      if (request.method !== "POST") {
        sendText(response, 405, "Only POST is supported.");
        return true;
      }
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(response, 403, "Store installs are loopback only.");
        return true;
      }
      if (isForeignOrigin(request)) {
        sendText(response, 403, "That request is from another origin.");
        return true;
      }

      let raw: string;
      try {
        raw = await readBody(request);
      } catch {
        sendText(response, 413, "That install request is too large.");
        return true;
      }

      let install: ReturnType<typeof parseCatalogueInstallRequest>;
      try {
        install = parseCatalogueInstallRequest(JSON.parse(raw));
      } catch {
        sendText(response, 400, "That install request is not JSON.");
        return true;
      }
      if (install === undefined) {
        sendText(
          response,
          400,
          "An install needs packageUrl, catalogueId, kind, version, sha256 and bytes.",
        );
        return true;
      }

      const installed = await installCatalogueItem(install, {
        stores: {
          ...(themeOrigins === undefined
            ? {}
            : {
                theme: {
                  store: themeStore,
                  origins: themeOrigins,
                  ...(thumbnails === undefined ? {} : { thumbnails }),
                  ...(fetcher === undefined ? {} : { fetch: fetcher }),
                },
              }),
          ...(options.widgetPacks === undefined
            ? {}
            : { widgetPacks: options.widgetPacks }),
          ...(options.pathPresets === undefined
            ? {}
            : { pathPresets: options.pathPresets }),
          ...(options.extensions === undefined
            ? {}
            : { extensions: options.extensions }),
          ...(options.editorThemesDirectory === undefined
            ? {}
            : { editorThemesDirectory: options.editorThemesDirectory }),
        },
        ...(fetcher === undefined ? {} : { fetch: fetcher }),
        ...(storeOrigin === undefined ? {} : { storeOrigin }),
      });
      if (!installed.ok) {
        const status =
          installed.stage === "download"
            ? 502
            : installed.stage === "store"
              ? 500
              : 400;
        sendText(response, status, installed.message);
        return true;
      }
      sendJson(response, 200, {
        ok: true,
        id: installed.id,
        consentRequired: installed.consentRequired,
      });
      return true;
    }

    // The bytes of an editor theme the store installed. The settings import
    // control reads one back through this route, so the id is the catalogue's
    // and the file name is this host's own rule.
    const editorThemeMatch = url.pathname.match(/^\/api\/editor-themes\/([^/]+)$/);
    if (editorThemeMatch) {
      if (request.method !== "GET") {
        sendText(response, 405, "Only GET is supported.");
        return true;
      }
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(response, 403, "Editor themes are available on this PC only.");
        return true;
      }
      const id = decodeURIComponent(editorThemeMatch[1] ?? "");
      if (!isCatalogueId(id)) {
        sendText(response, 400, "Invalid editor theme id.");
        return true;
      }
      if (options.editorThemesDirectory === undefined) {
        sendText(response, 404, "This host keeps no editor themes.");
        return true;
      }
      let bytes: Buffer;
      try {
        bytes = await readFile(editorThemePath(options.editorThemesDirectory, id));
      } catch {
        sendText(response, 404, "Editor theme not found.");
        return true;
      }
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "application/octet-stream",
        "content-length": String(bytes.byteLength),
      });
      response.end(bytes);
      return true;
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
      return true;
    }

    const themeMatch = url.pathname.match(/^\/api\/themes\/([^/]+)$/);
    if (!themeMatch) return false;

    const rawId = decodeURIComponent(themeMatch[1] ?? "");
    if (request.method === "GET") {
      // The whole-theme read carries every asset as base64, which is the
      // editor's shape, not a reading a display needs: a display uses the
      // document, asset and answers routes.
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(response, 403, "Themes are available on this PC only.");
        return true;
      }
      if (!isValidThemeId(rawId)) {
        sendText(response, 400, "Invalid theme id.");
        return true;
      }
      let record: ThemeRecord;
      try {
        record = await themeStore.read(rawId);
      } catch (error) {
        // A theme that is present and does not validate is understood and
        // its semantics are invalid, which is exactly 422 — RFC 9110
        // §15.5.21. Not the 404 an absent id gets, and not a 400 that would
        // blame the request: the validator's own issues travel with it, so
        // the editor can report the reason instead of a status number.
        if (error instanceof ThemeValidationError) {
          sendJson(response, 422, {
            error: `Theme "${rawId}" is stored but does not validate.`,
            issues: error.issues,
          });
          return true;
        }
        // A stored document past the size the store will read is understood
        // and too large to serve, which is the same 413 every other themes
        // route answers an over-large thing with — and the author is told the
        // theme is there, which is the half a 404 got wrong.
        // RFC 9110 §15.5.14 frames 413 around *request*
        // content and this is a stored document on a GET; the stretch is
        // taken deliberately, because inventing a second size-ish status
        // would be worse vocabulary than reusing this codebase's own.
        if (error instanceof ThemeTooLargeError) {
          sendText(response, 413, error.message);
          return true;
        }
        throw error;
      }
      if (record === undefined) {
        sendText(response, 404, "Theme not found.");
        return true;
      }
      // The editor reads a theme back the way it wrote one, so the pair of
      // routes is symmetric: what a save put in the folder, an open takes out
      // — plus the `base` that says which stored document this is.
      sendJson(response, 200, encodeThemeContent(record, record.base));
      return true;
    }

    if (request.method === "PUT") {
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(response, 403, "Theme modification is loopback only.");
        return true;
      }
      if (!isValidThemeId(rawId)) {
        sendText(response, 400, "Invalid theme id.");
        return true;
      }

      let body: string;
      try {
        body = await largeBody.run(() =>
          readBody(request, MAX_THEME_UPLOAD_BYTES),
        );
      } catch (error) {
        if (error instanceof LargeBodyBusyError) {
          sendText(response, 429, LARGE_BODY_BUSY);
          return true;
        }
        sendText(response, 413, "That theme is too large to save.");
        return true;
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
        return true;
      }

      try {
        // The document as it stood before this save: the only way to tell
        // whether the background video or its declared frame moved.
        const previous = await themeStore.readEnvelope(rawId);
        const saved = await themeStore.write(rawId, decoded.content, {
          ...(decoded.base === undefined ? {} : { base: decoded.base }),
          overwrite: decoded.overwrite,
        });

        // A cached still or panel clip is named by the video asset and frame it
        // was made from. The name changes with either, but the bytes can change
        // under the same path, so a save that carried the video (or changed the
        // frame) drops the theme's entries; the next panel request regenerates
        // them before it can load anything. No extraction happens here.
        const before = backgroundVideoOf(previous);
        const after = backgroundVideoOf(decoded.content.envelope);
        const videoChanged =
          before?.asset.path !== after?.asset.path ||
          before?.frame !== after?.frame ||
          (after !== undefined &&
            decoded.content.assets[after.asset.path] !== undefined);
        if (themeMedia !== undefined && videoChanged) {
          await themeMedia.forget(rawId).catch((error) => {
            // A cache that could not be cleared is stale, not fatal: the theme
            // itself was saved and the panel still draws.
            console.error(error);
          });
        }

        // A stored theme always has a library picture. The editor draws one
        // from its live canvas and uploads it after saving; a client that
        // cannot draw leaves the host to fill the gap. Checking first keeps a
        // save from starting a browser for a picture the theme already has. A
        // failed capture is the picture's failure, never the save's: the
        // document is already stored.
        if (
          thumbnails !== undefined &&
          options.panels?.captureTheme !== undefined
        ) {
          const hasPicture = await thumbnails.has(rawId).catch(() => false);
          if (!hasPicture) {
            try {
              const picture = await options.panels.captureTheme(
                rawId,
                thumbnailCaptureSize(decoded.content.envelope.artboard),
              );
              await thumbnails.write(rawId, picture);
            } catch (error) {
              console.error(
                `Theme ${rawId}: the library picture could not be rendered: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
          }
        }

        // **Release running panels before publishing.** A panel's page reloads
        // the moment the revision moves; a runner still holding it would then
        // capture the new UI and push it over the device's old clip, before the
        // changed clip is uploaded (TURZX, 2026-11-02). The clip comparison
        // restarts only the panel whose clip changed, and that restart releases
        // the old page before the new one is shown. A panel whose clip is
        // unchanged keeps running and picks the new UI up by itself.
        const panels = options.panels;
        if (panels !== undefined) {
          for (const displayId of panels.running()) {
            try {
              await panels.refreshVideo(displayId);
            } catch (error) {
              console.error(
                `Panel ${displayId}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
          }
        }

        // A save is the only moment a theme becomes authoritative, so it is
        // also the only moment a display is told to re-read it. The revision
        // moves and every page showing this theme reloads once — scene and
        // background together. Editing sends nothing.
        published.publish(rawId);

        sendJson(response, 200, { ok: true, ...saved });
      } catch (error) {
        // A refusal is not a malformed theme: nothing was written, the
        // stored version is intact, and the author is the one who has to
        // choose what happens next — so it is not dressed as a 400.
        if (error instanceof ThemeConflictError) {
          sendText(response, 409, error.message);
          return true;
        }
        // The same 413 this route already answers an oversized body with: the
        // theme is well-formed and the author is the one who has to make it
        // smaller, so it is not dressed as a malformed request either.
        if (error instanceof ThemeAssetLimitError) {
          sendText(response, 413, error.message);
          return true;
        }
        // The document itself past the store's write bound: the same 413 the
        // GET of such a stored theme answers, and for the same reason — the
        // document is well-formed and the author has to make it smaller.
        if (error instanceof ThemeTooLargeError) {
          sendText(response, 413, error.message);
          return true;
        }
        // A theme the store's own rules refused is the caller's, with the
        // store's words; a write the filesystem refused is this machine's,
        // and its message names a path the browser must not read.
        if (isPlatformError(error)) {
          console.error(error);
          sendText(response, 500, "That theme could not be saved.");
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

    if (request.method === "DELETE") {
      // Removing authored work is this PC's business, like saving it: a
      // paired phone reads themes, it does not lose them.
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(response, 403, "Theme modification is loopback only.");
        return true;
      }
      if (!isValidThemeId(rawId)) {
        sendText(response, 400, "Invalid theme id.");
        return true;
      }

      // The store moves the folder to the OS trash and
      // answers false for anything it would not have listed, so a 404 here
      // means the same "no such theme" an open would have said.
      let removed: boolean;

      try {
        removed = await themeStore.remove(rawId);
      } catch (error) {
        // A save in flight answers the store's own retry sentence: plain
        // text, no path, and the caller is the one who can act on it. A
        // platform refusal — an errno, or the trash's own wrapper around a
        // child process's stderr — names the folder, so it goes to the
        // console and the caller is told only that the removal did not happen.
        if (error instanceof TrashRefusal || isPlatformError(error)) {
          console.error(error);
          sendText(response, 500, "That theme could not be removed.");
          return true;
        }
        sendText(
          response,
          500,
          error instanceof Error ? error.message : String(error),
        );
        return true;
      }

      // The origin goes only with a removal that happened, because it is a
      // fact about a copy that is on disk. **Its failure cannot undo the
      // removal**: the folder is already in the trash, so answering a failure
      // here would report a removal that did happen as one that did not. The
      // stale origin is logged and the removal stands.
      if (removed) {
        try {
          await themeOrigins?.removeTheme(rawId);
        } catch (error) {
          console.error(error);
        }

        // Derived pictures of a theme nobody can open again. A refusal is
        // logged and the removal stands: the folder is already in the trash.
        await themeMedia?.forget(rawId).catch((error) => {
          console.error(error);
        });

        // A removed theme's per-display answers are answers about a document
        // nobody can open again. Like the origin, their failure cannot undo
        // the removal: the folder is already in the trash, so it is logged
        // and the removal stands.
        try {
          await options.themeSettings?.removeTheme(rawId);
        } catch (error) {
          console.error(error);
        }

        // A display must not be told to reload a document that no longer
        // exists. Clearing moves the revision, so a page showing it falls
        // back to its assignment.
        if (published.read()?.id === rawId) published.clear();
      }

      sendJson(
        response,
        removed ? 200 : 404,
        removed
          ? { ok: true }
          : { error: `No theme "${rawId}" in this library.` },
      );
      return true;
    }

    sendText(response, 405, "Only GET, PUT and DELETE are supported.");
    return true;
  };
}
