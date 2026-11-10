import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type APIRequestContext, expect, type Page } from "@playwright/test";
import { HOST_PORT, HOST_SETTINGS_DIR } from "./host-theme.js";

/** Host state and page openings shared by the settings and chooser specs.
 *  Every store sits in the app folder's settings directory, so each state is
 *  reachable by writing the same file the host reads — including after a
 *  recycled server left state behind. They left the themes directory so that a
 *  theme folder is only ever a theme. */

export const HOST = `http://127.0.0.1:${HOST_PORT}`;

const ACTIVE_FILE = path.join(HOST_SETTINGS_DIR, "active-theme.json");
const ANSWERS_FILE = path.join(HOST_SETTINGS_DIR, "theme-answers.json");
const DISPLAYS_FILE = path.join(HOST_SETTINGS_DIR, "display-clients.json");

export const PAIRED_DISPLAY_ID = "kitchen-tablet";

/**
 * The displays this host knows about, written by hand the same way the two
 * stores above are. Nothing else seeds a **paired** display, and the warning
 * table's other half needs one: a remote display is the row that must be told
 * nothing about a video background.
 *
 * Returns whatever was there before, so a record this spec invents is not left
 * behind for the cases that follow it.
 */
export function seedPairedDisplay(): string | undefined {
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

export function restoreDisplays(previous: string | undefined): void {
  if (previous === undefined) rmSync(DISPLAYS_FILE, { force: true });
  else writeFileSync(DISPLAYS_FILE, previous, "utf8");
}

export function resetStores(): void {
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

export async function deviceState(
  request: APIRequestContext,
): Promise<DeviceState> {
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

export async function disksOn(request: APIRequestContext): Promise<string[]> {
  return (await deviceState(request)).available.disks.map((disk) => disk.id);
}

export async function assignedSystemDisk(
  request: APIRequestContext,
): Promise<string> {
  return (await deviceState(request)).assigned["system-disk"] ?? "";
}

/** One theme's answers, for the display the Settings surface answers for.
 *  The editor's list always leads with the default row, and it is the row the
 *  surface selects until another is pressed. */
export async function answersFor(
  request: APIRequestContext,
  id: string,
  display = "default",
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
export async function chooseTheme(
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
export async function setActiveTheme(
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
export const questions = (page: Page) =>
  page.locator('[data-yunari-host-section="questions"]');

/** The Settings mode's published status line, in the shell's footer. */
export const status = (page: Page) => page.locator("[data-yunari-host-status]");

/**
 * Opens the one settings surface. `/settings` forwards to the editor's React
 * Settings mode, so every case waits for that mode to be the one showing
 * rather than for a host-served document.
 */
export async function openSettings(page: Page): Promise<void> {
  await page.goto(`${HOST}/settings`);
  await expect(page.locator("[data-yunari-mode-region]")).toHaveAttribute(
    "data-yunari-mode-region",
    "settings",
  );
}

/** Opens Settings on one of its pages, and waits for that panel to show. */

export async function openPage(
  page: Page,
  id: "displays" | "hardware" | "units",
): Promise<void> {
  await openSettings(page);
  await page.locator(`[data-yunari-settings-nav-item="${id}"]`).click();
  await expect(
    page.locator(`[data-yunari-settings-panel="${id}"]`),
  ).toBeVisible();
}
