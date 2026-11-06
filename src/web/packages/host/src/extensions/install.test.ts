import {
  mkdir,
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
import { contentHash } from "./content-hash";
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

  it("hashes a known file set to a fixed vector", () => {
    expect(
      contentHash({
        "a.txt": new TextEncoder().encode("hello"),
        "b/c.bin": new Uint8Array([0, 1, 2]),
      }),
    ).toBe("33095a8af70e1f971ad8442ecc882696230211b1624dbd7254e4c304e7726978");
  });

  it("never trusts a tampered index directory when removing", async () => {
    const installer = createPluginInstaller(dir);
    const installed = await installer.install(validPluginBytes());
    if (!installed.ok || installed.plugin === undefined)
      throw new Error("install failed");

    const indexFile = path.join(dir, "installed.json");
    const index = JSON.parse(await readFile(indexFile, "utf8")) as {
      plugins: Record<string, { directory: string }>;
    };
    const elsewhere = path.join(dir, "somewhere");
    index.plugins["local/acme-sensors"]!.directory = elsewhere;
    await writeFile(indexFile, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    await mkdir(elsewhere);
    await writeFile(path.join(elsewhere, "sentinel.txt"), "x", "utf8");

    // The record disagrees with the key, so the index is unreadable and neither
    // tree is removed.
    await installer.remove("local/acme-sensors");

    expect(await readFile(path.join(elsewhere, "sentinel.txt"), "utf8")).toBe(
      "x",
    );
    expect(
      await readFile(path.join(installed.plugin.directory, "main.js"), "utf8"),
    ).toBe("export default {};");
  });

  it("refuses an index entry whose publisher escapes the root", async () => {
    const installer = createPluginInstaller(dir);
    const installed = await installer.install(validPluginBytes());
    if (!installed.ok || installed.plugin === undefined)
      throw new Error("install failed");

    // A crafted publisher would have made the old derivation join outside the
    // extensions root. The escaped tree is real, so a removal would show.
    const name = `yunari-escape-${path.basename(dir)}`;
    const escapedVersion = path.join(
      os.tmpdir(),
      name,
      "acme-sensors",
      "1.0.0",
    );
    await mkdir(escapedVersion, { recursive: true });
    await writeFile(path.join(escapedVersion, "sentinel.txt"), "x", "utf8");

    const indexFile = path.join(dir, "installed.json");
    const index = JSON.parse(await readFile(indexFile, "utf8")) as {
      plugins: Record<string, Record<string, unknown>>;
    };
    index.plugins["local/acme-sensors"] = {
      ...index.plugins["local/acme-sensors"],
      publisher: `../${name}`,
      // Exactly what the old derivation joined for that publisher.
      directory: path.join(dir, "..", name, "acme-sensors", "1.0.0"),
    };
    await writeFile(indexFile, `${JSON.stringify(index, null, 2)}\n`, "utf8");

    expect(await installer.list()).toEqual([]);
    await installer.remove("local/acme-sensors");

    expect(
      await readFile(path.join(escapedVersion, "sentinel.txt"), "utf8"),
    ).toBe("x");
    expect(
      await readFile(path.join(installed.plugin.directory, "main.js"), "utf8"),
    ).toBe("export default {};");
    await rm(path.join(os.tmpdir(), name), { recursive: true, force: true });
  });

  it("refuses an index entry whose key disagrees with its manifest", async () => {
    const installer = createPluginInstaller(dir);
    const installed = await installer.install(validPluginBytes());
    if (!installed.ok || installed.plugin === undefined)
      throw new Error("install failed");

    const indexFile = path.join(dir, "installed.json");
    const index = JSON.parse(await readFile(indexFile, "utf8")) as {
      plugins: Record<string, unknown>;
    };
    index.plugins["local/other-plugin"] = index.plugins["local/acme-sensors"];
    await writeFile(indexFile, `${JSON.stringify(index, null, 2)}\n`, "utf8");

    expect(await installer.list()).toEqual([]);
    await installer.remove("local/acme-sensors");
    expect(
      await readFile(path.join(installed.plugin.directory, "main.js"), "utf8"),
    ).toBe("export default {};");
  });

  it("restores the old tree when the index write fails", async () => {
    const installer = createPluginInstaller(dir);
    const installed = await installer.install(validPluginBytes());
    if (!installed.ok || installed.plugin === undefined)
      throw new Error("install failed");
    const versionDir = installed.plugin.directory;

    // Corrupt the index so the next mutation cannot be written.
    await writeFile(path.join(dir, "installed.json"), "{ not json", "utf8");

    const second = await installer.install(zipWith({ "main.js": "changed" }));

    expect(second.ok).toBe(false);
    expect(await readFile(path.join(versionDir, "main.js"), "utf8")).toBe(
      "export default {};",
    );
    expect(await readdir(path.dirname(versionDir))).toEqual(["1.0.0"]);
  });

  it("replaces a different version and removes the superseded tree", async () => {
    const installer = createPluginInstaller(dir);
    const first = await installer.install(validPluginBytes());
    if (!first.ok) throw new Error(first.message);

    const second = await installer.install(
      zipWith({ "main.js": "second" }, manifest({ version: "1.1.0" })),
    );
    if (!second.ok || second.plugin === undefined)
      throw new Error(second.ok ? "no plugin recorded" : second.message);

    expect(second.plugin.directory).toBe(
      path.join(dir, "local", "acme-sensors", "1.1.0"),
    );
    expect(
      await readFile(path.join(second.plugin.directory, "main.js"), "utf8"),
    ).toBe("second");
    await expect(
      stat(path.join(dir, "local", "acme-sensors", "1.0.0")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(path.join(dir, "local", "acme-sensors"))).toEqual([
      "1.1.0",
    ]);
  });

  it("cleans the temp directory and the id tree when writing a file fails", async () => {
    const installer = createPluginInstaller(dir);
    // `clash` is a file; `clash/inside.js` then needs it to be a directory.
    const result = await installer.install(
      zipWith({ clash: "x", "clash/inside.js": "y", "main.js": "z" }),
    );

    expect(result.ok).toBe(false);
    await expect(
      stat(path.join(dir, "local", "acme-sensors")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
