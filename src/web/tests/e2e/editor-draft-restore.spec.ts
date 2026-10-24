import { expect, test } from "@playwright/test";
import { FIXED_TIME } from "./clock.js";
import { openPane } from "./editor-rail.js";
import { isDesktopSurface } from "./surface.js";

/** The editor preview, the same address every editor spec uses. */
const EDITOR = "http://127.0.0.1:4174/";

/**
 * A draft this build cannot open, driven through the boot that has to report it.
 *
 * **Two rows, one arrangement.** `vg-511` is the refusal: the boot writes the
 * status line last, so a refusal written where it was caught was overwritten by
 * the boot that followed it, and the author was never told why their work did
 * not come back. `vg-512` is the fate: the slot holds one document, so the
 * draft that could not be opened here is replaced by the fallback document's
 * own first edit — which the author has to be told, because it is the last
 * moment the copy exists.
 *
 * **The draft is unrenderable for the one reason the build states.** Its
 * `fabricVersion` is not this runtime's, so `mount` throws where
 * `assertFabricThemeEnvelopeCompatible` reads it (`scene-fabric/persist.ts`) —
 * a real refusal through the real path, not a stubbed failure. It is written
 * into browser storage before the page's own scripts run, which is the state a
 * crash leaves behind.
 *
 * **The clock is installed, not paused.** `install` pins where time starts and
 * lets it run, which is what the boot needs — the draft's interval is only
 * driven forward by an explicit `fastForward`, so the supersede the second half
 * asserts happens when this test says so rather than thirty seconds later.
 */

/** The draft's own key, as `draft-store.ts` writes it. Read here rather than
 *  imported: the editor's public barrel exports the shell, not its storage. */
const DRAFT_KEY = "yunari.editor.draft";

/** The name the prompt and the report both have to carry, so the author can
 *  tell which of their documents did not come back. */
const DRAFT_NAME = "Refused draft";

const UNRENDERABLE_DRAFT = {
  name: DRAFT_NAME,
  savedAt: "2026-10-15T08:00:00.000Z",
  content: {
    schemaVersion: "2.0.0",
    // Not this runtime's renderer version: the mount refuses it, which is the
    // refusal under test.
    fabricVersion: "0.0.0",
    id: "e2e-refused-draft",
    metadata: { name: DRAFT_NAME, themeLanguage: "en" },
    artboard: { width: 640, height: 360 },
    scene: { version: "0.0.0", objects: [] },
  },
};

/** The template the boot opens instead, named so the document in front of the
 *  author can be told from the draft that never opened. */
const TEMPLATE_NAME = "System dashboard";

test("a refused draft restore is reported, and the report names its fate", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  await page.clock.install({ time: FIXED_TIME });
  await page.addInitScript(
    ([key, draft]) => {
      window.localStorage.setItem(key as string, JSON.stringify(draft));
    },
    [DRAFT_KEY, UNRENDERABLE_DRAFT],
  );

  await page.goto(EDITOR);
  // The prompt is offered before anything mounts, because the answer decides
  // what opens (`editor-main.ts`). Restore is the answer that fails.
  const prompt = page.locator('[role="dialog"]');
  await expect(prompt).toContainText(DRAFT_NAME);
  await prompt.getByRole("button", { name: "Restore", exact: true }).click();

  // **The refusal, where it survives.** The status line cannot hold it — the
  // boot writes that element after this point — so it is the shell's own
  // diagnostic line, which nothing in the boot writes.
  const diagnostic = page.locator(".editor-shell-diagnostic");
  await expect(diagnostic).toContainText("Could not restore the draft");
  await expect(diagnostic, "the author is told which document").toContainText(
    DRAFT_NAME,
  );
  await expect(diagnostic, "and why it could not be opened").toContainText(
    "incompatible",
  );
  await expect(diagnostic, "and what happens to it next").toContainText(
    "Editing this document will replace it",
  );

  // The boot opened the document it would have, and the draft is still in the
  // slot: a refusal is not a discard.
  await page.waitForFunction(() => "yunariEditorBridge" in window);
  const documentName = await page.evaluate(() => {
    const bridge = (
      window as unknown as {
        yunariEditorBridge?: { snapshot(): { documentName?: string } };
      }
    ).yunariEditorBridge;
    return bridge?.snapshot().documentName;
  });
  expect(documentName).toBe(TEMPLATE_NAME);
  const held = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    DRAFT_KEY,
  );
  expect(held, "the refused draft is still the slot's").toContain(DRAFT_NAME);

  // **The fate the report named.** The author edits the document in front of
  // them — the fallback — and the next autosave tick takes the single slot, so
  // the draft that could not be opened is gone from this moment on.
  await openPane(page, "Document");
  await page.locator("[data-yunari-artboard-width]").fill("320");
  await page.locator("[data-yunari-artboard-width]").blur();
  await page.clock.fastForward(31_000);

  const superseded = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    DRAFT_KEY,
  );
  expect(
    superseded,
    "the fallback document's own draft now holds the slot",
  ).not.toContain(DRAFT_NAME);
  expect(
    JSON.parse(superseded ?? "{}").content?.artboard?.width,
    "and it is the document the author is editing",
  ).toBe(320);
});
