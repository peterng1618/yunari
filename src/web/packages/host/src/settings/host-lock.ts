import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * One app folder is one host.
 *
 * Two hosts started against one folder share `active-theme.json`,
 * `display-clients.json` and the device choices — the same display ids and
 * assignments under two servers — and the port fallback hides it by letting the
 * second one start. This file names the holder so the second is refused with the
 * flag that fixes it.
 *
 * It is a collision guard between two hosts on one machine, not a security
 * boundary and not a mutex: a pid the OS has recycled reads as live, and two
 * hosts starting in the same instant can both find the file absent. Both are
 * cheaper than the sharing this exists to prevent.
 */

export interface HostLock {
  readonly release: () => Promise<void>;
}

export type HostLockResult =
  | { readonly ok: true; readonly lock: HostLock }
  | { readonly ok: false; readonly reason: string };

const FILE = "host.lock";

interface HeldLock {
  readonly pid: number;
  readonly port: number;
}

/**
 * True when `pid` is running.
 *
 * Only `ESRCH` — no such process — proves a pid is gone. `process.kill` answers
 * `EPERM` for a process that exists and is not this one's to signal, which is
 * the ordinary answer on Windows for anything another user owns; reading that as
 * gone would make a live host's lock stealeable, which is the one thing this
 * file exists to prevent. Anything else is not proof of absence either, so the
 * answer errs towards "alive" and a second host is refused rather than admitted.
 */
export function pidIsAlive(
  pid: number,
  kill: (pid: number, signal: number) => unknown = process.kill,
): boolean {
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** The holder a lock file names, or nothing: empty and truncated both read stale. */
function readHeld(input: unknown): HeldLock | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return undefined;
  }

  const record = input as Record<string, unknown>;
  const pid = record["pid"];
  const port = record["port"];

  const usable = (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value) && value > 0;

  return usable(pid) && usable(port) ? { pid, port } : undefined;
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    // Absent, unreadable, empty or half-written: a lock that cannot be read
    // names no holder, so it is stale rather than a reason to refuse.
    return undefined;
  }
}

/** Holds the folder for this process, or answers why another host has it. */
export async function acquireHostLock(
  settingsDir: string,
  port: number,
  options: { readonly isPidAlive?: (pid: number) => boolean } = {},
): Promise<HostLockResult> {
  const isPidAlive = options.isPidAlive ?? pidIsAlive;
  const file = path.join(settingsDir, FILE);
  const held = readHeld(await readJson(file));

  if (held !== undefined && isPidAlive(held.pid)) {
    return {
      ok: false,
      // Both folders are named, because they are one level apart and the flag
      // takes the outer one: a reader who passes the printed path to `--app-dir`
      // would nest a second settings folder inside the held one.
      reason:
        `${settingsDir} is held by a host on port ${held.port} ` +
        `(pid ${held.pid}), so this one would share its displays and its ` +
        `active theme. Stop that host, or run this one with --app-dir ` +
        `pointing somewhere other than ${path.dirname(settingsDir)}.`,
    };
  }

  await mkdir(settingsDir, { recursive: true });
  // Written beside the target and renamed over it, so a crash mid-write leaves
  // the previous lock rather than a truncated one.
  const temporary = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(
    temporary,
    `${JSON.stringify({ pid: process.pid, port }, null, 2)}\n`,
    "utf8",
  );
  await rename(temporary, file);

  return {
    ok: true,
    lock: {
      // Read back before unlinking. Something else can take this file while this
      // process runs — a fixture that wipes the folder, or a hand deletion — and
      // then this process's exit must not delete the lock of the host that took
      // the folder over, which would let a third start against a held folder.
      // A file that names nobody is removed too, so a release stays idempotent.
      release: async () => {
        const current = readHeld(await readJson(file));

        if (current === undefined || current.pid === process.pid) {
          await rm(file, { force: true });
        }
      },
    },
  };
}
