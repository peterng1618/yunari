import type { ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));

interface Exit {
  readonly code: number;
  readonly stdout?: string;
}

interface SpawnError {
  readonly error: Error;
}

type Reply = Exit | SpawnError;

type ReplyFor = (args: readonly string[], input: string) => Reply | undefined;

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

function fakeChild(
  args: readonly string[],
  reply: ReplyFor,
  kill: (signal?: string) => void,
): ChildProcess {
  const child = new EventEmitter();
  const stdout = new EventEmitter();
  const stdin = Object.assign(new EventEmitter(), {
    end(chunk: Buffer) {
      const answer = reply(args, Buffer.from(chunk).toString("utf8"));
      // No reply means the child never finishes, which is the wedged case.
      if (answer === undefined) return;

      if ("error" in answer) {
        child.emit("error", answer.error);
        return;
      }

      if (answer.stdout !== undefined) {
        stdout.emit("data", Buffer.from(answer.stdout, "utf8"));
      }
      child.emit("close", answer.code);
    },
  });

  Object.assign(child, {
    stdout,
    stderr: { resume: () => {} },
    stdin,
    kill,
  });

  return child as unknown as ChildProcess;
}

function installSpawn(
  reply: ReplyFor,
  kill: (signal?: string) => void = vi.fn(),
): void {
  spawnMock.mockImplementation((_command: string, args: readonly string[]) =>
    fakeChild(args, reply, kill),
  );
}

async function freshProtectorModule() {
  // A cold module instance has an empty probe cache, which is the state the
  // race and retry cases need.
  vi.resetModules();
  return await import("./os-key-protector.js");
}

describe("the OS key protector", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.skipIf(process.platform !== "win32")(
    "falls back to pwsh when powershell fails transiently",
    async () => {
      installSpawn((args) => {
        if (args.at(-1) !== "exit 0") return { code: 1 };
        // The first candidate is denied; the second is healthy.
        return spawnMock.mock.calls.length === 1
          ? { error: errno("EACCES") }
          : { code: 0 };
      });

      const fresh = await freshProtectorModule();
      const protector = fresh.createOsKeyProtector(
        path.join(os.tmpdir(), "yunari-fallback"),
      );

      expect(await protector.available()).toBe(true);
      expect(spawnMock).toHaveBeenCalledTimes(2);
    },
    30_000,
  );

  it.skipIf(process.platform !== "win32")(
    "probes again after every candidate fails transiently",
    async () => {
      let round = 0;
      installSpawn((args) => {
        if (args.at(-1) !== "exit 0") return { code: 1 };
        return round === 0 ? { code: 1 } : { code: 0 };
      });

      const fresh = await freshProtectorModule();
      const first = fresh.createOsKeyProtector(
        path.join(os.tmpdir(), "yunari-probe-a"),
      );
      // Attach the expectation before awaiting, or the rejection is briefly
      // unhandled.
      const rejected = expect(first.available()).rejects.toThrow(
        /exited with status 1/,
      );

      await rejected;
      expect(spawnMock).toHaveBeenCalledTimes(2);

      // The failed probe must not be cached for the process.
      round = 1;
      const second = fresh.createOsKeyProtector(
        path.join(os.tmpdir(), "yunari-probe-b"),
      );
      expect(await second.available()).toBe(true);
      expect(spawnMock).toHaveBeenCalledTimes(3);
    },
    30_000,
  );

  it.skipIf(process.platform !== "win32")(
    "caches a facility whose binaries are both absent",
    async () => {
      installSpawn(() => ({ error: errno("ENOENT") }));

      const fresh = await freshProtectorModule();
      const protector = fresh.createOsKeyProtector(
        path.join(os.tmpdir(), "yunari-absent"),
      );

      expect(await protector.available()).toBe(false);
      expect(await protector.available()).toBe(false);
      // An absence is the one answer worth caching.
      expect(spawnMock).toHaveBeenCalledTimes(2);
    },
    30_000,
  );

  it("rejects a transient Linux probe and retries", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");

    let lookups = 0;
    installSpawn(() => {
      lookups += 1;
      // The first lookup cannot reach the keyring; the next runs and finds no
      // key, which still means the facility is there.
      return lookups === 1 ? { error: errno("EMFILE") } : { code: 1 };
    });

    const fresh = await freshProtectorModule();
    const protector = fresh.createOsKeyProtector(
      path.join(os.tmpdir(), "yunari-linux-retry"),
    );

    await expect(protector.available()).rejects.toThrow(/could not be started/);
    expect(await protector.available()).toBe(true);
    expect(lookups).toBe(2);
  });

  it("kills a wedged child with SIGKILL at the deadline", async () => {
    vi.useFakeTimers();
    const kill = vi.fn();
    installSpawn(() => undefined, kill);

    vi.spyOn(process, "platform", "get").mockReturnValue("linux");

    const fresh = await freshProtectorModule();
    const protector = fresh.createOsKeyProtector(
      path.join(os.tmpdir(), "yunari-wedged"),
    );

    const pending = protector.wrap(randomBytes(32));
    const rejected = expect(pending).rejects.toThrow(/did not finish in time/);

    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;

    expect(kill).toHaveBeenCalledWith("SIGKILL");
  }, 30_000);

  it("scopes the Linux keyring item to the directory and round-trips through it", async () => {
    const calls: string[][] = [];
    let stored = "";

    installSpawn((args, input) => {
      calls.push([...args]);

      if (args[0] === "store") {
        // `secret-tool store` keeps the stdin text and prints nothing.
        stored = input;
        return { code: 0 };
      }

      if (args[0] === "lookup") {
        // An empty keyring answers non-zero, which is not an absence.
        return stored === "" ? { code: 1 } : { code: 0, stdout: stored };
      }

      return { code: 1 };
    });

    vi.spyOn(process, "platform", "get").mockReturnValue("linux");

    const directory = path.join(os.tmpdir(), "yunari-scope-folder");
    const fresh = await freshProtectorModule();
    const protector = fresh.createOsKeyProtector(directory);

    expect(await protector.available()).toBe(true);

    const key = randomBytes(32);
    const wrapped = await protector.wrap(key);
    expect(wrapped.length).toBe(0);

    const unwrapped = await protector.unwrap(wrapped);
    expect(Buffer.from(unwrapped).equals(key)).toBe(true);

    const expected = [
      "service",
      "yunari",
      "purpose",
      "secret-key",
      "path",
      path.resolve(directory),
    ];
    const attributesOf = (args: string[]): string[] =>
      args.slice(args.indexOf("service"));

    const storeCall = calls.find((args) => args[0] === "store");
    expect(storeCall).toBeDefined();
    expect(attributesOf(storeCall as string[])).toEqual(expected);

    const lookups = calls.filter((args) => args[0] === "lookup");
    expect(lookups.length).toBe(2);
    for (const args of lookups) {
      expect(attributesOf(args)).toEqual(expected);
    }
  });

  it("spawns one probe child for three cold protectors", async () => {
    installSpawn(() => ({ code: 0 }));

    const fresh = await freshProtectorModule();
    const protectors = ["a", "b", "c"].map((name) =>
      fresh.createOsKeyProtector(
        path.join(os.tmpdir(), `yunari-three-${name}`),
      ),
    );

    const answers = await Promise.all(
      protectors.map((protector) => protector.available()),
    );

    expect(answers).toEqual([true, true, true]);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});
