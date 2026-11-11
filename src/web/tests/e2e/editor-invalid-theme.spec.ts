import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { hostEditorUrl } from "./host-editor-url.js";

/**
 * `vg-110`'s third clause, on a real host: **the editor reports success over a
 * document it never opened.**
 *
 * A `theme.json` on disk that fails validation was answered, to every reader,
 * as though the theme were not there: the store returned `undefined`, the open
 * route answered `404 Theme not found`, and `boot-theme`'s `openQuietly`
 * swallowed even that — so the editor mounted the template and wrote "Fabric
 * editor ready" while the document the URL named had never opened.
 *
 * **The case starts its own host, over its own app folder.** The library is a
 * directory the host is pointed at (`cli/args.ts`), so a private `--app-dir`
 * gives this file a library with exactly one broken theme and no dependence on
 * whatever the shared host project left on disk. `--port` keeps it off every
 * other proof's socket. It is loopback-only, which is where Playwright already
 * is.
 *
 * **It asserts the two visible facts, not a count or a geometry.** The status
 * element names the validation problem, and the document that is open is the
 * template rather than the broken theme — read through the bridge's own
 * `snapshot()`, the same projection the header chip reads.
 */

const PORT = 4231;
const APP_DIR = path.join(os.tmpdir(), "yunari-invalid-theme-app");
const THEMES_DIR = path.join(APP_DIR, "themes");
const HOST = `http://127.0.0.1:${PORT}`;

const THEME_ID = "e2e-invalid-theme";

/** The template `createNewFabricTheme` builds, named so the open document can
 *  be told from the broken one that shares no name of its own. */
const TEMPLATE_NAME = "System dashboard";

/**
 * One theme folder whose `theme.json` is valid JSON and not a valid envelope:
 * it carries an id and nothing else, so the validator's first complaint is the
 * missing `schemaVersion`. The reason the status element must repeat is a fact
 * of the document, not a status number.
 */
function seedLibrary(): void {
  const folder = path.join(THEMES_DIR, THEME_ID);
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    path.join(folder, "theme.json"),
    JSON.stringify({ id: THEME_ID }),
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
  throw new Error(`the invalid-theme host never answered on ${PORT}`);
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

test("a stored theme that does not validate is reported, not opened as success", async ({
  page,
}) => {
  await page.goto(hostEditorUrl(HOST, { themeId: THEME_ID }));

  // The status element names the problem the validator found, in place of the
  // "Editor ready" that used to stand over a document never opened.
  await expect(page.locator("#status")).toContainText(
    "schemaVersion is required",
  );
  await expect(page.locator("#status-message")).not.toHaveText("Editor ready");

  // The invalid document did not open: what is mounted is the template. The
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
