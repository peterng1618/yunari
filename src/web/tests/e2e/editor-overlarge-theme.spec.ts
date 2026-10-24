import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * `vg-409`'s visible half, on a real host: **the editor reports success over a
 * document it never opened**, one trigger over from the case
 * `editor-invalid-theme.spec.ts` proves.
 *
 * A `theme.json` past the store's 32 MiB bound was answered, to every reader, as
 * though the theme were not there: the store's size branch returned `undefined`,
 * the open route answered `404 Theme not found`, and `boot-theme`'s `openTheme`
 * caught that as `none` — so the editor mounted the template and wrote "Editor
 * ready" while the document the URL named had never opened.
 *
 * **The case starts its own host, over its own app folder.** The library is a
 * directory the host is pointed at (`cli/args.ts`), so a private `--app-dir`
 * gives this file a library with exactly one over-large theme and no dependence
 * on whatever the shared host project left on disk. `--port` keeps it off every
 * other proof's socket. It is loopback-only, which is where Playwright already
 * is.
 *
 * **It asserts the two visible facts, not a count or a geometry.** The status
 * element says the saved theme is too large to open, and the document that is
 * open is the template rather than the over-large theme — read through the
 * bridge's own `snapshot()`, the same projection the header chip reads.
 */

const PORT = 4237;
const APP_DIR = path.join(os.tmpdir(), "yunari-overlarge-theme-app");
const THEMES_DIR = path.join(APP_DIR, "themes");
const HOST = `http://127.0.0.1:${PORT}`;

const THEME_ID = "e2e-overlarge-theme";

/** The template `createNewFabricTheme` builds, named so the open document can
 *  be told from the over-large one that shares no name of its own. */
const TEMPLATE_NAME = "System dashboard";

/** The store's own bound is 32 MiB (`themes/store.ts`), and it is not exported,
 *  so the fixture states the size it needs to be over rather than importing a
 *  number that is not on the wire. */
const OVER_THE_BOUND_BYTES = 33 * 1024 * 1024;

/**
 * One theme folder whose `theme.json` is past the store's size bound. It is a
 * *valid* envelope padded with trailing whitespace, so the only reason the store
 * refuses it is its size — a case that failed validation would be proving the
 * other spec's finding instead of this one.
 */
function seedLibrary(): void {
  const folder = path.join(THEMES_DIR, THEME_ID);
  mkdirSync(folder, { recursive: true });
  const document = JSON.stringify({
    schemaVersion: "2.0.0",
    fabricVersion: "7.4.0",
    id: THEME_ID,
    artboard: { width: 1920, height: 1080 },
    metadata: { name: "Over-large theme", themeLanguage: "en" },
    scene: { version: "7.4.0", objects: [] },
  });
  writeFileSync(
    path.join(folder, "theme.json"),
    document + " ".repeat(OVER_THE_BOUND_BYTES - document.length),
  );
}

function startHost(): ChildProcess {
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

  return child;
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
  throw new Error(`the over-large-theme host never answered on ${PORT}`);
}

let host: ChildProcess | undefined;

test.beforeAll(async () => {
  rmSync(APP_DIR, { recursive: true, force: true });
  seedLibrary();
  host = startHost();
  await waitForHost();
});

test.afterAll(() => {
  host?.kill();
  rmSync(APP_DIR, { recursive: true, force: true });
});

test("a stored theme past the size bound is reported, not opened as success", async ({
  page,
}) => {
  await page.goto(`${HOST}/editor/?theme=${THEME_ID}`);

  // The status element names the problem, in place of the "Editor ready" that
  // used to stand over a document never opened.
  await expect(page.locator("#status")).toContainText("too large");
  await expect(page.locator("#status-message")).not.toHaveText("Editor ready");

  // The over-large document did not open: what is mounted is the template. The
  // bridge is the reader the header chip uses, so this is the product's own
  // answer to "which document is open", not a probe.
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
  expect(documentName).not.toBe(THEME_ID);
});
