import { CONSENT_SCHEMA_TAG, type ConsentBinding } from "@yunari/extension-api";
import { describe, expect, it } from "vitest";
import { decideUpdate } from "./update-policy.js";

function binding(overrides: Partial<ConsentBinding> = {}): ConsentBinding {
  return {
    schemaTag: CONSENT_SCHEMA_TAG,
    pluginApi: 1,
    pluginKey: "acme/acme-sensors",
    version: "1.0.0",
    contentHash: "hash",
    execution: "trusted-worker",
    capabilities: [],
    contributions: [],
    devices: [],
    ...overrides,
  };
}

describe("decideUpdate", () => {
  it("holds an update that adds a capability", () => {
    expect(
      decideUpdate(
        binding({ capabilities: ["network:fetch"] }),
        binding({ capabilities: ["network:fetch", "storage:own"] }),
        false,
      ),
    ).toEqual({ action: "hold", reasons: ["capability:storage:own"] });
  });

  it("auto-updates an unchanged binding", () => {
    expect(decideUpdate(binding(), binding(), false)).toEqual({
      action: "auto",
      reasons: [],
    });
  });

  it("holds when the store's publisher changed under one key", () => {
    expect(decideUpdate(binding(), binding(), true)).toEqual({
      action: "hold",
      reasons: ["publisher"],
    });
  });

  it("holds when the execution profile grew", () => {
    expect(
      decideUpdate(
        binding({ execution: "declarative" }),
        binding({ execution: "trusted-worker" }),
        false,
      ),
    ).toMatchObject({ action: "hold", reasons: ["profile"] });
  });
});
