import { expect, type Page } from "@playwright/test";
import { EDITOR, freezeClock } from "./editor-stage.js";

/**
 * Opens the editor on the stage the display specs measure.
 *
 * The clock is frozen before the navigation (see `freezeClock`), and the read
 * waits for the starter's own paint: fonts and images load asynchronously, so a
 * measurement taken before that finished is a measurement of an empty canvas.
 */
export async function openDisplayStage(page: Page): Promise<void> {
  await freezeClock(page);
  await page.goto(EDITOR);
  await expect(page.locator("#yunari-fabric-editor")).toBeVisible();
  await page.waitForFunction(
    () =>
      (window as unknown as { yunariEditorBridge?: unknown })
        .yunariEditorBridge !== undefined,
  );
  await page.waitForTimeout(1500);
}
