/**
 * `crypto.DigestStream` exists at runtime but the declared `Crypto` type here
 * does not expose it, so its constructor is named once rather than casting at
 * the call site.
 */
const DigestStream: new (
  algorithm: string,
) => WritableStream<ArrayBuffer | ArrayBufferView> & {
  readonly digest: Promise<ArrayBuffer>;
} = (crypto as unknown as { readonly DigestStream: never }).DigestStream;

/**
 * The stored size and lowercase SHA-256 of an object; `undefined` for a missing
 * key. The body is hashed as it streams, so a 95 MiB package is never held in
 * memory; a caller that must refuse an object by size HEADs it first rather
 * than paying for the read.
 */
export async function inspectObject(
  bucket: R2Bucket,
  key: string,
): Promise<{ bytes: number; sha256: string } | undefined> {
  const object = await bucket.get(key);
  if (object === null) return undefined;
  const digest = new DigestStream("SHA-256");
  await object.body.pipeTo(digest);
  return { bytes: object.size, sha256: hexOf(await digest.digest) };
}

function hexOf(digest: ArrayBuffer): string {
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Opens a stored object for streaming; a missing key is the caller's 404. */
export async function openObject(
  bucket: R2Bucket,
  key: string,
): Promise<R2ObjectBody | undefined> {
  return (await bucket.get(key)) ?? undefined;
}

/**
 * The answer is already 404 by the time this runs, so a failed cancel must not
 * change it — the stream may have been closed already.
 */
export async function cancelBody(object: R2ObjectBody): Promise<void> {
  try {
    await object.body.cancel();
  } catch {
    // Best effort only; nothing depends on the cancel succeeding.
  }
}
