import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { readWidgetPackage } from "@yunari/theme-package";

/**
 * The host's two widget-pack routes, answered from the pack this product ships.
 *
 * The editor's unit list has one source, the host: a `vite preview` of the
 * editor bundle serves no `/api/widget-packs` and falls through to the SPA's
 * `index.html`, which the editor reports as an unreadable listing. That is not
 * a surface to test against — the Widgets pane is empty and the status strip
 * carries the warning — so a preview spec registers these two routes and gets
 * the bytes and the listing a real host would answer. The bytes are the
 * committed `default.widgets.zip`, so the pane offers exactly the shipped units
 * rather than a fixture that could drift from them.
 */
export const STARTER_PACK_ID = "yunari-default-widgets";

const PACK_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../packages/host/src/packs/default.widgets.zip",
);

export async function stubWidgetPacks(page: Page): Promise<void> {
  const bytes = readFileSync(PACK_PATH);
  const read = readWidgetPackage(new Uint8Array(bytes));
  if (!read.ok) throw new Error(read.message);
  const summary = {
    id: STARTER_PACK_ID,
    name: read.name ?? STARTER_PACK_ID,
    version: read.version,
    units: read.units.map((unit) => ({ id: unit.id, label: unit.label })),
  };
  await page.route("**/api/widget-packs", (route) =>
    route.fulfill({ json: { packs: [summary] } }),
  );
  await page.route("**/api/widget-packs/*", (route) =>
    route.fulfill({ contentType: "application/zip", body: bytes }),
  );
}
