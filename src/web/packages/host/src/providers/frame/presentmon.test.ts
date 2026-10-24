import { describe, expect, it, vi } from "vitest";
import type {
  HelperChild,
  KillTree,
  SpawnProcess,
} from "../helpers/supervisor.js";
import {
  PRESENTMON_ACCESS_DENIED,
  PRESENTMON_ARGS,
  PRESENTMON_MISSING,
  PRESENTMON_SESSION_BUSY,
  parsePresentMonCsv,
  parsePresentMonHeader,
  presentMonAdapter,
} from "./presentmon.js";
import { FRAME_KEYS, FrameProvider } from "./provider.js";
import type { FrameAdapter, FrameReading } from "./rtss.js";

/** The header PresentMon 2.6.0 writes for its default (v1) metric set. */
const HEADER =
  "Application,ProcessID,SwapChainAddress,Runtime,SyncInterval,PresentFlags,Dropped,TimeInSeconds,msInPresentAPI,msBetweenPresents";

const ROW =
  "game.exe,1234,0x0000000000000000,DXGI,1,0,Displayed,12.345,0.5,8.333";

/** A header the parser cannot read is a test failure, never an empty list. */
function columnsOf(header: string): readonly string[] {
  const columns = parsePresentMonHeader(header);
  if (columns === undefined) {
    throw new Error(`not a PresentMon header: ${header}`);
  }
  return columns;
}

describe("parsePresentMonHeader", () => {
  it("reads the names from a real v1 header and rejects a data row", () => {
    expect(parsePresentMonHeader(HEADER)).toEqual([
      "application",
      "processid",
      "swapchainaddress",
      "runtime",
      "syncinterval",
      "presentflags",
      "dropped",
      "timeinseconds",
      "msinpresentapi",
      "msbetweenpresents",
    ]);
    expect(parsePresentMonHeader(ROW)).toBeUndefined();
    expect(parsePresentMonHeader("")).toBeUndefined();
  });
});

describe("parsePresentMonCsv", () => {
  it("parses a data row against the header's column names", () => {
    const columns = columnsOf(HEADER);

    expect(parsePresentMonCsv(ROW, columns)).toEqual({
      frametimeMs: 8.333,
      app: "game.exe",
    });
  });

  it("finds the names in the v2 header spelling too", () => {
    const columns = columnsOf(
      "Application,ProcessID,MsBetweenPresents,msInPresentAPI",
    );

    expect(parsePresentMonCsv("other.exe,7,16.667,0.2", columns)).toEqual({
      frametimeMs: 16.667,
      app: "other.exe",
    });
  });

  it("does not read a v1 row against a v2 header", () => {
    const v2 = columnsOf(
      "Application,ProcessID,MsBetweenPresents,msInPresentAPI",
    );

    // The v2 header's frametime index is where this v1 row carries the
    // swap-chain address (`0x…1F00` = 7936), which is finite and positive.
    // A wrong pairing must be undefined, never 7936 ms.
    expect(
      parsePresentMonCsv(
        "game.exe,1234,0x0000000000001F00,DXGI,1,0,Displayed,12.345,0.5,8.333",
        v2,
      ),
    ).toBeUndefined();
  });

  it("rejects NA, non-numeric and short rows", () => {
    const columns = columnsOf(HEADER);

    expect(parsePresentMonCsv(HEADER, columns)).toBeUndefined();
    expect(
      parsePresentMonCsv(
        "game.exe,1234,0x0,DXGI,1,0,NA,12.345,0.5,NA",
        columns,
      ),
    ).toBeUndefined();
    expect(
      parsePresentMonCsv(
        "game.exe,1234,0x0,DXGI,1,0,Displayed,12.345,0.5,not-a-number",
        columns,
      ),
    ).toBeUndefined();
    expect(parsePresentMonCsv("game.exe,1234,0x0", columns)).toBeUndefined();
    expect(parsePresentMonCsv("", columns)).toBeUndefined();
  });

  it("treats an unknown application as no name", () => {
    const columns = columnsOf(HEADER);

    expect(
      parsePresentMonCsv(
        "<unknown>,1234,0x0,DXGI,1,0,Displayed,12.345,0.5,16.0",
        columns,
      ),
    ).toEqual({ frametimeMs: 16, app: "" });
  });

  it("does not shift columns on a quoted field", () => {
    const columns = columnsOf("Application,ProcessID,msBetweenPresents");

    expect(parsePresentMonCsv('"stats, game.exe",7,8.0', columns)).toEqual({
      frametimeMs: 8,
      app: "stats, game.exe",
    });
  });
});

class FakeStream {
  readonly #listeners: ((chunk: Buffer | string) => void)[] = [];

  on(_event: "data", listener: (chunk: Buffer | string) => void): FakeStream {
    this.#listeners.push(listener);
    return this;
  }

  push(text: string): void {
    for (const listener of this.#listeners) listener(text);
  }
}

class FakeChild {
  readonly pid = 4242;
  readonly stdout = new FakeStream();
  readonly stderr = new FakeStream();
  readonly kill = vi.fn();
  #exit: ((code: number | null) => void) | undefined;
  #error: ((error: Error) => void) | undefined;

  once(event: "exit", listener: (code: number | null) => void): FakeChild;
  once(event: "error", listener: (error: Error) => void): FakeChild;
  once(
    event: "exit" | "error",
    listener: ((code: number | null) => void) | ((error: Error) => void),
  ): FakeChild {
    if (event === "exit") {
      this.#exit = listener as (code: number | null) => void;
    } else {
      this.#error = listener as (error: Error) => void;
    }
    return this;
  }

  exit(code: number | null): void {
    this.#exit?.(code);
  }

  fail(error: Error): void {
    this.#error?.(error);
  }
}

interface AdapterHarness {
  readonly adapter: FrameAdapter;
  readonly children: FakeChild[];
  readonly argv: (readonly string[])[];
  readonly killed: FakeChild[];
  readonly readings: FrameReading[];
  readonly reasons: string[];
  stop(): void;
  restart(): void;
}

function adapterHarness(
  options: { readonly pathExists?: (file: string) => boolean } = {},
): AdapterHarness {
  const children: FakeChild[] = [];
  const argv: (readonly string[])[] = [];
  const killed: FakeChild[] = [];
  const readings: FrameReading[] = [];
  const reasons: string[] = [];

  const spawnProcess: SpawnProcess = (_command, args) => {
    argv.push(args);
    const child = new FakeChild();
    children.push(child);
    return child as unknown as HelperChild;
  };
  const killTree: KillTree = (child) => {
    killed.push(child as unknown as FakeChild);
  };

  const adapter = presentMonAdapter({
    executable: "C:/yunari/vendor/presentmon/PresentMon.exe",
    spawnProcess,
    killTree,
    pathExists: options.pathExists ?? (() => true),
  });

  const start = (): (() => void) =>
    adapter.start(
      (reading) => readings.push(reading),
      (reason) => reasons.push(reason),
    );

  const handle = start();

  return {
    adapter,
    children,
    argv,
    killed,
    readings,
    reasons,
    stop: () => handle(),
    restart: () => {
      start();
    },
  };
}

describe("PresentMon adapter", () => {
  it("passes CSV-on-stdout flags and never a file or a UAC/session flag", () => {
    const { argv } = adapterHarness();

    expect(argv).toHaveLength(1);
    expect(argv[0]).toEqual([...PRESENTMON_ARGS]);
    expect(argv[0]).toContain("--output_stdout");
    expect(argv[0]).toContain("--no_csv");
    expect(argv[0]).not.toContain("--restart_as_admin");
    expect(argv[0]).not.toContain("--stop_existing_session");
  });

  it("reads frame rows from stdout and ignores the header", () => {
    const { children, readings } = adapterHarness();
    const child = children[0];

    child?.stdout.push(`${HEADER}\r\n${ROW}\r\n`);

    expect(readings).toEqual([
      { fps: 1000 / 8.333, frametimeMs: 8.333, app: "game.exe" },
    ]);
  });

  it("keeps a healthy silent capture running past the old timeout", () => {
    vi.useFakeTimers();

    try {
      const harness = adapterHarness();
      const child = harness.children[0];

      // PresentMon writes its header only with the first frame, so a demand
      // window opened before the game starts produces no lines at all. The
      // old one-shot timeout was 15 s; no timer may fire here.
      vi.advanceTimersByTime(60_000);

      expect(harness.reasons).toEqual([]);

      child?.stdout.push(`${HEADER}\r\n${ROW}\r\n`);

      expect(harness.readings).toEqual([
        { fps: 1000 / 8.333, frametimeMs: 8.333, app: "game.exe" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a nonzero exit once and a new demand can start it again", () => {
    const harness = adapterHarness();

    harness.children[0]?.exit(2);

    expect(harness.reasons).toEqual(["PresentMon exited with code 2."]);
    expect(harness.reasons[0]).toContain("exited with code 2");

    harness.restart();

    expect(harness.children).toHaveLength(2);
    expect(harness.argv).toHaveLength(2);
  });

  it("kills the process tree, not just the child, on stop", () => {
    const harness = adapterHarness();
    const child = harness.children[0];

    harness.stop();

    expect(harness.killed).toEqual([child]);
    expect(child?.kill).not.toHaveBeenCalled();
  });

  it("reports a denied trace session once, naming the group", () => {
    const { children, reasons } = adapterHarness();
    const child = children[0];

    child?.stderr.push(
      "error: failed to start trace session: access denied.\r\n" +
        "       PresentMon requires either administrative privileges or to be run by a user in the\r\n" +
        '       "Performance Log Users" user group.  View the readme for more details.\r\n',
    );
    child?.exit(6);

    expect(reasons).toEqual([PRESENTMON_ACCESS_DENIED]);
    expect(reasons[0]).toContain("Performance Log Users");
  });

  it("reports a session name conflict without stopping the other session", () => {
    const { children, reasons } = adapterHarness();

    children[0]?.stderr.push(
      'error: a trace session named "Yunari" is already running.\r\n',
    );
    children[0]?.exit(6);

    expect(reasons).toEqual([PRESENTMON_SESSION_BUSY]);
    expect(reasons[0]).toContain('trace session named "Yunari"');
  });

  it("names the missing vendor step when the executable is absent", () => {
    const harness = adapterHarness({ pathExists: () => false });

    expect(harness.reasons).toEqual([PRESENTMON_MISSING]);
    expect(harness.reasons[0]).toContain("vendor:presentmon");
    expect(harness.children).toHaveLength(0);
  });
});

class FakeAdapter implements FrameAdapter {
  readonly id: "rtss" | "presentmon";
  starts = 0;
  stops = 0;
  #onUnavailable: ((reason: string) => void) | undefined;

  constructor(id: "rtss" | "presentmon") {
    this.id = id;
  }

  start(
    _onReading: (reading: FrameReading) => void,
    onUnavailable: (reason: string) => void,
  ): () => void {
    this.starts += 1;
    this.#onUnavailable = onUnavailable;
    return () => {
      this.stops += 1;
    };
  }

  unavailable(reason: string): void {
    this.#onUnavailable?.(reason);
  }
}

interface ProviderHarness {
  readonly provider: FrameProvider;
  readonly rtss: FakeAdapter;
  readonly presentmon: FakeAdapter;
  advance(ms: number): void;
}

function providerHarness(retryMs = 60_000): ProviderHarness {
  let now = 0;
  const rtss = new FakeAdapter("rtss");
  const presentmon = new FakeAdapter("presentmon");
  const provider = new FrameProvider({
    now: () => now,
    retryMs,
    adapters: [rtss, presentmon],
  });

  return {
    provider,
    rtss,
    presentmon,
    advance: (ms) => {
      now += ms;
    },
  };
}

describe("PresentMon fallback order", () => {
  it("does not start PresentMon while RTSS is reporting", async () => {
    const { provider, rtss, presentmon } = providerHarness();

    await provider.sample(["fps.current"], 0);

    expect(rtss.starts).toBe(1);
    expect(presentmon.starts).toBe(0);
  });

  it("starts PresentMon when RTSS is unavailable", async () => {
    const { provider, rtss, presentmon } = providerHarness();

    await provider.sample(["fps.current"], 0);
    rtss.unavailable("RivaTuner Statistics Server is not running.");

    expect(rtss.starts).toBe(1);
    expect(presentmon.starts).toBe(1);
  });

  it("allows a new start at the next demand boundary after PresentMon exits", async () => {
    const { provider, rtss, presentmon, advance } = providerHarness();

    await provider.sample(["fps.current"], 0);
    rtss.unavailable("RivaTuner Statistics Server is not running.");
    presentmon.unavailable("PresentMon exited with code 2.");

    advance(5_000);
    await provider.sample(["fps.current"], 5_000);
    expect(rtss.starts).toBe(1);
    expect(presentmon.starts).toBe(1);

    advance(31_000);
    await provider.sample(["fps.current"], 36_000);
    expect(rtss.starts).toBe(2);
  });

  it("keeps a denied PresentMon session until the next demand window", async () => {
    const { provider, rtss, presentmon, advance } = providerHarness();

    await provider.sample(FRAME_KEYS, 0);
    rtss.unavailable("RivaTuner Statistics Server is not running.");
    presentmon.unavailable(PRESENTMON_ACCESS_DENIED);

    const denied = await provider.sample(FRAME_KEYS, 0);
    expect(denied[0]?.sample.message).toContain("Performance Log Users");

    advance(5_000);
    await provider.sample(FRAME_KEYS, 5_000);
    expect(rtss.starts).toBe(1);
    expect(presentmon.starts).toBe(1);

    // No demand for longer than the grace period ends the window; the next
    // demand starts again with RTSS rather than the denied PresentMon.
    advance(31_000);
    await provider.sample(FRAME_KEYS, 36_000);
    expect(rtss.starts).toBe(2);
    expect(presentmon.starts).toBe(1);
  });
});
