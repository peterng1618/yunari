import {
  describeSemanticKey,
  type Sample,
  type SampleEntry,
} from "@yunari/renderer-core";
import type {
  HelperExitKind,
  HelperHandle,
  KillTree,
  SpawnProcess,
} from "../helpers/supervisor.js";
import { startJsonLineHelper } from "../helpers/supervisor.js";
import type {
  ProviderHealth,
  SampleContext,
  SensorDescriptor,
  SensorProvider,
} from "../provider.js";
import { descriptorFieldsOf, redactForBrowser } from "../provider.js";
import type { ArtworkCache } from "./artwork.js";
import {
  type ArtworkBytes,
  type ArtworkMiss,
  parseSmtcAudio,
  parseSmtcLine,
  type SmtcAudio,
  type SmtcSession,
  smtcArtworkLine,
  smtcArtworkMissLine,
  smtcScript,
  smtcSessionIsCurrent,
} from "./smtc-helper.js";

/**
 * Now Playing and the system output level, acquired by one PowerShell helper
 * and cached for the host's sample cycle.
 *
 * `sample()` is a cache read: it records demand, starts or restarts the helper
 * when the demand shape changed, and answers from the last line. The helper is
 * what owns the one-second cadence; this provider owns its lifetime and
 * the artwork cache.
 */

const MEDIA_PROVIDER_ID = "media";

export const MEDIA_KEYS = [
  "media.title",
  "media.artist",
  "media.album",
  "media.artwork",
  "media.state",
  "media.position",
  "media.duration",
  "media.app",
] as const;

export const AUDIO_KEYS = ["audio.volume", "audio.muted"] as const;

/** Media first, then the independent audio readings. */
export const MEDIA_PROVIDER_KEYS = [...MEDIA_KEYS, ...AUDIO_KEYS] as const;

export const MEDIA_DESCRIPTORS: readonly SensorDescriptor[] =
  MEDIA_PROVIDER_KEYS.map((key) => {
    const declared = describeSemanticKey(key);

    if (declared === undefined) {
      throw new Error(`${key} is not in the semantic key vocabulary`);
    }

    return {
      sensorId: `${MEDIA_PROVIDER_ID}:${key}`,
      semanticKey: key,
      label: declared.label,
      ...descriptorFieldsOf(declared),
      tier: declared.expectedTier,
    };
  });

const UNIT_BY_KEY: ReadonlyMap<string, string | undefined> = new Map(
  MEDIA_DESCRIPTORS.map((descriptor) => [
    descriptor.semanticKey,
    descriptor.unit,
  ]),
);

export const NO_SESSION_MESSAGE = "No media session is playing.";
const NO_AUDIO_ENDPOINT_MESSAGE = "This PC reports no output volume.";
const WAITING_MESSAGE = "Waiting for the media helper.";
export const WAITING_ARTWORK_MESSAGE = "Waiting for this track's artwork.";
export const ARTWORK_TOO_LARGE_MESSAGE =
  "This track's artwork is too large for the media helper to read.";
export const ARTWORK_UNREADABLE_MESSAGE =
  "This track's artwork could not be read from the media session.";
const MEDIA_READ_FAILURE = "The media session could not be read.";

/** No display asked for a media or audio key for this long, so the helper
 *  stops; the next sample starts it again (the §120 grace period). */
const DEFAULT_GRACE_MS = 30_000;
/** A failed helper is not retried before this, so a broken one cannot spin. */
const DEFAULT_RETRY_MS = 60_000;
/** A session line not refreshed for three polls is gone; `none` normally says
 *  so outright, this covers an error poll that hides the list. */
const SESSION_TTL_MS = 3_000;
/** How often the grace period and artwork demand are re-checked. */
const TICK_MS = 1_000;
/** One line a second is the contract; a minute without one is a wedged helper
 *  (a track's artwork read can hold the loop for a few seconds). */
const LIVENESS_TIMEOUT_MS = 60_000;
/** Held artwork URLs. The disk cache keeps 64 files; this only remembers the
 *  handful of tracks a display can switch between without a new emission. */
const ARTWORK_TRACKS_CAP = 32;
/** Track identities already re-requested after a selection found no held art,
 *  so a track with no thumbnail cannot restart the helper every poll. */
const ARTWORK_REQUESTS_CAP = 32;
/** Track identities the helper proved the picture cannot be read for. */
const ARTWORK_MISS_CAP = 32;

function trackKeyOf(session: SmtcSession): string {
  return [session.sessionId, session.title, session.artist, session.album].join(
    "\u0000",
  );
}

/** One typed field from a helper line, without trusting the rest of it. */
function kindOf(line: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return undefined;
    }
    const kind = (parsed as Record<string, unknown>)["kind"];
    return typeof kind === "string" ? kind : undefined;
  } catch {
    return undefined;
  }
}

interface LiveSession {
  readonly session: SmtcSession;
  readonly seenAtMs: number;
}

interface HelperState {
  handle?: HelperHandle;
  readonly artwork: boolean;
  /** False once this spawn has reported its end, which may happen before
   *  `startJsonLineHelper` returns. */
  alive: boolean;
}

export interface MediaProviderOptions {
  readonly cache: ArtworkCache;
  readonly now?: () => number;
  readonly graceMs?: number;
  readonly retryMs?: number;
  readonly spawnProcess?: SpawnProcess;
  readonly killTree?: KillTree;
  readonly pathExists?: (file: string) => boolean;
}

export class MediaProvider implements SensorProvider {
  readonly id = MEDIA_PROVIDER_ID;
  readonly label = "Media";

  readonly #cache: ArtworkCache;
  readonly #now: () => number;
  readonly #graceMs: number;
  readonly #retryMs: number;
  readonly #spawnProcess: SpawnProcess | undefined;
  readonly #killTree: KillTree | undefined;
  readonly #pathExists: ((file: string) => boolean) | undefined;

  #helper: HelperState | undefined;
  #tick: ReturnType<typeof setTimeout> | undefined;
  #lastDemandMs = Number.NEGATIVE_INFINITY;
  #lastArtworkDemandMs = Number.NEGATIVE_INFINITY;
  /** When a failed helper may be started again. */
  #retryAtMs = 0;

  readonly #sessions = new Map<string, LiveSession>();
  /** The session id the system calls current, from the latest poll. */
  #currentId: string | undefined;
  #audio: SmtcAudio | undefined;
  /** Redacted; may reach a browser through `health()` and a sample message. */
  #failure: string | undefined;

  #trackKey: string | undefined;
  #artworkUrl: string | undefined;
  /** Artwork already emitted, keyed by session and track identity, so a
   *  selection change resolves to a picture read while another track played. */
  readonly #artworkByTrack = new Map<string, string>();
  /** Track identities whose missing art has already cost one helper restart. */
  readonly #artRequested = new Set<string>();
  /** Track identities the helper answered with a definitive artwork miss. */
  readonly #artworkMissByTrack = new Map<string, ArtworkMiss["reason"]>();
  /** The last artwork write, so a sample that follows a line sees its URL. */
  #artworkWrite: Promise<void> = Promise.resolve();

  constructor(options: MediaProviderOptions) {
    this.#cache = options.cache;
    this.#now = options.now ?? (() => Date.now());
    this.#graceMs = Math.max(1, options.graceMs ?? DEFAULT_GRACE_MS);
    this.#retryMs = Math.max(0, options.retryMs ?? DEFAULT_RETRY_MS);
    this.#spawnProcess = options.spawnProcess;
    this.#killTree = options.killTree;
    this.#pathExists = options.pathExists;
  }

  async describe(): Promise<readonly SensorDescriptor[]> {
    return MEDIA_DESCRIPTORS;
  }

  async sample(
    semanticKeys: readonly string[],
    nowMs: number,
    _context: SampleContext = {},
  ): Promise<readonly SampleEntry[]> {
    const wanted = MEDIA_PROVIDER_KEYS.filter((key) =>
      semanticKeys.includes(key),
    );

    if (wanted.length === 0) {
      return [];
    }

    const now = this.#now();
    this.#lastDemandMs = now;

    if (semanticKeys.includes("media.artwork")) {
      this.#lastArtworkDemandMs = now;
    }

    // A line may have arrived in this turn; let its write land first, so a
    // track whose artwork was just read is not mistaken for a miss and the
    // helper is not restarted needlessly.
    await this.#artworkWrite;

    this.#reconcile(now);

    return wanted.map((semanticKey) => ({
      semanticKey,
      sample: this.#sampleOf(semanticKey, nowMs),
    }));
  }

  health(): ProviderHealth {
    return this.#failure === undefined
      ? { available: true }
      : { available: false, message: this.#failure };
  }

  /**
   * Ends the helper and its grace timer for host shutdown, so no
   * `powershell.exe` is left polling. A later `sample()` starts it again: stop
   * is a teardown, not a permanent disable.
   */
  stop(): void {
    this.#stop();
    this.#retryAtMs = 0;
    this.#lastDemandMs = Number.NEGATIVE_INFINITY;
    this.#lastArtworkDemandMs = Number.NEGATIVE_INFINITY;
  }

  #artworkWanted(now: number): boolean {
    return now - this.#lastArtworkDemandMs <= this.#graceMs;
  }

  /**
   * Starts, restarts or stops the helper so its script matches what is being
   * demanded. The script is fixed at spawn, which is why a change in artwork
   * demand is a restart rather than a message.
   */
  #reconcile(now: number): void {
    if (now - this.#lastDemandMs > this.#graceMs) {
      this.#stop();
      return;
    }

    if (this.#helper === undefined) {
      this.#start(now);
      return;
    }

    if (this.#helper.artwork !== this.#artworkWanted(now)) {
      // A new artwork mode may read tracks the previous one never asked for.
      this.#artRequested.clear();
      this.#restart(now);
      return;
    }

    this.#requestMissingArtwork(now);
  }

  /**
   * A newly selected track with no held picture costs one helper restart,
   * which clears the script's per-track dedupe and re-reads every session's
   * thumbnail. The identity is remembered so a track that genuinely has no
   * artwork cannot restart the helper on every poll.
   */
  #requestMissingArtwork(now: number): void {
    if (this.#helper?.artwork !== true) return;

    const key = this.#trackKey;

    if (key === undefined || this.#artworkUrl !== undefined) return;
    // The helper has already proved this track's picture cannot be read; a
    // restart would only pay to reach the same negative.
    if (this.#artworkMissByTrack.has(key)) return;
    if (this.#artRequested.has(key)) return;

    this.#artRequested.add(key);

    if (this.#artRequested.size > ARTWORK_REQUESTS_CAP) {
      const oldest = this.#artRequested.values().next().value;
      if (oldest !== undefined) this.#artRequested.delete(oldest);
    }

    this.#restart(now);
  }

  /** Stores a URL by track identity, keeping the newest handful. */
  #rememberArtwork(key: string, url: string): void {
    this.#artworkByTrack.delete(key);
    this.#artworkByTrack.set(key, url);

    if (this.#artworkByTrack.size > ARTWORK_TRACKS_CAP) {
      const oldest = this.#artworkByTrack.keys().next().value;
      if (oldest !== undefined) this.#artworkByTrack.delete(oldest);
    }
  }

  /** Records a definitive miss by track identity, keeping the newest handful. */
  #rememberArtworkMiss(key: string, reason: ArtworkMiss["reason"]): void {
    this.#artworkMissByTrack.delete(key);
    this.#artworkMissByTrack.set(key, reason);

    if (this.#artworkMissByTrack.size > ARTWORK_MISS_CAP) {
      const oldest = this.#artworkMissByTrack.keys().next().value;
      if (oldest !== undefined) this.#artworkMissByTrack.delete(oldest);
    }
  }

  #start(now: number): void {
    if (this.#helper !== undefined || now < this.#retryAtMs) return;

    const artwork = this.#artworkWanted(now);
    const state: HelperState = { artwork, alive: true };

    const handle = startJsonLineHelper({
      id: "media",
      script: smtcScript(artwork ? { artwork: true } : {}),
      timeoutMs: LIVENESS_TIMEOUT_MS,
      ...(this.#spawnProcess === undefined
        ? {}
        : { spawnProcess: this.#spawnProcess }),
      ...(this.#killTree === undefined ? {} : { killTree: this.#killTree }),
      ...(this.#pathExists === undefined
        ? {}
        : { pathExists: this.#pathExists }),
      onLine: (line) => this.#ingest(line),
      onExit: (reason, kind) => this.#ended(state, reason, kind),
    });

    (state as { handle?: HelperHandle }).handle = handle;

    // A missing PowerShell or a synchronous exit reports before the call
    // returns, so this assignment cannot be taken as proof of life.
    if (!state.alive) return;

    this.#helper = state;
    this.#scheduleTick();
  }

  #restart(now: number): void {
    const current = this.#helper;
    if (current === undefined) {
      this.#start(now);
      return;
    }

    current.alive = false;
    this.#helper = undefined;
    current.handle?.stop();
    this.#start(now);
  }

  #stop(): void {
    if (this.#tick !== undefined) {
      clearTimeout(this.#tick);
      this.#tick = undefined;
    }

    const current = this.#helper;
    this.#helper = undefined;

    if (current !== undefined) {
      current.alive = false;
      current.handle?.stop();
    }

    this.#clearReadings();
    this.#failure = undefined;
  }

  #ended(state: HelperState, reason: string, kind: HelperExitKind): void {
    state.alive = false;

    if (this.#helper === state) {
      this.#helper = undefined;
    }

    // A deliberate stop belongs to `#stop` or `#restart`; it is not a failure
    // and owns none of the backoff.
    if (kind === "stopped") return;

    this.#failure = redactForBrowser(reason);
    this.#retryAtMs = this.#now() + this.#retryMs;
    this.#clearReadings();
  }

  #clearReadings(): void {
    this.#sessions.clear();
    this.#currentId = undefined;
    this.#audio = undefined;
    this.#trackKey = undefined;
    this.#artworkUrl = undefined;
    this.#artworkByTrack.clear();
    this.#artworkMissByTrack.clear();
    this.#artRequested.clear();
  }

  #scheduleTick(): void {
    if (this.#tick !== undefined || this.#helper === undefined) return;

    this.#tick = setTimeout(() => {
      this.#tick = undefined;
      this.#reconcile(this.#now());

      if (this.#helper !== undefined) this.#scheduleTick();
    }, TICK_MS);
    (this.#tick as { unref?: () => void }).unref?.();
  }

  #ingest(line: string): void {
    const now = this.#now();

    switch (kindOf(line)) {
      case "audio": {
        const audio = parseSmtcAudio(line);
        if (audio !== undefined) this.#audio = audio;
        return;
      }
      case "none":
        this.#sessions.clear();
        this.#failure = undefined;
        this.#selected(now);
        return;
      case "error":
        this.#failure = MEDIA_READ_FAILURE;
        return;
      case "artwork": {
        const artwork = smtcArtworkLine(line);
        if (artwork !== undefined) this.#ingestArtwork(artwork);
        return;
      }
      case "artwork-miss": {
        const miss = smtcArtworkMissLine(line);
        if (miss !== undefined) this.#ingestArtworkMiss(miss);
        return;
      }
      case "session": {
        const session = parseSmtcLine(line);

        if (session === undefined) return;

        this.#sessions.set(session.sessionId, { session, seenAtMs: now });

        if (smtcSessionIsCurrent(line)) {
          this.#currentId = session.sessionId;
        }

        this.#failure = undefined;
        this.#selected(now);
        return;
      }
      default:
        return;
    }
  }

  #ingestArtwork(artwork: ArtworkBytes): void {
    // Artwork is held for the session that emitted it, not only for the one
    // selected now: another track's picture must already be known when a
    // selection change makes it current.
    const session = this.#sessions.get(artwork.sessionId)?.session;

    if (session === undefined) return;

    const key = trackKeyOf(session);

    this.#artworkWrite = this.#artworkWrite
      .then(async () => {
        const url = await this.#cache.put(artwork.bytes, artwork.ext);

        this.#rememberArtwork(key, url);
        // A picture arrived for a track the helper had called unreadable.
        this.#artworkMissByTrack.delete(key);

        // A track that changed while the write was in flight must not get the
        // previous picture under its new title.
        if (this.#trackKey === key) {
          this.#artworkUrl = url;
        }
      })
      .catch(() => undefined);
  }

  /**
   * A definitive miss belongs to the track the session is playing, which the
   * session line that preceded it supplies. It is held for that track even
   * when another one is selected, like the artwork itself.
   */
  #ingestArtworkMiss(miss: ArtworkMiss): void {
    const session = this.#sessions.get(miss.sessionId)?.session;

    if (session === undefined) return;

    this.#rememberArtworkMiss(trackKeyOf(session), miss.reason);
  }

  /**
   * The session every media key answers from: the most recently seen playing
   * one, else the most recently seen current one, else nothing. A session id
   * includes its track, so a track change leaves the old id unreferenced until
   * the TTL drops it; preferring the newest sighting keeps that stale entry
   * from being selected. A session line not refreshed for `SESSION_TTL_MS` is
   * dropped, so a helper that stops reporting does not leave a frozen position
   * claimed as a reading.
   */
  #selected(now: number): SmtcSession | undefined {
    for (const [id, live] of this.#sessions) {
      if (now - live.seenAtMs > SESSION_TTL_MS) this.#sessions.delete(id);
    }

    let playing: LiveSession | undefined;
    let current: LiveSession | undefined;

    for (const live of this.#sessions.values()) {
      const { session } = live;
      if (
        session.state === "playing" &&
        (playing === undefined || live.seenAtMs >= playing.seenAtMs)
      ) {
        playing = live;
      }
      if (
        session.sessionId === this.#currentId &&
        (current === undefined || live.seenAtMs >= current.seenAtMs)
      ) {
        current = live;
      }
    }

    const selected = (playing ?? current)?.session;
    const key = selected === undefined ? undefined : trackKeyOf(selected);

    if (key !== this.#trackKey) {
      this.#trackKey = key;
      // A picture already emitted for this exact track is reused; only a track
      // nothing was ever read for is a miss.
      this.#artworkUrl =
        key === undefined ? undefined : this.#artworkByTrack.get(key);
    }

    return selected;
  }

  #sampleOf(semanticKey: string, nowMs: number): Sample {
    const sensorId = `${MEDIA_PROVIDER_ID}:${semanticKey}`;
    const timestamp = new Date(nowMs).toISOString();
    const unit = UNIT_BY_KEY.get(semanticKey);

    if (semanticKey === "audio.volume" || semanticKey === "audio.muted") {
      const audio = this.#audio;

      if (audio === undefined) {
        return {
          sensorId,
          timestamp,
          status: "missing",
          message: WAITING_MESSAGE,
        };
      }

      const { volume, muted } = audio;

      if (volume === undefined || muted === undefined) {
        return {
          sensorId,
          timestamp,
          status: "unavailable",
          message: NO_AUDIO_ENDPOINT_MESSAGE,
        };
      }

      return semanticKey === "audio.volume"
        ? {
            sensorId,
            timestamp,
            status: "ok",
            value: volume,
            ...(unit === undefined ? {} : { unit }),
          }
        : { sensorId, timestamp, status: "ok", booleanValue: muted };
    }

    const session = this.#selected(this.#now());

    if (session === undefined) {
      return {
        sensorId,
        timestamp,
        status: this.#failure === undefined ? "unavailable" : "error",
        message: this.#failure ?? NO_SESSION_MESSAGE,
      };
    }

    const text = (textValue: string): Sample => ({
      sensorId,
      timestamp,
      status: "ok",
      textValue,
    });

    switch (semanticKey) {
      case "media.title":
        return text(session.title);
      case "media.artist":
        return text(session.artist);
      case "media.album":
        return text(session.album);
      case "media.state":
        return text(session.state);
      case "media.app":
        return text(session.app);
      case "media.position":
        return {
          sensorId,
          timestamp,
          status: "ok",
          value: session.positionS,
          ...(unit === undefined ? {} : { unit }),
        };
      case "media.duration":
        return {
          sensorId,
          timestamp,
          status: "ok",
          value: session.durationS,
          ...(unit === undefined ? {} : { unit }),
        };
      case "media.artwork": {
        if (this.#artworkUrl !== undefined) return text(this.#artworkUrl);

        // A definitive miss is this track's answer, not a wait: the helper
        // will not read it again.
        const miss =
          this.#trackKey === undefined
            ? undefined
            : this.#artworkMissByTrack.get(this.#trackKey);

        if (miss === undefined) {
          return {
            sensorId,
            timestamp,
            status: "missing",
            message: WAITING_ARTWORK_MESSAGE,
          };
        }

        return {
          sensorId,
          timestamp,
          status: "unavailable",
          message:
            miss === "over"
              ? ARTWORK_TOO_LARGE_MESSAGE
              : ARTWORK_UNREADABLE_MESSAGE,
        };
      }
      default:
        return {
          sensorId,
          timestamp,
          status: "missing",
          message: "This host does not read that media key.",
        };
    }
  }
}
