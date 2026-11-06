import type { DeviceAllowlist } from "@yunari/extension-api";
import type { PluginPanelRows } from "../../panels/plugin-panel-rows.js";
import type { DeviceBroker } from "./device-broker.js";
import type { PluginSupervisor } from "./supervisor.js";

/**
 * Unloading one plugin, in the one order that leaves nothing behind.
 *
 * A revoked, killed or consent-stale plugin must lose every way it can still
 * reach the machine: its worker, the devices the broker lets it name, the panel
 * rows a surface can offer, and the handles it already opened. `main.ts` owns
 * the maps and calls this; the test builds the same real objects, so the wiring
 * itself is covered rather than a registry unit alone.
 */

export interface PluginRevocation {
  readonly pluginKey: string;
  /** The running workers, keyed by plugin. The stopped one is removed. */
  readonly supervisors: Map<string, PluginSupervisor>;
  /** The declared devices per plugin, read by the broker's allowlist. */
  readonly allowlists: Map<string, readonly DeviceAllowlist[]>;
  /** The plugin rows the live panel registry serves. */
  readonly panelRows: PluginPanelRows;
  readonly broker: DeviceBroker;
}

export async function revokePluginRuntime(
  revocation: PluginRevocation,
): Promise<void> {
  const { pluginKey, supervisors, allowlists, panelRows, broker } = revocation;

  const supervisor = supervisors.get(pluginKey);
  if (supervisor !== undefined) {
    try {
      await supervisor.stop();
    } catch {
      // A worker that will not stop must not strand the rest of the cleanup.
    }
    supervisors.delete(pluginKey);
  }

  // Order matters: the allowlist goes before the handles close, so nothing can
  // reopen a device between the two.
  allowlists.delete(pluginKey);
  panelRows.remove(pluginKey);
  await broker.closeAll(pluginKey);
}
