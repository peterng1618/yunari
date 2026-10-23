import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { writeThemePackage } from "@yunari/theme-package";
import { captureVisualReview } from "./editor-canvas.js";
import { openPane } from "./editor-rail.js";

/**
 * The whole publish loop, proved on a real host: an author edits a document in
 * the editor, a display showing the same theme follows the edit, and the author
 * leaving puts the display back on the stored theme.
 *
 * **The editor is driven through the host's own `/editor/` mount**, never a
 * `vite preview` server. `createThemeLibraryClient()` fetches same-origin
 * (`baseUrl: ""`), and under `vite preview` the preview server answers `/api/*`
 * with a 404 — so the host's `/editor/` mount is the only arrangement in which
 * `/api/hosting`, `/api/publish` and `/api/published` are the same origin as
 * the page. It is loopback-only, which is where Playwright already is.
 *
 * **One real host, on its own port, over its own app folder**, started
 * loopback-only and without `--host` — §145's default and the shape Phase 3
 * built. The LAN is turned on from the editor's own control, which is what
 * starts publishing.
 *
 * **A real phone is not available.** The display here is a phone-sized
 * Chromium (390 × 844), and the QR the header renders is proved by
 * `qr-code.test.ts`'s round-trip through a second library — that the matrix is
 * a QR symbol for the URL, not that a camera reads it off a screen. Nothing in
 * this file closes that gap, and no green run should be read as though it did.
 *
 * **Every helper is a pointer or a keystroke against a delivered control.**
 * The artboard is changed by typing into the panel's own width and height
 * boxes, the way an author does; `rebuild-driver.ts:10-14` states the rule, and
 * a `page.evaluate` writing the scene would be a finding about the surface
 * rather than a technique for this test.
 *
 * **The picture this writes is the proof, and it is only a proof because the
 * artboard is painted.** The published frame is 320x240 against a stored
 * 640x360, so a 4:3 light band on the dark page is the one thing in the file
 * that shows the display followed the editor. `vg-176` made that band absent:
 * the hosted display's `envelopePlan` (`player/src/main.ts:396-408`) passes the
 * artboard paint through unresolved, so a palette reference paints nothing and
 * the page reads black. A capture taken before that row was fixed is a black
 * rectangle proving nothing either way — which is what this task first
 * delivered, and why the capture is registered rather than written to
 * `test-results/`, which is gitignored and persists nothing.
 */

/** A port no other agent and no Playwright runner owns. */
const PORT = 4229;
/** Outside the repository tree: the host writes theme folders here. */
const APP_DIR = path.join(os.tmpdir(), "yunari-publish-loop-app");
const THEMES_DIR = path.join(APP_DIR, "themes");
const HOST = `http://127.0.0.1:${PORT}`;

const THEME_ID = "e2e-publish-loop";

/** One minimal, valid package, so the host starts with a real library and the
 *  editor has a saved theme to open — publishing carries the document and its
 *  assets from the theme's own folder, so a document the library does not hold
 *  has nothing to publish.
 *
 *  **The artboard is light and the bars are dark, so the screenshot says
 *  something.** The stored frame is 640 × 360 and the published one is
 *  320 × 240: the same paper in a 4:3 frame rather than a 16:9 one, which is a
 *  change a reader can see. A dark artboard on a dark page would make the
 *  picture a black rectangle that proves nothing either way. */
const envelope = {
  schemaVersion: 2 as const,
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
    typePresets: {},
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

/** Loopback only, with no `--host`: §145's default, and the state the editor's
 *  publish control turns on. */
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

/**
 * Opens the publish surface and leaves the LAN on.
 *
 * **The press is free of side effects.** The header's button opens the facts
 * and does nothing else, so this presses it, turns the host on with the
 * surface's own switch if it is off, and then waits for the **pairing facts**,
 * which render only once a phone can actually pair. That wait is the assertion:
 * it is the only one in this file that says the address and the code appeared.
 *
 * **Only if it is off.** The hosting preference is a fact about this PC and
 * survives a restart (Task 3.1), so the second test's host boots already
 * serving the LAN and its switch already says `Stop publishing` — clicking it
 * unconditionally would turn the LAN *off*.
 *
 * The surface is shut again afterwards, because everything that follows drives
 * the canvas rather than this popover.
 */
async function startPublishing(page: Page): Promise<void> {
  const publish = page.locator("[data-yunari-publish]");
  const facts = page.locator(".editor-shell-publish-popup");
  const host = facts.locator("[data-yunari-host-switch]");
  await expect(publish).toBeVisible({ timeout: 30_000 });

  await publish.click();
  await expect(host).toBeVisible({ timeout: 30_000 });
  if ((await host.getAttribute("aria-pressed")) === "false") await host.click();

  await expect(host).toHaveAttribute("aria-pressed", "true", {
    timeout: 30_000,
  });
  await expect(facts.locator("[data-yunari-qr]")).toBeVisible({
    timeout: 30_000,
  });

  await publish.click();
  await expect(facts.locator("[data-yunari-qr]")).toBeHidden({
    timeout: 10_000,
  });
}

/**
 * The document id the host is publishing, as the **display's own browser**
 * reads it, or `undefined` when that read died under a navigation.
 *
 * The display reloads whenever the revision moves — that is the whole subject
 * of these tests — so a read taken while the follower is reloading the page
 * throws `Execution context was destroyed`, which the Phase 4 boundary gate
 * measured under load after the same spec had passed alone twice.
 *
 * `undefined` is not `null` here and the callers keep them apart: `null` is the
 * host saying "nothing is published", `undefined` is "this read did not
 * happen". Only the first may satisfy the poll that expects the overlay
 * cleared, which is why that one maps `undefined` to a string that is not
 * `null` rather than letting it pass as one.
 */
async function readPublishedId(page: Page): Promise<string | null | undefined> {
  try {
    return (
      await page.evaluate(
        async () =>
          (await (await fetch("/api/published")).json()) as {
            id: string | null;
          },
      )
    ).id;
  } catch {
    return undefined;
  }
}

/**
 * Clear the host's published overlay.
 *
 * **The overlay outlives a browser context.** Playwright tears a context down
 * by killing its pages, which does not run `pagehide`, so a test that published
 * leaves the document up for the next one. A test about *this* editor closing
 * has to start from the host holding nothing, or its poll can pass on what a
 * closed tab published — and that editor's own clear is a no-op when it never
 * PUT anything. `DELETE /api/publish` is the editor's own clear route;
 * `/api/published` is the display's read and ignores the method.
 */
async function clearPublished(): Promise<void> {
  await fetch(`${HOST}/api/publish`, { method: "DELETE" });
}

/** The artboard of the document the host serves for the published id, or
 *  `undefined` when the read raced a reload. */
async function readPublishedArtboard(
  page: Page,
): Promise<{ width: number; height: number } | undefined> {
  try {
    return await page.evaluate(async () => {
      const published = (await (await fetch("/api/published")).json()) as {
        id: string | null;
      };
      const document = (await (
        await fetch(`/api/themes/${published.id}/document`)
      ).json()) as { artboard: { width: number; height: number } };
      return document.artboard;
    });
  } catch {
    return undefined;
  }
}

/**
 * Whether the display page still carries the mark it was given.
 *
 * **A destroyed execution context answers "yes, the mark is still here".** The
 * follower reloads *this* page, so the read races the navigation it is waiting
 * for. Swallowing that and answering `true` only ever *delays* the pass: the
 * next tick reads the fresh document, where the property is gone. It cannot
 * manufacture one, and a page that never settles still times out.
 */
async function markStillSet(
  page: Page,
  key: "__beforePublish" | "__beforeStop",
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

  test("an edit reaches the display while the editor has it open", async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(180_000);

    await page.goto(`${HOST}/editor/`);
    await startPublishing(page);

    const display = await context.newPage();
    await display.setViewportSize({ width: 390, height: 844 });
    await display.goto(`${HOST}/`);
    await expect(display.locator("#artboard")).toBeVisible({ timeout: 30_000 });

    // Mark the display's own window *before* anything can reload it, and wait
    // for the mark to vanish: only a reload can clear it. Marking after the
    // edit is the same test with a race in it — the reload would land on the
    // marked page and the poll would wait for a mark nothing is left to clear.
    //
    // A screenshot-length comparison was the obvious oracle and is not one:
    // PNG length moves for fonts settling and a chart repaint, so it can go
    // green with the follower switched off, which is the one thing this test
    // exists to detect.
    await display.evaluate(() => {
      (window as unknown as { __beforePublish?: boolean }).__beforePublish =
        true;
    });

    // The edit the display must follow, made the way an author makes it: typed
    // into the artboard panel's width and height boxes. Both commit on
    // `change` (`controls/number-field.ts:161-163`), and **`fill` does not
    // dispatch `change`** — it dispatches `input`, and `change` arrives when
    // the field loses focus, which is what an author does by leaving the box.
    // Task 4.5's own text said "no Enter, and no blur" and that is wrong: with
    // no blur neither edit is ever published (`/api/publish` sees no request at
    // all), which is what the run that wrote this comment measured.
    //
    // The two commits land ~70 ms apart and the publisher's 400 ms debounce
    // (`publish-client.ts:12`) coalesces them into **one** PUT carrying the
    // final size, so the display reloads once and every read below is
    // unambiguous.
    await openPane(page, "Document");
    await page.locator("[data-yunari-artboard-width]").fill("320");
    await page.locator("[data-yunari-artboard-width]").blur();
    await page.locator("[data-yunari-artboard-height]").fill("240");
    await page.locator("[data-yunari-artboard-height]").blur();
    // **The surface's own readout of what a display is showing**, which is the
    // claim that the *document* goes out rather than merely that a host is
    // serving. It is read where it lives — behind the press: the bar's control
    // says `Publish to a phone` whatever the host is doing, so an assertion on
    // its label would pass for a reason that has nothing to do with this.
    const facts = page.locator(".editor-shell-publish-popup");
    await page.locator("[data-yunari-publish]").click();
    await expect(facts).toContainText(/Showing E2E publish loop/, {
      timeout: 15_000,
    });
    await page.locator("[data-yunari-publish]").click();

    await expect
      .poll(() => markStillSet(display, "__beforePublish"), { timeout: 15_000 })
      .toBe(false);

    // Read the published id first: the display page is mounted through the
    // host's `/` redirect, so composing a document URL out of `location.search`
    // asks for a theme the display was not necessarily given, and a miss
    // parses a 404 body as JSON.
    //
    // This asserts the route prefers the published document — Task 4.2's claim.
    // That the *display* follows is the poll above, and neither implies the
    // other. The size is asserted rather than the whole artboard: the document
    // carries its fit and its two palette references as well, and `toEqual`
    // against two fields would be asserting those away.
    await expect
      .poll(() => readPublishedArtboard(display), { timeout: 15_000 })
      .toMatchObject({ width: 320, height: 240 });

    await captureVisualReview(display, testInfo, "publish-loop-live");
    await display.close();
  });

  test("closing the editor puts the display back on the stored theme", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);

    // **Start from the host holding nothing.** Playwright's context teardown
    // kills pages without running `pagehide`, so the previous test's overlay is
    // still up here; cleared before this page exists, the id that appears after
    // it can only be this tab's.
    await clearPublished();

    await page.goto(`${HOST}/editor/`);
    await startPublishing(page);

    const display = await context.newPage();
    await display.setViewportSize({ width: 390, height: 844 });
    await display.goto(`${HOST}/`);
    // The same reload marker as the first test, and it is what makes this test
    // about the display rather than about the host.
    await display.evaluate(() => {
      (window as unknown as { __beforeStop?: boolean }).__beforeStop = true;
    });
    // The publish is offered when the switch is turned on and PUT 400 ms later
    // (`publish-client.ts:12`), so the overlay is not there the instant the QR
    // appears. Waiting for it is what makes "the host holds a published
    // document" a fact this test rests on rather than a race it usually wins.
    //
    // The id itself, not `.not.toBeNull()`: a read that raced a reload answers
    // `undefined`, and `not.toBeNull()` would accept that as a published
    // document.
    await expect
      .poll(() => readPublishedId(display), { timeout: 15_000 })
      .toBe(THEME_ID);

    // `pagehide` is the only hook this has: a crash or a killed browser leaves
    // the overlay in the host's memory, which is the ceiling Task 4.4's
    // `ponytail:` names rather than hides.
    //
    // **Proved by `page.close()`, not by a navigation away.** Step 3's second
    // break removed the `pagehide` listener from `editor-main.ts` and this test
    // went red, so `page.close()` does fire `pagehide` here and the exit the
    // assertion rests on is the one an editor tab being closed takes. What is
    // *not* proved: a crash, a killed process or a lost network, which the
    // `ponytail:` above owns.
    await page.close();

    // A read that raced the reload answers `"unread"` rather than `null`, so
    // "I could not ask the host" cannot satisfy an assertion about what the
    // host holds — only the host's own `null` can. (`??` would not do it:
    // nullish coalescing swallows the `null` this poll is waiting for.)
    await expect
      .poll(
        async () => {
          const id = await readPublishedId(display);
          return id === undefined ? "unread" : id;
        },
        { timeout: 10_000 },
      )
      .toBeNull();

    // **The host clearing the overlay is not the claim; the display seeing it
    // is.** Without this poll the test passes with the follower switched off,
    // because the assertion above reads the host through the display's browser
    // and says nothing about what the display is showing. `clear()` moves the
    // revision exactly as `publish()` does (`serve/published.ts`), so the
    // follower reloads and only a reload clears this mark.
    await expect
      .poll(() => markStillSet(display, "__beforeStop"), { timeout: 15_000 })
      .toBe(false);

    await display.close();
  });

  /**
   * `vg-510`'s publishing half, as the sequence the row is about.
   *
   * `pagehide` is where a page is frozen into the back/forward cache, and the
   * editor stops the publisher on it — the host holds the document in its own
   * memory, so an editor that goes away without saying so leaves a phone
   * showing something nobody is editing any more. What was missing was the
   * other half: a page restored from that cache comes back with its state
   * intact and **no reload**, so nothing re-offered the document and the host
   * went on serving the stored theme for the rest of the session.
   *
   * The two events are dispatched rather than taken from a real navigation,
   * which is the honest ceiling: the browser fires them for us on a real
   * back/forward, and this is the same listener reading the same pair. The
   * repaint loop is stopped and re-armed by the same pair and has no reading of
   * its own here — its re-arm is proved in `chart-refresh.test.ts`.
   */
  test("a page that goes away and comes back is followed again", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // The same clean host as the close test: the overlay is the host's, and an
    // editor that never put anything up has nothing to take down.
    await clearPublished();

    await page.goto(`${HOST}/editor/`);
    await startPublishing(page);

    // The host is following this document. Offered when the switch went on, and
    // PUT 400 ms later (`publish-client.ts`).
    await expect
      .poll(() => readPublishedId(page), { timeout: 15_000 })
      .toBe(THEME_ID);

    // The author leaves: the page is frozen, and the editor says so.
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await expect
      .poll(() => readPublishedId(page), { timeout: 15_000 })
      .toBeNull();

    // And comes back, without a reload. The host has to be following the same
    // document again — at HEAD this poll is the whole failure: nothing listened
    // for `pageshow`, so the host sat on the stored theme.
    await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    await expect
      .poll(() => readPublishedId(page), { timeout: 15_000 })
      .toBe(THEME_ID);
  });
});
