import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { writeThemePackage } from "@yunari/theme-package";
import { canvasProp } from "./canvas-probe.js";
import { chooseIn } from "./control-set.js";

/**
 * A custom HTTP source, authored on the Host page and read on a display.
 *
 * **The whole loop is the proof**: the source is added through the editor's own
 * Sources section, its key appears in the selection inspector's Reads select,
 * the player renders the value the fixture endpoint serves, and deleting the
 * source leaves the bound reading an em dash with the host's own reason on
 * screen. Nothing here is stubbed into the page: the endpoint, the host, the
 * editor and the player are four real processes (one of them a `node:http`
 * fixture this file starts).
 *
 * Its own host on its own port, because the app folder holds a fixture theme
 * and a `sources.json` this file writes through the product. The folder is
 * minted under the OS temp directory and removed again, so a filesystem walk of
 * the worktree never sees a test store.
 */

/** The host's port. 4221–4224 belong to other proofs and 4223 is the display
 *  runner's editor preview, so this spec owns 4225. */
const PORT = 4225;
/** The fixture endpoint's port, distinct from every Playwright host port. */
const FIXTURE_PORT = 4291;

let appDir = "";
const THEMES_DIR = (): string => path.join(appDir, "themes");
const SETTINGS_DIR = (): string => path.join(appDir, "settings");
const HOST = `http://127.0.0.1:${PORT}`;
const THEME_ID = "e2e-custom-source";
const NODE_ID = "reading";
const SOURCE_ID = "fixture";
const SOURCE_KEY = `custom.${SOURCE_ID}.cpu-load`;
const SOURCE_URL = `http://127.0.0.1:${FIXTURE_PORT}/data`;
/** What the endpoint serves; the display's reading is this number. */
const READING = 42.5;

/**
 * The conversion case, seeded as files rather than driven through the source
 * form: `unit` and `unitKind` are `CustomField` keys the form does not expose,
 * and the host reads `sources.json` at boot.
 *
 * 100 °C is 212 °F exactly, and the renderer's default precision prints it
 * without a decimal, so the expected text is derived from the conversion rule
 * rather than guessed.
 */
const TEMP_SOURCE_ID = "temp-fixture";
const TEMP_SOURCE_KEY = `custom.${TEMP_SOURCE_ID}.temp`;
const TEMP_SOURCE_URL = `http://127.0.0.1:${FIXTURE_PORT}/temp`;
const TEMP_THEME_ID = "e2e-custom-source-unit";
const TEMP_CELSIUS = 100;
const TEMP_FAHRENHEIT_TEXT = "212°F";

test.describe.configure({ timeout: 120_000 });

/**
 * A textbox whose point is a value run bound to a reading. The binding is live
 * before the case starts, so the run's Reads select is on screen from the first
 * selection; the case changes which key it names.
 *
 * The authored placeholder is `--`, so the run's own text is never mistaken for
 * the renderer's missing-reading mark.
 */
const envelope = {
  schemaVersion: "2.0.0" as const,
  fabricVersion: "7.4.0",
  id: THEME_ID,
  metadata: { name: "E2E custom source", themeLanguage: "en" },
  artboard: { width: 640, height: 360, contentFit: "contain" as const },
  background: { color: { ref: "palette.bar" as const } },
  globals: {
    palette: {
      none: {
        name: "None",
        value: { kind: "solid" as const, color: "transparent" },
      },
      bar: { name: "Bar", value: { kind: "solid" as const, color: "#101318" } },
      ink: { name: "Ink", value: { kind: "solid" as const, color: "#e8ecf3" } },
    },
    typeTokens: {
      heading: { family: "system-ui, sans-serif", weight: "600" },
      body: { family: "system-ui, sans-serif", weight: "400" },
      mono: { family: "ui-monospace, monospace", weight: "400" },
    },
  },
  assets: [],
  scene: {
    version: "7.4.0" as const,
    objects: [
      {
        type: "Textbox" as const,
        version: "7.4.0" as const,
        originX: "left" as const,
        originY: "top" as const,
        left: 60,
        top: 120,
        width: 400,
        height: 60,
        text: "--",
        fontSize: 20,
        fontFamily: "system-ui, sans-serif",
        fill: "palette.ink",
        id: NODE_ID,
        yunariPaint: { fill: "palette.ink" as const },
        yunariText: {
          runs: [
            {
              kind: "value" as const,
              bindingId: "read",
              typeToken: "typeTokens.body",
              style: {
                color: { ref: "palette.ink" as const },
                fontSize: { value: 20 },
              },
            },
          ],
        },
      },
    ],
  },
  bindings: {
    [NODE_ID]: [{ id: "read", semanticKey: "cpu.load" }],
  },
};

/** The same scene, bound to the temperature source and asking for °F. */
const temperatureEnvelope = {
  ...envelope,
  id: TEMP_THEME_ID,
  metadata: { name: "E2E custom source unit", themeLanguage: "en" },
  bindings: {
    [NODE_ID]: [{ id: "read", semanticKey: TEMP_SOURCE_KEY, unit: "°F" }],
  },
};

function seedLibrary(): void {
  for (const theme of [envelope, temperatureEnvelope]) {
    const result = writeThemePackage({ envelope: theme, assets: {} });
    if (!result.ok) {
      throw new Error(`custom-source fixture is invalid: ${result.message}`);
    }

    const folder = path.join(THEMES_DIR(), theme.id);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "theme.json"), JSON.stringify(theme));
  }
}

/** A source the form cannot author: the field's unit and conversion kind are
 *  read from this file at boot, not entered on the page. */
function seedSources(): void {
  mkdirSync(SETTINGS_DIR(), { recursive: true });
  writeFileSync(
    path.join(SETTINGS_DIR(), "sources.json"),
    JSON.stringify({
      sources: [
        {
          id: TEMP_SOURCE_ID,
          name: "Temperature fixture",
          url: TEMP_SOURCE_URL,
          intervalMs: 10_000,
          timeoutMs: 1_000,
          fields: [
            {
              id: "temp",
              label: "Temperature",
              pointer: "/temp",
              type: "number",
              unit: "°C",
              unitKind: "temperature",
            },
          ],
        },
      ],
    }),
  );
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
      appDir,
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
  throw new Error(`the custom-source host never answered on ${PORT}`);
}

/** The endpoint a source reads: the one shape each case asserts on. */
async function startFixture(): Promise<Server> {
  const server = createServer((request, response) => {
    const body =
      request.url === "/temp"
        ? { temp: TEMP_CELSIUS }
        : { cpu: { load: READING } };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });

  await new Promise<void>((resolve) => {
    server.listen(FIXTURE_PORT, "127.0.0.1", resolve);
  });
  return server;
}

async function editorReady(page: Page): Promise<void> {
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();
  await page.waitForFunction(() => "yunariEditorBridge" in window);
}

/** The Host mode's Sources section, over the host this file started. */
async function openSources(page: Page): Promise<void> {
  await page.locator("#yunari-shell-modes-this-pc").click();
  await expect(
    page.locator('[data-yunari-host-section="sources"]'),
  ).toBeVisible();
}

/** Adds the fixture source through the page's own form. */
async function addSource(page: Page): Promise<void> {
  await page.locator("[data-yunari-source-add]").click();
  const form = page.locator("[data-yunari-source-form]");
  await expect(form).toBeVisible();

  await page.locator("[data-yunari-source-id]").fill(SOURCE_ID);
  await page.locator("[data-yunari-source-name]").fill("Fixture");
  await page.locator("[data-yunari-source-url]").fill(SOURCE_URL);

  await page.locator("[data-yunari-source-add-field]").click();
  await page.locator("[data-yunari-source-field-id]").fill("cpu-load");
  await page.locator("[data-yunari-source-field-label]").fill("CPU load");
  await page.locator("[data-yunari-source-field-pointer]").fill("/cpu/load");

  await page.locator("[data-yunari-source-save]").click();
  await expect(
    page.locator(`[data-yunari-source-row="${SOURCE_ID}"]`),
    "the source did not land in the list",
  ).toBeVisible({ timeout: 15_000 });
}

/** The player's scene, once its handle exists. */
async function playerReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const handle = (window as unknown as { yunari?: { handle?: unknown } })
      .yunari?.handle;
    return handle !== undefined;
  });
}

let host: ChildProcess | undefined;
let fixture: Server | undefined;

test.beforeAll(async () => {
  appDir = mkdtempSync(path.join(tmpdir(), "yunari-custom-source-"));
  mkdirSync(THEMES_DIR(), { recursive: true });
  seedLibrary();
  seedSources();
  fixture = await startFixture();
  host = await startHost();
});

test.afterAll(async () => {
  host?.kill();
  await new Promise<void>((resolve) => {
    if (fixture === undefined) {
      resolve();
      return;
    }
    fixture.close(() => resolve());
  });
  rmSync(appDir, { recursive: true, force: true });
});

test("a source authored on the page is read on a display, and its deletion explains the gap", async ({
  page,
}) => {
  await page.goto(`${HOST}/editor/?theme=${THEME_ID}`);
  await editorReady(page);

  // 1. The source is authored through the Host page's own form.
  await openSources(page);
  await addSource(page);

  // 2. The editor's catalogue is read at boot, so the key appears after the
  //    page reopens — the same reopen an author does after adding a source.
  const sensors = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/sensors",
  );
  await page.reload();
  await sensors;
  await editorReady(page);

  // 3. The run's Reads select offers the host's new key — discovery is the
  //    catalogue answering, not a hard-coded list in the editor.
  await page.locator(`[data-yunari-layer="${NODE_ID}"]`).click();
  await chooseIn(page, '[data-yunari-run-source="0"]', SOURCE_KEY);
  await expect(
    page.locator('[data-yunari-run-source="0"] [data-yunari-value]'),
    "the run did not take the custom key",
  ).toHaveAttribute("data-yunari-value", SOURCE_KEY);

  // 4. The document is saved to the host, then opened on a display.
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save to library" }).click();
  await expect(page.locator("#status")).toContainText("Saved to library", {
    timeout: 20_000,
  });

  const player = await page.context().newPage();
  await player.goto(`${HOST}/?theme=${THEME_ID}&data=live`);
  await expect(player.locator("#artboard canvas.lower-canvas")).toBeVisible();
  await playerReady(player);

  // The reading the fixture endpoint serves, as the display paints it.
  await expect
    .poll(() => canvasProp(player, NODE_ID, "text"), {
      timeout: 25_000,
      message: "the display never painted the custom source's reading",
    })
    .toBe(String(READING));

  // 5. Deleting the source leaves the binding with no provider.
  await openSources(page);
  await page.locator(`[data-yunari-source-delete="${SOURCE_ID}"]`).click();
  await page
    .locator(`[data-yunari-source-confirm-delete="${SOURCE_ID}"]`)
    .click();
  await expect(
    page.locator(`[data-yunari-source-row="${SOURCE_ID}"]`),
    "the deleted source is still listed",
  ).toHaveCount(0);

  // 6. The display reloads: the theme still loads, the reading is the missing
  //    mark, and the host's reason is on the wall. The reason is read from the
  //    player's availability strip — the only surface a display has for it.
  await player.reload();
  await expect(player.locator("#artboard canvas.lower-canvas")).toBeVisible();
  await playerReady(player);

  await expect(
    player.locator("#yunari-availability"),
    "the display gave no reason for the missing reading",
  ).toContainText("no provider on this PC reports that sensor", {
    timeout: 20_000,
  });
  await expect
    .poll(() => canvasProp(player, NODE_ID, "text"), {
      timeout: 15_000,
      message: "the bound reading did not fall back to the missing mark",
    })
    .toBe("—");

  // The theme itself still loaded: the node's authored box is on the canvas.
  await expect(player.locator("#artboard canvas.lower-canvas")).toBeVisible();
  await player.close();
});

/**
 * The display's own conversion: the source reports 100 °C, the theme asks for
 * °F, and the player turns the reading into 212 °F. The descriptor that says
 * the custom key is a temperature comes from the host's `/api/sensors`, which
 * is why removing that pass from the player leaves the raw `100°C` on the wall.
 */
test("a display shows a custom source's reading in the unit the theme asks for", async ({
  page,
}) => {
  await page.goto(`${HOST}/?theme=${TEMP_THEME_ID}&data=live`);
  await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();
  await playerReady(page);

  await expect
    .poll(() => canvasProp(page, NODE_ID, "text"), {
      timeout: 25_000,
      message: "the display never painted the converted temperature",
    })
    .toBe(TEMP_FAHRENHEIT_TEXT);

  const painted = String(await canvasProp(page, NODE_ID, "text"));
  expect(painted).toContain("°F");
  expect(painted).not.toContain("°C");
});
