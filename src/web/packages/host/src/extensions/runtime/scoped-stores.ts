import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { InstalledPlugin } from "@yunari/extension-api";
import {
  IDENTIFIER_PATTERN,
  isWindowsReservedName,
} from "@yunari/extension-api";
import { createJsonFile } from "../../settings/json-file.js";
import { createSecretStore } from "../../settings/secret-store.js";

/**
 * The three per-plugin scopes. A plugin's key is qualified by its publisher, so
 * one publisher's `foo` cannot read another's, and every file name here is
 * derived from the key rather than used as one: no key can steer a path or
 * collide with a Windows device name.
 */

const KEY_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
export const MAX_STORAGE_VALUE_BYTES = 1024 * 1024;
const MAX_FILES = 1000;
export const MAX_SETTINGS_BYTES = 64 * 1024;

/** The storage key grammar, shared with the dispatcher's param check so a bad
 *  key is refused before it reaches the filesystem. */
export function isStorageKey(key: string): boolean {
  return KEY_PATTERN.test(key) && key !== "." && key !== "..";
}

export interface StorageScope {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  list(): Promise<readonly string[]>;
}

export interface SecretScope {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface PluginSettingsScope {
  get(): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
  /** Merge keys into the document as one queued read-modify-write, so a
   *  declarative page and the worker cannot drop each other's values. */
  merge(values: Record<string, unknown>): Promise<void>;
}

export interface ScopedStores {
  readonly storage: StorageScope;
  readonly secrets: SecretScope;
  readonly settings: PluginSettingsScope;
}

function checkKey(key: string): void {
  if (!isStorageKey(key)) {
    throw new Error(`"${key}" is not a storage key`);
  }
}

/** Publisher and id become path segments below. The manifest owns this
 *  grammar; re-asserting it here keeps a hostile or hand-built `InstalledPlugin`
 *  from steering the join. */
function checkSegment(value: string, label: string): void {
  if (!IDENTIFIER_PATTERN.test(value) || isWindowsReservedName(value)) {
    throw new Error(`"${value}" is not a valid plugin ${label}`);
  }
}

function checkValue(value: string, label: string): void {
  if (Buffer.byteLength(value, "utf8") > MAX_STORAGE_VALUE_BYTES) {
    throw new Error(
      `a ${label} value is at most ${MAX_STORAGE_VALUE_BYTES} bytes (1 MiB)`,
    );
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createStorageScope(directory: string): StorageScope {
  const fileFor = (key: string): string =>
    path.join(directory, Buffer.from(key, "utf8").toString("base64url"));

  async function keys(): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }

    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => Buffer.from(entry.name, "base64url").toString("utf8"))
      .sort();
  }

  return {
    async get(key) {
      checkKey(key);
      try {
        return await readFile(fileFor(key), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return undefined;
        throw error;
      }
    },

    async set(key, value) {
      checkKey(key);
      checkValue(value, "storage");

      const existing = await keys();
      if (existing.length >= MAX_FILES && !existing.includes(key)) {
        throw new Error(`a plugin's storage holds at most ${MAX_FILES} keys`);
      }

      await mkdir(directory, { recursive: true });
      await writeFile(fileFor(key), value, "utf8");
    },

    async remove(key) {
      checkKey(key);
      await rm(fileFor(key), { force: true });
    },

    list() {
      return keys();
    },
  };
}

function createSecretScope(directory: string): SecretScope {
  const store = createSecretStore(directory);
  /** The secret store's own name grammar is narrower than the storage key
   *  grammar, so the key is addressed by its digest rather than by itself. */
  const nameFor = (key: string): string =>
    createHash("sha256").update(key, "utf8").digest("hex");

  return {
    async get(key) {
      checkKey(key);
      const bytes = await store.read(nameFor(key));
      return bytes?.toString("utf8");
    },

    async set(key, value) {
      checkKey(key);
      checkValue(value, "secret");
      await store.write(nameFor(key), Buffer.from(value, "utf8"));
    },

    async remove(key) {
      checkKey(key);
      await store.remove(nameFor(key));
    },
  };
}

function createSettingsScope(
  directory: string,
  file: string,
): PluginSettingsScope {
  const jsonFile = createJsonFile<Record<string, unknown>>(directory, file, {
    normalize: (parsed) => {
      if (!isObject(parsed)) {
        throw new Error("Plugin settings must be a JSON object.");
      }
      return parsed;
    },
    empty: () => ({}),
  });

  return {
    get() {
      return jsonFile.read();
    },

    async set(value) {
      if (!isObject(value)) {
        throw new Error("Plugin settings must be a JSON object.");
      }
      if (
        Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_SETTINGS_BYTES
      ) {
        throw new Error(
          `plugin settings are at most ${MAX_SETTINGS_BYTES} bytes (64 KiB)`,
        );
      }
      await jsonFile.write(value);
    },

    async merge(values) {
      if (!isObject(values)) {
        throw new Error("Plugin settings must be a JSON object.");
      }
      await jsonFile.mutate((current) => {
        const next = { ...current, ...values };
        if (
          Buffer.byteLength(JSON.stringify(next), "utf8") > MAX_SETTINGS_BYTES
        ) {
          throw new Error(
            `plugin settings are at most ${MAX_SETTINGS_BYTES} bytes (64 KiB)`,
          );
        }
        return { next, result: undefined };
      });
    },
  };
}

/**
 * One cached set of scopes for an installed content, shared by every consumer.
 *
 * A declarative settings page and the plugin's worker must write and read the
 * same settings document and the same secret; two objects over one file would
 * each queue their own read-modify-write and could drop the other's value.
 */
export function createPluginScopes(
  root: string,
): (plugin: InstalledPlugin) => ScopedStores {
  const cache = new Map<string, ScopedStores>();

  return (plugin) => {
    const key = `${plugin.key}${plugin.contentHash}`;
    let stores = cache.get(key);
    if (stores === undefined) {
      stores = createScopedStores(root, plugin);
      cache.set(key, stores);
    }
    return stores;
  };
}

/** `root` is `<settingsDir>/extensions`. */
export function createScopedStores(
  root: string,
  plugin: InstalledPlugin,
): ScopedStores {
  const { publisher } = plugin;
  const id = plugin.manifest.id;
  checkSegment(publisher, "publisher");
  checkSegment(id, "id");

  return {
    storage: createStorageScope(path.join(root, "data", publisher, id)),
    secrets: createSecretScope(path.join(root, "secrets", publisher, id)),
    settings: createSettingsScope(
      path.join(root, "settings", publisher),
      `${id}.json`,
    ),
  };
}
