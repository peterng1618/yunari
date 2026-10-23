import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { writeThemePackage } from "@yunari/theme-package";

/**
 * The header's publish surface, on a real host that is actually serving the LAN.
 *
 * **The editor is driven through the host's own `/editor/` mount**, not the
 * `vite preview` server. `createThemeLibraryClient()` uses `baseUrl: ""`, so the
 * editor fetches same-origin — and under `vite preview` that is a preview server
 * answering `/api/*` with a 404. The host's `/editor/` mount is loopback-only,
 * which is where Playwright already is, so it is the only arrangement in which
 * `/api/hosting` is genuinely the same origin as the page.
 *
 * One real host, on its own port, over its own app folder, started **loopback-only
 * and without `--host`** — §145's default and Phase 3's whole claim: nothing but
 * this PC can reach the socket until somebody uses the control. The address it
 * reports once the control has been used is whatever `lanAddress()` answered on
 * this machine, which is the point: the header must render the *host's* answer
 * and never compose one of its own.
 *
 * **What this file does not prove.** That a camera on a particular phone, at a
 * particular distance, in a particular light, reads a code off a glossy screen.
 * That needs a phone and a person. Three things stand in its place and none of
 * them is that: `cli/hosting.test.ts` measures a real socket rebind on the same
 * port, `server.test.ts` refuses a non-loopback request until a session is
 * presented, and `qr-code.test.ts` decodes the symbol through a second library.
 * The gap is named rather than implied away by a green suite.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
/** A port no other agent and no Playwright runner owns. */
const PORT = 4227;
const APP_DIR = path.join(here, "..", "..", ".e2e-publish-app");
const THEMES_DIR = path.join(APP_DIR, "themes");
const HOST = `http://127.0.0.1:${PORT}`;

const THEME_ID = "e2e-publish";

/** One minimal, valid package, so the host starts with a real library rather
 *  than an empty folder. */
const envelope = {
  schemaVersion: 2 as const,
  fabricVersion: "7.4.0",
  id: THEME_ID,
  metadata: { name: "E2E publish", themeLanguage: "en" },
  artboard: {
    width: 640,
    height: 360,
    contentFit: "contain" as const,
  },
  background: { color: { ref: "palette.bar" as const } },
  globals: {
    palette: {
      // The immutable transparent token every package must carry.
      none: {
        name: "None",
        value: { kind: "solid" as const, color: "transparent" },
      },
      bar: { name: "Bar", value: { kind: "solid" as const, color: "#101318" } },
    },
    typePresets: {},
  },
  assets: [],
  scene: { version: "7.4.0" as const, objects: [] },
};

function seedLibrary(): void {
  const result = writeThemePackage({ envelope, assets: {} });
  if (!result.ok)
    throw new Error(`publish fixture is invalid: ${result.message}`);

  const folder = path.join(THEMES_DIR, THEME_ID);
  mkdirSync(path.join(folder, "assets"), { recursive: true });
  writeFileSync(path.join(folder, "theme.json"), JSON.stringify(envelope));
}

/** Loopback only, with no `--host`: the app directory is empty, so there is no
 *  `hosting.json` either and the host takes §145's default. */
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
  throw new Error(`the publish host never answered on ${PORT}`);
}

test.describe("the header's publish surface", () => {
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

  test("the LAN is turned on from the editor, and the port does not move", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await page.goto(`${HOST}/editor/`);

    // The bar's control opens the surface; the host switch is inside it (§7.1
    // puts the facts behind the press, and F1 puts the switch with them: a
    // press that only meant "where is the address" must not stop a session).
    const publish = page.locator("[data-yunari-publish]");
    const facts = page.locator(".editor-shell-publish-popup");
    const host = facts.locator("[data-yunari-host-switch]");
    await expect(publish).toBeVisible({ timeout: 30_000 });
    // The bar itself never carries an address.
    await expect(page.locator(".editor-shell-header code")).toHaveCount(0);

    await publish.click();
    await expect(host).toBeVisible();
    await expect(host).toHaveAttribute("aria-pressed", "false");
    await expect(facts.locator("code")).toHaveCount(0);

    await host.click();

    await expect(host).toHaveAttribute("aria-pressed", "true");
    await expect(facts.locator("code")).toHaveText(new RegExp(`:${PORT}$`));
    await expect(facts.locator("[data-yunari-qr]")).toBeVisible();

    // Still the same origin, which is the claim `createHostBinding` makes.
    expect(page.url()).toContain(`127.0.0.1:${PORT}/editor/`);

    await host.click();
    await expect(facts.locator("code")).toHaveCount(0);
  });

  test("the control carries the address and a code for it", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await page.goto(`${HOST}/editor/`);

    const publish = page.locator("[data-yunari-publish]");
    const facts = page.locator(".editor-shell-publish-popup");
    const host = facts.locator("[data-yunari-host-switch]");
    await expect(publish).toBeVisible({ timeout: 30_000 });

    // The host starts loopback-only, so the address exists only once the switch
    // inside the surface has been used — there is no `--host` flag left to
    // arrange it with, and opening the surface is not turning the LAN on.
    await publish.click();
    await host.click();
    await expect(facts.locator("code")).toBeVisible({ timeout: 30_000 });

    const shown = await facts.locator("code").textContent();
    // https, the origin a display is a secure context at; the popup prints the
    // plain address beside it as the fallback (`docs/decisions/0076`).
    expect(shown).toMatch(/^https:\/\/\d+\.\d+\.\d+\.\d+:\d+$/);

    const qr = facts.locator("[data-yunari-qr]");
    const box = await qr.boundingBox();
    // A camera needs modules, not a thumbnail: 45 modules at 3 px.
    expect(box?.width).toBeGreaterThanOrEqual(120);
    expect(
      (await qr.getAttribute("aria-label"))?.startsWith("QR code: https://"),
    ).toBe(true);

    // 1680 px, which is the `publish` project's own viewport.
    await page.screenshot({
      path: "test-results/publish/header-desktop.png",
      fullPage: false,
    });

    // The same control at a phone's width, and *read* rather than only
    // photographed. Whether the surface is still inside that viewport is
    // `vg-172`'s question, not this assertion's: it says the control is still
    // rendered, which is all a DOM read can say about it.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(facts.locator("code")).toBeVisible();
    await expect(qr).toBeVisible();

    // **And it is inside the window rather than clipped by it.** What `vg-172`
    // recorded at this width was a surface running past the right edge with
    // nothing to scroll it back: a 327.3px publish root from left 232.5, its
    // address code ending at 401.9 and its 135px QR beginning at 413.9, wholly
    // unseen — and `documentElement.scrollWidth` equal to `innerWidth`, so the
    // overflow was clipped rather than reachable. Measured on the built bundle
    // at 390px with the LAN on (2026-10-12): the popup is 238.3px from 144 to
    // 382.3, its code 156.8 to 369.5, the QR 156.8 to 291.8, and the document
    // still reports no horizontal scroll. This asserts the claim rather than
    // those numbers — a surface a person cannot reach is the defect, and a
    // scrollbar would not be the repair.
    const windowWidth = await page.evaluate(() => window.innerWidth);
    for (const [what, where] of [
      ["the publish surface", facts],
      ["the address", facts.locator("code")],
      ["the camera's code", qr],
    ] as const) {
      const box = await where.boundingBox();
      expect(box, `${what} is rendered`).not.toBeNull();
      // **A pixel of fractional layout, not of repair.** The layout viewport is
      // fractional (390.265 at this width) while `innerWidth` reports the
      // integer 390, so a surface flush to the true edge reads as 0.3px past
      // the rounded one. Anything larger is the overrun this assertion is for.
      expect(
        (box?.x ?? 0) + (box?.width ?? 0),
        `${what} ends inside the window rather than past it`,
      ).toBeLessThanOrEqual(windowWidth + 1);
      expect(
        box?.x ?? -1,
        `${what} begins inside the window too`,
      ).toBeGreaterThanOrEqual(0);
    }

    await page.screenshot({
      path: "test-results/publish/header-390.png",
      fullPage: false,
    });

    // Leave the host off, because the first test reads the off state. The
    // surface stays open, so this also proves closing it is not required to
    // put the display back.
    await host.click();
    await expect(facts.locator("code")).toHaveCount(0);

    // And the surface shuts on a second press, leaving the bar with nothing but
    // the one control.
    await publish.click();
    await expect(facts).toBeHidden();
    await expect(page.locator(".editor-shell-header code")).toHaveCount(0);
  });

  test("a forwarded-for header does not move the guard off the socket", async ({
    request,
  }) => {
    const answered = await request.put(`${HOST}/api/hosting`, {
      data: { lan: true },
      headers: { "x-forwarded-for": "192.168.1.50" },
    });
    // A *header* claiming another origin changes nothing, because the guard reads
    // `request.socket.remoteAddress` — which is why this is 200 from loopback and
    // why the refusal itself is `server.test.ts`'s to prove, not this file's. The
    // test is here to pin the direction: a proxy header must never be what decides
    // whether this PC is exposed.
    expect(answered.status()).toBe(200);
  });
});
