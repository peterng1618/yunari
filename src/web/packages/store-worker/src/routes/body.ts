/** A JSON body any route accepts; a finalize composes a larger cap beside it. */
export const MAX_JSON_BODY = 256 * 1024;

/** The buffer starts here and doubles on demand, so a stalled request is cheap. */
const INITIAL_BODY_BYTES = 64 * 1024;

type BodyResult =
  | { readonly ok: true; readonly body: Record<string, unknown> }
  | { readonly ok: false; readonly response: Response };

/**
 * A bounded JSON read shared by every route that takes a JSON body. The bytes
 * are counted as they arrive because `content-length` is attacker-controlled
 * and `request.json()` has no bound. Exactly `maxBytes` is accepted; crossing
 * it answers 413 without parsing. A null body or a parse failure keeps the 400.
 *
 * One buffer starts at 64 KiB and doubles up to `maxBytes`, so reserving the
 * cap is not paid by a request that never sends its body; each chunk is copied
 * into it and no chunk is retained.
 */
export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<BodyResult> {
  const body = request.body;
  if (body === null) return { ok: false, response: badJson() };

  const reader = body.getReader();
  let bytes = new Uint8Array(Math.min(maxBytes, INITIAL_BODY_BYTES));
  let offset = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const needed = offset + chunk.value.byteLength;
      if (needed > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return {
          ok: false,
          response: new Response(
            `The request body exceeds ${Math.floor(maxBytes / 1024)} KiB.`,
            { status: 413 },
          ),
        };
      }
      if (needed > bytes.byteLength) {
        let capacity = bytes.byteLength * 2;
        while (capacity < needed) capacity *= 2;
        const grown = new Uint8Array(Math.min(capacity, maxBytes));
        grown.set(bytes.subarray(0, offset));
        bytes = grown;
      }
      bytes.set(chunk.value, offset);
      offset = needed;
    }
  } catch {
    return { ok: false, response: badJson() };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A stream being torn down holds no lock worth reporting.
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes.subarray(0, offset)));
  } catch {
    return { ok: false, response: badJson() };
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? { ok: true, body: parsed as Record<string, unknown> }
    : { ok: false, response: badJson() };
}

function badJson(): Response {
  return new Response("A JSON body is required.", { status: 400 });
}
