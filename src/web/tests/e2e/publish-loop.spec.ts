import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { writeThemePackage } from "@yunari/theme-package";
import { captureVisualReview } from "./editor-canvas.js";
import { openPane } from "./editor-rail.js";

/**
 * The publish loop, proved on a real host: **a save** carries the theme to the
 * display showing it, and an unsaved edit carries nothing.
 *
 * The host publishes the stored envelope when `PUT /api/themes/:id` lands, and
 * the display's follower reloads when the revision moves. No editor-to-host
 * push happens while the author types, so these two tests are the two halves of
 * that rule.
 *
 * **The editor is driven through the host's own `/editor/` mount**, never a
 * `vite preview` server, because `createThemeLibraryClient()` fetches
 * same-origin and only the host answers `/api/*`. It is loopback-only, which is
 * where Playwright already is — and loopback is also what a display needs for
 * `/api/published`, so the LAN is deliberately left off.
 *
 * **Every helper is a pointer or a keystroke against a delivered control.** The
 * artboard is changed by typing into the panel's own width and height boxes,
 * the way an author does; `rebuild-driver.ts:10-14` states that rule.
 *
 * **The picture this writes is the proof, and it is only a proof because the
 * artboard is painted.** The saved frame is 320x240 against a stored 640x360,
 * so a 4:3 light band on the dark page is the one thing in the file that shows
 * the display followed the save.
 */

/** A port no other agent and no Playwright runner owns. */
const PORT = 4229;
/** Outside the repository tree: the host writes theme folders here. */
const APP_DIR = path.join(os.tmpdir(), "yunari-publish-loop-app");
const THEMES_DIR = path.join(APP_DIR, "themes");
const HOST = `http://127.0.0.1:${PORT}`;

const THEME_ID = "e2e-publish-loop";

/** One minimal, valid package, so the host starts with a real library and the
 *  editor has a saved theme to open.
 *
 *  **The artboard is light and the bars are dark, so the screenshot says
 *  something.** The stored frame is 640 × 360 and the saved one is 320 × 240:
 *  the same paper in a 4:3 frame rather than a 16:9 one, which is a change a
 *  reader can see. A dark artboard on a dark page would make the picture a
 *  black rectangle that proves nothing either way. */
const envelope = {
  schemaVersion: "2.0.0" as const,
  fabricVersion: "7.4.0",
  id: THEME_ID,
  metadata: { name: "E2E publish loop", themeLanguage: "en" },
  artboard: {
    width: 640,
    height: 360,
    contentFit: "contain" as const,
  },
  background: { color: { ref: "palette.paper" as const } },
  globals: {
    palette: {
      // The immutable transparent token every package must carry.
      none: {
        name: "None",
        value: { kind: "solid" as const, color: "transparent" },
      },
      bar: { name: "Bar", value: { kind: "solid" as const, color: "#101318" } },
      paper: {
        name: "Paper",
        value: { kind: "solid" as const, color: "#e8e4da" },
      },
    },
    typeTokens: {
      heading: { family: "system-ui, sans-serif", weight: "600" },
      body: { family: "system-ui, sans-serif", weight: "400" },
      mono: { family: "ui-monospace, monospace", weight: "400" },
    },
  },
  assets: [],
  scene: { version: "7.4.0" as const, objects: [] },
};

function seedLibrary(): void {
  const result = writeThemePackage({ envelope, assets: {} });
  if (!result.ok)
    throw new Error(`publish-loop fixture is invalid: ${result.message}`);

  const folder = path.join(THEMES_DIR, THEME_ID);
  mkdirSync(path.join(folder, "assets"), { recursive: true });
  writeFileSync(path.join(folder, "theme.json"), JSON.stringify(envelope));
}

async function startHost(): Promise<ChildProcess> {
  const child = spawn(
    "node",
    [
      "packages/host/bin/yunari.js",
      "--no-browser",
      "--port",
      String(PORT),
      "--app-dir",
      APP_DIR,
    ],
    { cwd: process.cwd(), stdio: "ignore" },
  );

  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${HOST}/api/health`)).ok) return child;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  child.kill();
  throw new Error(`the publish-loop host never answered on ${PORT}`);
}

/** Saves the open document into the host's library — the write that publishes.
 *  The File menu owns it; there is no header button. */
async function saveToLibrary(page: Page): Promise<void> {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save to library" }).click();
  await expect(page.locator("#status")).toContainText("Saved to library");
}

/** Changes the artboard the way an author does: typed into the panel's own
 *  boxes. Both commit on `change`, and `fill` does not dispatch `change`, so the
 *  box is blurred — which is what leaving it does. */
async function resizeArtboard(
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  await openPane(page, "Document");
  await page.locator("[data-yunari-artboard-width]").fill(String(width));
  await page.locator("[data-yunari-artboard-width]").blur();
  await page.locator("[data-yunari-artboard-height]").fill(String(height));
  await page.locator("[data-yunari-artboard-height]").blur();
}

/**
 * Marks the display's own window so a reload can be told from a still page.
 * Only a real navigation clears it, which is why every passing assertion that
 * waits on it is about the display and not about the host.
 */
function markDisplay(
  page: Page,
  key: "__beforeSave" | "__beforeIdle",
): Promise<void> {
  return page.evaluate((name) => {
    (window as unknown as Record<string, boolean>)[name] = true;
  }, key);
}

/** Whether the mark survives. A destroyed execution context answers "still
 *  here": the follower reloads *this* page, so the read races the navigation it
 *  waits for, and swallowing that can only delay a pass, never manufacture one. */
async function markStillSet(
  page: Page,
  key: "__beforeSave" | "__beforeIdle",
): Promise<boolean> {
  try {
    return await page.evaluate(
      (name) =>
        (window as unknown as Record<string, boolean | undefined>)[name] ??
        false,
      key,
    );
  } catch {
    return true;
  }
}

/** The revision the host is serving, read from outside the display's page so a
 *  reload cannot destroy the read. */
async function revision(): Promise<number> {
  const body = (await (await fetch(`${HOST}/api/published`)).json()) as {
    revision: number;
  };
  return body.revision;
}

/** The artboard of the stored theme. */
async function storedArtboard(): Promise<{ width: number; height: number }> {
  const body = (await (
    await fetch(`${HOST}/api/themes/${THEME_ID}/document`)
  ).json()) as { artboard: { width: number; height: number } };
  return body.artboard;
}

test.describe("the publish loop", () => {
  let host: ChildProcess | undefined;

  test.beforeAll(async () => {
    rmSync(APP_DIR, { recursive: true, force: true });
    mkdirSync(THEMES_DIR, { recursive: true });
    seedLibrary();
    host = await startHost();
  });

  test.afterAll(() => {
    host?.kill();
  });

  test("a save reaches the display showing that theme", async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(180_000);
    const before = await revision();

    await page.goto(`${HOST}/editor/`);
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible({ timeout: 30_000 });

    const display = await context.newPage();
    await display.setViewportSize({ width: 390, height: 844 });
    await display.goto(`${HOST}/`);
    await expect(display.locator("#artboard")).toBeVisible({ timeout: 30_000 });
    // Marked after the display has loaded, and before the save can land.
    await markDisplay(display, "__beforeSave");

    await resizeArtboard(page, 320, 240);
    // **Nothing has been sent yet**: an edit is not news until it is saved.
    expect(await revision()).toBe(before);

    await saveToLibrary(page);

    await expect
      .poll(() => revision(), { timeout: 15_000 })
      .toBeGreaterThan(before);
    await expect
      .poll(() => markStillSet(display, "__beforeSave"), { timeout: 15_000 })
      .toBe(false);
    expect(await storedArtboard()).toMatchObject({ width: 320, height: 240 });

    await captureVisualReview(display, testInfo, "publish-loop-save");
    await display.close();
  });

  test("an unsaved edit leaves the display and the revision alone", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);

    await page.goto(`${HOST}/editor/`);
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible({ timeout: 30_000 });

    const display = await context.newPage();
    await display.setViewportSize({ width: 390, height: 844 });
    await display.goto(`${HOST}/`);
    await expect(display.locator("#artboard")).toBeVisible({ timeout: 30_000 });
    await markDisplay(display, "__beforeIdle");
    const before = await revision();
    const stored = await storedArtboard();

    await resizeArtboard(page, 400, 300);

    // Two poll intervals, so a wrongly flushed edit has every chance to reload
    // the display and move the revision.
    await page.waitForTimeout(5_000);
    expect(await revision()).toBe(before);
    expect(await markStillSet(display, "__beforeIdle")).toBe(true);
    expect(await storedArtboard()).toEqual(stored);

    await display.close();
  });
});
