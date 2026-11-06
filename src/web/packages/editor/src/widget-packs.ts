import { type PackagedWidgetUnit, packagedUnits } from "@yunari/theme-kit";
import type { WidgetPackageResult } from "@yunari/theme-package";
import {
  readWidgetPackage,
  type WidgetPackSummary,
} from "@yunari/theme-package";

/**
 * The units an author can insert: one per packaged widget the host has
 * installed, read from the host's own pack library.
 *
 * **The host is the only source.** A unit that no installed pack carries is
 * not offered, and a host this editor cannot reach offers none — an Add pane
 * with no card tiles is the truth, while a built-in list standing in for it
 * would be fabricated content. The store is module-lived because every surface
 * that offers a unit reads the same list: the Add pane, the canvas context
 * menu and an insertion all resolve one unit from one place.
 *
 * The unit shape and the duplicate-id rule are `@yunari/theme-kit`'s; this
 * module owns only reading the host's routes and keeping the live list.
 */
export type InstalledWidgetUnit = PackagedWidgetUnit;

const LIST_PATH = "/api/widget-packs";
const packPath = (id: string): string =>
  `/api/widget-packs/${encodeURIComponent(id)}`;

let active: readonly InstalledWidgetUnit[] = [];
let revision = 0;
const listeners = new Set<() => void>();

/** The live units. **The same array reference** between changes, because
 *  `useSyncExternalStore` compares snapshots. */
export function activeWidgetUnits(): readonly InstalledWidgetUnit[] {
  return active;
}

export function subscribeWidgetUnits(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A revision string, for a subscriber that only needs to know it changed. */
export function widgetUnitKey(): string {
  return String(revision);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The listing's packs. A body that is not the listing is refused rather than
 *  read as no packs: "the host answered garbage" and "no packs are installed"
 *  are different facts, and only the second means an empty Add pane. */
function packsOf(body: unknown): readonly WidgetPackSummary[] {
  if (!isRecord(body) || !Array.isArray(body["packs"])) {
    throw new Error("The host did not answer a widget-pack listing.");
  }
  return body["packs"] as readonly WidgetPackSummary[];
}

/**
 * Reads every installed pack and returns its units, replacing the live list.
 *
 * A failed listing or pack read rejects and **leaves the live list as it was**;
 * the caller decides how to report it. A unit id in two packs is refused by
 * `packagedUnits`, the one owner of that rule.
 */
export async function loadWidgetUnits(
  fetcher: typeof fetch = fetch,
): Promise<readonly InstalledWidgetUnit[]> {
  const listing = await fetcher(LIST_PATH);
  if (!listing.ok) {
    throw new Error(
      `The installed widget packs could not be listed (${listing.status}).`,
    );
  }
  const summaries = packsOf(await listing.json());
  const packs: {
    readonly packId: string;
    readonly result: WidgetPackageResult;
  }[] = [];

  for (const summary of summaries) {
    const response = await fetcher(packPath(summary.id));
    if (!response.ok) {
      throw new Error(
        `The widget pack "${summary.id}" could not be read (${response.status}).`,
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const result = readWidgetPackage(bytes);
    if (!result.ok) {
      throw new Error(
        `The widget pack "${summary.id}" is not readable: ${result.message}`,
      );
    }
    packs.push({ packId: summary.id, result });
  }

  const units = packagedUnits(packs);
  active = units;
  revision += 1;
  for (const listener of listeners) listener();
  return units;
}
