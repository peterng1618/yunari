import type { Sample } from "@yunari/renderer-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FRAME_KEYS,
  FrameProvider,
  NO_FRAMES_MESSAGE,
  WAITING_LOW1_MESSAGE,
} from "./provider.js";
import {
  type FrameAdapter,
  type FrameReading,
  parseFrameLine,
  parseFrameUnavailable,
  RTSS_NOT_RUNNING,
  RtssAdapter,
  rtssScript,
} from "./rtss.js";

class FakeAdapter implements FrameAdapter {
  readonly id = "rtss" as const;
  starts = 0;
  stops = 0;
  #onReading: ((reading: FrameReading) => void) | undefined;
  #onUnavailable: ((reason: string) => void) | undefined;

  start(
    onReading: (reading: FrameReading) => void,
    onUnavailable: (reason: string) => void,
  ): () => void {
    this.starts += 1;
    this.#onReading = onReading;
    this.#onUnavailable = onUnavailable;

    return () => {
      this.stops += 1;
    };
  }

  emit(frametimeMs: number, app = ""): void {
    this.#onReading?.({ fps: 1000 / frametimeMs, frametimeMs, app });
  }

  unavailable(reason: string): void {
    this.#onUnavailable?.(reason);
  }
}

interface Harness {
  readonly provider: FrameProvider;
  readonly adapter: FakeAdapter;
  now(): number;
  advance(ms: number): void;
}

function harness(): Harness {
  let now = 0;
  const adapter = new FakeAdapter();
  const provider = new FrameProvider({ now: () => now, adapter });

  return {
    provider,
    adapter,
    now: () => now,
    advance: (ms) => {
      now += ms;
    },
  };
}

async function sample(
  provider: FrameProvider,
  keys: readonly string[],
  atMs: number,
): Promise<Map<string, Sample>> {
  const entries = await provider.sample(keys, atMs);
  return new Map(entries.map((entry) => [entry.semanticKey, entry.sample]));
}

const ALL_KEYS = FRAME_KEYS;

afterEach(() => {
  vi.useRealTimers();
});

describe("FrameProvider descriptors", () => {
  it("uses the vocabulary's labels, units and family for the four keys", async () => {
    const { provider } = harness();
    const descriptors = await provider.describe();

    expect(descriptors.map((descriptor) => descriptor.semanticKey)).toEqual([
      ...FRAME_KEYS,
    ]);
    expect(descriptors.map((descriptor) => descriptor.label)).toEqual([
      "FPS",
      "Frame time",
      "1% low FPS",
      "Game process",
    ]);
    expect(descriptors.map((descriptor) => descriptor.family)).toEqual([
      "frame",
      "frame",
      "frame",
      "frame",
    ]);
    expect(descriptors.map((descriptor) => descriptor.unit)).toEqual([
      "fps",
      "ms",
      "fps",
      undefined,
    ]);
    expect(descriptors.every((d) => d.tier === "extended")).toBe(true);
  });
});

describe("FrameProvider samples", () => {
  it("reports absent data as unavailable, never as zero", async () => {
    const { provider } = harness();
    const samples = await sample(provider, ALL_KEYS, 0);

    for (const key of ALL_KEYS) {
      const reading = samples.get(key);
      expect(reading?.status).toBe("unavailable");
      expect(reading?.value).toBeUndefined();
      expect(reading?.textValue).toBeUndefined();
    }

    expect(samples.get("fps.current")?.message).toBe(NO_FRAMES_MESSAGE);
  });

  it("maps a reading to fps.current, frametime.current and frame.app", async () => {
    const { provider, adapter } = harness();
    await sample(provider, ["fps.current"], 0);
    adapter.emit(10, "game.exe");
    const samples = await sample(provider, ALL_KEYS, 0);

    expect(samples.get("fps.current")).toMatchObject({
      status: "ok",
      value: 100,
      unit: "fps",
    });
    expect(samples.get("frametime.current")).toMatchObject({
      status: "ok",
      value: 10,
      unit: "ms",
    });
    expect(samples.get("frame.app")).toMatchObject({
      status: "ok",
      textValue: "game.exe",
    });
  });

  it("omits frame.app when the active RTSS app has no name", async () => {
    const { provider, adapter } = harness();
    await sample(provider, ["frame.app"], 0);
    adapter.emit(10, "");
    const samples = await sample(provider, ["frame.app"], 0);

    expect(samples.get("frame.app")?.status).toBe("unavailable");
    expect(samples.get("frame.app")?.textValue).toBeUndefined();
  });

  it("withholds fps.low1 until 1000 frames are in the window", async () => {
    const { provider, adapter, advance } = harness();
    await sample(provider, ["fps.low1"], 0);

    for (let i = 0; i < 999; i += 1) {
      advance(1);
      adapter.emit(5);
    }

    const early = await sample(provider, ["fps.low1"], 999);
    expect(early.get("fps.low1")?.status).toBe("unavailable");
    expect(early.get("fps.low1")?.message).toBe(WAITING_LOW1_MESSAGE);

    advance(1);
    adapter.emit(5);

    const late = await sample(provider, ["fps.low1"], 1_000);
    expect(late.get("fps.low1")).toMatchObject({
      status: "ok",
      value: 200,
      unit: "fps",
    });
  });
});

describe("FrameProvider lifetime and unavailability", () => {
  it("does not start the helper when no frame key is demanded", async () => {
    const { provider, adapter } = harness();
    await sample(provider, ["media.title"], 0);

    expect(adapter.starts).toBe(0);
  });

  it("reports RTSS absent once, without retrying every sample", async () => {
    const { provider, adapter, advance } = harness();
    await sample(provider, ["fps.current"], 0);
    adapter.unavailable(RTSS_NOT_RUNNING);

    const first = await sample(provider, ["fps.current"], 0);
    expect(first.get("fps.current")?.status).toBe("unavailable");
    expect(first.get("fps.current")?.message).toContain(
      "RivaTuner Statistics Server",
    );
    expect(provider.health()).toMatchObject({
      available: false,
      message: RTSS_NOT_RUNNING,
    });

    advance(1_000);
    await sample(provider, ["fps.current"], 1_000);
    advance(1_000);
    await sample(provider, ["fps.current"], 2_000);

    expect(adapter.starts).toBe(1);
  });

  it("replaces the reason when the helper reads again after its retry", async () => {
    const { provider, adapter, advance } = harness();
    await sample(provider, ["fps.current"], 0);
    adapter.unavailable(RTSS_NOT_RUNNING);
    await sample(provider, ["fps.current"], 0);

    advance(60_000);
    await sample(provider, ["fps.current"], 60_000);
    expect(adapter.starts).toBe(2);

    adapter.emit(10);
    const readings = await sample(provider, ["fps.current"], 60_000);

    expect(readings.get("fps.current")).toMatchObject({
      status: "ok",
      value: 100,
    });
    expect(provider.health()).toEqual({ available: true });
  });

  it("stops the helper one grace period after the last demand", async () => {
    vi.useFakeTimers();
    const adapter = new FakeAdapter();
    // The tick reads `now()` too, so the clock must advance with the timers.
    const provider = new FrameProvider({ now: () => Date.now(), adapter });
    await sample(provider, ["fps.current"], Date.now());

    expect(adapter.starts).toBe(1);

    vi.advanceTimersByTime(31_000);
    expect(adapter.stops).toBe(1);
    expect(adapter.starts).toBe(1);
  });
});

describe("parseFrameLine", () => {
  it("reads one frame and derives instantaneous FPS", () => {
    expect(
      parseFrameLine('{"kind":"frame","frametimeMs":8.5,"app":"game.exe"}'),
    ).toEqual({ fps: 1000 / 8.5, frametimeMs: 8.5, app: "game.exe" });
  });

  it("reads an absent app as an empty name", () => {
    expect(parseFrameLine('{"kind":"frame","frametimeMs":16}')).toEqual({
      fps: 62.5,
      frametimeMs: 16,
      app: "",
    });
  });

  it("rejects a line that is not a positive frame", () => {
    expect(
      parseFrameLine('{"kind":"frame","frametimeMs":0,"app":"game.exe"}'),
    ).toBeUndefined();
    expect(
      parseFrameLine('{"kind":"frame","frametimeMs":-5,"app":"game.exe"}'),
    ).toBeUndefined();
    expect(
      parseFrameLine('{"kind":"frame","frametimeMs":"8","app":"game.exe"}'),
    ).toBeUndefined();
    expect(
      parseFrameLine('{"kind":"frame","frametimeMs":8,"app":7}'),
    ).toBeUndefined();
    expect(parseFrameLine('{"kind":"idle"}')).toBeUndefined();
    expect(parseFrameLine("not json")).toBeUndefined();
  });
});

describe("parseFrameUnavailable", () => {
  it("reads the reason from an unavailable line only", () => {
    expect(
      parseFrameUnavailable(
        '{"kind":"unavailable","reason":"RivaTuner Statistics Server is not running."}',
      ),
    ).toBe(RTSS_NOT_RUNNING);
    expect(
      parseFrameUnavailable('{"kind":"frame","frametimeMs":8}'),
    ).toBeUndefined();
    expect(parseFrameUnavailable('{"kind":"unavailable"}')).toBeUndefined();
  });
});

describe("rtssScript", () => {
  it("pins the SDK offsets, the mapping name, UTF-8 output and no launch", () => {
    const script = rtssScript();

    expect(script).toContain(
      "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    );
    expect(script).toContain("RTSSSharedMemoryV2");
    expect(script).toContain("$AppProcessId = 0");
    expect(script).toContain("$AppName = 4");
    expect(script).toContain("$AppStatFrameTimeBuf = 924");
    expect(script).toContain("$AppStatFrameTimeBufPos = 5024");
    expect(script).not.toContain("Start-Process");
    expect(script).not.toContain("PresentMon");
  });
});

describe("RtssAdapter", () => {
  it("reports an absent PowerShell and returns a callable stop", () => {
    const reasons: string[] = [];
    const adapter = new RtssAdapter({ pathExists: () => false });

    const stop = adapter.start(
      () => undefined,
      (reason) => reasons.push(reason),
    );

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("PowerShell");
    expect(() => stop()).not.toThrow();
  });
});
