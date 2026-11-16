import { expect, type Page, test } from "@playwright/test";
import { CATALOGUE_ORIGIN } from "@yunari/renderer-core";
import { uiCopy } from "../../packages/editor/src/ui-copy.js";
import { isDesktopSurface } from "./surface.js";

/**
 * The Library in a built bundle: every browse page, a pack's members, one
 * item's own surface, and a collection installed through its sheet.
 *
 * **The editor preview serves no host API and no catalogue**, so every answer
 * this spec reads is routed here: the catalogue index, the five host listings,
 * the origin register, the collection plan and the install POST. The routed
 * index is the catalogue — a page draws what this file declares — which is the
 * one fact a preview server cannot provide. What these routes cannot prove is
 * the host's own install; that belongs to the host suite.
 */

const EDITOR = "http://127.0.0.1:4174/?mode=editor";

const THEME_ID = "11111111-1111-4111-8111-111111111111";
const TALL_THEME_ID = "77777777-7777-4777-8777-777777777777";
const EDITOR_THEME_ID = "22222222-2222-4222-8222-222222222222";
const PACK_ID = "33333333-3333-4333-8333-333333333333";
const PRESET_ID = "44444444-4444-4444-8444-444444444444";
const PLUGIN_ID = "55555555-5555-4555-8555-555555555555";
const COLLECTION_ID = "66666666-6666-4666-8666-666666666666";
/** The last row of the second batch the Dashboard themes grid loads. */
const LATE_THEME_ID = "88888888-8888-4888-8888-888888888825";

const COLLECTION_NAME = "Desk kit";

/** A transparent 1×1 PNG, so a picture the fixture does not serve reads as an
 *  empty box rather than the browser's broken-image mark. */
const EMPTY_PICTURE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAANSURBVBhXY2BgYGAAAAAFAAGKM+MAAAAAAElFTkSuQmCC",
  "base64",
);

/** Every entry's facets: the eight fields the parser holds for presence. A
 *  listing's own picture is a path under the store's origin, and the stage
 *  draws the picture at the record's ratio, so a case states that ratio here. */
function facets(author: string, width = 1920, height = 1080) {
  return {
    author,
    colourMode: "dark",
    sensors: [],
    tags: [],
    orientation: width >= height ? "landscape" : "portrait",
    aspect: width >= height ? "16:9" : "9:16",
    width,
    height,
  };
}

function entry(options: {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly members: readonly { id: string; kind: string; name: string }[];
  readonly author: string;
  readonly includes?: readonly {
    readonly id: string;
    readonly optional: boolean;
  }[];
  readonly digest?: boolean;
  readonly width?: number;
  readonly height?: number;
}): Record<string, unknown> {
  return {
    id: options.id,
    kind: options.kind,
    name: options.name,
    version: "1.0.0",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
    downloads: 3,
    favorites: 1,
    packageUrl: `https://${new URL(CATALOGUE_ORIGIN).host}/${options.id}.zip`,
    thumbnail: `catalogue/${options.id}/thumbnail.png`,
    members: options.members,
    ...(options.includes === undefined ? {} : { includes: options.includes }),
    facets: facets(options.author, options.width, options.height),
    // Only a collection's plan read needs the digest; every other kind is
    // listed and never fetched here.
    ...(options.digest === true
      ? {
          sha256: "a".repeat(64),
          bytes: 4096,
          publisher: options.author,
        }
      : {}),
  };
}

/** The catalogue every Library page lists: one entry per browse kind, a pack
 *  with two members, and a collection over two of them. */
const ENTRIES: readonly Record<string, unknown>[] = [
  entry({
    id: THEME_ID,
    kind: "dashboard-theme",
    name: "Aurora Glass",
    author: "mira-k",
    members: [{ id: "aurora", kind: "dashboard-theme", name: "Aurora Glass" }],
  }),
  entry({
    id: TALL_THEME_ID,
    kind: "dashboard-theme",
    name: "Aurora Tall",
    author: "mira-k",
    members: [
      { id: "aurora-tall", kind: "dashboard-theme", name: "Aurora Tall" },
    ],
    width: 1080,
    height: 1920,
  }),
  entry({
    id: EDITOR_THEME_ID,
    kind: "editor-theme",
    name: "Slate",
    author: "mira-k",
    members: [{ id: "Slate", kind: "editor-theme", name: "Slate" }],
  }),
  entry({
    id: PACK_ID,
    kind: "widget-pack",
    name: "Signal Pack",
    author: "mira-k",
    members: [
      { id: "signal-clock", kind: "widget", name: "Signal clock" },
      { id: "signal-gauge", kind: "widget", name: "Signal gauge" },
    ],
  }),
  entry({
    id: PRESET_ID,
    kind: "path-preset-pack",
    name: "Rounded set",
    author: "mira-k",
    members: [
      { id: "pill", kind: "shape", name: "Pill" },
      { id: "capsule", kind: "shape", name: "Capsule" },
    ],
  }),
  entry({
    id: PLUGIN_ID,
    kind: "plugin",
    name: "Acme sensors",
    author: "acme",
    members: [
      { id: "acme-load", kind: "sensor-provider", name: "Acme load" },
      { id: "acme-http", kind: "data-source", name: "Acme HTTP" },
      { id: "acme-art", kind: "asset-source", name: "Acme art" },
      { id: "acme-panel", kind: "panel-driver", name: "Acme panel" },
    ],
  }),
  entry({
    id: COLLECTION_ID,
    kind: "collection",
    name: COLLECTION_NAME,
    author: "mira-k",
    members: [],
    includes: [
      { id: THEME_ID, optional: false },
      { id: PACK_ID, optional: true },
    ],
    digest: true,
  }),
  // Enough Dashboard themes that the grid's first batch cannot draw them all:
  // the last of these is the row only the second batch reaches.
  ...Array.from({ length: 26 }, (_, index) =>
    entry({
      id: `88888888-8888-4888-8888-8888888888${String(index).padStart(2, "0")}`,
      kind: "dashboard-theme",
      name: `Batch theme ${index + 1}`,
      author: "mira-k",
      members: [
        {
          id: `batch-${index + 1}`,
          kind: "dashboard-theme",
          name: `Batch theme ${index + 1}`,
        },
      ],
    }),
  ),
];

/** The host's answers for every route the Library reads. */
async function routeHost(page: Page): Promise<{
  readonly installs: readonly Record<string, unknown>[];
}> {
  const installs: Record<string, unknown>[] = [];

  await page.route("**/index.json", (route) =>
    route.fulfill({
      // The editor reads the index cross-origin, so the answer carries the
      // origin's own CORS header rather than being rejected.
      headers: { "access-control-allow-origin": "*" },
      json: { generatedAt: "2026-10-14T00:00:00.000Z", entries: ENTRIES },
    }),
  );

  await page.route(
    (url) =>
      url.hostname === new URL(CATALOGUE_ORIGIN).hostname &&
      url.pathname.endsWith(".png"),
    (route) =>
      route.fulfill({ contentType: "image/png", body: EMPTY_PICTURE_PNG }),
  );

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === "/api/themes") return route.fulfill({ json: { themes: [] } });
    if (path === "/api/editor-themes") return route.fulfill({ json: [] });
    if (path === "/api/widget-packs")
      return route.fulfill({ json: { packs: [] } });
    if (path === "/api/path-presets")
      return route.fulfill({ json: { presets: [] } });
    if (path === "/api/extensions")
      return route.fulfill({ json: { extensions: [] } });
    if (path === "/api/store/origins")
      return route.fulfill({ json: { origins: [] } });
    if (path === "/api/store/mine")
      return route.fulfill({ json: { entries: [] } });
    if (path === "/api/store/collection/plan" && request.method() === "POST") {
      return route.fulfill({
        json: {
          plan: {
            members: [
              {
                id: THEME_ID,
                kind: "dashboard-theme",
                name: "Aurora Glass",
                version: "1.0.0",
                bytes: 2048,
                publisher: "mira-k",
                optional: false,
              },
              {
                id: PACK_ID,
                kind: "widget-pack",
                name: "Signal Pack",
                version: "1.0.0",
                bytes: 2048,
                publisher: "mira-k",
                optional: true,
              },
            ],
            missing: [],
            totalBytes: 4096,
          },
        },
      });
    }
    if (path === "/api/store/install" && request.method() === "POST") {
      const body: unknown = request.postDataJSON();
      if (typeof body === "object" && body !== null) {
        installs.push(body as Record<string, unknown>);
      }
      return route.fulfill({
        json: {
          ok: true,
          members: [
            { id: THEME_ID, ok: true },
            { id: PACK_ID, ok: true },
          ],
        },
      });
    }

    return route.fulfill({ status: 404, body: "" });
  });

  return { installs };
}

/** The editor's boot and the Library mode, leaving the region showing. */
async function openLibrary(page: Page) {
  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();
  await page
    .locator(".editor-shell-mode-switch")
    .getByRole("button", { name: uiCopy.modes.library, exact: true })
    .click();

  const region = page.locator("[data-yunari-mode-region='library']");
  await expect(region, "the Library renders no region").toBeVisible();
  return region;
}

const BROWSE_PAGES = [
  "dashboard-themes",
  "app-themes",
  "widgets",
  "shapes",
  "sensor-providers",
  "asset-sources",
  "panel-drivers",
  "collections",
] as const;

test("every Library page opens on the catalogue", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  await routeHost(page);
  const region = await openLibrary(page);

  for (const id of BROWSE_PAGES) {
    await region.locator(`[data-yunari-library-nav-item="${id}"]`).click();
    const panel = region.locator(`[data-yunari-library-panel="${id}"]`);
    await expect(panel, `the ${id} page did not open`).toBeVisible();
    // The page is a listing, not an empty panel: the catalogue answered and
    // at least one entry carries that page's member kind.
    await expect(
      panel.locator("[data-yunari-store-cell]").first(),
      `the ${id} page lists no card`,
    ).toBeVisible();
  }

  await region.locator('[data-yunari-library-nav-item="submissions"]').click();
  await expect(
    region.locator("[data-yunari-submissions-page]"),
    "My submissions did not open",
  ).toBeVisible();
});

/**
 * **The grid loads near the end, not all at once.** The first batch cannot
 * draw the last dashboard theme; scrolling to the sentinel loads the second,
 * and a row only that batch draws appears.
 */
test("the grid draws a second batch when the sentinel is reached", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  await routeHost(page);
  // A short viewport keeps the sentinel below the observer's margin until the
  // grid is scrolled, so the first batch is the state this case reads.
  await page.setViewportSize({ width: 1280, height: 600 });
  const region = await openLibrary(page);
  await region
    .locator('[data-yunari-library-nav-item="dashboard-themes"]')
    .click();
  const panel = region.locator(
    '[data-yunari-library-panel="dashboard-themes"]',
  );
  await expect(panel.locator("[data-yunari-store-cell]").first()).toBeVisible();

  const late = panel.locator(`[data-yunari-store-cell="${LATE_THEME_ID}"]`);
  await expect(
    late,
    "the first batch drew a row only the second batch should reach",
  ).toHaveCount(0);

  await panel
    .locator("[data-yunari-library-sentinel]")
    .scrollIntoViewIfNeeded();
  await expect(
    late,
    "scrolling to the sentinel loaded no second batch",
  ).toBeVisible();
});

test("the item surface holds the box, one stage height and each picture ratio", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  await routeHost(page);
  const region = await openLibrary(page);
  await region
    .locator('[data-yunari-library-nav-item="dashboard-themes"]')
    .click();

  /**
   * The box, the stage and the picture for one item, opened from its cell and
   * closed again. **Measured, because the numbers are design language**:
   * `DESIGN.md` fixes the modal at 960 × 760 and one stage height for every
   * item, and the stage draws the picture at the record's own ratio, so a case
   * asserting only that two stages were equal would pass a 100px stage.
   */
  const drawn = async (id: string) => {
    await region
      .locator(`[data-yunari-store-cell="${id}"]`)
      .locator("[data-yunari-store-cell-surface]")
      .click();
    const detail = page.locator("[data-yunari-store-item]");
    const stage = detail.locator("[data-yunari-store-item-stage]");
    const picture = detail.locator("[data-yunari-store-item-picture]");
    await expect(stage, "a cell opens no item surface").toBeVisible();

    const box = await detail.boundingBox();
    const stageBox = await stage.boundingBox();
    const pictureBox = await picture.boundingBox();

    await detail.locator("[data-yunari-store-item-close]").click();
    await expect(detail, "the item's surface does not close").toBeHidden();

    if (box === null || stageBox === null || pictureBox === null) {
      throw new Error(`the item's surface drew no box for ${id}`);
    }
    return {
      width: box.width,
      height: box.height,
      stage: stageBox.height,
      picture: { width: pictureBox.width, height: pictureBox.height },
    };
  };

  // Read the box at a viewport tall enough for its own height, then restore the
  // project's 720px viewport for the `90vh` cap, which a taller read cannot
  // exercise: any declaration at or above 648 would satisfy it.
  const projectViewport = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.setViewportSize({ width: projectViewport.width, height: 1000 });
  const landscape = await drawn(THEME_ID);
  const portrait = await drawn(TALL_THEME_ID);
  await page.setViewportSize(projectViewport);
  const capped = await drawn(THEME_ID);

  const reading = `store-item box ${landscape.width}x${landscape.height}px stage landscape ${landscape.stage} portrait ${portrait.stage}; picture ${landscape.picture.width}x${landscape.picture.height} and ${portrait.picture.width}x${portrait.picture.height}; capped ${capped.width}x${capped.height} stage ${capped.stage}`;
  testInfo.annotations.push({ type: "store-item", description: reading });

  expect(landscape.height, `the modal is not 760px (${reading})`).toBe(760);
  expect(
    landscape.width,
    `the modal is not the 960px DESIGN.md fixes (${reading})`,
  ).toBe(960);
  // The stage is the box's content height: 760 less the 1px border twice.
  expect(
    landscape.stage,
    `the stage is not the box's own content height (${reading})`,
  ).toBe(760 - 2);
  expect(
    portrait.stage,
    `the stage follows the item instead of holding one height (${reading})`,
  ).toBe(landscape.stage);
  // At the project's 720px viewport `90vh` is 648, so the box caps there.
  expect(
    capped.height,
    `the modal does not cap itself to 90vh on a short viewport (${reading})`,
  ).toBe(648);
  expect(
    capped.stage,
    `the stage is not the capped box's content height (${reading})`,
  ).toBe(648 - 2);

  expect(
    Math.abs(landscape.picture.width / landscape.picture.height - 16 / 9),
    `the landscape theme is not drawn at its own ratio (${reading})`,
  ).toBeLessThan(0.02);
  expect(
    Math.abs(portrait.picture.width / portrait.picture.height - 9 / 16),
    `the portrait theme is not drawn at its own ratio (${reading})`,
  ).toBeLessThan(0.02);
  expect(
    portrait.picture.height,
    `the picture is not contained in the stage's height (${reading})`,
  ).toBeLessThan(portrait.stage);
});

test("a pack expands into its members and opens its detail", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  await routeHost(page);
  const region = await openLibrary(page);
  await region.locator('[data-yunari-library-nav-item="widgets"]').click();

  const cell = region.locator(`[data-yunari-store-cell="${PACK_ID}"]`);
  await expect(cell, "the Widgets page lists no pack").toBeVisible();
  await expect(cell.locator("[data-yunari-store-cell-name]")).toHaveText(
    "Signal Pack",
  );

  // The pack is closed until its twisty is pressed, and the press says so.
  const expand = cell.locator("[data-yunari-store-cell-expand]");
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expect(cell.locator("[data-yunari-store-members]")).toBeHidden();

  await expand.click();
  await expect(expand).toHaveAttribute("aria-expanded", "true");
  const members = cell.locator("[data-yunari-store-member-card]");
  await expect(members, "the opened pack drew no members").toHaveCount(2);
  await expect(members.first()).toContainText("Signal clock");
  await expect(members.nth(1)).toContainText("Signal gauge");

  // The card's own surface is the item's detail.
  await cell.locator("[data-yunari-store-cell-surface]").click();
  const detail = page.locator("[data-yunari-store-item]");
  await expect(detail, "the pack's detail did not open").toBeVisible();
  await expect(detail).toHaveAttribute("aria-label", "Signal Pack");

  await page.keyboard.press("Escape");
  await expect(detail, "the detail did not close").toBeHidden();
});

test("a collection installs its members through the sheet", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  const host = await routeHost(page);
  const region = await openLibrary(page);
  await region.locator('[data-yunari-library-nav-item="collections"]').click();

  const cell = region.locator(`[data-yunari-store-cell="${COLLECTION_ID}"]`);
  await expect(cell, "the Collections page lists no collection").toBeVisible();
  await cell.locator("[data-yunari-store-cell-surface]").click();

  const detail = page.locator("[data-yunari-store-item]");
  await expect(detail, "the collection's detail did not open").toBeVisible();
  await expect(detail).toHaveAttribute("aria-label", COLLECTION_NAME);

  // Nothing is on this PC, so the detail offers Install; the press opens the
  // sheet rather than posting, because the sheet owns the choices.
  const install = detail.locator(
    '[data-yunari-store-collection-install="install"]',
  );
  await expect(
    install,
    "the collection's detail offers no Install",
  ).toBeVisible();
  await install.click();

  const sheet = page.locator("[data-yunari-collection-sheet]");
  await expect(sheet, "the install sheet did not open").toBeVisible();
  const rows = sheet.locator("[data-yunari-collection-member]");
  await expect(rows, "the sheet lists no members").toHaveCount(2);
  await expect(rows.first()).toContainText("Aurora Glass");
  await expect(rows.nth(1)).toContainText("Signal Pack");

  await sheet.locator("[data-yunari-collection-sheet-install]").click();
  await expect(
    sheet.locator("[data-yunari-collection-sheet-installed]"),
    "the sheet did not report the install",
  ).toContainText(`${COLLECTION_NAME} was installed.`);

  // The press posted the chosen includes, not the collection's own id.
  expect(host.installs, "the sheet posted no install").toHaveLength(1);
  expect(host.installs[0]?.["kind"]).toBe("collection");
  expect(host.installs[0]?.["items"]).toEqual([THEME_ID, PACK_ID]);
});
