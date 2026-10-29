import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import {
  HOST_DISK_THEME_ID,
  HOST_PORT,
  HOST_SETTINGS_DIR,
  HOST_THEME_ID,
  HOST_VIDEO_THEME_ID,
} from "./host-theme.js";
import { isDesktopSurface } from "./surface.js";

/** Drives the consumer settings page against the real host. The page is the
 * only surface where global settings and a theme's own questions meet, and the
 * difference is invisible anywhere else: reading `/api/devices` cannot tell a
 * choice the page hid from one the consumer saved.
 *
 * The last describe drives the chooser the host serves at `/` rather than this
 * page, because the theme list its two cases are about is that page's now. */

const HOST = `http://127.0.0.1:${HOST_PORT}`;

/** Every store sits in the app folder's settings directory, so each state below
 * is reachable by writing the same file the host reads — including after a
 * recycled server left state behind. They left the themes directory so that a
 * theme folder is only ever a theme (ADR-0017). */
const ACTIVE_FILE = path.join(HOST_SETTINGS_DIR, "active-theme.json");
const ANSWERS_FILE = path.join(HOST_SETTINGS_DIR, "theme-answers.json");

/**
 * The displays this host knows about, written by hand the same way the two
 * stores above are. Nothing else seeds a **paired** display, and the warning
 * table's other half needs one: a remote display is the row that must be told
 * nothing about a video background.
 *
 * Returns whatever was there before, so a record this spec invents is not left
 * behind for the cases that follow it.
 */
const DISPLAYS_FILE = path.join(HOST_SETTINGS_DIR, "display-clients.json");
const PAIRED_DISPLAY_ID = "kitchen-tablet";

function seedPairedDisplay(): string | undefined {
  let previous: string | undefined;
  try {
    previous = readFileSync(DISPLAYS_FILE, "utf8");
  } catch {
    previous = undefined;
  }

  const at = new Date("2026-10-19T00:00:00.000Z").toISOString();
  writeFileSync(
    DISPLAYS_FILE,
    `${JSON.stringify({
      displays: [
        {
          id: PAIRED_DISPLAY_ID,
          label: "Kitchen tablet",
          kind: "paired",
          createdAt: at,
          lastSeenAt: at,
          // A paired record with no credential is dropped on read: nothing
          // could ever authenticate as it, so it would not be a display.
          tokenHash: "e2e-paired-display-credential",
        },
      ],
    })}\n`,
    "utf8",
  );

  return previous;
}

function restoreDisplays(previous: string | undefined): void {
  if (previous === undefined) rmSync(DISPLAYS_FILE, { force: true });
  else writeFileSync(DISPLAYS_FILE, previous, "utf8");
}

function resetStores(): void {
  mkdirSync(HOST_SETTINGS_DIR, { recursive: true });
  writeFileSync(ACTIVE_FILE, "{}\n", "utf8");
  writeFileSync(ANSWERS_FILE, "{}\n", "utf8");
}

interface DeviceState {
  available: {
    gpus: { id: string; name: string }[];
    disks: { id: string; name: string }[];
  };
  assigned: Record<string, string>;
  names: Record<string, string>;
}

async function deviceState(request: APIRequestContext): Promise<DeviceState> {
  const body = (await (await request.get(`${HOST}/api/devices`)).json()) as {
    available: DeviceState["available"];
    assigned: {
      assigned?: Record<string, string>;
      names?: Record<string, string>;
    };
  };
  return {
    available: body.available,
    assigned: body.assigned.assigned ?? {},
    names: body.assigned.names ?? {},
  };
}

async function disksOn(request: APIRequestContext): Promise<string[]> {
  return (await deviceState(request)).available.disks.map((disk) => disk.id);
}

async function assignedSystemDisk(request: APIRequestContext): Promise<string> {
  return (await deviceState(request)).assigned["system-disk"] ?? "";
}

/** One theme's answers, for the display this page answers for. */
async function answersFor(
  request: APIRequestContext,
  id: string,
): Promise<Record<string, string>> {
  const response = await request.get(`${HOST}/api/themes/${id}/answers`);
  const body = (await response.json()) as { answers: Record<string, string> };
  return body.answers;
}

/** Chooses a theme for one display on the chooser: the row is pressed first,
 *  because a theme is given *to* a display and the page writes whichever row is
 *  showing. A successful write reloads the page, which comes back on the default
 *  row — so the press is confirmed against the host's own map by the caller,
 *  rather than against the pressed state the reload threw away. */
async function chooseTheme(
  page: Page,
  id: string,
  display = "default",
): Promise<void> {
  await page.locator(`#themes [data-display="${display}"]`).click();
  await page.locator(`button.theme-option[data-theme="${id}"]`).click();
}

/** Puts a theme on a display without driving a page's chooser: the theme a case
 *  needs as a precondition is host state, and the settings page has no chooser to
 *  press (`vg-649`). The host's own reason is thrown rather than a bare status,
 *  because the reason is the only thing that says which of the route's refusals
 *  a case hit. */
async function setActiveTheme(
  request: APIRequestContext,
  id: string,
  display = "default",
): Promise<void> {
  const response = await request.put(`${HOST}/api/themes/active`, {
    data: { display, id },
  });
  if (!response.ok()) throw new Error(await response.text());
}

const questions = (page: Page) => page.locator("#questions-section");

test.describe("the settings page a consumer configures", () => {
  // One host process and one set of stores, so these states are travelled in
  // order rather than in parallel.
  test.describe.configure({ mode: "serial" });

  /**
   * The removal this task is (R116): the page keeps this PC's own sections and
   * the questions a theme raises, and no longer lists themes. The listing is the
   * chooser's (`/`) and the store mode's local half.
   *
   * The devices are asserted first on purpose: `toHaveCount(0)` is satisfied by
   * a page that never rendered at all, so the section that is still there is
   * what says the page ran.
   */
  test("lists no themes, and keeps this PC's own sections", async ({
    page,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "one desktop pass owns the shared host state",
    );

    resetStores();
    await page.goto(`${HOST}/settings`);
    await expect(page.locator("#devices-heading")).toBeVisible();
    await expect(page.locator("#status")).toHaveText(
      "Changes apply to every display immediately.",
    );

    await expect(page.locator("#themes")).toHaveCount(0);
    await expect(page.locator("#themes-heading")).toHaveCount(0);
  });

  test("keeps this PC's devices on screen whatever theme is shown", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "one desktop pass owns the shared host state",
    );

    const disks = await disksOn(request);
    test.skip(disks.length === 0, "this machine reports no disks");

    resetStores();
    await page.goto(`${HOST}/settings`);
    const legends = page.locator("#groups fieldset legend");
    await expect(legends.first()).toBeVisible();
    const before = await legends.allTextContents();

    // The bug this guards: filtering the machine's own settings by the active
    // theme hides a drive the consumer chose and cannot reach again. The theme
    // is the host's state now rather than a press on this page, so the page is
    // loaded again under it — which is the read the filter would have to survive.
    await setActiveTheme(request, HOST_DISK_THEME_ID);
    await page.reload();
    await expect(legends.first()).toBeVisible();
    expect(await legends.allTextContents()).toEqual(before);

    await setActiveTheme(request, HOST_THEME_ID);
    await page.reload();
    await expect(legends.first()).toBeVisible();
    expect(await legends.allTextContents()).toEqual(before);
  });

  test("saves this PC's device choice with no theme chosen", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "one desktop pass owns the shared host state",
    );

    const disks = await disksOn(request);
    test.skip(disks.length === 0, "this machine reports no disks");

    resetStores();
    await page.goto(`${HOST}/settings`);
    await expect(questions(page)).toBeHidden();

    const chosen = disks[0]!;
    await page.locator('select[data-group="system-disk"]').selectOption(chosen);
    await expect(page.locator("#status")).toHaveText(
      "Saved. Displays update on their next frame.",
    );
    expect(await assignedSystemDisk(request)).toBe(chosen);

    await page.reload();
    await expect(page.locator('select[data-group="system-disk"]')).toHaveValue(
      chosen,
    );
  });

  test("names the device the consumer edited, not the first one", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "one desktop pass owns the shared host state",
    );

    const before = await deviceState(request);
    test.skip(
      before.available.disks.length < 2,
      "this machine reports fewer than two disks",
    );

    resetStores();
    const first = before.available.disks[0]!.id;
    const other = before.available.disks[1]!.id;
    const reported = before.available.disks[1]!.name;
    await request.put(`${HOST}/api/devices`, {
      data: { assigned: before.assigned, names: {} },
    });

    try {
      await page.goto(`${HOST}/settings`);

      // One field per reported device, labelled by that device. The bug this
      // guards: a group following the default points at no single device, and a
      // name field hung off the group renamed whichever device came first.
      const field = page.locator(`#groups input[data-name="${other}"]`);
      await expect(page.locator("#groups input[data-name]")).toHaveCount(
        before.available.gpus.length + before.available.disks.length,
      );
      await expect(
        page.locator(`label:has(input[data-name="${other}"])`),
      ).toHaveText(reported);
      await expect(page.locator('select[data-group="data-disk"]')).toHaveValue(
        "",
      );

      await field.fill("Archive");
      await field.blur();
      await expect(page.locator("#status")).toHaveText(
        "Saved. Displays update on their next frame.",
      );

      const after = await deviceState(request);
      expect(after.names[other]).toBe("Archive");
      expect(after.names[first]).toBeUndefined();
    } finally {
      await request.put(`${HOST}/api/devices`, {
        data: { assigned: before.assigned, names: before.names },
      });
    }
  });

  test("keeps both display preferences whichever one is saved", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "one desktop pass owns the shared host state",
    );

    // `display.json` is in the same directory but not in `resetStores`, so this
    // clears it too.
    await request.put(`${HOST}/api/display`, { data: {} });
    await page.goto(`${HOST}/settings`);
    await expect(page.locator("#timezone option").first()).toBeAttached();

    try {
      await page.locator("#measurement").selectOption("imperial");
      await expect(page.locator("#status")).toHaveText(
        "Saved. Displays already open keep their old units until they reload.",
      );

      // The host replaces the whole settings object, so a page that sent one
      // field at a time would drop the other without saying so.
      await page.locator("#timezone").selectOption("Asia/Tokyo");
      await expect(page.locator("#status")).toHaveText(
        "Saved. Displays update on their next frame.",
      );

      const body = (await (
        await request.get(`${HOST}/api/display`)
      ).json()) as { settings: unknown };
      expect(body.settings).toEqual({
        timeZone: "Asia/Tokyo",
        measurement: "imperial",
      });

      await page.reload();
      await expect(page.locator("#timezone")).toHaveValue("Asia/Tokyo");
      await expect(page.locator("#measurement")).toHaveValue("imperial");
    } finally {
      await request.put(`${HOST}/api/display`, { data: {} });
    }
  });

  test("asks a theme's disk question once, and remembers the answer", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "one desktop pass owns the shared host state",
    );

    const disks = await disksOn(request);
    test.skip(disks.length === 0, "this machine reports no disks");

    resetStores();
    const global = await assignedSystemDisk(request);
    // A disk this PC is not already using, so the theme's answer is a real
    // override rather than an echo of the machine's choice.
    const other = disks.find((disk) => disk !== global) ?? disks[0]!;

    await setActiveTheme(request, HOST_DISK_THEME_ID);
    await page.goto(`${HOST}/settings`);
    await expect(questions(page)).toBeVisible();
    // The theme reads a disk and nothing else, so one question, once.
    await expect(page.locator("#questions fieldset legend")).toHaveText([
      "System disk",
    ]);

    await page
      .locator('select[data-question="system-disk"]')
      .selectOption(other);
    await expect(page.locator("#status")).toHaveText(
      "Saved. Only this theme is affected.",
    );

    // Answered: the question stops being asked, and the answer is stored
    // against the theme rather than against the machine.
    await expect(questions(page)).toBeHidden();
    expect(await answersFor(request, HOST_DISK_THEME_ID)).toEqual({
      "system-disk": other,
    });
    expect(await assignedSystemDisk(request)).toBe(global);

    await page.reload();
    await expect(questions(page)).toBeHidden();
    await expect(page.locator('select[data-group="system-disk"]')).toHaveValue(
      global,
    );
  });

  /**
   * The answers URL resolves end to end, for the display this page answers for,
   * and the page says which one that is.
   *
   * The page builds it as
   * `/api/themes/<theme>/answers?display=<the display it answers for>`, so this
   * is where the page's own copy, the query, the route's `display` parameter and
   * the store's key all have to agree. A URL that dropped the query would still
   * answer 200 and still save; it would just save under a key the page never
   * named.
   *
   * **The page answers for the default and can answer for no other.** The column
   * that used to move it lived inside the theme list, and the listing is the
   * chooser's now (R153), so **the per-display half of this case rests on
   * `vg-649`** — answering for a display other than the default, on a page with
   * no editor open, is the capability the removal costs, and it is the user's to
   * decide rather than this case's to keep.
   */
  test("answers a theme's question for the default display, and says so", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "one desktop pass owns the shared host state",
    );

    const disks = await disksOn(request);
    test.skip(disks.length === 0, "this machine reports no disks");

    resetStores();
    const chosen = disks[0]!;
    await setActiveTheme(request, HOST_DISK_THEME_ID);

    await page.goto(`${HOST}/settings`);
    await expect(questions(page)).toBeVisible();
    // Said rather than left to be assumed, which is the whole of what R153
    // leaves the page to do about the display it answers for.
    await expect(page.locator("#questions-hint")).toContainText(
      "default display",
    );

    await page
      .locator('select[data-question="system-disk"]')
      .selectOption(chosen);
    await expect(page.locator("#status")).toHaveText(
      "Saved. Only this theme is affected.",
    );

    expect(await answersFor(request, HOST_DISK_THEME_ID)).toEqual({
      "system-disk": chosen,
    });
  });

  test("shows no questions for a theme that reads nothing", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "one desktop pass owns the shared host state",
    );

    resetStores();
    // A theme that *does* read something goes first: the section is hidden on
    // load, so `toBeHidden()` alone is satisfied by a page that never asked —
    // and the whole claim is that this page asked and found nothing to draw.
    await setActiveTheme(request, HOST_DISK_THEME_ID);
    await page.goto(`${HOST}/settings`);
    await expect(questions(page)).toBeVisible();

    await setActiveTheme(request, HOST_THEME_ID);
    await page.reload();
    await expect(questions(page)).toBeHidden();
  });
});

/**
 * The chooser the host serves at `/` while this browser's own screen has no
 * theme: the page a phone, or a browser with no editor open, reaches. It draws
 * the same rows from the same `/settings/theme-list.js` the settings page did,
 * so the two cases whose subject *is* that list live here now (R116).
 *
 * **`/library` is not a route.** The chooser document is `library.html`, and the
 * host serves it at `/` — through the admin bundle, and only while nothing is
 * chosen for the caller and the theme list is not empty. A press that gives the
 * caller's own screen a theme hands it to that screen's dashboard instead, so a
 * case that has to still be on the chooser after a write presses another
 * display's row.
 */
test.describe("the chooser a browser with no theme of its own reaches", () => {
  test.describe.configure({ mode: "serial" });

  test("gives every display its own row, and writes the one that was pressed", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "one desktop pass owns the shared host state",
    );

    resetStores();
    const previous = seedPairedDisplay();

    try {
      await page.goto(`${HOST}/`);

      const map = (await (
        await request.get(`${HOST}/api/themes/active`)
      ).json()) as { displays: { id: string }[] };

      // The column: the default first, then one row per display this host holds.
      // The default leads because it is what a display with no choice of its own
      // already gets, so it is the row the page opens on.
      const rows = page.locator("#themes [data-display]");
      await expect(rows).toHaveCount(1 + map.displays.length);
      await expect(rows.first()).toHaveAttribute("data-display", "default");
      await expect(rows.first()).toHaveAttribute("aria-pressed", "true");
      await expect(rows.first()).toContainText("Nothing chosen");
      await expect(rows.nth(1)).toHaveAttribute("data-display", "this-pc");
      await expect(rows.nth(1)).toContainText("This PC");
      await expect(rows.nth(1)).toContainText("Uses the default");

      // One display's theme is not another's: choosing for the tablet leaves the
      // default and this PC where they were, and the row says which theme it now
      // holds. The row pressed is the tablet's because the page comes back on
      // the default row after the write, and this PC's own press would have sent
      // this browser to its dashboard instead.
      await chooseTheme(page, HOST_THEME_ID, PAIRED_DISPLAY_ID);

      await expect(
        page.locator(`#themes [data-display="${PAIRED_DISPLAY_ID}"]`),
      ).toContainText("E2E hosted");
      await expect(rows.first()).toContainText("Nothing chosen");
      await expect(rows.nth(1)).toContainText("Uses the default");

      const after = (await (
        await request.get(`${HOST}/api/themes/active`)
      ).json()) as {
        default: string | null;
        displays: { id: string; theme: string | null }[];
      };
      expect(after.default).toBeNull();
      expect(
        after.displays.find((row) => row.id === PAIRED_DISPLAY_ID)?.theme,
      ).toBe(HOST_THEME_ID);
      expect(
        after.displays.find((row) => row.id === "this-pc")?.theme,
      ).toBeNull();
    } finally {
      restoreDisplays(previous);
    }
  });

  /**
   * The assignment says what a theme will cost the display it is being given
   * to, before the press. A video background with no glass is the only cost
   * whose answer depends on that display, so this is the case the whole table
   * exists for.
   *
   * **Both halves are read before anything is pressed**, and that is the whole
   * of it here: this page reloads on a write and comes back on the default row,
   * so a note read afterwards would be the default's rather than the pair the
   * press committed. The settings page could assert that the note survived its
   * own re-render; a page that reloads cannot, and the removal took that half
   * with it.
   */
  test("says what a theme will cost the display it is given to", async ({
    page,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "one desktop pass owns the shared host state",
    );

    resetStores();
    const previous = seedPairedDisplay();

    try {
      await page.goto(`${HOST}/`);
      const note = page.locator(
        `.theme-row:has([data-theme="${HOST_VIDEO_THEME_ID}"]) .theme-cost-note`,
      );

      // This PC is a host monitor, and the note is on the row before anything
      // is pressed: it describes the pair a press would commit.
      await page.locator('#themes [data-display="this-pc"]').click();
      await expect(note).toBeVisible();
      await expect(note).toContainText(/idle/i);

      // A paired display across the room pays nothing for the same theme, and
      // is told nothing: a phone showing video is doing what a phone does.
      //
      // **Present, and then hidden** — in that order, because `toBeHidden()`
      // alone passes on a locator that matches nothing, so it would be
      // satisfied by the note never being drawn for this row at all.
      await page
        .locator(`#themes [data-display="${PAIRED_DISPLAY_ID}"]`)
        .click();
      await expect(note).toHaveCount(1);
      await expect(note).toBeHidden();
    } finally {
      restoreDisplays(previous);
    }
  });
});

test.describe("the settings page in a screenshot", () => {
  test("captures the question a theme raises", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo) ||
        process.env["YUNARI_CAPTURE"] === undefined,
      "captures run on demand",
    );

    resetStores();
    await setActiveTheme(request, HOST_DISK_THEME_ID);
    await page.goto(`${HOST}/settings`);
    // The page reads its three sections at once; a capture is the settled page,
    // not whichever section happened to arrive first.
    await expect(page.locator("#status")).toHaveText(
      "Changes apply to every display immediately.",
    );
    await expect(page.locator("#timezone option").first()).toBeAttached();

    await expect(questions(page)).toBeVisible();

    const directory =
      process.env["YUNARI_CAPTURE_DIR"] ?? "../../test-results/captures";
    const name = `settings-theme-question-${testInfo.project.name}.png`;
    const screenshot = await page.screenshot({
      fullPage: true,
      path: `${directory}/${name}`,
    });

    await testInfo.attach(name, {
      body: screenshot,
      contentType: "image/png",
    });
  });
});
