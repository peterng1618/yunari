import {
  type DeviceAllowlist,
  deviceAllowlistOf,
  type InstalledPlugin,
  PANEL_COMMAND_KINDS,
  type PanelCommand,
  type PluginInstaller,
} from "@yunari/extension-api";
import type { AssetSource } from "../assets/source.js";
import { createAssetSources } from "../assets/sources.js";
import type { PanelFamilyContribution } from "../panels/panel-families.js";
import { pluginPanelFamily } from "../panels/plugin-panel-family.js";
import type {
  PluginPanelRow,
  PluginPanelRows,
} from "../panels/plugin-panel-rows.js";
import type { SensorProvider } from "../providers/provider.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { createPluginAssetSources } from "./asset-sources.js";
import { declarativeAssetAdapters } from "./declarative-sources.js";
import { orderProviders } from "./provider-order.js";
import { createPluginProviders, startPluginSupervisor } from "./providers.js";
import type { DeviceBroker } from "./runtime/device-broker.js";
import { revokePluginRuntime } from "./runtime/plugin-revocation.js";
import type {
  HostApiDispatcher,
  PluginSupervisor,
} from "./runtime/supervisor.js";
import type { ExtensionService } from "./service.js";

/**
 * The live plugin runtime: one supervisor per loadable plugin and the
 * contributions those supervisors back, kept current while the host runs.
 *
 * A change the extension service reports — an install, a consent grant, a
 * revoke — calls `reconcile`. It starts a worker that became loadable, stops one
 * that no longer may load through the same revocation path shutdown uses, and
 * rebuilds the provider, asset-source and panel-row lists from the supervisors
 * that are running. The registries the server and the panel manager read are
 * updated in place, so every surface sees one answer without a restart.
 *
 * The lists are rebuilt rather than patched: one collision rule, one provider
 * order read, and one place that decides which contributions a supervisor
 * backs. Rebuilds happen on a change, never on a poll.
 */

export interface PluginRuntimeOptions {
  readonly installer: PluginInstaller;
  readonly extensions: ExtensionService;
  readonly hostApi: HostApiDispatcher;
  readonly workerEntry?: string;
  /** The host's own providers, in their precedence order. */
  readonly builtinProviders: readonly SensorProvider[];
  readonly registry: ProviderRegistry;
  /** The host's own asset sources, whose ids no plugin may shadow. */
  readonly builtinAssetSources: readonly AssetSource[];
  readonly panelRows: PluginPanelRows;
  readonly broker: DeviceBroker;
  /** The broker's allowlists, shared with it by reference. */
  readonly allowlists: Map<string, readonly DeviceAllowlist[]>;
  readonly onFailure?: (pluginKey: string, reason: string) => void;
  readonly onCrash?: (pluginKey: string) => void;
  readonly onRestart?: (
    pluginKey: string,
    attempt: number,
    delayMs: number,
  ) => void;
}

export interface PluginRuntime {
  /** The running workers, keyed by plugin key; revocation removes one. */
  readonly supervisors: ReadonlyMap<string, PluginSupervisor>;
  /** The providers a poll reads, built-ins first, in the stored order. */
  providers(): readonly SensorProvider[];
  /** The finder's rows, built-ins first; read once per request. */
  assetSources(): readonly AssetSource[];
  reconcile(): Promise<void>;
  stop(): Promise<void>;
}

function panelRowsFor(
  installed: readonly InstalledPlugin[],
  supervisors: ReadonlyMap<string, PluginSupervisor>,
  broker: DeviceBroker,
): readonly PluginPanelRow[] {
  const rows: PluginPanelRow[] = [];

  for (const plugin of installed) {
    const supervisor = supervisors.get(plugin.key);
    if (supervisor === undefined) continue;

    for (const entry of plugin.manifest.contributes.panelFamilies ?? []) {
      const commands: PanelCommand["kind"][] = [];
      for (const command of entry.commands) {
        if (PANEL_COMMAND_KINDS.has(command as PanelCommand["kind"])) {
          commands.push(command as PanelCommand["kind"]);
        } else {
          console.error(
            `Panel family ${entry.id} in ${plugin.key}: this host does not know the command "${command}".`,
          );
        }
      }

      const contribution: PanelFamilyContribution = {
        id: entry.id,
        label: entry.label,
        vendorId: entry.vendorId,
        productId: entry.productId,
        geometry: entry.geometry,
        support: entry.support,
        commands,
        ...(entry.renderModes === undefined
          ? {}
          : { renderModes: entry.renderModes }),
      };

      // One bad row is reported and skipped: a plugin's manifest error must
      // not take the host down before its own displays start.
      try {
        rows.push({
          pluginKey: plugin.key,
          family: pluginPanelFamily({
            plugin,
            contribution,
            supervisor,
            broker,
          }),
        });
      } catch (error) {
        console.error(
          `Panel family ${entry.id} in ${plugin.key}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  return rows;
}

export function createPluginRuntime(
  options: PluginRuntimeOptions,
): PluginRuntime {
  const supervisors = new Map<string, PluginSupervisor>();
  const supervisorOptions = {
    extensions: options.extensions,
    hostApi: options.hostApi,
    ...(options.workerEntry === undefined
      ? {}
      : { workerEntry: options.workerEntry }),
    ...(options.onFailure === undefined
      ? {}
      : { onFailure: options.onFailure }),
    ...(options.onCrash === undefined ? {} : { onCrash: options.onCrash }),
    ...(options.onRestart === undefined
      ? {}
      : { onRestart: options.onRestart }),
  };

  let currentProviders: readonly SensorProvider[] = options.builtinProviders;
  let currentSources: readonly AssetSource[] = options.builtinAssetSources;
  let stopped = false;
  let queue: Promise<void> = Promise.resolve();

  async function run(): Promise<void> {
    if (stopped) return;

    const installed = await options.installer.list();

    // One read of loadability per plugin, so every list below agrees about
    // which plugins this run may serve.
    const loadable = new Map<string, boolean>();
    for (const plugin of installed) {
      let canLoad = false;
      try {
        canLoad = await options.extensions.mayLoad(plugin.key);
      } catch {
        canLoad = false;
      }
      loadable.set(plugin.key, canLoad);
    }

    // Stop what can no longer load through the same path a revoke uses: the
    // worker, the allowlist, the panel rows and its open devices go together.
    for (const key of [...supervisors.keys()]) {
      if (loadable.get(key) === true) continue;
      await revokePluginRuntime({
        pluginKey: key,
        supervisors: supervisors as Map<string, PluginSupervisor>,
        allowlists: options.allowlists,
        panelRows: options.panelRows,
        broker: options.broker,
      });
    }

    // An allowlist mirrors what may load: a newly consented plugin gains the
    // devices its manifest declares and a revoked one loses them.
    options.allowlists.clear();
    for (const plugin of installed) {
      if (loadable.get(plugin.key) !== true) continue;
      options.allowlists.set(plugin.key, deviceAllowlistOf(plugin.manifest));
    }

    // One worker per plugin, started once. A second grant finds the key here
    // and does not fork another child.
    for (const plugin of installed) {
      if (loadable.get(plugin.key) !== true) continue;
      if (supervisors.has(plugin.key)) continue;
      const supervisor = await startPluginSupervisor(supervisorOptions, plugin);
      if (supervisor !== undefined) supervisors.set(plugin.key, supervisor);
    }

    // The order store is re-read because a provider can have joined since
    // startup; the registry reads the list on every poll.
    const pluginProviders = await createPluginProviders({
      installer: options.installer,
      extensions: options.extensions,
      hostApi: options.hostApi,
      supervisors,
      installed,
      ...(options.onFailure === undefined
        ? {}
        : { onFailure: options.onFailure }),
    });
    currentProviders = orderProviders(
      options.builtinProviders,
      pluginProviders.providers,
      await options.extensions.readProviderOrder(),
    );
    options.registry.setProviders(currentProviders);

    options.panelRows.replace(
      panelRowsFor(installed, supervisors, options.broker),
    );

    // Code contributions first, then declarative ones. A code source may not
    // shadow a built-in; a declarative source may shadow neither.
    const builtinIds = options.builtinAssetSources.map((source) => source.id);
    const code = await createPluginAssetSources({
      installer: options.installer,
      supervisors,
      installed,
      taken: builtinIds,
      ...(options.onFailure === undefined
        ? {}
        : { onFailure: options.onFailure }),
    });
    const declarative = declarativeAssetAdapters(
      await options.extensions.list(),
      new Set([...builtinIds, ...code.map((source) => source.id)]),
    );
    currentSources = createAssetSources(options.builtinAssetSources, [
      ...code,
      ...declarative,
    ]);
  }

  function reconcile(): Promise<void> {
    if (stopped) return Promise.resolve();
    // Changes arrive one at a time: a grant that lands while an install is
    // still rebuilding must not interleave two lists.
    queue = queue.then(run, run);
    return queue;
  }

  return {
    supervisors,
    providers: () => currentProviders,
    assetSources: () => currentSources,
    reconcile,
    async stop() {
      if (stopped) return;
      stopped = true;
      await queue.catch(() => undefined);
      for (const supervisor of supervisors.values()) {
        try {
          await supervisor.stop();
        } catch {
          // One worker that will not stop must not strand the others.
        }
      }
      supervisors.clear();
    },
  };
}
