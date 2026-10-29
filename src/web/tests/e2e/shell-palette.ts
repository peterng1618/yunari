import { expect, type Locator, type Page } from "@playwright/test";

/** The editor, served by the preview projects. */
export const EDITOR = "http://127.0.0.1:4174/";

/** The rail's gear: the only route to the shell palette since the shell layout moved it out of
 *  the header. Named by the class only that control carries. */
export const SETTINGS_GEAR = ".editor-shell-rail-settings";

/** The modal, read by its own name rather than by class — the reference sheet
 *  is a Base UI dialog too. */
export const SETTINGS_DIALOG = { name: "Settings" } as const;

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

/** The Appearance tab, open, returning the modal it is in.
 *
 *  Base UI tabs keep the inactive panels out of the DOM, so a caller that wants
 *  the six swatches has to be on the tab as well as in the modal. Idempotent: a
 *  caller that already opened the modal — or one that opened it for a different
 *  tab — lands on the same surface. */
export async function openAppearance(page: Page): Promise<Locator> {
  const dialog = page.getByRole("dialog", SETTINGS_DIALOG);
  if (!(await dialog.isVisible())) {
    await page.locator(SETTINGS_GEAR).click();
    await expect(dialog).toBeVisible();
  }
  await dialog.getByRole("tab", { name: "Appearance" }).click();
  return dialog;
}

/** Choose a palette the way an author does: the gear, the Appearance tab, the
 *  row. Asserts the attribute rather than trusting the click, so a modal that
 *  failed to apply the choice fails here rather than six assertions later
 *  against whatever was in force. */
export async function choosePalette(
  page: Page,
  palette: Palette,
): Promise<void> {
  const dialog = await openAppearance(page);
  await dialog.getByRole("radio", { name: palette, exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-shell-palette",
    palette,
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}
