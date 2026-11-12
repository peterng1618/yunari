import { DEFAULT_SIGNALRGB_UDP_PORT } from "../signalrgb/bridge.js";
import { createJsonFile } from "./json-file.js";

/**
 * The SignalRGB colour receiver's settings.
 *
 * The port is a fact about this machine, so it lives with the other host
 * settings rather than in a theme. Only the port is stored: every other value
 * on the seam is fixed by `docs/signalrgb-bridge.md`.
 */

const FILE = "signalrgb-bridge.json";

interface SignalRgbBridgeSettings {
  /** The loopback UDP port the receiver binds. */
  readonly udpPort: number;
}

const DEFAULT_SETTINGS: SignalRgbBridgeSettings = {
  udpPort: DEFAULT_SIGNALRGB_UDP_PORT,
};

function normalizeSettings(input: unknown): SignalRgbBridgeSettings {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return DEFAULT_SETTINGS;
  }

  const udpPort = (input as Record<string, unknown>)["udpPort"];
  if (udpPort === undefined) return DEFAULT_SETTINGS;
  // A port this host cannot bind is refused rather than clamped to a
  // neighbour the owner never named.
  if (
    typeof udpPort !== "number" ||
    !Number.isInteger(udpPort) ||
    udpPort < 1 ||
    udpPort > 65_535
  ) {
    throw new Error(
      "The bridge's udpPort must be a whole number from 1 to 65535.",
    );
  }

  return { udpPort };
}

/** The port the receiver should bind; the contract's 7788 when nothing is
 *  stored or the file cannot be read. */
export async function readSignalRgbUdpPort(directory: string): Promise<number> {
  const stored = createJsonFile(directory, FILE, {
    normalize: normalizeSettings,
    empty: () => DEFAULT_SETTINGS,
  });

  return (await stored.read()).udpPort;
}
