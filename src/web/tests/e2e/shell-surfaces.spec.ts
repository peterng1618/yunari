import { expect, test } from "@playwright/test";
import { selectLayer } from "./rebuild-driver.js";
import { choosePalette, openShell, PALETTES } from "./shell-palette.js";
import { isDesktopSurface } from "./surface.js";

/**
 * The hand-owned surfaces the palette has to reach anyway.
 *
 * **The dialogs are React now.** The three `<dialog>` factories
 * (`new-document-chooser`, `persistence-manager/`, `theme-library-dialog`) are
 * Base UI `Dialog`s portalled to `body`, so each is a surface a shell token has
 * to reach through the portal rather than through a `<dialog>` in the top layer
 * — the reason this file still opens one and reads its paint.
 *
 * The inspector's sections **are** React too (`components/ui/inspector-section.tsx`),
 * and this file still reads them — a palette has to reach a section header
 * whether it is painted by a class or by a token, and this is the one place
 * that is checked in a browser.
 *
 * They are also the surfaces a palette change is most likely to break, because
 * each paints from the shell's tokens through a class rather than through the
 * attribute — and a `Dialog` in the top layer is not a descendant of `#app`, so
 * it is the layer most likely to miss. This file exists to pin what the palette
 * pipeline reaches, in a browser, where the cascade is real.
 *
 * Split from `shell-appearance.spec.ts` rather than appended to it: that file
 * carries the pipeline, this one carries what the pipeline reaches, and together
 * they would have passed the 500-line signal the repo uses for a source file.
 */

test("the dialogs and the inspector's sections paint every palette", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  test.setTimeout(120_000);

  await openShell(page);

  // Selected once rather than per palette: the column only renders sections for
  // a selection, and with nothing selected it correctly says where to choose
  // from instead — which is a different assertion, not this one. A top-level
  // group, because the starter's cards are nested inside these and a collapsed
  // row is not a clickable one.
  //
  // The column needs no pane opened: unlike Composition and Add it is not a
  // slot of the rail, it is the right column and is always mounted.
  await selectLayer(page, "group-cpu-card");
  // The section is plan 1's `InspectorSection`: a `<section>` carrying
  // `data-yunari-section`, whose header — the thing painted from the shell's
  // tokens — is a button.
  //
  // **Scoped to the column, because `[data-yunari-section]` alone is not the
  // column's.** The Document pane renders its own sections from the same
  // component (plan 4 Task 8), and it is a rail slot this test never opens, so
  // an unscoped `.first()` resolved to a *hidden* `theme` section inside it and
  // the assertion below could never see the column at all.
  const section = page
    .locator(".editor-shell-inspector [data-yunari-section]")
    .first();
  await expect(section).toBeVisible();

  for (const palette of PALETTES) {
    await choosePalette(page, palette);

    // The New-theme chooser, opened the way an author opens it and closed with
    // Escape. It is a Base UI `Dialog` portalled to the top layer, so it is the
    // one place a shell token can be in force and still not reach the surface
    // drawn from it.
    await page.getByRole("button", { name: "New theme", exact: true }).click();
    const dialog = page.locator('[role="dialog"]', {
      hasText: "Choose an artboard size",
    });
    await expect(dialog).toBeVisible();
    const dialogPaints = await dialog.evaluate((node) => {
      const style = getComputedStyle(node);
      return `${style.backgroundColor}|${style.color}`;
    });
    expect(
      dialogPaints,
      `the ${palette} chooser painted neither a surface nor an ink`,
    ).not.toBe("|");
    expect(
      dialogPaints,
      `the ${palette} chooser paints a different surface from the chrome that opened it`,
    ).toBe(await shellHeaderPaints(page));
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // The inspector's own section header, painted by the shell's tokens rather
    // than by a primitive library: the eyebrow is the element that carries the
    // ink, where the button around it is transparent.
    const summaryInk = await section
      .locator("button[aria-expanded] > span")
      .first()
      .evaluate((node) => getComputedStyle(node).color);
    expect(
      summaryInk,
      `the ${palette} inspector section is invisible against its own panel`,
    ).not.toBe("rgba(0, 0, 0, 0)");
    expect(
      summaryInk,
      `the ${palette} inspector section has no ink at all`,
    ).not.toBe("");
  }
});

/** The chrome's own surface and ink, read as one string so a palette that
 *  changed both is still comparable to a dialog in one assertion. */
function shellHeaderPaints(
  page: import("@playwright/test").Page,
): Promise<string> {
  return page.locator(".editor-shell-header").evaluate((node) => {
    const style = getComputedStyle(node);
    return `${style.backgroundColor}|${style.color}`;
  });
}
