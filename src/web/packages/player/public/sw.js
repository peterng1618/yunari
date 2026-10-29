/**
 * The player's service worker — the shell offline, never a reading.
 *
 * Served at the host's root, so its scope is `/` with no
 * `Service-Worker-Allowed` header. The host refuses an
 * unpaired reader everything else, which is why this path is on the
 * bundle-asset allowlist: the browser fetches this file itself, before a
 * document exists to carry the session cookie, so it cannot be gated on one.
 *
 * **`/api/**` is never cached.** The theme document, its packaged assets and
 * the sample stream are the live data the host owns, and an offline display
 * showing yesterday's numbers as though they were live is the fabrication this
 * project forbids. Offline, the shell draws and the player's own load-failure
 * page says the theme could not be loaded — which is what it says, and it is
 * true.
 *
 * Plain JavaScript on purpose: Vite copies `public/` verbatim, so this file is
 * the one the browser is given rather than a build of it.
 */

// v2 because v1 keyed the document by its own URL and so holds a display's
// session token. `activate` deletes every other `yunari-*` cache, which is
// what clears a credential already on a display's disk.
const SHELL_CACHE = "yunari-shell-v2";
/** Stable names, so they can be precached without a build-time list. The
 *  content-hashed bundle assets are cached as they are fetched instead. */
const SHELL_FILES = ["/manifest.webmanifest", "/favicon.svg"];
/**
 * The document's cache key, and deliberately **not** the URL that asked for it.
 * It is also the only navigation path this worker caches: any other path is a
 * different page and passes through.
 *
 * The document is the same bytes whatever the query asked for (the theme is
 * read from the query at runtime, and the HTML names neither), and a request
 * can still arrive carrying `?session=<token>` from an old link or a re-find
 * target, so it is stored once under what it *is* and read back by that same
 * key. A credential must never become a cache key: it would outlive clearing
 * history and the host could not reach it when the display is revoked.
 */
const SHELL_DOCUMENT = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("yunari-") && key !== SHELL_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      // A display that is already open is controlled from here, which is what
      // makes the *next* navigation the one that fills the cache.
      .then(() => self.clients.claim()),
  );
});

/** Best effort: a cache that refused an entry must not fail the request. */
async function remember(cacheKey, response) {
  try {
    const cache = await caches.open(SHELL_CACHE);
    await cache.put(cacheKey, response);
  } catch {
    /* Not cacheable; the display still got its answer. */
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    // Only the player's own document is cached. Any other navigation — the
    // editor, the settings page, a bundle path — passes through uncached, so
    // an offline display is never handed the editor's document in place of
    // the page it asked for.
    if (url.pathname !== SHELL_DOCUMENT) return;

    // **The network answers first, always.** The host marks the document
    // `no-store` because entry HTML must not retain references to an old
    // build, and a cache-first navigation would keep a display on a shell the
    // host has already replaced. The cache is the offline fallback and
    // nothing else.
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Under `SHELL_DOCUMENT` and not under `request`: the request's URL
          // is the display's own and may name a theme, an old session token or
          // nothing at all.
          if (response.ok) void remember(SHELL_DOCUMENT, response.clone());
          return response;
        })
        .catch(async () => {
          // The key it was stored under, not the URL that asked for it: the
          // display's own query carries a theme and, from an old link, a
          // session token; the document is the same bytes either way.
          const cached = await caches.match(SHELL_DOCUMENT);
          return cached ?? Response.error();
        }),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) void remember(request, response.clone());
            return response;
          }),
      ),
    );
  }
});
