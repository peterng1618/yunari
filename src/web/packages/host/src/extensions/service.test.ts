import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CONSENT_SCHEMA_TAG, consentFingerprint } from "@yunari/extension-api";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConsentStore } from "./consent-store";
import { contentHash } from "./content-hash";
import { createPluginInstaller } from "./install";
import { createExtensionService } from "./service";

const MISMATCH = "That consent does not match the installed plugin.";

function manifest(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    manifestVersion: 1,
    id: "acme-sensors",
    name: "Acme Sensors",
    version: "1.0.0",
    description: "Reads the room's sensors.",
    engines: { yunari: ">=0.1.0" },
    pluginApi: 1,
    execution: "trusted-worker",
    capabilities: [],
    contributes: {},
    main: "main.js",
    ...overrides,
  };
}

function zipWith(
  files: Readonly<Record<string, string>>,
  manifestValue: unknown = manifest(),
): Uint8Array {
  const members: Record<string, Uint8Array> = {
    "yunari-plugin.json": strToU8(JSON.stringify(manifestValue)),
  };
  for (const [name, content] of Object.entries(files))
    members[name] = strToU8(content);
  return zipSync(members, { level: 0 });
}

function validPluginFiles(
  manifestValue: unknown = manifest(),
): Readonly<Record<string, Uint8Array>> {
  return {
    "yunari-plugin.json": strToU8(JSON.stringify(manifestValue)),
    "main.js": strToU8("export default {};"),
  };
}

function validPluginBytes(): Uint8Array {
  return zipSync(validPluginFiles(), { level: 0 });
}

/** The fingerprint the host should compute for the fixture, built here from
 *  the fixture's own parts rather than read back from `list()`. */
function expectedFingerprint(
  manifestValue: unknown = manifest(),
): Promise<string> {
  return consentFingerprint({
    schemaTag: CONSENT_SCHEMA_TAG,
    pluginApi: 1,
    pluginKey: "local/acme-sensors",
    version: "1.0.0",
    contentHash: contentHash(validPluginFiles(manifestValue)),
    execution: "trusted-worker",
    capabilities: [],
    contributions: [],
    devices: [],
  });
}

describe("extension service", () => {
  let dir: string;
  let service: ReturnType<typeof createExtensionService>;
  let consent: ReturnType<typeof createConsentStore>;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "yunari-service-"));
    consent = createConsentStore(dir);
    service = createExtensionService({
      installer: createPluginInstaller(path.join(dir, "extensions")),
      consent,
      now: () => "2026-11-06T00:00:00Z",
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reports missing consent for a trusted-worker plugin", async () => {
    await service.install(validPluginBytes());
    expect(await service.list()).toEqual([
      expect.objectContaining({
        key: "local/acme-sensors",
        consent: "missing",
      }),
    ]);
    expect(await service.mayLoad("local/acme-sensors")).toBe(false);
  });

  it("refuses a consent fingerprint the host did not compute", async () => {
    await service.install(validPluginBytes());
    expect(
      await service.grantConsent("local/acme-sensors", "yc1-nope"),
    ).toEqual({
      ok: false,
      message: MISMATCH,
    });
  });

  it("grants consent from the host-computed fingerprint and then loads", async () => {
    await service.install(validPluginBytes());
    const [listed] = await service.list();
    if (listed === undefined) throw new Error("no extension listed");
    const expected = await expectedFingerprint();

    expect(listed.fingerprint).toBe(expected);
    expect(await service.grantConsent(listed.key, expected)).toEqual({
      ok: true,
    });

    expect(await service.list()).toEqual([
      expect.objectContaining({
        key: listed.key,
        consent: "granted",
        fingerprint: expected,
      }),
    ]);
    expect(await service.mayLoad(listed.key)).toBe(true);

    const file = await consent.read();
    expect(file.plugins[listed.key]).toEqual({
      pluginKey: listed.key,
      version: "1.0.0",
      fingerprint: expected,
      grantedAt: "2026-11-06T00:00:00Z",
    });
  });

  it("rejects a fingerprint from a superseded content hash", async () => {
    await service.install(validPluginBytes());
    const [before] = await service.list();
    if (before === undefined) throw new Error("no extension listed");

    await service.install(
      zipWith({ "main.js": "export default { changed: true };" }),
    );

    expect(await service.grantConsent(before.key, before.fingerprint)).toEqual({
      ok: false,
      message: MISMATCH,
    });
    expect(await service.list()).toEqual([
      expect.objectContaining({ consent: "missing", version: "1.0.0" }),
    ]);
  });

  it("treats a data plugin as not requiring consent and loads it", async () => {
    await service.install(
      zipWith(
        { "readme.txt": "nothing runs here" },
        manifest({ execution: "data", main: undefined }),
      ),
    );

    expect(await service.list()).toEqual([
      expect.objectContaining({ consent: "not-required" }),
    ]);
    expect(await service.mayLoad("local/acme-sensors")).toBe(true);
  });

  it("does not store a grant for a data plugin", async () => {
    await service.install(
      zipWith(
        { "readme.txt": "nothing runs here" },
        manifest({ execution: "data", main: undefined }),
      ),
    );
    const [listed] = await service.list();
    if (listed === undefined) throw new Error("no extension listed");

    expect(await service.grantConsent(listed.key, listed.fingerprint)).toEqual({
      ok: true,
    });
    expect((await consent.read()).plugins).toEqual({});
  });

  it("treats a declarative plugin as not requiring consent and loads it", async () => {
    await service.install(
      zipWith(
        { "readme.txt": "nothing runs here" },
        manifest({ execution: "declarative", main: undefined }),
      ),
    );

    expect(await service.list()).toEqual([
      expect.objectContaining({ consent: "not-required" }),
    ]);
    expect(await service.mayLoad("local/acme-sensors")).toBe(true);
  });

  it("removes the tree and revokes consent", async () => {
    await service.install(validPluginBytes());
    const [listed] = await service.list();
    if (listed === undefined) throw new Error("no extension listed");
    await service.grantConsent(listed.key, listed.fingerprint);

    await service.remove(listed.key);

    expect(await service.list()).toEqual([]);
    expect(await service.mayLoad(listed.key)).toBe(false);
    expect((await consent.read()).plugins).toEqual({});
  });

  it("answers false for a plugin that is not installed", async () => {
    expect(await service.mayLoad("local/missing")).toBe(false);
  });
});
