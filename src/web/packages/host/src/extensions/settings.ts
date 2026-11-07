import type {
  InstalledPlugin,
  PluginInstaller,
  PluginManifest,
  SettingsField,
} from "@yunari/extension-api";
import type { ScopedStores } from "./runtime/scoped-stores.js";

/**
 * Plugin-owned settings, read and written through the plugin's own scopes.
 *
 * A declarative page and the plugin's worker share one settings document and
 * one secret store, so a value typed in Settings is the value `settings.get`
 * and `secrets.get` answer. A `secret` field is written to the encrypted store
 * and is never returned: the host gives the browser only what a page may
 * render. Every write is validated against the same field declarations the
 * editor draws, and an unknown key is refused rather than stored for a later
 * manifest to claim.
 */
export interface PluginSettingsStore {
  read(pluginKey: string): Promise<Readonly<Record<string, unknown>>>;
  write(
    pluginKey: string,
    values: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly ok: boolean; readonly message?: string }>;
}

export interface PluginSettingsStoreOptions {
  readonly installer: PluginInstaller;
  /** The plugin's own scopes. The same factory feeds the worker host API, so
   *  both see one settings document and one secret. */
  readonly scopes: (plugin: InstalledPlugin) => ScopedStores;
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

export function createPluginSettingsStore(
  options: PluginSettingsStoreOptions,
): PluginSettingsStore {
  return {
    async read(pluginKey) {
      const plugin = await options.installer
        .read(pluginKey)
        .catch(() => undefined);
      if (plugin === undefined) return {};

      const fields = declaredFields(plugin.manifest);
      const values = await options.scopes(plugin).settings.get();
      const visible: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(values)) {
        // A secret lives in the encrypted store, but a hand-edited settings
        // file must not turn one into a value this route returns.
        if (fields.get(key)?.type === "secret") continue;
        visible[key] = value;
      }
      return visible;
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
      const secrets: { readonly key: string; readonly value: string }[] = [];

      if (Object.keys(values).length > 64)
        return {
          ok: false,
          message: "A settings write carries at most 64 keys.",
        };

      // Validate every key before anything is written, so a refused body
      // leaves both the settings document and the secret store as they were.
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
          secrets.push({ key, value: value as string });
        } else {
          accepted[key] = value;
        }
      }

      const scope = options.scopes(plugin);
      for (const secret of secrets) {
        if (secret.value === "") await scope.secrets.remove(secret.key);
        else await scope.secrets.set(secret.key, secret.value);
      }

      if (Object.keys(accepted).length > 0)
        await scope.settings.merge(accepted);

      return { ok: true };
    },
  };
}
