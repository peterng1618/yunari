import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { chooseIn } from "./control-set.js";
import {
  HOST_DISK_THEME_ID,
  HOST_PORT,
  HOST_SETTINGS_DIR,
  HOST_THEME_ID,
  HOST_VIDEO_THEME_ID,
} from "./host-theme.js";
import { isDesktopSurface } from "./surface.js";

/** Drives the consumer settings surface against the real host. `/settings`
 * forwards to the editor's Settings mode, and that surface is the only one
 * where global settings and a theme's own questions meet — a difference
 * invisible anywhere else, because reading `/api/devices` cannot tell a choice
 * the surface hid from one the consumer saved.
 *
 * The second describe drives the chooser the host serves at `/` rather than
 * this surface, because the theme list its cases are about is that page's. */

const HOST = `http://127.0.0.1:${HOST_PORT}`;

/** Every store sits in the app folder's settings directory, so each state below
 * is reachable by writing the same file the host reads — including after a
 * recycled server left state behind. They left the themes directory so that a
 * theme folder is only ever a theme. */
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

/** One theme's answers, for the display the Settings surface answers for.
 *  The editor's list always leads with the Host, and it is the row the surface
 *  selects until another is pressed. */
async function answersFor(
  request: APIRequestContext,
  id: string,
  display = "this-pc",
): Promise<Record<string, string>> {
  const response = await request.get(
    `${HOST}/api/themes/${id}/answers?display=${display}`,
  );
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

/** The section a theme's unanswered slots raise, on the Displays page. */
const questions = (page: Page) =>
  page.locator('[data-yunari-host-section="questions"]');

/** The Settings mode's published status line, in the shell's footer. */
const status = (page: Page) => page.locator("[data-yunari-host-status]");

/**
 * Opens the one settings surface. `/settings` forwards to the editor's React
 * Settings mode, so every case waits for that mode to be the one showing
 * rather than for a host-served document.
 */
async function openSettings(page: Page): Promise<void> {
  await page.goto(`${HOST}/settings`);
  await expect(page.locator("[data-yunari-mode-region]")).toHaveAttribute(
    "data-yunari-mode-region",
    "settings",
  );
}

/** Opens Settings on one of its pages, and waits for that panel to show. */
async function openPage(
  page: Page,
  id: "displays" | "hardware" | "units",
): Promise<void> {
  await openSettings(page);
  await page.locator(`[data-yunari-settings-nav-item="${id}"]`).click();
  await expect(
    page.locator(`[data-yunari-settings-panel="${id}"]`),
  ).toBeVisible();
}

test.describe("the settings page a consumer configures", () => {
  // One host process and one set of stores, so these states are travelled in
  // order rather than in parallel.
  test.describe.configure({ mode: "serial" });

  /**
   * `/settings` is the editor's Settings mode now — one settings surface rather
   * than a second hand-written document. The page keeps this PC's own sections
   * and the questions a theme raises, and still lists no themes: the listing is
   * the chooser's (`/`) and the store mode's local half.
   *
   * The nav is asserted first on purpose: `toHaveCount(0)` is satisfied by a
   * page that never rendered at all, so the surface that is still there is what
   * says the page ran.
   */
  test("lists no themes, and keeps this PC's own sections", async ({
    page,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "one desktop pass owns the shared host state",
    );

    resetStores();
    await openSettings(page);
    await expect(
      page.locator('[data-yunari-settings-panel="displays"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-yunari-settings-nav-item="hardware"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-yunari-settings-nav-item="units"]'),
    ).toBeVisible();
    await expect(status(page)).toHaveText(
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
    await openPage(page, "hardware");
    const groups = page.locator("[data-yunari-host-device-group]");
    await expect(groups.first()).toBeVisible();
    const before = await groups.evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-yunari-host-device-group")),
    );

    // The bug this guards: filtering the machine's own settings by the active
    // theme hides a drive the consumer chose and cannot reach again. The theme
    // is the host's state now rather than a press on this page, so the page is
    // loaded again under it — which is the read the filter would have to survive.
    await setActiveTheme(request, HOST_DISK_THEME_ID);
    await openPage(page, "hardware");
    await expect(groups.first()).toBeVisible();
    expect(
      await groups.evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-yunari-host-device-group")),
      ),
    ).toEqual(before);

    await setActiveTheme(request, HOST_THEME_ID);
    await openPage(page, "hardware");
    await expect(groups.first()).toBeVisible();
    expect(
      await groups.evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-yunari-host-device-group")),
      ),
    ).toEqual(before);
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
    await openPage(page, "hardware");
    await expect(questions(page)).toHaveCount(0);

    const chosen = disks[0]!;
    const control = page.locator(
      '[data-yunari-host-device-group="system-disk"]',
    );
    // The page draws no controls until the host has answered the device read.
    await expect(control).toBeVisible();
    await chooseIn(page, control, chosen);
    await expect(status(page)).toHaveText(
      "Saved. Displays update on their next frame.",
    );
    expect(await assignedSystemDisk(request)).toBe(chosen);

    await openPage(page, "hardware");
    await expect(control.locator("[data-yunari-value]")).toHaveAttribute(
      "data-yunari-value",
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
      await openPage(page, "hardware");

      // One field per reported device, labelled by that device. The bug this
      // guards: a group following the default points at no single device, and a
      // name field hung off the group renamed whichever device came first.
      const field = page.locator(`input[data-yunari-host-name="${other}"]`);
      await expect(page.locator("input[data-yunari-host-name]")).toHaveCount(
        before.available.gpus.length + before.available.disks.length,
      );
      await expect(
        page.locator(`label[for="yunari-host-name-${other}"]`),
      ).toHaveText(reported);
      await expect(
        page.locator(
          '[data-yunari-host-device-group="data-disk"] [data-yunari-value]',
        ),
      ).toHaveAttribute("data-yunari-value", "");

      await field.fill("Archive");
      await field.blur();
      await expect(status(page)).toHaveText(
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
    await openPage(page, "units");

    try {
      // The controls arrive with the display read, after the panel is showing.
      await expect(
        page.locator("[data-yunari-host-measurement]"),
      ).toBeVisible();
      await chooseIn(
        page,
        page.locator("[data-yunari-host-measurement]"),
        "imperial",
      );
      await expect(status(page)).toHaveText(
        "Saved. Displays already open keep their old units until they reload.",
      );

      // The host replaces the whole settings object, so a page that sent one
      // field at a time would drop the other without saying so.
      await chooseIn(
        page,
        page.locator("[data-yunari-host-time-zone]"),
        "Asia/Tokyo",
      );
      await expect(status(page)).toHaveText(
        "Saved. Displays update on their next frame.",
      );

      const body = (await (
        await request.get(`${HOST}/api/display`)
      ).json()) as { settings: unknown };
      expect(body.settings).toEqual({
        timeZone: "Asia/Tokyo",
        measurement: "imperial",
      });

      await openPage(page, "units");
      await expect(
        page.locator("[data-yunari-host-time-zone] [data-yunari-value]"),
      ).toHaveAttribute("data-yunari-value", "Asia/Tokyo");
      await expect(
        page.locator("[data-yunari-host-measurement] [data-yunari-value]"),
      ).toHaveAttribute("data-yunari-value", "imperial");
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
    await openSettings(page);
    await expect(questions(page)).toBeVisible();
    // The theme reads a disk and nothing else, so one question, once.
    await expect(questions(page).locator("h3")).toContainText("needs");
    await expect(
      page.locator('[data-yunari-host-answer="system-disk"]'),
    ).toBeVisible();

    await chooseIn(
      page,
      page.locator('[data-yunari-host-answer="system-disk"]'),
      other,
    );
    await expect(status(page)).toHaveText(
      "Saved. Only this theme is affected.",
    );

    // Answered: the question stops being asked, and the answer is stored
    // against the theme and the display the surface speaks for — not against
    // the machine's own device choice.
    await expect(questions(page)).toHaveCount(0);
    expect(await answersFor(request, HOST_DISK_THEME_ID)).toEqual({
      "system-disk": other,
    });
    expect(await assignedSystemDisk(request)).toBe(global);

    // The answer survives a fresh read of the host, not only this render.
    await openSettings(page);
    await expect(questions(page)).toHaveCount(0);
    await openPage(page, "hardware");
    await expect(
      page.locator(
        '[data-yunari-host-device-group="system-disk"] [data-yunari-value]',
      ),
    ).toHaveAttribute("data-yunari-value", global);
  });

  /**
   * The answers URL resolves end to end, for the display the Settings surface
   * speaks for.
   *
   * The surface builds it as
   * `/api/themes/<theme>/answers?display=<the selected display>`, so this is
   * where its own copy, the query, the route's `display` parameter and the
   * store's key all have to agree. A URL that dropped the query would still
   * answer 200 and still save; it would just save under a key the surface never
   * named.
   *
   * **The display is the row selected in the list**, which opens on the Host.
   * The section's own sentence names what a theme needs rather than the default
   * display the old hand-written page could answer for.
   */
  test("answers a theme's question for the display the surface speaks for", async ({
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

    await openSettings(page);
    await expect(questions(page)).toBeVisible();
    // The question belongs to the display the list has selected, and the Host
    // is the first row.
    await expect(
      page.locator('[data-yunari-host-display="this-pc"]'),
    ).toBeVisible();
    await expect(questions(page).locator("p").first()).toContainText(
      "reads hardware that has no answer yet",
    );

    await chooseIn(
      page,
      page.locator('[data-yunari-host-answer="system-disk"]'),
      chosen,
    );
    await expect(status(page)).toHaveText(
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
    // A theme that *does* read something goes first: the section is not drawn
    // when there is nothing to ask, so `toHaveCount(0)` alone is satisfied by a
    // surface that never asked — and the whole claim is that this one asked and
    // found nothing to draw.
    await setActiveTheme(request, HOST_DISK_THEME_ID);
    await openSettings(page);
    await expect(questions(page)).toBeVisible();

    await setActiveTheme(request, HOST_THEME_ID);
    await openSettings(page);
    await expect(questions(page)).toHaveCount(0);
  });
});

/**
 * The chooser the host serves at `/` while this browser's own screen has no
 * theme: the page a phone, or a browser with no editor open, reaches. It is the
 * React admin entry (`src/admin/chooser.tsx`), which owns its rows now that the
 * old hand-written list is deleted.
 *
 * **`/library` is not a route.** The chooser document is `chooser.html`, and the
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

      // **The precondition names itself.** `/` resolves to the chooser only
      // while nothing is published, nothing is chosen for this PC and the
      // store holds more than one theme; `resetStores` covers the last two,
      // but the published store is in memory and file-less, so a publish an
      // earlier spec left behind would land this case on a dashboard. Without
      // this line the failure is a locator mismatch in the row column; with
      // it, the failure says which precondition did not hold.
      await expect(page.locator("h1")).toHaveText("Choose a theme");

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
      await expect(rows.nth(1)).toContainText("Host");
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
   * Pressing this PC's own row is the one press that leaves the chooser: `/` is
   * one-shot for the caller's own screen, so the write makes the reload resolve
   * to that screen's dashboard instead of the chooser again. Every other chooser
   * case avoids this press — they need to stay on the page — which is why the
   * write and the hand-off are asserted here, together.
   *
   * The assignment is read from the host rather than the row, because the reload
   * is the thing under test and it throws the page's own copy away. The landing
   * URL also names its source, so `map` is what says the host resolved the
   * assignment rather than the page having carried a `?theme=` link in.
   */
  test("gives this PC's own screen a theme, and hands the browser to its dashboard", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "one desktop pass owns the shared host state",
    );

    resetStores();
    await page.goto(`${HOST}/`);
    // The precondition names itself: `/` is the chooser only while nothing is
    // published, nothing is chosen for this PC and the store holds more than
    // one theme. `resetStores` covers the last two; the in-memory published
    // store has no reset, so a publish left by an earlier spec would land this
    // case on a dashboard. This line says so instead of a row locator.
    await expect(page.locator("h1")).toHaveText("Choose a theme");
    await expect(
      page.locator('#themes [data-display="this-pc"]'),
    ).toBeVisible();
    await expect(
      page.locator('#themes [data-display="this-pc"]'),
    ).toContainText("Uses the default");

    await chooseTheme(page, HOST_THEME_ID, "this-pc");

    // The page reloads on a successful write; this is that reload following the
    // host's redirect to the theme the assignment named.
    await expect(page).toHaveURL(/[?&]theme=e2e-hosted\b/);
    await expect(page).toHaveURL(/[?&]theme-source=map\b/);
    await expect(page.locator("#artboard")).toBeVisible({ timeout: 30_000 });

    const after = (await (
      await request.get(`${HOST}/api/themes/active`)
    ).json()) as {
      default: string | null;
      displays: { id: string; theme: string | null }[];
    };
    expect(after.displays.find((row) => row.id === "this-pc")?.theme).toBe(
      HOST_THEME_ID,
    );
    expect(after.default).toBeNull();
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

      // The Host is a host monitor, and the note is on the row before anything
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
    await openSettings(page);
    // The surface reads its host state on mount; a capture is the settled page,
    // not whichever read happened to arrive first.
    await expect(status(page)).toHaveText(
      "Changes apply to every display immediately.",
    );
    await expect(
      page.locator('[data-yunari-host-display="this-pc"]'),
    ).toBeVisible();

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
