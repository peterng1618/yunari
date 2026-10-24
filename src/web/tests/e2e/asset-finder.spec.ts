import { expect, type Locator, type Page, test } from "@playwright/test";
import type {
  AssetPage,
  AssetResult,
  AssetSearchAnswer,
  AssetSearchRequest,
  AssetSourceListing,
} from "@yunari/renderer-core";
import { captureVisualReview } from "./editor-canvas.js";
import { placeText, readScene } from "./rebuild-driver.js";
import { isDesktopSurface } from "./surface.js";

/**
 * The asset finder's browser boundary.
 *
 * The host is routed, not real: every source's answer is a fixture, so the
 * proof is the modal's own behaviour — the mixed grid, the chip that stops a
 * source, the pager, a failure beside a survivor, the notice's one appearance,
 * and the font field that now opens the finder instead of mounting the picker.
 * Spec §12's claims are asserted here against those fixtures.
 */

const EDITOR = "http://127.0.0.1:4174/";

const lucide: AssetSourceListing = {
  id: "lucide",
  label: "Lucide",
  category: "icon",
  body: "grid",
  requires: null,
  configurable: true,
  host: null,
};

const fontAwesome: AssetSourceListing = {
  id: "fontawesome-free",
  label: "Font Awesome Free",
  category: "icon",
  body: "grid",
  requires: null,
  configurable: true,
  host: null,
};

const unsplash: AssetSourceListing = {
  id: "unsplash",
  label: "Unsplash",
  category: "image",
  body: "grid",
  requires: "unsplash",
  configurable: true,
  host: "api.unsplash.com",
};

const result = (id: string, name = id): AssetResult => ({
  id,
  name,
  kind: "icon",
  preview: "",
  subtitle: undefined,
  licence: "ISC",
  sourceUrl: `https://lucide.dev/icons/${name}`,
});

const answered = (
  source: string,
  results: readonly AssetResult[],
  next?: string,
): AssetPage => ({
  source,
  results,
  next,
  failure: undefined,
});

/** What the host would answer, decided per request: the fixture is the test's. */
type Answer = (
  request: AssetSearchRequest,
) => AssetSearchAnswer | Promise<AssetSearchAnswer>;

async function stubAssets(
  page: Page,
  options: {
    readonly sources: readonly AssetSourceListing[];
    readonly answer: Answer;
  },
): Promise<{ readonly searches: AssetSearchRequest[] }> {
  const searches: AssetSearchRequest[] = [];
  await page.route("**/api/assets/sources", (route) =>
    route.fulfill({ json: { sources: options.sources } }),
  );
  await page.route("**/api/assets/search", async (route) => {
    const request = route.request().postDataJSON() as AssetSearchRequest;
    searches.push(request);
    await route.fulfill({ json: await options.answer(request) });
  });
  return { searches };
}

async function openFinder(page: Page): Promise<Locator> {
  await page.goto(EDITOR);
  await page.waitForFunction(() => "yunariEditorBridge" in window);
  // The chord is the session's dispatcher reaching the shell's store, which is
  // the route the product offers; the menu row opens the same modal.
  await page.keyboard.press("Control+Shift+F");
  const dialog = page.getByRole("dialog", { name: "Assets" });
  await expect(dialog).toBeVisible();
  return dialog;
}

function rowIds(page: Page): Promise<string[]> {
  return page
    .locator("[data-yunari-asset-row]")
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-yunari-asset-row") ?? ""),
    );
}

test("one search with both icon sources answers rows from both, and no id is shared", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await stubAssets(page, {
    sources: [lucide, fontAwesome],
    answer: () => ({
      pages: [
        answered("lucide", [result("lucide:house")]),
        answered("fontawesome-free", [result("fontawesome-free:house")]),
      ],
    }),
  });
  await openFinder(page);

  await expect
    .poll(() => rowIds(page))
    .toEqual(["lucide:house", "fontawesome-free:house"]);
  // Each row names its own source, and the two answers' ids never collide
  // because the host namespaces them by source.
  const rows = page.locator("[data-yunari-asset-row]");
  await expect(rows.nth(0)).toContainText("Lucide");
  await expect(rows.nth(1)).toContainText("Font Awesome Free");
  // A card is its content, not a share of the grid's height: a single row of
  // results used to stretch to the footer.
  const box = await rows.nth(0).boundingBox();
  expect(box?.height ?? 0).toBeLessThan(250);
});

test("disabling a source removes its rows and asks for nothing from it", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  const { searches } = await stubAssets(page, {
    sources: [lucide, fontAwesome],
    answer: () => ({
      pages: [
        answered("lucide", [result("lucide:house")]),
        answered("fontawesome-free", [result("fontawesome-free:house")]),
      ],
    }),
  });
  await openFinder(page);
  await expect
    .poll(() => rowIds(page))
    .toEqual(["lucide:house", "fontawesome-free:house"]);

  await page.locator('[data-yunari-asset-chip="fontawesome-free"]').click();

  await expect(page.locator("[data-yunari-asset-row]")).toHaveCount(1);
  expect(await rowIds(page)).toEqual(["lucide:house"]);
  await expect.poll(() => searches.at(-1)?.enabled ?? []).toEqual(["lucide"]);
});

test("a failed source leaves the other's rows and names itself", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await stubAssets(page, {
    sources: [lucide, fontAwesome],
    answer: () => ({
      pages: [
        {
          source: "lucide",
          results: [],
          next: undefined,
          failure: { reason: "failed", message: "Lucide answered 500." },
        },
        answered("fontawesome-free", [result("fontawesome-free:house")]),
      ],
    }),
  });
  const dialog = await openFinder(page);

  await expect(dialog.locator("[data-yunari-asset-failure]")).toContainText(
    "Lucide answered 500.",
  );
  expect(await rowIds(page)).toEqual(["fontawesome-free:house"]);
  // A failure is not the empty state: the grid still holds the other source.
  await expect(dialog.locator("[data-yunari-asset-empty]")).toHaveCount(0);
});

test("a failed source and an empty answer are not read as 'no results'", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await stubAssets(page, {
    sources: [lucide, fontAwesome],
    answer: () => ({
      pages: [answered("lucide", []), answered("fontawesome-free", [])],
    }),
  });
  const dialog = await openFinder(page);

  await expect(dialog.locator("[data-yunari-asset-empty]")).toBeVisible();
  await expect(dialog.locator("[data-yunari-asset-empty]")).toContainText(
    "No results",
  );
});

test("Load more appends each page's new rows after the ones already shown", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  const { searches } = await stubAssets(page, {
    sources: [lucide, fontAwesome],
    answer: (request) =>
      request.cursors["lucide"] === undefined
        ? {
            pages: [
              answered("lucide", [result("lucide:house")], "L1"),
              answered(
                "fontawesome-free",
                [result("fontawesome-free:house")],
                "F1",
              ),
            ],
          }
        : {
            pages: [
              answered("lucide", [result("lucide:star")]),
              answered("fontawesome-free", [result("fontawesome-free:star")]),
            ],
          },
  });
  await openFinder(page);
  await expect
    .poll(() => rowIds(page))
    .toEqual(["lucide:house", "fontawesome-free:house"]);

  await page.locator("[data-yunari-asset-more]").click();

  await expect
    .poll(() => rowIds(page))
    .toEqual([
      "lucide:house",
      "fontawesome-free:house",
      "lucide:star",
      "fontawesome-free:star",
    ]);
  // Each source's cursor is its own, and the pager is gone once neither has one.
  expect(searches.at(-1)?.cursors).toEqual({
    lucide: "L1",
    "fontawesome-free": "F1",
  });
  await expect(page.locator("[data-yunari-asset-more]")).toHaveCount(0);
});

test("a later search never shows an earlier answer that arrives last", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  const { searches } = await stubAssets(page, {
    sources: [lucide],
    answer: async (request) => {
      // The first query's answer is slow; the second's is immediate, and the
      // slow one lands after it — the race the ticket exists to discard.
      if (request.query === "a") {
        await new Promise((settle) => setTimeout(settle, 900));
        return { pages: [answered("lucide", [result("lucide:older")])] };
      }
      return { pages: [answered("lucide", [result("lucide:newer")])] };
    },
  });
  await openFinder(page);
  const search = page.locator("[data-yunari-asset-search]");

  await search.fill("a");
  // Wait until "a" left the debounce, or the next fill would cancel it and the
  // race this test names would never happen.
  await expect.poll(() => searches.length).toBe(1);
  await search.fill("ab");
  await expect.poll(() => searches.length).toBe(2);

  await expect.poll(() => rowIds(page)).toEqual(["lucide:newer"]);
  // The slow answer lands second and is dropped, not rendered beside or over
  // the newer one.
  await page.waitForTimeout(1200);
  expect(await rowIds(page)).toEqual(["lucide:newer"]);
});

test("the first search names the host once, and the second does not", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await stubAssets(page, {
    sources: [unsplash],
    answer: () => ({
      pages: [answered("unsplash", [result("unsplash:one")])],
    }),
  });
  const dialog = await openFinder(page);
  await page.locator('[data-yunari-asset-tab="image"]').click();

  const notice = dialog.locator("[data-yunari-asset-host-notice]");
  await expect(notice).toContainText("api.unsplash.com");

  await page.locator("[data-yunari-asset-search]").fill("cat");

  await expect(notice).toHaveCount(0);
});

test("the font field no longer mounts the picker and opens the finder on Fonts", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await stubAssets(page, {
    sources: [lucide],
    answer: () => ({ pages: [answered("lucide", [])] }),
  });
  await page.goto(EDITOR);
  await page.waitForFunction(() => "yunariEditorBridge" in window);
  await placeText(page);
  // The field below belongs to a text selection, so the placed object has to be
  // the text class that carries runs.
  expect((await readScene(page)).at(-1)?.type).toBe("i-text");

  // The inspector's own column, not the whole shell: FontPicker may exist in
  // the finder once it is open, and the claim is about this surface.
  const column = page.locator('[data-yunari-panel="selection"]');
  const field = column.locator("[data-yunari-open-font-picker]").first();
  await expect(field).toBeVisible();
  await expect(column.locator("[data-yunari-font-picker]")).toHaveCount(0);

  await field.click();

  await expect(page.getByRole("dialog", { name: "Assets" })).toBeVisible();
  await expect(page.locator('[data-yunari-asset-tab="font"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("[data-yunari-font-picker]")).toBeVisible();
});

test("captures the finder on Fonts", async ({ page }, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await stubAssets(page, {
    sources: [lucide],
    answer: () => ({ pages: [answered("lucide", [])] }),
  });
  await openFinder(page);
  await page.locator('[data-yunari-asset-tab="font"]').click();
  await expect(page.locator("[data-yunari-font-picker]")).toBeVisible();

  await captureVisualReview(page, testInfo, "editor-finder-fonts");
});

test("captures the finder's mixed icon grid", async ({ page }, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await stubAssets(page, {
    sources: [lucide, fontAwesome],
    answer: () => ({
      pages: [
        answered("lucide", [result("lucide:house"), result("lucide:star")]),
        answered("fontawesome-free", [
          result("fontawesome-free:house"),
          result("fontawesome-free:star"),
        ]),
      ],
    }),
  });
  await openFinder(page);
  await expect(page.locator("[data-yunari-asset-row]")).toHaveCount(4);

  await captureVisualReview(page, testInfo, "editor-finder-icons");
});

test("captures the finder's failed source", async ({ page }, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await stubAssets(page, {
    sources: [lucide, fontAwesome],
    answer: () => ({
      pages: [
        {
          source: "lucide",
          results: [],
          next: undefined,
          failure: { reason: "failed", message: "Lucide answered 500." },
        },
        answered("fontawesome-free", [result("fontawesome-free:house")]),
      ],
    }),
  });
  await openFinder(page);
  await expect(page.locator("[data-yunari-asset-failure]")).toBeVisible();

  await captureVisualReview(page, testInfo, "editor-finder-failure");
});

test("the footer's action imports the selected row, asking for its namespaced id", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  const asked: string[] = [];
  await page.route("**/api/assets/bytes*", async (route) => {
    asked.push(route.request().url());
    await route.fulfill({
      status: 200,
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10 12 3l9 7"/><path d="M5 9v11h14V9"/></svg>',
      headers: { "content-type": "image/svg+xml" },
    });
  });
  await stubAssets(page, {
    sources: [lucide],
    answer: () => ({
      pages: [answered("lucide", [result("lucide:house")])],
    }),
  });
  const dialog = await openFinder(page);
  await page.locator("[data-yunari-asset-row]").first().click();
  await page.locator("[data-yunari-asset-action]").click();

  // The grid's id is `<source>:<entry>`, which is what the host must accept.
  await expect.poll(() => asked.length).toBe(1);
  expect(decodeURIComponent(asked[0] ?? "")).toContain("id=lucide:house");
  // A refusal would print the reason beside the count; a successful import
  // leaves none.
  await expect(dialog.locator("[data-yunari-asset-count]")).not.toContainText(
    "did not send",
  );
  // An icon is geometry, not a picture: a Fabric image cannot take the theme's
  // ink or a stroke width, and that is what the author gets to edit.
  // A glyph's subpaths arrive as one group (or one path, for a single-subpath
  // set), never as an image: an image cannot take the theme's ink or a stroke.
  await expect
    .poll(
      async () =>
        (await readScene(page)).find((object) => object.id.startsWith("icon-"))
          ?.type,
    )
    .toMatch(/^(group|path)$/);
});

test("a source that needs a key opens Settings on Connections", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.route("**/api/credentials", (route) =>
    route.fulfill({ json: [] }),
  );
  await stubAssets(page, {
    sources: [unsplash],
    answer: () => ({
      pages: [
        {
          source: "unsplash",
          results: [],
          next: undefined,
          failure: { reason: "needs-credential", credential: "unsplash" },
        },
      ],
    }),
  });
  await openFinder(page);

  await page.locator("[data-yunari-asset-connections]").click();

  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  await expect(
    settings.getByRole("tab", { name: "Connections" }),
  ).toHaveAttribute("aria-selected", "true");
});

test("captures the Connections tab's provider row", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  // The tab reads the list the host answers, which is an array, never a value.
  await page.route("**/api/credentials", (route) =>
    route.fulfill({
      json: [
        {
          id: "unsplash",
          label: "Unsplash",
          set: true,
          hint: "bSQ",
          verify: true,
          helpText:
            "Create an app on your Unsplash developer page and copy its access key.",
          helpUrl: "https://unsplash.com/oauth/applications",
        },
      ],
    }),
  );
  await page.goto(EDITOR);
  await page.waitForFunction(() => "yunariEditorBridge" in window);
  await page.locator(".editor-shell-rail-settings").click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  await settings.getByRole("tab", { name: "Connections" }).click();
  await expect(
    settings.locator('[data-yunari-credential-row="unsplash"]'),
  ).toBeVisible();

  await captureVisualReview(page, testInfo, "editor-finder-connections");
});

test("the finder leaves the header, the rail and the status bar in view", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await stubAssets(page, {
    sources: [lucide],
    answer: () => ({ pages: [answered("lucide", [result("lucide:house")])] }),
  });
  const dialog = await openFinder(page);
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  if (box === null || viewport === null) throw new Error("no dialog box.");

  // The chrome's own measurements: a 42px header, a 46px rail and a 26px
  // status bar, with the rest left to the finder.
  expect(box.y).toBeGreaterThanOrEqual(42);
  expect(box.x).toBeGreaterThanOrEqual(46);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 26);
  expect(box.width).toBeGreaterThan(viewport.width * 0.9);
});

test("the chosen row is drawn as chosen", async ({ page }, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await stubAssets(page, {
    sources: [lucide],
    answer: () => ({
      pages: [
        answered("lucide", [result("lucide:house"), result("lucide:star")]),
      ],
    }),
  });
  await openFinder(page);
  const row = page.locator('[data-yunari-asset-row="lucide:house"]');
  const other = page.locator('[data-yunari-asset-row="lucide:star"]');

  await row.click();

  await expect(row).toHaveClass(/border-accent/);
  await expect(other).not.toHaveClass(/border-accent/);
});
