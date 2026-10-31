import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Sample } from "@yunari/renderer-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseForegroundLine } from "../helpers/foreground.js";
import type { HelperChild, SpawnProcess } from "../helpers/supervisor.js";
import { readAppxGames } from "./catalogue/appx.js";
import type { InstalledGame } from "./catalogue/catalogue.js";
import type { CatalogueSeams } from "./catalogue/seams.js";
import { seamsOf } from "./catalogue/test-seams.js";
import {
  GAME_KEYS,
  GameProvider,
  type GameStore,
  NO_ARTWORK_MESSAGE,
  NO_GAME_MESSAGE,
  NO_STORE_MATCH_MESSAGE,
  STORE_UNAVAILABLE_MESSAGE,
} from "./provider.js";
import type { SteamApp } from "./steam-library.js";
import type { StoreLookupResult } from "./store-metadata.js";

/** Lets one test drive the provider's own default catalogue deterministically. */
const defaultCatalogueReader = vi.hoisted(() => ({
  read: undefined as
    | ((seams: CatalogueSeams) => Promise<readonly InstalledGame[]>)
    | undefined,
}));

vi.mock("./catalogue/catalogue.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./catalogue/catalogue.js")>();

  return {
    ...actual,
    readInstalledGames: (seams: CatalogueSeams) =>
      defaultCatalogueReader.read === undefined
        ? actual.readInstalledGames(seams)
        : defaultCatalogueReader.read(seams),
  };
});

class FakeChild extends EventEmitter {
  readonly pid: number;
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();

  constructor(pid: number) {
    super();
    this.pid = pid;
  }
}

interface HarnessOptions {
  readonly steamRoot?: string | undefined;
  readonly apps?: readonly SteamApp[];
  readonly graceMs?: number;
  readonly retryMs?: number;
  /** Make the Steam registry lookup reject, exercising the provider's catch. */
  readonly steamError?: boolean;
  /** Make the helper's spawn throw; cleared later to prove the retry boundary. */
  readonly failSpawn?: boolean;
  readonly store?: GameStore;
  readonly productName?: (
    executablePath: string,
  ) => Promise<string | undefined>;
  /** Installed games the classifier matches against. */
  readonly catalogue?: () => Promise<readonly InstalledGame[]>;
  /** Use the provider's own default catalogue rather than the harness fake. */
  readonly useDefaultCatalogue?: boolean;
  /** The runtime-marker listing; the default throws, so no test reads a disk. */
  readonly readdir?: (dir: string) => Promise<readonly string[]>;
}

interface Harness {
  readonly provider: GameProvider;
  readonly children: FakeChild[];
  readonly killed: FakeChild[];
  readonly scripts: string[];
  readonly now: () => number;
  spawnCalls(): number;
  setFailSpawn(fail: boolean): void;
  advance(ms: number): void;
  emit(child: FakeChild, line: string): void;
  sample(keys: readonly string[]): Promise<Map<string, Sample>>;
}

function harness(options: HarnessOptions = {}): Harness {
  const children: FakeChild[] = [];
  const killed: FakeChild[] = [];
  const scripts: string[] = [];
  let pid = 700;
  let nowMs = 1_000_000;
  let spawnCalls = 0;
  let failSpawn = options.failSpawn ?? false;

  const spawnProcess: SpawnProcess = (_command, args) => {
    spawnCalls += 1;

    if (failSpawn) {
      throw new Error(
        "could not start at C:\\Users\\peter\\secret\\game.exe via https://example.com/token",
      );
    }

    const child = new FakeChild(pid);
    pid += 1;
    const index = args.indexOf("-EncodedCommand");
    const encoded = index === -1 ? "" : (args[index + 1] ?? "");
    scripts.push(Buffer.from(encoded, "base64").toString("utf16le"));
    children.push(child);
    return child as unknown as HelperChild;
  };

  const provider = new GameProvider({
    now: () => nowMs,
    graceMs: options.graceMs ?? 60_000,
    retryMs: options.retryMs ?? 60_000,
    spawnProcess,
    killTree: (child) => killed.push(child as unknown as FakeChild),
    pathExists: () => true,
    steamRoot: async () => {
      if (options.steamError === true) {
        throw new Error("registry read failed");
      }

      return options.steamRoot;
    },
    loadSteamApps: async () => options.apps ?? [],
    // A test never runs PowerShell: absent a fake, there is no product name.
    productName: options.productName ?? (async () => undefined),
    ...(options.useDefaultCatalogue === true
      ? {}
      : {
          // The default catalogue is Steam's library, as the real seams map it.
          catalogue:
            options.catalogue ??
            (async () =>
              (options.apps ?? []).map((app) => ({
                source: "steam" as const,
                name: app.name,
                installDir: app.installDir,
                exes: [],
              }))),
        }),
    readdir:
      options.readdir ??
      (async () => {
        throw new Error("ENOENT: no such directory in a test");
      }),
    ...(options.store === undefined ? {} : { store: options.store }),
  });

  return {
    provider,
    children,
    killed,
    scripts,
    now: () => nowMs,
    spawnCalls: () => spawnCalls,
    setFailSpawn(fail) {
      failSpawn = fail;
    },
    advance(ms) {
      nowMs += ms;
      vi.advanceTimersByTime(ms);
    },
    emit(child, line) {
      child.stdout.emit("data", `${line}\n`);
    },
    async sample(keys) {
      const entries = await provider.sample(keys, nowMs);
      return new Map(entries.map((entry) => [entry.semanticKey, entry.sample]));
    },
  };
}

function foregroundLine(
  pidValue: number,
  path: string | undefined,
  name: string | undefined,
  window: {
    readonly class?: string;
    readonly fullscreen?: boolean;
    readonly d3dFullscreen?: boolean;
  } = {},
): string {
  return JSON.stringify({
    kind: "foreground",
    pid: pidValue,
    path,
    name,
    ...window,
  });
}

const STEAM_APP: SteamApp = {
  appId: "10",
  name: "Counter-Strike",
  installDir: "D:\\Games\\Steam\\steamapps\\common\\Half-Life",
};

const tempRoots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  defaultCatalogueReader.read = undefined;

  for (const root of tempRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

/** A fake Steam root holding the art Steam caches for `appId`. */
async function steamRootWithBoxArt(appId: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-game-art-"));
  tempRoots.push(root);
  const folder = path.join(root, "appcache", "librarycache", appId);
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(
    path.join(folder, "library_600x900.jpg"),
    new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
  );
  return root;
}

describe("GameProvider descriptors", () => {
  it("forwards the vocabulary's labels, families and media kind", async () => {
    vi.useFakeTimers();
    const { provider } = harness();
    const descriptors = await provider.describe();

    expect(descriptors.map((descriptor) => descriptor.semanticKey)).toEqual([
      ...GAME_KEYS,
    ]);
    expect(descriptors.map((descriptor) => descriptor.label)).toEqual([
      "Game name",
      "Game artwork",
      "Game running",
      "Game process",
    ]);
    expect(
      descriptors.every((descriptor) => descriptor.family === "game"),
    ).toBe(true);
    expect(
      descriptors.find(
        (descriptor) => descriptor.semanticKey === "game.artwork",
      )?.mediaKind,
    ).toBe("image");
    expect(
      descriptors.find(
        (descriptor) => descriptor.semanticKey === "game.running",
      )?.valueKind,
    ).toBe("boolean");
    provider.stop();
  });
});

describe("parseForegroundLine", () => {
  it("reads a process id, path and name; rejects anything else", () => {
    expect(
      parseForegroundLine(foregroundLine(42, "C:\\Games\\game.exe", "game")),
    ).toEqual({ pid: 42, path: "C:\\Games\\game.exe", name: "game" });
    expect(parseForegroundLine('{"kind":"foreground","pid":0}')).toEqual({
      pid: 0,
    });
    expect(parseForegroundLine('{"kind":"other","pid":42}')).toBeUndefined();
    expect(
      parseForegroundLine('{"kind":"foreground","pid":"42"}'),
    ).toBeUndefined();
    expect(parseForegroundLine("not json")).toBeUndefined();
  });
});

describe("GameProvider samples", () => {
  it("reports a Steam-matched game's name, process and running state", async () => {
    vi.useFakeTimers();
    const h = harness({ steamRoot: "D:\\Games\\Steam", apps: [STEAM_APP] });
    await h.sample(["game.name"]);
    const child = h.children[0];
    expect(child).toBeDefined();

    h.emit(
      child as FakeChild,
      foregroundLine(
        1234,
        "d:\\games\\steam\\STEAMAPPS\\common\\half-life\\hl.exe",
        "hl",
      ),
    );

    const samples = await h.sample(GAME_KEYS);

    expect(samples.get("game.name")).toMatchObject({
      status: "ok",
      textValue: "Counter-Strike",
    });
    expect(samples.get("game.app")).toMatchObject({
      status: "ok",
      textValue: "hl.exe",
    });
    expect(samples.get("game.running")).toMatchObject({
      status: "ok",
      booleanValue: true,
    });
    h.provider.stop();
  });

  it("reports a non-Steam foreground process without inventing a name", async () => {
    vi.useFakeTimers();
    const h = harness({ steamRoot: "D:\\Games\\Steam", apps: [STEAM_APP] });
    await h.sample(["game.running"]);
    h.emit(
      h.children[0] as FakeChild,
      foregroundLine(99, "C:\\Games\\Other\\other.exe", "other"),
    );

    const samples = await h.sample(GAME_KEYS);

    expect(samples.get("game.app")).toMatchObject({
      status: "ok",
      textValue: "other.exe",
    });
    expect(samples.get("game.running")).toMatchObject({
      status: "ok",
      booleanValue: false,
    });
    expect(samples.get("game.name")?.status).not.toBe("ok");
    expect(samples.get("game.name")?.textValue).toBeUndefined();
    h.provider.stop();
  });

  it("reports no game as running false with no name or process", async () => {
    vi.useFakeTimers();
    const h = harness({ steamRoot: "D:\\Games\\Steam", apps: [STEAM_APP] });
    await h.sample(["game.running"]);
    h.emit(h.children[0] as FakeChild, '{"kind":"foreground","pid":0}');

    const samples = await h.sample(GAME_KEYS);

    expect(samples.get("game.running")).toMatchObject({
      status: "ok",
      booleanValue: false,
    });
    expect(samples.get("game.name")?.textValue).toBeUndefined();
    expect(samples.get("game.name")?.message).toBe(NO_GAME_MESSAGE);
    expect(samples.get("game.app")?.textValue).toBeUndefined();
    expect(samples.get("game.app")?.message).toBe(NO_GAME_MESSAGE);
    h.provider.stop();
  });

  it("reports the running Steam game's locally cached box art", async () => {
    vi.useFakeTimers();
    const root = await steamRootWithBoxArt("10");
    const h = harness({ steamRoot: root, apps: [STEAM_APP] });
    await h.sample(["game.running"]);
    h.emit(
      h.children[0] as FakeChild,
      foregroundLine(
        1234,
        "d:\\games\\steam\\STEAMAPPS\\common\\half-life\\hl.exe",
        "hl",
      ),
    );

    const samples = await h.sample(["game.artwork"]);

    expect(samples.get("game.artwork")).toMatchObject({
      status: "ok",
      textValue: "/api/game/artwork/10.jpg",
    });
    h.provider.stop();
  });

  it("leaves artwork unavailable when the running game has no local image", async () => {
    vi.useFakeTimers();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-game-art-"));
    tempRoots.push(root);
    const h = harness({ steamRoot: root, apps: [STEAM_APP] });
    await h.sample(["game.running"]);
    h.emit(
      h.children[0] as FakeChild,
      foregroundLine(
        1234,
        "d:\\games\\steam\\steamapps\\common\\half-life\\hl.exe",
        "hl",
      ),
    );

    const samples = await h.sample(["game.artwork"]);

    expect(samples.get("game.artwork")).toMatchObject({
      status: "unavailable",
      message: NO_ARTWORK_MESSAGE,
    });
    expect(samples.get("game.artwork")?.textValue).toBeUndefined();
    h.provider.stop();
  });

  it("keeps artwork unavailable for a process outside Steam", async () => {
    vi.useFakeTimers();
    const root = await steamRootWithBoxArt("10");
    const h = harness({ steamRoot: root, apps: [STEAM_APP] });
    await h.sample(["game.running"]);
    h.emit(
      h.children[0] as FakeChild,
      foregroundLine(99, "C:\\Games\\Other\\other.exe", "other"),
    );

    const samples = await h.sample(["game.artwork"]);

    expect(samples.get("game.artwork")?.status).toBe("unavailable");
    expect(samples.get("game.artwork")?.textValue).toBeUndefined();
    h.provider.stop();
  });

  it("treats an absent Steam install as no apps and no error", async () => {
    vi.useFakeTimers();
    const h = harness({ steamRoot: undefined });
    await h.sample(["game.running"]);
    h.emit(
      h.children[0] as FakeChild,
      foregroundLine(7, "C:\\Games\\Other\\other.exe", "other"),
    );

    const samples = await h.sample(GAME_KEYS);

    expect(samples.get("game.app")).toMatchObject({
      status: "ok",
      textValue: "other.exe",
    });
    expect(samples.get("game.running")).toMatchObject({
      status: "ok",
      booleanValue: false,
    });
    expect(samples.get("game.name")?.status).not.toBe("ok");
    expect(h.provider.health()).toEqual({ available: true });
    h.provider.stop();
  });

  it("survives a Steam registry lookup that rejects", async () => {
    vi.useFakeTimers();
    const h = harness({ steamError: true });
    await h.sample(["game.running"]);
    h.emit(
      h.children[0] as FakeChild,
      foregroundLine(7, "C:\\Games\\Other\\other.exe", "other"),
    );

    const samples = await h.sample(GAME_KEYS);

    expect(samples.get("game.app")).toMatchObject({
      status: "ok",
      textValue: "other.exe",
    });
    expect(samples.get("game.name")?.status).not.toBe("ok");
    expect(h.provider.health()).toEqual({ available: true });
    h.provider.stop();
  });

  it("starts the helper only on demand and stops it after the grace period", async () => {
    vi.useFakeTimers();
    const h = harness({ graceMs: 5_000 });
    const before = await h.sample([]);
    expect(before.size).toBe(0);
    expect(h.children).toHaveLength(0);

    await h.sample(["game.running"]);
    expect(h.children).toHaveLength(1);

    h.advance(6_000);
    await h.sample([]);

    expect(h.killed).toHaveLength(1);
    h.provider.stop();
  });
});

describe("GameProvider classification", () => {
  const CATALOGUE_GAME: InstalledGame = {
    source: "epic",
    name: "Catalogue Game",
    installDir: "C:\\Games\\Catalogue",
    exes: ["C:\\Games\\Catalogue\\game.exe"],
  };

  function countingStore(): {
    store: GameStore;
    lookups: () => number;
    covers: () => number;
  } {
    let lookups = 0;
    let covers = 0;

    return {
      lookups: () => lookups,
      covers: () => covers,
      store: {
        async lookup() {
          lookups += 1;
          return { kind: "none" };
        },
        async cover() {
          covers += 1;
          return undefined;
        },
      },
    };
  }

  it("reports a fullscreen browser as not running and still names its process", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.sample(["game.running"]);
    h.emit(
      h.children[0] as FakeChild,
      foregroundLine(
        99,
        "C:\\Program Files\\Google\\Chrome\\chrome.exe",
        "chrome",
        { class: "Chrome_WidgetWin_1", fullscreen: true },
      ),
    );

    const samples = await h.sample(["game.running", "game.app"]);

    expect(samples.get("game.running")).toMatchObject({
      status: "ok",
      booleanValue: false,
    });
    expect(samples.get("game.app")).toMatchObject({
      status: "ok",
      textValue: "chrome.exe",
    });
    h.provider.stop();
  });

  it("reports a catalogued executable as running without touching the store", async () => {
    vi.useFakeTimers();
    const fake = countingStore();
    let productReads = 0;
    const h = harness({
      catalogue: async () => [CATALOGUE_GAME],
      store: fake.store,
      productName: async () => {
        productReads += 1;
        return "Catalogue Game";
      },
    });
    await h.sample(["game.running"]);
    h.emit(
      h.children[0] as FakeChild,
      foregroundLine(99, "C:\\Games\\Catalogue\\game.exe", "game"),
    );

    const samples = await h.sample(GAME_KEYS);

    expect(samples.get("game.running")).toMatchObject({
      status: "ok",
      booleanValue: true,
    });
    expect(samples.get("game.name")).toMatchObject({
      status: "ok",
      textValue: "Catalogue Game",
    });
    expect(fake.lookups()).toBe(0);
    expect(fake.covers()).toBe(0);
    expect(productReads).toBe(0);
    h.provider.stop();
  });

  it("reports a config-less Store package as not a game", async () => {
    vi.useFakeTimers();
    const h = harness({
      catalogue: () =>
        readAppxGames(
          seamsOf({
            powerShell: [
              {
                Name: "Microsoft.Edge",
                InstallLocation:
                  "C:\\Program Files\\WindowsApps\\Microsoft.Edge",
                IsFramework: false,
                HasConfig: false,
              },
            ],
          }),
        ),
    });
    await h.sample(["game.running"]);
    h.emit(
      h.children[0] as FakeChild,
      foregroundLine(
        99,
        "C:\\Program Files\\WindowsApps\\Microsoft.Edge\\msedge.exe",
        "msedge",
      ),
    );

    const samples = await h.sample(["game.running"]);

    expect(samples.get("game.running")).toMatchObject({
      status: "ok",
      booleanValue: false,
    });
    h.provider.stop();
  });

  it("gives a catalogued game the same identity for artwork-only and name+artwork", async () => {
    vi.useFakeTimers();
    const fake = countingStore();
    let productReads = 0;
    const h = harness({
      catalogue: async () => [CATALOGUE_GAME],
      store: fake.store,
      productName: async () => {
        productReads += 1;
        return "Catalogue Game";
      },
    });
    await h.sample(["game.running"]);
    h.emit(
      h.children[0] as FakeChild,
      foregroundLine(99, "C:\\Games\\Catalogue\\game.exe", "game"),
    );

    const artworkOnly = await h.sample(["game.artwork"]);
    const nameAndArtwork = await h.sample(["game.name", "game.artwork"]);

    expect(artworkOnly.get("game.artwork")).toEqual(
      nameAndArtwork.get("game.artwork"),
    );
    expect(artworkOnly.get("game.artwork")).toMatchObject({
      status: "unavailable",
      message: NO_ARTWORK_MESSAGE,
    });
    expect(nameAndArtwork.get("game.name")).toMatchObject({
      status: "ok",
      textValue: "Catalogue Game",
    });
    expect(fake.lookups()).toBe(0);
    expect(fake.covers()).toBe(0);
    expect(productReads).toBe(0);
    h.provider.stop();
  });

  it("serves a catalogued launcher's local art without the store", async () => {
    vi.useFakeTimers();
    const fake = countingStore();
    let productReads = 0;
    const gog: InstalledGame = {
      source: "gog",
      name: "Disco Elysium",
      installDir: "C:\\Games\\Disco Elysium",
      exes: ["C:\\Games\\Disco Elysium\\disco.exe"],
      artwork: {
        source: "gog",
        id: "1207658924",
        file: "C:\\Games\\Disco Elysium\\goggame-1207658924.ico",
        extension: "ico",
      },
    };
    const h = harness({
      catalogue: async () => [gog],
      store: fake.store,
      productName: async () => {
        productReads += 1;
        return "Disco Elysium";
      },
    });
    await h.sample(["game.running"]);
    h.emit(
      h.children[0] as FakeChild,
      foregroundLine(99, "C:\\Games\\Disco Elysium\\disco.exe", "disco"),
    );

    const samples = await h.sample(["game.name", "game.artwork"]);

    expect(samples.get("game.name")).toMatchObject({
      status: "ok",
      textValue: "Disco Elysium",
    });
    expect(samples.get("game.artwork")).toMatchObject({
      status: "ok",
      textValue: "/api/game/artwork/gog-1207658924.ico",
    });
    expect(fake.lookups()).toBe(0);
    expect(fake.covers()).toBe(0);
    expect(productReads).toBe(0);
    h.provider.stop();
  });

  it("turns running true only on the second fullscreen helper line", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.sample(["game.running"]);
    const line = foregroundLine(99, "C:\\Games\\Unknown\\game.exe", "game", {
      class: "UnityWndClass",
      fullscreen: true,
    });
    h.emit(h.children[0] as FakeChild, line);

    // Two ask groups in one host tick read the same helper line. Neither may
    // count it as a second sample.
    const first = await h.sample(["game.running"]);
    const repeated = await h.sample(["game.running"]);
    expect(first.get("game.running")).toMatchObject({
      status: "ok",
      booleanValue: false,
    });
    expect(repeated.get("game.running")).toMatchObject({
      status: "ok",
      booleanValue: false,
    });

    h.emit(h.children[0] as FakeChild, line);
    const second = await h.sample(["game.running"]);
    expect(second.get("game.running")).toMatchObject({
      status: "ok",
      booleanValue: true,
    });
    h.provider.stop();
  });

  it("starts a fresh streak when a new demand window begins", async () => {
    vi.useFakeTimers();
    const h = harness({ graceMs: 5_000 });
    await h.sample(["game.running"]);
    const line = foregroundLine(99, "C:\\Games\\Unknown\\game.exe", "game", {
      class: "UnityWndClass",
      fullscreen: true,
    });
    h.emit(h.children[0] as FakeChild, line);
    const first = await h.sample(["game.running"]);
    expect(first.get("game.running")).toMatchObject({ booleanValue: false });

    // The grace gap tears the helper down. The new window's first demand reads
    // no process, so only teardown can have cleared the old first sample.
    h.advance(6_000);
    await h.sample(["game.app"]);
    const restarted = h.children[1];
    expect(restarted).toBeDefined();

    h.emit(restarted as FakeChild, line);
    const one = await h.sample(["game.running"]);
    expect(one.get("game.running")).toMatchObject({ booleanValue: false });

    h.emit(restarted as FakeChild, line);
    const two = await h.sample(["game.running"]);
    expect(two.get("game.running")).toMatchObject({ booleanValue: true });
    h.provider.stop();
  });

  it("classifies a runtime marker through the injected readdir", async () => {
    vi.useFakeTimers();
    const listed: string[] = [];
    const h = harness({
      readdir: async (dir) => {
        listed.push(dir);
        return ["steam_api64.dll"];
      },
    });
    await h.sample(["game.running"]);
    h.emit(
      h.children[0] as FakeChild,
      foregroundLine(99, "C:\\Games\\Marker\\game.exe", "game"),
    );

    const samples = await h.sample(["game.running"]);

    expect(samples.get("game.running")).toMatchObject({
      status: "ok",
      booleanValue: true,
    });
    expect(listed).toEqual(["C:\\Games\\Marker"]);
    h.provider.stop();
  });

  it("does not advance the streak on an unparseable helper line", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.sample(["game.running"]);
    const line = foregroundLine(99, "C:\\Games\\Unknown\\game.exe", "game", {
      class: "UnityWndClass",
      fullscreen: true,
    });
    h.emit(h.children[0] as FakeChild, line);
    const first = await h.sample(["game.running"]);
    expect(first.get("game.running")).toMatchObject({
      status: "ok",
      booleanValue: false,
    });

    h.emit(h.children[0] as FakeChild, "not a foreground line");
    const malformed = await h.sample(["game.running"]);
    expect(malformed.get("game.running")).toMatchObject({
      status: "ok",
      booleanValue: false,
    });

    h.emit(h.children[0] as FakeChild, line);
    const second = await h.sample(["game.running"]);
    expect(second.get("game.running")).toMatchObject({
      status: "ok",
      booleanValue: true,
    });
    h.provider.stop();
  });

  it("starts a new streak when the foreground pid changes", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.sample(["game.running"]);
    const first = foregroundLine(99, "C:\\Games\\Unknown\\game.exe", "game", {
      class: "UnityWndClass",
      fullscreen: true,
    });
    h.emit(h.children[0] as FakeChild, first);
    const started = await h.sample(["game.running"]);
    expect(started.get("game.running")).toMatchObject({
      status: "ok",
      booleanValue: false,
    });

    const other = foregroundLine(100, "C:\\Games\\Other\\game.exe", "game", {
      class: "UnityWndClass",
      fullscreen: true,
    });
    h.emit(h.children[0] as FakeChild, other);
    const changed = await h.sample(["game.running"]);
    expect(changed.get("game.running")).toMatchObject({
      status: "ok",
      booleanValue: false,
    });

    h.emit(h.children[0] as FakeChild, other);
    const settled = await h.sample(["game.running"]);
    expect(settled.get("game.running")).toMatchObject({
      status: "ok",
      booleanValue: true,
    });
    h.provider.stop();
  });

  it("builds the default catalogue from the provider's Steam seams", async () => {
    vi.useFakeTimers();
    // A synthetic root no real Steam install can match: only the provider's
    // injected seams resolve it.
    const fixtureApp: SteamApp = {
      appId: "10",
      name: "Fixture Game",
      installDir: "D:\\YunariFixtures\\Steam\\steamapps\\common\\Fixture",
    };
    defaultCatalogueReader.read = async (seams) => seams.steamApps();
    const h = harness({
      steamRoot: "D:\\YunariFixtures\\Steam",
      apps: [fixtureApp],
      useDefaultCatalogue: true,
    });
    await h.sample(["game.running"]);
    h.emit(
      h.children[0] as FakeChild,
      foregroundLine(
        1234,
        "D:\\YunariFixtures\\Steam\\steamapps\\common\\Fixture\\game.exe",
        "game",
      ),
    );

    const samples = await h.sample(GAME_KEYS);

    expect(samples.get("game.running")).toMatchObject({
      status: "ok",
      booleanValue: true,
    });
    expect(samples.get("game.name")).toMatchObject({
      status: "ok",
      textValue: "Fixture Game",
    });
    h.provider.stop();
  });

  it("keeps the provider available when the catalogue read fails", async () => {
    vi.useFakeTimers();
    const h = harness({
      catalogue: async () => {
        throw new Error("catalogue broke");
      },
    });
    await h.sample(["game.running"]);
    h.emit(
      h.children[0] as FakeChild,
      foregroundLine(99, "C:\\Games\\Other\\other.exe", "other"),
    );

    const samples = await h.sample(GAME_KEYS);

    expect(samples.get("game.running")).toMatchObject({
      status: "ok",
      booleanValue: false,
    });
    expect(h.provider.health()).toEqual({ available: true });
    h.provider.stop();
  });

  it("reads the catalogue once per demand window", async () => {
    vi.useFakeTimers();
    let reads = 0;
    const h = harness({
      catalogue: async () => {
        reads += 1;
        return [CATALOGUE_GAME];
      },
    });

    await h.sample(["game.running"]);
    await h.sample(["game.running"]);

    expect(reads).toBe(1);
    h.provider.stop();
  });

  it("reads the catalogue again after the grace gap starts a new window", async () => {
    vi.useFakeTimers();
    let reads = 0;
    const h = harness({
      graceMs: 5_000,
      catalogue: async () => {
        reads += 1;
        return [CATALOGUE_GAME];
      },
    });

    await h.sample(["game.running"]);
    h.advance(6_000);
    await h.sample(["game.running"]);

    expect(reads).toBe(2);
    h.provider.stop();
  });

  it("drops a catalogue read that resolves after teardown", async () => {
    vi.useFakeTimers();
    let reads = 0;
    let release: (games: readonly InstalledGame[]) => void = () => undefined;
    const h = harness({
      catalogue: () => {
        reads += 1;

        return reads === 1
          ? new Promise((resolve) => {
              release = resolve;
            })
          : Promise.resolve([]);
      },
    });

    const pending = h.provider.sample(["game.running"], h.now());
    h.provider.stop();
    release([CATALOGUE_GAME]);
    await pending;

    // The next window reads an empty catalogue; the late first read must not
    // have populated it.
    await h.sample(["game.running"]);
    h.emit(
      h.children[0] as FakeChild,
      foregroundLine(99, "C:\\Games\\Catalogue\\game.exe", "game"),
    );
    const samples = await h.sample(["game.running"]);

    expect(reads).toBe(2);
    expect(samples.get("game.running")).toMatchObject({
      status: "ok",
      booleanValue: false,
    });
    h.provider.stop();
  });
});

describe("GameProvider store metadata", () => {
  const EXAMPLE_MATCH: StoreLookupResult = {
    kind: "match",
    id: 1201270,
    name: "Example Game",
  };
  const NO_MATCH: StoreLookupResult = { kind: "none" };
  const UNAVAILABLE: StoreLookupResult = { kind: "unavailable" };
  const OTHER_EXE = "C:\\Games\\Other\\other.exe";

  interface FakeStore {
    readonly store: GameStore;
    readonly lookups: string[];
    readonly covers: number[];
    readonly signals: (AbortSignal | undefined)[];
  }

  function fakeStore(
    answer: (name: string) => StoreLookupResult,
    coverUrl: (appId: number) => string | undefined = (appId) =>
      `/api/game/artwork/${appId}.jpg`,
  ): FakeStore {
    const lookups: string[] = [];
    const covers: number[] = [];
    const signals: (AbortSignal | undefined)[] = [];

    return {
      lookups,
      covers,
      signals,
      store: {
        async lookup(name, signal) {
          lookups.push(name);
          signals.push(signal);
          return answer(name);
        },
        async cover(appId, signal) {
          covers.push(appId);
          signals.push(signal);
          return coverUrl(appId);
        },
      },
    };
  }

  it("reads nothing from the store for a Steam install", async () => {
    vi.useFakeTimers();
    const root = await steamRootWithBoxArt("10");
    const fake = fakeStore(() => EXAMPLE_MATCH);
    let productReads = 0;
    const h = harness({
      steamRoot: root,
      apps: [STEAM_APP],
      store: fake.store,
      productName: async () => {
        productReads += 1;
        return "Steam Game";
      },
    });
    await h.sample(["game.running"]);
    h.emit(
      h.children[0] as FakeChild,
      foregroundLine(
        1234,
        "d:\\games\\steam\\STEAMAPPS\\common\\half-life\\hl.exe",
        "hl",
      ),
    );

    const samples = await h.sample(GAME_KEYS);

    expect(fake.lookups).toEqual([]);
    expect(fake.covers).toEqual([]);
    expect(productReads).toBe(0);
    expect(samples.get("game.name")).toMatchObject({
      status: "ok",
      textValue: "Counter-Strike",
    });
    expect(samples.get("game.artwork")).toMatchObject({
      status: "ok",
      textValue: "/api/game/artwork/10.jpg",
    });
    h.provider.stop();
  });

  it("performs no store request for a presence-only demand", async () => {
    vi.useFakeTimers();
    const fake = fakeStore(() => EXAMPLE_MATCH);
    let productReads = 0;
    const h = harness({
      store: fake.store,
      productName: async () => {
        productReads += 1;
        return "Example Game";
      },
    });
    await h.sample(["game.running"]);
    h.emit(h.children[0] as FakeChild, foregroundLine(99, OTHER_EXE, "other"));

    const samples = await h.sample(["game.app", "game.running"]);

    expect(fake.lookups).toEqual([]);
    expect(fake.covers).toEqual([]);
    expect(productReads).toBe(0);
    expect(samples.get("game.app")).toMatchObject({
      status: "ok",
      textValue: "other.exe",
    });
    expect(samples.get("game.running")).toMatchObject({
      status: "ok",
      booleanValue: false,
    });
    h.provider.stop();
  });

  it("makes no store request in a later window that demands only presence", async () => {
    vi.useFakeTimers();
    const fake = fakeStore(() => EXAMPLE_MATCH);
    const h = harness({
      graceMs: 5_000,
      store: fake.store,
      productName: async () => "Example Game",
    });
    await h.sample(["game.running"]);
    h.emit(h.children[0] as FakeChild, foregroundLine(99, OTHER_EXE, "other"));

    const artwork = await h.sample(["game.artwork"]);
    expect(artwork.get("game.artwork")?.status).toBe("ok");
    expect(fake.lookups).toEqual(["Example Game"]);
    expect(fake.covers).toEqual([1201270]);

    // The grace gap starts a new window; no identity may survive it.
    h.advance(6_000);
    await h.sample(["game.app", "game.running"]);

    expect(fake.lookups).toEqual(["Example Game"]);
    expect(fake.covers).toEqual([1201270]);
    h.provider.stop();
  });

  it("names a non-Steam app from the store's canonical match", async () => {
    vi.useFakeTimers();
    const fake = fakeStore((name) =>
      name === "Example Game" ? EXAMPLE_MATCH : NO_MATCH,
    );
    const h = harness({
      store: fake.store,
      productName: async () => "Example Game",
    });
    await h.sample(["game.running"]);
    h.emit(h.children[0] as FakeChild, foregroundLine(99, OTHER_EXE, "other"));

    const samples = await h.sample(["game.name", "game.app", "game.running"]);

    expect(fake.lookups).toEqual(["Example Game"]);
    expect(fake.covers).toEqual([]);
    expect(fake.signals[0]).toBeInstanceOf(AbortSignal);
    expect(samples.get("game.name")).toMatchObject({
      status: "ok",
      textValue: "Example Game",
    });
    expect(samples.get("game.app")).toMatchObject({
      status: "ok",
      textValue: "other.exe",
    });
    expect(samples.get("game.running")).toMatchObject({
      status: "ok",
      booleanValue: false,
    });
    h.provider.stop();
  });

  it("searches the executable's file stem when ProductName is absent", async () => {
    vi.useFakeTimers();
    const fake = fakeStore(() => NO_MATCH);
    const h = harness({ store: fake.store });
    await h.sample(["game.running"]);
    h.emit(h.children[0] as FakeChild, foregroundLine(99, OTHER_EXE, "other"));

    const samples = await h.sample(["game.name", "game.app"]);

    expect(fake.lookups).toEqual(["other"]);
    expect(samples.get("game.name")?.status).toBe("unavailable");
    expect(samples.get("game.name")?.textValue).toBeUndefined();
    expect(samples.get("game.name")?.message).toBe(NO_STORE_MATCH_MESSAGE);
    expect(samples.get("game.app")).toMatchObject({
      status: "ok",
      textValue: "other.exe",
    });
    h.provider.stop();
  });

  it("reports an unreachable store as a different reason than no match", async () => {
    vi.useFakeTimers();
    const fake = fakeStore(() => UNAVAILABLE);
    const h = harness({
      store: fake.store,
      productName: async () => "Example Game",
    });
    await h.sample(["game.running"]);
    h.emit(h.children[0] as FakeChild, foregroundLine(99, OTHER_EXE, "other"));

    const samples = await h.sample(["game.name", "game.running", "game.app"]);

    expect(samples.get("game.name")).toMatchObject({
      status: "unavailable",
      message: STORE_UNAVAILABLE_MESSAGE,
    });
    expect(samples.get("game.name")?.message).not.toBe(NO_STORE_MATCH_MESSAGE);
    expect(samples.get("game.running")).toMatchObject({
      status: "ok",
      booleanValue: false,
    });
    expect(samples.get("game.app")).toMatchObject({
      status: "ok",
      textValue: "other.exe",
    });
    h.provider.stop();
  });

  it("serves the store's cover for a matched non-Steam app only on demand", async () => {
    vi.useFakeTimers();
    const fake = fakeStore(
      () => EXAMPLE_MATCH,
      (appId) => `/api/game/artwork/${appId}.jpg`,
    );
    const h = harness({
      store: fake.store,
      productName: async () => "Example Game",
    });
    await h.sample(["game.running"]);
    h.emit(h.children[0] as FakeChild, foregroundLine(99, OTHER_EXE, "other"));

    const samples = await h.sample(["game.artwork"]);

    expect(fake.lookups).toEqual(["Example Game"]);
    expect(fake.covers).toEqual([1201270]);
    expect(samples.get("game.artwork")).toMatchObject({
      status: "ok",
      textValue: "/api/game/artwork/1201270.jpg",
    });
    h.provider.stop();
  });

  it("reports a missing store cover as unavailable with a reason", async () => {
    vi.useFakeTimers();
    const fake = fakeStore(
      () => EXAMPLE_MATCH,
      () => undefined,
    );
    const h = harness({
      store: fake.store,
      productName: async () => "Example Game",
    });
    await h.sample(["game.running"]);
    h.emit(h.children[0] as FakeChild, foregroundLine(99, OTHER_EXE, "other"));

    const samples = await h.sample(["game.artwork"]);

    expect(fake.covers).toEqual([1201270]);
    expect(samples.get("game.artwork")).toMatchObject({
      status: "unavailable",
      message: NO_ARTWORK_MESSAGE,
    });
    expect(samples.get("game.artwork")?.textValue).toBeUndefined();
    h.provider.stop();
  });

  it("falls back to the store's cover when a Steam app has no local art", async () => {
    vi.useFakeTimers();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-game-art-"));
    tempRoots.push(root);
    const fake = fakeStore(() => EXAMPLE_MATCH);
    let productReads = 0;
    const h = harness({
      steamRoot: root,
      apps: [STEAM_APP],
      store: fake.store,
      productName: async () => {
        productReads += 1;
        return "Steam Game";
      },
    });
    await h.sample(["game.running"]);
    h.emit(
      h.children[0] as FakeChild,
      foregroundLine(
        1234,
        "d:\\games\\steam\\steamapps\\common\\half-life\\hl.exe",
        "hl",
      ),
    );

    const samples = await h.sample(["game.artwork"]);

    expect(fake.lookups).toEqual([]);
    expect(fake.covers).toEqual([10]);
    expect(productReads).toBe(0);
    expect(samples.get("game.artwork")).toMatchObject({
      status: "ok",
      textValue: "/api/game/artwork/10.jpg",
    });
    h.provider.stop();
  });

  it("keeps presence available when the store fails", async () => {
    vi.useFakeTimers();
    const store: GameStore = {
      async lookup() {
        throw new Error("offline");
      },
      async cover() {
        throw new Error("offline");
      },
    };
    const h = harness({
      store,
      productName: async () => "Example Game",
    });
    await h.sample(["game.running"]);
    h.emit(h.children[0] as FakeChild, foregroundLine(99, OTHER_EXE, "other"));

    const samples = await h.sample([
      "game.name",
      "game.artwork",
      "game.running",
      "game.app",
    ]);

    expect(samples.get("game.name")).toMatchObject({
      status: "unavailable",
      message: STORE_UNAVAILABLE_MESSAGE,
    });
    expect(samples.get("game.artwork")).toMatchObject({
      status: "unavailable",
      message: NO_ARTWORK_MESSAGE,
    });
    expect(samples.get("game.running")).toMatchObject({
      status: "ok",
      booleanValue: false,
    });
    expect(samples.get("game.app")).toMatchObject({
      status: "ok",
      textValue: "other.exe",
    });
    expect(h.provider.health()).toEqual({ available: true });
    h.provider.stop();
  });
});

describe("GameProvider helper lifecycle", () => {
  it("keeps one helper while the supervisor restarts it", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.sample(["game.running"]);
    expect(h.children).toHaveLength(1);

    (h.children[0] as FakeChild).emit("exit", 1);
    h.advance(500);
    await h.sample(["game.running"]);
    expect(h.children).toHaveLength(1);

    h.advance(600);
    expect(h.children).toHaveLength(2);

    await h.sample(["game.running"]);
    expect(h.children).toHaveLength(2);
    h.provider.stop();
  });

  it("reports a failed helper as unavailable with a redacted reason", async () => {
    vi.useFakeTimers();
    const h = harness({ retryMs: 10_000, failSpawn: true });
    await h.sample(["game.running"]);

    // Five consecutive failed starts: the supervisor's backoff is 1+2+4+8 s.
    h.advance(1_000);
    h.advance(2_000);
    h.advance(4_000);
    h.advance(8_000);
    expect(h.spawnCalls()).toBe(5);

    const health = h.provider.health();
    expect(health.available).toBe(false);
    expect(health.message).toContain("game helper");
    expect(health.message).not.toContain("secret");
    expect(health.message).not.toContain("example.com");

    const samples = await h.sample(["game.running"]);
    expect(samples.get("game.running")?.status).toBe("unavailable");
    expect(samples.get("game.running")?.message).toBe(health.message);
    h.provider.stop();
  });

  it("does not retry a failed helper before the retry boundary", async () => {
    vi.useFakeTimers();
    const h = harness({ retryMs: 10_000, failSpawn: true });
    await h.sample(["game.running"]);

    h.advance(1_000);
    h.advance(2_000);
    h.advance(4_000);
    h.advance(8_000);
    expect(h.spawnCalls()).toBe(5);
    expect(h.provider.health().available).toBe(false);

    h.setFailSpawn(false);
    h.advance(5_000);
    await h.sample(["game.running"]);
    expect(h.spawnCalls()).toBe(5);

    h.advance(5_001);
    await h.sample(["game.running"]);
    expect(h.spawnCalls()).toBe(6);
    expect(h.children).toHaveLength(1);
    h.provider.stop();
  });
});
