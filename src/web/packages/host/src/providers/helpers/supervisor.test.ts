import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type HelperChild,
  type HelperExitKind,
  type SpawnProcess,
  startJsonLineHelper,
} from "./supervisor.js";

/** A child process that never exists: stdout, stderr and exit are all driven
 *  by the test, so no helper is ever launched. */
class FakeChild extends EventEmitter {
  readonly pid: number;
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();

  constructor(pid: number) {
    super();
    this.pid = pid;
  }
}

function fakeSpawner(): {
  spawnProcess: SpawnProcess;
  children: FakeChild[];
  commands: string[][];
} {
  const children: FakeChild[] = [];
  const commands: string[][] = [];
  let pid = 100;

  return {
    children,
    commands,
    spawnProcess: ((command: string, args: readonly string[]) => {
      commands.push([command, ...args]);
      const child = new FakeChild(pid);
      pid += 1;
      children.push(child);
      return child as unknown as HelperChild;
    }) as SpawnProcess,
  };
}

function helper(
  spawnProcess: SpawnProcess,
  overrides: Partial<Parameters<typeof startJsonLineHelper>[0]> = {},
): ReturnType<typeof startJsonLineHelper> {
  return startJsonLineHelper({
    id: "test",
    script: "Write-Output '{}'",
    onLine: () => undefined,
    onExit: () => undefined,
    pathExists: () => true,
    spawnProcess,
    ...overrides,
  });
}

function exitKind(onExit: ReturnType<typeof vi.fn>, call = 0): HelperExitKind {
  return onExit.mock.calls[call]?.[1] as HelperExitKind;
}

describe("startJsonLineHelper", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports an absent PowerShell without spawning anything", () => {
    const { spawnProcess, children } = fakeSpawner();
    const onExit = vi.fn();

    const handle = helper(spawnProcess, {
      pathExists: () => false,
      onExit,
    });

    expect(children).toHaveLength(0);
    expect(handle.pid).toBeUndefined();
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(String(onExit.mock.calls[0]?.[0])).toMatch(
      /PowerShell was not found/,
    );
    expect(exitKind(onExit)).toBe("unavailable");
  });

  it("spawns the explicit executable with an encoded UTF-16LE script", () => {
    const { spawnProcess, commands, children } = fakeSpawner();
    const script = "Write-Output 'hello'";

    const handle = helper(spawnProcess, { script });

    expect(children).toHaveLength(1);
    expect(handle.pid).toBe(100);

    const [command, ...args] = commands[0] ?? [];
    expect(String(command)).toMatch(
      /WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/,
    );
    expect(args.slice(0, 4)).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
    ]);

    const encoded = args[args.indexOf("-EncodedCommand") + 1] ?? "";
    expect(Buffer.from(encoded, "base64").toString("utf16le")).toBe(script);
  });

  it("splits stdout on CRLF and LF, including a delimiter split across chunks", () => {
    const { spawnProcess, children } = fakeSpawner();
    const onLine = vi.fn();

    helper(spawnProcess, { onLine });

    children[0]?.stdout.emit("data", "one\r");
    children[0]?.stdout.emit("data", "\ntwo\nthree");

    expect(onLine.mock.calls.map(([line]) => line)).toEqual(["one", "two"]);

    children[0]?.stdout.emit("data", "\n");

    expect(onLine.mock.calls.map(([line]) => line)).toEqual([
      "one",
      "two",
      "three",
    ]);
  });

  it("passes a line at exactly 1 MiB and drops one over it", () => {
    const { spawnProcess, children } = fakeSpawner();
    const onLine = vi.fn();
    const onProblem = vi.fn();

    helper(spawnProcess, {
      onLine,
      onProblem,
      killTree: vi.fn(),
    });

    const atCap = "a".repeat(1_048_576);
    children[0]?.stdout.emit("data", `${atCap}\n`);
    expect(onLine).toHaveBeenCalledWith(atCap);
    expect(onProblem).not.toHaveBeenCalled();

    children[0]?.stdout.emit("data", `${"b".repeat(1_048_577)}\n`);
    expect(onLine).toHaveBeenCalledTimes(1);
    expect(onProblem).toHaveBeenCalledTimes(1);
  });

  it("drops an over-cap line without a newline and never buffers it", () => {
    const { spawnProcess, children } = fakeSpawner();
    const onLine = vi.fn();
    const onProblem = vi.fn();

    helper(spawnProcess, { onLine, onProblem, killTree: vi.fn() });

    children[0]?.stdout.emit("data", "x".repeat(1_048_577));
    expect(onLine).not.toHaveBeenCalled();
    expect(onProblem).toHaveBeenCalledTimes(1);

    // The rest of the dropped line, however it is chunked, stays dropped.
    children[0]?.stdout.emit("data", "tail");
    children[0]?.stdout.emit("data", "\n");
    expect(onLine).not.toHaveBeenCalled();

    children[0]?.stdout.emit("data", "ok\n");
    expect(onLine).toHaveBeenCalledWith("ok");
    expect(onProblem).toHaveBeenCalledTimes(1);
  });

  it("restarts after strictly increasing delays and gives up after five", () => {
    const { spawnProcess, children } = fakeSpawner();
    const onExit = vi.fn();

    helper(spawnProcess, { onExit, killTree: vi.fn() });
    expect(children).toHaveLength(1);

    // Failure one restarts after 1 s, two after 2 s, three after 4 s, four
    // after 8 s; each boundary is checked just before it lands.
    children[0]?.emit("exit", 1);
    vi.advanceTimersByTime(999);
    expect(children).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(children).toHaveLength(2);

    children[1]?.emit("exit", 1);
    vi.advanceTimersByTime(1_999);
    expect(children).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(children).toHaveLength(3);

    children[2]?.emit("exit", 1);
    vi.advanceTimersByTime(3_999);
    expect(children).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(children).toHaveLength(4);

    children[3]?.emit("exit", 1);
    vi.advanceTimersByTime(7_999);
    expect(children).toHaveLength(4);
    vi.advanceTimersByTime(1);
    expect(children).toHaveLength(5);

    // The fifth failure gives up instead of scheduling a sixth start.
    children[4]?.emit("exit", 1);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(String(onExit.mock.calls[0]?.[0])).toMatch(/after 5 failed starts/);
    expect(exitKind(onExit)).toBe("failed");

    vi.advanceTimersByTime(120_000);
    expect(children).toHaveLength(5);
  });

  it("reaches the 60 s backoff cap when maxAttempts is raised", () => {
    const { spawnProcess, children } = fakeSpawner();

    helper(spawnProcess, { maxAttempts: 8, killTree: vi.fn() });

    // Attempts one to six schedule 1, 2, 4, 8, 16 and 32 s.
    for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 32_000]) {
      children.at(-1)?.emit("exit", 1);
      vi.advanceTimersByTime(delay - 1);
      const before = children.length;
      vi.advanceTimersByTime(1);
      expect(children.length).toBe(before + 1);
    }

    // The seventh would schedule 64 s; the cap makes it exactly 60.
    children.at(-1)?.emit("exit", 1);
    vi.advanceTimersByTime(59_999);
    expect(children).toHaveLength(7);
    vi.advanceTimersByTime(1);
    expect(children).toHaveLength(8);
  });

  it("resets the attempt count after thirty seconds of running", () => {
    const { spawnProcess, children } = fakeSpawner();

    helper(spawnProcess, { killTree: vi.fn() });

    children[0]?.emit("exit", 1);
    vi.advanceTimersByTime(1_000);
    expect(children).toHaveLength(2);

    vi.advanceTimersByTime(30_000);

    children[1]?.emit("exit", 1);
    vi.advanceTimersByTime(999);
    expect(children).toHaveLength(2);
    vi.advanceTimersByTime(1);
    // A reset count restarts at one second, not at the second attempt's two.
    expect(children).toHaveLength(3);
  });

  it("stop kills the tree, reports a stop and ignores a late chunk", () => {
    const { spawnProcess, children } = fakeSpawner();
    const killTree = vi.fn();
    const onExit = vi.fn();
    const onLine = vi.fn();
    const onProblem = vi.fn();

    const handle = helper(spawnProcess, {
      killTree,
      onExit,
      onLine,
      onProblem,
    });

    handle.stop();
    handle.stop();

    expect(killTree).toHaveBeenCalledTimes(1);
    expect(killTree).toHaveBeenCalledWith(children[0]);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(String(onExit.mock.calls[0]?.[0])).toMatch(/stopped/);
    expect(exitKind(onExit)).toBe("stopped");
    expect(handle.pid).toBeUndefined();

    // A chunk already in flight must not reach a stopped consumer.
    children[0]?.stdout.emit("data", "late\n");
    expect(onLine).not.toHaveBeenCalled();
    expect(onProblem).not.toHaveBeenCalled();

    children[0]?.emit("exit", 1);
    vi.advanceTimersByTime(120_000);

    expect(children).toHaveLength(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("stop clears an armed restart timer", () => {
    const { spawnProcess, children } = fakeSpawner();
    const killTree = vi.fn();
    const onExit = vi.fn();

    const handle = helper(spawnProcess, { killTree, onExit });

    // A failure arms the 1 s restart and leaves no live child.
    children[0]?.emit("exit", 1);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    handle.stop();

    expect(vi.getTimerCount()).toBe(0);
    expect(exitKind(onExit)).toBe("stopped");

    vi.advanceTimersByTime(120_000);
    expect(children).toHaveLength(1);
  });

  it("times out when no line arrives, kills the tree and does not restart", () => {
    const { spawnProcess, children } = fakeSpawner();
    const killTree = vi.fn();
    const onExit = vi.fn();

    helper(spawnProcess, { timeoutMs: 1_000, killTree, onExit });

    vi.advanceTimersByTime(999);
    expect(onExit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(killTree).toHaveBeenCalledWith(children[0]);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(String(onExit.mock.calls[0]?.[0])).toMatch(/timed out/);
    expect(exitKind(onExit)).toBe("timed out");

    vi.advanceTimersByTime(120_000);
    expect(children).toHaveLength(1);
  });

  it("restarts the idle timeout on every line", () => {
    const { spawnProcess, children } = fakeSpawner();
    const onExit = vi.fn();

    helper(spawnProcess, { timeoutMs: 1_000, onExit, killTree: vi.fn() });

    vi.advanceTimersByTime(900);
    children[0]?.stdout.emit("data", "still here\n");
    vi.advanceTimersByTime(900);
    expect(onExit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(String(onExit.mock.calls[0]?.[0])).toMatch(/timed out/);
  });

  it("keeps only the last stderr line, truncated to 500 characters", () => {
    const { spawnProcess, children } = fakeSpawner();
    const onExit = vi.fn();

    helper(spawnProcess, {
      maxAttempts: 1,
      onExit,
      killTree: vi.fn(),
    });

    children[0]?.stderr.emit("data", "first line\nsecond line\n");
    children[0]?.emit("exit", 3);

    const reason = String(onExit.mock.calls[0]?.[0]);
    expect(reason).toContain("second line");
    expect(reason).not.toContain("first line");
    expect(reason).toMatch(/code 3/);

    // A second helper proves the 500-character truncation.
    const second = fakeSpawner();
    const longExit = vi.fn();
    helper(second.spawnProcess, {
      maxAttempts: 1,
      onExit: longExit,
      killTree: vi.fn(),
    });
    second.children[0]?.stderr.emit("data", "x".repeat(900));
    second.children[0]?.emit("exit", 1);

    const tail = String(longExit.mock.calls[0]?.[0]).split(": ").at(-1) ?? "";
    expect(tail.length).toBe(500);
  });
});
