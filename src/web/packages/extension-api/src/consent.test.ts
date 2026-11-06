import { describe, expect, it } from "vitest";
import {
  accessGrowth,
  CONSENT_SCHEMA_TAG,
  type ConsentBinding,
  canonicalJson,
  consentFingerprint,
  consentMatches,
  consentRequired,
} from "./consent";
import { type ExecutionProfile, publisherOf } from "./manifest";

function binding(overrides: Partial<ConsentBinding> = {}): ConsentBinding {
  return {
    schemaTag: CONSENT_SCHEMA_TAG,
    pluginApi: 1,
    pluginKey: "acme/acme-sensors",
    version: "1.2.0",
    contentHash: "sha256-abc",
    execution: "sandboxed-ui",
    capabilities: ["network:fetch"],
    contributions: ["sensorProviders/acme"],
    devices: [],
    ...overrides,
  };
}

describe("consent fingerprint", () => {
  it("is stable across key order and list order", async () => {
    expect(
      await consentFingerprint({
        ...binding(),
        capabilities: ["network:fetch", "storage:own"],
      }),
    ).toBe(
      await consentFingerprint({
        ...binding(),
        capabilities: ["storage:own", "network:fetch"],
      }),
    );
  });

  it("changes when a device is added", async () => {
    expect(await consentFingerprint(binding())).not.toBe(
      await consentFingerprint({
        ...binding(),
        devices: ["usb:1cbe:a092"],
      }),
    );
  });

  it("is a yc1 tag over lowercase hex SHA-256", async () => {
    expect(await consentFingerprint(binding())).toMatch(/^yc1-[0-9a-f]{64}$/);
  });

  it("changes when any covered field changes", async () => {
    // A field the fingerprint silently drops lets a changed grant reuse the
    // old consent, so every input in the binding is exercised.
    const base = await consentFingerprint(binding());
    const changes: readonly Partial<ConsentBinding>[] = [
      { pluginKey: "other/acme-sensors" },
      { version: "1.3.0" },
      { contentHash: "sha256-def" },
      { execution: "trusted-worker" },
      { capabilities: ["network:fetch", "storage:own"] },
      { contributions: ["sensorProviders/acme", "assetCategories/acme-cat"] },
      { devices: ["usb:1cbe:a092"] },
    ];

    for (const change of changes) {
      expect(await consentFingerprint({ ...binding(), ...change })).not.toBe(
        base,
      );
    }
  });
});

describe("canonical JSON", () => {
  it("sorts nested object keys and preserves array order", () => {
    expect(canonicalJson({ a: { y: 2, x: 1 }, b: [1, 2] })).toBe(
      canonicalJson({ b: [1, 2], a: { x: 1, y: 2 } }),
    );
    expect(canonicalJson(["a", "b"])).not.toBe(canonicalJson(["b", "a"]));
  });
});

describe("publisher segment", () => {
  it("names a publisher only for a qualified key", () => {
    expect(publisherOf("acme/acme-sensors")).toBe("acme");
    expect(publisherOf("acme-sensors")).toBeUndefined();
    expect(publisherOf("acme/")).toBeUndefined();
    expect(publisherOf("/acme-sensors")).toBeUndefined();
    expect(publisherOf("a/b/c")).toBeUndefined();
  });
});

describe("access growth", () => {
  it("reports access growth", () => {
    expect(
      accessGrowth(binding(), {
        ...binding(),
        capabilities: ["network:fetch", "storage:own"],
      }),
    ).toEqual(["capability:storage:own"]);
  });

  it("reports nothing for unchanged or removed access", () => {
    expect(accessGrowth(binding(), binding())).toEqual([]);
    expect(
      accessGrowth(
        {
          ...binding(),
          capabilities: ["network:fetch", "storage:own"],
          contributions: ["sensorProviders/acme", "assetCategories/acme-cat"],
          devices: ["usb:1cbe:a092"],
        },
        binding(),
      ),
    ).toEqual([]);
  });

  it("reports additions in profile, capability, contribution, device order", () => {
    expect(
      accessGrowth(binding(), {
        ...binding(),
        execution: "trusted-worker",
        capabilities: ["network:fetch", "storage:own", "secrets:own"],
        contributions: ["sensorProviders/acme", "assetCategories/acme-cat"],
        devices: ["usb:1cbe:a092"],
      }),
    ).toEqual([
      "profile",
      "capability:secrets:own",
      "capability:storage:own",
      "contribution:assetCategories/acme-cat",
      "device:usb:1cbe:a092",
    ]);
  });

  it("reports publisher only when the publisher segment changes", () => {
    expect(
      accessGrowth(binding(), {
        ...binding(),
        pluginKey: "other/acme-sensors",
      }),
    ).toEqual(["publisher"]);
    expect(
      accessGrowth(binding(), { ...binding(), pluginKey: "acme/renamed" }),
    ).toEqual([]);
  });
});

describe("consent requirements", () => {
  it("requires consent for every executable profile and neither data profile", () => {
    const executable: readonly ExecutionProfile[] = [
      "sandboxed-ui",
      "trusted-worker",
    ];
    const data: readonly ExecutionProfile[] = ["data", "declarative"];

    for (const profile of executable)
      expect(consentRequired(profile)).toBe(true);
    for (const profile of data) expect(consentRequired(profile)).toBe(false);
    // A profile added later must fail closed rather than silently run unasked.
    expect(consentRequired("future-profile" as ExecutionProfile)).toBe(true);
  });

  it("matches only a record with the same fingerprint", () => {
    const record = {
      pluginKey: "acme/acme-sensors",
      version: "1.2.0",
      fingerprint: "yc1-abc",
      grantedAt: "2026-11-06T00:00:00.000Z",
    };
    expect(consentMatches(record, "yc1-abc")).toBe(true);
    expect(consentMatches(record, "yc1-def")).toBe(false);
    expect(consentMatches(undefined, "yc1-abc")).toBe(false);
  });
});
