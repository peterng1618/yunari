import { descriptorsFromWire, SEMANTIC_KEYS } from "@yunari/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { createSensorCatalogue } from "./sensor-catalogue.js";

/**
 * The editor's reading of `/api/sensors`.
 *
 * The built-in table is what an editor with no host can offer; the wire is what
 * a connected editor offers beside it. A failed request is a disconnected
 * editor, not an error the author has to answer for.
 */

function responding(sensors: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ sensors }),
  })) as unknown as typeof fetch;
}

const CUSTOM = {
  sensorId: "custom:fan",
  semanticKey: "custom.fan",
  label: "Fan speed",
  tier: "baseline",
  family: "custom",
  unitKind: "rotation",
  valueKind: "number",
};

describe("the sensor catalogue", () => {
  it("offers a provider's descriptor beside the built-in table", async () => {
    const catalogue = createSensorCatalogue(responding([CUSTOM]));

    await catalogue.refresh();

    const keys = catalogue.descriptors().map((descriptor) => descriptor.key);
    // Built-ins are not replaced by a wire that only names one provider's keys.
    expect(keys).toContain("cpu.load");
    expect(keys).toContain("custom.fan");
    expect(catalogue.descriptors().find((d) => d.key === "custom.fan")).toEqual(
      {
        key: "custom.fan",
        family: "custom",
        label: "Fan speed",
        unitKind: "rotation",
        valueKind: "number",
        expectedTier: "baseline",
      },
    );
  });

  it("maps the wire exactly as the shared mapping does", async () => {
    const payload = [
      CUSTOM,
      // Collides with a built-in: the vocabulary's spelling must win on both sides.
      { ...CUSTOM, semanticKey: "cpu.load", label: "Provider load" },
    ];
    const catalogue = createSensorCatalogue(responding(payload));

    await catalogue.refresh();

    expect(catalogue.descriptors()).toEqual(descriptorsFromWire(payload));
  });

  it("keeps a known unit kind and drops one the renderer cannot honour", async () => {
    const catalogue = createSensorCatalogue(
      responding([
        { ...CUSTOM, semanticKey: "custom.fan", unitKind: "rotation" },
        { ...CUSTOM, semanticKey: "custom.odd", unitKind: "furlongs" },
      ]),
    );
    await catalogue.refresh();

    const found = (key: string) =>
      catalogue.descriptors().find((descriptor) => descriptor.key === key);
    expect(found("custom.fan")?.unitKind).toBe("rotation");
    expect(found("custom.odd")?.unitKind).toBeUndefined();
  });

  it("keeps the built-in table when the request rejects", async () => {
    const catalogue = createSensorCatalogue(
      vi.fn(async () => {
        throw new Error("no host");
      }) as unknown as typeof fetch,
    );

    await expect(catalogue.refresh()).resolves.toBeUndefined();
    expect(catalogue.descriptors()).toEqual(SEMANTIC_KEYS);
  });

  it("keeps the built-in table when the host refuses the request", async () => {
    const catalogue = createSensorCatalogue(
      vi.fn(async () => ({
        ok: false,
        status: 404,
        json: async () => ({}),
      })) as unknown as typeof fetch,
    );

    await catalogue.refresh();
    expect(catalogue.descriptors()).toEqual(SEMANTIC_KEYS);
  });
});
