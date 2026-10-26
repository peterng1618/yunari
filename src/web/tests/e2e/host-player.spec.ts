import { type ChildProcess, spawn } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { networkInterfaces, tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type APIRequestContext,
  expect,
  type Page,
  type Request,
  test,
} from "@playwright/test";
import { SAMPLE_STREAM_PATH } from "@yunari/renderer-core";
import { uiCopy as editorCopy } from "../../packages/editor/src/ui-copy.js";
import { uiCopy } from "../../packages/player/src/ui-copy.js";
import { canvasProp, sceneBounds, sceneProperty } from "./canvas-probe.js";
import { openPaused } from "./clock.js";
import { captureVisualReview } from "./editor-canvas.js";
import { openPane } from "./editor-rail.js";
import {
  BADGE_INK,
  CHART_NODE_ID,
  CLOCK_NODE_ID,
  GLASS_TWO_TONE_THEME,
  GROUPED_GROUP_ANGLE,
  GROUPED_GROUP_ID,
  GROUPED_PANEL_IDS,
  HOST_CHART_THEME_ID,
  HOST_ENGLISH_THEME_ID,
  HOST_GROUPED_THEME_ID,
  HOST_JAPANESE_THEME_ID,
  HOST_MEDIA_THEME_ID,
  HOST_MISSING_THEME_ID,
  HOST_PORT,
  HOST_TEMP_THEME_ID,
  HOST_THEME_ID,
  HOST_THEMES_DIR,
  hostClient,
  TEMPERATURE_NODE_ID,
  TWO_TONE_DISPLAY_BOUNDS,
  TWO_TONE_THEME_BOUNDS,
} from "./host-theme.js";
import { placeText, readScene } from "./rebuild-driver.js";
import { isDesktopSurface } from "./surface.js";

/** Exercises the real Node host: the browser suite's only proof that hosted
 * theme loading, declared package-asset serving and the SSE stream work end to
 * end. `vite preview` cannot cover any of it. */

const HOST = `http://127.0.0.1:${HOST_PORT}`;
/** The id the most recent save in this page wrote, discovered from the save's
    own PUT URL — a new document now mints a UUID, so there is no fixed id. */
const savedStarterIds = new WeakMap<Page, string>();

/** The theme id a save's PUT URL names, which is the document's own id. */
const themeIdOfSave = (request: Request): string =>
  decodeURIComponent(new URL(request.url()).pathname.split("/").at(-1) ?? "");

/**
 * Save the starter through the host's own library route, as an author would.
 *
 * **`New from starter` first, and that is the whole fix.** `boot-theme.ts` opens
 * the author's most recent save when the URL names no theme — which, against the
 * host project's shared `--app-dir`, is whichever *fixture* ran last, not the
 * starter. The save that followed therefore wrote somebody else's document, and
 * the display then asked the host for the reference theme, which no run had
 * ever put there. Measured: booting the seeded store opened `bar-0…bar-4` (a
 * fixture), and after `Save to library` the library still had no reference
 * theme.
 *
 * The id is read off the save request rather than assumed: the document mints
 * its own UUID at creation, so a spec that asked for a fixed name would ask for
 * a theme no save ever wrote.
 */
async function saveStarterThroughTheHost(page: Page): Promise<string> {
  await page.goto(`${HOST}/editor/`);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "New from starter" }).click();
  await expect(page.locator("#status")).toContainText(
    "New theme from the starter",
  );
  const saved = page.waitForRequest(
    (request) =>
      request.method() === "PUT" &&
      /^\/api\/themes\/[^/]+$/.test(new URL(request.url()).pathname),
  );
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save to library" }).click();
  await expect(page.locator("#status")).toContainText("Saved to library", {
    timeout: 20_000,
  });
  const id = themeIdOfSave(await saved);
  savedStarterIds.set(page, id);
  return id;
}

/**
 * The starter, saved through the host and then shown on the display.
 *
 * **This used to be a bare `goto`, and that made every display spec in this file
 * depend on a theme left in the host's on-disk library by an earlier *run*.**
 * The host project's `--app-dir` is a directory, not a fixture, so on a machine
 * that had not run these specs before each of them asked the host for a theme it
 * did not have — a symptom that names the artboard and never mentions the
 * missing document. A spec that already saved reuses that save's id.
 */
async function openStarterDisplay(page: Page, query = ""): Promise<string> {
  const id =
    savedStarterIds.get(page) ?? (await saveStarterThroughTheHost(page));
  await page.goto(`${HOST}/?theme=${id}${query}`);
  return id;
}

/** The saved document on the display, with at least one live batch arrived. */
async function openDisplayWithLiveData(page: Page): Promise<void> {
  await openStarterDisplay(page, "&data=live");
  await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                yunari?: { live?: { batchCount?: number } };
              }
            ).yunari?.live?.batchCount ?? 0,
        ),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);
}

/**
 * Every chart on the display, counted off its own ECharts canvas.
 *
 * `chroma` is saturation, not brightness, and it is the half that matters: a
 * gauge's track is a dark grey ring with plenty of ink and no colour, so an
 * ink count alone passes on a chart that shows nothing the author asked for.
 *
 * **Groups descended, for the reason `canvas-probe.ts`'s reader descends.** The
 * starter's cards are groups, so `storage-bar` and every other chart is inside
 * one; a root-only pass saw no charts at all and the assertion failed as
 * `storage-bar is on the display` — a missing object where the author sees a
 * bar on the wall.
 */
function chartPixels(page: Page): Promise<
  {
    readonly id: string;
    readonly ink: number;
    readonly chroma: number;
    readonly w: number;
    readonly h: number;
  }[]
> {
  return page.evaluate(() => {
    type Obj = {
      get(name: string): unknown;
      getObjects?(): readonly Obj[];
      _element?: HTMLCanvasElement;
    };
    const canvas = (
      window as unknown as {
        yunari?: { handle: { canvas: { getObjects(): readonly Obj[] } } };
      }
    ).yunari?.handle.canvas;
    const charts: Obj[] = [];
    const visit = (objects: readonly Obj[] | undefined): void => {
      for (const object of objects ?? []) {
        if (object._element !== undefined) charts.push(object);
        visit(object.getObjects?.());
      }
    };
    visit(canvas?.getObjects());
    return charts.map((object) => {
      const element = object._element!;
      const context = element.getContext("2d");
      if (context === null) {
        return {
          id: String(object.get("id")),
          ink: -1,
          chroma: -1,
          w: 0,
          h: 0,
        };
      }
      const data = context.getImageData(
        0,
        0,
        element.width,
        element.height,
      ).data;
      let ink = 0;
      let chroma = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3]! === 0) continue;
        ink += 1;
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        if (Math.max(r, g, b) - Math.min(r, g, b) > 40) chroma += 1;
      }
      return {
        id: String(object.get("id")),
        ink,
        chroma,
        w: element.width,
        h: element.height,
      };
    });
  });
}

/**
 * Pixels of the badge's own colour in the bytes the display actually decoded.
 * Zero until it decodes, and zero forever if the host never served them — which
 * a bare status check on the URL cannot tell apart from a 200 that is not an
 * image.
 */
async function decodedBadgeInk(page: Page): Promise<number> {
  return page.evaluate(({ r, g, b }) => {
    const image = document.querySelector<HTMLImageElement>(
      "[data-yunari-background-media] img",
    );
    if (image === null || !image.complete || image.naturalWidth === 0) {
      return 0;
    }
    const probe = document.createElement("canvas");
    probe.width = image.naturalWidth;
    probe.height = image.naturalHeight;
    const context = probe.getContext("2d");
    if (context === null) return -1;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, probe.width, probe.height);
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (
        data[i + 3]! > 200 &&
        Math.abs(data[i]! - r) <= 12 &&
        Math.abs(data[i + 1]! - g) <= 12 &&
        Math.abs(data[i + 2]! - b) <= 12
      ) {
        ink += 1;
      }
    }
    return ink;
  }, BADGE_INK);
}

test.describe("hosted player over the real host", () => {
  test("serves the player, the editor and the API only over loopback", async ({
    request,
  }) => {
    const player = await request.get(`${HOST}/`);
    expect(player.status()).toBe(200);
    expect(await player.text()).toContain("<!doctype html");

    const editor = await request.get(`${HOST}/editor/`);
    expect(editor.status()).toBe(200);

    const sensors = await request.get(`${HOST}/api/sensors`);
    expect(sensors.ok()).toBe(true);

    const themes = (await (await request.get(`${HOST}/api/themes`)).json()) as {
      themes: { id: string }[];
    };
    expect(themes.themes.map((entry) => entry.id)).toContain(HOST_THEME_ID);
  });

  /**
   * **The marker every "this display is up" assertion in this file names**, and
   * the only place the failure page is itself the subject.
   *
   * A `?theme=` the host cannot serve replaces the display with a page saying so.
   * Four assertions here, and one in `host-media.spec.ts`, check that a display
   * *is* up by asking that this page is absent — which was the same thing as
   * asking for no `<pre>` while the page was built from one. `b01b301` gave the
   * page real markup and nothing noticed, because a `<pre>` is now absent from a
   * display showing nothing but the failure: measured on this host,
   * `preCount 0, failureCount 1`. The old assertion passed on a dead screen.
   */
  test("a theme it cannot serve says so as a page, and not as a bare error", async ({
    page,
  }) => {
    await page.goto(`${HOST}/?theme=e2e-no-such-theme`);

    await expect(page.locator("[data-yunari-load-failure]")).toBeVisible();
    // The host's own reason, kept and labelled, because the person who fixes
    // this is not the one looking at the display.
    await expect(
      page.locator("[data-yunari-load-failure-reason]"),
    ).not.toBeEmpty();
    // A reader with several displays open can tell which one broke.
    await expect(page).toHaveTitle(/nothing to display/);
    // And there is no artboard behind it — the page replaced the display rather
    // than drawing over one, which is what keeps it from reading as a gap.
    await expect(page.locator("#artboard canvas.lower-canvas")).toHaveCount(0);

    // **The fact the old assertions rested on and no longer do.** Stated here so
    // the next reader of `pre` learns it from a test rather than from a
    // screenshot: this page contains no `<pre>`, so "no `<pre>`" is satisfied by
    // a display that is showing nothing else.
    await expect(page.locator("pre")).toHaveCount(0);
  });

  test("serves declared package assets and refuses undeclared ones", async ({
    request,
  }) => {
    const asset = await request.get(
      `${HOST}/api/themes/${HOST_THEME_ID}/assets/badge.svg`,
    );
    expect(asset.status()).toBe(200);
    expect(await asset.text()).toContain("<svg");

    const undeclared = await request.get(
      `${HOST}/api/themes/${HOST_THEME_ID}/assets/nope.svg`,
    );
    expect(undeclared.status()).toBe(404);
  });

  test("a hosted theme's packaged media decodes on the display", async ({
    page,
  }) => {
    await page.goto(`${HOST}/?theme=${HOST_MEDIA_THEME_ID}`);

    // The media layer is a DOM sibling under the artboard, so the proof is the
    // element itself: the URL the resolver built, the decoded size, and the
    // pixels the served bytes actually paint. A 200 on its own would pass on an
    // app shell served for an unknown path.
    await expect
      .poll(() => decodedBadgeInk(page), { timeout: 20_000 })
      .toBeGreaterThan(200);

    const media = await page
      .locator("[data-yunari-background-media] img")
      .evaluate((element) => ({
        src: (element as HTMLImageElement).src,
        naturalWidth: (element as HTMLImageElement).naturalWidth,
      }));
    expect(media.src).toBe(
      `${HOST}/api/themes/${HOST_MEDIA_THEME_ID}/assets/badge.svg`,
    );
    expect(media.naturalWidth).toBe(24);
  });

  test("refuses theme mutation from a non-loopback peer", async ({
    request,
  }) => {
    // Loopback admin is allowed; the guard is what this asserts exists.
    const response = await request.put(`${HOST}/api/themes/${HOST_THEME_ID}`, {
      data: new Uint8Array([1, 2, 3]),
      headers: { "content-type": "application/octet-stream" },
    });
    expect([400, 403]).toContain(response.status());
  });

  test("round-trips a theme saved from the host-served editor", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    // The editor reaches the host's theme store, and the bytes it writes come
    // back through the host's player route: the author-to-display loop.
    await page.goto(`${HOST}/editor/`);
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();

    await placeText(page);
    // The saved theme has to carry the text class the player reads runs from.
    expect((await readScene(page)).at(-1)?.type).toBe("i-text");

    // Save to library goes through PUT /api/themes/:id, not a download.
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: "Save to library" }).click();
    await expect(page.locator("#status")).toContainText("Saved to library", {
      timeout: 15_000,
    });
  });

  test("loads a packaged font from the host and applies it", async ({
    page,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "one desktop pass is enough for the host path",
    );

    await page.goto(`${HOST}/?theme=${HOST_THEME_ID}`);

    // `document.fonts.check()` is NOT evidence here: it reports true for a
    // generic fallback before any face is registered (verified against this
    // suite's Chromium, where it returns true with an empty face set). The
    // registered face is.
    await page.waitForFunction(
      () => [...document.fonts].some((face) => face.family.includes("Inter")),
      undefined,
      { timeout: 15_000 },
    );

    // The face came from the host's declared-asset route, and it is loaded
    // rather than merely registered.
    const status = await page.evaluate(() => {
      const face = [...document.fonts].find((entry) =>
        entry.family.includes("Inter"),
      );
      return face === undefined ? "none" : face.status;
    });
    expect(status).toBe("loaded");

    // A failed font fetch would surface through the player's failure path; the
    // connection banner is absent once live, so assert on the failure page —
    // the marker that page actually carries, named once above.
    await expect(page.locator("[data-yunari-load-failure]")).toHaveCount(0);
  });

  // Where the defect became visible, and where the witness belongs. It was
  // **produced in the editor** — the editor measured 566.9365234375 for the same
  // object — but the editor revives from `createNewFabricTheme()` on every load, so
  // only a document that has been *saved* carried the inflated width. The player
  // is where a saved document is read back, so that is where the assertion lives.
  //
  // The number in the comment used to be the failing value. It is now the
  // authored one: `yunariText.box` is the owner, and Fabric's own width is a
  // cache it re-asserts. See `docs/decisions/0003`.
  //
  // The starter is saved through the host's own store rather than a fixture,
  // because the three objects are the starter's own and no fixture has them.
  test("holds each aligned reading inside its authored box in the player", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "one desktop pass is enough");

    await openStarterDisplay(page);
    await page.waitForSelector('canvas[data-yunari="artboard"]');
    await page.waitForTimeout(8000);
    // **Groups descended, and world.** All three are parts of a card, so the
    // root-only search this replaced read nothing for them; and `right` is
    // composed through the ancestor transform, because a part's own `left` is
    // its position *inside* its card and says nothing about where it lands.
    const measured = await Promise.all(
      ["ram-value", "vram-value", "storage-card-value"].map(async (id) => ({
        id,
        width: Number((await sceneProperty(page, id, "width")) ?? 0),
        right: (await sceneBounds(page, id))?.right ?? 0,
      })),
    );
    // The authored boxes, per object. The two ring readings are 180 wide and
    // the storage share is 200; asserting one number for all three is a test
    // that can never pass, which is what round one's witness did.
    const authored: Readonly<Record<string, number>> = {
      "ram-value": 180,
      "vram-value": 180,
      "storage-card-value": 200,
    };
    for (const object of measured) {
      expect(object.width, object.id).toBeCloseTo(authored[object.id] ?? 0, 3);
      // And the ink lands inside the artboard: the RAM reading used to end at
      // 1645.9, which is 327.9 units into the VRAM card beside it.
      expect(object.right, object.id).toBeLessThanOrEqual(1672);
    }
  });

  test("a theme's language decides the words its clock shows", async ({
    page,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "one desktop pass is enough for the host path",
    );

    await page.goto(`${HOST}/?theme=${HOST_JAPANESE_THEME_ID}&data=live`);
    await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();
    await expect(page.locator("#yunari-connection")).toHaveCount(0, {
      timeout: 15_000,
    });
    // Waited on, not read once: the banner clears when the stream connects, which
    // is before the first sample reaches the canvas, and until it does the clock
    // correctly shows the no-reading gap. Reading it there is how this test went
    // red under load while passing 24/24 in its own project.
    await expect
      .poll(() => shownClock(page), { timeout: 15_000 })
      .not.toBe("—");
    const japanese = String(await canvasProp(page, CLOCK_NODE_ID, "text"));

    await page.goto(`${HOST}/?theme=${HOST_ENGLISH_THEME_ID}&data=live`);
    await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();
    await expect(page.locator("#yunari-connection")).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect
      .poll(() => shownClock(page), { timeout: 15_000 })
      .not.toBe("—");
    const english = String(await canvasProp(page, CLOCK_NODE_ID, "text"));

    // Same theme shape, binding, instant and literal. Only declared language differs.
    expect(japanese).toMatch(/^日付 .*月 /);
    expect(english).toMatch(/^日付 [A-Z][a-z]{2,3} /);
    expect(japanese).not.toBe(english);
  });

  test("plays the saved starter, frosted CPU card and all", async ({
    page,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "one desktop pass is enough for the host path",
    );

    // The starter as the editor actually holds it, saved through the host's
    // own route — the author-to-display loop, with no fixture in between.
    await page.goto(`${HOST}/editor/`);
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();
    await openPane(page, "Add");
    await page
      .locator('[data-yunari-add-group="shape"]')
      .getByRole("button", { name: "Rectangle", exact: true })
      .click();
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: "Save to library" }).click();
    await expect(page.locator("#status")).toContainText("Saved to library", {
      timeout: 15_000,
    });

    // And the player renders the same document, with the card's reading live.
    await openStarterDisplay(page, "&data=live");
    await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();
    // The banner is **absent** only once a batch has arrived, so its absence is
    // asserted alongside a positive batch count: a selector that never matches
    // would make the first assertion pass without a single sample.
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (
                window as unknown as {
                  yunari?: { live?: { batchCount?: number } };
                }
              ).yunari?.live?.batchCount ?? 0,
          ),
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);
    await expect(page.locator("#yunari-connection")).toHaveCount(0);

    /** Read through `sceneProperty`, which descends into groups — the CPU
     *  card's plate and its value are both parts of `group-cpu-card`, so the
     *  root-only search this replaced read `undefined` for objects the display
     *  was showing. */
    const readCard = async (): Promise<{
      treatment: unknown;
      reading: string;
    }> => ({
      treatment: await sceneProperty(page, "cpu-card", "yunariGlass"),
      reading: String(
        (await sceneProperty(page, "cpu-card-value", "text")) ?? "—",
      ),
    });

    // The treatment survived the host's own save, so the player composites it
    // from authored state rather than from a cache the route dropped — and it
    // is the card's own authored radius, 40, not a default the route supplied.
    expect((await readCard()).treatment).toEqual({ blurRadius: 40 });

    // And the reading is **live**, which is the claim this card was added for.
    // Polled because a reading arrives over SSE; a single read would be
    // asserting the cadence rather than the card.
    await expect
      .poll(async () => (await readCard()).reading, { timeout: 20_000 })
      .toMatch(/^\d+%$/);

    // The player's failure path is that page; an absent one is the claim.
    await expect(page.locator("[data-yunari-load-failure]")).toHaveCount(0);
  });

  test("the display paints its charts in the theme's own palette", async ({
    page,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "one desktop pass is enough for the host path",
    );
    // A host save, a player boot, a live batch and a settling window is well
    // over the 30 s default on this machine; the same reason the long journey
    // test carries one.
    test.slow();

    // **Counted, not read off an option string.** The player used to call
    // `buildChartPlan` with no palette, so every `palette.` reference in a
    // theme resolved to nothing and the bar carried `value: 46.8` with
    // `itemStyle.color: "transparent"` — a plausible-looking string and zero
    // ink on the display. The claim is pixels.
    await saveStarterThroughTheHost(page);
    await openDisplayWithLiveData(page);
    // **Waited on, not slept through.** A line chart's ink grows as its rolling
    // window fills, and the growth is not monotone across runs: measured on four
    // boots of this same document, `cpu-card-sparkline` carried 0, 30, 16 and 0
    // lit pixels at 2 s, then 604, 1482, 1058 and 1365 at 8 s, and 5700 to 8273
    // by 30 s. A fixed 8 s sleep therefore straddles the threshold — the same run
    // read 480 against a floor of 500 and failed a chart that was painting
    // correctly — while the bar, whose geometry is fixed by its data rather than
    // by the window, read 17136 every time. The condition to wait for is the one
    // being claimed: a sparkline with points in it.
    await expect
      .poll(
        async () => {
          const charts = await chartPixels(page);
          return charts.find((chart) => chart.id === "cpu-card-sparkline")?.ink;
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThan(500);

    const charts = await chartPixels(page);

    // **The colour floor is a fraction of the ink, and had to become one.** A
    // bar paints filled areas and a sparkline paints a two-pixel stroke, so the
    // two carry very different proportions of coloured ink even when both are
    // painting correctly — measured on five settled boots of this same document,
    // `storage-bar` reads a chroma/ink ratio of 0.469 every time while
    // `cpu-card-sparkline` ranges 0.112 to 0.222. One absolute count therefore
    // cannot serve both: at 500 it is 20x too high for the sparkline and barely
    // a twelfth of the bar's, and a run that happened to settle early failed on
    // a chart that was drawing its series in colour the whole time.
    //
    // A ratio is also the stronger claim rather than a weaker one. The defect
    // this spec was written for put `itemStyle.color: "transparent"` on the
    // series, which is a *low coloured fraction* — the track stays, the value
    // does not — and a fraction is what catches it. An absolute count of
    // coloured pixels would also pass a chart whose track were black ink, which
    // is the failure mode the message names.
    for (const id of ["storage-bar", "cpu-card-sparkline"]) {
      const chart = charts.find((candidate) => candidate.id === id);
      expect(chart, `${id} is on the display`).toBeDefined();
      expect(chart!.w, `${id} has a real backing canvas`).toBeGreaterThan(50);
      expect(chart!.ink, `${id} has ink on its own canvas`).toBeGreaterThan(
        500,
      );
      expect(
        chart!.chroma / chart!.ink,
        `${id} paints its value in a colour, not a grey track (${chart!.chroma} of ${chart!.ink} pixels)`,
      ).toBeGreaterThan(0.05);
    }
    // And the whole display is not one chart quietly carrying the claim.
    expect(charts.length, "the display's charts").toBeGreaterThan(2);
  });

  test("a gauge draws the progress arc the reference shows", async ({
    page,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "one desktop pass is enough for the host path",
    );
    test.slow();

    // **Was pinned as a known gap, and the gap is closed.** The ring and its
    // reading are separate objects, so a gauge could look complete while its
    // coloured arc was missing: the track is grey ink and the reading is
    // ordinary text. The player's console said why, and the per-chart guard in
    // `hydrateCharts` turned it into a warning rather than a `pageerror`, so a
    // run watching for uncaught errors saw none:
    //
    //   Yunari: Chart "ram-gauge" failed to draw and was left as it was.
    //   Cannot read properties of undefined (reading '0')
    //
    // The cause is ECharts 6.1.0's, and it is in the data, not the paint.
    // `GaugeView._renderPointer` reads its own `_progressEls` inside the
    // data-diff `update` callback and only assigns it after a render that drew
    // an arc. The display's first render happens before telemetry arrives, so
    // the first sample crossed that read with the flag flipping under a datum
    // that had been there all along. A gauge with no arc now carries no datum
    // (`0008`), which turns the crossing into an `add` — and the editor, which
    // mounts with a sample in hand, never took that path at all.
    await saveStarterThroughTheHost(page);
    await openDisplayWithLiveData(page);
    await page.waitForTimeout(8000);

    const gauge = (await chartPixels(page)).find(
      (candidate) => candidate.id === "ram-gauge",
    );
    expect(gauge, "the ring is on the display").toBeDefined();
    expect(gauge!.ink, "the ring has a track").toBeGreaterThan(500);
    // The floor is the *no arc* baseline, not a share of memory. Measured on
    // this option at the starter's 218x218 @ renderScale 2, chroma is
    // `553 + 207 x value` px: 216 with no datum at all, 553 at value 0, 2,620 at
    // 10%. A 2000 floor therefore read "RAM above ~7%", which is a statement
    // about the host's memory rather than about the ring — and it went red on an
    // idle machine that the fix had fixed. 500 is the floor this file already
    // uses for the other charts, and it is 2.3x the arc-less baseline this test
    // has to tell apart (219 on `ram-gauge`, 307 on `vram-gauge`).
    expect(
      gauge!.chroma,
      "the ring paints its progress arc in the theme's colour",
    ).toBeGreaterThan(500);
  });

  test("paints each caption from the host's own reading of that key", async ({
    page,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "one desktop pass is enough for the host path",
    );

    // Self-contained: the starter reaches the host's library only when a
    // browser saves it, so this does that itself rather than leaning on
    // whichever test happened to run first.
    await openStarterDisplay(page, "&data=live");
    await page.waitForSelector('canvas[data-yunari="artboard"]');
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (
                window as unknown as {
                  yunari?: { live?: { batchCount?: number } };
                }
              ).yunari?.live?.batchCount ?? 0,
          ),
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);

    // The rendered text and the host's own sample for the same key, read in
    // one pass so a repaint between them cannot make this vacuously true.
    // **Through `sceneProperty`, which descends into groups**: both captions
    // are parts of `group-gpu-card`, and the root-only search this replaced
    // read `""` for them — a caption the display was painting, read as blank.
    const read = async (): Promise<{
      caption: string;
      reported: string;
      status: string;
      temperature: string;
    }> => {
      const sample = await page.evaluate(
        () =>
          (
            window as unknown as {
              yunari?: {
                live?: { source?: { latest(key: string): unknown } };
              };
            }
          ).yunari?.live?.source?.latest("gpu.name") as
            | { textValue?: string; status?: string }
            | undefined,
      );
      return {
        caption: String(
          (await sceneProperty(page, "gpu-card-caption", "text")) ?? "",
        ),
        reported: String(sample?.textValue ?? ""),
        status: String(sample?.status ?? ""),
        temperature: String(
          (await sceneProperty(page, "gpu-card-temp", "text")) ?? "",
        ),
      };
    };

    // The card shows what the host said about the card, verbatim: a caption
    // painted from anything else is the misattribution this key exists to stop.
    //
    // **A host without that sensor is the other half of the claim.** Linux CI
    // has no LHM and no GPU name, so `gpu.name` never reports; the rule there is
    // the product's own — a missing reading is not fabricated (§ providers), so
    // the caption must stay the gap. Requiring a reading made this case a
    // statement about the runner's hardware rather than about the wiring.
    await expect
      .poll(
        async () => {
          const { caption, reported } = await read();
          return reported.length === 0 ? caption === "—" : caption === reported;
        },
        { timeout: 20_000 },
      )
      .toBe(true);

    // On a host that does report the card, it is a real name rather than the
    // gap, with a live figure beside it from the same card.
    const settled = await read();
    if (settled.reported.length === 0) {
      expect(settled.status, "no reading, so no `ok`").not.toBe("ok");
      expect(settled.caption, "a missing reading is not invented").toBe("—");
    } else {
      expect(settled.status).toBe("ok");
      expect(settled.caption).not.toBe("—");
      expect(settled.temperature).toMatch(/\d+°C$/);
    }
  });

  test("renders a hosted theme in the player and streams live samples", async ({
    page,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "one desktop pass is enough for the host path",
    );

    await page.goto(`${HOST}/?theme=${HOST_THEME_ID}&data=live`);

    // The scene revived from the host's package, not from a fixture bundle.
    await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();

    // `live` is only reported once a real batch arrives over SSE from the host;
    // the banner is removed then (see `showConnectionState`).
    await expect(page.locator("#yunari-connection")).toHaveCount(0, {
      timeout: 15_000,
    });

    const batchCount = await page.evaluate(
      () =>
        (window as unknown as { yunari?: { live?: { batchCount?: number } } })
          .yunari?.live?.batchCount ?? 0,
    );
    expect(batchCount).toBeGreaterThan(0);
  });

  /**
   * `vg-391`: no other case in the suite requires a sample to *repaint*.
   *
   * The case above proves a batch arrives and the connection banner goes, and
   * the paused-clock case requires two frames to be byte-identical. Neither
   * notices the update loop ceasing to reach the canvas, which is what
   * `display-fabric.spec.ts`'s deleted `keeps repainting as samples arrive`
   * covered — verified by sabotage in its own comment. This is its replacement,
   * and the row's own WHAT-SETTLES-IT: read the artboard, drive a sample, read
   * it again, require the pixels to differ.
   *
   * **The read is a screenshot of the Fabric canvas, not a property.** The
   * painted clock's *value* is a bound text the refresh updates whether or not
   * anything repaints, so `shownClock` alone would pass with the repaint cut;
   * the bitmap is what the author sees. Both are required, because either alone
   * has a green failure: `batchCount` moves on a batch that painted nothing, and
   * a moved reading moves without a repaint.
   */
  test("a live sample repaints the artboard", async ({ page }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "one desktop pass is enough for the host path",
    );

    await page.goto(`${HOST}/?theme=${HOST_THEME_ID}&data=live`);
    const artboard = page.locator("#artboard canvas.lower-canvas");
    await expect(artboard).toBeVisible();
    // A batch has arrived and been consumed, so the first frame is a painted
    // reading rather than the blank artboard a first paint would also move.
    await expect(page.locator("#yunari-connection")).toHaveCount(0, {
      timeout: 15_000,
    });
    // Polled rather than read once. The strip disappearing says a batch was
    // consumed, not that the repaint carrying the reading has been scheduled and
    // run — `requestRenderAll` puts it on a frame, so a single read raced that
    // frame and saw the placeholder. Read once this failed about two runs in
    // three; the poll is the same remedy the two assertions below already use.
    await expect
      .poll(() => shownClock(page), { timeout: 15_000 })
      .toMatch(/^\d{2}:\d{2}:\d{2}$/);
    const firstReading = await shownClock(page);
    await page.evaluate(() => document.fonts.ready);
    const batches = await liveBatches(page);
    const firstFrame = await artboard.screenshot();

    // A sample the display had not yet consumed, and the reading it moved to.
    await expect
      .poll(() => liveBatches(page), { timeout: 20_000 })
      .toBeGreaterThan(batches);
    await expect
      .poll(() => shownClock(page), { timeout: 20_000 })
      .not.toBe(firstReading);
    // Fabric's `requestRenderAll` schedules the paint on a frame, so the
    // screenshot is taken after the frame that carries it rather than in the
    // same tick as the property write.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );

    expect(
      Buffer.compare(firstFrame, await artboard.screenshot()),
      "the reading a sample moved to reached the artboard's pixels",
    ).not.toBe(0);
  });
});

/** The batches the display has consumed, as the display counts them. */
function liveBatches(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as unknown as { yunari?: { live?: { batchCount?: number } } })
        .yunari?.live?.batchCount ?? 0,
  );
}

/** A `HH:mm:ss` reading as seconds past midnight; not a clock face means none. */
function secondsOf(reading: string): number | undefined {
  const match = /^(\d{2}):(\d{2}):(\d{2})$/.exec(reading.trim());
  if (match === null) return undefined;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/** A clock face wraps: 23:59:59 is one second from 00:00:00, not a day. */
function secondsApart(a: number, b: number): number {
  const gap = Math.abs(a - b) % 86_400;
  return Math.min(gap, 86_400 - gap);
}

/** What a wall clock in `timeZone` — this PC's own when none is named — reads. */
function zoneReading(page: Page, timeZone?: string): Promise<string> {
  return page.evaluate(
    (zone) =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: zone,
        hourCycle: "h23",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date()),
    timeZone,
  );
}

/** The clock the host sent, as the scene actually painted it. */
async function shownClock(page: Page): Promise<string> {
  return String(await canvasProp(page, CLOCK_NODE_ID, "text"));
}

/**
 * Whether the painted clock agrees with a zone, to the second.
 *
 * The two readings are taken a round trip apart and the host samples at 1 Hz,
 * so the tolerance is the read loop's, not the feature's.
 */
async function paintedInZone(page: Page, timeZone?: string): Promise<boolean> {
  const shown = secondsOf(await shownClock(page));
  const expected = secondsOf(await zoneReading(page, timeZone));
  if (shown === undefined || expected === undefined) return false;
  return secondsApart(shown, expected) <= 2;
}

test.describe("the clock the host reports", () => {
  test("advances, and reads the zone this PC was set to", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "one desktop pass is enough for the host path",
    );

    await page.goto(`${HOST}/?theme=${HOST_THEME_ID}&data=live`);
    await expect(page.locator("#yunari-connection")).toHaveCount(0, {
      timeout: 15_000,
    });

    // The reading is a sample like any other, so it must move on its own: a
    // scene that painted once would show a frozen clock for ever.
    const first = await shownClock(page);
    await expect
      .poll(() => shownClock(page), { timeout: 10_000 })
      .not.toBe(first);

    // Nothing was chosen, so the host read this PC's own zone.
    await expect
      .poll(() => paintedInZone(page), { timeout: 10_000 })
      .toBe(true);

    // The zone is a host setting, so its proof is a repainted reading rather
    // than a stored preference. Tokyo is far enough from any plausible
    // default that agreement cannot be coincidence.
    const saved = await request.put(`${HOST}/api/display`, {
      data: { timeZone: "Asia/Tokyo" },
    });
    expect(saved.ok()).toBe(true);

    try {
      await expect
        .poll(() => paintedInZone(page, "Asia/Tokyo"), { timeout: 15_000 })
        .toBe(true);
    } finally {
      // The host is shared with the rest of the suite, and `display.json`
      // outlives this test even though the seeded themes do not.
      await request.put(`${HOST}/api/display`, { data: {} });
    }
  });
});

/**
 * The frame determinism `tests/e2e/clock.ts` exists to guarantee.
 *
 * The case that measured it was deleted with the schema-v1 retirement, along
 * with the fake-source themes it captured, and nothing in the suite compared two
 * frames afterwards (`vg-347`). This is that case rebuilt on a theme that still
 * exists: `HOST_CHART_THEME_ID` is one gauge that binds no reading, so the frame
 * has no variable left in it but time.
 *
 * **Why the ink check comes first, and why it is on the chart.** Two captures of
 * a blank artboard are byte-identical for a reason that says nothing about the
 * clock, and the deleted case failed exactly that way under load: one capture
 * came back a nearly empty artboard. The ink is read off the chart's own canvas,
 * so the frame being compared is the one the row is about.
 */
test.describe("a paused clock on one chart", () => {
  /** Every chart canvas on the display, with the ink on each — the same read
   *  `chartPixels` makes, sized down to what this case needs. */
  const chartsOn = (
    page: Page,
  ): Promise<{ readonly id: string; readonly ink: number }[]> =>
    chartPixels(page).then((charts) =>
      charts.map((chart) => ({ id: chart.id, ink: chart.ink })),
    );

  test("makes two frames of one chart byte-identical", async ({
    browser,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "the frame is compared in device pixels",
    );
    test.slow();

    /** One capture of the mounted display, on its own page and its own paused
     *  clock — the deleted case's shape, and the reason it is three pages rather
     *  than three shots of one: `page.clock` is context-scoped, so only a fresh
     *  context pauses at the same instant again. */
    const capture = async (): Promise<{
      readonly shot: Buffer;
      readonly charts: readonly { readonly id: string; readonly ink: number }[];
    }> => {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 720 },
      });
      // The scene's own canvas is the ready condition, and it is what gets
      // compared.
      await openPaused(
        page,
        `${HOST}/?theme=${HOST_CHART_THEME_ID}`,
        "#artboard canvas.lower-canvas",
      );
      // Charts paint synchronously inside `setOption` ("Ensure zr refresh
      // sychronously, and then pixel in canvas can be fetched after
      // `setOption`"), so a paused clock is not a wait for a frame — but the
      // chart's canvas is created by that paint, so the condition to wait on is
      // ink rather than a selector.
      await expect
        .poll(
          async () =>
            (await chartsOn(page)).reduce(
              (total, chart) => total + Math.max(0, chart.ink),
              0,
            ),
          { timeout: 30_000 },
        )
        .toBeGreaterThan(0);
      // **The connection strip is the readiness the ink check misses.** The
      // player re-resolves its theme with a navigation, and the new document
      // boots to "Connecting to the host" — a frame with ink already on its
      // chart canvas but nothing of the theme drawn, which is what made one
      // capture in six a blank frame under load. The strip is removed when the
      // source is live, so its absence, held past the window in which a
      // re-resolve remounts the page, is the settled document.
      await expect(page.locator("#yunari-connection")).toHaveCount(0, {
        timeout: 20_000,
      });
      await page.waitForTimeout(1_000);
      await expect(page.locator("#yunari-connection")).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      const shot = await page
        .locator("#artboard canvas.lower-canvas")
        .screenshot();
      const charts = await chartsOn(page);
      await page.close();
      return { shot, charts };
    };

    // The ink condition before the comparison, for the reason the describe says.
    // The chart is named as well as counted: the theme is one gauge and nothing
    // else, so ink from anywhere else would be a fixture that drifted.
    const painted = await capture();
    expect(
      painted.charts.map((chart) => chart.id),
      "the frame being compared is the fixture's own chart",
    ).toEqual([CHART_NODE_ID]);
    expect(
      painted.charts[0]?.ink ?? 0,
      "the chart drew ink before any two frames are compared",
    ).toBeGreaterThan(0);
    const first = await capture();
    const second = await capture();
    // Every capture, not the probe alone: two blank frames compare equal for a
    // reason that says nothing about the clock, and that is the failure the
    // deleted case hit under load.
    for (const [index, frame] of [first, second].entries()) {
      expect(
        frame.charts.map((chart) => chart.id),
        `capture ${index + 1} is the fixture's own chart`,
      ).toEqual([CHART_NODE_ID]);
      expect(
        frame.charts[0]?.ink ?? 0,
        `capture ${index + 1} drew ink before the two are compared`,
      ).toBeGreaterThan(0);
    }
    expect(Buffer.compare(first.shot, second.shot)).toBe(0);
  });
});

/** The live temperature sample the display consumed, as the display holds it. */
async function temperatureSample(page: Page): Promise<string> {
  return page.evaluate(() => {
    const source = (
      window as unknown as {
        yunari?: { live?: { source?: { latest(key: string): unknown } } };
      }
    ).yunari?.live?.source;
    const sample = source?.latest("gpu.temp") as
      | { status?: string; value?: number; unit?: string }
      | undefined;

    return sample?.value === undefined
      ? "no reading"
      : `${sample.value}${sample.unit ?? ""}`;
  });
}

/**
 * Whether the painted temperature is the sample the display consumed, in the
 * units this PC chose — or, when it is not, what was painted instead.
 *
 * Both sides are read in one `evaluate`, from the sample source the refresh
 * cycle reads, so the comparison is against the reading the paint came from and
 * not a later one that arrived over the stream in between. The sample's own
 * unit is checked first: a display that converted the reading rather than what
 * it shows would be changing what every other reader of that key sees (§97).
 */
async function paintsIn(
  page: Page,
  system: "metric" | "imperial",
): Promise<true | string> {
  return page.evaluate(
    ([chosen, nodeId]) => {
      const bridge = (
        window as unknown as {
          yunari?: {
            handle?: {
              canvas?: { getObjects(): { get(key: string): unknown }[] };
            };
            live?: { source?: { latest(key: string): unknown } };
          };
        }
      ).yunari;
      const sample = bridge?.live?.source?.latest("gpu.temp") as
        | { value?: number; unit?: string }
        | undefined;
      const object = bridge?.handle?.canvas
        ?.getObjects()
        .find((entry) => entry.get("id") === nodeId);

      if (sample?.value === undefined || object === undefined) {
        return "no reading to compare";
      }

      if (sample.unit !== "°C") {
        return `the sample's own unit became ${sample.unit}`;
      }

      const expected =
        chosen === "imperial"
          ? `${Math.round((sample.value * 9) / 5 + 32)}°F`
          : `${Math.round(sample.value)}°C`;
      const painted = String(object.get("text"));

      return painted === expected
        ? true
        : `painted ${painted}, expected ${expected}`;
    },
    [system, TEMPERATURE_NODE_ID] as const,
  );
}

test.describe("the units this PC reads in", () => {
  test("shows a temperature in the units this PC chose, converting nothing else", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "one desktop pass is enough for the host path",
    );

    await page.goto(`${HOST}/?theme=${HOST_TEMP_THEME_ID}&data=live`);
    await expect(page.locator("#yunari-connection")).toHaveCount(0, {
      timeout: 15_000,
    });

    // A GPU temperature is hardware this host may simply not have. A display
    // showing nothing is then the correct behaviour, not a failure of the
    // preference, so say which of the two this run is.
    test.skip(
      (await temperatureSample(page)) === "no reading",
      "this host reports no GPU temperature",
    );

    // Nothing was chosen, so the reading is what the provider measured.
    await expect
      .poll(() => paintsIn(page, "metric"), { timeout: 15_000 })
      .toBe(true);

    const saved = await request.put(`${HOST}/api/display`, {
      data: { measurement: "imperial" },
    });
    expect(saved.ok()).toBe(true);

    try {
      // The preference is read when a display loads, so the screen that is
      // already up is not what shows it.
      await page.reload();
      await expect(page.locator("#yunari-connection")).toHaveCount(0, {
        timeout: 15_000,
      });
      await expect
        .poll(() => paintsIn(page, "imperial"), { timeout: 15_000 })
        .toBe(true);
    } finally {
      await request.put(`${HOST}/api/display`, { data: {} });
    }
  });
});

/**
 * The display half of Task 11's checklist, and the only surface on which a
 * *missing* reading is a real state: the editor's preview source samples every
 * key it is asked for, so only a display fed by a provider that reports nothing
 * can show a gap.
 */
test.describe("a display fed by the real host", () => {
  test("paints a gap for a key nothing reports, never a zero", async ({
    page,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "one desktop pass is enough for the host path",
    );

    await page.goto(`${HOST}/?theme=${HOST_MISSING_THEME_ID}&data=live`);
    await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (
                window as unknown as {
                  yunari?: { live?: { batchCount?: number } };
                }
              ).yunari?.live?.batchCount ?? 0,
          ),
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);

    // A display must never invent a reading. The whole host has answered with
    // a batch and the node is still a gap, so the gap is the host's answer and
    // not a slow first frame.
    //
    // The host does report the key — as `status: "missing"` with a message
    // naming the cause and **no value at all**, which is the point: the gap is
    // declared, not absent. A fabricated `0` or an absent sample would both
    // look identical on screen, and this is the assertion that separates the
    // three.
    // `expect.poll` takes no argument in this Playwright, so the node id
    // travels into the page through `page.evaluate`, which does.
    const readGap = async (): Promise<{
      readonly text: string;
      readonly status: string;
      readonly hasValue: boolean;
    }> =>
      page.evaluate((nodeId) => {
        const handle = (
          window as unknown as {
            yunari?: {
              handle: {
                canvas: {
                  getObjects?(): Array<{ get(n: string): unknown }>;
                };
              };
              live?: { source?: { latest(k: string): unknown } };
            };
          }
        ).yunari;
        // The scene is revived asynchronously, so an unmounted canvas is "not
        // yet" rather than a reading — otherwise the poll would reject instead
        // of retrying.
        const getObjects = handle?.handle.canvas.getObjects;
        if (typeof getObjects !== "function")
          return { text: "", status: "", hasValue: false };
        const object = getObjects
          .call(handle!.handle.canvas)
          .find((candidate) => candidate.get("id") === nodeId);
        const sample = handle?.live?.source?.latest("quantum.entanglement") as
          | { status?: string; value?: unknown }
          | undefined;
        return {
          text: String(object?.get("text") ?? ""),
          status: String(sample?.status ?? ""),
          hasValue: sample !== undefined && "value" in sample,
        };
      }, CLOCK_NODE_ID);

    await expect
      .poll(readGap, { timeout: 20_000 })
      .toEqual({ text: "—", status: "missing", hasValue: false });
  });

  test("stores the picture the editor captured, and serves it back", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(`${HOST}/editor/`);
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();
    const saved = page.waitForRequest(
      (request) =>
        request.method() === "PUT" &&
        /^\/api\/themes\/[^/]+$/.test(new URL(request.url()).pathname),
    );
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: "Save to library" }).click();
    await expect(page.locator("#status")).toContainText("Saved to library", {
      timeout: 20_000,
    });
    const themeId = themeIdOfSave(await saved);

    // **The picture came back through the host's own route**, which is the only
    // place the capture path is exercised end to end: `vite preview` has no
    // thumbnail store.
    const response = await request.get(
      `${HOST}/api/themes/${themeId}/thumbnail`,
    );
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/png");
    const bytes = await response.body();
    expect(bytes.byteLength).toBeGreaterThan(1000);
    // PNG magic, so a JSON error body served as a picture cannot pass.
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

    // **And it is a picture of the theme, not a blank card.** The starter's
    // background plate is an opaque gradient, so a capture that carried the
    // composition has opaque pixels; one that captured nothing would not.
    const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;
    const census = await page.evaluate(async (source) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const surface = document.createElement("canvas");
      surface.width = image.naturalWidth;
      surface.height = image.naturalHeight;
      const context = surface.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(
        0,
        0,
        surface.width,
        surface.height,
      ).data;
      let opaque = 0;
      let clear = 0;
      let coloured = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3]! > 240) opaque += 1;
        if (pixels[i + 3]! === 0) clear += 1;
        const [r, g, b] = [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
        if (pixels[i + 3]! > 240 && Math.max(r, g, b) - Math.min(r, g, b) > 24)
          coloured += 1;
      }
      const total = pixels.length / 4;
      return {
        width: surface.width,
        height: surface.height,
        opaque: opaque / total,
        clear: clear / total,
        coloured: coloured / total,
      };
    }, dataUrl);
    // Not blank, and not a transparent card: the composition is in it.
    expect(census.width).toBeGreaterThan(100);
    expect(census.opaque, "the picture carries the theme").toBeGreaterThan(0.3);
    expect(
      census.coloured,
      "the picture is not one flat colour",
    ).toBeGreaterThan(0.001);

    // Kept as evidence, and looked at before it is kept. Gated like its two
    // siblings: this file is tracked, and rewriting it on every desktop-host
    // run left the working tree dirty with a picture nobody inspected.
    if (process.env["YUNARI_CAPTURE"] !== undefined) {
      await page.setContent(
        `<body style="margin:0;background:#0c0e13"><img src="${dataUrl}" style="display:block;width:${census.width * 2}px;image-rendering:pixelated"></body>`,
      );
      await page.waitForTimeout(400);
      await page.screenshot({
        path: "../../docs/evidence/screenshots/host-theme-thumbnail-desktop-chromium.png",
        fullPage: true,
      });
    }
  });

  test("reconnects after the stream fails, and the reading resumes", async ({
    page,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "one desktop pass is enough for the host path",
    );
    test.slow();

    // **The stream is refused, then allowed.** `page.context().setOffline` was
    // tried first and does not work here: with the context offline this
    // Chromium kept delivering batches over the open `EventSource` — 11 batches
    // across 20 s, no banner — so it tears down neither the connection nor the
    // reader. Blocking the route is the platform's own network layer and does
    // fail the connection, which is the state this exercises.
    //
    // **The matcher is a predicate because the URL carries a query.** It was
    // `"**/ws"`, and Playwright's glob is matched against the whole URL, which
    // for this stream is `…/ws?keys=…&session=…` — so **nothing was ever
    // refused**. The strip the case then caught was the ordinary
    // `"Connecting to the host — 1 sensors requested"` one `main.ts` draws
    // before the first batch, cleared about 250 ms later by the first sample;
    // every claim below was satisfied by an ordinary live stream, and the case
    // passed or failed on whether it looked inside that window (`vg-505`:
    // measured here as a strip present at 0 ms and gone from 250 ms on, with
    // the route still aborting). With the refusal real, the same window reads
    // `"Lost the host…"` and stays.
    //
    // What is **not** covered: an established connection dying mid-stream. The
    // state machine under test (`live-source.ts`) is the same either way — the
    // `error` listener sets `reconnecting` and the browser's own retry brings
    // it back — but the drop here happens at connect time.
    const refusesTheStream = (url: URL): boolean =>
      url.pathname.endsWith(SAMPLE_STREAM_PATH);
    await page.route(refusesTheStream, (route) => route.abort());
    await page.goto(`${HOST}/?theme=${HOST_THEME_ID}&data=live`);
    await expect(page.locator("#yunari-connection")).toBeVisible({
      timeout: 30_000,
    });
    // The banner names the state, so a page that merely failed to load cannot
    // pass it — **and neither can the connecting copy.** `/reconnect|connect/i`
    // matched `"Connecting to the host…"`, which is how the broken matcher
    // above went unnoticed for so long: the two states are two sentences, and
    // the assertion is the reconnecting one, from the copy's own owner.
    await expect(page.locator("#yunari-connection")).toHaveText(
      uiCopy.connection.reconnecting,
    );

    // **And it recovers by itself.** The retry is the browser's, not a reload:
    // the page is never navigated again, so a passing banner only means the
    // stream came back.
    await page.unroute(refusesTheStream);
    await expect(page.locator("#yunari-connection")).toHaveCount(0, {
      timeout: 60_000,
    });
    const batches = await page.evaluate(
      () =>
        (
          window as unknown as {
            yunari?: { live?: { batchCount?: number } };
          }
        ).yunari?.live?.batchCount ?? 0,
    );
    expect(batches, "samples arrived after the reconnect").toBeGreaterThan(0);
    // And a real reading is on the canvas, not just an open socket.
    await expect
      .poll(async () => await shownClock(page), { timeout: 30_000 })
      .toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  test("the starter's frosted card shows its packaged photograph on the display, untainted", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "one desktop pass is enough");
    test.slow();

    // **The whole route, end to end.** The editor packages the photograph, the
    // host stores it and answers `/api/themes/<id>/assets/<path>`, and the
    // player decodes that response. This is the mount where a cross-origin
    // backdrop would have bitten: the display is the surface that captures
    // thumbnails and that every pixel-reading guard measures.
    await saveStarterThroughTheHost(page);
    // **The artboard's own size, which is the reference read.** The host
    // project's viewport is 1280x720, and at that size the same band reads
    // 0.70 rather than 1.38 — the display's glass sampler loses contrast as
    // the artboard is scaled down (see the editor-side probe, which reads
    // 4.46 at its own 0.37 camera scale). 1672x941 is where the starter is
    // designed to be read, and where the registered capture is taken.
    await page.setViewportSize({ width: 1672, height: 941 });
    const themeId = await openStarterDisplay(page);
    await page.waitForSelector('canvas[data-yunari="artboard"]');
    await page.waitForFunction(
      () => {
        const image = document.querySelector<HTMLImageElement>(
          "[data-yunari-background-media] img",
        );
        return (
          image !== null &&
          image.complete &&
          image.naturalWidth > 0 &&
          image.naturalHeight > 0
        );
      },
      undefined,
      { timeout: 30_000 },
    );
    // The photograph came off the host's own route, at the size it declared.
    const delivered = await page.evaluate(
      () =>
        document
          .querySelector<HTMLImageElement>("[data-yunari-background-media] img")
          ?.getAttribute("src") ?? "",
    );
    expect(delivered).toBe(
      `/api/themes/${themeId}/assets/starter-backdrop.jpg`,
    );

    // The card's own contents are hidden while the band is read: `cpu-card` has
    // no empty region, and a band crossing a glyph measures the glyph —
    // identically with and without the blur, which is what the first version
    // of the editor-side probe reported (peak 27.82 -> 27.82).
    const bands = await starterCardBands(page, "cpu-card", {
      left: 70,
      top: 70,
      width: 140,
      height: 167,
    });
    const { blurred, sharp, clearBlurred, clearSharp, photo } = bands;

    // **The panel blurs the photograph, at this mount's scale.** The band is a
    // rectangle in artboard units and `object-fit: cover` puts the whole file
    // over the artboard, so the backdrop under the panel must measure what
    // that rectangle of the photograph measures. Before 0012 the sampler took
    // a pixel-for-pixel crop of the middle of the file sized by the device
    // rect — the middle 71.8 % here where the element shows all of it — and
    // this read 5.08 against the 7.45 below. The editor, at its 0.3744
    // camera, read 16.54 against the same control. That was the
    // 4.46-against-1.38 divergence the plan carried as an open question: the
    // editor was the mount sampling elsewhere, and both mounts now read the
    // same value off the same photograph.
    expect(photo, "the photograph was read as a control").not.toBeNull();
    expect(
      Math.abs(clearSharp.contrast - photo!.contrast),
      `the display's backdrop is the photograph (panel ${clearSharp.contrast} vs photo ${photo!.contrast})`,
    ).toBeLessThan(photo!.contrast * 0.15);
    expect(
      Math.abs(clearSharp.meanLuma - photo!.meanLuma),
      "and it is the same part of the photograph, not merely a similar range",
    ).toBeLessThan(photo!.meanLuma * 0.08);

    // Measured on this machine, 2026-10-04, at 1672x941 with this card's 40-unit
    // radius and its `#0815234d` (30 %-opaque) fill: the same backdrop under a
    // clear fill reads 7.51 sharp against 1.76 diffused, the authored panel
    // reads 1.24, and the authored panel at radius 0 reads 5.26. The gradient
    // this replaced has a mean luma step between adjacent columns of **0.00**
    // at every scale, so a panel over it could not read above zero however wide
    // the radius was.
    //
    // **The card's own group was being hidden along with its parts**, which is
    // the whole reason this used to read as the picture showing through the
    // panel when the panel was not there at all — see `starterCardBands`.
    expect(blurred.rows, "the band covers rows").toBeGreaterThan(20);

    // **And it is the glass that did it.** The blur-off control is the same
    // authored panel through the same code path with `blurRadius: 0`, so the
    // only difference is the radius: 6.17 against 1.46, a **4.2x** drop. A
    // panel that merely tinted its backdrop would move this number not at all.
    expect(
      sharp.contrast / blurred.contrast,
      `the display's frosted panel is diffused by its own treatment (${sharp.contrast} at radius 0 against ${blurred.contrast} authored)`,
    ).toBeGreaterThan(3);
    // Diffused, not erased: 23 % of the range survives.
    expect(
      clearBlurred.contrast,
      "the blur diffuses the backdrop rather than erasing it",
    ).toBeGreaterThan(clearSharp.contrast * 0.15);

    // **The floor that separates "a photograph is behind this" from "an even
    // fill"**: about 1.28 here against 1.08 in the editor's mount, and 0.00 for
    // the even gradient at every radius.
    expect(
      blurred.contrast,
      "the display's frosted panel carries backdrop structure",
    ).toBeGreaterThan(0.6);

    // **Taint.** The bytes are same-origin, so the display's canvas is not
    // tainted, and the capture path that reads it back works. A CDN URL would
    // have rendered the same picture and failed exactly here.
    const taint = await page.evaluate(() => {
      const element = document.querySelector<HTMLCanvasElement>(
        'canvas[data-yunari="artboard"]',
      );
      if (element === null) throw new Error("the display canvas is missing");
      try {
        element.getContext("2d")!.getImageData(0, 0, 1, 1);
        return { read: "pixels", dataUrl: element.toDataURL().length };
      } catch (error) {
        return { read: `threw: ${String(error)}`, dataUrl: 0 };
      }
    });
    expect(taint.read, "the display canvas is not tainted").toBe("pixels");
    expect(taint.dataUrl, "and it encodes").toBeGreaterThan(10_000);
  });

  test("plays the reference composition on the real host, for visual review", async ({
    page,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "the reference composition is a desktop read",
    );
    test.slow();

    // **The display surface, not the editor's preview.** The editor's preview
    // source attaches no units, so a screenshot of the editor shows "29" where
    // the display shows "47%", and the reference image is a display. Saving
    // through the host's own route keeps this the same document a consumer
    // would load.
    await page.goto(`${HOST}/editor/`);
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: "Save to library" }).click();
    await expect(page.locator("#status")).toContainText("Saved to library", {
      timeout: 20_000,
    });

    await page.setViewportSize({ width: 1672, height: 941 });
    await openStarterDisplay(page, "&data=live");
    await page.waitForSelector('canvas[data-yunari="artboard"]');
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (
                window as unknown as {
                  yunari?: { live?: { batchCount?: number } };
                }
              ).yunari?.live?.batchCount ?? 0,
          ),
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);
    // Until the readings arrive every card shows a gap, which is a truthful
    // picture of nothing and not the one being compared.
    await expect
      .poll(
        async () => {
          const painted = await page.evaluate(() => {
            const handle = (
              window as unknown as {
                yunari?: {
                  handle: {
                    canvas: {
                      getObjects?(): Array<{ get(n: string): unknown }>;
                    };
                  };
                };
              }
            ).yunari;
            // The scene revives asynchronously, so an unmounted canvas is "not
            // yet" rather than a reading.
            const getObjects = handle?.handle.canvas.getObjects;
            if (typeof getObjects !== "function") return "";
            return String(
              getObjects
                .call(handle!.handle.canvas)
                .find((object) => object.get("id") === "storage-card-value")
                ?.get("text") ?? "",
            );
          });
          return painted;
        },
        { timeout: 30_000 },
      )
      .not.toBe("—");

    await expect(page.locator("#yunari-connection")).toHaveCount(0);
    // **Charts, waited on rather than slept through.** The stream can take
    // several seconds to connect, and a chart's line chart is a rolling
    // window — so the condition to wait for is the one being captured: a
    // trends series that actually has points. A sleep would produce a picture
    // of an empty scene and call it evidence.
    //
    // **Groups descended**, for the reason every other reader here says it:
    // `trends-chart` is a part of `group-trends-card`, and the root-only
    // search this replaced found no chart at all, so the wait ran out its full
    // 60 s on a series of zero points that was never going to arrive.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            type Obj = {
              get(id: string): unknown;
              getObjects?(): readonly Obj[];
            };
            const canvas = (
              window as unknown as {
                yunari?: {
                  handle: { canvas?: { getObjects(): readonly Obj[] } };
                };
              }
            ).yunari?.handle.canvas;
            const find = (objects: readonly Obj[]): Obj | undefined => {
              for (const candidate of objects) {
                if (candidate.get("id") === "trends-chart") return candidate;
                const found = find(candidate.getObjects?.() ?? []);
                if (found !== undefined) return found;
              }
              return undefined;
            };
            const chart =
              canvas === undefined ? undefined : find(canvas.getObjects());
            const series =
              (
                chart as
                  | {
                      _chart?: {
                        getOption(): { series?: Array<{ data?: unknown[] }> };
                      };
                    }
                  | undefined
              )?._chart?.getOption().series ?? [];
            return series.reduce(
              (total, entry) => total + (entry.data?.length ?? 0),
              0,
            );
          }),
        { timeout: 60_000 },
      )
      .toBeGreaterThan(10);
    await captureVisualReview(page, testInfo, "player-reference");
  });
});

/* ------------------------------------------------------------------------ *
 * The player's own acceptance surface: a second viewport, a second device
 * pixel ratio, and glass under a group, a rotation and an intersection.
 *
 * These live here and not in `reference-theme.spec.ts` because this file is
 * the one the config pins to `workers: 1` under the `desktop-host` project:
 * every test below boots a real host whose stores are a directory on disk, and
 * a spec outside that project would run beside `host-settings.spec.ts` in
 * parallel. The editor's half of the same clause stays where it is.
 * ------------------------------------------------------------------------ */

/** The starter's own artboard, which both mounts below letterbox into a
 *  viewport that is not its size. */
const STARTER = { width: 1672, height: 941 } as const;

/** `contain` fit of the starter into a viewport, to the pixel. */
/**
 * `host` is the box the renderer fits — `#artboard`'s, which is the viewport
 * *less* the chrome's bands, not the viewport.
 *
 * Read from the page rather than passed as a literal since Phase 1 of plan 8:
 * `index.html` pinned the host to `inset: 0` before that, so the two boxes were
 * the same one and this could take a viewport. Where `contain` binds on width
 * the distinction is invisible, which is why only the 1600x760 read — the one
 * that binds on height — caught it: measured, the scale was 0.7768 against a
 * viewport-derived 0.8077, exactly the 29px of chrome over 941.
 */
function expectContainFit(
  actual: { scale: number; offsetX: number; offsetY: number },
  host: { width: number; height: number },
): void {
  const scale = Math.min(
    host.width / STARTER.width,
    host.height / STARTER.height,
  );
  expect(actual.scale, "the artboard is fitted, not drawn at 1:1").toBeCloseTo(
    scale,
    2,
  );
  // A 1:1 view would carry no offset at all; these are the letterbox bars.
  expect(
    Math.abs(actual.offsetX) + Math.abs(actual.offsetY),
    "the fitted view letterboxes on at least one axis",
  ).toBeGreaterThan(0.5);
}

/** The player's own `StaticCanvas`, its fit and its backing store. */
function playerSurface(page: Page): Promise<{
  scale: number;
  offsetX: number;
  offsetY: number;
  cssWidth: number;
  backingWidth: number;
  dpr: number;
}> {
  return page.evaluate(() => {
    const canvas = (
      window as unknown as {
        yunari?: {
          handle: {
            canvas: {
              viewportTransform: number[];
              lowerCanvasEl: HTMLCanvasElement;
              renderAll(): void;
            };
          };
        };
      }
    ).yunari?.handle.canvas;
    if (canvas === undefined) throw new Error("the player has not mounted");
    canvas.renderAll();
    const vp = canvas.viewportTransform;
    return {
      scale: vp[0] ?? 0,
      offsetX: vp[4] ?? 0,
      offsetY: vp[5] ?? 0,
      cssWidth: canvas.lowerCanvasEl.getBoundingClientRect().width,
      backingWidth: canvas.lowerCanvasEl.width,
      dpr: window.devicePixelRatio,
    };
  });
}

/** A text object's own glyph coverage, with the box minus the text as the
 *  control. A count of "non-background pixels" alone would pass on any lit
 *  card, so the difference is what the glyphs contributed. */
function glyphCoverage(
  page: Page,
  id: string,
): Promise<{ covered: number; area: number; width: number; height: number }> {
  return page.evaluate((objectId) => {
    type Obj = {
      get(n: string): unknown;
      calcTransformMatrix(): number[];
      visible: boolean;
    };
    const canvas = (
      window as unknown as {
        yunari?: {
          handle: {
            canvas: {
              getObjects(): Obj[];
              viewportTransform: number[];
              lowerCanvasEl: HTMLCanvasElement;
              renderAll(): void;
              getRetinaScaling(): number;
            };
          };
        };
      }
    ).yunari?.handle.canvas;
    if (canvas === undefined) throw new Error("the player has not mounted");
    const object = canvas
      .getObjects()
      .find((candidate) => candidate.get("id") === objectId);
    if (object === undefined) throw new Error(`no object ${objectId}`);
    const vp = canvas.viewportTransform;
    const retina = canvas.getRetinaScaling();
    const m = object.calcTransformMatrix();
    // The object's own local units to the painted surface, so the band is the
    // glyph's own box rather than an artboard rectangle that happens to be near
    // it — the same composition `glass.ts` samples through.
    const toDevice = (x: number, y: number): readonly [number, number] => [
      (m[0]! * x + m[2]! * y + m[4]!) * (vp[0]! * retina) +
        (m[1]! * x + m[3]! * y + m[5]!) * (vp[2]! * retina) +
        vp[4]! * retina,
      (m[0]! * x + m[2]! * y + m[4]!) * (vp[1]! * retina) +
        (m[1]! * x + m[3]! * y + m[5]!) * (vp[3]! * retina) +
        vp[5]! * retina,
    ];
    const halfWidth = Number(
      (object as unknown as Record<string, unknown>)["width"],
    );
    const halfHeight = Number(
      (object as unknown as Record<string, unknown>)["height"],
    );
    const corners = [
      [-halfWidth / 2, -halfHeight / 2],
      [halfWidth / 2, -halfHeight / 2],
      [halfWidth / 2, halfHeight / 2],
      [-halfWidth / 2, halfHeight / 2],
    ].map(([x, y]) => toDevice(x!, y!));
    const xs = corners.map((point) => point[0]);
    const ys = corners.map((point) => point[1]);
    const left = Math.max(0, Math.round(Math.min(...xs)));
    const top = Math.max(0, Math.round(Math.min(...ys)));
    const width = Math.max(
      1,
      Math.min(canvas.lowerCanvasEl.width, Math.round(Math.max(...xs))) - left,
    );
    const height = Math.max(
      1,
      Math.min(canvas.lowerCanvasEl.height, Math.round(Math.max(...ys))) - top,
    );
    const context = canvas.lowerCanvasEl.getContext("2d")!;
    /** Pixels that are not the box's own fill. */
    const inked = (): number => {
      const data = context.getImageData(left, top, width, height).data;
      const luma = (i: number): number =>
        0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
      const every: number[] = [];
      for (let i = 0; i < data.length; i += 4) every.push(luma(i));
      const sorted = [...every].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
      let ink = 0;
      for (const value of every) if (Math.abs(value - median) > 40) ink += 1;
      return ink;
    };
    canvas.renderAll();
    const withText = inked();
    const was = object.visible;
    object.visible = false;
    canvas.renderAll();
    const without = inked();
    object.visible = was;
    canvas.renderAll();
    return { covered: withText - without, area: width * height, width, height };
  }, id);
}

/**
 * Band statistics inside a panel, on the player's own canvas.
 *
 * The band is the object's **own rotated box**, inset to stay inside a turned
 * or grouped panel: the editor's helper offsets from the axis-aligned bounding
 * rect, which for a 30° panel is mostly panel-free space. The blur radius can
 * be overridden in place, which is the control — the same code path with the
 * blur off, so a reading of "soft" is a reading of the blur and not of a dark
 * panel.
 */
/**
 * A starter card read twice, with its own contents taken out of the picture.
 *
 * `panelBand` above addresses a panel through `calcTransformMatrix` and
 * ±width/2, which is a **centre** origin. Every starter card is authored
 * top-left (`rect()` in `new-fabric-theme-objects.ts`), so that arithmetic
 * would read a region half a card away. `getBoundingRect` carries the origin
 * with it, which is why this is a second helper rather than a call to the
 * first.
 *
 * The contents are hidden for both readings and restored after, and both
 * radii are read here in one call so the second cannot inherit the first's —
 * which is how the editor-side probe's first version reported the same number
 * twice. The control is the blur, not the card: `blurRadius: 0` leaves the
 * treatment present, so the panel still composites and only the radius differs.
 */
function starterCardBands(
  page: Page,
  id: string,
  inset: { left: number; top: number; width: number; height: number },
): Promise<{
  blurred: { peak: number; contrast: number; rows: number; meanLuma: number };
  sharp: { peak: number; contrast: number; rows: number; meanLuma: number };
  clearBlurred: {
    peak: number;
    contrast: number;
    rows: number;
    meanLuma: number;
  };
  clearSharp: {
    peak: number;
    contrast: number;
    rows: number;
    meanLuma: number;
  };
  photo: {
    columns: number;
    peak: number;
    contrast: number;
    meanLuma: number;
  } | null;
}> {
  return page.evaluate(
    ([objectId, box]) => {
      type Obj = {
        get(n: string): unknown;
        set(n: string, v: unknown): void;
        getObjects?(): Obj[];
        getBoundingRect(): {
          left: number;
          top: number;
          width: number;
          height: number;
        };
      };
      const canvas = (
        window as unknown as {
          yunari?: {
            handle: {
              canvas: {
                getObjects(): Obj[];
                viewportTransform: number[];
                lowerCanvasEl: HTMLCanvasElement;
                renderAll(): void;
                getRetinaScaling(): number;
              };
            };
          };
        }
      ).yunari?.handle.canvas;
      if (canvas === undefined) throw new Error("the player has not mounted");
      const find = (objects: Obj[]): Obj | undefined => {
        for (const candidate of objects) {
          if (candidate.get("id") === objectId) return candidate;
          const child = find(candidate.getObjects?.() ?? []);
          if (child !== undefined) return child;
        }
        return undefined;
      };
      const objects = canvas.getObjects();
      const card = find(objects);
      if (card === undefined) throw new Error(`no object ${objectId}`);
      const cardBox = card.getBoundingRect();
      const inside = (object: Obj): boolean => {
        const rect = object.getBoundingRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        return (
          cx > cardBox.left &&
          cx < cardBox.left + cardBox.width &&
          cy > cardBox.top &&
          cy < cardBox.top + cardBox.height
        );
      };
      // **The whole document, and never the card's own ancestors.** This walked
      // the roots only, which fails twice over: `cpu-card` is a *part* of
      // `group-cpu-card`, so the one root whose box covers the card was hidden
      // and took the panel off the canvas with it, and the card's own icon,
      // title, reading and sparkline — the things a band must not cross — were
      // never hidden at all because they are not roots. The same substitution
      // `reference-theme.spec.ts` carries.
      const every: { object: Obj; parents: Obj[] }[] = [];
      const collect = (list: Obj[], parents: Obj[]): void => {
        for (const entry of list) {
          every.push({ object: entry, parents });
          collect(entry.getObjects?.() ?? [], [...parents, entry]);
        }
      };
      collect(objects, []);
      const ancestors = new Set<Obj>();
      for (const entry of every)
        if (entry.object === card)
          for (const parent of entry.parents) ancestors.add(parent);
      const restore = every
        .filter(
          (entry) =>
            entry.object !== card &&
            !ancestors.has(entry.object) &&
            inside(entry.object),
        )
        .map((entry) => [entry.object, entry.object.get("visible")] as const);
      for (const [object] of restore) object.set("visible", false);

      const vp = canvas.viewportTransform;
      const retina = canvas.getRetinaScaling();
      const toDevice = (x: number, y: number): readonly [number, number] => [
        (x * vp[0]! + y * vp[2]! + vp[4]!) * retina,
        (x * vp[1]! + y * vp[3]! + vp[5]!) * retina,
      ];
      const [x0, y0] = toDevice(cardBox.left + box.left, cardBox.top + box.top);
      const [x1, y1] = toDevice(
        cardBox.left + box.left + box.width,
        cardBox.top + box.top + box.height,
      );
      const left = Math.max(0, Math.round(x0));
      const top = Math.max(0, Math.round(y0));
      const width = Math.max(
        1,
        Math.min(canvas.lowerCanvasEl.width, Math.round(x1)) - left,
      );
      const height = Math.max(
        1,
        Math.min(canvas.lowerCanvasEl.height, Math.round(y1)) - top,
      );
      const measure = (): {
        peak: number;
        contrast: number;
        rows: number;
        meanLuma: number;
      } => {
        canvas.renderAll();
        const data = canvas.lowerCanvasEl
          .getContext("2d")!
          .getImageData(left, top, width, height).data;
        const means = new Array<number>(width).fill(0);
        for (let y = 0; y < height; y += 1)
          for (let x = 0; x < width; x += 1) {
            const i = (y * width + x) * 4;
            means[x]! +=
              0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
          }
        for (let x = 0; x < width; x += 1) means[x]! /= height;
        let peak = 0;
        for (let x = 1; x < width; x += 1)
          peak = Math.max(peak, Math.abs(means[x]! - means[x - 1]!));
        return {
          peak: Math.round(peak * 100) / 100,
          contrast:
            Math.round((Math.max(...means) - Math.min(...means)) * 100) / 100,
          rows: height,
          meanLuma:
            Math.round((means.reduce((a, b) => a + b, 0) / width) * 100) / 100,
        };
      };

      const authored = card.get("yunariGlass") as { blurRadius: number };
      const authoredFill = card.get("fill") as string;
      card.set("yunariGlass", authored);
      const blurred = measure();
      card.set("yunariGlass", { blurRadius: 0 });
      const sharp = measure();
      card.set("yunariGlass", authored);
      card.set("fill", "rgba(8, 21, 35, 0)");
      const clearBlurred = measure();
      card.set("yunariGlass", { blurRadius: 0 });
      const clearSharp = measure();
      card.set("fill", authoredFill);
      card.set("yunariGlass", authored);
      for (const [object, visible] of restore) object.set("visible", visible);
      canvas.renderAll();

      // **The photograph itself, with no product code in the path.** The band
      // is a rectangle in artboard units and `object-fit: cover` puts the
      // whole file over the artboard, so the band's source rectangle is its
      // own scene fraction of the file. Read at this mount's own column
      // count, because the count is what decides how much of the file each
      // column averages.
      const photo = (() => {
        const image = document.querySelector<HTMLImageElement>(
          "[data-yunari-background-media] img",
        );
        if (image === null || !image.complete || image.naturalWidth === 0) {
          return null;
        }
        const artboardWidth = 1672;
        const artboardHeight = 941;
        const u0 = (cardBox.left + box.left) / artboardWidth;
        const u1 = (cardBox.left + box.left + box.width) / artboardWidth;
        const v0 = (cardBox.top + box.top) / artboardHeight;
        const v1 = (cardBox.top + box.top + box.height) / artboardHeight;
        const columns = width;
        const rows = Math.max(
          2,
          Math.round(
            (columns * (v1 - v0) * artboardHeight) /
              ((u1 - u0) * artboardWidth),
          ),
        );
        const probe = document.createElement("canvas");
        probe.width = columns;
        probe.height = rows;
        const context = probe.getContext("2d");
        if (context === null) return null;
        context.drawImage(
          image,
          u0 * image.naturalWidth,
          v0 * image.naturalHeight,
          (u1 - u0) * image.naturalWidth,
          (v1 - v0) * image.naturalHeight,
          0,
          0,
          columns,
          rows,
        );
        const data = context.getImageData(0, 0, columns, rows).data;
        const means = new Array<number>(columns).fill(0);
        for (let y = 0; y < rows; y += 1)
          for (let x = 0; x < columns; x += 1) {
            const i = (y * columns + x) * 4;
            means[x]! +=
              0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
          }
        for (let x = 0; x < columns; x += 1) means[x]! /= rows;
        let peak = 0;
        for (let x = 1; x < width; x += 1)
          peak = Math.max(peak, Math.abs(means[x]! - means[x - 1]!));
        return {
          columns,
          peak: Math.round(peak * 100) / 100,
          contrast:
            Math.round((Math.max(...means) - Math.min(...means)) * 100) / 100,
          meanLuma:
            Math.round((means.reduce((a, b) => a + b, 0) / columns) * 100) /
            100,
        };
      })();
      return { blurred, sharp, clearBlurred, clearSharp, photo };
    },
    [id, inset] as const,
  );
}

function panelBand(
  page: Page,
  id: string,
  blurRadius?: number,
): Promise<{ peak: number; contrast: number; width: number; height: number }> {
  return page.evaluate(
    ([objectId, radius]) => {
      type Obj = {
        get(n: string): unknown;
        set(n: string, v: unknown): void;
        getObjects?(): Obj[];
        calcTransformMatrix(): number[];
      };
      const canvas = (
        window as unknown as {
          yunari?: {
            handle: {
              canvas: {
                getObjects(): Obj[];
                viewportTransform: number[];
                lowerCanvasEl: HTMLCanvasElement;
                renderAll(): void;
                getRetinaScaling(): number;
              };
            };
          };
        }
      ).yunari?.handle.canvas;
      if (canvas === undefined) throw new Error("the player has not mounted");
      // Groups walked: the panel this measures may be a group child, which is
      // the whole point of the grouped case.
      const find = (objects: Obj[]): Obj | undefined => {
        for (const candidate of objects) {
          if (candidate.get("id") === objectId) return candidate;
          const child = find(candidate.getObjects?.() ?? []);
          if (child !== undefined) return child;
        }
        return undefined;
      };
      const object = find(canvas.getObjects());
      if (object === undefined) throw new Error(`no object ${objectId}`);
      if (typeof radius === "number")
        object.set("yunariGlass", { blurRadius: radius });
      const vp = canvas.viewportTransform;
      const retina = canvas.getRetinaScaling();
      // Local (centre-origin) -> scene -> device, in that order, which is the
      // composition `sampleRegion` uses for the region it copies. Folding the
      // viewport into the local step instead puts the band at a different
      // address from the one the panel sampled, and the measurement then reads
      // empty canvas. `calcTransformMatrix` already carries group ancestry, so
      // a turned or grouped child needs no special case here.
      const m = object.calcTransformMatrix();
      const toDevice = (x: number, y: number): readonly [number, number] => {
        const sceneX = m[0]! * x + m[2]! * y + m[4]!;
        const sceneY = m[1]! * x + m[3]! * y + m[5]!;
        return [
          (vp[0]! * sceneX + vp[2]! * sceneY + vp[4]!) * retina,
          (vp[1]! * sceneX + vp[3]! * sceneY + vp[5]!) * retina,
        ];
      };
      const halfWidth = Number(
        (object as unknown as Record<string, unknown>)["width"],
      );
      const halfHeight = Number(
        (object as unknown as Record<string, unknown>)["height"],
      );
      // The panel's own untransformed corners, exactly the box `localPath`
      // clips to inside `glass.ts`.
      const corners = [
        [-halfWidth / 2, -halfHeight / 2],
        [halfWidth / 2, -halfHeight / 2],
        [halfWidth / 2, halfHeight / 2],
        [-halfWidth / 2, halfHeight / 2],
      ].map(([x, y]) => toDevice(x!, y!));
      const xs = corners.map((point) => point[0]);
      const ys = corners.map((point) => point[1]);
      const rawLeft = Math.min(...xs);
      const rawTop = Math.min(...ys);
      const rawRight = Math.max(...xs);
      const rawBottom = Math.max(...ys);
      // A quarter of the shorter side in, so the band is inside the panel even
      // turned 30°; the rounded corners are further out still.
      const inset = Math.round(
        Math.min(rawRight - rawLeft, rawBottom - rawTop) / 4,
      );
      const left = Math.max(0, Math.round(rawLeft) + inset);
      const top = Math.max(0, Math.round(rawTop) + inset);
      const width = Math.max(
        1,
        Math.min(canvas.lowerCanvasEl.width, Math.round(rawRight) - inset) -
          left,
      );
      const height = Math.max(
        1,
        Math.min(canvas.lowerCanvasEl.height, Math.round(rawBottom) - inset) -
          top,
      );
      canvas.renderAll();
      const data = canvas.lowerCanvasEl
        .getContext("2d")!
        .getImageData(left, top, width, height).data;
      const means = new Array<number>(width).fill(0);
      for (let y = 0; y < height; y += 1)
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4;
          means[x]! +=
            0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
        }
      for (let x = 0; x < width; x += 1) means[x]! /= height;
      let peak = 0;
      for (let x = 1; x < width; x += 1)
        peak = Math.max(peak, Math.abs(means[x]! - means[x - 1]!));
      return {
        peak: Math.round(peak * 100) / 100,
        contrast:
          Math.round((Math.max(...means) - Math.min(...means)) * 100) / 100,
        width,
        height,
      };
    },
    [id, blurRadius] as const,
  );
}

test.describe("the real player at the sizes and shapes it is read at", () => {
  test("renders the reference composition at a fitted viewport and a second device pixel ratio", async ({
    page,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "the reference composition is a desktop read",
    );
    test.slow();

    // **The claim is pixels at two sizes the mount had never been read at.**
    // The reference capture ran at 1672x941 and nothing else, so a fitted view
    // and a retina view were both unmeasured on the player's own canvas.
    await saveStarterThroughTheHost(page);

    /**
     * A ring that drew its arc, a bar that drew its fill, and a text run that
     * drew its glyphs — read as fractions of their own areas, so one floor
     * holds at whatever render scale the mount resolved.
     *
     * The gauge floor is the arc-less baseline of the reference measurement
     * rescaled: `ram-gauge` read 219 coloured pixels with no arc and 553 with
     * a datum of 0, on 436x436, and both scale with the chart's own area. 0.2 %
     * of the area sits 1.7x above the first and 1.4x below the second, so an
     * arc that vanished fails and a legitimately empty gauge still passes.
     */
    const readTheDisplay = async (
      where: string,
    ): Promise<{
      surface: Awaited<ReturnType<typeof playerSurface>>;
      arcs: Record<string, number>;
      datum: Record<string, boolean>;
      barInk: number;
      barChroma: number;
      wordmark: Awaited<ReturnType<typeof glyphCoverage>>;
    }> => {
      await openStarterDisplay(page, "&data=live");
      await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();
      await expect(page.locator("[data-yunari-load-failure]")).toHaveCount(0);
      // A gauge with no reading has no datum, and a datum is what the arc is
      // made of; the reading is read before the ring is counted.
      await expect
        .poll(() => canvasProp(page, "ram-value", "text"), { timeout: 30_000 })
        .toMatch(/^\d+%$/);
      const surface = await playerSurface(page);
      const charts = await chartPixels(page);
      const ratio = (id: string, field: "chroma" | "ink"): number => {
        const chart = charts.find((candidate) => candidate.id === id);
        expect(chart, `${id} is on the display at ${where}`).toBeDefined();
        return chart![field] / (chart!.w * chart!.h);
      };
      return {
        surface,
        arcs: {
          "ram-gauge": ratio("ram-gauge", "chroma"),
          "vram-gauge": ratio("vram-gauge", "chroma"),
        },
        // **A gauge without a datum draws no arc, and that is the rule, not a
        // failure** (`0008`): the reading's text is the gap `—%` until the host
        // reports one. Linux CI has no VRAM provider, so the floor below is
        // asserted only where a datum exists.
        datum: {
          "ram-gauge": /^\d+%$/.test(
            String(await canvasProp(page, "ram-value", "text")),
          ),
          "vram-gauge": /^\d+%$/.test(
            String(await canvasProp(page, "vram-value", "text")),
          ),
        },
        barInk: ratio("storage-bar", "ink"),
        barChroma: ratio("storage-bar", "chroma"),
        wordmark: await glyphCoverage(page, "wordmark"),
      };
    };

    // **A fitted viewport**, letterboxed on the horizontal axis, and not 1:1.
    await page.setViewportSize({ width: 1600, height: 760 });
    const fitted = await readTheDisplay("1600x760 @1x");
    // The host, not the 1600x760 viewport: the chrome's bands are already out
    // of it, and this read is the one that binds on height.
    expectContainFit(
      fitted.surface,
      (await page.locator("#artboard").boundingBox())!,
    );
    expect(fitted.surface.dpr, "the first read is at one device pixel").toBe(1);
    for (const [id, share] of Object.entries(fitted.arcs))
      if (fitted.datum[id])
        expect(
          share,
          `${id} draws its arc at a fitted viewport`,
        ).toBeGreaterThan(0.002);
    expect(fitted.datum["ram-gauge"], "ram reports on every host").toBe(true);
    expect(
      fitted.barInk,
      "the storage bar has fill at a fitted viewport",
    ).toBeGreaterThan(0.01);
    expect(
      fitted.barChroma,
      "the storage bar's fill is coloured, not a grey track",
    ).toBeGreaterThan(0.005);
    expect(
      fitted.wordmark.covered / fitted.wordmark.area,
      "the wordmark draws glyphs at a fitted viewport",
    ).toBeGreaterThan(0.02);

    // **A second device pixel ratio**, through the browser's own emulation, and
    // a different viewport so the fit is re-derived rather than remembered.
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setDeviceMetricsOverride", {
      width: 1180,
      height: 820,
      deviceScaleFactor: 2,
      mobile: false,
    });
    const retina = await readTheDisplay("1180x820 @2x");
    expectContainFit(
      retina.surface,
      (await page.locator("#artboard").boundingBox())!,
    );
    expect(
      retina.surface.dpr,
      "the browser really is at two device pixels",
    ).toBe(2);
    // The backing store followed the ratio, which is what makes the render at
    // this DPR a different picture and not the same one labelled differently.
    expect(
      retina.surface.backingWidth / retina.surface.cssWidth,
      "the artboard canvas is allocated at two device pixels per CSS pixel",
    ).toBeCloseTo(2, 1);
    for (const [id, share] of Object.entries(retina.arcs))
      if (retina.datum[id])
        expect(
          share,
          `${id} draws its arc at two device pixels`,
        ).toBeGreaterThan(0.002);
    expect(
      retina.barInk,
      "the storage bar has fill at two device pixels",
    ).toBeGreaterThan(0.01);
    expect(
      retina.barChroma,
      "the bar's fill stays coloured at two device pixels",
    ).toBeGreaterThan(0.005);
    expect(
      retina.wordmark.covered / retina.wordmark.area,
      "the wordmark draws glyphs at two device pixels",
    ).toBeGreaterThan(0.02);
    await session.send("Emulation.clearDeviceMetricsOverride");
  });

  test("composites glass under a group, a rotation and an intersection on the real player", async ({
    page,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "the grouped composition is a desktop read",
    );

    await page.setViewportSize({ width: 1280, height: 960 });
    await page.goto(`${HOST}/?theme=${HOST_GROUPED_THEME_ID}`);
    await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();
    await expect(page.locator("[data-yunari-load-failure]")).toHaveCount(0);

    // **The composition is the one the fixture claims.** A panel that revived
    // somewhere else would still produce a plausible band, so the shapes are
    // read back before any pixel is counted.
    const shape = await page.evaluate(
      ([groupId]) => {
        type Obj = {
          get(n: string): unknown;
          getObjects?(): Obj[];
          getBoundingRect(): {
            left: number;
            top: number;
            width: number;
            height: number;
          };
          objectCaching: boolean;
          angle: number;
        };
        const canvas = (
          window as unknown as {
            yunari?: { handle: { canvas: { getObjects(): Obj[] } } };
          }
        ).yunari?.handle.canvas;
        const found: Record<
          string,
          { left: number; right: number; top: number; angle: number }
        > = {};
        const walk = (objects: Obj[] | undefined): void => {
          for (const object of objects ?? []) {
            const id = object.get("id");
            if (typeof id === "string") {
              const box = object.getBoundingRect();
              found[id] = {
                left: Math.round(box.left),
                right: Math.round(box.left + box.width),
                top: Math.round(box.top),
                angle: Number(object.angle ?? 0),
              };
            }
            walk(object.getObjects?.());
          }
        };
        walk(canvas?.getObjects());
        const group = canvas
          ?.getObjects()
          .find((object) => object.get("id") === groupId);
        return {
          found,
          groupAngle: Number(group?.angle ?? 0),
          groupCaching: group?.objectCaching ?? null,
        };
      },
      [GROUPED_GROUP_ID] as const,
    );

    // The rotation is on the group, so the treated child's own angle is 0 and
    // the turn comes from its ancestry — which is the case the glass handle's
    // ancestor walk exists for.
    expect(shape.groupAngle, "the fixture's group is turned").toBe(
      GROUPED_GROUP_ANGLE,
    );
    expect(
      shape.found[GROUPED_PANEL_IDS.grouped]?.angle,
      "the turn is the group's, not the child's",
    ).toBe(0);
    // An upright 200x140 child is 200x140; turned 20° with its group its
    // bounding box is 236x200. If the group had not taken, the rotation this
    // test claims to cover would quietly be a flat panel.
    expect(
      (shape.found[GROUPED_PANEL_IDS.grouped]?.right ?? 0) -
        (shape.found[GROUPED_PANEL_IDS.grouped]?.left ?? 0),
      "the grouped panel is really turned on the display",
    ).toBeGreaterThan(220);
    // Fabric 7 leaves a group's caching off, so the guard in `glass.ts` is a
    // backstop rather than the normal path. Recorded, not required.
    expect(shape.groupCaching, "the mounted group does not cache").toBe(false);

    const under = shape.found[GROUPED_PANEL_IDS.overlapUnder];
    const over = shape.found[GROUPED_PANEL_IDS.overlapOver];
    expect(
      over?.left ?? 0,
      "the two panels intersect rather than merely sitting near each other",
    ).toBeLessThan(under?.right ?? 0);

    /** A panel whose blur is real, and the same panel with the blur off. */
    for (const id of [
      GROUPED_PANEL_IDS.grouped,
      GROUPED_PANEL_IDS.flat,
      GROUPED_PANEL_IDS.overlapUnder,
      GROUPED_PANEL_IDS.overlapOver,
    ]) {
      const blurred = await panelBand(page, id);
      const control = await panelBand(page, id, 0);
      // Back to the authored radius, so the next panel is not measured through
      // the previous one's control.
      await panelBand(page, id, 16);
      expect(blurred.height, `${id} is big enough to measure`).toBeGreaterThan(
        8,
      );
      // The backdrop reaches the panel at all: a flat wash would have neither
      // detail nor a step to soften.
      expect(
        control.contrast,
        `${id} has backdrop detail behind it`,
      ).toBeGreaterThan(8);
      expect(
        control.peak,
        `${id}'s unblurred backdrop is a real edge`,
      ).toBeGreaterThan(40);
      expect(
        blurred.peak,
        `${id} softens the backdrop it samples`,
      ).toBeLessThan(control.peak * 0.5);
      // And the detail survives the blur, so this is not a flat tint either.
      expect(
        blurred.contrast,
        `${id} still carries the backdrop after blurring`,
      ).toBeGreaterThan(8);
    }

    // **The panel behind the intersection is still compositing**, not covered.
    const behind = await panelBand(page, GROUPED_PANEL_IDS.overlapUnder);
    expect(
      behind.peak,
      "the panel under the intersection still composites",
    ).toBeLessThan(40);

    // **The ancestor-group guard, forced.** Fabric 7 leaves a group's
    // `objectCaching` false, so the guard is a backstop rather than the normal
    // path; turning caching on is what reaches it, and the panel must then
    // report and leave its backdrop alone rather than sample its own cache.
    // The player reports a skipped panel to the console, not to the DOM.
    const warnings: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "warning") warnings.push(message.text());
    });
    expect(
      await setGroupCaching(page, true),
      "the control really did turn the group's caching on",
    ).toBe(true);
    const cached = await panelBand(page, GROUPED_PANEL_IDS.grouped);
    expect(
      cached.peak,
      "a cached ancestor stops the panel from sampling its own cache",
    ).toBeGreaterThan(40);
    await expect
      .poll(
        () => warnings.some((text) => text.includes("caches its children")),
        { timeout: 5_000 },
      )
      .toBe(true);

    // Back to the authored state, and the real claim re-measured last so the
    // test ends on the product's behaviour rather than on its control.
    await setGroupCaching(page, false);
    const restored = await panelBand(page, GROUPED_PANEL_IDS.grouped);
    expect(
      restored.peak,
      "the grouped panel composites once its group caches again",
    ).toBeLessThan(40);
  });
});

/** The fixture's group's own caching, read back after the repaint that used it. */
function setGroupCaching(page: Page, caching: boolean): Promise<boolean> {
  return page.evaluate(
    ([groupId, on]) => {
      type Obj = { get(n: string): unknown; objectCaching: boolean };
      const canvas = (
        window as unknown as {
          yunari?: {
            handle: {
              canvas: {
                getObjects(): Obj[];
                lowerCanvasEl: HTMLCanvasElement;
                renderAll(): void;
              };
            };
          };
        }
      ).yunari?.handle.canvas;
      const group = canvas
        ?.getObjects()
        .find((object) => object.get("id") === groupId);
      if (group === undefined) throw new Error("the fixture lost its group");
      group.objectCaching = on as boolean;
      canvas!.renderAll();
      return group.objectCaching;
    },
    [GROUPED_GROUP_ID, caching] as const,
  );
}

/**
 * The three controls a reader operates on a display: fullscreen, keep-awake and
 * a dimmer (`vg-568`, `vg-576`).
 *
 * **The origin is the point, and every case here names the one it ran
 * against.** A display at `http://<lan-ip>:<port>` is not a secure context,
 * and both APIs the controls want are gated on one — but `localhost` IS one, so
 * a run at `http://127.0.0.1:4175` sees the wake lock present and proves
 * nothing about the phone the control is for. The host does serve https beside
 * http on that same port now, from a root it issues itself (`vg-580`,
 * `docs/decisions/0070`), and since `docs/decisions/0076` https is the address
 * printed first — so the cases here run at the plain origin deliberately: that
 * is the fallback a device without the root certificate still gets, and the
 * last case reads this browser's answer about exactly that origin.
 */
test.describe("the display's own controls", () => {
  test("reveals three controls on a tap, and never moves the composition", async ({
    page,
  }, testInfo) => {
    await openSeededDisplay(page);
    const canvas = page.locator("#artboard canvas.lower-canvas");
    await expect(canvas).toBeVisible();

    await recordCapabilities(page, testInfo);

    const bar = page.locator("[data-yunari-controls]");
    await expect(bar).toHaveCount(1);
    await expect(page.locator("[data-yunari-dimmer]")).toHaveCount(1);
    expect(await barOpacity(page)).toBe("0");

    // **The column holds the two declared bands and the artboard, and nothing
    // else.** Absolute, not a comparison against an earlier reading of the same
    // page: a control that is in flow for the whole load shrinks the artboard at
    // *every* reading, and three equal readings are exactly what a broken build
    // produces. Measured from the document's own structure, so a control that is
    // in flow fails here whether it arrived at mount or at reveal.
    const before = await column(page);
    expect(before.otherColumns).toEqual([]);
    expect(
      Math.abs(before.artboardHeight - (before.bodyHeight - before.bandHeight)),
      "the artboard fills what the two bands leave",
    ).toBeLessThan(1);

    await tapTheDisplay(page);
    await expect.poll(() => barOpacity(page)).toBe("1");

    // **Up, and the composition has not moved.** A strip in a chrome band takes
    // its room from the artboard and re-fits the scene, which measured 16-25px
    // of ink movement on the built display (vg-028).
    const up = await column(page);
    expect(up.otherColumns).toEqual([]);
    expect(
      Math.abs(up.artboardHeight - (up.bodyHeight - up.bandHeight)),
      "the artboard still fills what the two bands leave",
    ).toBeLessThan(1);
    expect(up.artboardHeight).toBeCloseTo(before.artboardHeight, 1);

    // Three seconds, and it is gone again — with the composition still exactly
    // where it was.
    await expect.poll(() => barOpacity(page), { timeout: 6_000 }).toBe("0");
    const gone = await column(page);
    expect(gone.otherColumns).toEqual([]);
    expect(
      Math.abs(gone.artboardHeight - (gone.bodyHeight - gone.bandHeight)),
      "the artboard still fills what the two bands leave",
    ).toBeLessThan(1);
    expect(gone.artboardHeight).toBeCloseTo(before.artboardHeight, 1);
  });

  test("enters and leaves fullscreen on one control, where the client has it", async ({
    page,
  }, testInfo) => {
    await openSeededDisplay(page);
    await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();

    const supported = await page.evaluate(
      () => typeof document.documentElement.requestFullscreen === "function",
    );
    testInfo.annotations.push({
      type: "fullscreen",
      description: String(supported),
    });

    const button = page.locator("[data-yunari-fullscreen]");
    await expect(button).toHaveCount(1);
    await tapTheDisplay(page);

    if (!supported) {
      // The refusal, on the client that has none: the sentence names the path
      // this client does have rather than leaving a control that does nothing.
      await button.click();
      await expect(page.locator("[data-yunari-controls-say]")).toHaveText(
        uiCopy.controls.fullscreen.unavailable,
      );
      return;
    }

    await button.click();
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement !== null))
      .toBe(true);
    await expect(button).toHaveAttribute("aria-pressed", "true");

    await button.click();
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement !== null))
      .toBe(false);
    await expect(button).toHaveAttribute("aria-pressed", "false");
  });

  test("re-acquires the wake lock across a hide and a show, and reports the lock it holds", async ({
    page,
  }, testInfo) => {
    // Counted and captured in the page, because the control's claim is about
    // the lock it *holds*: the number of requests it made is the re-acquisition,
    // and the sentinel is what a release has to be fired on.
    await page.addInitScript(() => {
      const state = {
        requests: 0,
        sentinel: null as unknown,
        failed: null as string | null,
      };
      Reflect.set(window, "__yunariWake", state);
      const api = (
        navigator as unknown as {
          wakeLock?: { request(type: string): Promise<unknown> };
        }
      ).wakeLock;
      if (api === undefined) return;
      const request = api.request.bind(api);
      api.request = async (type: string) => {
        state.requests += 1;
        try {
          const sentinel = await request(type);
          state.sentinel = sentinel;
          return sentinel;
        } catch (error) {
          // Recorded rather than swallowed: whether this client grants a lock
          // at all is the answer this case reports, and a silent catch would
          // read as a timeout.
          state.failed = error instanceof Error ? error.name : String(error);
          throw error;
        }
      };
    });

    await openSeededDisplay(page);
    await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();
    await recordCapabilities(page, testInfo);
    await tapTheDisplay(page);

    const keepAwake = page.locator("[data-yunari-keep-awake]");
    await expect(keepAwake).toHaveCount(1);
    await keepAwake.click();

    // The request is settled, one way or the other, before the control's claim
    // is read: a sentinel captured mid-flight would read as a refusal.
    await expect.poll(() => wakeSettled(page), { timeout: 10_000 }).toBe(true);

    if (!(await wakeLockHeld(page))) {
      // **This client refused the lock**, which is a real answer and not a
      // failure: the control must then report that it holds nothing rather than
      // claiming the lock it asked for.
      testInfo.annotations.push({
        type: "wake-lock",
        description: `refused by this client (${await wakeFailure(page)})`,
      });
      // The lock is not held, so the control must not say it is — and the
      // reader must be told why rather than left with an unlabelled amber.
      await expect(keepAwake).toHaveAttribute("aria-pressed", "false");
      await expect(keepAwake).toHaveAttribute("data-yunari-waiting", "");
      await expect(page.locator("[data-yunari-controls-say]")).toHaveText(
        uiCopy.controls.keepAwake.refused,
      );
      return;
    }

    await expect(keepAwake).toHaveAttribute("aria-pressed", "true");
    await expect(keepAwake).not.toHaveAttribute("data-yunari-waiting", "");

    // **The API drops the lock whenever the page is hidden, and this is that
    // release.** Nothing about the control may survive it but the reader's own
    // intent.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      (
        window as unknown as { __yunariWake: { sentinel: EventTarget } }
      ).__yunariWake.sentinel.dispatchEvent(new Event("release"));
    });
    await expect(keepAwake).toHaveAttribute("aria-pressed", "false");
    await expect(keepAwake).toHaveAttribute("data-yunari-waiting", "");
    expect(await wakeRequests(page)).toBe(1);

    // Back on screen and still wanted: the re-acquisition is the whole control.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => wakeRequests(page), { timeout: 10_000 }).toBe(2);
    await expect(keepAwake).toHaveAttribute("aria-pressed", "true");
    await expect(keepAwake).not.toHaveAttribute("data-yunari-waiting", "");
  });

  test("says why, on a client with neither API, and does not pretend otherwise", async ({
    page,
  }, testInfo) => {
    // iPhone Safari's shape, forced: no `Element.requestFullscreen`, and no
    // wake lock because the origin is not secure. The init script is what makes
    // the refusal reachable on a client that has both.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "wakeLock", {
        configurable: true,
        value: undefined,
      });
      Reflect.deleteProperty(Element.prototype, "requestFullscreen");
    });

    await openSeededDisplay(page);
    await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();

    // The forcing really took, so a green case here is not a no-op.
    expect(
      await page.evaluate(() => [
        typeof (navigator as unknown as { wakeLock?: unknown }).wakeLock,
        typeof document.documentElement.requestFullscreen,
      ]),
    ).toEqual(["undefined", "undefined"]);
    testInfo.annotations.push({
      type: "capabilities-forced",
      description: "wakeLock and requestFullscreen removed",
    });

    await tapTheDisplay(page);
    await page.locator("[data-yunari-fullscreen]").click();
    await expect(page.locator("[data-yunari-controls-say]")).toHaveText(
      uiCopy.controls.fullscreen.unavailable,
    );

    await page.locator("[data-yunari-keep-awake]").click();
    await expect(page.locator("[data-yunari-controls-say]")).toHaveText(
      uiCopy.controls.keepAwake.unavailable,
    );
  });

  test("dims the picture with an overlay, and the composition stays where it was", async ({
    page,
  }) => {
    await openSeededDisplay(page);
    const canvas = page.locator("#artboard canvas.lower-canvas");
    await expect(canvas).toBeVisible();
    await tapTheDisplay(page);

    const shade = page.locator("[data-yunari-dimmer]");
    await expect(shade).toHaveCount(1);
    expect(await shadeOpacity(page)).toBe("0");

    const before = await column(page);
    await page.locator("[data-yunari-dim]").fill("50");

    await expect
      .poll(async () => Number(await shadeOpacity(page)))
      .toBeGreaterThan(0.4);
    // Dimmed, and unmoved: the overlay is a filter over the picture rather than
    // a resize of it. Asserted the absolute way for the reason `column` gives —
    // a self-comparison is green on a build that was already the wrong size.
    const dimmed = await column(page);
    expect(dimmed.otherColumns).toEqual([]);
    expect(
      Math.abs(dimmed.artboardHeight - (dimmed.bodyHeight - dimmed.bandHeight)),
      "the artboard still fills what the two bands leave",
    ).toBeLessThan(1);
    expect(dimmed.artboardHeight).toBeCloseTo(before.artboardHeight, 1);
  });

  test("the plain-http fallback a phone can open is not a secure context, and this browser says so", async ({
    page,
  }, testInfo) => {
    // **The trap this case exists for.** `127.0.0.1` is a secure context, so
    // every reading above it shows the wake lock present; the plain address the
    // host prints is a LAN one, and it is not a secure context. The player's own
    // bundle is served here over plain http on the LAN address, so the reading is
    // the browser's answer about the origin rather than a claim about it.
    //
    // **Which shape that is, since `docs/decisions/0076`.** The printed address
    // is https and the plain one beside it is the *fallback*, for a device that
    // has not installed the host's root certificate — so what this case reads is
    // the fallback's answer, and it is still worth reading: the fallback is what
    // a fresh phone gets before it installs anything, and the gating below is
    // why the https address is the one printed first. It is not a case about the
    // product's default origin any more, and a reading of *that* origin needs
    // the root trusted in the browser profile, which this file does not do.
    const address = lanAddress();
    test.skip(address === undefined, "this machine has no LAN address");

    const bundle = await servePlayerBundle(address as string);
    try {
      await page.goto(`${bundle.origin}/`);
      const reported = await page.evaluate(() => ({
        origin: location.origin,
        secureContext: window.isSecureContext,
        wakeLock: typeof (navigator as unknown as { wakeLock?: unknown })
          .wakeLock,
        fullscreen:
          typeof document.documentElement.requestFullscreen === "function",
      }));
      testInfo.annotations.push({
        type: "lan-origin",
        description: JSON.stringify(reported),
      });

      expect(
        reported.secureContext,
        "a LAN address is not a secure context",
      ).toBe(false);
      expect(reported.wakeLock).toBe("undefined");
    } finally {
      await bundle.close();
    }
  });
});

/**
 * The per-display themes this plan added, on a host of this file's own.
 *
 * **Why this file starts a host at all.** Three of the boundary's claims are
 * about a *paired* display, and the shared host cannot serve one: `displayKeyFor`
 * answers a loopback request as `this-pc` whatever credential it carries, and
 * the host on 4175 is bound to loopback — so the only displays it resolves are
 * this PC and a local monitor. The chooser is the case that makes this
 * unavoidable (a session-less reader is offered no control at all, and a
 * loopback write names no display and is refused), so the display has to arrive
 * from a non-loopback origin. `host-pwa.spec.ts` and `host-secure-origin.spec.ts`
 * start their own `--host 0.0.0.0` host for the same reason; this is that
 * arrangement on this file's own port and app folder.
 *
 * **The `0.0.0.0` binding is load-bearing twice.** A paired display is only a
 * display at a non-loopback address, and the re-find case needs a second origin
 * at the *same port* — `originFor(address, pairing.port, scheme)` — so it moves to
 * `127.0.0.2`, which a host bound to `127.0.0.1` does not answer at all.
 */
const THEMED_HOST_PORTS: Readonly<Record<string, number>> = {
  "desktop-host": 4241,
  "phone-host": 4243,
};

test.describe("a paired display and the theme it is given", () => {
  let host: ChildProcess | undefined;
  /** Where a display reaches the host: the LAN address, plain http. */
  let origin = "";
  /** The host's loopback origin, which is the admin path every write here uses. */
  let admin = "";
  /** The second address the re-find moves to — same port, different address. */
  let secondAddress = "";
  let port = 0;
  let hostId = "";
  let hostName = "";
  /** Every display `pairDisplay` minted in the running case. */
  const pairedInThisTest: string[] = [];

  test.afterEach(async ({ request }) => {
    for (const id of pairedInThisTest.splice(0)) {
      // A case may already have removed it; a second delete is a no-op.
      await request.delete(`${admin}/api/displays/${id}`);
    }
  });

  test.beforeAll(async ({}, testInfo) => {
    const address = lanAddress();

    // No LAN address on this machine: every case here skips rather than
    // reporting a loopback run as a paired display's.
    if (address === undefined) return;

    port = THEMED_HOST_PORTS[testInfo.project.name] ?? 4241;
    origin = `http://${address}:${port}`;
    admin = `http://127.0.0.1:${port}`;
    secondAddress = `http://127.0.0.2:${port}`;

    // Its own app folder, outside the repository tree: two projects run this
    // file, and the host lock refuses a second host against a held folder.
    const appDir = join(
      tmpdir(),
      `yunari-e2e-displays-${testInfo.project.name}`,
    );
    rmSync(appDir, { recursive: true, force: true });
    mkdirSync(appDir, { recursive: true });
    // The same library the shared host serves, copied rather than rebuilt: the
    // themes are `global-setup.ts`'s fixture and this host only has to serve it.
    cpSync(HOST_THEMES_DIR, join(appDir, "themes"), { recursive: true });

    host = spawn(
      "node",
      [
        "packages/host/bin/yunari.js",
        "--no-browser",
        "--port",
        String(port),
        // `0.0.0.0` is the point: a host bound to loopback has no LAN origin to
        // read and no second address to be found at, and a case that ran anyway
        // would be reading the trap.
        "--host",
        "0.0.0.0",
        "--app-dir",
        appDir,
      ],
      { cwd: process.cwd(), stdio: "ignore" },
    );

    const probe = await hostClient(admin);
    let ready = false;

    for (let attempt = 0; attempt < 120 && !ready; attempt += 1) {
      try {
        ready = (await probe.get("/api/health")).ok();
      } catch {
        // Not up yet.
      }
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 250));
    }

    if (!ready) {
      await probe.dispose();
      host.kill();
      host = undefined;
      return;
    }

    // The identity a display stores, and the one a re-find matches on.
    const identity = (await (await probe.get("/api/host")).json()) as {
      readonly id: string;
      readonly name: string;
    };
    hostId = identity.id;
    hostName = identity.name;
    await probe.dispose();
  });

  test.afterAll(() => {
    host?.kill();
    host = undefined;
  });

  /**
   * A display paired the way the host pairs one — through the route, so its
   * record and its credential are the store's own rather than a hand-written
   * file this spec would have to keep in step with `hashToken`.
   */
  async function pairDisplay(
    request: APIRequestContext,
    label: string,
    presentation?: {
      readonly shape: "rect" | "circle";
      readonly rotation?: number;
    },
  ): Promise<{ readonly id: string; readonly token: string }> {
    const response = await request.post(
      `${admin}/api/pairing/sessions?label=${encodeURIComponent(label)}`,
    );
    const body = (await response.json()) as {
      readonly display: { readonly id: string };
      readonly token: string;
    };

    // The mint route creates with the default presentation, so the shape and
    // angle go through the route a person's edit uses rather than through a
    // hand-written record this spec would have to keep in step with the store.
    if (presentation !== undefined) {
      const patch = await request.patch(
        `${admin}/api/displays/${body.display.id}`,
        {
          data: {
            shape: presentation.shape,
            ...(presentation.rotation === undefined
              ? {}
              : { rotation: presentation.rotation }),
          },
        },
      );
      expect(patch.ok(), patch.ok() ? "" : await patch.text()).toBe(true);
    }

    pairedInThisTest.push(body.display.id);
    return { id: body.display.id, token: body.token };
  }

  /** The theme a display shows at a link, with its own credential: the page a
   *  person opens for one display, which is the one route presentation facts
   *  reach a player through. */
  function playerUrl(
    display: { readonly token: string },
    options: { readonly theme?: string } = {},
  ): string {
    const url = new URL("/", origin);
    if (options.theme !== undefined) {
      url.searchParams.set("theme", options.theme);
    }
    url.searchParams.set("session", display.token);
    return url.toString();
  }

  /** The record the host holds for a display, read off its own route. A zero
   *  angle is omitted from the stored record, so a reader must supply the
   *  default rather than read an absence as a missing row. */
  async function displayRecord(request: APIRequestContext, id: string) {
    const listed = (await (
      await request.get(`${admin}/api/pairing/sessions`)
    ).json()) as {
      readonly displays: readonly {
        readonly id: string;
        readonly shape: string;
        readonly rotation?: number;
      }[];
    };

    return listed.displays.find((row) => row.id === id);
  }

  /** The record the host holds for a display, read off its own route. */
  function activeDisplay(request: APIRequestContext, id: string) {
    return expect.poll(() => displayRecord(request, id));
  }

  /** The artboard's own matrix, the host box it is drawn into, and the angle
   *  the handle reports — one sample, so an assertion cannot compare two
   *  moments of a live re-fit. */
  function readPresentation(page: Page): Promise<{
    readonly matrix: readonly [number, number, number, number, number, number];
    readonly rotation: number;
    readonly host: {
      readonly left: number;
      readonly top: number;
      readonly width: number;
      readonly height: number;
    };
    readonly viewport: { readonly width: number; readonly height: number };
  }> {
    return page.evaluate(() => {
      const handle = (
        window as unknown as {
          yunari: {
            handle: {
              transform(): {
                matrix: readonly [
                  number,
                  number,
                  number,
                  number,
                  number,
                  number,
                ];
                rotation: number;
              };
            };
          };
        }
      ).yunari.handle;
      const transform = handle.transform();
      const box = document
        .querySelector<HTMLElement>("#artboard")!
        .getBoundingClientRect();
      return {
        matrix: transform.matrix,
        rotation: transform.rotation,
        host: {
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
        },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    });
  }

  /** An authored point in viewport pixels: the same map the canvas viewport
   *  transform applies, with the host's own page offset added. */
  function clientPoint(
    reading: {
      readonly matrix: readonly [
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      readonly host: { readonly left: number; readonly top: number };
    },
    x: number,
    y: number,
  ): { readonly x: number; readonly y: number } {
    const [a, b, c, d, e, f] = reading.matrix;
    return {
      x: reading.host.left + a * x + c * y + e,
      y: reading.host.top + b * x + d * y + f,
    };
  }

  /** The presentation reaches the player through the host's poll, so the first
   *  frame after `goto` is still the display's previous one. */
  async function waitForRotation(page: Page, degrees: number): Promise<void> {
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const handle = (
              window as unknown as {
                yunari?: {
                  handle: { transform(): { rotation: number } };
                };
              }
            ).yunari?.handle;
            return handle?.transform().rotation;
          }),
        { timeout: 20_000 },
      )
      .toBe(degrees);
  }

  /** A circle presentation is what creates the disc element, so its presence is
   *  the answer that the shape and not only the angle arrived. */
  async function waitForDisc(page: Page): Promise<void> {
    await expect
      .poll(() => page.locator("[data-yunari-display-disc]").count(), {
        timeout: 20_000,
      })
      .toBe(1);
  }

  /** The layer mounts before its source decodes, and its placement is written
   *  when the bytes arrive. Waiting on the decode and the placed geometry is the
   *  event, not a duration. */
  async function settleBackgroundMedia(page: Page): Promise<void> {
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const image = document.querySelector<HTMLImageElement>(
              "[data-yunari-background-media] img",
            );
            if (image === null || !image.complete || image.naturalWidth === 0) {
              return false;
            }
            // `decode()` settles when the bytes can be painted; a placement
            // read before it is the load-window rect.
            await image.decode().catch(() => undefined);
            const layer = image.closest<HTMLElement>(
              "[data-yunari-background-media]",
            );
            return (
              layer !== null &&
              layer.offsetWidth > 0 &&
              image.offsetWidth > 0 &&
              image.style.width !== ""
            );
          }),
        { timeout: 20_000 },
      )
      .toBe(true);
  }

  /** One screenshot, then one pixel per viewport point. The bitmap is denser
   *  than the page on a phone, so the conversion is the bitmap's own width over
   *  the window's, never a device-pixel-ratio constant. */
  async function sampleScreenPixels(
    page: Page,
    points: readonly { readonly x: number; readonly y: number }[],
  ): Promise<
    readonly { readonly r: number; readonly g: number; readonly b: number }[]
  > {
    const screenshot = await page.screenshot();
    return page.evaluate(
      async ([data, targets]) => {
        const bytes = Uint8Array.from(atob(data!), (char) =>
          char.charCodeAt(0),
        );
        const bitmap = await createImageBitmap(new Blob([bytes]));
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        if (context === null)
          throw new Error("no 2d context for the screenshot");
        context.drawImage(bitmap, 0, 0);
        const scaleX = bitmap.width / window.innerWidth;
        const scaleY = bitmap.height / window.innerHeight;
        return targets.map((point) => {
          const pixel = context.getImageData(
            Math.round(point.x * scaleX),
            Math.round(point.y * scaleY),
            1,
            1,
          ).data;
          return { r: pixel[0]!, g: pixel[1]!, b: pixel[2]! };
        });
      },
      [screenshot.toString("base64"), points] as const,
    );
  }

  /** A glass panel's fill, `rgba(0, 0, 0, 0.35)`: the sampled colour with that
   *  much black over it. The media is flat under each panel, so no blur mixes
   *  anything and the composite is exact up to the canvas's own rounding. */
  const PANEL_ALPHA = 0.35;
  const TINT = {
    red: tint({ r: 255, g: 0, b: 0 }),
    blue: tint({ r: 0, g: 0, b: 255 }),
    bar: tint({ r: 16, g: 19, b: 24 }),
    black: { r: 0, g: 0, b: 0 },
  } as const;

  function tint(colour: {
    readonly r: number;
    readonly g: number;
    readonly b: number;
  }) {
    const mix = (channel: number): number =>
      Math.round(channel * (1 - PANEL_ALPHA));
    return { r: mix(colour.r), g: mix(colour.g), b: mix(colour.b) };
  }

  /** The largest per-channel difference between two sampled colours. */
  function colourDistance(
    a: { readonly r: number; readonly g: number; readonly b: number },
    b: { readonly r: number; readonly g: number; readonly b: number },
  ): number {
    return Math.max(
      Math.abs(a.r - b.r),
      Math.abs(a.g - b.g),
      Math.abs(a.b - b.b),
    );
  }

  /** The glass frame is one animation frame behind the media's decode, so the
   *  panel's tint is polled rather than awaited for a fixed time. */
  async function expectPanelTint(
    page: Page,
    point: { readonly x: number; readonly y: number },
    expected: { readonly r: number; readonly g: number; readonly b: number },
    label: string,
  ): Promise<void> {
    await expect
      .poll(
        async () => {
          const [pixel] = await sampleScreenPixels(page, [point]);
          return colourDistance(pixel!, expected);
        },
        { timeout: 20_000, message: label },
      )
      .toBeLessThan(25);
  }

  /** The media layer's four corners as the browser paints them: its layout box
   *  and its computed transform, never `handle.transform()`. A plate whose
   *  rotation was dropped renders upright even when the camera's matrix says
   *  otherwise, and its corners leave the disc — which is the reading this
   *  exposes. */
  function renderedPlate(page: Page): Promise<{
    readonly transform: string;
    readonly angle: number;
    readonly corners: readonly { readonly x: number; readonly y: number }[];
  }> {
    return page.evaluate(() => {
      const host = document
        .querySelector<HTMLElement>("#artboard")!
        .getBoundingClientRect();
      const layer = document.querySelector<HTMLElement>(
        "[data-yunari-background-media]",
      );
      if (layer === null) throw new Error("no background media layer");
      const style = getComputedStyle(layer);
      const matrix =
        style.transform === "none"
          ? new DOMMatrixReadOnly()
          : new DOMMatrixReadOnly(style.transform);
      const left = Number.parseFloat(layer.style.left || "0");
      const top = Number.parseFloat(layer.style.top || "0");
      const width = layer.offsetWidth;
      const height = layer.offsetHeight;
      const local = [
        [0, 0],
        [width, 0],
        [width, height],
        [0, height],
      ] as const;
      return {
        transform: style.transform,
        angle: (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI,
        corners: local.map(([x, y]) => ({
          x: host.left + left + matrix.a * x + matrix.c * y,
          y: host.top + top + matrix.b * x + matrix.d * y,
        })),
      };
    });
  }

  /** A rendered box, off the DOM: the disc or any other painted plate. */
  function renderedBox(
    page: Page,
    selector: string,
  ): Promise<{
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  }> {
    return page.locator(selector).evaluate((node) => {
      const box = node.getBoundingClientRect();
      return {
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
      };
    });
  }

  /** `/editor/` in the Host mode: the surface the display controls live on. */
  async function openHostSettings(page: Page): Promise<void> {
    await page.goto(`${admin}/editor/`);
    const modeSwitch = page.locator(".editor-shell-mode-switch");
    await expect(modeSwitch).toBeVisible({ timeout: 30_000 });
    await modeSwitch
      .getByRole("button", { name: editorCopy.modes.thisPc, exact: true })
      .click();
    await expect(page.locator("[data-yunari-mode-region]")).toHaveAttribute(
      "data-yunari-mode-region",
      "this-pc",
    );
  }

  /** The assignment, from this PC: the loopback admin path, which names a display. */
  async function assign(
    request: APIRequestContext,
    display: string,
    theme: string,
  ): Promise<void> {
    const response = await request.put(`${admin}/api/themes/active`, {
      data: { display, id: theme },
    });

    expect(response.ok(), response.ok() ? "" : await response.text()).toBe(
      true,
    );
  }

  /** The ids of the composition's own root objects, off the mounted canvas. */
  function rootNodeIds(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const canvas = (
        window as unknown as {
          yunari?: {
            handle: {
              canvas: {
                getObjects(): readonly { get(key: string): unknown }[];
              };
            };
          };
        }
      ).yunari?.handle.canvas;

      return (canvas?.getObjects() ?? []).map((object) =>
        String(object.get("id")),
      );
    });
  }

  /** Whatever a pairing case left behind, removed by the id the record carries. */
  async function removePaired(
    request: APIRequestContext,
    label: string,
  ): Promise<void> {
    const listed = (await (
      await request.get(`${admin}/api/pairing/sessions`)
    ).json()) as {
      readonly displays: readonly {
        readonly id: string;
        readonly label: string;
      }[];
    };

    for (const row of listed.displays) {
      if (row.label === label) {
        await request.delete(`${admin}/api/displays/${row.id}`);
      }
    }
  }

  /** The code this host is showing, read over the admin path. */
  async function pairingCode(request: APIRequestContext): Promise<string> {
    return (
      (await (await request.get(`${admin}/api/pairing/code`)).json()) as {
        readonly code: string;
      }
    ).code;
  }

  /** The record a pairing case stored, off the route rather than the page. */
  function storedDisplay(request: APIRequestContext, label: string) {
    return expect.poll(async () => {
      const listed = (await (
        await request.get(`${admin}/api/pairing/sessions`)
      ).json()) as { readonly displays: readonly { label: string }[] };

      return listed.displays.find((row) => row.label === label);
    });
  }

  test("pairs a display as a circle at 45 degrees", async ({
    page,
    request,
  }) => {
    test.skip(origin === "", "this machine has no LAN address");

    const code = await pairingCode(request);

    try {
      // The page a device with no credential opens, at the address a display
      // reaches the host on — the claim is the one route it may call.
      await page.goto(`${origin}/pair`);
      await page.fill("#code", code);
      await page.fill("#name", "Round panel");
      await page.selectOption("#shape", "circle");
      await page.fill("#rotation", "45");
      await page.click('button[type="submit"]');

      // The claim is answered asynchronously, so the record is read back from
      // the host's own route rather than from the page's report of itself.
      await storedDisplay(request, "Round panel").toMatchObject({
        shape: "circle",
        rotation: 45,
      });
    } finally {
      await removePaired(request, "Round panel");
    }
  });

  test("snaps a free angle to a quarter turn when pairing a rectangle", async ({
    page,
    request,
  }) => {
    test.skip(origin === "", "this machine has no LAN address");

    const code = await pairingCode(request);

    try {
      await page.goto(`${origin}/pair`);
      await page.fill("#code", code);
      await page.fill("#name", "Square panel");
      await page.selectOption("#shape", "circle");
      await page.fill("#rotation", "45");

      // The destructive half, named on screen: the field moves to the quarter
      // the host will store, and the note keeps the angle that was typed.
      await page.selectOption("#shape", "rect");
      await expect(page.locator("#rotation")).toHaveValue("90");
      await expect(page.locator("#rotation-note")).toBeVisible();
      await expect(page.locator("#rotation-note")).toContainText("45");
      await expect(page.locator("#rotation-note")).toContainText("90");

      await page.click('button[type="submit"]');
      await storedDisplay(request, "Square panel").toMatchObject({
        shape: "rect",
        rotation: 90,
      });
    } finally {
      await removePaired(request, "Square panel");
    }
  });

  test("a reassignment lands on a display that is already showing", async ({
    page,
    request,
  }) => {
    test.skip(origin === "", "this machine has no LAN address");

    const display = await pairDisplay(request, "E2E reassignment");

    try {
      // Every committed navigation of this page, so "the display moved because
      // the host's answer changed" can be told from "the display re-serves
      // whatever it is on" — which is the whole of R50/R51 and the one thing a
      // URL or a node id cannot distinguish.
      const navigations: string[] = [];
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) navigations.push(frame.url());
      });

      // One theme, on a map page: the host resolved this id for this display.
      await assign(request, display.id, HOST_CHART_THEME_ID);
      await page.goto(`${origin}/?session=${display.token}`);
      await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();
      expect(new URL(page.url()).searchParams.get("theme-source")).toBe("map");
      expect(new URL(page.url()).searchParams.get("theme")).toBe(
        HOST_CHART_THEME_ID,
      );
      await expect.poll(() => rootNodeIds(page)).toContain(CHART_NODE_ID);

      // **The answer has not moved, so the display must not re-serve.** Three
      // poll intervals of silence is what a follower that reloads on every tick
      // cannot produce, and the count is cleared first so the load above — its
      // own navigation and the host's 302 — is not what is being read.
      navigations.length = 0;
      await page.waitForTimeout(6_500);
      expect(
        navigations,
        "the display re-served with the host's answer unchanged",
      ).toEqual([]);
      expect(new URL(page.url()).searchParams.get("theme")).toBe(
        HOST_CHART_THEME_ID,
      );

      // The host assigns another.
      await assign(request, display.id, HOST_THEME_ID);

      // The display shows it, with no manual navigation. **Asserted on the node
      // only the new theme has**, not only on the URL: a reload would re-serve
      // the id already in the URL and leave the old document in place, which a
      // URL comparison alone would not tell apart from the move.
      await expect
        .poll(() => new URL(page.url()).searchParams.get("theme"), {
          timeout: 20_000,
        })
        .toBe(HOST_THEME_ID);
      await expect
        .poll(() => rootNodeIds(page), { timeout: 20_000 })
        .toContain(CLOCK_NODE_ID);
      // ...and the move was a navigation, which is what makes the silence above
      // a reading rather than a follower that never moves at all.
      expect(
        navigations.length,
        "the assignment did not reach the display as a navigation",
      ).toBeGreaterThan(0);
    } finally {
      await request.delete(`${admin}/api/displays/${display.id}`);
    }
  });

  test("the chooser shows its choice on a map page and is absent on a link page", async ({
    page,
    request,
  }) => {
    test.skip(origin === "", "this machine has no LAN address");

    const display = await pairDisplay(request, "E2E chooser");

    try {
      await assign(request, display.id, HOST_CHART_THEME_ID);
      await page.goto(`${origin}/?session=${display.token}`);
      await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();

      const chooser = page.locator("[data-yunari-theme-chooser]");
      await expect(chooser).toBeVisible();
      await chooser
        .locator("select[data-yunari-theme-select]")
        .selectOption(HOST_THEME_ID);

      // The write is this display's own and the page lands on the chosen theme
      // through the same navigation an assignment takes.
      await expect
        .poll(() => new URL(page.url()).searchParams.get("theme"), {
          timeout: 20_000,
        })
        .toBe(HOST_THEME_ID);
      await expect
        .poll(() => rootNodeIds(page), { timeout: 20_000 })
        .toContain(CLOCK_NODE_ID);

      // The same control is absent on a link page — **carrying the same
      // credential**, so what is read is the source and not a missing session.
      // A token-less page would be absent for the other reason. The locator is
      // the one `toBeVisible` above matched a real chooser with, which is what
      // keeps this absence from being satisfied by a selector that matches
      // nothing anywhere.
      await page.goto(
        `${origin}/?theme=${HOST_CHART_THEME_ID}&session=${display.token}`,
      );
      await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();
      await expect(page.locator("[data-yunari-theme-chooser]")).toHaveCount(0);
    } finally {
      await request.delete(`${admin}/api/displays/${display.id}`);
    }
  });

  test("a re-find moves the display to the host's second address", async ({
    page,
    request,
  }) => {
    test.skip(origin === "", "this machine has no LAN address");

    // The address the display already knows, and the second one the host answers
    // at: **the same port**, which is what a re-find match is
    // (`originFor(address, pairing.port, scheme)`). Both are this machine,
    // because the host is bound to `0.0.0.0` and so answers across the loopback
    // block.
    //
    // **What this case is, and is not.** The display it loads is `this-pc`: a
    // loopback request resolves as this PC whatever credential it presents. The
    // cookie change removed the token from the URL and `/api/host` answers a
    // loopback caller no token, so a loopback page can no longer *learn* the
    // pairing a re-find needs. The stored record is therefore seeded — the
    // state a display already has after its first load through the LAN — and
    // the ladder matches and hops on it. What is proven is the ladder and the
    // hop; the credential-authorised path — a paired display resolving as its
    // own record — is not what runs here. The second address answering at all
    // rests on the source address of a connection to `127.0.0.2` being loopback
    // too, which is why the host serves it as `this-pc` and not as the display
    // the token names.
    const known = `http://127.0.0.1:${port}`;
    const elsewhereAddress = new URL(secondAddress).hostname;
    /**
     * The ladder's own probes, counted **inside the handler**: every `/api/host`
     * the route refused because the address it was asked at is not the one the
     * host answers on. Once the host has moved only the ladder asks there — the
     * display's poll goes to `/api/published`, which the route below refuses — so
     * the post-hop page's own `rememberPairing`, a request to the address it has
     * just landed on, can never be counted here. That is what makes this an
     * assertion about the route rather than about a URL that happened to compare
     * equal. **Both of the ladder's phases land in this count** — the last-known
     * address and the name, before the sweep (`host-refind.ts:203-209`) — because
     * what the assertion turns on is that the ladder ran through the route, not
     * which of its phases a probe came from.
     */
    let ladderProbesRefused = 0;
    /**
     * The second address's `/api/host`, answered by the route **while the page
     * was still at the address it knew**. The hop has committed by the time the
     * new document writes its own pairing, so that write cannot be counted here
     * either.
     */
    let answeredForTheLadder = 0;
    /**
     * The complement of the count above, and the reason it means anything: a
     * request to the second address made by a page that is **no longer at the
     * address it knew**. The page that lands there asks `/api/host` on every
     * load (`rememberPairing`), so this request is real and arrives at the same
     * handler; the assertion on it is what shows the count above excludes it
     * rather than happening not to have seen it.
     */
    let answeredAfterHop = 0;
    /**
     * Flipped once the load has stored its pairing. Before that the display's own
     * `/api/host` is the one the route must let through — it is what writes the
     * identity the ladder matches on — and the ladder's probe of the same URL
     * must fail.
     */
    let moved = false;

    await page.route(
      (url) => url.port === String(port),
      async (route) => {
        const target = new URL(route.request().url());

        if (target.pathname === "/api/host") {
          if (target.hostname === elsewhereAddress) {
            if (page.url().startsWith(known)) answeredForTheLadder += 1;
            else answeredAfterHop += 1;
            await route.fulfill({ json: { id: hostId, name: hostName, port } });
            return;
          }

          if (moved) {
            ladderProbesRefused += 1;
            await route.abort();
            return;
          }
        }

        await route.continue();
      },
    );
    // The host has stopped answering where the display is looking, and has not
    // moved yet — so the display is left on the page it is already showing.
    await page.route("**/api/published*", (route) =>
      moved && new URL(route.request().url()).hostname !== elsewhereAddress
        ? route.abort()
        : route.continue(),
    );

    const display = await pairDisplay(request, "E2E refind");

    try {
      // This PC's own theme, because the address the display loads at is
      // loopback and the host resolves a loopback request as `this-pc`.
      await assign(request, "this-pc", HOST_CHART_THEME_ID);
      // The pairing the display would already hold from a LAN load: its
      // last-known address is the LAN one, not the loopback address this page
      // loads at. Seeded before the first document, and only at the address it
      // knows: the page that lands on the second address keeps its own origin's
      // storage. The load then rewrites it to where the page actually is, which
      // is what the poll below observes — the seed alone cannot satisfy it.
      await page.addInitScript(
        (pairing: {
          hostId: string;
          hostName: string;
          port: number;
          token: string;
          lastAddress: string;
        }) => {
          if (location.hostname !== "127.0.0.1") return;
          localStorage.setItem(
            "yunari.display.pairing",
            JSON.stringify(pairing),
          );
        },
        {
          hostId,
          hostName,
          port,
          token: display.token,
          lastAddress: new URL(origin).hostname,
        },
      );
      await page.goto(known);
      await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();

      // The load's own write, which the seed cannot satisfy: the page stores
      // the address it is actually on, and the seed holds the LAN one.
      await expect
        .poll(() =>
          page.evaluate(() => {
            const raw = localStorage.getItem("yunari.display.pairing");
            const stored =
              raw === null
                ? {}
                : (JSON.parse(raw) as { lastAddress?: unknown });
            return { stored: stored.lastAddress, here: location.hostname };
          }),
        )
        .toEqual({ stored: "127.0.0.1", here: "127.0.0.1" });

      moved = true;

      await expect
        .poll(() => page.url(), { timeout: 40_000 })
        .toContain(`${secondAddress}/`);
      await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();
      // **The route really intercepted**, so the hop came from the ladder and not
      // from a URL that happened to compare equal. Both counts are the handler's
      // own: the one below is only ever an address the host has stopped answering
      // at, which nothing but the ladder asks, and the one under it is the same
      // second address asked again by the page that landed there — so what is
      // asserted is a count the handler discriminated, not the only request of
      // its kind it ever saw.
      expect(
        ladderProbesRefused,
        "the route never refused one of the ladder's probes, so the ladder did not run through it",
      ).toBeGreaterThan(0);
      expect(
        answeredForTheLadder,
        "the second address was never answered for the ladder, only for the page that landed there",
      ).toBeGreaterThan(0);
      // ...and the same address *is* asked again by the page that landed on it,
      // so the count above is one the handler had to discriminate rather than
      // the only request of its kind. Polled: this write is fired and not
      // awaited by the load it belongs to, so it may land after the hop's own
      // assertion does.
      await expect
        .poll(() => answeredAfterHop, {
          message:
            "the post-hop page's own /api/host never reached the route, so the count above is not shown to exclude it",
          timeout: 10_000,
        })
        .toBeGreaterThan(0);
    } finally {
      await request.delete(`${admin}/api/displays/${display.id}`);
    }
  });

  test("a 90 degree rect display rotates and fits without cropping", async ({
    page,
    request,
  }) => {
    test.skip(origin === "", "this machine has no LAN address");

    const display = await pairDisplay(request, "Rotated TV", {
      shape: "rect",
      rotation: 90,
    });
    await page.setViewportSize({ width: 600, height: 800 });
    await page.goto(playerUrl(display, { theme: TWO_TONE_THEME_BOUNDS }));
    await waitForRotation(page, 90);

    const reading = await readPresentation(page);
    const [a, b, c, d, e, f] = reading.matrix;
    const corners = [
      [0, 0],
      [640, 0],
      [640, 360],
      [0, 360],
    ] as const;
    const points = corners.map(([x, y]) => ({
      x: a * x + c * y + e,
      y: b * x + d * y + f,
    }));
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));

    // A quarter turn: the 640 side is now the screen's vertical one.
    expect(Math.abs(a), "the matrix is not a quarter turn").toBeLessThan(1e-6);
    expect(Math.abs(d)).toBeLessThan(1e-6);
    // Contain: the turned board fills the height and is letterboxed at the
    // sides, 75 px each on this 600 × 800 screen — 360 × 1.25 = 450 wide.
    expect(minY).toBeCloseTo(0, 1);
    expect(maxY).toBeCloseTo(reading.viewport.height, 1);
    expect(maxX - minX).toBeCloseTo(450, 0);
    expect(minX).toBeGreaterThan(0);
    expect(maxX).toBeLessThan(reading.viewport.width);

    // The fit letterboxes rather than cropping: the bar beside the board is the
    // theme's own paint, not a stretched or clamped copy of the media.
    const [bar] = await sampleScreenPixels(page, [{ x: 25, y: 400 }]);
    expect(
      colourDistance(bar!, { r: 16, g: 19, b: 24 }),
      `the letterbox is not the theme's bar paint: ${JSON.stringify(bar)}`,
    ).toBeLessThan(25);
  });

  test("a circle display puts the artboard corners on the disc at 0 and 45", async ({
    page,
    request,
  }) => {
    test.skip(origin === "", "this machine has no LAN address");

    for (const rotation of [0, 45] as const) {
      const display = await pairDisplay(request, `Round ${rotation}`, {
        shape: "circle",
        rotation,
      });
      await page.goto(playerUrl(display, { theme: TWO_TONE_THEME_BOUNDS }));
      await waitForDisc(page);
      await waitForRotation(page, rotation);
      await settleBackgroundMedia(page);

      // **Two independently rendered drawings**: the disc is the presentation's
      // own DOM plate, and the board is the media layer's painted rect off its
      // layout box and computed transform. Neither is read from the camera
      // matrix, so a scene that reports a rotation it did not render fails.
      const disc = await renderedBox(page, "[data-yunari-display-disc]");
      expect(disc.width, "the disc's box is square").toBeCloseTo(
        disc.height,
        1,
      );
      const plate = await renderedPlate(page);
      expect(
        plate.angle,
        rotation === 0
          ? "the rendered plate did not stay upright at 0"
          : "the rendered plate did not turn at 45",
      ).toBeCloseTo(rotation, 1);

      const centre = {
        x: disc.left + disc.width / 2,
        y: disc.top + disc.height / 2,
      };
      const radius = disc.width / 2;
      for (const corner of plate.corners) {
        const distance = Math.hypot(corner.x - centre.x, corner.y - centre.y);
        // 1px: the disc's box and the plate's transform are rounded to layout
        // and paint pixels, and the plate's antialiased edge adds one more.
        expect(
          Math.abs(distance - radius),
          `a rendered plate corner is ${distance.toFixed(2)}px from the centre, not the disc's ${radius.toFixed(2)}px`,
        ).toBeLessThanOrEqual(1.5);
      }
    }
  });

  test("a theme-bounded background rotates and a display-bounded one does not", async ({
    page,
    request,
  }) => {
    test.skip(origin === "", "this machine has no LAN address");

    const themeDisplay = await pairDisplay(request, "Theme media", {
      shape: "rect",
      rotation: 180,
    });
    await page.goto(playerUrl(themeDisplay, { theme: TWO_TONE_THEME_BOUNDS }));
    await waitForRotation(page, 180);
    await expect(
      page.locator("[data-yunari-background-media]"),
      "a theme-bounded layer does not turn with the composition",
    ).toHaveCSS("transform", "matrix(-1, 0, 0, -1, 0, 0)");

    // **At 45, not 0.** A display-bounded layer's box is the host, so
    // `transform: none` at 0 would hold whether or not the layer turns with the
    // composition; at a non-zero angle only an unturned layer reports none.
    const displayDisplay = await pairDisplay(request, "Display media", {
      shape: "circle",
      rotation: 45,
    });
    await page.goto(
      playerUrl(displayDisplay, { theme: TWO_TONE_DISPLAY_BOUNDS }),
    );
    await waitForDisc(page);
    await waitForRotation(page, 45);
    await settleBackgroundMedia(page);

    const layer = page.locator("[data-yunari-background-media]");
    await expect(
      layer,
      "a display-bounded layer fills a box, not a board",
    ).toHaveCSS("transform", "none");
    await expect(layer).toHaveCSS("border-radius", "50%");
    const geometry = await layer.evaluate((node) => ({
      width: (node as HTMLElement).offsetWidth,
      height: (node as HTMLElement).offsetHeight,
      disc: Math.min(window.innerWidth, window.innerHeight),
    }));
    expect(geometry.width).toBeCloseTo(geometry.disc, 0);
    expect(geometry.height).toBeCloseTo(geometry.disc, 0);
  });

  test("a glass panel samples a rotated theme at 90, 270 and 45", async ({
    page,
    request,
  }) => {
    test.skip(origin === "", "this machine has no LAN address");

    /** The panel centres in authored coordinates, mapped to the screen pixels
     *  that turn with the composition. */
    async function panelPoints(
      page: Page,
      authored: readonly { readonly x: number; readonly y: number }[],
    ) {
      const reading = await readPresentation(page);
      return authored.map((point) => clientPoint(reading, point.x, point.y));
    }

    // Every panel is off the board's horizontal centreline: on that line a
    // quarter turn of a horizontal offset stays on the source's same half, so a
    // sampler that dropped the media's angle would read the right colour by
    // accident. Authored centres are (160, 90) red, (480, 270) blue and
    // (600, 60) blue near the board's top-right corner.
    const LEFT = { x: 160, y: 90 } as const;
    const RIGHT = { x: 480, y: 270 } as const;
    const CORNER = { x: 600, y: 60 } as const;

    // 90 and 270 on a rect display. The panel's screen position turns with the
    // composition, so a sampler that ignored the media's angle reads the wrong
    // half — or the letterbox — instead of the half the panel is over.
    for (const rotation of [90, 270] as const) {
      const display = await pairDisplay(request, `Glass ${rotation}`, {
        shape: "rect",
        rotation,
      });
      await page.setViewportSize({ width: 600, height: 800 });
      await page.goto(playerUrl(display, { theme: GLASS_TWO_TONE_THEME }));
      await waitForRotation(page, rotation);
      await settleBackgroundMedia(page);
      await expect(page.locator("[data-yunari-background-media]")).toHaveCSS(
        "transform",
        rotation === 90
          ? "matrix(0, 1, -1, 0, 0, 0)"
          : "matrix(0, -1, 1, 0, 0, 0)",
      );

      const [red, blue] = await panelPoints(page, [LEFT, RIGHT]);
      await expectPanelTint(
        page,
        red!,
        TINT.red,
        `the left panel at ${rotation} is not the media's red half`,
      );
      await expectPanelTint(
        page,
        blue!,
        TINT.blue,
        `the right panel at ${rotation} is not the media's blue half`,
      );
      const pixels = await sampleScreenPixels(page, [red!, blue!]);
      expect(colourDistance(pixels[0]!, TINT.blue)).toBeGreaterThan(80);
      expect(colourDistance(pixels[1]!, TINT.red)).toBeGreaterThan(80);
    }

    // A circle at 45: a non-quarter angle, where the disc's inscribed scale is
    // not the turned bounding box's. The three panels read their authored
    // halves; `CORNER` is inside the board, so the blue it reads is the media's
    // tint and untinted plate paint cannot pass.
    const circle = await pairDisplay(request, "Glass circle 45", {
      shape: "circle",
      rotation: 45,
    });
    await page.setViewportSize({ width: 600, height: 800 });
    await page.goto(playerUrl(circle, { theme: GLASS_TWO_TONE_THEME }));
    await waitForDisc(page);
    await waitForRotation(page, 45);
    await settleBackgroundMedia(page);
    expect(
      await page
        .locator("[data-yunari-background-media]")
        .evaluate((node) => (node as HTMLElement).style.transform),
      "the media did not turn with a 45 degree circle",
    ).toBe("rotate(45deg)");

    const [red, blue, corner] = await panelPoints(page, [LEFT, RIGHT, CORNER]);
    await expectPanelTint(
      page,
      red!,
      TINT.red,
      "the left panel at 45 is not the media's red half",
    );
    await expectPanelTint(
      page,
      blue!,
      TINT.blue,
      "the right panel at 45 is not the media's blue half",
    );
    await expectPanelTint(
      page,
      corner!,
      TINT.blue,
      "the corner panel at 45 is not the media's blue half",
    );
    const pixels = await sampleScreenPixels(page, [red!, blue!, corner!]);
    expect(colourDistance(pixels[0]!, TINT.blue)).toBeGreaterThan(80);
    expect(colourDistance(pixels[1]!, TINT.red)).toBeGreaterThan(80);
    expect(
      colourDistance(pixels[2]!, TINT.bar),
      "the corner panel read the plate, so the sampler stopped at the board's edge",
    ).toBeGreaterThan(80);
    expect(colourDistance(pixels[2]!, TINT.red)).toBeGreaterThan(80);
  });

  test("a panel straddling a circle display's edge reads the picture inside the disc and black outside", async ({
    page,
    request,
  }) => {
    test.skip(origin === "", "this machine has no LAN address");

    const display = await pairDisplay(request, "Disc edge", {
      shape: "circle",
    });
    await page.setViewportSize({ width: 600, height: 800 });
    await page.goto(playerUrl(display, { theme: TWO_TONE_DISPLAY_BOUNDS }));
    await waitForDisc(page);
    await settleBackgroundMedia(page);

    const reading = await readPresentation(page);
    const disc = await page
      .locator("[data-yunari-background-media]")
      .evaluate((node) => {
        const box = (node as HTMLElement).getBoundingClientRect();
        return {
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          radius: getComputedStyle(node as HTMLElement).borderRadius,
        };
      });
    expect(disc.radius, "the layer is not clipped to the disc").toBe("50%");
    const centre = {
      x: disc.left + disc.width / 2,
      y: disc.top + disc.height / 2,
    };
    const distanceOf = (point: { readonly x: number; readonly y: number }) =>
      Math.hypot(point.x - centre.x, point.y - centre.y);

    // The panel really straddles the disc's edge: its far corner is outside
    // it, so the panel is not wholly inside and cannot pass this case by never
    // reaching the boundary.
    expect(
      distanceOf(clientPoint(reading, 700, 420)),
      "the panel's far corner is inside the disc, so nothing straddles its edge",
    ).toBeGreaterThan(disc.width / 2);

    // Authored `(620, 340)` is the panel's visible quadrant, inside the board
    // and inside the disc but close to its edge: a sampler that clipped the
    // display-bounded media to a box smaller than the disc reads black here.
    const inside = clientPoint(reading, 620, 340);
    expect(
      distanceOf(inside),
      "the read point is not inside the disc",
    ).toBeLessThan(disc.width / 2);
    // Authored `(660, 180)` is inside the disc and outside the board, so this
    // is the display-bounded layer's own picture rather than the canvas.
    const lens = clientPoint(reading, 660, 180);
    // The disc box's own corner, outside the disc and inside the layer's box.
    const outside = { x: disc.left + 10, y: disc.top + 10 };

    await expectPanelTint(
      page,
      inside,
      TINT.blue,
      "the panel over the disc edge is not the picture's blue",
    );
    const pixels = await sampleScreenPixels(page, [inside, lens, outside]);
    expect(
      colourDistance(pixels[0]!, TINT.black),
      "the panel read black where the display-bounded picture is",
    ).toBeGreaterThan(60);
    expect(
      pixels[1]!.b - pixels[1]!.r,
      `inside the disc and outside the board the media is not showing: ${JSON.stringify(pixels[1])}`,
    ).toBeGreaterThan(150);
    expect(
      pixels[2]!.r + pixels[2]!.g + pixels[2]!.b,
      `outside the disc is not black: ${JSON.stringify(pixels[2])}`,
    ).toBeLessThan(30);
  });

  test("the host controls write shape and rotation and the player picks them up", async ({
    page,
    request,
  }) => {
    test.skip(origin === "", "this machine has no LAN address");

    const display = await pairDisplay(request, "Editable", {
      shape: "rect",
      rotation: 0,
    });

    await page.goto(`${admin}/editor/`);
    const modeSwitch = page.locator(".editor-shell-mode-switch");
    await expect(modeSwitch).toBeVisible({ timeout: 30_000 });
    await modeSwitch
      .getByRole("button", {
        name: editorCopy.modes.thisPc,
        exact: true,
      })
      .click();
    await expect(page.locator("[data-yunari-mode-region]")).toHaveAttribute(
      "data-yunari-mode-region",
      "this-pc",
    );

    const row = page.locator(`[data-yunari-host-display="${display.id}"]`);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();
    // The segment is itself the button, so the role query is scoped by text
    // rather than chained through the attribute it already sits on.
    await page
      .locator("[data-yunari-host-display-shape]", {
        hasText: editorCopy.hostSettings.displays.shapeCircle,
      })
      .click();
    // The shape write is one request with the angle it snaps to; wait for its
    // answer before the angle edit, or the two writes race.
    await expect(row).toHaveAttribute("data-shape", "circle");

    const well = page.locator("#yunari-host-display-rotation");
    await expect(well).toBeVisible();
    await well.fill("45");
    await well.press("Enter");

    await activeDisplay(request, display.id).toMatchObject({
      shape: "circle",
      rotation: 45,
    });
    await expect(row).toHaveAttribute("data-rotation", "45");

    // The write is not the behaviour: the player this display watches has to
    // answer with the presentation the host now holds.
    await page.goto(playerUrl(display, { theme: TWO_TONE_THEME_BOUNDS }));
    await waitForDisc(page);
    await waitForRotation(page, 45);
    await settleBackgroundMedia(page);
    const plate = await renderedPlate(page);
    expect(
      plate.angle,
      "the player did not pick the host's new angle up",
    ).toBeCloseTo(45, 1);
  });

  test("choosing a rectangle for a turned circle snaps the angle back to upright", async ({
    page,
    request,
  }) => {
    test.skip(origin === "", "this machine has no LAN address");

    const display = await pairDisplay(request, "Turned circle", {
      shape: "circle",
      rotation: 37,
    });

    await openHostSettings(page);
    const row = page.locator(`[data-yunari-host-display="${display.id}"]`);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toHaveAttribute("data-shape", "circle");
    await expect(row).toHaveAttribute("data-rotation", "37");
    await row.click();
    await page
      .locator("[data-yunari-host-display-shape]", {
        hasText: editorCopy.hostSettings.displays.shapeRect,
      })
      .click();

    // A rectangle has no turned presentation, so the shape write carries the
    // angle it snaps to: the row and the store must not disagree about a
    // rotation the store refuses for that shape. A zero angle is omitted from
    // the stored record, so the read supplies it.
    await expect
      .poll(
        async () => {
          const record = await displayRecord(request, display.id);
          return record === undefined
            ? "missing"
            : `${record.shape}:${record.rotation ?? 0}`;
        },
        {
          timeout: 20_000,
          message:
            "the store kept the circle's angle through a rectangle write",
        },
      )
      .toBe("rect:0");
    await expect(row).toHaveAttribute("data-shape", "rect");
    await expect(row).toHaveAttribute("data-rotation", "0");

    await page.goto(playerUrl(display, { theme: TWO_TONE_THEME_BOUNDS }));
    await expect
      .poll(() => page.locator("[data-yunari-display-disc]").count(), {
        timeout: 20_000,
      })
      .toBe(0);
    await waitForRotation(page, 0);
  });

  test("this PC plays upright and rectangular, and the Host offers it no shape or rotation", async ({
    page,
  }) => {
    test.skip(origin === "", "this machine has no LAN address");

    // A loopback request resolves as this PC whatever credential it carries.
    // The unpaired default is not reachable as a page at all — a non-loopback
    // read without a credential is refused, which the report names — so this
    // case can only prove the `this-pc` half of acceptance 10.
    await page.setViewportSize({ width: 600, height: 800 });
    await page.goto(`${admin}/?theme=${TWO_TONE_THEME_BOUNDS}`);
    await waitForRotation(page, 0);
    await settleBackgroundMedia(page);
    await expect(
      page.locator("[data-yunari-display-disc]"),
      "this PC was given a disc",
    ).toHaveCount(0);
    await expect(
      page.locator("[data-yunari-background-media]"),
      "this PC's media turned",
    ).toHaveCSS("transform", "none");
    const clip = await page
      .locator("#artboard canvas.lower-canvas")
      .evaluate((node) => getComputedStyle(node).clipPath);
    expect(clip, "this PC's board is clipped to a shape").toBe("none");

    await openHostSettings(page);
    const row = page.locator('[data-yunari-host-display="this-pc"]');
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();
    await expect(
      page.getByText(editorCopy.hostSettings.displays.presentationAbsent, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.locator("[data-yunari-host-display-shape]"),
      "the Host drew a shape control for this PC",
    ).toHaveCount(0);
    await expect(
      page.locator("#yunari-host-display-rotation"),
      "the Host drew a rotation control for this PC",
    ).toHaveCount(0);
  });
});

/** What this client reported, kept in the JSON report rather than in a comment
 *  that a later reader cannot check. */
async function recordCapabilities(
  page: Page,
  testInfo: {
    annotations: { type: string; description?: string }[];
  },
): Promise<void> {
  const reported = await page.evaluate(() => ({
    origin: location.origin,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    secureContext: window.isSecureContext,
    fullscreen:
      typeof document.documentElement.requestFullscreen === "function",
    wakeLock:
      typeof (navigator as unknown as { wakeLock?: unknown }).wakeLock ===
      "object",
  }));
  testInfo.annotations.push({
    type: "capabilities",
    description: JSON.stringify(reported),
  });
}

/**
 * A seeded theme on the display, opened straight from the host.
 *
 * These cases are about the chrome the display draws, not about an authored
 * document, so none of them needs the editor: `seedHostTheme` has already put
 * this theme in the host's library by the time a worker starts
 * (`tests/e2e/global-setup.ts`).
 */
async function openSeededDisplay(page: Page): Promise<void> {
  await page.goto(`${HOST}/?theme=${HOST_CHART_THEME_ID}`);
  await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();
}

/** A tap on the composition, which is what a reader has to press. */
async function tapTheDisplay(page: Page): Promise<void> {
  const box = await page.locator("#artboard").boundingBox();
  if (box === null) throw new Error("the display has no artboard to tap");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/**
 * The display's column, measured from the document rather than from a reading
 * taken earlier in the same load.
 *
 * **This is absolute on purpose, and the reason is a defect the review found.**
 * The case used to compare three readings of the canvas's box against each
 * other, so a build where a control is in flow for the whole load shrank the
 * artboard in all three and the comparison came out equal — the regression this
 * case exists for, passing while the composition lost 40.8px. What the column
 * asserts instead is a fact about the page: everything in flow under `body` is
 * the two declared chrome bands and `#artboard`, and the artboard's height is
 * what the bands leave. A control that is `position: fixed` is not a flex item,
 * which is the whole invariant; one that is `static` shows up here immediately,
 * whenever it arrived.
 */
function column(page: Page): Promise<{
  readonly otherColumns: readonly string[];
  readonly artboardHeight: number;
  readonly bodyHeight: number;
  readonly bandHeight: number;
}> {
  return page.evaluate(() => {
    const body = document.body;
    const artboard = document.getElementById("artboard");
    if (artboard === null) throw new Error("the display has no artboard");
    const children = [...body.children];
    const bands = children.filter((child) =>
      child.hasAttribute("data-yunari-chrome"),
    );
    const heightOf = (element: Element): number =>
      element.getBoundingClientRect().height;
    return {
      // Named by tag and id so a failure says which element joined the column.
      otherColumns: children
        .filter((child) => {
          const position = getComputedStyle(child).position;
          // A fixed or absolute child is out of flow and takes no room; a
          // static or relative one is a flex item and does.
          if (position === "fixed" || position === "absolute") return false;
          return child !== artboard && !bands.includes(child);
        })
        .map(
          (child) =>
            `${child.tagName.toLowerCase()}${child.id === "" ? "" : `#${child.id}`}`,
        ),
      artboardHeight: heightOf(artboard),
      bodyHeight: heightOf(body),
      bandHeight: bands.reduce((total, band) => total + heightOf(band), 0),
    };
  });
}

function barOpacity(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      document.querySelector<HTMLElement>("[data-yunari-controls]")?.style
        .opacity ?? "missing",
  );
}

function shadeOpacity(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      document.querySelector<HTMLElement>("[data-yunari-dimmer]")?.style
        .opacity ?? "missing",
  );
}

function wakeRequests(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as unknown as { __yunariWake?: { requests: number } })
        .__yunariWake?.requests ?? 0,
  );
}

function wakeLockHeld(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      (window as unknown as { __yunariWake?: { sentinel: unknown } })
        .__yunariWake?.sentinel !== null,
  );
}

/** Whether the request has come back, granted or refused. */
function wakeSettled(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const state = (
      window as unknown as {
        __yunariWake?: { sentinel: unknown; failed: string | null };
      }
    ).__yunariWake;
    return (
      state !== undefined && (state.sentinel !== null || state.failed !== null)
    );
  });
}

function wakeFailure(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      (window as unknown as { __yunariWake?: { failed: string | null } })
        .__yunariWake?.failed ?? "no failure recorded",
  );
}

/** The first non-loopback IPv4 address, which is the address a phone is told to
 *  open. `undefined` on a machine that has none, and the case skips. */
function lanAddress(): string | undefined {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return undefined;
}

const PLAYER_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/**
 * The built player, over plain http on the LAN address — the origin a display
 * still reaches by opening the address the host prints, which the host answers
 * on the same port as its secure one (`vg-580`, `docs/decisions/0070`). Served
 * from the spec rather than by a second host so that the only thing under test
 * is the origin: the display cannot load a theme from here, and does not need
 * to for a reading that is a property of the origin.
 */
async function servePlayerBundle(
  address: string,
): Promise<{ origin: string; close: () => Promise<void> }> {
  const root = fileURLToPath(
    new URL("../../packages/player/dist/", import.meta.url),
  );
  const server: Server = createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    const file = join(root, path === "/" ? "index.html" : path);
    void readFile(file)
      .then((bytes) => {
        response.writeHead(200, {
          "content-type":
            PLAYER_CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
        });
        response.end(bytes);
      })
      .catch(() => {
        response.writeHead(404);
        response.end();
      });
  });

  await new Promise<void>((settle) => {
    server.listen(0, "0.0.0.0", settle);
  });
  const port = (server.address() as { port: number }).port;

  return {
    origin: `http://${address}:${port}`,
    close: () =>
      new Promise<void>((settle) => {
        server.close(() => settle());
      }),
  };
}
