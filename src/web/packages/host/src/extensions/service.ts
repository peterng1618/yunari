import {
  CONSENT_SCHEMA_TAG,
  type ConsentBinding,
  type ConsentRecord,
  type ConsentState,
  consentFingerprint,
  consentMatches,
  consentRequired,
  deviceAllowlistOf,
  deviceIdentity,
  type ExecutionProfile,
  type InstalledExtension,
  type InstalledPlugin,
  type InstallResult,
  PLUGIN_API_MAJOR,
  type PluginContributions,
  type PluginInstaller,
} from "@yunari/extension-api";
import { redactForBrowser } from "../providers/provider.js";
import { decideUpdate } from "../store/update-policy.js";
import type { ConsentStore } from "./consent-store.js";
import type { KillListStore } from "./kill-list.js";
import {
  isProviderPlugin,
  type ProviderOrder,
  readProviderOrder as parseProviderOrder,
} from "./provider-order.js";

export type { InstalledExtension } from "@yunari/extension-api";

const MISMATCH = "That consent does not match the installed plugin.";

export interface ProviderOrderStore {
  read(): Promise<ProviderOrder>;
  write(order: ProviderOrder): Promise<void>;
}

export interface ExtensionService {
  list(): Promise<readonly InstalledExtension[]>;
  install(
    bytes: Uint8Array,
    options?: { readonly approveUpdate?: boolean },
  ): Promise<InstallResult>;
  grantConsent(
    key: string,
    fingerprint: string,
  ): Promise<{ readonly ok: boolean; readonly message?: string }>;
  remove(key: string): Promise<void>;
  /** False when the plugin is killed, stale, or its consent is missing. */
  mayLoad(key: string): Promise<boolean>;
  /** The installed record, including the directory this host serves the
   *  plugin's own files from; undefined when no such plugin is installed. */
  installedPlugin(key: string): Promise<InstalledPlugin | undefined>;
  /** The stored grant, unread when there is none; fingerprints stay the
   *  service's business. */
  consentRecord(key: string): Promise<ConsentRecord | undefined>;
  readProviderOrder(): Promise<ProviderOrder>;
  writeProviderOrder(
    order: ProviderOrder,
  ): Promise<{ ok: true } | { ok: false; message: string }>;
}

/**
 * The authority-bearing contribution identities, in one place: Plan 3 reads
 * them from here rather than spelling a second list. `assetCategories` is
 * display-only and grants nothing; devices are their own list because the
 * manifest declares them on the family, not as a contribution id.
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
    // The exact devices the manifest declares: adding one to a later version
    // changes the fingerprint, so the old grant cannot cover it.
    devices: deviceAllowlistOf(plugin.manifest).map(deviceIdentity),
    hosts: plugin.manifest.networkHosts ?? [],
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
    publisher: plugin.publisher,
    version: plugin.manifest.version,
    execution: plugin.manifest.execution,
    capabilities: plugin.manifest.capabilities,
    contributions: plugin.manifest.contributes,
    devices: deviceAllowlistOf(plugin.manifest).map(deviceIdentity),
    consent,
    fingerprint,
    ...(plugin.manifest.ui === undefined ? {} : { ui: plugin.manifest.ui }),
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
  /** Where the plugin provider precedence is kept. */
  readonly providerOrder: ProviderOrderStore;
  /** Runs after a successful install, grant or remove, so the host can reload
   *  the managers that read plugin contributions. */
  readonly onChange?: () => Promise<void>;
}): ExtensionService {
  const { installer, consent } = options;
  const changed = async (): Promise<void> => {
    try {
      await (options.onChange?.() ?? Promise.resolve());
    } catch (error) {
      // The install, grant or removal already landed. A reload that throws must
      // not turn a completed store change into a failed request: the next
      // change or the next host start rebuilds the contributions.
      console.error(
        `Extension reload failed: ${redactForBrowser(
          error instanceof Error ? error.message : String(error),
        )}`,
      );
    }
  };

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
      const killed = await options.killList?.load();

      return Promise.all(
        plugins.map(async (plugin) => {
          const fingerprint = await fingerprintFor(plugin);
          const extension = extensionOf(
            plugin,
            fingerprint,
            consentStateFor(
              plugin.manifest.execution,
              file.plugins[plugin.key],
              fingerprint,
            ),
          );
          const revoked = killed?.plugins[plugin.key];
          return revoked === undefined ? extension : { ...extension, revoked };
        }),
      );
    },

    async install(bytes, installOptions) {
      const preview = await installer.preview(bytes);
      // A package the reader refuses is the installer's sentence to give, and
      // its install path already carries it unchanged.
      if (!preview.ok || preview.plugin === undefined)
        return installer.install(bytes);

      const incoming = preview.plugin;
      const current = await read(incoming.key);
      // A key names its publisher, so an unchanged key cannot change one.
      // First installs and no-growth updates keep the automatic path.
      if (current !== undefined && installOptions?.approveUpdate !== true) {
        const decision = decideUpdate(
          bindingFor(current),
          bindingFor(incoming),
          false,
        );
        if (decision.action === "hold") {
          return {
            ok: false,
            held: {
              key: incoming.key,
              name: incoming.manifest.name,
              publisher: incoming.publisher,
              reasons: decision.reasons,
            },
          };
        }
      }

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

    async consentRecord(key) {
      try {
        return (await consent.read()).plugins[key];
      } catch {
        // An unreadable grant is no grant.
        return undefined;
      }
    },

    async installedPlugin(key) {
      return read(key);
    },

    readProviderOrder() {
      return options.providerOrder.read();
    },

    async writeProviderOrder(order) {
      let parsed: ProviderOrder;
      try {
        parsed = parseProviderOrder(order);
      } catch {
        return { ok: false, message: "That provider order is not readable." };
      }

      const providerKeys = new Set(
        (await installer.list())
          .filter(isProviderPlugin)
          .map((plugin) => plugin.key),
      );

      for (const key of parsed.pluginOrder) {
        if (!providerKeys.has(key)) {
          return {
            ok: false,
            message: `No installed extension provides the provider "${key}".`,
          };
        }
      }

      await options.providerOrder.write(parsed);
      // A live provider list reads this order on the next cycle, so the same
      // change notification an install uses is fired here.
      await changed();
      return { ok: true };
    },
  };
}
