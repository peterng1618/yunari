import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPluginInstaller } from "./install";

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

function validPluginBytes(): Uint8Array {
  return zipWith({ "main.js": "export default {};" });
}

describe("plugin installer", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "yunari-plugins-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("installs and removes one plugin tree", async () => {
    const installer = createPluginInstaller(dir);
    const installed = await installer.install(validPluginBytes());
    if (!installed.ok) throw new Error(installed.message);
    if (installed.plugin === undefined) throw new Error("no plugin recorded");

    expect(installed.plugin.key).toBe("local/acme-sensors");
    expect(installed.plugin.publisher).toBe("local");
    expect(installed.plugin.directory).toBe(
      path.join(dir, "local", "acme-sensors", "1.0.0"),
    );
    expect(
      await readFile(path.join(installed.plugin.directory, "main.js"), "utf8"),
    ).toBe("export default {};");

    expect((await installer.list()).map((plugin) => plugin.key)).toEqual([
      "local/acme-sensors",
    ]);
    expect((await installer.read("local/acme-sensors"))?.contentHash).toBe(
      installed.plugin.contentHash,
    );

    await installer.remove("local/acme-sensors");
    expect(await installer.list()).toEqual([]);
    await expect(stat(installed.plugin.directory)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("records the plugin in installed.json", async () => {
    const installer = createPluginInstaller(dir);
    const installed = await installer.install(validPluginBytes());
    if (!installed.ok) throw new Error(installed.message);

    const index = JSON.parse(
      await readFile(path.join(dir, "installed.json"), "utf8"),
    ) as { version: number; plugins: Record<string, unknown> };

    expect(index.version).toBe(1);
    expect(Object.keys(index.plugins)).toEqual(["local/acme-sensors"]);
    expect(index.plugins["local/acme-sensors"]).toMatchObject({
      key: "local/acme-sensors",
      publisher: "local",
      directory: path.join(dir, "local", "acme-sensors", "1.0.0"),
      contentHash: installed.plugin?.contentHash,
    });
  });

  it("installs the same package twice without duplicating it", async () => {
    const installer = createPluginInstaller(dir);
    const first = await installer.install(validPluginBytes());
    const second = await installer.install(validPluginBytes());

    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    expect(await installer.list()).toHaveLength(1);
  });

  it("replaces the version directory when the content hash changes", async () => {
    const installer = createPluginInstaller(dir);
    const first = await installer.install(validPluginBytes());
    if (!first.ok || first.plugin === undefined)
      throw new Error("first install failed");

    const second = await installer.install(zipWith({ "main.js": "changed" }));
    if (!second.ok || second.plugin === undefined)
      throw new Error(second.ok ? "no plugin recorded" : second.message);

    expect(second.plugin.contentHash).not.toBe(first.plugin.contentHash);
    expect(second.plugin.directory).toBe(first.plugin.directory);
    expect(
      await readFile(path.join(second.plugin.directory, "main.js"), "utf8"),
    ).toBe("changed");
    expect(await installer.list()).toHaveLength(1);
  });

  it("creates no directory for an unsafe package", async () => {
    const installer = createPluginInstaller(dir);
    const result = await installer.install(zipWith({ "../main.js": "x" }));

    expect(result.ok).toBe(false);
    expect(await readdir(dir)).not.toContain("local");
  });

  it("reports the reader's refusal without installing", async () => {
    const installer = createPluginInstaller(dir);
    const result = await installer.install(zipWith({}));

    expect(result).toEqual({
      ok: false,
      message: 'Plugin package is missing its "main" file "main.js".',
    });
    expect(await readdir(dir)).not.toContain("local");
  });

  it("reads an absent or unreadable index as empty", async () => {
    const missing = createPluginInstaller(path.join(dir, "extensions"));
    expect(await missing.list()).toEqual([]);
    expect(await missing.read("local/acme-sensors")).toBeUndefined();

    await writeFile(path.join(dir, "installed.json"), "{ not json", "utf8");
    expect(await createPluginInstaller(dir).list()).toEqual([]);
  });

  it("removes an unknown key without touching the installed plugins", async () => {
    const installer = createPluginInstaller(dir);
    await installer.install(validPluginBytes());

    await installer.remove("local/not-installed");
    expect(await installer.list()).toHaveLength(1);
  });
});
