import { existsSync } from "node:fs";
import type http from "node:http";
import path from "node:path";
import { needsTrailingSlash } from "../serve/static-path.js";
import type { ActiveThemeStore } from "../settings/active-theme.js";
import type { ThemeStore } from "../themes/store.js";
import { SHIPPED_TEMPLATES } from "../themes/templates.js";
import { sendCertificate, sendHtml, sendText, serveStatic } from "./http.js";
import {
  allowed,
  assignedThemeForDisplay,
  displayKeyFor,
  isLoopbackRemote,
  sessionCookie,
} from "./identity.js";
import { CA_CERTIFICATE_PATH } from "./limits.js";
import type { HostServerOptions } from "./options.js";

export interface PageRouteDeps {
  readonly options: HostServerOptions;
  readonly themeStore: ThemeStore;
  readonly activeTheme: ActiveThemeStore | undefined;
  readonly caFingerprint: string | undefined;
}

/**
 * The dashboard's first-run state. Plain HTML with no build step and no
 * dependency, matching the pairing page.
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
         editor and the player keep, taken rather than authored. This page is
         served to a display over the LAN too, so it names the bundle-exempt
         path rather than \`/settings\`, which is loopback-only. -->
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
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
        The Host has no saved theme, so there is nothing to display. Open the
        editor to start from the ${SHIPPED_TEMPLATES[0]?.name ?? "template"},
        or build one of your own, then save it to this PC's library.
      </p>
      <a href="/editor/">Open the editor</a>
    </main>
  </body>
</html>`;
}

/**
 * The two routes an unpaired device reaches before any gate, the root token
 * exchange, the display document guard, and the host's own pages.
 */
export function createPageRoutes(deps: PageRouteDeps): {
  handleEntry: (
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ) => Promise<boolean>;
  handleSessionExchange: (
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ) => Promise<boolean>;
  guardDisplay: (
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ) => Promise<boolean>;
  handleAdmin: (
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ) => Promise<boolean>;
} {
  const { options, themeStore, activeTheme } = deps;
  const bundles = options.bundles;
  const displays = options.displays;
  const caCertificate = options.caCertificate;
  /** Hashed from the bytes being served, once per server: a value passed
   *  alongside them could describe a different certificate. */
  const caFingerprint = deps.caFingerprint;

  async function handleEntry(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    // Before every gate below, and before pairing in particular: a device
    // reading this is being asked to trust the host, which is the step that has
    // to come first.
    if (url.pathname === CA_CERTIFICATE_PATH && request.method === "GET") {
      if (caCertificate === undefined || caFingerprint === undefined) {
        sendText(response, 404, "This host serves no certificate of its own.");
        return true;
      }

      sendCertificate(response, caCertificate, caFingerprint);
      return true;
    }

    // The page a device with no credential opens, so it answers before every
    // gate below. It is served from the admin root the chooser document shares
    // — source, not a bundle — and it carries no reading of its own: the code it
    // was opened with is what pairs the device, and the exchange is its only
    // call.
    if (url.pathname === "/pair" && request.method === "GET") {
      if (bundles.admin === undefined) {
        sendText(
          response,
          404,
          "The pairing page is missing from this installation.",
        );
        return true;
      }

      await serveStatic(
        request,
        response,
        bundles.admin,
        "/pair.html",
        "The pairing page is missing from this installation.",
      );
      return true;
    }

    // The pairing page's one rule, imported rather than restated in the page.
    // An unpaired device has no credential, so this answers before every gate
    // for the same reason `/pair` does; it is one fixed path, not the admin
    // root, so nothing else under the settings page becomes LAN-readable.
    if (url.pathname === "/rotation.js" && request.method === "GET") {
      if (bundles.admin === undefined) {
        sendText(
          response,
          404,
          "The pairing page is missing from this installation.",
        );
        return true;
      }

      await serveStatic(
        request,
        response,
        bundles.admin,
        "/rotation.js",
        "The pairing page is missing from this installation.",
      );
      return true;
    }

    return false;
  }

  async function handleSessionExchange(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    // **The one route that still reads a query token**, and only to retire it.
    // An old pairing link or a re-find target carries `?session=`; the root
    // exchanges it for the cookie and redirects it out of the address bar. It
    // sits ahead of the display guard below because that guard is what the
    // query token cannot pass — the cookie is the credential from here on.
    // A token no display holds sets no cookie and falls through, so the caller
    // is served exactly what it was before this route existed.
    //
    // It runs whether or not the link named `data`: a display URL the library
    // resolved carries `data=live`, and gating on its absence left exactly
    // those links with a token and no cookie — a 403 from the LAN guard below
    // that no reload could fix.
    if (url.pathname !== "/") return false;

    const offered = url.searchParams.get("session");

    if (offered === null) return false;

    const record = await displays?.authenticate(offered);

    if (record === undefined) return false;

    // The next request carries the cookie instead, so the display's own
    // `lastSeenAt` is paid there rather than twice here. Everything else
    // the link named — a theme, a local display — rides along; only the
    // token leaves the address bar.
    url.searchParams.delete("session");
    const query = url.searchParams.toString();
    response.writeHead(302, {
      location: query === "" ? "/" : `/?${query}`,
      "set-cookie": sessionCookie(offered, request),
      "cache-control": "no-store",
    });
    response.end();
    return true;
  }

  async function guardDisplay(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    // **The bundle is not dashboard content**, and it comes before this guard
    // because the browser fetches some of it itself: the favicon probe, the
    // install's manifest and its worker script. A credential rides in the
    // cookie now, but those requests are not the display's own and a paired
    // phone refused them was served the document with a blank page. The bundle
    // is the same bytes any loopback visitor already has: no reading, no theme,
    // no device in it. Everything this guard exists to protect stays behind it —
    // `/api/themes/**`, the sample stream, `/api/display` — and `/editor` keeps
    // its own loopback guard.
    const isBundleAsset =
      url.pathname.startsWith("/assets/") ||
      // The browser probes this unprompted and without a token, and the repo
      // already links the mark deliberately so it does not.
      url.pathname === "/favicon.svg" ||
      // The chooser's React bundle. It is the chooser's own bytes — no
      // reading, no theme, no device — and the page that loads it is served to
      // a display over the LAN, so its scripts must survive the same
      // credential races the player's assets do.
      url.pathname.startsWith("/admin/") ||
      // The two files an installable display needs, and the browser fetches
      // both itself: `register()` carries no session and a `<link
      // rel="manifest">` fetch carries none either, so a paired phone was
      // refused the manifest and the worker script and the player would not
      // install. Same rule as the assets beside them — bundle bytes, no
      // reading, no theme, no device.
      url.pathname === "/manifest.webmanifest" ||
      url.pathname === "/sw.js";

    // Display reads stay open on loopback; from the LAN they need a session so
    // dashboard content is not served to every device on the network.
    if (
      !isBundleAsset &&
      !isLoopbackRemote(request.socket.remoteAddress) &&
      !(await allowed(request, displays))
    ) {
      // **A document load is answered the pairing page, not a bare refusal.**
      // A display whose credential is gone — a cleared cookie on a phone, a
      // retired record, a stale `?session=` — is a browser with no way back:
      // a text 403 is not a page, so nothing on the device can take it to the
      // one exchange that can pair it. Every such dead end was answered by
      // claiming a new code, which is how one phone accumulated four records.
      // Only a navigation is redirected this way; an API call still gets the
      // refusal, so no fetch learns to follow a page it cannot parse. A host
      // with no pairing page answers 404 there, which says more than a 403.
      if (
        request.method === "GET" &&
        (request.headers["sec-fetch-dest"] === "document" ||
          request.headers.accept?.includes("text/html") === true ||
          url.pathname === "/")
      ) {
        response.writeHead(302, {
          location: "/pair?reason=unpaired",
          "cache-control": "no-store",
        });
        response.end();
        return true;
      }

      sendText(response, 403, "This display is not paired with the host.");
      return true;
    }

    return false;
  }

  async function handleAdmin(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    // Settings is an admin surface: it changes what every display shows, so it
    // stays on this PC like the editor. **The editor's Settings mode is the one
    // settings surface** — the host no longer ships a second, hand-written copy
    // — so `/settings` forwards to it and the gate stays in front of the
    // forward. The URL is kept as the entry point a bookmark and the docs name.
    if (url.pathname === "/settings" || url.pathname === "/settings/") {
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(response, 403, "Settings are available on this PC only.");
        return true;
      }

      response.writeHead(302, {
        location: "/editor/?mode=settings",
        "cache-control": "no-store",
      });
      response.end();
      return true;
    }

    // The chooser's React bundle, built by `vite.admin.config.ts`. The
    // document itself is source (`/chooser.html`); only its one script and
    // stylesheet are built.
    if (url.pathname.startsWith("/admin/")) {
      if (bundles.adminUi === undefined) {
        sendText(
          response,
          404,
          "The admin bundle is not built. From the repository's src/web directory, run: npm run build -w @yunari/host",
        );
        return true;
      }

      await serveStatic(
        request,
        response,
        bundles.adminUi,
        url.pathname.slice("/admin".length),
        "The admin bundle is not built. From the repository's src/web directory, run: npm run build -w @yunari/host",
        false,
      );
      return true;
    }

    if (url.pathname === "/editor" || url.pathname.startsWith("/editor/")) {
      // Editing remains localhost-only even when the display server binds to the LAN.
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(response, 403, "The editor is available on this PC only.");
        return true;
      }

      // Preserve the editor mount as the base for relative assets.
      if (needsTrailingSlash(url.pathname, "/editor")) {
        const query = url.search;
        response.writeHead(302, {
          location: `/editor/${query}`,
          "cache-control": "no-store",
        });
        response.end();
        return true;
      }

      await serveStatic(
        request,
        response,
        bundles.editor,
        url.pathname.slice("/editor".length) || "/",
        "The editor bundle is not built. Run: npx vite build packages/editor",
      );
      return true;
    }

    // Host-served player uses a stored theme and live data; standalone preview stays deterministic.
    if (url.pathname === "/" && !url.searchParams.has("data")) {
      // Resolution order, in the consumer's terms: an explicit link, then the
      // theme this display was assigned, then the default this PC holds, then
      // the only theme if there is exactly one. Several themes and no choice
      // means the library is the right next step.
      //
      // **A saved theme needs no overlay here.** The publish revision only
      // tells a page that the theme it already resolved has been saved, so the
      // document it reads and the theme it resolved cannot disagree; a display
      // is served what its assignment says and an assignment can still move it.
      const available = await themeStore.list();
      const requested = url.searchParams.get("theme");
      const exists = async (id: string): Promise<boolean> =>
        available.some((entry) => entry.id === id);
      const stored =
        requested === null
          ? await assignedThemeForDisplay(
              activeTheme,
              await displayKeyFor(request, url, displays),
              exists,
            )
          : undefined;
      const theme =
        requested ??
        stored ??
        (available.length === 1 ? available[0]?.id : undefined);
      // Where the theme came from, because every display arrives carrying one:
      // the player reads this to know whether an assignment may move it at all.
      // Without it, the person's own link and the host's own resolution are the
      // same URL, and the display's poll would be answered `null` for ever.
      const source = requested === null ? "map" : "link";

      if (theme === undefined) {
        // Nothing to show: either a first run, or a choice to make. Both lead
        // the consumer somewhere they can act rather than to an error.
        if (available.length > 0) {
          // Several themes and none chosen. The chooser is one of the host's
          // own pages: a source document that loads the React admin entry. Its
          // rows are the one owner of a theme row, so it draws the thumbnail
          // and the hatched stand-in nobody else re-spells.
          //
          // The document alone is not a chooser: its rows come from
          // `/admin/chooser.js`. With that missing, the page would be blank and
          // its `<noscript>` fallback hidden, so refuse instead of shipping an
          // empty display to the LAN.
          const built =
            bundles.adminUi !== undefined &&
            existsSync(path.join(bundles.adminUi, "chooser.js"));
          if (bundles.admin !== undefined && built) {
            await serveStatic(
              request,
              response,
              bundles.admin,
              "/chooser.html",
              "The theme chooser is missing from this installation.",
            );
            return true;
          }

          if (bundles.admin !== undefined) {
            sendText(
              response,
              404,
              "The theme chooser is not built. From the repository's src/web directory, run: npm run build -w @yunari/host",
            );
            return true;
          }

          sendText(
            response,
            404,
            "The theme chooser is missing from this installation.",
          );
          return true;
        }

        sendHtml(response, 200, firstRunPage());
        return true;
      }
      url.searchParams.set("theme", theme);
      url.searchParams.set("data", "live");
      url.searchParams.set("theme-source", source);
      response.writeHead(302, {
        location: `${url.pathname}?${url.searchParams.toString()}`,
        "cache-control": "no-store",
      });
      response.end();
      return true;
    }

    await serveStatic(
      request,
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
    return true;
  }

  return { handleEntry, handleSessionExchange, guardDisplay, handleAdmin };
}
