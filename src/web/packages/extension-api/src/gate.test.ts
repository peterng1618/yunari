import { describe, expect, it } from "vitest";
import type { Capability } from "./capabilities";
import { gateExtensionCall } from "./gate";
import {
  type ExtensionSurface,
  HOST_API_METHODS,
  type HostApiMethod,
  type HostApiMethodName,
  hostApiMethod,
} from "./host-api";
import {
  gateExtensionCall as gateFromEntry,
  hostApiMethod as methodFromEntry,
} from "./index";

function consent(): { fingerprint: string } {
  return { fingerprint: "sha256:abc" };
}

const SURFACES: readonly ExtensionSurface[] = ["worker", "frame"];

const TABLE = Object.entries(HOST_API_METHODS) as [
  HostApiMethodName,
  HostApiMethod,
][];

function firstSurface(method: HostApiMethod): ExtensionSurface | undefined {
  return method.surfaces[0];
}

describe("gateExtensionCall", () => {
  it("denies an unknown method before consent is considered", () => {
    expect(
      gateExtensionCall({
        method: "process.spawn",
        surface: "worker",
        consent: null,
        granted: [],
      }),
    ).toEqual({ ok: false, reason: "unknown-method" });
  });

  it("denies a frame calling a worker-only method", () => {
    expect(
      gateExtensionCall({
        method: "sample",
        surface: "frame",
        consent: consent(),
        granted: ["sensor:provide"],
      }),
    ).toEqual({ ok: false, reason: "wrong-surface" });
  });

  it("allows a consented worker with the capability", () => {
    expect(
      gateExtensionCall({
        method: "network.fetch",
        surface: "worker",
        consent: consent(),
        granted: ["network:fetch"],
      }),
    ).toMatchObject({ ok: true });
  });

  it("denies a null-capability method without consent", () => {
    expect(
      gateExtensionCall({
        method: "init",
        surface: "worker",
        consent: null,
        granted: [],
      }),
    ).toEqual({ ok: false, reason: "no-consent" });
  });

  it("allows a null-capability method with consent", () => {
    expect(
      gateExtensionCall({
        method: "init",
        surface: "worker",
        consent: consent(),
        granted: [],
      }),
    ).toMatchObject({ ok: true });
  });

  it("denies null consent before checking the capability", () => {
    expect(
      gateExtensionCall({
        method: "network.fetch",
        surface: "worker",
        consent: null,
        granted: [],
      }),
    ).toEqual({ ok: false, reason: "no-consent" });
  });

  it("names the missing capability when it is not granted", () => {
    expect(
      gateExtensionCall({
        method: "network.fetch",
        surface: "worker",
        consent: consent(),
        granted: [],
      }),
    ).toEqual({
      ok: false,
      reason: "missing-capability",
      capability: "network:fetch",
    });
  });
});

describe("HOST_API_METHODS", () => {
  it("allows every declared method on every surface it declares", () => {
    for (const [name, method] of TABLE) {
      const granted: readonly Capability[] =
        method.capability === null ? [] : [method.capability];
      for (const surface of method.surfaces) {
        expect(
          gateExtensionCall({
            method: name,
            surface,
            consent: consent(),
            granted,
          }),
          `${name} on ${surface}`,
        ).toMatchObject({ ok: true });
      }
    }
  });

  it("denies every declared method on a surface it does not declare", () => {
    for (const [name, method] of TABLE) {
      const other = SURFACES.find(
        (surface) => !method.surfaces.includes(surface),
      );
      if (other === undefined) continue;
      expect(
        gateExtensionCall({
          method: name,
          surface: other,
          consent: consent(),
          granted: [],
        }),
        `${name} on ${other}`,
      ).toEqual({ ok: false, reason: "wrong-surface" });
    }
  });

  it("requires each non-null capability", () => {
    for (const [name, method] of TABLE) {
      if (method.capability === null) continue;
      const surface = firstSurface(method);
      if (surface === undefined) continue;
      expect(
        gateExtensionCall({
          method: name,
          surface,
          consent: consent(),
          granted: [],
        }),
        name,
      ).toEqual({
        ok: false,
        reason: "missing-capability",
        capability: method.capability,
      });
    }
  });
});

describe("readParams", () => {
  const readParams = HOST_API_METHODS.init.readParams;

  it("refuses a Map", () => {
    expect(readParams(new Map())).toMatchObject({ ok: false });
  });

  it("refuses a Date", () => {
    expect(readParams(new Date())).toMatchObject({ ok: false });
  });

  it("accepts a null-prototype object", () => {
    const params = Object.create(null) as Record<string, unknown>;
    params["key"] = "value";
    expect(readParams(params)).toMatchObject({ ok: true, value: params });
  });
});

describe("hostApiMethod", () => {
  it("returns undefined for an unknown name", () => {
    expect(hostApiMethod("process.spawn")).toBeUndefined();
  });

  it("returns undefined for an inherited Object key", () => {
    expect(hostApiMethod("toString")).toBeUndefined();
  });

  it("returns the table entry for a known name", () => {
    expect(hostApiMethod("sample")).toBe(HOST_API_METHODS.sample);
  });
});

describe("prototype guard", () => {
  it("denies a method named after an inherited Object key", () => {
    expect(
      gateExtensionCall({
        method: "toString",
        surface: "worker",
        consent: consent(),
        granted: [],
      }),
    ).toEqual({ ok: false, reason: "unknown-method" });
  });
});

describe("package entry", () => {
  it("re-exports the gate and the table", () => {
    expect(gateFromEntry).toBe(gateExtensionCall);
    expect(methodFromEntry).toBe(hostApiMethod);
  });
});
