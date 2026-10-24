import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * One supervisor for every PowerShell helper the host runs: location now,
 * media and frames later. It owns the parts `spawn` leaves to the caller —
 * line framing with a cap, restart with backoff, a per-request timeout, and a
 * tree kill so a stopped helper leaves no grandchild behind.
 */

const LINE_CAP = 1_048_576;
const STDERR_CAP = 500;
const MAX_ATTEMPTS = 5;
const STABLE_MS = 30_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 60_000;

export interface HelperHandle {
  readonly pid: number | undefined;
  stop(): void;
}

interface HelperStream {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
}

/** The slice of a child process a helper uses, so a test can stand one in. */
export interface HelperChild {
  readonly pid: number | undefined;
  readonly stdout: HelperStream | null;
  readonly stderr: HelperStream | null;
  once(event: "exit", listener: (code: number | null) => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
}

export type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: {
    readonly windowsHide: boolean;
    readonly stdio: readonly ["ignore", "pipe", "pipe"];
  },
) => HelperChild;

/** Kills the process and everything it started; `.kill()` leaves children. */
export type KillTree = (pid: number) => void;

export interface HelperOptions {
  readonly id: string;
  /** The embedded PowerShell source. Nothing user-supplied enters it. */
  readonly script: string;
  readonly onLine: (line: string) => void;
  readonly onExit: (reason: string) => void;
  readonly nowMs: () => number;
  /** A one-shot helper fails when no line arrives within this window. */
  readonly timeoutMs?: number;
  /** A line that could not be delivered, without stopping the helper. */
  readonly onProblem?: (reason: string) => void;
  readonly spawnProcess?: SpawnProcess;
  readonly killTree?: KillTree;
  /** Injected so a test does not depend on this machine having PowerShell. */
  readonly pathExists?: (file: string) => boolean;
}

/**
 * The explicit PowerShell 5.1 path. No PATH lookup and no bare `powershell`:
 * a helper must not resolve to a different program the machine happens to
 * have first, and an absent one is a reported state rather than an exception.
 */
export function powershellPath(
  pathExists: (file: string) => boolean = existsSync,
): string | undefined {
  const root = process.env["SystemRoot"] ?? "C:\\Windows";
  const executable = path.join(
    root,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );

  return pathExists(executable) ? executable : undefined;
}

function defaultSpawn(
  command: string,
  args: readonly string[],
  options: {
    readonly windowsHide: boolean;
    readonly stdio: readonly ["ignore", "pipe", "pipe"];
  },
): HelperChild {
  return spawn(command, [...args], {
    windowsHide: options.windowsHide,
    stdio: ["ignore", "pipe", "pipe"],
  }) as unknown as ChildProcess as HelperChild;
}

function defaultKillTree(pid: number): void {
  spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
    windowsHide: true,
    stdio: "ignore",
  });
}

function unref(timer: ReturnType<typeof setTimeout>): void {
  (timer as { unref?: () => void }).unref?.();
}

function powershellArgs(script: string): readonly string[] {
  // `-ExecutionPolicy Bypass` covers this module's own embedded constant
  // script, not a file on disk; `-EncodedCommand` removes quoting from the
  // argument surface entirely.
  return [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64"),
  ];
}

/**
 * Starts an embedded PowerShell script and reads it as JSON lines.
 *
 * A helper that exits unexpectedly is restarted after a capped exponential
 * delay; five consecutive failures give up so a broken helper cannot spin.
 * `stop()` is the deliberate end: it clears every timer and kills the tree.
 */
export function startJsonLineHelper(options: HelperOptions): HelperHandle {
  const spawnProcess = options.spawnProcess ?? defaultSpawn;
  const killTree = options.killTree ?? defaultKillTree;
  const executable = powershellPath(options.pathExists);

  let stopped = false;
  let attempts = 0;
  let child: HelperChild | undefined;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let stableTimer: ReturnType<typeof setTimeout> | undefined;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = (
    timer: ReturnType<typeof setTimeout> | undefined,
  ): undefined => {
    if (timer !== undefined) clearTimeout(timer);
    return undefined;
  };

  const clearTimers = (): void => {
    restartTimer = clearTimer(restartTimer);
    stableTimer = clearTimer(stableTimer);
    timeoutTimer = clearTimer(timeoutTimer);
  };

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearTimers();
    const pid = child?.pid;
    child = undefined;
    if (pid !== undefined) killTree(pid);
  };

  if (executable === undefined) {
    stopped = true;
    options.onExit(
      `PowerShell was not found, so the ${options.id} helper cannot run.`,
    );
    return { pid: undefined, stop: () => undefined };
  }

  const armTimeout = (): void => {
    if (options.timeoutMs === undefined || stopped) return;
    timeoutTimer = clearTimer(timeoutTimer);
    timeoutTimer = setTimeout(() => {
      timeoutTimer = undefined;
      stop();
      options.onExit(
        `${options.id} helper timed out after ${options.timeoutMs} ms without a line.`,
      );
    }, options.timeoutMs);
    unref(timeoutTimer);
  };

  const handleFailure = (reason: string): void => {
    if (stopped) return;
    child = undefined;
    clearTimers();
    attempts += 1;

    if (attempts >= MAX_ATTEMPTS) {
      stopped = true;
      clearTimers();
      options.onExit(
        `${options.id} helper stopped after ${MAX_ATTEMPTS} failed starts; ` +
          `last failure: ${reason}`,
      );
      return;
    }

    const delay = Math.min(
      BACKOFF_BASE_MS * 2 ** (attempts - 1),
      BACKOFF_CAP_MS,
    );
    restartTimer = setTimeout(() => {
      restartTimer = undefined;
      spawnOnce();
    }, delay);
    unref(restartTimer);
  };

  const spawnOnce = (): void => {
    if (stopped) return;

    let spawned: HelperChild;

    try {
      spawned = spawnProcess(executable, powershellArgs(options.script), {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      handleFailure(`could not start PowerShell: ${message}`);
      return;
    }

    child = spawned;

    let settled = false;
    let buffer = "";
    let dropping = false;
    let reportedOverCap = false;
    let stderrTail = "";

    const finish = (reason: string): void => {
      // `error` and `exit` can both fire for one failed start.
      if (settled) return;
      settled = true;
      handleFailure(reason);
    };

    const reportOverCap = (): void => {
      if (reportedOverCap) return;
      reportedOverCap = true;
      options.onProblem?.(
        `${options.id} helper printed a line longer than 1 MiB; it was dropped.`,
      );
    };

    const consume = (text: string): void => {
      if (dropping) {
        const newline = text.search(/\r?\n/);
        if (newline === -1) return;
        dropping = false;
        text = text.slice(newline).replace(/^\r?\n/, "");
      }

      buffer += text;

      while (true) {
        const match = /\r?\n/.exec(buffer);
        if (match === null) break;
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);

        if (line.length > LINE_CAP) {
          reportOverCap();
          continue;
        }

        armTimeout();
        options.onLine(line);
        if (stopped) return;
      }

      // Over-cap without a newline is dropped immediately, never buffered
      // until one arrives; the rest of that line is discarded as it streams.
      if (buffer.length > LINE_CAP) {
        buffer = "";
        dropping = true;
        reportOverCap();
      }
    };

    spawned.once("error", (error: Error) => {
      finish(`could not start PowerShell: ${error.message}`);
    });
    spawned.once("exit", (code: number | null) => {
      const tail = stderrTail.trim();
      finish(
        `${options.id} helper exited with code ${String(code)}` +
          (tail === "" ? "" : `: ${tail}`),
      );
    });
    spawned.stdout?.on("data", (chunk: Buffer | string) => {
      consume(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    });
    spawned.stderr?.on("data", (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      stderrTail = `${stderrTail}${text}`.slice(-STDERR_CAP);
    });

    stableTimer = setTimeout(() => {
      stableTimer = undefined;
      attempts = 0;
    }, STABLE_MS);
    unref(stableTimer);
    armTimeout();
  };

  spawnOnce();

  return {
    get pid(): number | undefined {
      return stopped ? undefined : child?.pid;
    },
    stop,
  };
}
