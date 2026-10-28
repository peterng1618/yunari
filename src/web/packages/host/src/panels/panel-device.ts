/**
 * The boundary between what a panel *is* and how it is driven.
 *
 * Everything above this file — the panel manager, the record, the settings
 * surface — knows only these members. A second panel family is a second
 * implementation plus its own row in `panel-families.ts`; nothing above changes.
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
}

/**
 * Where a theme's video background sits in its box, as a fraction of each axis
 * (`BackgroundMedia.offsetX/offsetY`). The device composes the frame itself, so
 * the authored pan has to travel with the bytes; without it the panel shows a
 * centred cover while the editor shows the owner's composition.
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

/**
 * A panel that decodes video itself, so a video background plays at the
 * device's own frame rate instead of the host's capture cadence.
 *
 * Absence is the capability: a panel without this is driven by `present`
 * alone. While video plays, the host sends only its UI, as a PNG with alpha
 * over the picture — the same two-layer composition L-Connect uses.
 */
export interface PanelVideo {
  /** Plays `video` (an MP4) on the panel. The adapter owns every conversion
   *  the device needs, including orientation and the authored pan. */
  start(video: Uint8Array, placement: PanelVideoPlacement): Promise<void>;
  /** Replaces the transparent UI layer drawn over the playing video. */
  presentOverlay(png: Uint8Array): Promise<void>;
  /** Ends playback. The panel keeps showing its last frame. */
  stop(): Promise<void>;
}

export interface PanelDevice {
  readonly geometry: PanelGeometry;
  /** Present only on a device that decodes video. */
  readonly video?: PanelVideo;
  /** Opens the device and claims it. Throws with the reason it could not. */
  open(): Promise<void>;
  /**
   * Puts one image on the glass.
   *
   * **A JPEG, because that is the one encoding every panel family takes.** A
   * streaming panel sends those bytes down its wire; a panel with storage
   * decodes them and writes pixels once, then shows them with no host attached.
   * The caller passes a frame and does not decide which of those happened.
   */
  present(jpeg: Uint8Array): Promise<void>;
  /**
   * The floor on how often a frame is worth sending, when the device has one.
   *
   * A panel whose `present` is a **storage write** pays a multi-hundred-transfer
   * upload for every frame, so a one-second cadence would rewrite its flash
   * every second. A streaming panel has no such floor and leaves this absent.
   */
  readonly minimumIntervalMs?: number;
  close(): Promise<void>;
}
