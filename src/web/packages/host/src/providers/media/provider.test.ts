import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Sample } from "@yunari/renderer-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HelperChild, SpawnProcess } from "../helpers/supervisor.js";
import {
  ARTWORK_NAME,
  type ArtworkCache,
  createArtworkCache,
  sniffArtworkExtension,
} from "./artwork.js";
import {
  MEDIA_PROVIDER_KEYS,
  MediaProvider,
  NO_SESSION_MESSAGE,
} from "./provider.js";
import {
  parseSmtcAudio,
  smtcScript,
  smtcSessionIsCurrent,
} from "./smtc-helper.js";

class FakeChild extends EventEmitter {
  readonly pid: number;
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();

  constructor(pid: number) {
    super();
    this.pid = pid;
  }
}

/** The script a `-EncodedCommand` argument carries. */
function decodedScript(args: readonly string[]): string {
  const index = args.indexOf("-EncodedCommand");
  const encoded = index === -1 ? "" : (args[index + 1] ?? "");
  return Buffer.from(encoded, "base64").toString("utf16le");
}

interface Harness {
  readonly provider: MediaProvider;
  readonly cache: ArtworkCache;
  readonly directory: string;
  readonly children: FakeChild[];
  readonly scripts: string[];
  readonly killed: FakeChild[];
  readonly now: () => number;
  advance(ms: number): void;
  setPathExists(exists: boolean): void;
  emit(child: FakeChild, line: string): void;
  sample(keys: readonly string[]): Promise<Map<string, Sample>>;
}

function sessionLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    kind: "session",
    app: "Spotify.exe",
    sessionId: "Spotify.exe",
    title: "Track",
    artist: "Artist",
    album: "Album",
    state: "playing",
    current: true,
    positionS: 12.5,
    durationS: 200,
    ...overrides,
  });
}

const ARTWORK_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const ARTWORK_SHA = createHash("sha256").update(ARTWORK_BYTES).digest("hex");

/** Every directory a harness made, removed after the case that made it. */
const directories: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

function artworkLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    kind: "artwork",
    sessionId: "Spotify.exe",
    sha256: ARTWORK_SHA,
    ext: "png",
    base64: Buffer.from(ARTWORK_BYTES).toString("base64"),
    ...overrides,
  });
}

interface HarnessOptions {
  readonly graceMs?: number;
  readonly retryMs?: number;
  readonly pathExists?: boolean;
}

function harness(options: HarnessOptions = {}): Harness {
  const children: FakeChild[] = [];
  const scripts: string[] = [];
  const killed: FakeChild[] = [];
  let pid = 500;
  let nowMs = 1_000_000;
  let pathExists = options.pathExists ?? true;

  const spawnProcess: SpawnProcess = (_command, args) => {
    const child = new FakeChild(pid);
    pid += 1;
    scripts.push(decodedScript(args));
    children.push(child);
    return child as unknown as HelperChild;
  };

  const directory = path.join(
    os.tmpdir(),
    `yunari-media-test-${pid}-${Date.now()}`,
  );
  directories.push(directory);
  const cache = createArtworkCache(directory);

  const provider = new MediaProvider({
    cache,
    now: () => nowMs,
    graceMs: options.graceMs ?? 60_000,
    retryMs: options.retryMs ?? 10_000,
    spawnProcess,
    killTree: (child) => killed.push(child as unknown as FakeChild),
    pathExists: () => pathExists,
  });

  return {
    provider,
    cache,
    directory,
    children,
    scripts,
    killed,
    now: () => nowMs,
    advance(ms) {
      nowMs += ms;
      vi.advanceTimersByTime(ms);
    },
    setPathExists(exists) {
      pathExists = exists;
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

describe("createArtworkCache", () => {
  function tempDirectory(): string {
    const directory = fsSync.mkdtempSync(
      path.join(os.tmpdir(), "yunari-artwork-test-"),
    );
    directories.push(directory);
    return directory;
  }

  function pngOf(marker: number): Uint8Array {
    return new Uint8Array([0x89, 0x50, 0x4e, 0x47, marker, 0, 0, 0]);
  }

  function nameOf(bytes: Uint8Array): string {
    return `${createHash("sha256").update(bytes).digest("hex")}.png`;
  }

  it("puts the same bytes on one file and one URL", async () => {
    const directory = tempDirectory();
    const cache = createArtworkCache(directory);

    const first = await cache.put(pngOf(1), "png");
    const second = await cache.put(pngOf(1), "png");

    expect(second).toBe(first);
    expect(fsSync.readdirSync(directory)).toEqual([nameOf(pngOf(1))]);
  });

  it("names the file after the sniffed format, not the caller's claim", async () => {
    const directory = tempDirectory();
    const cache = createArtworkCache(directory);
    const bytes = pngOf(1);

    const url = await cache.put(bytes, "jpg");

    expect(url).toBe(`/api/media/artwork/${nameOf(bytes)}`);

    const webp = new Uint8Array(
      Buffer.concat([
        Buffer.from("RIFF"),
        Buffer.from([4, 0, 0, 0]),
        Buffer.from("WEBP"),
      ]),
    );
    expect(sniffArtworkExtension(webp)).toBe("webp");
  });

  it("refuses bytes that are not an image", async () => {
    const cache = createArtworkCache(tempDirectory());
    await expect(cache.put(new Uint8Array([1, 2, 3]), "png")).rejects.toThrow();
  });

  it("sweeps an interrupted write's stale scratch file", async () => {
    const directory = tempDirectory();
    const cache = createArtworkCache(directory);
    await cache.put(pngOf(1), "png");

    const stale = path.join(
      directory,
      `.${nameOf(pngOf(2))}.123.${Date.now() - 120_000}.tmp`,
    );
    fsSync.writeFileSync(stale, pngOf(2));
    const old = new Date(Date.now() - 120_000);
    fsSync.utimesSync(stale, old, old);

    const recent = path.join(
      directory,
      `.${nameOf(pngOf(3))}.123.${Date.now()}.tmp`,
    );
    fsSync.writeFileSync(recent, pngOf(3));

    await cache.put(pngOf(4), "png");

    expect(fsSync.existsSync(stale)).toBe(false);
    // A write still inside the stale window may be another process's.
    expect(fsSync.existsSync(recent)).toBe(true);
  });

  it("refuses a name whose extension does not describe the bytes", async () => {
    const directory = tempDirectory();
    const cache = createArtworkCache(directory);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0]);
    const name = `${createHash("sha256").update(jpeg).digest("hex")}.png`;

    fsSync.writeFileSync(path.join(directory, name), jpeg);

    expect(await cache.read(name)).toBeUndefined();
  });

  it("evicts the oldest beyond the cap", async () => {
    const directory = tempDirectory();
    const cache = createArtworkCache(directory, 2);

    for (const marker of [1, 2, 3]) {
      const bytes = pngOf(marker);
      await cache.put(bytes, "png");
      const file = path.join(directory, nameOf(bytes));
      // Distinct mtimes, so "oldest" is a fact of the case rather than of
      // filesystem timestamp resolution.
      fsSync.utimesSync(file, marker * 10, marker * 10);
    }

    expect(fsSync.readdirSync(directory).sort()).toEqual(
      [nameOf(pngOf(2)), nameOf(pngOf(3))].sort(),
    );
  });

  it("refuses a name outside the allow-list and bytes that do not match it", async () => {
    const directory = tempDirectory();
    const cache = createArtworkCache(directory);
    const bytes = pngOf(1);
    const name = nameOf(bytes);
    await cache.put(bytes, "png");

    for (const bad of [
      "a.png",
      name.toUpperCase(),
      `${name}.png`,
      "../x.png",
      name.replace(".png", ".gif"),
    ]) {
      expect(await cache.read(bad), bad).toBeUndefined();
    }

    // A replaced file is an absence, not the previous picture.
    fsSync.writeFileSync(path.join(directory, name), pngOf(2));
    expect(await cache.read(name)).toBeUndefined();
    expect(ARTWORK_NAME.test(name)).toBe(true);
  });
});

describe("MediaProvider descriptors and script", () => {
  it("describes media and audio keys from the vocabulary", async () => {
    const { provider } = harness();
    const descriptors = await provider.describe();

    expect(descriptors.map((entry) => entry.semanticKey)).toEqual([
      ...MEDIA_PROVIDER_KEYS,
    ]);

    const artwork = descriptors.find(
      (entry) => entry.semanticKey === "media.artwork",
    );
    expect(artwork?.mediaKind).toBe("image");
    expect(artwork?.unit).toBeUndefined();

    const title = descriptors.find(
      (entry) => entry.semanticKey === "media.title",
    );
    expect(title?.valueKind).toBe("text");

    const volume = descriptors.find(
      (entry) => entry.semanticKey === "audio.volume",
    );
    expect(volume).toMatchObject({ unit: "%", unitKind: "percent" });
  });

  it("reads the endpoint volume and mute in the same script as the poll", () => {
    const script = smtcScript();

    // The interop decision 0103's probe pinned.
    expect(script).toContain("BCDE0395-E52F-467C-8E3D-C4579291692E");
    expect(script).toContain("5CDF2C82-841E-4546-9722-0CF74078229A");
    expect(script).toContain("GetMasterVolumeLevelScalar");
    expect(script).toContain("GetMute");
    // eRender (0), not eCapture (1): this is the speaker level, not a
    // microphone gain. Swapping the dataflow back must red this case.
    expect(script).toContain("GetDefaultAudioEndpoint(0,1,");
    expect(script).not.toContain("GetDefaultAudioEndpoint(1,1,");
    // The display name is looked up without a prompt; the AUMID is the
    // fallback when the app registered none.
    expect(script).toContain("app = Get-AppName $session.SourceAppUserModelId");
    expect(script).toContain(
      "HKCU:\\Software\\Classes\\AppUserModelId\\$aumid",
    );
    // Emitted every poll, before the session list is touched.
    expect(script.indexOf("Get-AudioLine | ConvertTo-Json")).toBeGreaterThan(
      -1,
    );
    expect(script.indexOf("Get-AudioLine | ConvertTo-Json")).toBeLessThan(
      script.indexOf("GetSessions()"),
    );
  });

  it("keeps the artwork script inside one Windows command line", () => {
    // The supervisor passes the whole script as -EncodedCommand (UTF-16LE
    // base64), and CreateProcess caps the command line near 32k characters.
    const encoded = Buffer.from(
      smtcScript({ artwork: true }),
      "utf16le",
    ).toString("base64").length;
    expect(encoded).toBeLessThan(32_000);
  });
});

describe("parseSmtcAudio", () => {
  it("reads both keys, or neither when the endpoint is absent", () => {
    expect(
      parseSmtcAudio('{"kind":"audio","volume":42,"muted":false}'),
    ).toEqual({
      volume: 42,
      muted: false,
    });
    expect(parseSmtcAudio('{"kind":"audio"}')).toEqual({});
  });

  it("refuses a half reading, an out-of-range level and garbage", () => {
    for (const line of [
      '{"kind":"audio","volume":42}',
      '{"kind":"audio","muted":true}',
      '{"kind":"audio","volume":101,"muted":false}',
      '{"kind":"audio","volume":-1,"muted":false}',
      '{"kind":"audio","volume":"42","muted":false}',
      '{"kind":"audio","volume":42,"muted":"false"}',
      '{"kind":"session"}',
      "not json",
    ]) {
      expect(parseSmtcAudio(line), line).toBeUndefined();
    }
  });
});

describe("smtcSessionIsCurrent", () => {
  it("reads only a session line marked current", () => {
    expect(smtcSessionIsCurrent(sessionLine({ current: true }))).toBe(true);
    expect(smtcSessionIsCurrent(sessionLine({ current: false }))).toBe(false);
    expect(smtcSessionIsCurrent('{"kind":"audio","current":true}')).toBe(false);
    expect(smtcSessionIsCurrent("not json")).toBe(false);
  });
});

describe("MediaProvider selection and samples", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("selects a playing session over a current paused one", async () => {
    const device = harness();
    await device.sample(["media.title"]);

    const paused = device.children[0] as FakeChild;
    device.emit(
      paused,
      sessionLine({
        sessionId: "Chrome",
        title: "Paused",
        state: "paused",
        current: true,
      }),
    );
    device.emit(
      paused,
      sessionLine({
        sessionId: "Spotify.exe",
        title: "Playing",
        state: "playing",
        current: false,
      }),
    );

    expect(
      (await device.sample(["media.title"])).get("media.title"),
    ).toMatchObject({
      status: "ok",
      textValue: "Playing",
    });
  });

  it("falls back to the current session when nothing is playing", async () => {
    const device = harness();
    await device.sample(["media.title"]);

    const child = device.children[0] as FakeChild;
    device.emit(
      child,
      sessionLine({
        sessionId: "Chrome",
        title: "Other",
        state: "paused",
        current: false,
      }),
    );
    device.emit(
      child,
      sessionLine({
        sessionId: "Spotify.exe",
        title: "Current",
        state: "paused",
        current: true,
      }),
    );

    expect(
      (await device.sample(["media.title"])).get("media.title"),
    ).toMatchObject({
      textValue: "Current",
    });
  });

  it("reports unavailable with a reason and no position when no session exists", async () => {
    const device = harness();
    await device.sample(["media.position", "media.title"]);

    const child = device.children[0] as FakeChild;
    device.emit(child, '{"kind":"none"}');

    const entries = await device.sample(["media.position", "media.title"]);
    const position = entries.get("media.position");

    expect(position?.status).toBe("unavailable");
    expect(position?.message).toBe(NO_SESSION_MESSAGE);
    // A gap, never 0: the provider has no measurement to report.
    expect(position?.value).toBeUndefined();
    expect(entries.get("media.title")?.value).toBeUndefined();
  });

  it("reports position and duration in seconds and a known state", async () => {
    const device = harness();
    await device.sample(["media.position"]);

    const child = device.children[0] as FakeChild;
    device.emit(
      child,
      sessionLine({ positionS: 12.5, durationS: 200, state: "playing" }),
    );

    const entries = await device.sample([
      "media.position",
      "media.duration",
      "media.state",
    ]);

    expect(entries.get("media.position")).toMatchObject({
      status: "ok",
      value: 12.5,
      unit: "s",
    });
    expect(entries.get("media.duration")).toMatchObject({
      status: "ok",
      value: 200,
      unit: "s",
    });
    expect(entries.get("media.state")).toMatchObject({
      status: "ok",
      textValue: "playing",
    });
  });

  it("reports the helper's display name, falling back to the AUMID", async () => {
    const device = harness();
    await device.sample(["media.app"]);

    const child = device.children[0] as FakeChild;
    device.emit(
      child,
      sessionLine({ sessionId: "Spotify.exe", app: "Spotify" }),
    );

    expect((await device.sample(["media.app"])).get("media.app")).toMatchObject(
      { status: "ok", textValue: "Spotify" },
    );
  });

  it("reports audio with no media session, and media stays unavailable", async () => {
    const device = harness();
    await device.sample(["audio.volume"]);

    const child = device.children[0] as FakeChild;
    device.emit(child, '{"kind":"none"}');
    device.emit(child, '{"kind":"audio","volume":42,"muted":true}');

    const entries = await device.sample([
      "audio.volume",
      "audio.muted",
      "media.title",
    ]);

    expect(entries.get("audio.volume")).toMatchObject({
      status: "ok",
      value: 42,
      unit: "%",
    });
    expect(entries.get("audio.muted")).toMatchObject({
      status: "ok",
      booleanValue: true,
    });
    expect(entries.get("media.title")?.status).toBe("unavailable");
  });

  it("reports an absent endpoint as unavailable, never zero or unmuted", async () => {
    const device = harness();
    await device.sample(["audio.volume"]);

    const child = device.children[0] as FakeChild;
    device.emit(child, '{"kind":"audio"}');

    const entries = await device.sample(["audio.volume", "audio.muted"]);
    const volume = entries.get("audio.volume");
    const muted = entries.get("audio.muted");

    expect(volume?.status).toBe("unavailable");
    expect(volume?.value).toBeUndefined();
    expect(muted?.status).toBe("unavailable");
    expect(muted?.booleanValue).toBeUndefined();
  });
});

describe("MediaProvider artwork", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("spawns the artwork half only when media.artwork is demanded", async () => {
    const device = harness();
    await device.sample(["media.title"]);

    // The plain script pays for no thumbnail decode.
    expect(device.scripts[0]).not.toContain("DataReader");

    await device.sample(["media.title", "media.artwork"]);

    // Demand turned on: the script is fixed at spawn, so this is a restart.
    expect(device.killed).toHaveLength(1);
    expect(device.scripts).toHaveLength(2);
    expect(device.scripts[1]).toContain("DataReader");

    // The same track re-polling does not restart anything.
    device.emit(device.children[1] as FakeChild, sessionLine());
    await device.sample(["media.title", "media.artwork"]);
    expect(device.children).toHaveLength(2);
  });

  it("serves the stored artwork URL and drops it when the track changes", async () => {
    const device = harness();
    await device.sample(["media.artwork"]);

    const child = device.children[0] as FakeChild;
    device.emit(child, sessionLine({ title: "Track A" }));
    device.emit(child, artworkLine());

    const first = (await device.sample(["media.artwork"])).get("media.artwork");
    expect(first?.status).toBe("ok");
    expect(first?.textValue).toBe(`/api/media/artwork/${ARTWORK_SHA}.png`);

    const name = `${ARTWORK_SHA}.png`;
    expect(await device.cache.read(name)).toMatchObject({ ext: "png" });

    device.emit(child, sessionLine({ title: "Track B" }));
    const second = (await device.sample(["media.artwork"])).get(
      "media.artwork",
    );
    expect(second?.status).toBe("missing");
    expect(second?.textValue).toBeUndefined();
  });

  it("refuses another session's artwork under the selected track", async () => {
    const device = harness();
    await device.sample(["media.artwork"]);

    const child = device.children[0] as FakeChild;
    // Spotify is playing and selected; Chrome is paused.
    device.emit(
      child,
      sessionLine({
        sessionId: "Spotify.exe",
        app: "Spotify",
        title: "Selected track",
        state: "playing",
        current: false,
      }),
    );
    device.emit(
      child,
      sessionLine({
        sessionId: "Chrome",
        app: "Chrome",
        title: "Other tab",
        state: "paused",
        current: true,
      }),
    );

    const otherBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 7, 7, 7, 7]);
    const otherSha = createHash("sha256").update(otherBytes).digest("hex");
    device.emit(
      child,
      artworkLine({
        sessionId: "Chrome",
        sha256: otherSha,
        base64: Buffer.from(otherBytes).toString("base64"),
      }),
    );

    // Chrome's picture must not become Spotify's URL.
    expect(
      (await device.sample(["media.artwork"])).get("media.artwork")?.textValue,
    ).toBeUndefined();

    device.emit(child, artworkLine());
    expect(
      (await device.sample(["media.artwork"])).get("media.artwork")?.textValue,
    ).toBe(`/api/media/artwork/${ARTWORK_SHA}.png`);
  });

  it("restarts without the artwork half once its demand grace expires", async () => {
    const device = harness({ graceMs: 5_000 });
    await device.sample(["media.title", "media.artwork"]);
    expect(device.scripts[0]).toContain("DataReader");

    // Metadata keeps being demanded, so the helper is alive; only artwork's
    // own demand window runs out.
    device.advance(4_000);
    await device.sample(["media.title"]);
    expect(device.killed).toHaveLength(0);

    device.advance(1_500);
    await device.sample(["media.title"]);

    expect(device.killed).toHaveLength(1);
    expect(device.scripts).toHaveLength(2);
    expect(device.scripts[1]).not.toContain("DataReader");
  });
});

describe("MediaProvider lifetime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("stops after the demand grace and starts again on the next demand", async () => {
    const device = harness({ graceMs: 5_000 });
    await device.sample(["media.title"]);
    expect(device.children).toHaveLength(1);

    device.advance(4_000);
    expect(device.killed).toHaveLength(0);

    device.advance(2_000);
    expect(device.killed).toHaveLength(1);

    await device.sample(["media.title"]);
    expect(device.children).toHaveLength(2);
  });

  it("stops the helper for host shutdown and starts again on later demand", async () => {
    const device = harness();
    await device.sample(["media.title"]);
    expect(device.children).toHaveLength(1);

    device.provider.stop();

    // Stop reaches the supervisor, which is the only thing that tree-kills the
    // PowerShell child.
    expect(device.killed).toHaveLength(1);

    // Shutdown is a teardown, not a disable: a later demand starts a new one.
    await device.sample(["media.title"]);
    expect(device.children).toHaveLength(2);
  });

  it("does not spin when PowerShell is missing, and retries after its backoff", async () => {
    const device = harness({ retryMs: 10_000, pathExists: false });

    await device.sample(["media.title"]);
    expect(device.children).toHaveLength(0);
    expect(device.provider.health().available).toBe(false);

    // Inside the backoff, demand does not start another attempt even when
    // PowerShell would now be found.
    device.setPathExists(true);
    await device.sample(["media.title"]);
    expect(device.children).toHaveLength(0);

    device.advance(10_000);
    await device.sample(["media.title"]);
    expect(device.children).toHaveLength(1);
  });

  it("redacts a helper's failure before it can reach a display", async () => {
    const device = harness({ retryMs: 60_000 });
    await device.sample(["media.title"]);

    // Five consecutive failed starts are what the supervisor gives up after.
    const delays = [1_000, 2_000, 4_000, 8_000];
    for (const delay of delays) {
      const child = device.children.at(-1) as FakeChild;
      child.stderr.emit("data", "C:\\Users\\peter\\secret\\media.ps1\n");
      child.emit("exit", 1);
      device.advance(delay);
    }
    const last = device.children.at(-1) as FakeChild;
    last.stderr.emit("data", "C:\\Users\\peter\\secret\\media.ps1\n");
    last.emit("exit", 1);

    const health = device.provider.health();
    expect(health.available).toBe(false);
    expect(health.message).not.toContain("peter");
    expect(health.message).not.toContain("secret");
    expect(health.message).not.toContain("C:\\");
  });
});
