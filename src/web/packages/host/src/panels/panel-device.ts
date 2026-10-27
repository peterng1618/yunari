/**
 * The boundary between what a panel *is* and how it is driven.
 *
 * Everything above this file — the panel manager, the record, the settings
 * surface — knows only these four members. A second panel family is a second
 * implementation plus its own model row; nothing above changes.
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
}

export interface PanelDevice {
  readonly geometry: PanelGeometry;
  /** Opens the device and claims it. Throws with the reason it could not. */
  open(): Promise<void>;
  /** Sends one encoded frame. Throws when the device refused it. */
  present(jpeg: Uint8Array): Promise<void>;
  close(): Promise<void>;
}
