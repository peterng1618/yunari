import { strToU8, Zip, ZipPassThrough, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readPluginPackage } from "./package";

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

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** fflate's object form cannot repeat a name, so the streaming writer does. */
function zipWithDuplicate(name: string): Uint8Array {
  const chunks: Uint8Array[] = [];
  const zip = new Zip((_error, chunk) => {
    chunks.push(chunk);
  });
  const add = (filename: string, content: string): void => {
    const entry = new ZipPassThrough(filename);
    zip.add(entry);
    entry.push(strToU8(content), true);
  };
  add("yunari-plugin.json", JSON.stringify(manifest()));
  add("main.js", "a");
  add(name, "b");
  zip.end();
  return concatenate(chunks);
}

describe("plugin package reader", () => {
  it("reads the manifest and every file of a valid package", () => {
    const result = readPluginPackage(
      zipWith({ "main.js": "export default {};" }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.package.manifest.id).toBe("acme-sensors");
    expect(result.package.manifest.version).toBe("1.0.0");
    expect(Object.keys(result.package.files).sort()).toEqual([
      "main.js",
      "yunari-plugin.json",
    ]);
  });

  it("refuses a path traversal entry", () => {
    expect(readPluginPackage(zipWith({ "../main.js": "x" }))).toEqual({
      ok: false,
      message:
        'Plugin package path "../main.js" is not relative to the package root.',
    });
  });

  it("refuses an absolute entry", () => {
    expect(readPluginPackage(zipWith({ "/main.js": "x" }))).toEqual({
      ok: false,
      message:
        'Plugin package path "/main.js" is not relative to the package root.',
    });
  });

  it("refuses a Windows drive-letter entry", () => {
    expect(readPluginPackage(zipWith({ "C:main.js": "x" }))).toEqual({
      ok: false,
      message:
        'Plugin package path "C:main.js" is not relative to the package root.',
    });
  });

  it("refuses an entry with a backslash", () => {
    const name = "..\\main.js";
    expect(readPluginPackage(zipWith({ [name]: "x" }))).toEqual({
      ok: false,
      message: `Plugin package path ${JSON.stringify(name)} is not relative to the package root.`,
    });
  });

  it("refuses an entry with a NUL byte", () => {
    const name = "main\0.js";
    expect(readPluginPackage(zipWith({ [name]: "x" }))).toEqual({
      ok: false,
      message: `Plugin package path ${JSON.stringify(name)} contains a NUL byte.`,
    });
  });

  it("refuses duplicate entry names", () => {
    expect(readPluginPackage(zipWithDuplicate("main.js"))).toEqual({
      ok: false,
      message: "That package contains unsafe archive entries.",
    });
  });

  it("refuses a package with too many entries", () => {
    const files: Record<string, string> = { "main.js": "x" };
    for (let index = 0; index < 512; index += 1)
      files[`extra-${index}.txt`] = "x";

    expect(readPluginPackage(zipWith(files))).toEqual({
      ok: false,
      message: "That package declares more than 512 archive entries.",
    });
  });

  it("refuses a package that expands past the cap", () => {
    const bytes = zipSync(
      {
        "yunari-plugin.json": strToU8(JSON.stringify(manifest())),
        "main.js": strToU8("x"),
        "big.bin": new Uint8Array(64 * 1024 * 1024 + 1),
      },
      { level: 6 },
    );

    expect(readPluginPackage(bytes)).toEqual({
      ok: false,
      message: "That package contains unsafe archive entries.",
    });
  });

  it("refuses a package without yunari-plugin.json", () => {
    expect(
      readPluginPackage(zipSync({ "main.js": strToU8("x") }, { level: 0 })),
    ).toEqual({
      ok: false,
      message: "A plugin package needs yunari-plugin.json.",
    });
  });

  it("refuses a package whose main entry is not a file", () => {
    expect(readPluginPackage(zipWith({}))).toEqual({
      ok: false,
      message: 'Plugin package is missing its "main" file "main.js".',
    });
  });

  it("propagates a manifest refusal", () => {
    expect(
      readPluginPackage(
        zipWith({ "main.js": "x" }, manifest({ execution: "data" })),
      ),
    ).toEqual({
      ok: false,
      message:
        'The "main" entry requires "trusted-worker", but the manifest declares "data".',
    });
  });

  it("validates a directory marker but never exposes it", () => {
    const result = readPluginPackage(
      zipWith({ "assets/": "", "main.js": "x" }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.package.files).sort()).toEqual([
      "main.js",
      "yunari-plugin.json",
    ]);
  });
});
