import { DEFAULT_SIGNALRGB_UDP_PORT } from "../signalrgb/bridge.js";
import { createJsonFile } from "./json-file.js";

/**
 * The SignalRGB colour receiver's settings.
 *
 * The port is a fact about this machine, so it lives with the other host
 * settings rather than in a theme. Only the port is stored: every other value
 * on the seam is fixed by `docs/signalrgb-bridge.md`.
 *
 * **A port this host cannot bind is refused rather than clamped** to a
 * neighbour the owner never named. The rule lives here, so the file's own
 * normaliser and the settings route that writes it cannot disagree.
 */

const FILE = "signalrgb-bridge.json";

interface SignalRgbBridgeSettings {
  /** The loopback UDP port the receiver binds. */
  readonly udpPort: number;
}

const DEFAULT_SETTINGS: SignalRgbBridgeSettings = {
  udpPort: DEFAULT_SIGNALRGB_UDP_PORT,
};

function portOf(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 65_535
  ) {
    throw new Error(
      "The bridge's udpPort must be a whole number from 1 to 65535.",
    );
  }
  return value;
}

function normalizeSettings(input: unknown): SignalRgbBridgeSettings {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return DEFAULT_SETTINGS;
  }

  const udpPort = (input as Record<string, unknown>)["udpPort"];
  if (udpPort === undefined) return DEFAULT_SETTINGS;

  return { udpPort: portOf(udpPort) };
}

/** The receiver's port setting, read and replaced through one validation. */
export interface SignalRgbBridgeSettingsStore {
  /** The port the receiver should bind; the contract's 7788 when nothing is
   *  stored or the file cannot be read. */
  read(): Promise<number>;
  /** Stores a whole-number port from 1 to 65535 and answers what was stored. */
  writeUdpPort(port: unknown): Promise<number>;
}

export function createSignalRgbBridgeSettings(
  directory: string,
): SignalRgbBridgeSettingsStore {
  const stored = createJsonFile(directory, FILE, {
    normalize: normalizeSettings,
    empty: () => DEFAULT_SETTINGS,
  });

  return {
    async read() {
      return (await stored.read()).udpPort;
    },

    async writeUdpPort(port) {
      const udpPort = portOf(port);
      await stored.write({ udpPort });
      return udpPort;
    },
  };
}
