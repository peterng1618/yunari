import { expect, type Locator, type Page, test } from "@playwright/test";
import { openPane } from "./editor-rail.js";
import { insert, openBlank, readScene } from "./rebuild-driver.js";
import { themeToken, typeStep } from "./shell-tokens.js";
import { isDesktopSurface } from "./surface.js";
import { stubWidgetPacks } from "./widget-packs-fixture.js";

/**
 * The Add and Widgets panes, the two surfaces the insertable lists are reached
 * from: the primitives in Add, the installed card units in Widgets.
 *
 * These journeys were `insert-popover.spec.ts`'s, carried over when the
 * header's Insert menu and the pane bar's `+` were deleted (the header rule: Insert lives
 * in the panes). Neither lost anything by the move — both already drove them —
 * and what the deleted file proved is kept: the panes offer the whole
 * `insertGroups()` and `widgetGroups()` lists, and a card inserted from them
 * arrives as a unit the tree can name.
 *
 * The third case came here from the Add pane's deleted file section: local files
 * belong to the Assets pane, so the control it measures is
 * opened where it now lives.
 */

const EDITOR = "http://127.0.0.1:4174/?mode=editor";

/** The preview has no host, so the Widgets pane's one source is answered here:
 *  the pack this product ships. */
test.beforeEach(async ({ page }) => {
  await stubWidgetPacks(page);
});

/** The words neither half may be described by (spec `:537`). "Basic" and
 *  "Custom" are the sections' own names, not a ranking. */
const REFUSED = ["fallback", "advanced", "simple", "expert"];

/** The pane that carries the insertable list. */
function addPane(page: Page): Locator {
  return page.locator('[data-yunari-panel="add"]');
}

test("the two insert panes offer units and primitives, neither greyed, neither a fallback", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.goto(EDITOR);

  // The `+` chooser and the Insert menu both left, so the panes are the
  // surfaces the insert lists are reached from. Their own copy is unchanged:
  // units and primitives, neither greyed.
  await openPane(page, "Add");
  const pane = addPane(page);
  await expect(pane).toBeVisible();
  for (const heading of ["Basic Shape", "Custom Shape", "Chart"]) {
    await expect(pane.getByRole("group", { name: heading })).toBeVisible();
  }

  // Every control a pane offers is usable, whichever group it comes from. Read
  // while that pane is the one showing: the rail shows one pane at a time, and
  // a hidden pane's buttons are not in the accessibility tree.
  const everyControl = async (surface: Locator): Promise<void> => {
    const controls = surface.getByRole("button");
    await expect(controls).not.toHaveCount(0);
    for (const item of await controls.all()) {
      await expect(item).toBeEnabled();
    }
  };
  await everyControl(pane);

  await openPane(page, "Widgets");
  const library = page.locator('[data-yunari-panel="widgets"]');
  await expect(library.getByRole("group", { name: "Card" })).toBeVisible();
  await everyControl(library);

  // Neither half is greyed, and neither is described as one.
  const spoken = await page
    .locator('[data-yunari-panel="add"], [data-yunari-panel="widgets"]')
    .locator("legend, button")
    .allTextContents();
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

test("a card inserted from the Widgets pane arrives as a unit the tree can name", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.goto(EDITOR);

  // The starter already holds its own time card, so the inserted unit is the
  // Clock row the insert *adds* — counted rather than located by the id the
  // allocator mints (`card-library.ts`'s `COPY_PREFIX` prepends `card` to the
  // card's `group-time-card`). That id is the product's to choose, not the
  // spec's to restate (vg-170; the rule `composition-panel.spec.ts` states).
  await openPane(page, "Layers");
  const clocks = page.locator(".yunari-layer-role", { hasText: "Clock" });
  const before = await clocks.count();

  await openPane(page, "Widgets");
  await page
    .locator('[data-yunari-panel="widgets"]')
    .getByRole("button", { name: "Clock", exact: true })
    .click();

  await openPane(page, "Layers");
  await expect(clocks).toHaveCount(before + 1);
});

test("a custom shape is a Path, and the chart's Line is told apart from it by its group", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.goto(EDITOR);
  await page.waitForFunction(() => "yunariEditorBridge" in window);
  await openBlank(page);

  // "Horizontal line" is the Path preset and "Line" is the chart family. The
  // driver addresses a tile by the group the caller names (`vg-537`), so what
  // proves it is the inserted object's own kind. **Not the scene's count**: a
  // count grew either way.
  await insert(page, "Horizontal line", "custom-shape");
  await insert(page, "Line", "chart");

  // A preset is data, not a class: it arrives as Fabric's `Path`. The chart is
  // still its own registered class.
  expect((await readScene(page)).map((object) => object.type)).toEqual([
    "path",
    "yunarichart",
  ]);
});
