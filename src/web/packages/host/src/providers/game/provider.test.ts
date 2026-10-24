import { EventEmitter } from "node:events";
import type { Sample } from "@yunari/renderer-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseForegroundLine } from "../helpers/foreground.js";
import type { HelperChild, SpawnProcess } from "../helpers/supervisor.js";
import {
  GAME_KEYS,
  GameProvider,
  NO_ARTWORK_MESSAGE,
  NO_GAME_MESSAGE,
} from "./provider.js";
import type { SteamApp } from "./steam-library.js";

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
}

interface Harness {
  readonly provider: GameProvider;
  readonly children: FakeChild[];
  readonly killed: FakeChild[];
  readonly scripts: string[];
  readonly now: () => number;
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

  const spawnProcess: SpawnProcess = (_command, args) => {
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
    spawnProcess,
    killTree: (child) => killed.push(child as unknown as FakeChild),
    pathExists: () => true,
    steamRoot: async () => options.steamRoot,
    loadSteamApps: async () => options.apps ?? [],
  });

  return {
    provider,
    children,
    killed,
    scripts,
    now: () => nowMs,
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
): string {
  return JSON.stringify({ kind: "foreground", pid: pidValue, path, name });
}

const STEAM_APP: SteamApp = {
  appId: "10",
  name: "Counter-Strike",
  installDir: "D:\\Games\\Steam\\steamapps\\common\\Half-Life",
};

afterEach(() => {
  vi.useRealTimers();
});

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
      booleanValue: true,
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

  it("keeps artwork declared but absent until task 6.4", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.sample(["game.running"]);
    h.emit(h.children[0] as FakeChild, '{"kind":"foreground","pid":0}');

    const samples = await h.sample(["game.artwork"]);

    expect(samples.get("game.artwork")).toMatchObject({
      status: "missing",
      message: NO_ARTWORK_MESSAGE,
    });
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
      booleanValue: true,
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
