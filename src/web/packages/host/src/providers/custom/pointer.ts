/**
 * RFC 6901 JSON Pointer, limited to what a reading needs: resolve a pointer
 * against a parsed document, and report a miss rather than throw. A field's
 * pointer comes from `sources.json`; an unusable one costs a sample, not the
 * fetch that produced the document.
 */

/** A `~` that is not the start of `~0` or `~1`. */
const INVALID_ESCAPE = /~(?![01])/;
/** An array index: `0`, or a decimal without a leading zero. `-` is not one. */
const INDEX = /^(?:0|[1-9]\d*)$/;

export function resolvePointer(
  body: unknown,
  pointer: string,
): { found: boolean; value?: unknown } {
  if (pointer === "") return { found: true, value: body };
  if (!pointer.startsWith("/")) return { found: false };

  let current: unknown = body;

  for (const raw of pointer.slice(1).split("/")) {
    if (INVALID_ESCAPE.test(raw)) return { found: false };

    // `~1` first, then `~0`: `~01` is `~0` followed by a literal `1`.
    const token = raw.replace(/~1/g, "/").replace(/~0/g, "~");

    if (Array.isArray(current)) {
      if (!INDEX.test(token)) return { found: false };
      const index = Number(token);
      if (index >= current.length) return { found: false };
      current = current[index];
      continue;
    }

    if (typeof current !== "object" || current === null) {
      return { found: false };
    }
    // Own properties only: a pointer names data, never the prototype chain.
    if (!Object.hasOwn(current, token)) return { found: false };
    current = (current as Record<string, unknown>)[token];
  }

  return { found: true, value: current };
}
