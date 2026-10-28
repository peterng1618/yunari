/**
 * The boundary between what a panel *is* and how it is driven.
 *
 * Everything above this file — the panel manager, the record, the settings
 * surface — knows only these members. A second panel family is a second driver
 * module exporting its own rows; nothing above changes.
 */

/** A panel's own raster size, in the orientation the wire expects. */
export interface PanelGeometry {
  readonly width: number;
  readonly height: number;
}

/**
 * What identifies a physical panel, for a record and for re-finding it after a
 * reboot. A bus address moves; the serial does not.
 */
export interface PanelHint {
  readonly vendorId: number;
  readonly productId: number;
  /** Empty when the firmware reports none — the address is then all there is. */
  readonly serial: string;
  /** What the family calls this device, for a surface choosing between them.
   *  A model's name, not the record's label: the label is the owner's. */
  readonly label: string;
  /** The model string the firmware reports, when it reports one. */
  readonly model?: string;
  /** The firmware version the device answers, when it answers one. */
  readonly firmware?: string;
}

/** A command a panel's control channel accepts. */
export type PanelControlCommand =
  | { readonly kind: "brightness"; readonly level: number }
  | { readonly kind: "screen"; readonly on: boolean }
  | { readonly kind: "restart" }
  | { readonly kind: "status" }
  | { readonly kind: "hello" };

/**
 * What a panel beyond its picture can do, when it can do more.
 *
 * `commands` is the declared set the control surface renders; `run` is the one
 * entry point, so a surface does not learn a protocol to dim a screen.
 */
export interface PanelControls {
  readonly commands: readonly PanelControlCommand["kind"][];
  run(command: PanelControlCommand): Promise<string>;
}

/**
 * Where a theme's video background sits in its box, as a fraction of each axis.
 * The device composes the frame itself, so the authored pan travels with the
 * bytes; without it the panel shows a centred cover.
 */
export interface PanelVideoPlacement {
  readonly offsetX: number;
  readonly offsetY: number;
}

/** A video background and the placement it was authored with. */
export interface PanelVideoSource {
  readonly bytes: Uint8Array;
  readonly placement: PanelVideoPlacement;
}

/** The video half of a panel that takes frames rather than stills. */
export interface PanelVideo {
  /** Plays `video` (an MP4). The adapter owns every conversion the device
   *  needs, including the authored pan. */
  start(video: Uint8Array, placement: PanelVideoPlacement): Promise<void>;
  presentOverlay(png: Uint8Array): Promise<void>;
  stop(): Promise<void>;
}

export interface PanelDevice {
  readonly geometry: PanelGeometry;
  /** Opens the device and claims it. Throws with the reason it could not. */
  open(): Promise<void>;
  /**
   * Puts one image on the glass.
   *
   * **A JPEG by default, because that is the one encoding every panel family
   * takes.** A device that decodes the still itself states `stillFormat` and
   * receives that encoding instead. A streaming panel sends those bytes down its
   * wire; a panel with storage decodes them and writes pixels once, then shows
   * them with no host attached. The caller passes a frame and does not decide
   * which of those happened.
   */
  present(still: Uint8Array): Promise<void>;
  /**
   * The still encoding this device consumes, when it is not a JPEG.
   *
   * The device states it, the way it states `minimumIntervalMs`, because the
   * encoding is what its own decoder takes: a panel that decodes the still to
   * raw pixels pays JPEG artifacts for nothing.
   */
  readonly stillFormat?: "jpeg" | "png";
  /**
   * The floor on how often a frame is worth sending, when the device has one.
   *
   * A panel whose `present` is a **storage write** pays a multi-hundred-transfer
   * upload for every frame, so a one-second cadence would rewrite its flash
   * every second. A streaming panel has no such floor and leaves this absent.
   */
  readonly minimumIntervalMs?: number;
  /** Present when the device accepts commands beyond the picture. */
  readonly controls?: PanelControls;
  /** Present when the device takes video as well as stills. */
  readonly video?: PanelVideo;
  close(): Promise<void>;
}

/** What a family states about its hardware and the firmware it supports. */
export interface PanelSupport {
  readonly maker: string;
  readonly hardwareRevision: string;
  readonly supportedFirmware: readonly string[];
  /** ISO date, `YYYY-MM-DD`: the last day the driver met this hardware. */
  readonly updatedAt: string;
}

/**
 * One row of the panel registry: what a family is and how to reach it.
 *
 * A row is a lookup and a constructor, not a class hierarchy — the families
 * share no packet, so the only thing they share is what `PanelDevice` says.
 */
export interface PanelFamily {
  /** The model id a display record carries, e.g. `lianli-9-2`. */
  readonly id: string;
  readonly label: string;
  readonly vendorId: number;
  readonly productId: number;
  /** True when `present` writes to the device rather than streaming a frame. */
  readonly stores: boolean;
  readonly support: PanelSupport;
  readonly commands: readonly PanelControlCommand["kind"][];
  /** Panels of this family attached right now, as record hints. */
  readonly attached: () => Promise<readonly PanelHint[]>;
  readonly open: () => Promise<PanelDevice>;
}
