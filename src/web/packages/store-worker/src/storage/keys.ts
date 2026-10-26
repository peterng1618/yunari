/** Where a proxied upload waits: finalize reads it here and records the key. */
export function pendingKey(uploadId: string): string {
  return `pending/${uploadId}.zip`;
}

export function thumbnailKey(itemId: string): string {
  return `thumbnails/${itemId}.png`;
}
