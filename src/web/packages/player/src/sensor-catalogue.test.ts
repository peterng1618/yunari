import { descriptorsFromWire, SEMANTIC_KEYS } from "@yunari/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { loadDisplayCatalogue } from "./sensor-catalogue.js";

/**
 * The catalogue a display converts with.
 *
 * The built-in table is what a display with no host can offer; the wire is what
 * a connected display offers beside it. A failed or malformed request leaves
 * the built-in table in place, because the vocabulary is complete without it.
 */

const CUSTOM = {
  sensorId: "custom:fan",
  semanticKey: "custom.fan",
  label: "Fan speed",
  tier: "baseline",
  family: "custom",
  unitKind: "rotation",
  valueKind: "number",
};

describe("loadDisplayCatalogue", () => {
  it("adds a host's custom descriptor beside the built-ins", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ sensors: [CUSTOM] }),
    );

    const catalogue = await loadDisplayCatalogue(fetcher);

    const keys = catalogue.map((descriptor) => descriptor.key);
    expect(keys).toContain("cpu.load");
    expect(keys).toContain("custom.fan");
    expect(catalogue).toEqual(descriptorsFromWire([CUSTOM]));
    expect(fetcher).toHaveBeenCalledWith("/api/sensors");
  });

  it("maps a collision the way the shared mapping does", async () => {
    const payload = [
      CUSTOM,
      // A provider's spelling of a built-in key must not replace the vocabulary's.
      { ...CUSTOM, semanticKey: "cpu.load", label: "Provider load" },
    ];

    const catalogue = await loadDisplayCatalogue(async () =>
      Response.json({ sensors: payload }),
    );

    expect(catalogue).toEqual(descriptorsFromWire(payload));
    // The direct proof, not only delegation: the built-in label survives intact.
    const builtIn = SEMANTIC_KEYS.find(
      (descriptor) => descriptor.key === "cpu.load",
    );
    expect(
      catalogue.find((descriptor) => descriptor.key === "cpu.load")?.label,
    ).toBe(builtIn?.label);
  });

  it("keeps the built-in table when the host answers a failure", async () => {
    // A valid payload on a failing response: only the `!response.ok` gate can
    // produce the built-in table, not the JSON parse falling into `catch`.
    await expect(
      loadDisplayCatalogue(async () =>
        Response.json({ sensors: [CUSTOM] }, { status: 500 }),
      ),
    ).resolves.toBe(SEMANTIC_KEYS);
  });

  it("keeps the built-in table when the body is not a sensor list", async () => {
    await expect(
      loadDisplayCatalogue(async () => Response.json({ sensors: "nope" })),
    ).resolves.toBe(SEMANTIC_KEYS);
  });

  it("keeps the built-in table when the body is not JSON", async () => {
    await expect(
      loadDisplayCatalogue(async () => new Response("<html>", { status: 200 })),
    ).resolves.toBe(SEMANTIC_KEYS);
  });

  it("keeps the built-in table when the request rejects", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new Error("down");
    });

    await expect(loadDisplayCatalogue(fetcher)).resolves.toBe(SEMANTIC_KEYS);
  });
});
