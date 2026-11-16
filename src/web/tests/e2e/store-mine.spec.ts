import { expect, type Page, test } from "@playwright/test";
import { CATALOGUE_ORIGIN } from "@yunari/renderer-core";
import { uiCopy } from "../../packages/editor/src/ui-copy.js";
import { isDesktopSurface } from "./surface.js";

/**
 * The author's own store rows, proved in a built bundle: My submissions, the
 * state word, and the two commands each row offers.
 *
 * **The editor preview serves no host API**, so every store answer this spec
 * reads is routed here: the session probe, the author's own listing, and the two
 * command POSTs. The routed listing is the state — the page keeps no copy of its
 * own, so a command changes the answer and the re-read redraws it
 * (`collection-builder.tsx`). What these routes cannot prove is the Worker's own
 * behaviour; that belongs to the deployed store.
 */

const EDITOR = "http://127.0.0.1:4174/?mode=editor";

const ITEM_ID = "5d41402a-bc4b-4c8a-9d0e-2f1a3b4c5d6e";
const ITEM_NAME = "Withdrawn theme";

/** The store's own refusal, as the Worker words it: the surface prints the
 *  host's sentence unchanged and never composes one for a refusal. */
const REFUSAL = "Only the author may withdraw this item.";

type Status = "published" | "unpublished";

/** One catalogue entry plus the state the public wire shape has no room for. */
function mineEntry(status: Status): Record<string, unknown> {
  return {
    id: ITEM_ID,
    kind: "dashboard-theme",
    name: ITEM_NAME,
    version: "1.0.0",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
    downloads: 0,
    favorites: 0,
    packageUrl: `https://store.test/${ITEM_ID}.zip`,
    thumbnail: `${ITEM_ID}/thumbnail.png`,
    facets: {
      author: "mira-k",
      colourMode: "dark",
      sensors: [],
      tags: [],
      orientation: "landscape",
      aspect: "16:9",
      width: 1920,
      height: 1080,
    },
    status,
  };
}

/** A transparent 1×1 PNG, so a picture the fixture does not serve reads as an
 *  empty box rather than the browser's broken-image mark. */
const EMPTY_PICTURE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAANSURBVBhXY2BgYGAAAAAFAAGKM+MAAAAAAElFTkSuQmCC",
  "base64",
);

interface StoreHost {
  /** What `/api/store/mine` answers next; a command moves it. */
  status: Status;
  /** How many times the author's listing was read: the successful change is
   *  proved by the re-read, not by the host's answer. */
  readonly reads: () => number;
}

/**
 * The host's answers for the surface's routes. The command route is the one a
 * case can refuse, so the refusal case answers 403 in the host's words and
 * leaves the listing where it was.
 */
async function routeStoreHost(
  page: Page,
  options: {
    readonly status: Status;
    readonly refusal?: string;
  },
): Promise<StoreHost> {
  let reads = 0;
  const host: StoreHost = {
    status: options.status,
    reads: () => reads,
  };

  await page.route("**/api/store/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === "/api/store/session") {
      return route.fulfill({ json: { signedIn: true } });
    }
    if (path === "/api/store/mine") {
      reads += 1;
      return route.fulfill({ json: { entries: [mineEntry(host.status)] } });
    }

    const command = /^\/api\/store\/items\/([^/]+)\/(unpublish|publish)$/.exec(
      path,
    );
    if (command !== null && request.method() === "POST") {
      if (options.refusal !== undefined) {
        return route.fulfill({
          status: 403,
          json: { ok: false, message: options.refusal },
        });
      }
      host.status = command[2] === "unpublish" ? "unpublished" : "published";
      return route.fulfill({ json: { ok: true, status: host.status } });
    }

    return route.fulfill({ status: 404, body: "" });
  });

  return host;
}

/** The editor's boot, the Library mode, and the My submissions page. */
async function openSubmissions(page: Page) {
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
  await region.locator("[data-yunari-library-nav-item='submissions']").click();
  await expect(
    region.locator("[data-yunari-submissions-page]"),
    "My submissions is not the page showing",
  ).toBeVisible();
  return region;
}

test.beforeEach(async ({ page }) => {
  // Every page reads the catalogue's index, and this spec claims nothing about
  // it: a 404 with the origin's own CORS header keeps the read answered rather
  // than rejected and the network out of the case.
  await page.route("**/index.json", (route) =>
    route.fulfill({
      status: 404,
      headers: { "access-control-allow-origin": "*" },
      body: "",
    }),
  );
  await page.route(
    (url) => url.pathname.startsWith("/api/themes"),
    (route) => route.fulfill({ json: { themes: [] } }),
  );
  // The submission's picture is a path on the store's own origin, and this spec
  // claims nothing about it: a 1×1 pixel keeps the row an empty box rather than
  // the browser's broken-image mark.
  const storeHostname = new URL(CATALOGUE_ORIGIN).hostname;
  await page.route(
    (url) => url.hostname === storeHostname && url.pathname.endsWith(".png"),
    (route) =>
      route.fulfill({ contentType: "image/png", body: EMPTY_PICTURE_PNG }),
  );
});

test("My submissions lists an unpublished item", async ({ page }, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  await routeStoreHost(page, { status: "unpublished" });

  const region = await openSubmissions(page);
  const row = region.locator(`[data-yunari-submission="${ITEM_ID}"]`);
  await expect(
    row,
    "My submissions does not list the author's own row",
  ).toBeVisible();
  await expect(row, "the row does not draw the item's own name").toContainText(
    ITEM_NAME,
  );

  // The literal, not `uiCopy.store.status.unpublished`: the badge's whole value
  // is that a renamed word fails here.
  const badge = row.locator("[data-yunari-store-status]");
  await expect(
    badge,
    "the row does not draw the state its answer carries",
  ).toHaveText("Unpublished");
  await expect(badge).toHaveAttribute(
    "data-yunari-store-status",
    "unpublished",
  );
  await expect(
    row.locator("[data-yunari-submission-action='republish']"),
    "an unpublished row does not offer Republish",
  ).toBeVisible();
});

test("Unpublish moves the row to Unpublished once the host answers", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  const host = await routeStoreHost(page, { status: "published" });

  const region = await openSubmissions(page);
  const row = region.locator(`[data-yunari-submission="${ITEM_ID}"]`);
  const unpublish = row.locator("[data-yunari-submission-action='unpublish']");
  await expect(
    unpublish,
    "a published row does not offer Unpublish",
  ).toBeVisible();
  await unpublish.click();

  // The change is the listing's: the routed answer moved it and the page
  // re-read it, so the badge and the offered command both follow.
  await expect(
    row.locator("[data-yunari-store-status]"),
    "the redrawn row does not draw the state the re-read answered",
  ).toHaveText("Unpublished");
  await expect(
    row.locator("[data-yunari-submission-action='republish']"),
    "the redrawn row does not offer the command its new state allows",
  ).toBeVisible();
  await expect(
    row.locator("[data-yunari-submission-action='unpublish']"),
    "the redrawn row still offers the command it just ran",
  ).toHaveCount(0);
  expect(
    host.reads(),
    "the successful change did not re-read the author's own rows",
  ).toBe(2);
});

test("Republish restores the item", async ({ page }, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  const host = await routeStoreHost(page, { status: "unpublished" });

  const region = await openSubmissions(page);
  const row = region.locator(`[data-yunari-submission="${ITEM_ID}"]`);
  await expect(
    row.locator("[data-yunari-store-status]"),
    "an unpublished row does not draw its state",
  ).toHaveText("Unpublished");

  await row.locator("[data-yunari-submission-action='republish']").click();

  // A published row carries no badge word: the public surface already shows it.
  await expect(
    row.locator("[data-yunari-store-status]"),
    "the republished row still draws a state word",
  ).toHaveCount(0);
  await expect(
    row.locator("[data-yunari-submission-action='unpublish']"),
    "the republished row does not offer the command its state allows",
  ).toBeVisible();
  expect(
    host.reads(),
    "the successful republish did not re-read the author's own rows",
  ).toBe(2);
});

test("a refused unpublish states the store's sentence and leaves the row as it was", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  const host = await routeStoreHost(page, {
    status: "published",
    refusal: REFUSAL,
  });

  const region = await openSubmissions(page);
  const row = region.locator(`[data-yunari-submission="${ITEM_ID}"]`);
  await row.locator("[data-yunari-submission-action='unpublish']").click();

  // The page's live region is the announcement a screen reader hears, and it
  // carries the host's sentence verbatim.
  await expect(
    region.locator("[data-yunari-submissions-announcement]"),
    "the store's refusal is not what the live region says",
  ).toHaveText(REFUSAL);
  await expect(
    row.locator("[data-yunari-submission-action='unpublish']"),
    "a refused change moved the item's state",
  ).toBeVisible();
  await expect(
    row.locator("[data-yunari-store-status]"),
    "a refused change invented a state word",
  ).toHaveCount(0);
  expect(
    host.reads(),
    "a refused change re-read the listing it did not alter",
  ).toBe(1);
});
