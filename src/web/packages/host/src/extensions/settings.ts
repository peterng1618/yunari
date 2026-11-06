import { createHash } from "node:crypto";
import type {
  PluginInstaller,
  PluginManifest,
  SettingsField,
} from "@yunari/extension-api";
import { createJsonFile } from "../settings/json-file.js";

/**
 * Plugin-owned settings, in two halves.
 *
 * Declarative values are plain JSON in one host-owned file. A `secret` field is
 * written to the plugin's encrypted secret store and is never returned: the
 * host gives the browser only what a page may render. Every write is validated
 * against the same field declarations the editor draws, and an unknown key is
 * refused rather than stored for a later manifest to claim.
 */
export interface PluginSettingsStore {
  read(pluginKey: string): Promise<Readonly<Record<string, unknown>>>;
  write(
    pluginKey: string,
    values: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly ok: boolean; readonly message?: string }>;
}

/** The part of `SecretStore` a settings write needs. */
export interface PluginSettingsSecrets {
  write(name: string, bytes: Uint8Array): Promise<void>;
  remove(name: string): Promise<void>;
}

export interface PluginSettingsStoreOptions {
  readonly installer: PluginInstaller;
  /** Where the JSON file lives. The secret store is a different directory. */
  readonly directory: string;
  readonly secrets: PluginSettingsSecrets;
}

interface StoredSettings {
  readonly version: 1;
  readonly plugins: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

const FILE = "plugin-settings.json";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalize(parsed: unknown): StoredSettings {
  if (
    !isRecord(parsed) ||
    parsed["version"] !== 1 ||
    !isRecord(parsed["plugins"])
  )
    throw new Error("Plugin settings refused: not version 1.");
  const plugins: Record<string, Readonly<Record<string, unknown>>> = {};
  for (const [key, value] of Object.entries(parsed["plugins"])) {
    if (!isRecord(value))
      throw new Error(
        `Plugin settings refused: entry ${JSON.stringify(key)} is not an object.`,
      );
    plugins[key] = { ...value };
  }
  return { version: 1, plugins };
}

/** The declared fields, across every declarative page. A sandboxed page owns
 *  its own storage through the frame API, so it declares none here. */
function declaredFields(
  manifest: PluginManifest,
): ReadonlyMap<string, SettingsField> {
  const fields = new Map<string, SettingsField>();
  for (const page of manifest.contributes.settingsPages ?? []) {
    if (!("fields" in page)) continue;
    for (const field of page.fields) fields.set(field.key, field);
  }
  return fields;
}

function fieldName(field: SettingsField): string {
  return `The field ${JSON.stringify(field.key)}`;
}

/** A sandboxed page owns its own keys, so the host accepts a plain JSON value
 *  the plugin asked it to keep. Anything structured is refused: the settings
 *  file is a flat record, not a second document store. */
function isPlainValue(value: unknown): boolean {
  return (
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && value.length <= 10_000)
  );
}

function validate(field: SettingsField, value: unknown): string | undefined {
  switch (field.type) {
    case "text":
      if (typeof value !== "string")
        return `${fieldName(field)} must be a string.`;
      if (field.maxLength !== undefined && value.length > field.maxLength)
        return `${fieldName(field)} must be at most ${field.maxLength} characters.`;
      return undefined;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value))
        return `${fieldName(field)} must be a finite number.`;
      if (field.min !== undefined && value < field.min)
        return `${fieldName(field)} must be at least ${field.min}.`;
      if (field.max !== undefined && value > field.max)
        return `${fieldName(field)} must be at most ${field.max}.`;
      return undefined;
    case "boolean":
      return typeof value === "boolean"
        ? undefined
        : `${fieldName(field)} must be a boolean.`;
    case "select":
      return typeof value === "string" &&
        field.options.some((option) => option.value === value)
        ? undefined
        : `${fieldName(field)} is not one of its options.`;
    case "secret":
      return typeof value === "string"
        ? undefined
        : `${fieldName(field)} must be a string.`;
  }
}

/** A secret's file name. The key may contain dots, and the secret store only
 *  accepts a bounded `[A-Za-z0-9_-]` name, so the name is a digest: stable,
 *  bounded and not a readable copy of the field. */
function secretName(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function createPluginSettingsStore(
  options: PluginSettingsStoreOptions,
): PluginSettingsStore {
  const stored = createJsonFile<StoredSettings>(options.directory, FILE, {
    normalize,
    empty: () => ({ version: 1, plugins: {} }),
  });

  return {
    async read(pluginKey) {
      const plugin = await options.installer
        .read(pluginKey)
        .catch(() => undefined);
      const fields =
        plugin === undefined
          ? new Map<string, SettingsField>()
          : declaredFields(plugin.manifest);
      const record = (await stored.read()).plugins[pluginKey] ?? {};
      const values: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(record)) {
        // A secret is never returned, even if a hand-edited file kept one.
        if (fields.get(key)?.type === "secret") continue;
        values[key] = value;
      }
      return values;
    },

    async write(pluginKey, values) {
      const plugin = await options.installer
        .read(pluginKey)
        .catch(() => undefined);
      if (plugin === undefined)
        return { ok: false, message: "No such extension is installed." };

      const fields = declaredFields(plugin.manifest);
      const sandboxed = (plugin.manifest.contributes.settingsPages ?? []).some(
        (page) => "ui" in page,
      );
      const accepted: Record<string, unknown> = {};
      const secrets: { readonly name: string; readonly value: string }[] = [];

      if (Object.keys(values).length > 64)
        return {
          ok: false,
          message: "A settings write carries at most 64 keys.",
        };

      // Validate every key before anything is written, so a refused body
      // leaves both the JSON and the secret store as they were.
      for (const [key, value] of Object.entries(values)) {
        const field = fields.get(key);
        if (field === undefined) {
          // A plugin with a sandboxed page has no declaration for the keys its
          // own frame stores; the write is still scoped to that plugin and to
          // a plain value.
          if (!sandboxed)
            return {
              ok: false,
              message: `The plugin settings page declares no ${JSON.stringify(key)} field.`,
            };
          if (!isPlainValue(value))
            return {
              ok: false,
              message: `The setting ${JSON.stringify(key)} must be a plain value.`,
            };
          accepted[key] = value;
          continue;
        }
        const reason = validate(field, value);
        if (reason !== undefined) return { ok: false, message: reason };

        if (field.type === "secret") {
          secrets.push({ name: secretName(key), value: value as string });
        } else {
          accepted[key] = value;
        }
      }

      for (const secret of secrets) {
        if (secret.value === "") await options.secrets.remove(secret.name);
        else
          await options.secrets.write(
            secret.name,
            new TextEncoder().encode(secret.value),
          );
      }

      await stored.mutate((current) => ({
        next: {
          version: 1,
          plugins: {
            ...current.plugins,
            [pluginKey]: {
              ...(current.plugins[pluginKey] ?? {}),
              ...accepted,
            },
          },
        },
        result: undefined,
      }));

      return { ok: true };
    },
  };
}
