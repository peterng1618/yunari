import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOCATION_DENIED_REASON,
  LOCATION_TIMEOUT_REASON,
  LOCATION_UNAVAILABLE_REASON,
  parseLocationLine,
  readLocation,
} from "./location.js";
import type { HelperChild, SpawnProcess } from "./supervisor.js";

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
} {
  const children: FakeChild[] = [];
  let pid = 200;

  return {
    children,
    spawnProcess: (() => {
      const child = new FakeChild(pid);
      pid += 1;
      children.push(child);
      return child as unknown as HelperChild;
    }) as SpawnProcess,
  };
}

describe("parseLocationLine", () => {
  it("reads a position and rejects values outside the world", () => {
    expect(parseLocationLine('{"latitude":52.52,"longitude":13.41}')).toEqual({
      kind: "position",
      latitude: 52.52,
      longitude: 13.41,
    });

    expect(
      parseLocationLine('{"latitude":91,"longitude":13.41}'),
    ).toBeUndefined();
    expect(
      parseLocationLine('{"latitude":52.52,"longitude":-181}'),
    ).toBeUndefined();
    expect(parseLocationLine('{"latitude":"52.52","longitude":13.41}')).toBe(
      undefined,
    );
  });

  it("reads the two refusal lines and ignores anything else", () => {
    expect(parseLocationLine('{"error":"denied"}')).toEqual({
      kind: "error",
      code: "denied",
    });
    expect(parseLocationLine('{"error":"unavailable"}')).toEqual({
      kind: "error",
      code: "unavailable",
    });
    expect(parseLocationLine('{"error":"other"}')).toBeUndefined();
    expect(parseLocationLine("not json")).toBeUndefined();
  });
});

describe("readLocation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports one position and stops the helper", () => {
    const { spawnProcess, children } = fakeSpawner();
    const onPosition = vi.fn();
    const onError = vi.fn();
    const killTree = vi.fn();

    readLocation({
      spawnProcess,
      killTree,
      onPosition,
      onError,
      pathExists: () => true,
    });

    children[0]?.stdout.emit("data", '{"latitude":52.52,"longitude":13.41}\n');

    expect(onPosition).toHaveBeenCalledWith({
      latitude: 52.52,
      longitude: 13.41,
    });
    expect(onError).not.toHaveBeenCalled();
    expect(killTree).toHaveBeenCalledWith(200);
  });

  it("reports a denied permission by name, never a guessed place", () => {
    const { spawnProcess, children } = fakeSpawner();
    const onPosition = vi.fn();
    const onError = vi.fn();

    readLocation({
      spawnProcess,
      onPosition,
      onError,
      pathExists: () => true,
    });

    children[0]?.stdout.emit("data", '{"error":"denied"}\n');

    expect(onPosition).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(LOCATION_DENIED_REASON);
    expect(LOCATION_DENIED_REASON).toBe("Windows location was denied");
  });

  it("reports a timeout with its own reason", () => {
    const { spawnProcess, children } = fakeSpawner();
    const onError = vi.fn();
    const killTree = vi.fn();

    readLocation({
      spawnProcess,
      killTree,
      onPosition: () => undefined,
      onError,
      pathExists: () => true,
      timeoutMs: 1_000,
    });

    vi.advanceTimersByTime(1_000);

    expect(onError).toHaveBeenCalledWith(LOCATION_TIMEOUT_REASON);
    expect(LOCATION_TIMEOUT_REASON).toBe(
      "Windows location did not answer in time",
    );
    expect(killTree).toHaveBeenCalledWith(200);
    expect(children).toHaveLength(1);
  });

  it("names PowerShell when the helper cannot start", () => {
    const { spawnProcess, children } = fakeSpawner();
    const onError = vi.fn();

    readLocation({
      spawnProcess,
      onPosition: () => undefined,
      onError,
      pathExists: () => false,
    });

    expect(children).toHaveLength(0);
    expect(onError).toHaveBeenCalledWith(LOCATION_UNAVAILABLE_REASON);
    expect(LOCATION_UNAVAILABLE_REASON).toMatch(/PowerShell/);
  });

  it("waits past a malformed line for one it can read", () => {
    const { spawnProcess, children } = fakeSpawner();
    const onPosition = vi.fn();
    const onError = vi.fn();

    readLocation({
      spawnProcess,
      onPosition,
      onError,
      pathExists: () => true,
    });

    children[0]?.stdout.emit("data", "garbage\n");
    expect(onError).not.toHaveBeenCalled();

    children[0]?.stdout.emit("data", '{"latitude":1,"longitude":2}\n');
    expect(onPosition).toHaveBeenCalledWith({ latitude: 1, longitude: 2 });
  });

  it("reports an over-cap answer as an error rather than a position", () => {
    const { spawnProcess, children } = fakeSpawner();
    const onPosition = vi.fn();
    const onError = vi.fn();

    readLocation({
      spawnProcess,
      onPosition,
      onError,
      pathExists: () => true,
    });

    children[0]?.stdout.emit("data", "x".repeat(1_048_577));
    expect(onPosition).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
