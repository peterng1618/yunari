import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type HelperChild,
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
    nowMs: () => Date.now(),
    pathExists: () => true,
    spawnProcess,
    ...overrides,
  });
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

  it("drops a line over 1 MiB and reports it once, never passing it on", () => {
    const { spawnProcess, children } = fakeSpawner();
    const onLine = vi.fn();
    const onProblem = vi.fn();

    helper(spawnProcess, { onLine, onProblem });

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

    helper(spawnProcess, { onExit });
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

    vi.advanceTimersByTime(120_000);
    expect(children).toHaveLength(5);
  });

  it("resets the attempt count after thirty seconds of running", () => {
    const { spawnProcess, children } = fakeSpawner();

    helper(spawnProcess);

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

  it("stop kills the tree, clears timers and never restarts", () => {
    const { spawnProcess, children } = fakeSpawner();
    const killTree = vi.fn();
    const onExit = vi.fn();

    const handle = helper(spawnProcess, { killTree, onExit });

    handle.stop();
    handle.stop();

    expect(killTree).toHaveBeenCalledTimes(1);
    expect(killTree).toHaveBeenCalledWith(100);
    expect(handle.pid).toBeUndefined();

    children[0]?.emit("exit", 1);
    vi.advanceTimersByTime(120_000);

    expect(children).toHaveLength(1);
    expect(onExit).not.toHaveBeenCalled();
  });

  it("times out when no line arrives, kills the tree and does not restart", () => {
    const { spawnProcess, children } = fakeSpawner();
    const killTree = vi.fn();
    const onExit = vi.fn();

    helper(spawnProcess, { timeoutMs: 1_000, killTree, onExit });

    vi.advanceTimersByTime(999);
    expect(onExit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(killTree).toHaveBeenCalledWith(100);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(String(onExit.mock.calls[0]?.[0])).toMatch(/timed out/);

    vi.advanceTimersByTime(120_000);
    expect(children).toHaveLength(1);
  });

  it("restarts the idle timeout on every line", () => {
    const { spawnProcess, children } = fakeSpawner();
    const onExit = vi.fn();

    helper(spawnProcess, { timeoutMs: 1_000, onExit });

    vi.advanceTimersByTime(900);
    children[0]?.stdout.emit("data", "still here\n");
    vi.advanceTimersByTime(900);
    expect(onExit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(String(onExit.mock.calls[0]?.[0])).toMatch(/timed out/);
  });
});
