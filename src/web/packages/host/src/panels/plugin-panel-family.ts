import type { InstalledPlugin } from "@yunari/extension-api";
import type { DisplayRenderMode } from "@yunari/renderer-core";
import type { DeviceBroker } from "../extensions/runtime/device-broker.js";
import type { PluginSupervisor } from "../extensions/runtime/supervisor.js";
import type { PanelFamily, PanelHint } from "./panel-device.js";
import type { PanelFamilyContribution } from "./panel-families.js";
import { PluginPanelDevice } from "./plugin-panel-device.js";

/**
 * A plugin's panel family, seen by the host's registry as one more row.
 *
 * The contribution states the hardware and the ids; `attached` and `open` are
 * the host's to supply. `cacheDir` is accepted for interface compatibility but
 * is never sent to the worker: a plugin never receives a host path.
 */

export interface PluginPanelFamilyOptions {
  readonly plugin: InstalledPlugin;
  readonly contribution: PanelFamilyContribution;
  readonly supervisor: PluginSupervisor;
  readonly broker: DeviceBroker;
  readonly cacheDir?: string | undefined;
}

/** Only the closed stream names the host knows can reach a display record. A
 *  plugin's own mode names are not `DisplayRenderMode`s. */
function declaredRenderModes(
  contribution: PanelFamilyContribution,
): readonly DisplayRenderMode[] | undefined {
  const modes = contribution.renderModes?.filter(
    (mode): mode is DisplayRenderMode => mode === "mode-a" || mode === "mode-b",
  );
  return modes === undefined || modes.length === 0 ? undefined : modes;
}

function readHint(value: unknown): PanelHint {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("panel.attached answered a hint that is not an object.");
  }

  const record = value as Readonly<Record<string, unknown>>;
  const vendorId = record["vendorId"];
  const productId = record["productId"];
  const serial = record["serial"];
  const label = record["label"];

  if (
    typeof vendorId !== "number" ||
    !Number.isInteger(vendorId) ||
    typeof productId !== "number" ||
    !Number.isInteger(productId) ||
    typeof serial !== "string" ||
    typeof label !== "string"
  ) {
    throw new Error("panel.attached answered a hint with invalid fields.");
  }

  return { vendorId, productId, serial, label };
}

function readHints(value: unknown): readonly PanelHint[] {
  if (!Array.isArray(value)) {
    throw new Error("panel.attached did not answer a list of hints.");
  }
  return value.map(readHint);
}

async function attachedHints(
  options: PluginPanelFamilyOptions,
): Promise<readonly PanelHint[]> {
  const { plugin, contribution, supervisor, broker } = options;

  try {
    const answer = await supervisor.request<unknown>("panel.attached", {});
    return readHints(answer).filter(
      (hint) =>
        hint.vendorId === contribution.vendorId &&
        hint.productId === contribution.productId,
    );
  } catch {
    // A dead or misbehaving worker must not hide the devices the broker can
    // still see. The registry also catches, but the fallback belongs here.
    const devices = await broker.list(plugin.key);
    return devices
      .filter(
        (device) =>
          device.vendorId === contribution.vendorId &&
          device.productId === contribution.productId,
      )
      .map((device) => ({
        vendorId: device.vendorId,
        productId: device.productId,
        serial: device.serial ?? "",
        label: contribution.label,
      }));
  }
}

function requirePositiveGeometry(contribution: PanelFamilyContribution): void {
  const { width, height } = contribution.geometry;
  if (
    !Number.isInteger(width) ||
    width <= 0 ||
    !Number.isInteger(height) ||
    height <= 0
  ) {
    throw new Error(
      "A panel family's geometry must be a positive whole number of pixels.",
    );
  }
}

export function pluginPanelFamily(
  options: PluginPanelFamilyOptions,
): PanelFamily {
  requirePositiveGeometry(options.contribution);

  const renderModes = declaredRenderModes(options.contribution);

  return {
    id: options.contribution.id,
    label: options.contribution.label,
    vendorId: options.contribution.vendorId,
    productId: options.contribution.productId,
    support: options.contribution.support,
    commands: options.contribution.commands,
    geometry: options.contribution.geometry,
    ...(renderModes === undefined ? {} : { renderModes }),
    attached: () => attachedHints(options),
    open: async (openOptions) => {
      const device = new PluginPanelDevice({
        plugin: options.plugin,
        contribution: options.contribution,
        supervisor: options.supervisor,
        broker: options.broker,
        ...(openOptions?.renderMode === undefined
          ? {}
          : { renderMode: openOptions.renderMode }),
      });

      try {
        await device.open();
      } catch (error) {
        // `PluginPanelDevice.open` already closed every broker handle for this
        // plugin; closing again here would repeat the worker round trip.
        throw error;
      }

      return device;
    },
  };
}
