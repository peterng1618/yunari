import type { DeviceLighting } from "./device-sink.js";
import type {
  PanelControlCommand,
  PanelGeometry,
  PanelOpenOptions,
  PanelVideoPlacement,
} from "./panel-device.js";

/**
 * What one panel's worker thread and the host say to each other.
 *
 * **The device handle never crosses.** The worker opens the device, keeps the
 * handle and every protocol detail on its own thread, and the host asks for
 * frames, pictures, lighting and commands by name. The transport is
 * `postMessage`, so the bytes are copies: a frame is compared and kept on the
 * host, and detaching it to save the copy would break the runner's own dedupe.
 *
 * The shapes here are the members of `PanelDevice`, `Rasterizer` and
 * `DeviceSink` that a caller can reach — nothing is invented for the wire.
 */

/** A sink's fixed half. Its writers are requests, so they stay on the thread. */
export interface WorkerSinkDescriptor {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly lighting?: DeviceLighting;
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

/** Everything about an opened device that is plain data. */
export interface WorkerOpened {
  readonly geometry: PanelGeometry;
  readonly stillFormat?: "jpeg" | "png";
  readonly frameIntervalMs?: number;
  readonly hasVideo: boolean;
  readonly commands: readonly PanelControlCommand["kind"][];
  readonly sink?: WorkerSinkDescriptor;
}

/** The set controls answer: the driver's own limits stay in the driver. */
export interface WorkerControlInput {
  readonly pumpPercent?: number | undefined;
  readonly fanPercent?: number | undefined;
}

export type WorkerAsk =
  | {
      readonly kind: "open";
      readonly vendorId: number;
      readonly productId: number;
      readonly open?: PanelOpenOptions;
    }
  | {
      /** Points the device's own rasteriser at a page the host opened. */
      readonly kind: "attach";
      readonly pageUrl: string;
      readonly url: string;
    }
  | {
      readonly kind: "present";
      readonly still: Uint8Array;
    }
  | {
      readonly kind: "video-start";
      readonly bytes: Uint8Array;
      readonly placement: PanelVideoPlacement;
      readonly rotation?: number;
    }
  | {
      readonly kind: "video-overlay";
      readonly png: Uint8Array;
    }
  | { readonly kind: "video-stop" }
  | { readonly kind: "command"; readonly command: PanelControlCommand }
  | { readonly kind: "colors"; readonly rgb: Uint8Array }
  | { readonly kind: "set-controls"; readonly input: WorkerControlInput }
  | { readonly kind: "read-controls" }
  | { readonly kind: "capture"; readonly overlay: boolean }
  | { readonly kind: "close-raster" }
  | { readonly kind: "close" };

/** One request with its place in order, so a reply can be matched to it. */
export type WorkerRequest = WorkerAsk & { readonly id: number };

export interface WorkerReply {
  readonly id: number;
  readonly ok: boolean;
  /** The answer: a `WorkerOpened`, a `Uint8Array`, a boolean, a string. */
  readonly value?: unknown;
  readonly message?: string;
}
