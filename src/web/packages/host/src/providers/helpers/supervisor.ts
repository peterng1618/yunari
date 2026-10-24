import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * One supervisor for every PowerShell helper the host runs: location now,
 * media and frames later. It owns the parts `spawn` leaves to the caller —
 * line framing with a cap, restart with backoff, a per-request timeout, and a
 * tree kill so a stopped helper leaves no grandchild behind.
 */

/** One framed line may not exceed this; a longer one is dropped and reported. */
export const HELPER_LINE_CAP = 1_048_576;
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
  /** The fallback when there is no taskkill to end the tree. */
  kill?(): unknown;
}

export type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: {
    readonly windowsHide: boolean;
    readonly stdio: readonly ["ignore", "pipe", "pipe"];
  },
) => HelperChild;

/** Ends the process and everything it started; `.kill()` leaves children. */
export type KillTree = (child: HelperChild) => void;

/** Why a helper ended: a deliberate stop is not a failure to reconnect, and
 *  an absent program is a state rather than a crash. */
export type HelperExitKind = "failed" | "timed out" | "stopped" | "unavailable";

export interface HelperOptions {
  readonly id: string;
  /** The embedded PowerShell source. Nothing user-supplied enters it. */
  readonly script: string;
  readonly onLine: (line: string) => void;
  readonly onExit: (reason: string, kind: HelperExitKind) => void;
  /** A one-shot helper fails when no line arrives within this window. */
  readonly timeoutMs?: number;
  /** Consecutive failed starts before giving up. */
  readonly maxAttempts?: number;
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

function defaultKillTree(child: HelperChild): void {
  const root = process.env["SystemRoot"] ?? "C:\\Windows";
  const taskkill = path.join(root, "System32", "taskkill.exe");

  if (child.pid !== undefined && existsSync(taskkill)) {
    // The explicit path, not a PATH lookup, for the same reason the helper
    // itself is launched by one. The listener keeps a failed spawn from
    // becoming an unhandled `error` event.
    const killer = spawn(taskkill, ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.on("error", () => undefined);
    return;
  }

  // No taskkill (or no pid): end only the process this supervisor started.
  child.kill?.();
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
 * delay; consecutive failures give up so a broken helper cannot spin.
 * `stop()` is the deliberate end: it clears every timer and kills the tree.
 */
export function startJsonLineHelper(options: HelperOptions): HelperHandle {
  const spawnProcess = options.spawnProcess ?? defaultSpawn;
  const killTree = options.killTree ?? defaultKillTree;
  const maxAttempts = Math.max(1, options.maxAttempts ?? MAX_ATTEMPTS);
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

  /** Ends the helper without reporting it; callers report their own reason. */
  const stopInternal = (): boolean => {
    if (stopped) return false;
    stopped = true;
    clearTimers();
    const current = child;
    child = undefined;
    if (current !== undefined) killTree(current);
    return true;
  };

  const stop = (): void => {
    if (!stopInternal()) return;
    options.onExit(`${options.id} helper stopped.`, "stopped");
  };

  if (executable === undefined) {
    stopped = true;
    options.onExit(
      `PowerShell was not found, so the ${options.id} helper cannot run.`,
      "unavailable",
    );
    return { pid: undefined, stop: () => undefined };
  }

  const armTimeout = (): void => {
    if (options.timeoutMs === undefined || stopped) return;
    timeoutTimer = clearTimer(timeoutTimer);
    timeoutTimer = setTimeout(() => {
      timeoutTimer = undefined;
      stopInternal();
      options.onExit(
        `${options.id} helper timed out after ${options.timeoutMs} ms without a line.`,
        "timed out",
      );
    }, options.timeoutMs);
    unref(timeoutTimer);
  };

  const handleFailure = (reason: string): void => {
    if (stopped) return;
    child = undefined;
    clearTimers();
    attempts += 1;

    if (attempts >= maxAttempts) {
      stopped = true;
      clearTimers();
      options.onExit(
        `${options.id} helper stopped after ${maxAttempts} failed starts; ` +
          `last failure: ${reason}`,
        "failed",
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
    let stderrLine = "";
    let stderrPartial = "";

    const finish = (reason: string): void => {
      // `error` and `exit` can both fire for one failed start.
      if (settled) return;
      settled = true;
      handleFailure(reason);
    };

    const reportOverCap = (): void => {
      // A stop ends the contract: nothing may be delivered afterwards.
      if (stopped || settled || reportedOverCap) return;
      reportedOverCap = true;
      options.onProblem?.(
        `${options.id} helper printed a line longer than 1 MiB; it was dropped.`,
      );
    };

    const consume = (text: string): void => {
      if (stopped || settled) return;

      if (dropping) {
        const newline = text.search(/\r?\n/);
        if (newline === -1) return;
        dropping = false;
        text = text.slice(newline).replace(/^\r?\n/, "");
      }

      buffer += text;

      while (true) {
        if (stopped) return;
        const match = /\r?\n/.exec(buffer);
        if (match === null) break;
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);

        if (line.length > HELPER_LINE_CAP) {
          reportOverCap();
          continue;
        }

        armTimeout();
        options.onLine(line);
      }

      // Over-cap without a newline is dropped immediately, never buffered
      // until one arrives; the rest of that line is discarded as it streams.
      if (buffer.length > HELPER_LINE_CAP) {
        buffer = "";
        dropping = true;
        reportOverCap();
      }
    };

    spawned.once("error", (error: Error) => {
      finish(`could not start PowerShell: ${error.message}`);
    });
    spawned.once("exit", (code: number | null) => {
      // Only the last stderr line is diagnostic; the rest is noise and must
      // not grow an unbounded reason.
      const line = stderrPartial.trim() !== "" ? stderrPartial : stderrLine;
      const tail = line.trim().slice(0, STDERR_CAP);
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
      const parts = `${stderrPartial}${text}`.split(/\r?\n/);
      stderrPartial = parts.pop() ?? "";

      const complete = parts.filter((line) => line.trim() !== "").at(-1);
      if (complete !== undefined) stderrLine = complete;
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
