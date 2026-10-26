import type { Sample } from "../types.js";

/**
 * Live data as the renderer sees it: a pull interface (§93, §116).
 *
 * Pull is what keeps acquisition off the display side — a source here never
 * fetches, polls or subscribes; it answers `latest` and `history` when the
 * plan builder asks. The transport fills a {@link SampleStore}; the plan
 * builder only ever sees this.
 */
export interface SampleSource {
  /** Increments once per accepted ingest; a reader uses it to skip unchanged data. */
  readonly revision: number;
  /** Intentional chart viewport lag; retained samples remain unmodified. */
  readonly chartPlaybackDelayMs?: number;
  /** The newest sample for a semantic key, or undefined when nothing is mapped. */
  latest(semanticKey: string): Sample | undefined;
  /**
   * Samples within the trailing window, oldest first, plus the last sample
   * strictly before the window's cutoff when one is retained.
   */
  history(semanticKey: string, windowSeconds: number): readonly Sample[];
}

/** A source that maps nothing. Unmapped keys report; they never invent. */
export const emptySampleSource: SampleSource = {
  revision: 0,
  latest: () => undefined,
  history: () => [],
};
