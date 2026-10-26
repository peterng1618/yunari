import { decodeBatch, SAMPLE_EVENT } from "./protocol.js";
import type { SampleSource } from "./source.js";
import { SampleStore } from "./store.js";

/** Push transport → bounded pull `SampleSource`; downstream rendering stays transport-agnostic. */

export type LiveSourceStatus =
  | "connecting"
  | "live"
  | "reconnecting"
  | "refused";

/** Minimal injectable `EventSource` surface for the state machine. */
export interface EventSourceLike {
  addEventListener(
    type: string,
    listener: (event: { readonly data: string }) => void,
  ): void;
  close(): void;
}

export interface LiveSourceOptions {
  readonly url: string;
  readonly store?: SampleStore;
  readonly now?: () => number;
  readonly onStatus?: (status: LiveSourceStatus, detail?: string) => void;
  readonly open?: (url: string) => EventSourceLike;
}

export interface LiveSourceHandle {
  readonly source: SampleSource;
  readonly status: LiveSourceStatus;
  readonly batchCount: number;
  close(): void;
}

/**
 * Two sampling intervals, not one.
 *
 * **The edge must lag the newest sample by two host cadences.** Host gaps are
 * never shorter than the cadence (a timer never fires early), so at one interval
 * the edge reaches the newest sample exactly when the next batch is due: every
 * ordinary tick would paint a flat stretch and then step, and the line would
 * become a staircase. Two intervals keep a normal gap inside the last segment,
 * where it reads as a slope, and leave the hold-and-step for a real stall.
 *
 * **The delay is what the source offers, not what every display uses.** A chart
 * that redraws once a second has a cadence of its own and drops it
 * (`chartPlaybackDelayFor` in `scene-fabric`).
 */
export const LIVE_SOURCE_CHART_PLAYBACK_DELAY_MS = 2_000;

/** Protocol refusal closes permanently; ordinary EventSource errors keep retrying. */
export function createLiveSource(options: LiveSourceOptions): LiveSourceHandle {
  const store = options.store ?? new SampleStore();
  const now = options.now ?? (() => Date.now());
  const openStream =
    options.open ??
    ((url: string) => new EventSource(url) as unknown as EventSourceLike);

  let status: LiveSourceStatus = "connecting";
  let batchCount = 0;
  let closed = false;
  const source: SampleSource = {
    chartPlaybackDelayMs: LIVE_SOURCE_CHART_PLAYBACK_DELAY_MS,
    get revision() {
      return store.revision;
    },
    latest(semanticKey) {
      return store.latest(semanticKey);
    },
    history(semanticKey, windowSeconds) {
      return store.history(semanticKey, windowSeconds);
    },
  };

  const stream = openStream(options.url);

  const setStatus = (next: LiveSourceStatus, detail?: string): void => {
    if (status === next) {
      return;
    }

    status = next;
    if (detail === undefined) {
      options.onStatus?.(next);
    } else {
      options.onStatus?.(next, detail);
    }
  };

  const close = (): void => {
    if (closed) {
      return;
    }

    closed = true;
    stream.close();
  };

  stream.addEventListener("open", () => {
    // An open socket is not yet evidence of live samples.
    if (status === "reconnecting") {
      setStatus("connecting");
    }
  });

  stream.addEventListener("error", () => {
    if (status !== "refused") {
      setStatus("reconnecting");
    }
  });

  stream.addEventListener(SAMPLE_EVENT, (event) => {
    const result = decodeBatch(event.data);

    if (!result.ok) {
      setStatus("refused", result.reason);
      close();
      return;
    }

    const timestamp = now();
    const presentationTimestamp = new Date(timestamp).toISOString();
    store.ingest(
      result.batch.samples.map(
        (entry) =>
          [
            entry.semanticKey,
            { ...entry.sample, presentationTimestamp },
          ] as const,
      ),
      timestamp,
    );

    batchCount += 1;
    setStatus("live");
  });

  return {
    source,
    get status() {
      return status;
    },
    get batchCount() {
      return batchCount;
    },
    close,
  };
}
