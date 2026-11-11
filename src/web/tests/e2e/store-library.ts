import { expect, type Page } from "@playwright/test";
import { type FabricThemeEnvelope, facetRecordOf } from "@yunari/renderer-core";
import { readThemePackage } from "@yunari/theme-package";
import { uiCopy } from "../../packages/editor/src/ui-copy.js";
import { answerDialogIfShown } from "./editor-canvas.js";

/**
 * The route into a document now that A.7 ended the package picker: the store
 * lists a stubbed library and the cell's **Open in editor** control loads one.
 *
 * **The stub is the pattern A.6 established** (`editor-rail.spec.ts:1476`): the
 * editor preview serves no `/api/themes` at all, so the listing and the content
 * are both answered by `page.route`. **Seeded, never imported** — the point of
 * this task is that the route has one owner, and a spec about glass geometry
 * must not fail because the *import* broke.
 *
 * The listing carries no `updatedAt`, so `bootTheme`'s `latestOwnTheme` finds
 * nothing and the editor opens on the starter it always opened on; the document
 * under test arrives only when the store's control is pressed.
 *
 * **The editor must already be mounted** (`page.goto` is the caller's), and the
 * helper leaves it in the editor mode with the theme open, so a spec continues
 * exactly where the picker left it.
 */

/** One theme the stub library holds: the package's own two halves. */
export interface StoredTheme {
  readonly envelope: FabricThemeEnvelope;
  readonly assets?: Readonly<Record<string, Uint8Array>>;
}

/**
 * The theme a package holds, so **the fixture stays a package**: a spec keeps
 * the `writeThemePackage` that already refuses a bad fixture, and the stub is
 * handed what that writer was given rather than a second fixture shape.
 */
export function storedThemeOfPackage(bytes: Uint8Array): StoredTheme {
  const parsed = readThemePackage(bytes);
  if (!parsed.ok) {
    throw new Error(`the fixture is not a readable package: ${parsed.message}`);
  }
  return { envelope: parsed.envelope, assets: parsed.assets };
}

/**
 * The name the status line reports, which is the *document's* and not the
 * package file's. One owner: `documentNameOf` (`editor-shell/bridge.ts`), whose
 * rule this restates because that module imports `fabric/es` and this one runs
 * in the Playwright process.
 */
function nameOf(envelope: FabricThemeEnvelope): string {
  return envelope.metadata?.name || envelope.id;
}

/** What the store lists for one theme, as the host would derive it. */
function entryOf(theme: StoredTheme): Record<string, unknown> {
  const envelope = theme.envelope;
  return {
    id: envelope.id,
    name: nameOf(envelope),
    author: envelope.metadata?.author,
    version: envelope.metadata?.version,
    facets: facetRecordOf(envelope),
  };
}

/** What the store opens for one theme: the envelope and the bytes, base64. */
function contentOf(theme: StoredTheme): Record<string, unknown> {
  return {
    envelope: theme.envelope,
    assets: Object.fromEntries(
      Object.entries(theme.assets ?? {}).map(([assetPath, bytes]) => [
        assetPath,
        Buffer.from(bytes).toString("base64"),
      ]),
    ),
  };
}

/**
 * One library per page, replaced by each call: a spec that opens twice is served
 * the listing the second call seeded rather than the first's, and one route
 * serves both rather than piling handlers on the page.
 */
const libraries = new WeakMap<Page, { themes: StoredTheme[] }>();

async function seedStoreLibrary(
  page: Page,
  themes: readonly StoredTheme[],
): Promise<void> {
  const seeded = libraries.get(page);
  if (seeded !== undefined) {
    seeded.themes = [...themes];
    return;
  }
  const state = { themes: [...themes] };
  libraries.set(page, state);
  await page.route(
    (url) => url.pathname.startsWith("/api/themes"),
    (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/themes") {
        return route.fulfill({
          json: { themes: state.themes.map(entryOf) },
        });
      }
      const id = /^\/api\/themes\/([^/]+)$/.exec(path)?.[1];
      const theme = state.themes.find(
        (candidate) => candidate.envelope.id === id,
      );
      return theme === undefined
        ? route.fulfill({ status: 404, body: "" })
        : route.fulfill({ json: contentOf(theme) });
    },
  );
}

async function switchMode(page: Page, name: string): Promise<void> {
  await page
    .locator(".editor-shell-mode-switch")
    .getByRole("button", { name, exact: true })
    .click();
}

/**
 * Puts `theme` in the stub library and opens it through the store's control,
 * leaving the editor showing it. Answers with the milliseconds the open took,
 * measured from the control's click to the status line — the same span the
 * picker's own measurement covered.
 *
 * **Two questions can be asked on this route and both are answered.** Leaving
 * the editor asks its own guard over unsaved work, and the open asks the
 * replacement question over it again — `answerDialogIfShown` was written for
 * exactly this pair. `Discard` because these specs open over work they do not
 * need back.
 *
 * `status` defaults to the surface's own words for a document that opened;
 * a case about a *refused* document passes the message it expects instead.
 */
export async function openThemeFromStore(
  page: Page,
  theme: StoredTheme,
  status?: string | RegExp,
): Promise<number> {
  await seedStoreLibrary(page, [theme]);
  await switchMode(page, uiCopy.modes.themes);
  await answerDialogIfShown(page, "Discard", 1_000);
  const cell = page.locator(
    `[data-yunari-store-cell="${theme.envelope.id}"] [data-yunari-store-cell-action="open"]`,
  );
  await expect(cell, "the store lists no theme to open").toBeVisible();
  // The cell's controls are revealed by the card's hover state and stay
  // `pointer-events: none` until it is attended, so a press aimed straight at
  // the control is intercepted by the name button beneath it. Playwright checks
  // the hit target before its own hover lands, so the control can never be the
  // point that attends the card; the card is. Attending it first is the gesture
  // an author makes.
  await page.locator(`[data-yunari-store-cell="${theme.envelope.id}"]`).hover();
  const started = Date.now();
  await cell.click();
  await answerDialogIfShown(page, "Discard", 1_000);
  await expect(page.locator("#status-message")).toHaveText(
    status ?? `Opened ${nameOf(theme.envelope)}`,
  );
  const elapsed = Date.now() - started;
  await switchMode(page, uiCopy.modes.editor);
  return elapsed;
}
