/** A JSON body any route accepts; a finalize composes a larger cap beside it. */
export const MAX_JSON_BODY = 256 * 1024;

export type BodyResult =
  | { readonly ok: true; readonly body: Record<string, unknown> }
  | { readonly ok: false; readonly response: Response };

/**
 * A bounded JSON read shared by every route that takes a JSON body. The bytes
 * are counted as they arrive because `content-length` is attacker-controlled
 * and `request.json()` has no bound. Exactly `maxBytes` is accepted; crossing
 * it answers 413 without parsing. A null body or a parse failure keeps the 400.
 *
 * One buffer of `maxBytes` is allocated up front and each chunk is copied into
 * it, so a body delivered in tiny chunks costs one copy per byte and no
 * per-chunk allocation of its own.
 */
export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<BodyResult> {
  const body = request.body;
  if (body === null) return { ok: false, response: badJson() };

  const reader = body.getReader();
  const bytes = new Uint8Array(maxBytes);
  let offset = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (offset + chunk.value.byteLength > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return {
          ok: false,
          response: new Response(
            `The request body exceeds ${Math.floor(maxBytes / 1024)} KiB.`,
            { status: 413 },
          ),
        };
      }
      bytes.set(chunk.value, offset);
      offset += chunk.value.byteLength;
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
