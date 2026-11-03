import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
  test,
} from "@playwright/test";
import { readThemePackage } from "@yunari/theme-package";
import { strToU8, zipSync } from "fflate";
import { uiCopy } from "../../packages/editor/src/ui-copy.js";
import { typeIntoControl } from "./control-set.js";
import { chooseAssetFile } from "./editor-canvas.js";
import { openPane } from "./editor-rail.js";
import { readScene } from "./rebuild-driver.js";
import { isDesktopSurface } from "./surface.js";

/**
 * The two refusals the editor can only meet through a **real host**.
 *
 * The package picker's refusal is the host reader's own sentence, and the
 * save cleanup's is the platform trash's. Both were otherwise unproven in a
 * browser: `reference-theme.spec.ts` asserted `Could not import:` alone and ran
 * against the preview, which serves no `/api` at all, and
 * `save-cleanup-dialog.tsx` was proved in jsdom with `trashAssets` mocked.
 *
 * **The case starts its own host, over its own app folder.** `/api/themes/import`
 * and `/api/assets/trash` are only same-origin on the host's `/editor/` mount,
 * and the cleanup case needs the host's staging root to be somewhere it cannot
 * create a directory. `--port` keeps it off every other proof's socket; it is
 * loopback-only, which is where Playwright already is.
 */

const PORT = 4247;
const APP_DIR = path.join(os.tmpdir(), "yunari-editor-host-refusal-app");
const HOST = `http://127.0.0.1:${PORT}`;

/**
 * The host stages a trash request under `os.tmpdir()` when no `stagingRoot` is
 * injected, so pointing its temp directory at a **file** makes `mkdtemp`
 * refuse. That is the route's own refusal, with Node's sentence, rather than a
 * mock standing in for one; the test compares the status line to the text the
 * same host answers the route with.
 */
const NOT_A_DIRECTORY = path.join(APP_DIR, "not-a-directory");

/** The same 20×20 PNG the asset specs import: a truncated fixture is refused
 *  by libpng before any declaration exists. */
const LOGO = {
  name: "logo.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAABmJLR0QA/wD/AP+gvaeTAAAAIklEQVQ4jWNk2HHzPwMVARM1DRs1cNTAUQNHDRw1cCgZCAC1HQK4IWYK+QAAAABJRU5ErkJggg==",
    "base64",
  ),
};

function startHost(): ChildProcess {
  return spawn(
    "node",
    [
      "packages/host/bin/yunari.js",
      "--no-browser",
      "--port",
      String(PORT),
      "--app-dir",
      APP_DIR,
    ],
    {
      cwd: process.cwd(),
      stdio: "ignore",
      // `os.tmpdir()` reads all three on Windows, in this order.
      env: {
        ...process.env,
        TMPDIR: NOT_A_DIRECTORY,
        TMP: NOT_A_DIRECTORY,
        TEMP: NOT_A_DIRECTORY,
      },
    },
  );
}

async function waitForHost(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${HOST}/api/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`the editor-host-refusal host never answered on ${PORT}`);
}

let host: ChildProcess | undefined;

test.beforeAll(async () => {
  rmSync(APP_DIR, { recursive: true, force: true });
  mkdirSync(APP_DIR, { recursive: true });
  writeFileSync(NOT_A_DIRECTORY, "");
  host = startHost();
  await waitForHost();
});

test.afterAll(() => {
  host?.kill();
  rmSync(APP_DIR, { recursive: true, force: true });
});

const desktop = (testInfo: TestInfo): void => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
};

function activeId(page: Page): Promise<string | undefined> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          yunariEditorBridge: {
            editor: {
              canvas: { getActiveObject(): { id?: string } | undefined };
            };
          };
        }
      ).yunariEditorBridge.editor.canvas.getActiveObject()?.id,
  );
}

async function openEditor(page: Page): Promise<void> {
  await page.goto(`${HOST}/editor/`);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();
  await page.waitForFunction(() => "yunariEditorBridge" in window);
}

/** Presses the toolbar's **Import theme**, the action an author has, and
 *  answers the chooser it opens. */
async function importFile(
  page: Page,
  name: string,
  buffer: Buffer,
): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import theme", exact: true }).click();
  await (await chooser).setFiles({
    name,
    mimeType: "application/octet-stream",
    buffer,
  });
}

function sceneObjectsOf(envelope: unknown): readonly Record<string, unknown>[] {
  const scene = (envelope as { scene?: { objects?: unknown } }).scene;
  return Array.isArray(scene?.objects)
    ? (scene.objects as readonly Record<string, unknown>[])
    : [];
}

function objectsOf(envelope: unknown): readonly Record<string, unknown>[] {
  const all: Record<string, unknown>[] = [];
  const visit = (objects: ReadonlyArray<Record<string, unknown>>): void => {
    for (const object of objects) {
      all.push(object);
      if (Array.isArray(object["objects"])) visit(object["objects"]);
    }
  };
  visit(sceneObjectsOf(envelope));
  return all;
}

async function exportPackage(page: Page): Promise<Buffer> {
  const download = page.waitForEvent("download");
  page.once("dialog", (dialog) => dialog.accept("patch"));
  await page.getByRole("button", { name: "Export theme", exact: true }).click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test("an unreadable package is refused with the reader's own sentence and leaves the work alone", async ({
  page,
}, testInfo) => {
  desktop(testInfo);
  await openEditor(page);

  await openPane(page, "Add");
  await page
    .locator('[data-yunari-add-group="shape"]')
    .getByRole("button", { name: "Rectangle", exact: true })
    .click();
  const panelId = (await activeId(page)) ?? "";
  const panel = (await readScene(page)).find((object) => object.id === panelId);
  expect(panel, "the Add pane drew no rectangle").toBeDefined();
  if (panel === undefined) return;

  // **Not a package at all.** The host's reader answers this sentence, and the
  // browser's half is only the post and the mapping — so the same reader is
  // what the assertion names, rather than a prefix any failure produces.
  const notAPackage = Buffer.from("this is not a zip archive");
  const notAPackageReading = readThemePackage(notAPackage);
  expect(notAPackageReading.ok).toBe(false);
  if (!notAPackageReading.ok) {
    await importFile(page, "broken.yunari-theme", notAPackage);
    // The message element, not the footer: the footer also carries the object
    // count and the unsaved marker, so only this one is the refusal itself.
    await expect(page.locator("#status-message")).toHaveText(
      uiCopy.themeImport.refused(notAPackageReading.message),
    );
  }
  expect(
    (await readScene(page)).some((object) => object.id === panel.id),
    "the refused import removed the author's rectangle",
  ).toBe(true);

  // **A package whose envelope the validator refuses.** Written without
  // `writeThemePackage`, so the bytes are a real zip around a bad document.
  const badEnvelope = Buffer.from(
    zipSync({
      "manifest.json": strToU8(
        JSON.stringify({
          format: "yunari-theme-package",
          version: 1,
          theme: "theme.json",
        }),
      ),
      "theme.json": strToU8(JSON.stringify({ schemaVersion: "2.0.0" })),
    }),
  );
  const badEnvelopeReading = readThemePackage(badEnvelope);
  expect(badEnvelopeReading.ok).toBe(false);
  if (!badEnvelopeReading.ok) {
    await importFile(page, "invalid.yunari-theme", badEnvelope);
    await expect(page.locator("#status-message")).toHaveText(
      uiCopy.themeImport.refused(badEnvelopeReading.message),
    );
  }

  // **The work is still there, still editable, and still saveable** — the
  // property "errors preserve recoverable work" actually means.
  const after = (await readScene(page)).find(
    (object) => object.id === panel.id,
  );
  expect(after).toMatchObject({
    left: panel.left,
    top: panel.top,
    width: panel.width,
    height: panel.height,
  });
  await typeIntoControl(page, page.locator("[data-yunari-panel-radius]"), "9");
  await expect(page.locator("[data-yunari-panel-radius]")).toHaveValue("9");
  const saved = readThemePackage(await exportPackage(page));
  expect(saved.ok).toBe(true);
  if (!saved.ok) return;
  expect(objectsOf(saved.envelope)).toContainEqual(
    expect.objectContaining({ id: panel.id, rx: 9 }),
  );
});

test("the save-cleanup sheet renders the unused file, and a refused trash aborts the save", async ({
  page,
}, testInfo) => {
  desktop(testInfo);
  await openEditor(page);

  await openPane(page, "Assets");
  const assets = page.locator('[data-yunari-panel="assets"]');
  await chooseAssetFile(page, "import", LOGO);
  await expect(assets).toContainText("logo.png");

  // The import places the picture and leaves it active; removing that object
  // is what makes the declaration unused, so the next save has a question.
  await page.keyboard.press("Delete");

  page.once("dialog", (dialog) => dialog.accept("patch"));
  await page.getByRole("button", { name: "Export theme", exact: true }).click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();

  const bytes = `${LOGO.buffer.length} B`;
  const card: Locator = dialog.locator("li", { hasText: "logo.png" });
  await expect(dialog).toContainText(uiCopy.saveCleanup.heading);
  await expect(dialog).toContainText(uiCopy.saveCleanup.count(1, bytes));
  await expect(card).toContainText(uiCopy.panels.assetCard.kind.image);
  await expect(card).toContainText(uiCopy.saveCleanup.reason.image);
  await expect(card).toContainText(bytes);
  await expect(dialog).toContainText(uiCopy.saveCleanup.note);
  await expect(dialog).toContainText(uiCopy.saveCleanup.warning);
  await expect(dialog).toContainText(`${bytes} unused`);
  const fileCheckbox = dialog.locator(`[data-yunari-save-cleanup-file]`);
  await expect(fileCheckbox).toHaveCount(1);
  await expect(fileCheckbox).not.toBeChecked();

  // **The host's own refusal**, read from the same route before the save asks
  // it. The staging root is a file, so `mkdtemp` fails and the route answers
  // Node's sentence; the sheet's own press must show exactly that text, not a
  // sentence composed in the browser.
  const probe = await fetch(`${HOST}/api/assets/trash`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      files: [{ name: "probe.png", bytes: LOGO.buffer.toString("base64") }],
    }),
  });
  expect(probe.ok, "the fixture did not make the host refuse the trash").toBe(
    false,
  );
  const refusal = (await probe.text()).trim();
  expect(refusal, "the host refused with an empty sentence").not.toBe("");

  // `mkdtemp` mints a fresh random suffix per call, so the probe's sentence and
  // the sheet's cannot be compared byte for byte. What the sheet owes is the
  // host's own wording: the same message with only that suffix normalised.
  const stable = (text: string): string =>
    text.replace(/yunari-trash-[A-Za-z0-9]+/g, "yunari-trash-<random>");

  const downloads: string[] = [];
  page.on("download", (download) =>
    downloads.push(download.suggestedFilename()),
  );
  await fileCheckbox.check();
  await dialog
    .getByRole("button", { name: uiCopy.file.exportTheme, exact: true })
    .click();

  await expect
    .poll(
      async () =>
        stable((await page.locator("#status-message").textContent()) ?? ""),
      { message: "the sheet did not repeat the host's own sentence" },
    )
    .toBe(stable(refusal));
  await expect(dialog).toBeHidden();
  // Nothing was written and nothing pruned: the declaration and its card are
  // still the document's, which is what "the save stopped" means here.
  expect(downloads).toEqual([]);
  await expect(assets).toContainText("logo.png");
});
