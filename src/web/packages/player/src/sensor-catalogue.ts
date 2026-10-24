import {
  descriptorsFromWire,
  SEMANTIC_KEYS,
  type SemanticKeyDescriptor,
} from "@yunari/renderer-core";

/**
 * What a display converts with: the built-in vocabulary, plus whatever the host
 * reports from `/api/sensors`.
 *
 * The display is served from the host origin, so the request is same-origin and
 * carries the session's credentials. A failed or malformed answer is not
 * author-facing — the built-in table is complete on its own, and a display with
 * no host keeps it.
 */
export async function loadDisplayCatalogue(
  fetcher: typeof fetch,
): Promise<readonly SemanticKeyDescriptor[]> {
  try {
    const response = await fetcher("/api/sensors");
    if (!response.ok) return SEMANTIC_KEYS;

    const body: unknown = await response.json();
    const sensors = (body as { readonly sensors?: unknown } | null)?.sensors;
    return Array.isArray(sensors)
      ? descriptorsFromWire(sensors)
      : SEMANTIC_KEYS;
  } catch {
    return SEMANTIC_KEYS;
  }
}
