import { expect, type Page } from "@playwright/test";

/**
 * Opens the editor and waits until it can take input.
 *
 * `page.goto` resolves on the document's load event, which is earlier than the
 * shell: the canvas, the `yunariEditorBridge` browsers drive, and the shortcut
 * bindings all arrive after it. A test that presses a key or calls the bridge
 * straight after `goto` is therefore racing the mount, and on a loaded CI
 * runner it loses — measured as a dialog that never appeared (`Control+n`,
 * then 60 s waiting for `[role="dialog"]`) and as
 * `Cannot read properties of undefined (reading 'selectLayer')`.
 *
 * The two signals are the editor's own: its status line says `Editor ready`
 * once the document it opened is on screen, and the bridge is what the shell
 * publishes for the tests to drive.
 *
 * **A reload of a dirty document is not this.** The shell asks whether to
 * restore the draft before anything mounts, so neither signal exists until
 * that prompt is answered; those reloads keep `page.goto` and answer the
 * prompt themselves.
 */
export async function openEditor(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.locator("#status-message")).toHaveText("Editor ready");
  await page.waitForFunction(() => "yunariEditorBridge" in window);
}
