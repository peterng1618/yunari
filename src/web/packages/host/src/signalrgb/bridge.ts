import { createSocket, type Socket } from "node:dgram";
import type {
  DeviceSink,
  DeviceTelemetry,
  LightingChannel,
  LightingLayout,
  LightingMode,
} from "../panels/device-sink.js";
import { orderedSinks } from "../panels/device-sink.js";

/**
 * The SignalRGB seam's host half: the loopback UDP colour receiver, the
 * newest-frame rule, the lighting modes and the counters the descriptor
 * publishes.
 *
 * **It never opens hardware.** Every frame is handed to a {@link DeviceSink}
 * belonging to an already-open panel driver, which serialises the write with
 * its own LCD commands. The bridge owns only the network side and the pacing.
 *
 * **A frame is never queued.** One pending frame is kept per device; a newer
 * datagram replaces it and counts as dropped. While a write is in flight the
 * newest frame waits for the next tick, so the device is driven at its own
 * rate rather than at the sender's.
 */

export const DEFAULT_SIGNALRGB_UDP_PORT = 7788;
/** One tick at ~30 Hz. */ const FRAME_INTERVAL_MS = 33;
/** Repeating a forced colour costs no more than one write a second. */
const FORCED_INTERVAL_MS = 1_000;
/** A status reading is cached this long: the contract polls at ≤1 Hz and a
 *  burst of GETs must not become a burst of `74 01` reports. */
const TELEMETRY_TTL_MS = 1_000;

const MAGIC = [0x59, 0x52, 0x47, 0x42] as const;
const VERSION = 1;

/** One parsed colour datagram. */
export interface ColourFrame {
  readonly deviceIndex: number;
  readonly ledCount: number;
  /** RGB triples, one per LED, in channel order. */
  readonly rgb: Uint8Array;
}

/** The device is not open, so there is nothing to write. */
export class DeviceNotFoundError extends Error {}
/** The request itself is wrong: a bad body, mode or colour. */
export class BridgeRequestError extends Error {}

/** Parse one `YRGB` datagram, refusing anything a sender has to fix. */
export function parseColourFrame(datagram: Uint8Array): ColourFrame {
  if (datagram.length < 8) {
    throw new Error("A colour frame is at least 8 bytes.");
  }

  for (let index = 0; index < MAGIC.length; index += 1) {
    if (datagram[index] !== MAGIC[index]) {
      throw new Error("A colour frame begins with YRGB.");
    }
  }

  if (datagram[4] !== VERSION) {
    throw new Error(`Unsupported colour frame version ${datagram[4] ?? 0}.`);
  }

  const deviceIndex = datagram[5] ?? 0;
  const ledCount = (datagram[6] ?? 0) | ((datagram[7] ?? 0) << 8);

  if (datagram.length !== 8 + ledCount * 3) {
    throw new Error(
      `A colour frame declares ${ledCount} LEDs and is ${datagram.length} bytes.`,
    );
  }

  return { deviceIndex, ledCount, rgb: datagram.slice(8) };
}

/** `#rrggbb`, case-insensitive, into one RGB triple. */
export function parseHexColour(value: unknown): Uint8Array {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new BridgeRequestError("The colour must be #rrggbb.");
  }

  return Uint8Array.of(
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  );
}

function solidFrame(colour: Uint8Array, ledCount: number): Uint8Array {
  const frame = new Uint8Array(ledCount * 3);
  for (let led = 0; led < ledCount; led += 1) {
    frame.set(colour, led * 3);
  }
  return frame;
}

export interface DescriptorStats {
  readonly malformed: number;
  readonly dropped: number;
}

export interface DescriptorDevice {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly lighting?: {
    readonly ledCount: number;
    readonly udpPort: number;
    readonly channels: readonly LightingChannel[];
    readonly layout: LightingLayout;
    readonly stats: DescriptorStats;
  };
  readonly controls?: {
    readonly pump: boolean;
    readonly fans: boolean;
    readonly telemetry: boolean;
  };
  readonly display?: {
    readonly kind: "panel";
    readonly width: number;
    readonly height: number;
  };
}

export interface DevicesDescriptor {
  readonly hub: { readonly name: string; readonly vendor: string };
  readonly devices: readonly DescriptorDevice[];
  readonly stats: DescriptorStats;
}

export interface SignalRgbBridge {
  /** The port actually bound, which is the descriptor's `udpPort`. */
  readonly port: number;
  describe(): DevicesDescriptor;
  /** Writes pump/fan percentages through the device's own clamp rules. */
  controls(id: string, input: unknown): Promise<void>;
  telemetry(id: string): Promise<DeviceTelemetry>;
  lightingMode(id: string, input: unknown): Promise<void>;
  close(): Promise<void>;
}

export interface SignalRgbBridgeOptions {
  /** The configured port; `0` asks the OS for one, which tests use. */
  readonly port: number;
  /** The sinks open right now. Read per datagram, because a panel can open or
   *  close while the bridge runs. */
  readonly sinks: () => readonly DeviceSink[];
  /** A socket failure after binding, in the host's own words. */
  readonly onError?: (message: string) => void;
  /** Injectable clock, so a cache test does not wait a second. */
  readonly now?: () => number;
}

/** One device's receiver state. */
interface DeviceState {
  pending: Uint8Array | undefined;
  writing: boolean;
  mode: LightingMode;
  colour: Uint8Array | undefined;
  timer: ReturnType<typeof setInterval> | undefined;
  dropped: number;
}

function plainObject(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new BridgeRequestError("That is not a request body.");
  }
  return input as Record<string, unknown>;
}

function percentOf(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BridgeRequestError(`${field} must be a number from 0 to 100.`);
  }
  return value;
}

export async function createSignalRgbBridge(
  options: SignalRgbBridgeOptions,
): Promise<SignalRgbBridge> {
  const states = new Map<string, DeviceState>();
  const telemetry = new Map<string, { value: DeviceTelemetry; at: number }>();
  const now = options.now ?? (() => Date.now());
  /** Valid frames that were not written, including ones naming no device. */
  let dropped = 0;
  /** Datagrams the parser refused. */
  let malformed = 0;

  const stateOf = (id: string): DeviceState => {
    const existing = states.get(id);
    if (existing !== undefined) return existing;

    const state: DeviceState = {
      pending: undefined,
      writing: false,
      mode: "canvas",
      colour: undefined,
      timer: undefined,
      dropped: 0,
    };
    states.set(id, state);
    return state;
  };

  const sinks = (): readonly DeviceSink[] => orderedSinks(options.sinks());

  const sinkById = (id: string): DeviceSink | undefined =>
    sinks().find((sink) => sink.id === id);

  const requireSink = (id: string): DeviceSink => {
    const sink = sinkById(id);
    if (sink === undefined) {
      throw new DeviceNotFoundError(`No device ${id} is open.`);
    }
    return sink;
  };

  const clearTimer = (state: DeviceState): void => {
    if (state.timer === undefined) return;
    clearInterval(state.timer);
    state.timer = undefined;
  };

  /** One pending frame per device, written as soon as the device is idle. */
  const flush = (): void => {
    for (const [id, state] of states) {
      if (state.pending === undefined || state.writing) continue;

      const frame = state.pending;
      state.pending = undefined;
      const sink = sinkById(id);
      if (sink === undefined) continue;

      state.writing = true;
      void sink
        .writeColors(frame)
        .catch((error: unknown) => {
          options.onError?.(
            `A lighting frame could not be written: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        })
        .finally(() => {
          state.writing = false;
        });
    }
  };

  let port = options.port;
  const socket: Socket = createSocket("udp4");

  socket.on("message", (message: Uint8Array) => {
    let frame: ColourFrame;

    try {
      frame = parseColourFrame(message);
    } catch {
      malformed += 1;
      return;
    }

    const open = sinks();
    const sink = open[frame.deviceIndex];
    if (
      sink === undefined ||
      sink.lighting === undefined ||
      sink.lighting.ledCount !== frame.ledCount
    ) {
      dropped += 1;
      return;
    }

    const state = stateOf(sink.id);
    if (state.mode !== "canvas") {
      state.dropped += 1;
      dropped += 1;
      return;
    }

    if (state.pending !== undefined) {
      state.dropped += 1;
      dropped += 1;
    }
    state.pending = frame.rgb;
  });

  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error): void => {
      socket.close();
      reject(error);
    };

    socket.once("error", failed);
    // Loopback only: the LAN has no route to this seam.
    socket.bind({ address: "127.0.0.1", port: options.port }, () => {
      socket.off("error", failed);
      socket.on("error", (error) => options.onError?.(error.message));
      const address = socket.address();
      if (typeof address === "object" && address !== null) {
        port = address.port;
      }
      resolve();
    });
  });

  const ticker = setInterval(flush, FRAME_INTERVAL_MS);
  ticker.unref();

  return {
    port,

    describe(): DevicesDescriptor {
      const devices = sinks().map((sink): DescriptorDevice => {
        const state = stateOf(sink.id);

        return {
          id: sink.id,
          kind: sink.kind,
          name: sink.name,
          ...(sink.lighting === undefined
            ? {}
            : {
                lighting: {
                  ledCount: sink.lighting.ledCount,
                  udpPort: port,
                  channels: sink.lighting.channels,
                  layout: sink.lighting.layout,
                  stats: { dropped: state.dropped, malformed },
                },
              }),
          ...(sink.controls === undefined
            ? {}
            : {
                controls: {
                  pump: sink.controls.pump,
                  fans: sink.controls.fans,
                  telemetry: sink.controls.telemetry,
                },
              }),
          ...(sink.display === undefined
            ? {}
            : {
                display: {
                  kind: sink.display.kind,
                  width: sink.display.width,
                  height: sink.display.height,
                },
              }),
        };
      });

      return {
        hub: { name: "Yunari", vendor: "Yunari" },
        devices,
        stats: { malformed, dropped },
      };
    },

    async controls(id, input): Promise<void> {
      const sink = requireSink(id);
      if (sink.controls === undefined) {
        throw new DeviceNotFoundError(`Device ${id} accepts no controls.`);
      }

      const body = plainObject(input);
      const pumpPercent =
        body["pumpPercent"] === undefined
          ? undefined
          : percentOf(body["pumpPercent"], "pumpPercent");
      const fanPercent =
        body["fanPercent"] === undefined
          ? undefined
          : percentOf(body["fanPercent"], "fanPercent");

      if (pumpPercent === undefined && fanPercent === undefined) {
        throw new BridgeRequestError(
          "A controls request needs pumpPercent or fanPercent.",
        );
      }

      // The driver owns its clamp (the pump's 25% floor) and its write queue.
      await sink.controls.set({
        ...(pumpPercent === undefined ? {} : { pumpPercent }),
        ...(fanPercent === undefined ? {} : { fanPercent }),
      });
    },

    async telemetry(id): Promise<DeviceTelemetry> {
      const sink = requireSink(id);
      if (sink.controls === undefined) {
        throw new DeviceNotFoundError(`Device ${id} reports no telemetry.`);
      }

      const cached = telemetry.get(id);
      if (cached !== undefined && now() - cached.at < TELEMETRY_TTL_MS) {
        return cached.value;
      }

      const value = await sink.controls.read();
      telemetry.set(id, { value, at: now() });
      return value;
    },

    async lightingMode(id, input): Promise<void> {
      const sink = requireSink(id);
      if (sink.lighting === undefined) {
        throw new DeviceNotFoundError(`Device ${id} has no lighting.`);
      }

      const body = plainObject(input);
      const mode = body["mode"];
      if (mode !== "canvas" && mode !== "forced" && mode !== "off") {
        throw new BridgeRequestError(
          "The lighting mode must be canvas, forced or off.",
        );
      }

      const state = stateOf(id);
      clearTimer(state);
      state.mode = mode;
      state.pending = undefined;

      if (mode === "canvas") {
        state.colour = undefined;
        return;
      }

      if (mode === "off") {
        state.colour = undefined;
        await sink.writeColors(new Uint8Array(sink.lighting.ledCount * 3));
        return;
      }

      const colour = parseHexColour(body["color"]);
      state.colour = colour;
      await sink.writeColors(solidFrame(colour, sink.lighting.ledCount));
      state.timer = setInterval(() => {
        const current = sinkById(id);
        if (current?.lighting === undefined || state.colour === undefined) {
          return;
        }

        void current
          .writeColors(solidFrame(state.colour, current.lighting.ledCount))
          .catch((error: unknown) => {
            options.onError?.(
              `A forced colour could not be written: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          });
      }, FORCED_INTERVAL_MS);
      state.timer.unref();
    },

    async close(): Promise<void> {
      clearInterval(ticker);
      for (const state of states.values()) clearTimer(state);
      states.clear();
      telemetry.clear();

      await new Promise<void>((resolve) => socket.close(() => resolve()));
    },
  };
}
