import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ConsentRecord } from "@yunari/extension-api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConsentStore } from "./consent-store";

const FILE = "extension-consent.json";

function record(overrides: Partial<ConsentRecord> = {}): ConsentRecord {
  return {
    pluginKey: "acme/acme-sensors",
    version: "1.2.0",
    fingerprint: "yc1-abc",
    grantedAt: "2026-11-06T00:00:00.000Z",
    ...overrides,
  };
}

describe("consent store", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "yunari-consent-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads empty when no file exists yet", async () => {
    expect(await createConsentStore(dir).read()).toEqual({
      version: 1,
      plugins: {},
    });
  });

  it("grants and reads the record back unchanged", async () => {
    const store = createConsentStore(dir);
    const granted = record();

    expect(await store.grant(granted)).toEqual({
      version: 1,
      plugins: { "acme/acme-sensors": granted },
    });
    expect(await store.read()).toEqual({
      version: 1,
      plugins: { "acme/acme-sensors": granted },
    });
    expect(JSON.parse(await readFile(path.join(dir, FILE), "utf8"))).toEqual({
      version: 1,
      plugins: { "acme/acme-sensors": granted },
    });
  });

  it("grants each plugin beside the others and revokes one", async () => {
    const store = createConsentStore(dir);
    const first = record();
    const second = record({
      pluginKey: "other/other-plugin",
      grantedAt: "2026-11-07T00:00:00.000Z",
    });

    await store.grant(first);
    await store.grant(second);
    expect(Object.keys((await store.read()).plugins)).toEqual([
      "acme/acme-sensors",
      "other/other-plugin",
    ]);

    expect(await store.revoke("acme/acme-sensors")).toEqual({
      version: 1,
      plugins: { "other/other-plugin": second },
    });
    expect(await store.read()).toEqual({
      version: 1,
      plugins: { "other/other-plugin": second },
    });
  });

  it("refuses a malformed file instead of replacing it", async () => {
    const target = path.join(dir, FILE);
    const malformed = '{\n  "version": 2,\n  "plugins": {}\n}\n';
    await writeFile(target, malformed, "utf8");

    await expect(createConsentStore(dir).grant(record())).rejects.toThrow();
    expect(await readFile(target, "utf8")).toBe(malformed);

    const invalidRecord = JSON.stringify({
      version: 1,
      plugins: { "acme/acme-sensors": { pluginKey: 1 } },
    });
    await writeFile(target, invalidRecord, "utf8");

    await expect(createConsentStore(dir).grant(record())).rejects.toThrow();
    expect(await readFile(target, "utf8")).toBe(invalidRecord);
  });
});
