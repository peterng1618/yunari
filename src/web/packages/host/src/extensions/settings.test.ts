import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type PluginInstaller,
  type PluginManifest,
  type SettingsField,
} from "@yunari/extension-api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createPluginSettingsStore,
  type PluginSettingsSecrets,
} from "./settings";

const FIELDS: readonly SettingsField[] = [
  { key: "label", label: "Label", type: "text", maxLength: 8 },
  { key: "refresh", label: "Refresh", type: "number", min: 1, max: 60 },
  { key: "enabled", label: "Enabled", type: "boolean" },
  {
    key: "mode",
    label: "Mode",
    type: "select",
    options: [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ],
  },
  { key: "apiKey", label: "API key", type: "secret" },
];

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    manifestVersion: 1,
    id: "acme",
    name: "Acme",
    version: "1.0.0",
    description: "Acme",
    engines: { yunari: ">=0.1.0" },
    pluginApi: 1,
    execution: "declarative",
    capabilities: ["settings:own"],
    contributes: {
      settingsPages: [{ id: "acme", label: "Acme", fields: FIELDS }],
    },
    ...overrides,
  };
}

function installerFor(value: PluginManifest): PluginInstaller {
  return {
    list: async () => [],
    read: async (key) =>
      key === "local/acme"
        ? {
            key,
            publisher: "local",
            manifest: value,
            directory: "",
            contentHash: "a".repeat(64),
          }
        : undefined,
    install: async () => ({ ok: false }),
    remove: async () => undefined,
  };
}

function memorySecrets(): PluginSettingsSecrets & {
  readonly values: Map<string, Uint8Array>;
} {
  const values = new Map<string, Uint8Array>();
  return {
    values,
    write: async (name, bytes) => {
      values.set(name, bytes);
    },
    remove: async (name) => {
      values.delete(name);
    },
  };
}

describe("the plugin settings store", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(
      path.join(os.tmpdir(), "yunari-plugin-settings-"),
    );
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function storeFor(
    value: PluginManifest = manifest(),
    secrets = memorySecrets(),
  ) {
    return {
      store: createPluginSettingsStore({
        installer: installerFor(value),
        directory,
        secrets,
      }),
      secrets,
    };
  }

  it("refuses an unknown key and leaves the file unchanged", async () => {
    const { store } = storeFor();
    expect(await store.write("local/acme", { extra: 1 })).toEqual({
      ok: false,
      message: 'The plugin settings page declares no "extra" field.',
    });
    expect(await store.read("local/acme")).toEqual({});
  });

  it("keeps a sandboxed page's own flat keys", async () => {
    const { store } = storeFor(
      manifest({
        execution: "sandboxed-ui",
        capabilities: ["settings:own", "ui:frame"],
        ui: "index.html",
        contributes: {
          settingsPages: [
            { id: "acme", label: "Acme", ui: "settings/index.html" },
          ],
        },
      }),
    );
    expect(
      await store.write("local/acme", { custom: "yes", count: 2 }),
    ).toEqual({ ok: true });
    expect(await store.read("local/acme")).toEqual({ custom: "yes", count: 2 });
  });

  it("writes a declared value and reads it back", async () => {
    const { store } = storeFor();
    expect(
      await store.write("local/acme", { label: "hello", refresh: 12 }),
    ).toEqual({ ok: true });
    expect(await store.read("local/acme")).toEqual({
      label: "hello",
      refresh: 12,
    });
  });

  it("refuses a number outside its bounds without changing the store", async () => {
    const { store } = storeFor();
    await store.write("local/acme", { refresh: 12 });
    expect(await store.write("local/acme", { refresh: 600 })).toEqual({
      ok: false,
      message: 'The field "refresh" must be at most 60.',
    });
    expect(await store.read("local/acme")).toEqual({ refresh: 12 });
  });

  it("refuses a text longer than its declared maximum", async () => {
    const { store } = storeFor();
    expect(await store.write("local/acme", { label: "too long!" })).toEqual({
      ok: false,
      message: 'The field "label" must be at most 8 characters.',
    });
  });

  it("refuses a select value that is not one of its options", async () => {
    const { store } = storeFor();
    expect(await store.write("local/acme", { mode: "c" })).toEqual({
      ok: false,
      message: 'The field "mode" is not one of its options.',
    });
  });

  it("refuses a boolean that is not a boolean", async () => {
    const { store } = storeFor();
    expect(await store.write("local/acme", { enabled: "yes" })).toEqual({
      ok: false,
      message: 'The field "enabled" must be a boolean.',
    });
  });

  it("keeps a secret out of the readable settings", async () => {
    const { store, secrets } = storeFor();
    expect(await store.write("local/acme", { apiKey: "s3cret" })).toEqual({
      ok: true,
    });
    expect(await store.read("local/acme")).toEqual({});
    expect([...secrets.values.values()]).toEqual([
      new TextEncoder().encode("s3cret"),
    ]);
  });

  it("refuses every key when one key is unknown", async () => {
    const { store } = storeFor();
    expect(
      await store.write("local/acme", { label: "ok", extra: "no" }),
    ).toEqual({
      ok: false,
      message: 'The plugin settings page declares no "extra" field.',
    });
    expect(await store.read("local/acme")).toEqual({});
  });

  it("refuses a plugin this host does not hold", async () => {
    const { store } = storeFor();
    expect(await store.write("local/other", { label: "x" })).toEqual({
      ok: false,
      message: "No such extension is installed.",
    });
  });
});
