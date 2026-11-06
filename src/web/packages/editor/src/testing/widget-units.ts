import { createStarterTheme } from "@yunari/theme-kit";
import {
  readWidgetPackage,
  type WidgetPackSummary,
  writeWidgetPackage,
} from "@yunari/theme-package";
import { loadWidgetUnits } from "../widget-packs.js";

/**
 * A real starter pack for the editor's unit-consuming suites.
 *
 * The bytes are produced by the package writer from the same composition the
 * product ships, so a test never re-types a unit. The store has no test seam;
 * the fixture feeds it through its own two host routes, which is exactly what a
 * browser session does.
 */
export const STARTER_PACK_ID = "yunari-starter";

let starterBytes: Uint8Array | undefined;

export function starterPackBytes(): Uint8Array {
  if (starterBytes !== undefined) return starterBytes;
  const { artboard: _artboard, ...document } = createStarterTheme();
  const written = writeWidgetPackage({ document, assets: {} });
  if (!written.ok) throw new Error(written.message);
  starterBytes = written.bytes;
  return written.bytes;
}

function summaryOf(id: string, bytes: Uint8Array): WidgetPackSummary {
  const read = readWidgetPackage(bytes);
  if (!read.ok) throw new Error(read.message);
  return {
    id,
    name: read.name ?? id,
    version: read.version,
    units: read.units.map((unit) => ({ id: unit.id, label: unit.label })),
  };
}

/** The host's two pack routes, answered from the given packs. */
export function packFetcher(
  packs: readonly { readonly id: string; readonly bytes: Uint8Array }[],
): typeof fetch {
  return (async (input: string | URL | Request): Promise<Response> => {
    const path = String(input);
    if (path === "/api/widget-packs") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          packs: packs.map((pack) => summaryOf(pack.id, pack.bytes)),
        }),
      } as Response;
    }
    const pack = packs.find(
      (candidate) =>
        path === `/api/widget-packs/${encodeURIComponent(candidate.id)}`,
    );
    if (pack !== undefined) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => pack.bytes.slice().buffer,
      } as Response;
    }
    return {
      ok: false,
      status: 404,
      text: async () => "Not found.",
    } as Response;
  }) as typeof fetch;
}

/** Installs the starter composition's units into the live store. */
export async function installStarterUnits(): Promise<void> {
  await loadWidgetUnits(
    packFetcher([{ id: STARTER_PACK_ID, bytes: starterPackBytes() }]),
  );
}
