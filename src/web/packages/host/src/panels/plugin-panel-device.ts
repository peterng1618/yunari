import type {
  InstalledPlugin,
  PanelOpenResult,
  PanelPresentParams,
} from "@yunari/extension-api";
import type { DeviceBroker } from "../extensions/runtime/device-broker.js";
import type { PluginSupervisor } from "../extensions/runtime/supervisor.js";
import type {
  PanelControlCommand,
  PanelControls,
  PanelDevice,
  PanelGeometry,
} from "./panel-device.js";
import type { PanelFamilyContribution } from "./panel-families.js";

/**
 * One plugin panel, driven through the worker protocol.
 *
 * **The device handle never leaves the host.** The plugin opens its own device
 * with `usb.open` and keeps the broker's token on its side; every message here
 * carries only pixels, geometry and commands. A worker that dies closes every
 * handle this plugin holds, so one dead display cannot leak another's device.
 */

export interface PluginPanelDeviceOptions {
  readonly plugin: InstalledPlugin;
  readonly contribution: PanelFamilyContribution;
  readonly supervisor: PluginSupervisor;
  readonly broker: DeviceBroker;
  /** The stream the owner chose for this display, sent with `panel.open`. */
  readonly renderMode?: string;
}

function readOpenResult(value: unknown): PanelOpenResult {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("panel.open answered a value that is not an object.");
  }

  const record = value as Readonly<Record<string, unknown>>;
  const frameIntervalMs = record["frameIntervalMs"];
  if (
    frameIntervalMs !== undefined &&
    (typeof frameIntervalMs !== "number" ||
      !Number.isFinite(frameIntervalMs) ||
      frameIntervalMs <= 0)
  ) {
    throw new Error(
      "panel.open stated a cadence that is not a positive number.",
    );
  }

  const stillFormat = record["stillFormat"];
  if (
    stillFormat !== undefined &&
    stillFormat !== "jpeg" &&
    stillFormat !== "png"
  ) {
    throw new Error(
      "panel.open stated a still format that is not jpeg or png.",
    );
  }

  return {
    ...(frameIntervalMs === undefined
      ? {}
      : { frameIntervalMs: frameIntervalMs as number }),
    ...(stillFormat === undefined
      ? {}
      : { stillFormat: stillFormat as "jpeg" | "png" }),
  };
}

export class PluginPanelDevice implements PanelDevice {
  readonly geometry: PanelGeometry;
  readonly controls: PanelControls | undefined;
  readonly video = undefined;

  readonly #supervisor: PluginSupervisor;
  readonly #broker: DeviceBroker;
  readonly #pluginKey: string;
  readonly #renderMode: string | undefined;
  #frameIntervalMs: number | undefined;
  #stillFormat: "jpeg" | "png" | undefined;

  constructor(options: PluginPanelDeviceOptions) {
    this.geometry = options.contribution.geometry;
    this.#supervisor = options.supervisor;
    this.#broker = options.broker;
    this.#pluginKey = options.plugin.key;
    this.#renderMode = options.renderMode;
    this.controls =
      options.contribution.commands.length === 0
        ? undefined
        : {
            commands: options.contribution.commands,
            run: (command) => this.#run(command),
          };
  }

  get frameIntervalMs(): number | undefined {
    return this.#frameIntervalMs;
  }

  get stillFormat(): "jpeg" | "png" | undefined {
    return this.#stillFormat;
  }

  async open(): Promise<void> {
    try {
      const answer = await this.#supervisor.request<unknown>("panel.open", {
        width: this.geometry.width,
        height: this.geometry.height,
        renderMode: this.#renderMode,
      });
      const result = readOpenResult(answer);
      this.#frameIntervalMs = result.frameIntervalMs;
      this.#stillFormat = result.stillFormat;
    } catch (error) {
      await this.#closeAll();
      throw error;
    }
  }

  async present(still: Uint8Array): Promise<void> {
    const params: PanelPresentParams = {
      format: this.#stillFormat ?? "jpeg",
      bytes: still,
    };

    try {
      await this.#supervisor.request("panel.present", params);
    } catch (error) {
      await this.#closeAll();
      throw error;
    }
  }

  async close(): Promise<void> {
    try {
      await this.#supervisor.request("panel.close", {});
    } catch {
      // A worker that already died has no display left to stop; the broker
      // handles below are still this host's to close.
    }
    await this.#closeAll();
  }

  async #run(command: PanelControlCommand): Promise<string> {
    try {
      const reply = await this.#supervisor.request<unknown>("panel.command", {
        command,
      });
      return typeof reply === "string" ? reply : "";
    } catch (error) {
      await this.#closeAll();
      throw error;
    }
  }

  async #closeAll(): Promise<void> {
    await this.#broker.closeAll(this.#pluginKey).catch(() => undefined);
  }
}
