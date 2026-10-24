import path from "node:path";
import {
  describeSemanticKey,
  type Sample,
  type SampleEntry,
} from "@yunari/renderer-core";
import {
  FOREGROUND_SCRIPT,
  type ForegroundReading,
  parseForegroundLine,
} from "../helpers/foreground.js";
import type {
  HelperExitKind,
  KillTree,
  SpawnProcess,
} from "../helpers/supervisor.js";
import { startJsonLineHelper } from "../helpers/supervisor.js";
import type {
  ProviderHealth,
  SensorDescriptor,
  SensorProvider,
} from "../provider.js";
import { descriptorFieldsOf, redactForBrowser } from "../provider.js";
import {
  matchProcess,
  readSteamApps,
  resolveSteamRoot,
  type SteamApp,
} from "./steam-library.js";

/**
 * The game the user is playing, with Steam's local library for its name.
 *
 * One PowerShell helper reports the foreground process once a second while a
 * display binds `game.*`; the Steam library is read once per demand window.
 * A matched app gives the name; a foreground process outside every Steam
 * install still reports its executable and `running: true` with no name
 * (decision 0108). Artwork arrives in task 6.4, so the key is declared but
 * carries no value yet.
 */

const GAME_PROVIDER_ID = "game";

export const GAME_KEYS = [
  "game.name",
  "game.artwork",
  "game.running",
  "game.app",
] as const;

export const GAME_DESCRIPTORS: readonly SensorDescriptor[] = GAME_KEYS.map(
  (key) => {
    const declared = describeSemanticKey(key);

    if (declared === undefined) {
      throw new Error(`${key} is not in the semantic key vocabulary`);
    }

    return {
      sensorId: `${GAME_PROVIDER_ID}:${key}`,
      semanticKey: key,
      label: declared.label,
      ...descriptorFieldsOf(declared),
      tier: declared.expectedTier,
    };
  },
);

export const WAITING_GAME_MESSAGE = "Waiting for the game helper.";
export const NO_GAME_MESSAGE = "No game process is running.";
export const NO_STEAM_MATCH_MESSAGE =
  "The foreground process is not a Steam game.";
export const NO_ARTWORK_MESSAGE = "Game artwork is not available yet.";
const NO_PROCESS_NAME_MESSAGE = "The foreground process could not be named.";

/** No display asked for a game key for this long, so the helper stops. */
const DEFAULT_GRACE_MS = 30_000;
/** A helper that failed is not retried before this, so it cannot spin. */
const DEFAULT_RETRY_MS = 60_000;
/** How often the grace period is re-checked while the helper runs. */
const TICK_MS = 1_000;
/** A helper silent for this long is wedged; its readings are dropped. */
const LIVENESS_TIMEOUT_MS = 60_000;

export interface GameProviderOptions {
  readonly now?: () => number;
  readonly graceMs?: number;
  readonly retryMs?: number;
  readonly spawnProcess?: SpawnProcess;
  readonly killTree?: KillTree;
  readonly pathExists?: (file: string) => boolean;
  /** Steam's install root; absent is no Steam apps, not a failure. */
  readonly steamRoot?: () => Promise<string | undefined>;
  readonly loadSteamApps?: (root: string) => Promise<readonly SteamApp[]>;
}

interface RunningHelper {
  alive: boolean;
  stop: () => void;
}

export class GameProvider implements SensorProvider {
  readonly id = GAME_PROVIDER_ID;
  readonly label = "Game";

  readonly #now: () => number;
  readonly #graceMs: number;
  readonly #retryMs: number;
  readonly #spawnProcess: SpawnProcess | undefined;
  readonly #killTree: KillTree | undefined;
  readonly #pathExists: ((file: string) => boolean) | undefined;
  readonly #steamRoot: () => Promise<string | undefined>;
  readonly #loadSteamApps: (root: string) => Promise<readonly SteamApp[]>;

  #helper: RunningHelper | undefined;
  #tick: ReturnType<typeof setTimeout> | undefined;
  #lastDemandMs = Number.NEGATIVE_INFINITY;
  #retryAtMs = 0;
  #foreground: ForegroundReading | undefined;
  #steamApps: readonly SteamApp[] | undefined;
  #steamLoading: Promise<void> | undefined;
  /** Bumped on teardown so a late Steam read cannot repopulate a new window. */
  #window = 0;
  /** Redacted; may reach a browser through `health()` and a sample message. */
  #failure: string | undefined;

  constructor(options: GameProviderOptions = {}) {
    this.#now = options.now ?? (() => Date.now());
    this.#graceMs = Math.max(1, options.graceMs ?? DEFAULT_GRACE_MS);
    this.#retryMs = Math.max(0, options.retryMs ?? DEFAULT_RETRY_MS);
    this.#spawnProcess = options.spawnProcess;
    this.#killTree = options.killTree;
    this.#pathExists = options.pathExists;
    this.#steamRoot = options.steamRoot ?? (() => resolveSteamRoot());
    this.#loadSteamApps = options.loadSteamApps ?? readSteamApps;
  }

  async describe(): Promise<readonly SensorDescriptor[]> {
    return GAME_DESCRIPTORS;
  }

  async sample(
    semanticKeys: readonly string[],
    nowMs: number,
  ): Promise<readonly SampleEntry[]> {
    const wanted = GAME_KEYS.filter((key) => semanticKeys.includes(key));

    if (wanted.length === 0) {
      return [];
    }

    const now = this.#now();
    // A gap this long is a new demand window, even if the grace timer was
    // delayed while the host slept.
    if (now - this.#lastDemandMs > this.#graceMs) this.#teardown();
    this.#lastDemandMs = now;

    await this.#ensureSteam();
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

  /** Ends the helper and its grace timer for host shutdown. */
  stop(): void {
    this.#teardown();
    this.#retryAtMs = 0;
    this.#lastDemandMs = Number.NEGATIVE_INFINITY;
  }

  #ensureSteam(): Promise<void> {
    if (this.#steamApps !== undefined) return Promise.resolve();

    this.#steamLoading ??= this.#readSteamOnce();
    return this.#steamLoading;
  }

  async #readSteamOnce(): Promise<void> {
    const window = this.#window;
    let apps: readonly SteamApp[] = [];

    try {
      const root = await this.#steamRoot();
      if (root !== undefined) apps = await this.#loadSteamApps(root);
    } catch {
      // An absent or unreadable Steam install is no apps, never an error.
      apps = [];
    }

    if (window !== this.#window) return;

    this.#steamApps = apps;
    this.#steamLoading = undefined;
  }

  #reconcile(now: number): void {
    if (now - this.#lastDemandMs > this.#graceMs) {
      this.#teardown();
      return;
    }

    if (this.#helper !== undefined || now < this.#retryAtMs) return;

    this.#start();
  }

  #start(): void {
    const state: RunningHelper = { alive: true, stop: () => undefined };

    const handle = startJsonLineHelper({
      id: "game",
      script: FOREGROUND_SCRIPT,
      timeoutMs: LIVENESS_TIMEOUT_MS,
      ...(this.#spawnProcess === undefined
        ? {}
        : { spawnProcess: this.#spawnProcess }),
      ...(this.#killTree === undefined ? {} : { killTree: this.#killTree }),
      ...(this.#pathExists === undefined
        ? {}
        : { pathExists: this.#pathExists }),
      onLine: (line) => {
        if (state.alive) this.#ingest(line);
      },
      onExit: (reason, kind) => this.#ended(state, reason, kind),
    });

    state.stop = () => handle.stop();

    // An absent PowerShell or a synchronous exit reports before this returns,
    // so a non-undefined handle is never taken as proof of life.
    if (!state.alive) return;

    this.#helper = state;
    this.#scheduleTick();
  }

  #ended(state: RunningHelper, reason: string, kind: HelperExitKind): void {
    state.alive = false;

    if (this.#helper === state) {
      this.#helper = undefined;
    }

    // A deliberate stop belongs to `#teardown`; it owns no backoff.
    if (kind === "stopped") return;

    this.#failure = redactForBrowser(reason);
    this.#foreground = undefined;
    this.#retryAtMs = this.#now() + this.#retryMs;
    this.#stopTick();
  }

  #ingest(line: string): void {
    const reading = parseForegroundLine(line);
    if (reading === undefined) return;

    this.#foreground = reading;
    this.#failure = undefined;
  }

  #teardown(): void {
    this.#stopTick();

    const current = this.#helper;
    this.#helper = undefined;

    if (current !== undefined) {
      current.alive = false;
      current.stop();
    }

    this.#window += 1;
    this.#foreground = undefined;
    this.#steamApps = undefined;
    this.#steamLoading = undefined;
    this.#failure = undefined;
    this.#retryAtMs = 0;
  }

  #stopTick(): void {
    if (this.#tick !== undefined) {
      clearTimeout(this.#tick);
      this.#tick = undefined;
    }
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

  #matched(): SteamApp | undefined {
    const foreground = this.#foreground;

    if (foreground === undefined || foreground.pid === 0) return undefined;
    if (foreground.path === undefined) return undefined;

    return matchProcess(foreground.path, this.#steamApps ?? []);
  }

  /** The executable's file name, else the process name the helper could read. */
  #processName(foreground: ForegroundReading): string | undefined {
    if (foreground.path !== undefined) {
      const name = path.win32.basename(foreground.path);
      if (name !== "") return name;
    }

    return foreground.name;
  }

  #sampleOf(semanticKey: string, nowMs: number): Sample {
    const sensorId = `${GAME_PROVIDER_ID}:${semanticKey}`;
    const timestamp = new Date(nowMs).toISOString();
    const foreground = this.#foreground;
    const absent = (message: string): Sample => ({
      sensorId,
      timestamp,
      status: "unavailable",
      message: this.#failure ?? message,
    });

    if (semanticKey === "game.artwork") {
      return {
        sensorId,
        timestamp,
        status: "missing",
        message: NO_ARTWORK_MESSAGE,
      };
    }

    if (foreground === undefined) {
      return absent(WAITING_GAME_MESSAGE);
    }

    if (semanticKey === "game.running") {
      return {
        sensorId,
        timestamp,
        status: "ok",
        booleanValue: foreground.pid !== 0,
      };
    }

    if (foreground.pid === 0) return absent(NO_GAME_MESSAGE);

    if (semanticKey === "game.name") {
      const app = this.#matched();

      return app === undefined
        ? absent(NO_STEAM_MATCH_MESSAGE)
        : { sensorId, timestamp, status: "ok", textValue: app.name };
    }

    const name = this.#processName(foreground);

    return name === undefined
      ? absent(NO_PROCESS_NAME_MESSAGE)
      : { sensorId, timestamp, status: "ok", textValue: name };
  }
}
