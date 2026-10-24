import { describe, expect, it } from "vitest";
import { SEMANTIC_KEYS } from "./semantic-keys.js";
import { descriptorFromWire, descriptorsFromWire } from "./sensor-catalogue.js";

const CUSTOM = {
  sensorId: "custom:fan",
  semanticKey: "custom.fan",
  label: "Fan speed",
  tier: "baseline",
  family: "custom",
  unitKind: "rotation",
  valueKind: "number",
};

describe("descriptorFromWire", () => {
  it("maps a provider entry onto a descriptor", () => {
    expect(descriptorFromWire(CUSTOM)).toEqual({
      key: "custom.fan",
      family: "custom",
      label: "Fan speed",
      unitKind: "rotation",
      valueKind: "number",
      expectedTier: "baseline",
    });
  });

  it("drops a unit kind the renderer cannot honour", () => {
    const descriptor = descriptorFromWire({ ...CUSTOM, unitKind: "furlongs" });
    expect(descriptor?.key).toBe("custom.fan");
    expect(descriptor?.unitKind).toBeUndefined();
  });

  it("drops a value kind the renderer cannot honour", () => {
    expect(
      descriptorFromWire({ ...CUSTOM, valueKind: "decimal" })?.valueKind,
    ).toBeUndefined();
  });

  it("keeps only an image media kind", () => {
    expect(
      descriptorFromWire({ ...CUSTOM, mediaKind: "image" })?.mediaKind,
    ).toBe("image");
    const video = descriptorFromWire({ ...CUSTOM, mediaKind: "video" });
    expect(video?.key).toBe("custom.fan");
    expect(video?.mediaKind).toBeUndefined();
  });

  it("filters display units to strings and omits an empty list", () => {
    expect(
      descriptorFromWire({ ...CUSTOM, displayUnits: ["RPM", 7, null] })
        ?.displayUnits,
    ).toEqual(["RPM"]);
    expect(
      "displayUnits" in
        (descriptorFromWire({ ...CUSTOM, displayUnits: [7] }) ?? {}),
    ).toBe(false);
  });

  it("drops an entry without a key or a label", () => {
    expect(descriptorFromWire({ ...CUSTOM, semanticKey: undefined })).toBe(
      undefined,
    );
    expect(descriptorFromWire({ ...CUSTOM, label: "" })).toBe(undefined);
  });

  it("drops a non-object entry", () => {
    expect(descriptorFromWire(null)).toBeUndefined();
    expect(descriptorFromWire("custom.fan")).toBeUndefined();
  });
});

describe("descriptorsFromWire", () => {
  it("keeps the built-ins first and a discovered key beside them", () => {
    const descriptors = descriptorsFromWire([CUSTOM]);
    const keys = descriptors.map((descriptor) => descriptor.key);

    expect(keys.slice(0, SEMANTIC_KEYS.length)).toEqual(
      SEMANTIC_KEYS.map((descriptor) => descriptor.key),
    );
    expect(keys).toContain("custom.fan");
  });

  it("lets a built-in key win a collision", () => {
    const descriptors = descriptorsFromWire([
      { ...CUSTOM, semanticKey: "cpu.load", label: "Provider CPU load" },
    ]);

    expect(descriptors).toEqual(SEMANTIC_KEYS);
  });

  it("returns the built-in table when nothing survives", () => {
    expect(descriptorsFromWire([])).toEqual(SEMANTIC_KEYS);
  });
});
