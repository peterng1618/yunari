import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  isCodeAssetSourceEntry,
  type PluginManifest,
  readPluginManifest,
  validateManifestExecution,
} from "@yunari/extension-api";
import { describe, expect, it } from "vitest";

/**
 * The shipped plugin examples are validated with the same readers the host
 * uses, so an example cannot keep asking for a capability, a profile or a file
 * the platform no longer accepts. The two deterministic workers are also
 * called, because a handler that is exported but throws is still a broken
 * example.
 */

const EXAMPLES = fileURLToPath(
  new URL("../../../../../../examples", import.meta.url),
);
const PLUGINS = path.join(EXAMPLES, "plugins");

function pluginDirectories(): readonly string[] {
  return readdirSync(PLUGINS).filter((name) =>
    existsSync(path.join(PLUGINS, name, "yunari-plugin.json")),
  );
}

/** Every file the manifest names, so a template cannot point at a missing one. */
function referencedFiles(manifest: PluginManifest): readonly string[] {
  const files: string[] = [];
  if (manifest.main !== undefined) files.push(manifest.main);
  if (manifest.ui !== undefined) files.push(manifest.ui);
  for (const page of manifest.contributes.settingsPages ?? []) {
    if ("ui" in page) files.push(page.ui);
  }
  for (const source of manifest.contributes.assetSources ?? []) {
    if (isCodeAssetSourceEntry(source)) files.push(source["entry"] as string);
  }
  return files;
}

/** The handlers a worker must export for the contributions it declares. */
function requiredHandlers(manifest: PluginManifest): readonly string[] {
  const handlers = new Set<string>();
  if ((manifest.contributes.sensorProviders?.length ?? 0) > 0) {
    handlers.add("describe");
    handlers.add("sample");
  }
  for (const source of manifest.contributes.assetSources ?? []) {
    if (!isCodeAssetSourceEntry(source)) continue;
    handlers.add("asset.search");
    handlers.add("asset.bytes");
  }
  if ((manifest.contributes.panelFamilies?.length ?? 0) > 0) {
    for (const name of [
      "panel.attached",
      "panel.open",
      "panel.present",
      "panel.command",
      "panel.close",
    ]) {
      handlers.add(name);
    }
  }
  return [...handlers];
}

type Handler = (input: unknown) => unknown;

function handlerOf(
  module: Readonly<Record<string, unknown>>,
  name: string,
): Handler {
  const handler = module[name];
  expect(typeof handler, `${name} is not exported`).toBe("function");
  return handler as Handler;
}

async function loadManifest(
  directory: string,
): Promise<PluginManifest | undefined> {
  const text = readFileSync(
    path.join(PLUGINS, directory, "yunari-plugin.json"),
    "utf8",
  );
  const read = readPluginManifest(JSON.parse(text) as unknown);
  expect(read.ok, read.ok ? "" : read.reason).toBe(true);
  if (!read.ok) return undefined;

  const execution = validateManifestExecution(read.manifest);
  expect(execution.ok, execution.ok ? "" : execution.reason).toBe(true);
  return read.manifest;
}

async function loadWorker(
  directory: string,
  main: string,
): Promise<Readonly<Record<string, unknown>>> {
  return (await import(
    pathToFileURL(path.join(PLUGINS, directory, main)).href
  )) as Readonly<Record<string, unknown>>;
}

describe("shipped plugin examples", () => {
  for (const directory of pluginDirectories()) {
    it(`${directory} is a manifest the host admits`, async () => {
      const manifest = await loadManifest(directory);
      if (manifest === undefined) return;

      for (const relative of referencedFiles(manifest)) {
        expect(
          existsSync(path.join(PLUGINS, directory, relative)),
          `${relative} is missing`,
        ).toBe(true);
      }
    });
  }

  it("the trusted-worker sensor reads a value, not a zero", async () => {
    const manifest = await loadManifest("trusted-worker-sensor");
    if (manifest?.main === undefined) return;
    const module = await loadWorker("trusted-worker-sensor", manifest.main);

    handlerOf(module, "describe");
    const entries = (await handlerOf(
      module,
      "sample",
    )({
      semanticKeys: ["ram.used.percent"],
      nowMs: Date.now(),
    })) as readonly {
      readonly semanticKey: string;
      readonly sample: { readonly status: string; readonly value?: number };
    }[];

    expect(entries).toHaveLength(1);
    expect(entries[0]?.semanticKey).toBe("ram.used.percent");
    expect(entries[0]?.sample.status).toBe("ok");
    expect(entries[0]?.sample.value).toBeGreaterThanOrEqual(0);
    expect(entries[0]?.sample.value).toBeLessThanOrEqual(100);
  });

  it("the code asset source searches and answers usable bytes", async () => {
    const manifest = await loadManifest("trusted-worker-code-source");
    if (manifest?.main === undefined) return;
    const module = await loadWorker(
      "trusted-worker-code-source",
      manifest.main,
    );

    const page = (await handlerOf(
      module,
      "asset.search",
    )({
      query: "",
      page: 1,
      source: "example-shapes",
    })) as { readonly results: readonly Readonly<Record<string, unknown>>[] };

    expect(page.results.length).toBeGreaterThan(0);
    for (const result of page.results) {
      for (const key of [
        "id",
        "name",
        "sourceUrl",
        "preview",
        "kind",
        "licence",
      ]) {
        expect(typeof result[key], `${key} is not a string`).toBe("string");
        expect(result[key]).not.toBe("");
      }
    }

    const bytes = (await handlerOf(
      module,
      "asset.bytes",
    )({
      id: "example-shapes:red",
      source: "example-shapes",
    })) as {
      readonly bytes: string;
      readonly contentType: string;
      readonly filename: string;
    };

    expect(bytes.bytes).toMatch(/^[A-Za-z0-9+/]*={0,2}$/);
    expect(bytes.bytes.length % 4).toBe(0);
    expect(Buffer.from(bytes.bytes, "base64").byteLength).toBeGreaterThan(0);
    expect(bytes.contentType).not.toBe("");
    expect(bytes.filename).not.toContain("/");
  });

  it("every worker exports the handlers its contributions need", async () => {
    for (const directory of pluginDirectories()) {
      const manifest = await loadManifest(directory);
      if (manifest?.main === undefined) continue;

      const module = await loadWorker(directory, manifest.main);
      for (const name of requiredHandlers(manifest)) handlerOf(module, name);
    }
  });
});
