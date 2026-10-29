import fs from "node:fs/promises";
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
  readProductName,
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
import { findBoxArt } from "./box-art.js";
import {
  type InstalledGame,
  readInstalledGames,
} from "./catalogue/catalogue.js";
import { defaultCatalogueSeams } from "./catalogue/seams.js";
import { classifyForeground, type GameEvidence } from "./game-classifier.js";
import {
  matchProcess,
  readSteamApps,
  resolveSteamRoot,
  type SteamApp,
} from "./steam-library.js";
import type { StoreLookupResult } from "./store-metadata.js";

/**
 * The game the user is playing, identified from local evidence.
 *
 * One PowerShell helper reports the foreground process once a second while a
 * display binds `game.*`; the installed-game catalogue and the Steam library
 * are each read once per demand window. `game.running` follows the classifier:
 * a catalogue match, a runtime marker, or two fullscreen samples of a known
 * engine window class. A Steam match still gives the name and, when Steam's
 * cache holds it, the local box art URL. `game.app` names the executable for
 * every process, game or not; a store lookup happens only when a name or
 * artwork key is demanded and neither the catalogue nor Steam names the app.
 * A store failure is a gap for that key, never the provider's
 * failure, so presence keeps answering.
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
export const NO_STORE_MATCH_MESSAGE = "No store match for this app.";
export const STORE_UNAVAILABLE_MESSAGE = "The game store could not be reached.";
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
/** A stalled store request must not hold the whole registry cycle. */
const STORE_TIMEOUT_MS = 3_000;

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
  /** Decision 0109's client; absent is local-only names and art. */
  readonly store?: GameStore;
  /** Injected so a test reads no executable's version info. */
  readonly productName?: (
    executablePath: string,
  ) => Promise<string | undefined>;
  /**
   * The installed games the classifier matches against. Read once per demand
   * window; a rejection is an empty catalogue, not the provider's failure.
   */
  readonly catalogue?: () => Promise<readonly InstalledGame[]>;
  /** The directory listing the runtime-marker check uses; a test injects one. */
  readonly readdir?: (dir: string) => Promise<readonly string[]>;
  /**
   * A fixed foreground executable instead of the Windows helper. A browser
   * proof uses it to name a game with no real window; the helper is not spawned.
   */
  readonly foregroundPath?: string;
}

/** The slice of Task 7.1's store client the provider needs. */
export interface GameStore {
  lookup(name: string, signal?: AbortSignal): Promise<StoreLookupResult>;
  /** The host-relative route that serves this app's cached cover. */
  cover(appId: number, signal?: AbortSignal): Promise<string | undefined>;
}

/** What one demand window resolved: a catalogue name, a Steam app or a store match. */
interface GameIdentity {
  /** The catalogue's name for the foreground game; it outranks every lookup. */
  readonly catalogueName?: string;
  readonly steam?: SteamApp;
  readonly store?: { readonly id: number; readonly name: string };
  /** The lookup had no answer, so "no such game" would be a false reason. */
  readonly storeUnavailable?: true;
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
  readonly #store: GameStore | undefined;
  readonly #productName: (
    executablePath: string,
  ) => Promise<string | undefined>;
  readonly #catalogue: () => Promise<readonly InstalledGame[]>;
  readonly #readdir: (dir: string) => Promise<readonly string[]>;
  readonly #foregroundPath: string | undefined;

  #helper: RunningHelper | undefined;
  #tick: ReturnType<typeof setTimeout> | undefined;
  #lastDemandMs = Number.NEGATIVE_INFINITY;
  #retryAtMs = 0;
  #foreground: ForegroundReading | undefined;
  #steamRootPath: string | undefined;
  #steamApps: readonly SteamApp[] | undefined;
  #steamLoading: Promise<void> | undefined;
  #catalogueGames: readonly InstalledGame[] | undefined;
  #catalogueLoading: Promise<void> | undefined;
  /** Consecutive helper lines of the same foreground window while fullscreen. */
  #fullscreenSamples = 0;
  #fullscreenKey: { readonly pid: number; readonly class?: string } | undefined;
  /** Bumped by every parsed helper line, so repeated asks read one line once. */
  #readingSequence = 0;
  #sampledSequence = -1;
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
    this.#store = options.store;
    this.#productName = options.productName ?? readProductName;
    this.#catalogue =
      options.catalogue ??
      (() =>
        readInstalledGames(
          defaultCatalogueSeams({
            resolveSteamRoot: this.#steamRoot,
            readSteamApps: this.#loadSteamApps,
          }),
        ));
    this.#readdir = options.readdir ?? fs.readdir;
    this.#foregroundPath = options.foregroundPath;
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

    await Promise.all([this.#ensureSteam(), this.#ensureCatalogue()]);
    this.#reconcile(now);

    // A presence-only demand reads neither the store nor Steam's cache: identity
    // is resolved only for a key that needs it, and the cover only for artwork.
    const wantsRunning = wanted.includes("game.running");
    const wantsName = wanted.includes("game.name");
    const wantsArtwork = wanted.includes("game.artwork");
    const evidence =
      wantsRunning || wantsName || wantsArtwork
        ? await this.#classify()
        : undefined;
    const identity =
      wantsName || wantsArtwork ? await this.#identify(evidence) : undefined;
    const artworkUrl = wantsArtwork
      ? await this.#artworkUrl(identity)
      : undefined;

    return wanted.map((semanticKey) => ({
      semanticKey,
      sample: this.#sampleOf(
        semanticKey,
        nowMs,
        evidence,
        identity,
        artworkUrl,
      ),
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
    let root: string | undefined;
    let apps: readonly SteamApp[] = [];

    try {
      root = await this.#steamRoot();
      if (root !== undefined) apps = await this.#loadSteamApps(root);
    } catch {
      // An absent or unreadable Steam install is no apps, never an error.
      apps = [];
    }

    if (window !== this.#window) return;

    this.#steamRootPath = root;
    this.#steamApps = apps;
    this.#steamLoading = undefined;
  }

  #ensureCatalogue(): Promise<void> {
    if (this.#catalogueGames !== undefined) return Promise.resolve();

    this.#catalogueLoading ??= this.#readCatalogueOnce();
    return this.#catalogueLoading;
  }

  async #readCatalogueOnce(): Promise<void> {
    const window = this.#window;
    let games: readonly InstalledGame[] = [];

    try {
      games = await this.#catalogue();
    } catch {
      // A catalogue that cannot be read is no games, never the provider down.
      games = [];
    }

    if (window !== this.#window) return;

    this.#catalogueGames = games;
    this.#catalogueLoading = undefined;
  }

  #reconcile(now: number): void {
    // A fixed foreground is the whole reading; the helper has nothing to add.
    if (this.#foregroundPath !== undefined) return;

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
    this.#resetFullscreen();
    this.#retryAtMs = this.#now() + this.#retryMs;
    this.#stopTick();
  }

  #ingest(line: string): void {
    const reading = parseForegroundLine(line);
    if (reading === undefined) return;

    this.#readingSequence += 1;
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
    this.#steamRootPath = undefined;
    this.#steamApps = undefined;
    this.#steamLoading = undefined;
    this.#catalogueGames = undefined;
    this.#catalogueLoading = undefined;
    this.#resetFullscreen();
    this.#failure = undefined;
    this.#retryAtMs = 0;
  }

  #resetFullscreen(): void {
    this.#fullscreenSamples = 0;
    this.#fullscreenKey = undefined;
    this.#sampledSequence = -1;
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

  /** The injected foreground, else whatever the helper last reported. */
  #currentForeground(): ForegroundReading | undefined {
    const fixed = this.#foregroundPath;

    return fixed === undefined ? this.#foreground : { pid: 1, path: fixed };
  }

  #matched(): SteamApp | undefined {
    const foreground = this.#currentForeground();

    if (foreground === undefined || foreground.pid === 0) return undefined;
    if (foreground.path === undefined) return undefined;

    return matchProcess(foreground.path, this.#steamApps ?? []);
  }

  /**
   * The classifier's answer for the current foreground. The fullscreen streak
   * advances on a new helper line only: several asks in one host tick all read
   * the same line, and counting those would turn one fullscreen line into two.
   * The streak is the same pid and class while a fullscreen flag holds, so the
   * second line reaches the classifier's threshold and alt-tab does not flap
   * presence.
   */
  async #classify(): Promise<GameEvidence | undefined> {
    const sequence = this.#readingSequence;
    const fresh = sequence !== this.#sampledSequence;
    this.#sampledSequence = sequence;

    const foreground = this.#currentForeground();

    if (foreground === undefined) {
      this.#resetFullscreen();
      return undefined;
    }

    if (fresh) this.#advanceFullscreen(foreground);

    return classifyForeground(foreground, this.#catalogueGames ?? [], {
      fullscreenSamples: this.#fullscreenSamples,
      readdir: this.#readdir,
    });
  }

  #advanceFullscreen(foreground: ForegroundReading): void {
    const fullscreen =
      foreground.fullscreen === true || foreground.d3dFullscreen === true;
    const previous = this.#fullscreenKey;
    const sameWindow =
      previous !== undefined &&
      previous.pid === foreground.pid &&
      previous.class === foreground.class;

    this.#fullscreenSamples = fullscreen
      ? sameWindow
        ? this.#fullscreenSamples + 1
        : 1
      : 0;
    this.#fullscreenKey = {
      pid: foreground.pid,
      ...(foreground.class === undefined ? {} : { class: foreground.class }),
    };
  }

  /** The executable's file name, else the process name the helper could read. */
  #processName(foreground: ForegroundReading): string | undefined {
    if (foreground.path !== undefined) {
      const name = path.win32.basename(foreground.path);
      if (name !== "") return name;
    }

    return foreground.name;
  }

  /**
   * The identity a name or artwork reading needs. The catalogue answers first,
   * then a Steam app from its manifest without a search; otherwise the app is
   * looked up once by its local name. A failed lookup is a reason for that key,
   * never the provider's failure, and is kept distinct from the store answering
   * "no match".
   */
  async #identify(evidence: GameEvidence | undefined): Promise<GameIdentity> {
    const foreground = this.#currentForeground();

    if (foreground === undefined || foreground.pid === 0) return {};

    // Steam is still matched when the catalogue names the game, because its
    // local cache is the first artwork source.
    const steam = this.#matched();
    const catalogueGame = evidence?.game;

    if (catalogueGame !== undefined) {
      return {
        catalogueName: catalogueGame.name,
        ...(steam === undefined ? {} : { steam }),
      };
    }

    if (steam !== undefined) return { steam };

    const store = this.#store;
    if (store === undefined) return {};

    const localName = await this.#localName(foreground);
    if (localName === undefined) return {};

    let result: StoreLookupResult;

    try {
      result = await store.lookup(
        localName,
        AbortSignal.timeout(STORE_TIMEOUT_MS),
      );
    } catch {
      return { storeUnavailable: true };
    }

    if (result.kind === "match") {
      return { store: { id: result.id, name: result.name } };
    }

    return result.kind === "unavailable" ? { storeUnavailable: true } : {};
  }

  /** The local name a store search can use: ProductName, else the file stem. */
  async #localName(foreground: ForegroundReading): Promise<string | undefined> {
    if (foreground.path !== undefined) {
      let product: string | undefined;

      try {
        product = await this.#productName(foreground.path);
      } catch {
        product = undefined;
      }

      const trimmed = product?.trim();
      if (trimmed !== undefined && trimmed !== "") return trimmed;

      const file = path.win32.parse(foreground.path).name;
      if (file !== "") return file;
    }

    return foreground.name;
  }

  /**
   * A local image stays first: only a matched app whose Steam cache is empty
   * asks the store. The cover is fetched only for a demanded artwork key.
   */
  async #artworkUrl(
    identity: GameIdentity | undefined,
  ): Promise<string | undefined> {
    const steam = identity?.steam;

    if (steam !== undefined) {
      const root = this.#steamRootPath;

      if (root !== undefined) {
        const local = await findBoxArt(steam, [root]);
        if (local !== undefined) return local;
      }

      const appId = Number.parseInt(steam.appId, 10);
      return this.#cover(appId);
    }

    const match = identity?.store;
    return match === undefined ? undefined : this.#cover(match.id);
  }

  async #cover(appId: number): Promise<string | undefined> {
    const store = this.#store;

    if (store === undefined || !Number.isInteger(appId) || appId <= 0) {
      return undefined;
    }

    try {
      return await store.cover(appId, AbortSignal.timeout(STORE_TIMEOUT_MS));
    } catch {
      return undefined;
    }
  }

  #sampleOf(
    semanticKey: string,
    nowMs: number,
    evidence: GameEvidence | undefined,
    identity: GameIdentity | undefined,
    artworkUrl: string | undefined,
  ): Sample {
    const sensorId = `${GAME_PROVIDER_ID}:${semanticKey}`;
    const timestamp = new Date(nowMs).toISOString();
    const foreground = this.#currentForeground();
    const absent = (message: string): Sample => ({
      sensorId,
      timestamp,
      status: "unavailable",
      message: this.#failure ?? message,
    });

    if (semanticKey === "game.artwork") {
      return artworkUrl === undefined
        ? absent(NO_ARTWORK_MESSAGE)
        : { sensorId, timestamp, status: "ok", textValue: artworkUrl };
    }

    if (foreground === undefined) {
      return absent(WAITING_GAME_MESSAGE);
    }

    if (semanticKey === "game.running") {
      return {
        sensorId,
        timestamp,
        status: "ok",
        booleanValue: evidence?.running === true,
      };
    }

    if (foreground.pid === 0) return absent(NO_GAME_MESSAGE);

    if (semanticKey === "game.name") {
      const name =
        identity?.catalogueName ??
        identity?.steam?.name ??
        identity?.store?.name;

      if (name !== undefined) {
        return { sensorId, timestamp, status: "ok", textValue: name };
      }

      // "No store match" is only true when the store answered.
      return absent(
        identity?.storeUnavailable === true
          ? STORE_UNAVAILABLE_MESSAGE
          : NO_STORE_MATCH_MESSAGE,
      );
    }

    const name = this.#processName(foreground);

    return name === undefined
      ? absent(NO_PROCESS_NAME_MESSAGE)
      : { sensorId, timestamp, status: "ok", textValue: name };
  }
}
