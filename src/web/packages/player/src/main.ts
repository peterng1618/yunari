import {
  type Binding,
  buildChartPlan,
  type ChartContent,
  chartReadingSignature,
  createAssetResolver,
  createLiveSource,
  type FabricPalette,
  type FabricThemeEnvelope,
  type LiveSourceHandle,
  type PlanIssue,
  SAMPLE_STREAM_PATH,
  type SampleSource,
  type SceneHandle,
} from "@yunari/renderer-core";
import {
  applyAuthoredText,
  type ChartRefreshRate,
  chartAnimationFor,
  loadFontAssets,
  mountFabricScene,
  refreshBoundImages,
  refreshBoundText,
  reviveThemeEnvelope,
  startChartRefresh,
  YunariChart,
} from "@yunari/scene-fabric";
import { Group } from "fabric/es";
import { boundSemanticKeys } from "./bound-keys.js";
import { showAvailabilityNotice, showConnectionState } from "./chrome.js";
import { mountDisplayControls } from "./display-controls.js";
import {
  type HostProbe,
  PROBE_TIMEOUT_MS,
  readStoredPairing,
  refindHost,
  refindTarget,
  storePairing,
} from "./host-refind.js";
import { envelopePlan } from "./hosted-plan.js";
import { showLoadFailure } from "./load-failure.js";
import { followPublished, reResolveUrl } from "./publish-follower.js";
import { loadDisplayCatalogue } from "./sensor-catalogue.js";
import { registerServiceWorker } from "./service-worker.js";
import {
  type DisplaySessionToken,
  displaySession,
  isLoopbackPage,
} from "./session.js";
import { createThemeChooser } from "./theme-chooser.js";
import {
  loadDisplayPreferences,
  loadHostedFontAssets,
  loadHostedTheme,
  ThemeLoadError,
} from "./theme-loader.js";

/** Display-only runtime. The phone renders; hardware acquisition stays on the host. */

/**
 * The page lifecycle a mount listens to: the reload a page restored from the
 * back/forward cache needs, because `pagehide` already tore that document down.
 *
 * A seam rather than a bare `window`, because one jsdom window outlives a
 * test's module registry: every mount in a file leaves a `pageshow` listener on
 * it, so a case asserting "this mount reloads" must hand the mount a navigation
 * object of its own.
 */
export interface PageNavigation {
  addEventListener(
    type: "pageshow",
    listener: (event: PageTransitionEvent) => void,
  ): void;
  reload(): void;
}

const windowNavigation: PageNavigation = {
  addEventListener: (type, listener) => window.addEventListener(type, listener),
  reload: () => window.location.reload(),
};

const artboardHost = document.querySelector<HTMLElement>("#artboard");

if (!artboardHost) {
  throw new Error("Artboard host element is missing.");
}

/** The browser's own storage, or nothing. A private window refuses the accessor
 *  itself, and a display with no storage is a display with no pairing to keep —
 *  not a display that fails to start. */
function displayStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

const storage = displayStorage();

/** One re-find is 253 requests to addresses that mostly are not there, and the
 *  follower reports a failed tick every couple of seconds; this is what keeps a
 *  host that is simply asleep from putting every display on its /24 on that
 *  cadence. Fixed rather than backing off — if a real display shows the traffic
 *  matters, the next step is a growing interval. A failed sweep is retried,
 *  because a host that was still booting is the case this exists for. */
const REFIND_COOLDOWN_MS = 60_000;

/**
 * Records who this display's host is, on every load rather than once at pairing.
 * `localStorage` is per-origin, so a record written at the old address is
 * invisible to the page at the new one: storing once would make the first move
 * work and lose the host on the second (R60).
 *
 * **The one writer.** `displaySession` reads the record and never writes it, so
 * there is no second place that could write an identity the URL does not carry
 * (R72).
 *
 * **The token comes from the host when the credential is a cookie.**
 * `GET /api/host` answers a paired display its own token; the cookie is
 * `HttpOnly` and the URL no longer carries one, so this is the only way a
 * newly paired display can hold a readable credential. It is still stored
 * because a re-find after an address change reaches a *different origin*,
 * where this host's cookie is never sent — storage is the only thing that
 * crosses that boundary. A loopback or unpaired caller is answered none, and
 * an old link's URL token still wins as the fallback. The route authenticates
 * a caller that presents a credential and answers only that display's token;
 * a sweep's credential-less probe gets the identity alone.
 */
async function rememberPairing(
  session: DisplaySessionToken,
  store: Storage | undefined,
): Promise<void> {
  if (store === undefined) {
    return;
  }

  try {
    const response = await fetch("/api/host");

    if (!response.ok) {
      return;
    }

    const body = (await response.json()) as {
      readonly id?: unknown;
      readonly name?: unknown;
      readonly port?: unknown;
      readonly token?: unknown;
    };

    if (
      typeof body.id !== "string" ||
      typeof body.name !== "string" ||
      typeof body.port !== "number"
    ) {
      return;
    }

    const token =
      typeof body.token === "string" && body.token.length > 0
        ? body.token
        : session.token;

    if (token === undefined) {
      return;
    }

    // The port is the one the socket answered on, so a host that walked to the
    // next free port is still dialled where it actually is.
    storePairing(store, {
      hostId: body.id,
      hostName: body.name,
      port: body.port,
      token,
      lastAddress: new URL(session.pageUrl).hostname,
    });
  } catch {
    // The record this load already wrote stands. A host that cannot answer here
    // is the connection surface's news, not a second failure to report.
  }
}

export async function start(
  host: HTMLElement,
  navigation: PageNavigation = windowNavigation,
): Promise<void> {
  const parameters = new URLSearchParams(window.location.search);
  const requested = parameters.get("theme");

  if (requested === null) {
    showLoadFailure(new ThemeLoadError("missing-id", "No ?theme=."));
    return;
  }

  try {
    const session = displaySession(
      window.location.href,
      window.fetch.bind(window),
      storage,
    );
    // Not awaited: the display is what the person came for, and the identity is
    // what a later address change is matched against.
    void rememberPairing(session, storage);
    await startHostedTheme(
      host,
      await loadHostedTheme(requested, session.fetch),
      session,
      navigation,
    );
  } catch (error) {
    showLoadFailure(error);
    return;
  }
}

/**
 * A glass panel this renderer cannot composite — an unsupported `ctx.filter`, a
 * cross-origin asset that taints the surface, a sample over the size ceiling.
 * The player has no user-visible diagnostic surface, so this follows the
 * convention `onUnsupported` already sets: a named, greppable warning rather
 * than a silently missing blur.
 */
function reportGlassError(message: string): void {
  console.warn(`Yunari: glass cannot be rendered as authored — ${message}`);
}

/** A repaint that threw. Reported, not shown: the scene keeps rendering, so
 *  replacing it with a failure panel would hide a display that still works. */
function reportRepaintError(message: string): void {
  console.warn(`Yunari: ${message}`);
}

/** A packaged face that would not load, or that declared no bytes. `loadFontAssets`
 *  reports and carries on, so the scene is already mounted and drawing in a
 *  fallback — the same case as `reportRepaintError`, and reported the same way.
 *  It used to take the display down, which turned a wrong typeface into a blank
 *  screen and a page that claims nothing is being shown. */
function reportFontError(message: string): void {
  console.warn(`Yunari: ${message}`);
}

async function startHostedTheme(
  host: HTMLElement,
  theme: FabricThemeEnvelope,
  session: DisplaySessionToken,
  navigation: PageNavigation,
): Promise<void> {
  const language = theme.metadata?.themeLanguage;
  declareDocumentLanguage(language);
  // Fetch before allocating live resources so a failed font request has nothing to release.
  const fontBytes = await loadHostedFontAssets(theme.id, theme, session.fetch);
  const units = await loadDisplayPreferences(session.fetch);
  const descriptors = await loadDisplayCatalogue(session.fetch);
  const keys = boundSemanticKeys(theme);
  // The host localizes per display and does not read this theme to learn its
  // language, so the already-loaded value rides the request. The host validates.
  const streamParameters = new URLSearchParams({ keys: keys.join(",") });
  if (language !== undefined && language.length > 0) {
    streamParameters.set("lang", language);
  }
  const liveHandle = createLiveSource({
    url: session.streamUrl(SAMPLE_STREAM_PATH, streamParameters),
    onStatus: (status, detail) =>
      showConnectionState(status, keys.length, detail),
  });
  const resolveAsset = createAssetResolver(theme.assets, {
    baseUrl: `/api/themes/${encodeURIComponent(theme.id)}/`,
  });
  const handle = mountFabricScene({
    host,
    plan: envelopePlan(theme),
    artboard: theme.artboard,
    // The colour is in the plan, resolved; this is the authored bag the scene
    // mounts and places as its own DOM layer.
    ...(theme.background === undefined ? {} : { background: theme.background }),
    assets: theme.assets ?? [],
    resolveAsset: (assetId) => {
      const url = resolveAsset(assetId);
      // Fabric fetches these itself, so the token rides in the URL: a paired
      // phone could not load a packaged image or SVG without it. It goes on the
      // finished URL — a query belongs at the end of one, and the path this
      // resolver appends has to come before it.
      return url === undefined ? undefined : { url: session.withToken(url) };
    },
    onGlassError: reportGlassError,
  });
  const releaseFonts = await loadFontAssets({
    assets: theme.assets ?? [],
    bytes: fontBytes,
    onError: reportFontError,
  });
  // The scene's own asset references resolve here, the way background media
  // already does: an object that names a packaged image has to load from the
  // host, because the `src` the editor saved is a handle into that session.
  await reviveThemeEnvelope(handle.canvas, theme, (assetId) => {
    const url = resolveAsset(assetId);
    return url === undefined ? undefined : session.withToken(url);
  });
  // Every text object, bound or not, takes its box, its alignment and its
  // clip from the authored content once after revival. `refreshBoundText`
  // only visits objects a binding resolves, so without this an unbound label
  // would keep whatever geometry the save happened to carry.
  applyAuthoredText(handle.canvas, theme.globals, {
    ...(theme.bindings === undefined ? {} : { bindings: theme.bindings }),
  });
  // What the last frame drew. Bound text, bound images and the availability
  // notice only change when a sample arrives, and an accepted ingest is the
  // only thing that moves the revision — so a frame between samples has
  // nothing of that work to redo. A clock binding still advances, because the
  // host's clock provider emits `time.now`/`date.today` samples of its own.
  let lastRevision: number | undefined;
  // The reading each chart last drew with. Unchanged readings skip `setOption`
  // so an engine transition can finish instead of restarting every frame.
  const drawnReadings = new WeakMap<object, string>();
  // The host's rate arrives on the poll below, so the first frame uses the
  // paired default and is re-rated in place.
  let chartRate: ChartRefreshRate = 30;
  const refresh = (): void => {
    const revision = liveHandle.source.revision;
    const sampleChanged = revision !== lastRevision;
    const chartsChanged = hydrateCharts(
      handle.canvas.getObjects(),
      theme.bindings ?? {},
      liveHandle.source,
      theme.globals?.palette,
      chartRate,
      drawnReadings,
    );
    if (sampleChanged) {
      // An image reading is a URL on this host, resolved through the session the
      // way every other packaged asset is. The pass refuses anything else and puts
      // the authored picture back, so a sample can never choose an origin.
      refreshBoundImages(
        handle.canvas.getObjects(),
        theme.bindings ?? {},
        liveHandle.source,
        {
          resolve: (url) => session.withToken(url),
          onRefused: reportImageRefusal,
          onLoadError: (nodeId) =>
            reportRepaintError(
              `Image "${nodeId}" failed to load and was left as it was.`,
            ),
        },
      );
      // Revived text carries the authored runs, not the sampled readings: the
      // saved scene keeps placeholders, so every sample re-resolves the runs
      // through the bindings, the way a rebuilt plan would.
      refreshBoundText(
        handle.canvas,
        theme.bindings ?? {},
        liveHandle.source,
        theme.globals,
        units,
        theme.metadata?.themeLanguage,
        descriptors,
      );
      // Refreshed here because a provider's reason exists only once data has
      // arrived. The notice owns its own lifetime from there: it removes itself
      // when nothing is unreadable, and clears itself three seconds after it is
      // raised without this cadence re-raising it while the gap persists.
      showAvailabilityNotice(liveHandle.source, keys);
    }
    // A chart asks for its own repaint when its option lands; this is the
    // sample-driven work that has none of its own.
    if (sampleChanged || chartsChanged) {
      handle.canvas.requestRenderAll();
    }
    // **After** the passes above, so one that throws leaves the revision
    // undrawn and the next frame retries it rather than skipping that revision
    // for good.
    lastRevision = revision;
  };

  refresh();
  showConnectionState("connecting", keys.length);
  // The controls a reader operates, mounted with the rest of the chrome: they
  // overlay the composition rather than take room from it, and one of them can
  // hold the phone awake, so the display's own teardown has to release it.
  const controls = mountDisplayControls();
  // Only a host-served display follows a publish: a fixture theme is not
  // something an author is editing.
  //
  // Every move this display has to follow goes back through `/`. The URL it is
  // on names the theme the host resolved for it, and `reResolveUrl` drops what
  // would stop that resolution running again — a plain reload would re-serve
  // the id already in the URL, and an assignment changes exactly that id (R51).
  // Both hooks answer the same navigation, because both mean "ask the host
  // again": a publish change re-reads the document, a theme change re-asks the
  // id.
  const reResolve = (): void => {
    window.location.href = reResolveUrl(window.location.href);
  };
  // The ladder, and the three things that keep it off the network: a sweep of
  // 253 addresses is not something to start twice, one that just ran is not
  // worth repeating inside the cooldown, and a page the browser has put in its
  // back/forward cache must not keep probing a LAN it has left.
  let refinding = false;
  let lastRefindAt: number | undefined;
  let disposed = false;

  /** Deliberately not `session.fetch`: a probe sends no credential, and
   *  `/api/host` answers an unpaired caller the identity alone. A probe
   *  carrying this display's token would offer it to every address that
   *  answers — and the route now reads a presented credential back — which is
   *  the opposite of what the stored id is for (R63). */
  const probe: HostProbe = async (origin) => {
    if (disposed) {
      return undefined;
    }

    try {
      const response = await fetch(`${origin}/api/host`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });

      if (!response.ok) {
        return undefined;
      }

      const body = (await response.json()) as {
        readonly id?: unknown;
        readonly name?: unknown;
      };

      return typeof body.id === "string" && typeof body.name === "string"
        ? { id: body.id, name: body.name }
        : undefined;
    } catch {
      // An address that does not answer is an address with no host on it.
      return undefined;
    }
  };

  const refind = async (): Promise<void> => {
    const pairing =
      storage === undefined ? undefined : readStoredPairing(storage);
    const now = Date.now();

    // The clock starts when a sweep does, so a sweep that found nothing is
    // retried after the cooldown rather than never — the case this is for is a
    // host that was still booting when the first one ran.
    if (
      pairing === undefined ||
      refinding ||
      disposed ||
      (lastRefindAt !== undefined && now - lastRefindAt < REFIND_COOLDOWN_MS)
    ) {
      return;
    }

    refinding = true;
    lastRefindAt = now;

    try {
      const found = await refindHost(pairing, probe, {
        // The page's own scheme, so an https display probes over https: the
        // other way round is mixed content and matches nothing (`vg-623`).
        scheme: window.location.protocol === "https:" ? "https" : "http",
      });

      if (found === undefined || disposed) {
        return;
      }

      // The address is re-stored by the load this lands on, which writes its
      // own origin's record — the only place that record is visible from.
      window.location.href = refindTarget(found, pairing.token);
    } finally {
      refinding = false;
    }
  };
  // A display the host resolved can choose another theme for itself, and shows
  // it through the same navigation an assignment takes. A link's id is the
  // person's instruction and a published page's is what it shows; `reResolveUrl`
  // keeps both, so a chooser there would change nothing.
  //
  // **The token may exist only as a cookie.** After pairing it lives in an
  // HttpOnly cookie and the URL carries none, so `session.token === undefined`
  // no longer means "no credential": a non-loopback page is a paired display
  // (the host refuses an unpaired LAN page), and the chooser's own fetch uses
  // the cookie. Loopback stays without one — it is this PC, which has no
  // own-theme write to make.
  const pairedPage =
    session.token !== undefined || !isLoopbackPage(window.location.href);
  const chooser =
    pairedPage &&
    new URL(window.location.href).searchParams.get("theme-source") === "map"
      ? createThemeChooser({
          session,
          paired: pairedPage,
          side: "bottom",
          current: theme.id,
          onChosen: () => reResolve(),
          // The host's sentence goes where every other refusal on this display
          // goes; the player, not the chooser, decides where that is.
          onError: (message) => showConnectionState("refused", 0, message),
        })
      : undefined;
  // The display's own rate arrives on the poll below, so the loop starts on the
  // paired default and is re-rated in place the moment an answer lands: a rate
  // change is a `setRate` on the loop that exists, not a second loop.
  const chartRefresh = startChartRefresh(refresh, chartRate, undefined, {
    onError: reportRepaintError,
  });
  const stopFollowing = followPublished(session, reResolve, {
    onRefused: (reason) => showConnectionState("refused", 0, reason),
    onThemeChange: reResolve,
    // The one sighting of a host that has stopped answering, and the only thing
    // that can start the ladder. The follower reports every failed tick;
    // `refind` decides whether this display has an identity to match and
    // whether the last sweep is far enough behind it to run another.
    onUnreachable: () => void refind(),
    onRateChange: (rate) => {
      chartRate = rate;
      chartRefresh.setRate(rate);
    },
  });
  const observer = new ResizeObserver(() => handle.resize());
  observer.observe(host);
  // A hidden page repaints up to thirty times a second and keeps decoding a
  // background video nobody can see. `disposed` is the pagehide flag: a page
  // that teardown has torn down must not be revived by a late event.
  //
  // **Run once at mount as well as on the event.** `visibilitychange` fires
  // only on a *change*, so a display restored or opened in a background tab
  // starts hidden and would otherwise start its loop and its video.
  const syncVisibility = (): void => {
    if (disposed) return;
    if (document.hidden) {
      chartRefresh.stop();
      handle.pauseMedia();
      return;
    }
    handle.resumeMedia();
    chartRefresh.start();
  };
  window.addEventListener("visibilitychange", syncVisibility);
  navigation.addEventListener("pageshow", (event) => {
    // A page restored from the back/forward cache is the document `pagehide`
    // already tore down — `disposed` is exactly what it left behind — so a
    // fresh load is the only recovery. A first load is already fresh.
    if (event.persisted) navigation.reload();
  });
  window.addEventListener(
    "pagehide",
    () => {
      // A page going into the back/forward cache is still running: a sweep that
      // carried on would probe a LAN this page has left and could navigate it
      // out of the cache it was put in.
      disposed = true;
      releaseFonts();
      chartRefresh.dispose();
      observer.disconnect();
      // `pagehide` is `{ once: true }`, so a discarded handle would leave the
      // poll running for every display parked in the back/forward cache.
      stopFollowing();
      liveHandle.close();
      // Before the scene goes: the controls' own listeners and any wake lock
      // are theirs to release, and a discarded page must not keep a phone awake.
      controls.dispose();
      chooser?.dispose();
      // The scene owns the glass handle, the media layer and any video frame
      // callback, and none of them is released by the teardown above.
      handle.dispose();
    },
    { once: true },
  );
  // After the listeners, so a page that is already hidden takes the same path
  // the first `visibilitychange` would have taken.
  syncVisibility();
  exposeForDiagnostics(handle, liveHandle);
}

/**
 * The smaller edge of the canvas ECharts draws into, in backing pixels.
 *
 * The scene box at its own scale times the object's render scale. The gauge's
 * cap clearance is a pixel measure against that canvas and its thickness is in
 * the same pixels; absent means the object measures nothing and the adapter
 * skips the term rather than guessing a size.
 */
function drawnEdgePxOf(
  chart: YunariChart,
): { readonly drawnEdgePx: number } | Record<string, never> {
  const smaller =
    Math.min(chart.width * chart.scaleX, chart.height * chart.scaleY) *
    chart.renderScale;
  return Number.isFinite(smaller) && smaller > 0
    ? { drawnEdgePx: Math.floor(smaller) }
    : {};
}

/**
 * Repaints the charts whose readings moved.
 *
 * Returns whether anything was handed to a chart, which is what decides whether
 * the scene needs a repaint of its own.
 */
function hydrateCharts(
  objects: readonly { get(key: string): unknown }[],
  bindings: Readonly<Record<string, readonly Binding[]>>,
  source: SampleSource,
  palette: FabricPalette | undefined,
  rate: ChartRefreshRate,
  drawnReadings: WeakMap<object, string>,
): boolean {
  const issues: PlanIssue[] = [];
  let changed = false;
  const nowMs = Date.now();
  for (const object of objects) {
    if (object instanceof YunariChart) {
      const id = object.get("id");
      if (typeof id !== "string") continue;
      // **Per chart, deliberately.** A chart that throws must cost that chart
      // and nothing else: this runs in the same callback as the text repaint
      // and the render, so an unguarded throw here would leave every reading on
      // the display frozen at whatever it last showed — which is a total
      // freeze caused by one bad option, and the defect this file already had
      // one level up in the frame loop.
      try {
        const content = {
          family: object.family,
          settings: object.settings,
        } as ChartContent;
        const chartBindings = bindings[id] ?? [];
        const geometry = drawnEdgePxOf(object);
        const reading = chartReadingSignature(
          content,
          chartBindings,
          source,
          palette,
          geometry.drawnEdgePx,
        );
        if (drawnReadings.get(object) === reading) continue;
        const plan = buildChartPlan(
          id,
          content,
          chartBindings,
          {
            source,
            nowMs,
            animate: chartAnimationFor(content.family, rate),
            ...geometry,
          },
          issues,
          palette,
        );
        object.setOption(plan.option);
        drawnReadings.set(object, reading);
        changed = true;
      } catch (error) {
        reportRepaintError(
          `Chart "${id}" failed to draw and was left as it was. ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    // A chart inside a group is still a chart a reader is watching, so the
    // walk goes into groups: the starter's cards are groups, and stopping at
    // the canvas would freeze every reading in the composition at load.
    if (object instanceof Group) {
      if (
        hydrateCharts(
          object.getObjects(),
          bindings,
          source,
          palette,
          rate,
          drawnReadings,
        )
      ) {
        changed = true;
      }
    }
  }
  // One line per distinct cause: this runs on every refresh cadence, and a
  // display repeating the same refusal every 30 s teaches nobody anything.
  for (const issue of issues) {
    const message = `Chart "${issue.nodeId}" ${issue.detail}`;
    if (reportedChartIssues.has(message)) continue;
    reportedChartIssues.add(message);
    reportRepaintError(message);
  }
  return changed;
}

const reportedChartIssues = new Set<string>();
/** One line per image and cause: the refresh cadence would otherwise repeat a
 *  refusal thirty times a second for as long as the sample stands. */
const reportedImageRefusals = new Set<string>();

function reportImageRefusal(nodeId: string, reason: string): void {
  const message = `Image "${nodeId}": ${reason}`;
  if (reportedImageRefusals.has(message)) return;
  reportedImageRefusals.add(message);
  reportRepaintError(message);
}

/**
 * Declares the theme's language on the page that shows it.
 *
 * The author's Language setting says what the text on this display is written
 * in, and the page said `en` whatever it was. `dir` is the half that matters
 * most and costs nothing to get right: Arabic and Urdu are both offered, and
 * without it the player's own chrome lays out left-to-right under a theme that
 * reads right-to-left. Both come from the runtime — `Intl.Locale` knows a
 * language's script and direction, and a hand-written table of fifteen would
 * be a worse copy of it that drifts from CLDR.
 *
 * The theme's own strings are the author's text and are left exactly as
 * authored; this declares the page they sit in.
 */
function declareDocumentLanguage(themeLanguage: string | undefined): void {
  if (themeLanguage === undefined || themeLanguage.length === 0) return;
  try {
    const { language, script } = new Intl.Locale(themeLanguage);
    const root = document.documentElement;
    root.lang = script === undefined ? language : `${language}-${script}`;
    const direction = new Intl.Locale(themeLanguage).getTextInfo?.().direction;
    if (direction === "rtl") root.dir = "rtl";
    else root.removeAttribute("dir");
  } catch {
    // A tag this runtime cannot parse leaves the page as it was, which is the
    // same place a document with no declared language starts.
  }
}

/** Development-only access to scene/live handles; the app never reads this. */
function exposeForDiagnostics(
  handle: SceneHandle,
  live?: LiveSourceHandle,
): void {
  Reflect.set(window, "yunari", { handle, live });
}

// Before the theme, and outside the failure path: a display that cannot load
// its theme is still a display that can install.
registerServiceWorker();
void start(artboardHost);
