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
 * **The cache is keyed by the build it holds**. A display runs for
 * months and is redeployed repeatedly, and each build adds a content-hashed
 * copy of the bundle; one fixed cache name would hold every build it ever ran.
 * The name comes from the document's own bytes — the document names the
 * build's hashed assets — and every other `yunari-shell-` cache is deleted when
 * a new name is adopted. The package version cannot key this: two builds of one
 * version are exactly the redeploy a display goes through.
 *
 * Plain JavaScript on purpose: Vite copies `public/` verbatim, so this file is
 * the one the browser is given rather than a build of it.
 */

/** Every shell cache this worker owns starts with this. The worker script
 *  itself usually does not change between builds, so `install` may never run
 *  again; the name is therefore also adopted on every navigation, from the
 *  fresh `no-store` document. */
const SHELL_PREFIX = "yunari-shell-";
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

/** The cache this worker is filling, once it has read a document. `null` until
 *  then, which is what a worker restarted after `activate` starts with. */
let shellName = null;

/** FNV-1a over the document, as the build's identity. */
function buildName(html) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < html.length; index += 1) {
    hash = Math.imul(hash ^ html.charCodeAt(index), 0x01000193);
  }
  return `${SHELL_PREFIX}${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/** The current shell cache's name. A worker restarted after `activate` finds
 *  the one cache it left; with none or several there is nothing safe to guess,
 *  and the caller does without. */
async function currentShell() {
  if (shellName !== null) return shellName;

  const shells = (await caches.keys()).filter((key) =>
    key.startsWith(SHELL_PREFIX),
  );
  if (shells.length !== 1) throw new Error("no current shell cache");

  shellName = shells[0];
  return shellName;
}

/** Deletes every shell cache but the current one — the eviction a redeploy
 *  needs, since nothing else ever removes a build's hashed assets. Deletes
 *  nothing when the current cache cannot be told apart: the next navigation
 *  names it and rotates then. */
async function dropOtherShells() {
  const shells = (await caches.keys()).filter((key) =>
    key.startsWith(SHELL_PREFIX),
  );

  if (shellName === null) {
    if (shells.length !== 1) return;
    shellName = shells[0];
  }

  await Promise.all(
    shells
      .filter((key) => key !== shellName)
      .map((key) => caches.delete(key)),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    fetch(SHELL_DOCUMENT, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`the shell document answered ${response.status}`);
        }

        // Read from a clone: the original is what goes into the cache, and a
        // consumed body cannot be stored. The network answers first at runtime
        // too; this copy is only what an offline load falls back to.
        const name = buildName(await response.clone().text());
        const cache = await caches.open(name);
        await cache.addAll(SHELL_FILES);
        await cache.put(SHELL_DOCUMENT, response);
        shellName = name;
        await self.skipWaiting();
      }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    dropOtherShells()
      // A display that is already open is controlled from here, which is what
      // makes the *next* navigation the one that fills the cache.
      .then(() => self.clients.claim()),
  );
});

/** Best effort: a cache that refused an entry must not fail the request. */
async function remember(cacheKey, response) {
  try {
    const cache = await caches.open(await currentShell());
    await cache.put(cacheKey, response);
  } catch {
    /* Not cacheable; the display still got its answer. */
  }
}

/** Stores the document under the build its own bytes name, rotating the cache
 *  on a redeploy. The document is fetched `no-store` on every load, so this is
 *  the one place a new build is seen without a new worker script. */
async function rememberDocument(response) {
  try {
    const name = buildName(await response.clone().text());
    const cache = await caches.open(name);

    if (name !== shellName) {
      // Set before the deletion is awaited: an asset requested right behind the
      // document must land in the cache that is about to be the only one.
      shellName = name;
      await dropOtherShells();
    }

    await cache.put(SHELL_DOCUMENT, response);
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
          if (response.ok) void rememberDocument(response.clone());
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
