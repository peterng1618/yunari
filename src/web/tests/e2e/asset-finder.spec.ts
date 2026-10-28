import { expect, type Locator, type Page, test } from "@playwright/test";
import type {
  AssetPage,
  AssetResult,
  AssetSearchAnswer,
  AssetSearchRequest,
  AssetSourceListing,
  FontCut,
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
 * and the font field that opens the finder on Fonts. Spec §12's claims are
 * asserted here against those fixtures.
 */

// A worktree whose preview server another session already owns on 4174 cannot
// rebuild it, so a run can point at its own bundle instead.
const EDITOR = process.env["YUNARI_EDITOR_URL"] ?? "http://127.0.0.1:4174/";

const lucide: AssetSourceListing = {
  id: "lucide",
  label: "Lucide",
  category: "icon",
  body: "grid",
  requires: null,
  configurable: true,
  presetKind: null,
  host: null,
};

const fontAwesome: AssetSourceListing = {
  id: "fontawesome-free",
  label: "Font Awesome Free",
  category: "icon",
  body: "grid",
  requires: null,
  configurable: true,
  presetKind: null,
  host: null,
};

const curatedFonts: AssetSourceListing = {
  id: "curated-fonts",
  label: "Curated fonts",
  category: "font",
  body: "font-picker",
  requires: null,
  configurable: false,
  presetKind: null,
  host: null,
};

const unsplash: AssetSourceListing = {
  id: "unsplash",
  label: "Unsplash",
  category: "image",
  body: "grid",
  requires: "unsplash",
  configurable: true,
  presetKind: null,
  host: "api.unsplash.com",
};

const colorSwoop: AssetSourceListing = {
  id: "colorswoop",
  label: "ColorSwoop",
  category: "colour",
  body: "grid",
  requires: null,
  configurable: true,
  presetKind: "palette",
  host: "colorswoop.com",
};

const uiGradients: AssetSourceListing = {
  id: "uigradients",
  label: "UI Gradients",
  category: "colour",
  body: "grid",
  requires: null,
  configurable: true,
  presetKind: "gradient",
  host: "raw.githubusercontent.com",
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

/** One curated family, which is all the Fonts grid needs to draw a tile. */
const fontResult: AssetResult = {
  id: "curated-fonts:cut:inter-400",
  name: "Inter",
  kind: "font",
  preview: "",
  subtitle: "sans · 1 cut",
  licence: "OFL-1.1",
  sourceUrl: "https://cdn.example/inter-400.woff2",
  font: {
    cuts: [
      {
        id: "cut:inter-400",
        source: "curated-fonts",
        family: "Inter",
        weight: 400,
        style: "normal",
        subset: "latin",
        format: "woff2",
        previewUrl: "https://cdn.example/inter-400.woff2",
        licence: "OFL-1.1",
        sourceUrl: "https://cdn.example/inter-400.woff2",
      },
    ],
  },
};

/** One provider cut, in the shape the host serves it. The specimen URLs are
 *  unroutable on purpose: the card asserts the family names, sizes and order it
 *  sets, not what the CDN would have drawn. */
const fontCut = (family: string, weight: number): FontCut => ({
  id: `cut:${family.toLowerCase().replace(/\s+/g, "-")}-${weight}`,
  source: "curated-fonts",
  family,
  weight,
  style: "normal",
  subset: "latin",
  format: "woff2",
  previewUrl: `https://cdn.example/${family}.woff2`,
  licence: "OFL-1.1",
  sourceUrl: `https://cdn.example/${family}.woff2`,
});

const interTrio: AssetResult = ((): AssetResult => {
  const heading = fontCut("Inter", 700);
  const body = fontCut("Poppins", 400);
  const mono = fontCut("Fira Code", 400);
  const name = "Inter — Inter + Poppins + Fira Code";
  return {
    id: "curated-fonts:trio:inter-poppins",
    name,
    kind: "font",
    preview: "",
    subtitle: "A description.",
    licence: "OFL-1.1",
    sourceUrl: heading.sourceUrl ?? "",
    font: {
      cuts: [heading, body, mono],
      trio: {
        id: "inter-poppins",
        name,
        description: "A description.",
        roles: { heading, body, mono },
      },
    },
  };
})();

const answered = (
  source: string,
  results: readonly AssetResult[],
  totalPages?: number,
): AssetPage => ({
  source,
  results,
  totalPages,
  failure: undefined,
});

/** The hex the preset store normalises a colour to, spelled from its channels:
 *  the design-token gate refuses a hex literal in a spec that opens the editor. */
const hexOf = (r: number, g: number, b: number): string =>
  `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;

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
    .locator("[data-yunari-finder-card]")
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-yunari-finder-card") ?? ""),
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
  const rows = page.locator("[data-yunari-finder-card]");
  // Each row names its source with the source's own mark, not a licence word.
  await expect(
    rows.nth(0).locator('[data-yunari-asset-source="lucide"]'),
  ).toHaveAttribute("aria-label", "Lucide");
  await expect(
    rows.nth(1).locator('[data-yunari-asset-source="fontawesome-free"]'),
  ).toHaveAttribute("aria-label", "Font Awesome Free");
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

  await expect(page.locator("[data-yunari-finder-card]")).toHaveCount(1);
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
          totalPages: 1,
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

test("an empty answer for a term reads as 'no results'", async ({
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
  await page.locator("[data-yunari-asset-search]").fill("zzz");

  await expect(dialog.locator("[data-yunari-asset-empty]")).toBeVisible();
  await expect(dialog.locator("[data-yunari-asset-empty]")).toContainText(
    "No results",
  );
});

test("scrolling to the end appends the next page and no pager exists", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  const { searches } = await stubAssets(page, {
    sources: [lucide],
    answer: (request) => {
      const pageNo = request.pages["lucide"] ?? 1;
      return {
        pages: [
          answered(
            "lucide",
            Array.from({ length: 40 }, (_, at) =>
              result(`lucide:${pageNo}-${at}`),
            ),
            2,
          ),
        ],
      };
    },
  });
  const dialog = await openFinder(page);
  // The feed says it has two pages; the first answer's rows are on screen and
  // the second page is not asked for until the reader reaches the sentinel.
  await expect.poll(() => rowIds(page)).toContain("lucide:1-0");
  await expect(dialog.locator("[data-yunari-asset-pager]")).toHaveCount(0);
  await dialog.locator("[data-yunari-finder-grid]").evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect.poll(() => rowIds(page)).toHaveLength(80);
  expect(searches.at(-1)?.pages).toEqual({ lucide: 2 });
  // An appended page adds to the answer; it never replaces it.
  expect(await rowIds(page)).toContain("lucide:1-0");
});

test("a keyed source's failure names itself and offers Connections while the other source answers", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  const keyedIcons: AssetSourceListing = {
    ...lucide,
    id: "keyed-icons",
    label: "Keyed Icons",
    requires: "unsplash",
  };
  await stubAssets(page, {
    sources: [lucide, keyedIcons, colorSwoop],
    answer: (request) =>
      request.enabled.includes("colorswoop")
        ? { pages: [answered("colorswoop", [])] }
        : {
            pages: [
              answered("lucide", [result("lucide:house")]),
              {
                source: "keyed-icons",
                results: [],
                totalPages: undefined,
                failure: { reason: "needs-credential", credential: "unsplash" },
              },
            ],
          },
  });
  const dialog = await openFinder(page);

  await expect.poll(() => rowIds(page)).toEqual(["lucide:house"]);
  await expect(dialog.locator("[data-yunari-asset-status]")).toContainText(
    "needs a key",
  );
  await expect(
    dialog.locator(
      '[data-yunari-asset-chip="keyed-icons"] [data-yunari-asset-chip-failed]',
    ),
  ).toHaveCount(1);
  await expect(dialog.locator("[data-yunari-asset-connections]")).toBeVisible();

  // A tab whose sources need no key has nothing Connections could fix.
  await page.locator('[data-yunari-asset-tab="colour"]').click();
  await expect.poll(() => rowIds(page)).toEqual([]);
  await expect(dialog.locator("[data-yunari-asset-connections]")).toHaveCount(
    0,
  );
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

test("a late answer never lands in the tab that was left", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  const { searches } = await stubAssets(page, {
    sources: [lucide, colorSwoop],
    answer: async (request) => {
      if (request.enabled.includes("colorswoop")) {
        return { pages: [answered("colorswoop", [])] };
      }
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
  await expect.poll(() => searches.length).toBe(1);

  // Leave the tab while its answer is still out, then come back and ask a new
  // question: the abandoned answer belongs to neither.
  await page.locator('[data-yunari-asset-tab="colour"]').click();
  await expect.poll(() => searches.length).toBe(2);
  await page.locator('[data-yunari-asset-tab="icon"]').click();
  await search.fill("ab");
  await expect.poll(() => searches.length).toBe(3);

  await expect.poll(() => rowIds(page)).toEqual(["lucide:newer"]);
  await page.waitForTimeout(1200);
  expect(await rowIds(page)).toEqual(["lucide:newer"]);
});

test("an action reaches busy and then its outcome", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.route("**/api/assets/bytes*", async (route) => {
    await new Promise((settle) => setTimeout(settle, 500));
    await route.fulfill({
      status: 200,
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10 12 3l9 7"/></svg>',
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
  await page.locator("[data-yunari-finder-card]").first().click();
  const primary = dialog.locator("[data-yunari-asset-action]");
  await primary.click();

  await expect(primary).toHaveAttribute("data-yunari-asset-action-busy", "");
  await expect(primary).toContainText("Placing…");
  await expect(primary).toBeDisabled();
  await expect(dialog.locator("[data-yunari-asset-status]")).toHaveAttribute(
    "data-tone",
    "ok",
  );
  await expect(primary).not.toHaveAttribute(
    "data-yunari-asset-action-busy",
    "",
  );
  await expect(primary).toBeEnabled();
});

test("a failed action says so in the status line and returns the button", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.route("**/api/assets/bytes*", (route) =>
    route.fulfill({ status: 500 }),
  );
  await stubAssets(page, {
    sources: [lucide],
    answer: () => ({
      pages: [answered("lucide", [result("lucide:house")])],
    }),
  });
  const dialog = await openFinder(page);
  await page.locator("[data-yunari-finder-card]").first().click();
  const primary = dialog.locator("[data-yunari-asset-action]");
  await primary.click();

  await expect(dialog.locator("[data-yunari-asset-status]")).toHaveAttribute(
    "data-tone",
    "failed",
  );
  await expect(dialog.locator("[data-yunari-asset-status]")).toContainText(
    "did not send",
  );
  await expect(primary).toBeEnabled();
});

test("a pending search says it is searching before it counts results", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await stubAssets(page, {
    sources: [lucide],
    answer: async () => {
      await new Promise((settle) => setTimeout(settle, 400));
      return { pages: [answered("lucide", [result("lucide:house")])] };
    },
  });
  const dialog = await openFinder(page);
  const status = dialog.locator("[data-yunari-asset-status]");
  await expect(status).toContainText("Searching");
  await expect(status).toContainText("1 result");
});

test("the Images tab draws photos on open and asks with no term", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  const { searches } = await stubAssets(page, {
    sources: [unsplash],
    answer: () => ({
      pages: [
        answered(
          "unsplash",
          [
            {
              ...result("unsplash:photo-1"),
              kind: "image",
              name: "A photo",
              preview: "https://images.example/1.jpg",
              subtitle: "A Photographer",
              licence: "Unsplash License",
              sourceUrl: "https://unsplash.com/p/1",
            },
          ],
          4,
        ),
      ],
    }),
  });
  const dialog = await openFinder(page);
  await dialog.locator('[data-yunari-asset-tab="image"]').click();

  await expect.poll(() => rowIds(page)).toEqual(["unsplash:photo-1"]);
  expect(await page.locator("[data-yunari-asset-search]").inputValue()).toBe(
    "",
  );
  // The browse is a real request: it is the host's feed, asked with no term.
  expect(searches.at(-1)?.query).toBe("");
});

test("the Images tab says a key is missing instead of drawing an empty grid", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await stubAssets(page, {
    sources: [unsplash],
    answer: () => ({
      pages: [
        {
          source: "unsplash",
          results: [],
          totalPages: undefined,
          failure: { reason: "needs-credential", credential: "unsplash" },
        },
      ],
    }),
  });
  const dialog = await openFinder(page);
  await dialog.locator('[data-yunari-asset-tab="image"]').click();

  await expect(dialog.locator("[data-yunari-asset-status]")).toContainText(
    "needs a key",
  );
  await expect(dialog.locator("[data-yunari-asset-connections]")).toBeVisible();
});

test("a source with nothing to browse says so, not 'no results'", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await stubAssets(page, {
    sources: [unsplash],
    answer: () => ({ pages: [answered("unsplash", [], 1)] }),
  });
  const dialog = await openFinder(page);
  await dialog.locator('[data-yunari-asset-tab="image"]').click();

  await expect(dialog.locator("[data-yunari-asset-nothing]")).toBeVisible();
  await expect(dialog.locator("[data-yunari-asset-empty]")).toHaveCount(0);
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

test("the font field opens the finder on Fonts", async ({ page }, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await stubAssets(page, {
    sources: [curatedFonts],
    answer: () => ({ pages: [answered("curated-fonts", [fontResult])] }),
  });
  await page.goto(EDITOR);
  await page.waitForFunction(() => "yunariEditorBridge" in window);
  await placeText(page);
  // The field below belongs to a text selection, so the placed object has to be
  // the text class that carries runs.
  expect((await readScene(page)).at(-1)?.type).toBe("i-text");

  // The inspector's own column, not the whole shell: the font body lives in
  // the finder once it is open, and the claim is about this surface.
  const column = page.locator('[data-yunari-panel="selection"]');
  const field = column.locator("[data-yunari-open-font-picker]").first();
  await expect(field).toBeVisible();

  await field.click();

  await expect(page.getByRole("dialog", { name: "Assets" })).toBeVisible();
  await expect(page.locator('[data-yunari-asset-tab="font"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // The Fonts pane browses on open: the grid is what it draws, no term needed.
  await expect(page.locator("[data-yunari-asset-grid]")).toBeVisible();
  await expect(
    page.locator(`[data-yunari-finder-card="${fontResult.id}"]`),
  ).toBeVisible();
});

test("the Fonts tab draws a trio grid on open", async ({ page }, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await stubAssets(page, {
    sources: [curatedFonts],
    answer: () => ({
      pages: [answered("curated-fonts", [interTrio, fontResult])],
    }),
  });
  await openFinder(page);
  await page.locator('[data-yunari-asset-tab="font"]').click();

  // Nothing is typed: selecting the tab is an empty-term browse, and every
  // answer is one shared card.
  await expect(page.locator("[data-yunari-asset-search]")).toHaveValue("");
  await expect(page.locator("[data-yunari-asset-grid]")).toBeVisible();
  await expect(page.locator("[data-yunari-finder-card]")).toHaveCount(2);
  await expect(
    page.locator(`[data-yunari-finder-card="${interTrio.id}"]`),
  ).toBeVisible();
});

test("draws a font card's specimen rows in the result's own faces", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await stubAssets(page, {
    sources: [curatedFonts],
    answer: () => ({
      pages: [answered("curated-fonts", [interTrio, fontResult])],
    }),
  });
  await openFinder(page);
  await page.locator('[data-yunari-asset-tab="font"]').click();
  await expect(page.locator("[data-yunari-asset-grid]")).toBeVisible();

  const trioRows = page.locator(
    `[data-yunari-finder-card="${interTrio.id}"] [data-yunari-asset-preview="font"] > span`,
  );
  await expect(trioRows).toHaveCount(3);
  await expect(trioRows).toHaveText([
    interTrio.name,
    interTrio.name,
    interTrio.name,
  ]);
  // Heading, body and mono are drawn at descending sizes, which is what makes
  // the thumbnail read as the hierarchy the trio itself makes.
  const sizes = await trioRows.evaluateAll((rows) =>
    rows.map((row) => Number.parseFloat(getComputedStyle(row).fontSize)),
  );
  expect(sizes[0]!).toBeGreaterThan(sizes[1]!);
  expect(sizes[1]!).toBeGreaterThan(sizes[2]!);

  const familyRows = page.locator(
    `[data-yunari-finder-card="${fontResult.id}"] [data-yunari-asset-preview="font"] > span`,
  );
  await expect(familyRows).toHaveText(["Inter"]);
});

test("captures the finder on Fonts", async ({ page }, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await stubAssets(page, {
    sources: [curatedFonts],
    answer: () => ({ pages: [answered("curated-fonts", [fontResult])] }),
  });
  await openFinder(page);
  await page.locator('[data-yunari-asset-tab="font"]').click();
  await expect(page.locator("[data-yunari-asset-grid]")).toBeVisible();

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
  await expect(page.locator("[data-yunari-finder-card]")).toHaveCount(4);

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
          totalPages: 1,
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
  await page.locator("[data-yunari-finder-card]").first().click();
  await page.locator("[data-yunari-asset-action]").click();

  // The grid's id is `<source>:<entry>`, which is what the host must accept.
  await expect.poll(() => asked.length).toBe(1);
  expect(decodeURIComponent(asked[0] ?? "")).toContain("id=lucide:house");
  // A refusal would print the reason beside the count; a successful import
  // leaves none.
  await expect(dialog.locator("[data-yunari-asset-status]")).not.toContainText(
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

test("the Colours tab adds a palette to the presets", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  // A preset is data, not an imported asset: a bytes request would be the bug.
  let bytesAsked = 0;
  await page.route("**/api/assets/bytes*", async (route) => {
    bytesAsked += 1;
    await route.fulfill({ status: 404 });
  });
  const { searches } = await stubAssets(page, {
    sources: [colorSwoop, uiGradients],
    // Only the filtered question — exactly the palette source — answers rows:
    // an answer that outlived the filter would let the row and the action be
    // read before the filter's own answer had landed.
    answer: (request) =>
      request.enabled.length === 1 && request.enabled[0] === "colorswoop"
        ? {
            pages: [
              answered("colorswoop", [
                {
                  ...result("colorswoop:one", "Cloud Dancer"),
                  kind: "palette",
                  licence: "unknown",
                  sourceUrl: "https://colorswoop.com/",
                  preset: {
                    kind: "palette",
                    colours: [hexOf(17, 34, 51), hexOf(68, 85, 102)],
                  },
                },
              ]),
              answered("uigradients", []),
            ],
          }
        : {
            pages: [answered("colorswoop", []), answered("uigradients", [])],
          },
  });
  await openFinder(page);
  await page.locator('[data-yunari-asset-tab="colour"]').click();
  // The filter is which source answers, not which rows are hidden: a palette
  // question never reaches the gradient source.
  await page.locator('[data-yunari-asset-kind="palette"]').click();
  await expect
    .poll(() => searches.at(-1)?.enabled ?? [])
    .toEqual(["colorswoop"]);

  const row = page.locator('[data-yunari-finder-card="colorswoop:one"]');
  await expect(row).toBeVisible();
  await row.click();
  await page.locator('[data-yunari-asset-action=""]').click();

  // The action says what landed, in the bar the count already lives in.
  await expect(page.locator("[data-yunari-asset-message]")).toHaveText(
    "Added 2 colours",
  );

  const stored = await page.evaluate(() =>
    localStorage.getItem("yunari.editor.presets"),
  );
  expect(stored).toContain(hexOf(17, 34, 51));
  expect(stored).toContain(hexOf(68, 85, 102));
  expect(bytesAsked).toBe(0);
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
          totalPages: 1,
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

test("the finder is centred and the chosen tab is drawn as chosen", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await stubAssets(page, {
    sources: [lucide],
    answer: () => ({ pages: [answered("lucide", [result("lucide:house")])] }),
  });
  const dialog = await openFinder(page);
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error("no viewport.");
  const box = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  expect(
    Math.abs(box.x + box.width / 2 - viewport.width / 2),
  ).toBeLessThanOrEqual(2);
  expect(
    Math.abs(box.y + box.height / 2 - viewport.height / 2),
  ).toBeLessThanOrEqual(2);
  // The 1px border is inside the box because every surface is border-box.
  expect(
    Math.abs(box.width - Math.min(1180, viewport.width - 48)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(box.height - Math.min(800, viewport.height - 48)),
  ).toBeLessThanOrEqual(1);

  const chosen = page.locator('[data-yunari-asset-tab="icon"]');
  const other = page.locator('[data-yunari-asset-tab="font"]');
  const chosenPaint = await chosen.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      underline: style.borderBottomColor,
    };
  });
  const otherPaint = await other.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(chosenPaint.background).not.toBe(otherPaint);
  expect(chosenPaint.underline).not.toBe("rgba(0, 0, 0, 0)");
});

test("a phone viewport gives the finder the whole window", async ({
  page,
}, testInfo) => {
  test.skip(isDesktopSurface(testInfo), "the phone project owns this reading");

  await stubAssets(page, {
    sources: [lucide],
    answer: () => ({ pages: [answered("lucide", [result("lucide:house")])] }),
  });
  const dialog = await openFinder(page);
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  if (box === null || viewport === null) throw new Error("no box.");
  expect(box.width).toBe(viewport.width);
  expect(box.height).toBe(viewport.height);
  await expect(dialog.getByRole("button", { name: "Close" })).toBeVisible();
});

test("a card raises its edge on hover and the chosen card is accented", async ({
  page,
}, testInfo) => {
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
  const card = page.locator('[data-yunari-finder-card="lucide:house"]');
  const other = page.locator('[data-yunari-finder-card="lucide:star"]');
  const borderColour = () =>
    card.evaluate((node) => getComputedStyle(node).borderColor);

  const resting = await borderColour();
  await card.hover();
  await expect.poll(borderColour).not.toBe(resting);

  await card.click();
  await expect(card).toHaveAttribute("aria-selected", "true");
  await expect(card).toHaveClass(/border-accent/);
  await expect(other).not.toHaveClass(/border-accent/);
});
