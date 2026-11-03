import { expect, type Locator, type Page } from "@playwright/test";

/** The editor, served by the preview projects. */
export const EDITOR = "http://127.0.0.1:4174/?mode=editor";

/** The rail's gear: the only route to the shell palette since the shell layout moved it out of
 *  the header. Named by the class only that control carries. */
export const SETTINGS_GEAR = ".editor-shell-rail-settings";

/** The Settings mode's region, the surface the gear opens. */
export const SETTINGS_REGION = "[data-yunari-settings-region]";

/** Read from the same list the editor uses, so a palette added there cannot
 *  escape a sweep over it. Kept as a literal because a spec file cannot import
 *  the editor package; `shellPalettes` in `editor-shell/palette.ts` is the
 *  owner, and this is the only copy of it on the test side. */
export const PALETTES = [
  "editorial",
  "graphite",
  "ember",
  "moss",
  "plum",
  "light",
] as const;

export type Palette = (typeof PALETTES)[number];

/** The editor, loaded once. A spec then switches palettes through the settings
 *  modal, which is the route an author takes and costs no reload — the editor
 *  boots a whole Fabric session per load, and six of those is past the test
 *  budget. */
export async function openShell(page: Page): Promise<void> {
  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();
}

/** Leave Settings for the editor through the header's own mode switch, so the
 *  surface a spec measures next is the editor rather than a mode's page. */
export async function leaveSettings(page: Page): Promise<void> {
  await page.locator("#yunari-shell-modes-editor").click();
  await expect(page.locator(SETTINGS_REGION)).toBeHidden();
}

/** The Appearance page, open, returning the Settings region it is in.
 *
 *  Idempotent: a caller that already opened Settings — or one that opened it on
 *  a different page — lands on the same surface. */
export async function openAppearance(page: Page): Promise<Locator> {
  const region = page.locator(SETTINGS_REGION);
  if (!(await region.isVisible())) {
    await page.locator(SETTINGS_GEAR).click();
    await expect(region).toBeVisible();
  }
  await region.getByRole("tab", { name: "Appearance" }).click();
  return region;
}

/** Choose a palette the way an author does: the gear, the Appearance page, the
 *  row. Asserts the attribute rather than trusting the click, so a surface that
 *  failed to apply the choice fails here rather than six assertions later
 *  against whatever was in force. Leaves Settings so the caller is back in the
 *  editor, which is where every caller continues. */
export async function choosePalette(
  page: Page,
  palette: Palette,
): Promise<void> {
  const region = await openAppearance(page);
  await region.getByRole("radio", { name: palette, exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-shell-palette",
    palette,
  );
  await leaveSettings(page);
}
