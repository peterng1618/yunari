import { expect, type Locator, type Page, test } from "@playwright/test";
import { openPane } from "./editor-rail.js";
import { insert, openBlank, readScene } from "./rebuild-driver.js";
import { themeToken, typeStep } from "./shell-tokens.js";
import { isDesktopSurface } from "./surface.js";

/**
 * The Add pane, now the one surface the insertable list is reached from.
 *
 * These two journeys were `insert-popover.spec.ts`'s, carried over when the
 * header's Insert menu and the pane bar's `+` were deleted (the header rule: Insert lives
 * in the Add pane). Neither lost anything by the move — both already drove the
 * pane — and what the deleted file proved is kept: the pane offers the whole
 * `insertGroups()` list, and a card inserted from it arrives as a unit the tree
 * can name.
 *
 * The third case came here from the Add pane's deleted file section: local files
 * belong to the Assets pane, so the control it measures is
 * opened where it now lives.
 */

const EDITOR = "http://127.0.0.1:4174/";

/** The words neither half may be described by (spec `:537`). */
const REFUSED = ["fallback", "advanced", "basic", "simple", "expert"];

/** The pane that carries the insertable list. */
function addPane(page: Page): Locator {
  return page.locator('[data-yunari-panel="add"]');
}

test("the Add pane offers units and primitives, neither greyed, neither a fallback", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.goto(EDITOR);

  // The `+` chooser and the Insert menu both left, so the pane is now the one
  // surface the insert list is reached from. Its own copy is unchanged: units
  // and primitives, neither greyed.
  await openPane(page, "Add");
  const pane = addPane(page);
  await expect(pane).toBeVisible();
  for (const heading of ["Card", "Shape", "Chart"]) {
    await expect(pane.getByRole("group", { name: heading })).toBeVisible();
  }

  // Every control the pane offers is usable, whichever group it comes from.
  const controls = pane.getByRole("button");
  await expect(controls).not.toHaveCount(0);
  for (const item of await controls.all()) {
    await expect(item).toBeEnabled();
  }

  // Neither half is greyed, and neither is described as one.
  const spoken = await pane.locator("legend, button").allTextContents();
  for (const word of REFUSED) {
    expect(spoken.join(" ").toLowerCase()).not.toContain(word);
  }
});

test(`the Assets pane's import control takes control text, not the shell's ${themeToken("--text-md")} base`, async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.goto(EDITOR);
  await openPane(page, "Assets");

  // These boxes' text was *inherited*, not stated, so they took the shell
  // root's `--text-md`. The type scale gives control text `--text-sm`, and both plain-DOM
  // groups state it — as does this pane's own instances. The expected pair is
  // the stylesheet's own declaration, so the
  // row moves with the type scale rather than restating it.
  //
  // The import button is the Assets pane's now; the Add pane's file section
  // that used to carry it is deleted.
  const importButton = page.locator(
    '[data-yunari-panel="assets"] [data-yunari-asset-import]',
  );
  await expect(importButton).toBeVisible();
  await expect(importButton).toHaveCSS(
    "font-size",
    typeStep("--text-sm")["font-size"],
  );
  // The companion ratio for `--text-sm`, resolved the way the browser does.
  await expect(importButton).toHaveCSS(
    "line-height",
    typeStep("--text-sm")["line-height"],
  );
});

test("a card inserted from the Add pane arrives as a unit the tree can name", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.goto(EDITOR);

  // The starter already holds its own time card, so the inserted unit is the
  // Clock row the insert *adds* — counted rather than located by the id the
  // allocator mints (`card-library.ts`'s `COPY_PREFIX` prepends `card` to the
  // card's `group-time-card`). That id is the product's to choose, not the
  // spec's to restate (vg-170; the rule `composition-panel.spec.ts` states).
  await openPane(page, "Composition");
  const clocks = page.locator(".yunari-layer-role", { hasText: "Clock" });
  const before = await clocks.count();

  await openPane(page, "Add");
  await addPane(page)
    .getByRole("button", { name: "Clock", exact: true })
    .click();

  await openPane(page, "Composition");
  await expect(clocks).toHaveCount(before + 1);
});

test("the pane's two Lines are told apart by their group, not by which tile comes last", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.goto(EDITOR);
  await page.waitForFunction(() => "yunariEditorBridge" in window);
  await openBlank(page);

  // "Line" is a shape and a chart family, and both are in the pane at once. The
  // driver addresses a tile by the group the caller names (`vg-537`), so what
  // proves it is the inserted object's own kind. **Not the scene's count**: a
  // count grew either way, which is how a positional guess passed for a shape
  // insert while handing back the chart's Line.
  await insert(page, "Line", "shape");
  await insert(page, "Line", "chart");

  // The tags are Fabric's, and Fabric lowercases a class name — the same pair
  // `layer-tree.ts`'s `kindOf` tells apart ("Fabric type tags are lowercase
  // class names; the envelope keeps `YunariChart`").
  expect((await readScene(page)).map((object) => object.type)).toEqual([
    "line",
    "yunarichart",
  ]);
});
