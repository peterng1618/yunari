/** Persisted marker for an image whose visible pixels came from a crop.
 *
 *  A crop is stored as Fabric's `clipPath`, which hides the rest of a source
 *  image without removing it. Publishing or exporting must ship only the
 *  pixels the author can see, so the session has to know which images were
 *  cropped by the author and which merely use a layout clip (a cover fit). This
 *  marker is that distinction. It is authored state, so it persists with the
 *  object; it is cleared when the pixels are baked into a new asset.
 */
export const YUNARI_CROP_PROPERTY = "yunariCrop";

type CropObject = {
  get(name: string): unknown;
  set(name: string, value: unknown): unknown;
};

export function setObjectCropped(object: CropObject, cropped: boolean): void {
  object.set(YUNARI_CROP_PROPERTY, cropped);
}

export function objectIsCropped(object: Pick<CropObject, "get">): boolean {
  return object.get(YUNARI_CROP_PROPERTY) === true;
}
