import {
  CONSENT_SCHEMA_TAG,
  type ConsentBinding,
  type ConsentRecord,
  type ConsentState,
  consentFingerprint,
  consentMatches,
  consentRequired,
  type ExecutionProfile,
  type InstalledExtension,
  type InstalledPlugin,
  type InstallResult,
  PLUGIN_API_MAJOR,
  type PluginContributions,
  type PluginInstaller,
} from "@yunari/extension-api";
import type { ConsentStore } from "./consent-store.js";
import type { KillListStore } from "./kill-list.js";

export type { InstalledExtension } from "@yunari/extension-api";

const MISMATCH = "That consent does not match the installed plugin.";

export interface ExtensionService {
  list(): Promise<readonly InstalledExtension[]>;
  install(bytes: Uint8Array): Promise<InstallResult>;
  grantConsent(
    key: string,
    fingerprint: string,
  ): Promise<{ readonly ok: boolean; readonly message?: string }>;
  remove(key: string): Promise<void>;
  /** False when the plugin is killed, stale, or its consent is missing. */
  mayLoad(key: string): Promise<boolean>;
}

/**
 * The authority-bearing contribution identities, in one place: Plan 3 reads
 * them from here rather than spelling a second list. `assetCategories` is
 * display-only and grants nothing; devices are reserved for the hardware
 * phase, so the list stays empty until a manifest can declare one.
 */
function contributionIdentities(
  contributes: PluginContributions,
): readonly string[] {
  const identities: string[] = [];
  const groups = [
    "sensorProviders",
    "assetSources",
    "panelFamilies",
    "settingsPages",
    "customSources",
  ] as const;

  for (const group of groups) {
    const entries = contributes[group];
    if (entries === undefined) continue;
    for (const entry of entries) {
      const id = (entry as Readonly<Record<string, unknown>>)["id"];
      if (typeof id === "string") identities.push(`${group}:${id}`);
    }
  }

  return identities;
}

function bindingFor(plugin: InstalledPlugin): ConsentBinding {
  return {
    schemaTag: CONSENT_SCHEMA_TAG,
    pluginApi: PLUGIN_API_MAJOR,
    pluginKey: plugin.key,
    version: plugin.manifest.version,
    contentHash: plugin.contentHash,
    execution: plugin.manifest.execution,
    capabilities: plugin.manifest.capabilities,
    contributions: contributionIdentities(plugin.manifest.contributes),
    devices: [],
  };
}

function fingerprintFor(plugin: InstalledPlugin): Promise<string> {
  return consentFingerprint(bindingFor(plugin));
}

function extensionOf(
  plugin: InstalledPlugin,
  fingerprint: string,
  consent: ConsentState,
): InstalledExtension {
  return {
    key: plugin.key,
    name: plugin.manifest.name,
    version: plugin.manifest.version,
    execution: plugin.manifest.execution,
    capabilities: plugin.manifest.capabilities,
    contributions: plugin.manifest.contributes,
    consent,
    fingerprint,
  };
}

function consentStateFor(
  execution: ExecutionProfile,
  record: ConsentRecord | undefined,
  fingerprint: string,
): ConsentState {
  if (!consentRequired(execution)) return "not-required";
  return consentMatches(record, fingerprint) ? "granted" : "missing";
}

export function createExtensionService(options: {
  readonly installer: PluginInstaller;
  readonly consent: ConsentStore;
  readonly now: () => string;
  /** The store's revoke list. Absent when this host has no store origin, which
   *  leaves every plugin to its consent state. */
  readonly killList?: KillListStore;
  /** Runs after a successful install, grant or remove, so the host can reload
   *  the managers that read plugin contributions. */
  readonly onChange?: () => Promise<void>;
}): ExtensionService {
  const { installer, consent } = options;
  const changed = (): Promise<void> =>
    options.onChange?.() ?? Promise.resolve();

  /** A plugin the index cannot account for must not load, but its absence is a
   *  refusal rather than a failed request. */
  async function read(key: string): Promise<InstalledPlugin | undefined> {
    try {
      return await installer.read(key);
    } catch {
      return undefined;
    }
  }

  return {
    async list() {
      const file = await consent.read();
      const plugins = await installer.list();

      return Promise.all(
        plugins.map(async (plugin) => {
          const fingerprint = await fingerprintFor(plugin);
          return extensionOf(
            plugin,
            fingerprint,
            consentStateFor(
              plugin.manifest.execution,
              file.plugins[plugin.key],
              fingerprint,
            ),
          );
        }),
      );
    },

    async install(bytes) {
      const result = await installer.install(bytes);
      if (result.ok) {
        // A plugin that arrived after the last refresh may already be revoked;
        // the check is cheap and the answer is what `mayLoad` reads.
        await options.killList?.refresh();
        await changed();
      }
      return result;
    },

    async grantConsent(key, fingerprint) {
      const plugin = await read(key);
      if (plugin === undefined) return { ok: false, message: MISMATCH };

      // A data or declarative plugin runs no code of its own; nothing was ever
      // required, so granting changes no stored state.
      if (!consentRequired(plugin.manifest.execution)) {
        await changed();
        return { ok: true };
      }

      const computed = await fingerprintFor(plugin);
      if (computed !== fingerprint) return { ok: false, message: MISMATCH };

      await consent.grant({
        pluginKey: plugin.key,
        version: plugin.manifest.version,
        fingerprint: computed,
        grantedAt: options.now(),
      });
      await changed();
      return { ok: true };
    },

    async remove(key) {
      await installer.remove(key);
      await consent.revoke(key);
      await changed();
    },

    async mayLoad(key) {
      // A revoked plugin does not load even while its consent still matches:
      // the kill list is the store's word about a package already on disk.
      if ((await options.killList?.isKilled(key)) === true) return false;

      const plugin = await read(key);
      if (plugin === undefined) return false;
      if (!consentRequired(plugin.manifest.execution)) return true;

      try {
        const file = await consent.read();
        return consentMatches(file.plugins[key], await fingerprintFor(plugin));
      } catch {
        // An unreadable grant is no grant.
        return false;
      }
    },
  };
}
