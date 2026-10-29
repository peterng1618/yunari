import { type ChildProcess, spawn } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { readThemePackage } from "@yunari/theme-package";
import {
  buildComposition,
  importBackdrop,
  openBlankComposition,
} from "./rebuild-composition.js";
import { chooseToken, readObject, selectLayer } from "./rebuild-driver.js";
import { openThemeFromStore, storedThemeOfPackage } from "./store-library.js";
import { isDesktopSurface } from "./surface.js";

/**
 * The rebuilt composition, **on a display** — the half the rebuild did not do.
 *
 * The region specs prove the surface can *express* the composition and the save
 * spec proves the package *persists* it. Neither proves it is *viewable*, and a
 * dashboard that renders differently on a player than in an editor is exactly
 * the finding this pass exists to catch. Given a phone is the main display type,
 * this runs at a phone's size as well as the artboard's.
 *
 * **The backdrop is imported, never written.** `res/author-journey-backdrop.jpg`
 * goes in through the editor's own `Import asset` control and onto the artboard
 * through `Background media` — the two controls an author has. Nothing here
 * writes a declaration, and the asset id the package carries is the one the
 * editor minted.
 *
 * One real host, on its own port, over its own themes directory: the player
 * bundle a preview server serves cannot load a theme package, and the whole
 * point is the host's own route.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
/** The user's own photograph, committed for exactly this. `here` is
 * `src/web/tests/e2e`, and `res/` is at the repository root. */
const BACKDROP = path.join(
  here,
  "..",
  "..",
  "..",
  "..",
  "res",
  "author-journey-backdrop.jpg",
);
/** A port no other agent and no Playwright runner owns. */
const HOST_PORT = 4224;
/** The host's app folder; the library is one folder per theme inside it. */
const APP_DIR = path.join(here, "..", "..", ".e2e-display-app");
const THEMES_DIR = path.join(APP_DIR, "themes");
/** Where the exported package is kept, so the import below can reopen it. */
const EXPORTED = path.join(APP_DIR, "exported.yunari-theme");
/** The folder this spec seeds the exported document under. The document mints
    its own UUID, so the library folder name is the spec's choice, not the id. */
const THEME_ID = "e2e-author-journey";
const HOST = `http://127.0.0.1:${HOST_PORT}`;

/**
 * Seeds the library from the package the editor exported.
 *
 * **Both halves are the point, and they are different formats.** The library
 * is a folder, so the exported archive is unpacked here to make
 * one — the host's own route, which the displays below read through; the same
 * archive is read back by the editor through a stubbed library, so the editor
 * frame is the product's own reading of the saved document. A change that broke
 * either would show up here rather than being assumed to work.
 */
function seedLibraryFromPackage(packagePath: string): void {
  const parsed = readThemePackage(new Uint8Array(readFileSync(packagePath)));
  if (!parsed.ok) throw new Error(parsed.message);

  const folder = path.join(THEMES_DIR, THEME_ID);
  mkdirSync(path.join(folder, "assets"), { recursive: true });
  writeFileSync(
    path.join(folder, "theme.json"),
    JSON.stringify(parsed.envelope),
  );
  for (const [assetPath, bytes] of Object.entries(parsed.assets)) {
    writeFileSync(path.join(folder, ...assetPath.split("/")), bytes);
  }
}

/** The two sizes the composition has to survive. A phone is the main display. */
const DISPLAYS = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "phone", width: 390, height: 844 },
] as const;

async function startHost(): Promise<ChildProcess> {
  const child = spawn(
    "node",
    [
      "packages/host/bin/yunari.js",
      "--no-browser",
      "--port",
      String(HOST_PORT),
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
  throw new Error(`the display host never answered on ${HOST_PORT}`);
}

/**
 * The player's own frame, not the page's: the artboard is what a display shows,
 * and a screenshot of the whole window measures the host's chrome too.
 */
async function shootDisplay(
  page: Page,
  display: (typeof DISPLAYS)[number],
): Promise<void> {
  await page.setViewportSize({
    width: display.width,
    height: display.height,
  });
  // `data=live` is what a display runs on; the default is the same document
  // with every reading painted as a gap, which would prove nothing.
  await page.goto(`${HOST}/?theme=${THEME_ID}&data=live`);
  // The chart families draw from a rolling window, so a frame caught before
  // the first sample would be an empty card rather than the composition.
  await page.waitForFunction(
    () => !document.querySelector("[data-yunari-load-failure]"),
    undefined,
    { timeout: 30_000 },
  );
  // A frame caught while the stream is still opening is a card of gaps, which
  // is §97 behaving correctly and proves nothing about the composition. The
  // footer's own copy is the signal, so the wait is on the product's word — and
  // it is **not** swallowed: an earlier version caught the failure and carried
  // on, and the screenshot it took was a dashboard of em-dashes that cost an
  // hour of diagnosis. A capture that cannot show live data should fail here
  // rather than produce a picture that reads as a broken product.
  await page.waitForFunction(
    () => !document.body.innerText.includes("Connecting to the host"),
    undefined,
    { timeout: 60_000 },
  );
  // And the charts need a few samples before they are a chart rather than a
  // spike at the right edge, which is what a display four minutes old shows.
  await page.waitForTimeout(20_000);
  await page.screenshot({
    path: `test-results/display/player-${display.name}.png`,
  });
}

test.describe("the rebuilt composition, on a display", () => {
  let host: ChildProcess | undefined;

  test.beforeAll(async () => {
    rmSync(APP_DIR, { recursive: true, force: true });
    mkdirSync(THEMES_DIR, { recursive: true });
    host = await startHost();
  });

  test.afterAll(() => {
    host?.kill();
  });

  test("the author's backdrop, the cards, and both display sizes", async ({
    page,
    context,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    // All eight regions in **one** document, then two displays, the editor
    // reading the same package back, and the material assertions. The region
    // specs each fit 30 s because each is one region; this is the composition
    // plus a host plus a wait for the charts to fill their window, so the
    // default is not the right budget and the honest one is stated here.
    test.setTimeout(600_000);

    // ---- the editor half: build it the way an author would ----
    await page.goto("/");
    await page.waitForSelector("#canvas-host canvas");
    await openBlankComposition(page);
    await buildComposition(page);
    await importBackdrop(page, BACKDROP);

    /** The File menu's own Save row, written where the host can serve it. */
    const saveToHost = async (): Promise<void> => {
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "File", exact: true }).click();
      await page.getByRole("menuitem", { name: "Save package" }).click();
      const file = await (await download).path();
      expect(file, "Save package should write a package").not.toBeNull();
      copyFileSync(file!, EXPORTED);
      seedLibraryFromPackage(EXPORTED);
    };

    // The display gets **its own page**. The editor document lives in this
    // one's memory, and a navigation to the host would unload it — so every
    // capture of the same document has to happen without leaving the editor.
    const screen = await context.newPage();

    // ---- the display half: the document as the surface authored it ----
    await saveToHost();
    for (const display of DISPLAYS) await shootDisplay(screen, display);

    // ---- and the editor, showing the same package ----
    //
    // Reopened through the store's own **Open in editor** control over a stubbed
    // library, which is where the document route lives now that
    // `File ▸ Import package` writes into the library instead. The editor frame
    // is still the product's own reading of the saved document rather than the
    // composition that was still in memory. A difference between this and the
    // player is a finding about the round trip; a difference between this and
    // what was just on screen is a finding about the save.
    const reopened = await context.newPage();
    await reopened.goto("/");
    await reopened.waitForSelector("#canvas-host canvas");
    await openThemeFromStore(
      reopened,
      storedThemeOfPackage(new Uint8Array(readFileSync(EXPORTED))),
    );
    await reopened.waitForTimeout(5_000);
    await reopened.screenshot({
      path: "test-results/display/editor-desktop.png",
    });
    await reopened.close();

    // ---- F2.12, asserted rather than screenshotted ----
    //
    // Every glass card this document authors was frosted through the control,
    // and the control now carries the frosted surface with it. `palette.panel`
    // is 85 % opaque, so a blur beneath it is a blur of nothing and the card
    // read as a tint — which is what the display proof measured, at 34.5 luma
    // over a sky at 140.8. Asserting the token is cheaper and more durable than
    // a second frame of the same scene, and the luma is proved over a
    // photograph in the glass proof rather than here.
    const cpuCard = await readObject(page, "cpu-card");
    expect(
      (cpuCard?.["yunariPaint"] as { fill?: string } | undefined)?.fill,
      "a card the author frosted carries the frosted material",
    ).toBe("palette.frost");

    // The other half of the rule: a fill the author chose is theirs, and a
    // treatment is layered over it rather than overwriting it.
    await selectLayer(page, "cpu-card");
    await chooseToken(page, "[data-yunari-panel-fill]", "Panel");
    expect(
      (await readObject(page, "cpu-card"))?.["yunariPaint"],
      "a fill the author picked is left alone",
    ).toEqual({ fill: "palette.panel", stroke: "palette.panelStroke" });

    await screen.close();
  });
});
