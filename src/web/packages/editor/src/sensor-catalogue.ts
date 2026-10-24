import {
  descriptorsFromWire,
  SEMANTIC_KEYS,
  type SemanticKeyDescriptor,
} from "@yunari/renderer-core";

/**
 * The editor's readings: the built-in vocabulary, plus whatever the host
 * reports from `/api/sensors`.
 *
 * The editor is served from the host origin, so the request is same-origin. A
 * disconnected editor or a failed request is not an author-facing error: the
 * built-in table is a complete list of the keys the vocabulary names, and it
 * stays in place until a successful answer replaces it.
 */

export interface SensorCatalogue {
  descriptors(): readonly SemanticKeyDescriptor[];
  refresh(): Promise<void>;
}

export function createSensorCatalogue(
  fetcher: typeof fetch = fetch,
): SensorCatalogue {
  let descriptors: readonly SemanticKeyDescriptor[] = SEMANTIC_KEYS;

  return {
    descriptors: () => descriptors,
    async refresh(): Promise<void> {
      try {
        const response = await fetcher("/api/sensors");
        if (!response.ok) return;

        const body: unknown = await response.json();
        const sensors = (body as { readonly sensors?: unknown } | null)
          ?.sensors;
        if (!Array.isArray(sensors)) return;

        descriptors = descriptorsFromWire(sensors);
      } catch {
        // A disconnected editor keeps the table it had.
      }
    },
  };
}
