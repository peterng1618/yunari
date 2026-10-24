import { type FabricThemeEnvelope, facetRecordOf } from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import { planVersion } from "./plan.js";

const NOW = "2026-10-23T00:00:00.000Z";

function baseEnvelope(
  overrides: Omit<Partial<FabricThemeEnvelope>, "metadata"> & {
    readonly metadata?: FabricThemeEnvelope["metadata"];
  } = {},
): FabricThemeEnvelope {
  return {
    schemaVersion: "2.0.0",
    fabricVersion: "7.4.0",
    id: "demo-theme",
    metadata: { themeLanguage: "en", name: "Demo" },
    artboard: { width: 1280, height: 720 },
    bindings: {},
    scene: { version: "7.4.0", objects: [] },
    ...overrides,
  } as unknown as FabricThemeEnvelope;
}

function claimed(envelope: FabricThemeEnvelope, version: string) {
  return {
    ...envelope,
    metadata: { ...envelope.metadata, version },
  };
}

describe("planVersion", () => {
  it("bumps from the stored envelope and refuses a claimed version that disagrees", () => {
    const previous = { version: "1.0.0", envelope: baseEnvelope() };
    const changed = {
      ...baseEnvelope(),
      artboard: { width: 800, height: 600 },
    };
    const planned = planVersion({
      previous,
      candidate: claimed(changed, "2.0.0"),
      now: NOW,
    });
    expect(planned).toMatchObject({
      ok: true,
      version: "2.0.0",
      level: "major",
    });
    expect(
      planVersion({
        previous,
        candidate: claimed(changed, "1.0.1"),
        now: NOW,
      }),
    ).toMatchObject({ ok: false });
  });

  it("answers 1.0.0 for a first publication", () => {
    const candidate = claimed(baseEnvelope(), "1.0.0");
    const planned = planVersion({ previous: undefined, candidate, now: NOW });
    expect(planned).toMatchObject({ ok: true, version: "1.0.0" });
    if (planned.ok) expect(planned.facets).toEqual(facetRecordOf(candidate));
  });

  it("refuses an unchanged theme and an absent declared version", () => {
    const previous = { version: "1.0.0", envelope: baseEnvelope() };
    expect(
      planVersion({
        previous,
        candidate: claimed(baseEnvelope(), "1.0.0"),
        now: NOW,
      }),
    ).toMatchObject({ ok: false });
    const changed = {
      ...baseEnvelope(),
      artboard: { width: 800, height: 600 },
    };
    expect(
      planVersion({ previous, candidate: changed, now: NOW }),
    ).toMatchObject({ ok: false });
  });
});
