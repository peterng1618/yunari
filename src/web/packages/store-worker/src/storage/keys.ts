/** R2 keys are derived, never client-supplied: a key that names its own path
 *  would let an upload write over another item's package. */
export function packageKey(itemId: string, version: string): string {
  return `packages/${itemId}/${version}.zip`;
}

/** Where a proxied upload waits: finalize reads it here and re-keys it. */
export function pendingKey(uploadId: string): string {
  return `pending/${uploadId}.zip`;
}

export function thumbnailKey(itemId: string): string {
  return `thumbnails/${itemId}.png`;
}
