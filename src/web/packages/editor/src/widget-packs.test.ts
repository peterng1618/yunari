// @vitest-environment node

import { createStarterTheme } from "@yunari/theme-kit";
import {
  readWidgetPackage,
  type WidgetPackSummary,
  writeWidgetPackage,
} from "@yunari/theme-package";
import { describe, expect, it } from "vitest";
import { loadWidgetUnits } from "./widget-packs.js";

interface PackFixture {
  readonly id: string;
  readonly bytes: Uint8Array;
}

/** One unit whose id and label the package itself states through provenance. */
function packWithUnit(
  packId: string,
  unitId: string,
  label: string,
): PackFixture {
  const { artboard: _artboard, ...document } = createStarterTheme();
  const written = writeWidgetPackage({
    document: {
      ...document,
      scene: {
        version: "7.4.0",
        objects: [
          {
            id: `${unitId}-object`,
            type: "Group",
            left: 0,
            top: 0,
            width: 10,
            height: 10,
            provenance: { widgetId: unitId, widgetName: label },
            objects: [
              {
                id: `${unitId}-text`,
                type: "text",
                left: 0,
                top: 0,
                text: unitId,
              },
            ],
          },
        ],
      },
      bindings: {},
      assets: [],
    },
    assets: {},
  });
  if (!written.ok) throw new Error(written.message);
  return { id: packId, bytes: written.bytes };
}

function summaryOf(pack: PackFixture): WidgetPackSummary {
  const read = readWidgetPackage(pack.bytes);
  if (!read.ok) throw new Error(read.message);
  return {
    id: pack.id,
    name: read.name ?? pack.id,
    version: read.version,
    units: read.units.map((unit) => ({ id: unit.id, label: unit.label })),
  };
}

/** The two host routes the store reads, answered from the packs it was given. */
function fetchReturning(packs: readonly PackFixture[]): typeof fetch {
  return (async (input: string | URL | Request): Promise<Response> => {
    const path = String(input);
    if (path === "/api/widget-packs") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ packs: packs.map(summaryOf) }),
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

function twoPacks(): readonly PackFixture[] {
  return [packWithUnit("a", "a", "Alpha"), packWithUnit("b", "b", "Beta")];
}

function duplicatePacks(): readonly PackFixture[] {
  return [
    packWithUnit("first", "a", "Alpha"),
    packWithUnit("second", "a", "Alpha"),
  ];
}

describe("the installed widget units", () => {
  it("loads units from two packs and refuses a duplicate unit id", async () => {
    const units = await loadWidgetUnits(fetchReturning(twoPacks()));
    expect(units.map((unit) => unit.id)).toEqual(["a", "b"]);
    expect(units.map((unit) => unit.label)).toEqual(["Alpha", "Beta"]);
    expect(units.map((unit) => unit.packId)).toEqual(["a", "b"]);

    await expect(
      loadWidgetUnits(fetchReturning(duplicatePacks())),
    ).rejects.toThrow("more than one installed pack");
  });
});
