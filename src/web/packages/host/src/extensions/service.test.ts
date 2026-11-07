import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CONSENT_SCHEMA_TAG,
  consentFingerprint,
  deviceAllowlistOf,
  deviceIdentity,
  type PluginManifest,
} from "@yunari/extension-api";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConsentStore } from "./consent-store";
import { contentHash } from "./content-hash";
import { createPluginInstaller } from "./install";
import { createKillListStore } from "./kill-list";
import { createExtensionService } from "./service";

const MISMATCH = "That consent does not match the installed plugin.";

/** The provider-order store the service needs, in memory. */
function orderStore(): {
  read(): Promise<{ version: 1; pluginOrder: readonly string[] }>;
  write(order: { version: 1; pluginOrder: readonly string[] }): Promise<void>;
} {
  let value: { version: 1; pluginOrder: readonly string[] } = {
    version: 1,
    pluginOrder: [],
  };
  return {
    read: () => Promise.resolve(value),
    write: (order) => {
      value = order;
      return Promise.resolve();
    },
  };
}

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

/** The authority-bearing contribution identities the fixture declares. */
function contributionIds(value: PluginManifest): string[] {
  const identities: string[] = [];
  const groups = [
    "sensorProviders",
    "assetSources",
    "panelFamilies",
    "settingsPages",
    "customSources",
  ] as const;

  for (const group of groups) {
    for (const entry of value.contributes[group] ?? []) {
      const id = (entry as Readonly<Record<string, unknown>>)["id"];
      if (typeof id === "string") identities.push(`${group}:${id}`);
    }
  }

  return identities;
}

/** The fingerprint the host should compute for the fixture, built here from
 *  the fixture's own parts rather than read back from `list()`. */
function expectedFingerprint(
  manifestValue: unknown = manifest(),
): Promise<string> {
  const value = manifestValue as PluginManifest;

  return consentFingerprint({
    schemaTag: CONSENT_SCHEMA_TAG,
    pluginApi: 1,
    pluginKey: `local/${value.id}`,
    version: value.version,
    contentHash: contentHash(validPluginFiles(manifestValue)),
    execution: value.execution,
    capabilities: value.capabilities,
    contributions: contributionIds(value),
    devices: deviceAllowlistOf(value).map(deviceIdentity),
    hosts: value.networkHosts ?? [],
  });
}

/** A trusted worker that drives one USB panel. */
function hardwareManifest(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return manifest({
    id: "acme-panel",
    name: "Acme Panel",
    capabilities: ["panel:drive", "usb:device"],
    contributes: {
      panelFamilies: [
        {
          id: "acme-panel",
          label: "Acme panel",
          vendorId: 0x1234,
          productId: 0x5678,
          geometry: { width: 480, height: 1920 },
          support: {
            maker: "Acme",
            hardwareRevision: "1",
            supportedFirmware: ["1.0"],
            updatedAt: "2026-11-07",
          },
          commands: ["brightness"],
          transports: ["usb"],
        },
      ],
    },
    ...overrides,
  });
}

function hardwarePluginBytes(
  manifestValue: unknown = hardwareManifest(),
): Uint8Array {
  return zipWith({ "main.js": "export default {};" }, manifestValue);
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
      providerOrder: orderStore(),
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

  it("carries a declarative category through to the listed extension", async () => {
    const assetCategories = [
      {
        id: "brand",
        label: "Brand",
        icon: "Shapes",
        resultKind: "logo",
        body: "grid",
      },
    ];
    await service.install(
      zipWith(
        { "readme.txt": "nothing runs here" },
        manifest({
          execution: "declarative",
          main: undefined,
          capabilities: ["asset:provide"],
          contributes: { assetCategories },
        }),
      ),
    );

    expect(await service.list()).toEqual([
      expect.objectContaining({
        contributions: { assetCategories },
        consent: "not-required",
      }),
    ]);
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

  it("notifies after a successful install, grant and remove, not a failed grant", async () => {
    const onChange = vi.fn(async () => undefined);
    const notifying = createExtensionService({
      installer: createPluginInstaller(path.join(dir, "extensions")),
      consent,
      now: () => "2026-11-06T00:00:00Z",
      providerOrder: orderStore(),
      onChange,
    });

    expect(await notifying.install(validPluginBytes())).toMatchObject({
      ok: true,
    });
    expect(onChange).toHaveBeenCalledTimes(1);

    const [listed] = await notifying.list();
    if (listed === undefined) throw new Error("no extension listed");

    expect(await notifying.grantConsent(listed.key, "yc1-nope")).toMatchObject({
      ok: false,
    });
    expect(onChange).toHaveBeenCalledTimes(1);

    expect(
      await notifying.grantConsent(listed.key, listed.fingerprint),
    ).toEqual({ ok: true });
    expect(onChange).toHaveBeenCalledTimes(2);

    await notifying.remove(listed.key);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("does not load a hardware plugin without hardware consent", async () => {
    await service.install(hardwarePluginBytes());

    const [listed] = await service.list();
    if (listed === undefined) throw new Error("no extension listed");
    expect(listed.devices).toEqual(["usb:1234:5678"]);
    expect(await service.mayLoad("local/acme-panel")).toBe(false);

    const expected = await expectedFingerprint(hardwareManifest());
    expect(await service.grantConsent("local/acme-panel", expected)).toEqual({
      ok: true,
    });
    expect(await service.mayLoad("local/acme-panel")).toBe(true);
  });

  /** The same hardware plugin with one extra transport: the device allowlist
   *  grows, which is the update the policy must hold. */
  function widenedHardwareManifest(): Readonly<Record<string, unknown>> {
    return hardwareManifest({
      version: "1.1.0",
      contributes: {
        panelFamilies: [
          {
            id: "acme-panel",
            label: "Acme panel",
            vendorId: 0x1234,
            productId: 0x5678,
            geometry: { width: 480, height: 1920 },
            support: {
              maker: "Acme",
              hardwareRevision: "1",
              supportedFirmware: ["1.0"],
              updatedAt: "2026-11-07",
            },
            commands: ["brightness"],
            transports: ["usb", "hid"],
          },
        ],
      },
    });
  }

  it("holds an update that adds access and writes nothing until approved", async () => {
    await service.install(hardwarePluginBytes());
    const [before] = await service.list();
    if (before === undefined) throw new Error("no extension listed");
    await service.grantConsent(before.key, before.fingerprint);
    expect(await service.mayLoad(before.key)).toBe(true);

    const widened = widenedHardwareManifest();
    const held = await service.install(hardwarePluginBytes(widened));

    expect(held).toEqual({
      ok: false,
      held: {
        key: "local/acme-panel",
        name: "Acme Panel",
        publisher: "local",
        reasons: ["device:hid:1234:5678"],
      },
    });

    // Nothing was written: the installed version and its tree are unchanged,
    // so the old grant still covers what is on disk.
    const [unchanged] = await service.list();
    expect(unchanged).toMatchObject({
      version: "1.0.0",
      devices: ["usb:1234:5678"],
    });
    expect(await service.mayLoad(before.key)).toBe(true);

    expect(
      await service.install(hardwarePluginBytes(widened), {
        approveUpdate: true,
      }),
    ).toMatchObject({ ok: true });

    const [after] = await service.list();
    expect(after).toMatchObject({ version: "1.1.0" });
    expect(after?.devices).toEqual(["usb:1234:5678", "hid:1234:5678"]);
  });

  it("installs an update that asks for nothing new", async () => {
    await service.install(hardwarePluginBytes());
    const [before] = await service.list();
    if (before === undefined) throw new Error("no extension listed");

    // A version bump with different bytes still asks for the same access; only
    // the content hash moves, which is not growth.
    const updated = await service.install(
      zipWith(
        { "main.js": "export default { changed: true };" },
        hardwareManifest({ version: "1.1.0" }),
      ),
    );

    expect(updated).toMatchObject({ ok: true });
    const [after] = await service.list();
    expect(after?.version).toBe("1.1.0");
    expect(after?.key).toBe(before.key);
  });

  it("does not load a killed hardware plugin", async () => {
    const directory = path.join(dir, "extensions");
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "kill-list.json"),
      JSON.stringify({
        version: 1,
        generatedAt: "2026-11-06T00:00:00Z",
        plugins: {
          "local/acme-panel": {
            advisory: "https://store.test/advisories/acme-panel",
          },
        },
      }),
    );
    const killed = createExtensionService({
      installer: createPluginInstaller(directory),
      consent,
      now: () => "2026-11-06T00:00:00Z",
      providerOrder: orderStore(),
      killList: createKillListStore({
        directory,
        origin: undefined,
        fetch,
        now: () => "2026-11-06T00:00:00Z",
      }),
    });

    await killed.install(hardwarePluginBytes());
    const [listed] = await killed.list();
    if (listed === undefined) throw new Error("no extension listed");
    expect(await killed.grantConsent(listed.key, listed.fingerprint)).toEqual({
      ok: true,
    });

    expect(await killed.mayLoad(listed.key)).toBe(false);
    // The listing carries the store's advisory so the editor can link to it.
    expect(listed.revoked).toEqual({
      advisory: "https://store.test/advisories/acme-panel",
    });
  });
});
