import { spawn } from "node:child_process";
import path from "node:path";

/**
 * The OS facility that protects the store's one data key.
 *
 * Wrapping keeps the key out of a file an attacker can copy to another account
 * or machine: DPAPI `CurrentUser` on Windows, the Secret Service through
 * `secret-tool` on Linux. Neither needs a password per start, and neither is a
 * substitute for file permissions against another process running as the same
 * user.
 *
 * The platforms differ in one way that matters for backups: on Linux the key
 * lives in the user's keyring, not in `secret.key`, so it does not travel with
 * a copied folder; a copy of the folder on another machine cannot be decrypted.
 * On Windows DPAPI unwraps for the same user on the same machine, so a copied
 * folder is likewise unreadable elsewhere.
 *
 * The Linux item is scoped to the resolved directory, not to its canonical
 * path: a folder reached through a symlink or junction is a second scope, so
 * address the folder by one path.
 */
export interface KeyProtector {
  available(): Promise<boolean>;
  /** Encrypts the 32-byte data key with the OS facility. */
  wrap(key: Uint8Array): Promise<Uint8Array>;
  unwrap(wrapped: Uint8Array): Promise<Uint8Array>;
}

/** A spawn that never reached the program, as opposed to one that failed. */
class SpawnFailure extends Error {}

/** The child outlived its deadline and was killed. */
class ChildTimeout extends Error {}

const WINDOWS_BINARIES = ["powershell", "pwsh"] as const;
const WINDOWS_ARGS = ["-NoProfile", "-NonInteractive", "-Command"] as const;
/** A wedged child must not hold the store's queue forever. */
const CHILD_TIMEOUT_MS = 10_000;

const WINDOWS_PROTECT = `Add-Type -AssemblyName System.Security
$payload = [Console]::In.ReadToEnd()
$data = [Convert]::FromBase64String($payload)
$out = [System.Security.Cryptography.ProtectedData]::Protect($data, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($out))`;

const WINDOWS_UNPROTECT = `Add-Type -AssemblyName System.Security
$payload = [Console]::In.ReadToEnd()
$data = [Convert]::FromBase64String($payload)
$out = [System.Security.Cryptography.ProtectedData]::Unprotect($data, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($out))`;

const SECRET_TOOL = "secret-tool";

/**
 * Runs the program and returns stdout.
 *
 * Errors carry the program and its exit status only. Stderr is deliberately not
 * included: a child that echoes its input would put key bytes in a message the
 * caller may log. A child still running at the deadline is killed and reported
 * as a failed run.
 */
function run(
  command: string,
  args: readonly string[],
  input: Uint8Array,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const output: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // A child that ignores SIGTERM would never produce `close`, so the
      // promise is settled here and the child is ended as hard as the platform
      // allows.
      child.kill(process.platform === "win32" ? undefined : "SIGKILL");
      reject(new ChildTimeout(`${command} did not finish in time.`));
    }, CHILD_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    // Drained so a child filling its stderr pipe cannot block, and discarded so
    // nothing it says can reach an error message.
    child.stderr.resume();
    child.stdin.on("error", () => {
      // A binary that never starts closes stdin under us; the spawn or close
      // event reports the real failure.
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new SpawnFailure(`${command} could not be started.`, { cause: error }),
      );
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve(Buffer.concat(output));
      } else if (code === null) {
        reject(new Error(`${command} ended without an exit status.`));
      } else {
        reject(new Error(`${command} exited with status ${code}.`));
      }
    });

    child.stdin.end(Buffer.from(input));
  });
}

function decode(text: Buffer): Buffer {
  return Buffer.from(text.toString("utf8").trim(), "base64");
}

/** `ENOENT` means the binary is not there; nothing about the machine changed. */
function isAbsence(error: unknown): boolean {
  return (
    error instanceof SpawnFailure &&
    (error.cause as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
  );
}

/**
 * The probe is cached as a promise, not an answer: protectors asking at once
 * share one child, so a caller cannot cache a `false` the first will
 * contradict. A transient failure (a timeout, or a spawn error other than
 * `ENOENT`) clears the cache so the next caller probes again; only a real
 * absence is cached for the process.
 */
let binaryProbe: Promise<string | undefined> | undefined;

/** PowerShell 5.1 or 7, whichever this machine has. */
function windowsBinary(): Promise<string | undefined> {
  if (binaryProbe !== undefined) return binaryProbe;

  const probe = probeWindowsBinaries();
  binaryProbe = probe;
  void probe.catch(() => {
    if (binaryProbe === probe) binaryProbe = undefined;
  });

  return probe;
}

async function probeWindowsBinaries(): Promise<string | undefined> {
  let transient: Error | undefined;

  for (const candidate of WINDOWS_BINARIES) {
    try {
      await run(candidate, [...WINDOWS_ARGS, "exit 0"], Buffer.alloc(0));
      return candidate;
    } catch (error) {
      // A denied or wedged `powershell` may sit beside a healthy `pwsh`, so
      // every candidate is tried. The first transient error is kept, and thrown
      // only when no candidate works, so the cached rejection still clears. An
      // absent binary is the ordinary "try the next one".
      if (!isAbsence(error) && transient === undefined) {
        transient = error instanceof Error ? error : new Error(String(error));
      }
    }
  }

  if (transient !== undefined) throw transient;
  return undefined;
}

async function protectWindows(
  key: Uint8Array,
  script: string,
): Promise<Buffer> {
  const command = await windowsBinary();
  if (command === undefined) {
    throw new Error("PowerShell is not available for the OS key protector.");
  }

  // The script decodes its stdin, so the bytes cross the pipe as base64 text.
  const encoded = Buffer.from(Buffer.from(key).toString("base64"), "utf8");
  return decode(await run(command, [...WINDOWS_ARGS, script], encoded));
}

function keyringError(action: string): Error {
  return new Error(
    `The Linux keyring could not ${action} the key; a locked keyring is a lock, not an absence.`,
  );
}

/**
 * @param directory The folder whose keys this protects. On Linux the keyring
 *   item is scoped to the resolved path, so two app folders do not overwrite
 *   each other's key.
 */
export function createOsKeyProtector(directory?: string): KeyProtector {
  const platform = process.platform;
  const scope = path.resolve(directory ?? process.cwd());
  const attributes = [
    "service",
    "yunari",
    "purpose",
    "secret-key",
    "path",
    scope,
  ] as const;

  const lookUp = async (): Promise<Buffer> => {
    try {
      return await run(SECRET_TOOL, ["lookup", ...attributes], Buffer.alloc(0));
    } catch (error) {
      // A spawn failure and a timeout keep their own meaning; only a child
      // that ran and refused becomes the keyring message.
      if (error instanceof SpawnFailure || error instanceof ChildTimeout) {
        throw error;
      }
      throw keyringError("read");
    }
  };

  const storeKey = async (key: Uint8Array): Promise<void> => {
    // `secret-tool store` reads the secret from stdin as text and prints
    // nothing; the key lives in the keyring, not in `secret.key`.
    const encoded = Buffer.from(Buffer.from(key).toString("base64"), "utf8");

    try {
      await run(
        SECRET_TOOL,
        ["store", "--label", "Yunari secret key", ...attributes],
        encoded,
      );
    } catch (error) {
      if (error instanceof SpawnFailure || error instanceof ChildTimeout) {
        throw error;
      }
      throw keyringError("store");
    }
  };

  const check = async (): Promise<boolean> => {
    if (platform === "win32") return (await windowsBinary()) !== undefined;

    if (platform === "linux") {
      try {
        await lookUp();
        return true;
      } catch (error) {
        // An absent `secret-tool` is the only "no facility" answer. A timeout
        // or another transient spawn failure rejects so the per-instance cache
        // clears and the next call retries; a lookup that ran and simply found
        // no stored key still counts, because the first write has to be able
        // to store one.
        if (isAbsence(error)) return false;
        if (error instanceof SpawnFailure || error instanceof ChildTimeout) {
          throw error;
        }
        return true;
      }
    }

    return false;
  };

  // One probe per protector, shared with any caller that arrives while it is
  // still running. A rejected probe clears the cache: a transient failure must
  // not make every later write refuse until restart.
  let availability: Promise<boolean> | undefined;

  return {
    async available() {
      if (availability !== undefined) return availability;

      const probe = check();
      availability = probe;
      void probe.catch(() => {
        if (availability === probe) availability = undefined;
      });

      return probe;
    },

    async wrap(key) {
      if (platform === "win32") {
        return protectWindows(key, WINDOWS_PROTECT);
      }

      if (platform === "linux") {
        await storeKey(key);
        // The key is in the keyring; the marker carries no key material.
        return Buffer.alloc(0);
      }

      throw new Error("No OS key protector on this platform.");
    },

    async unwrap(wrapped) {
      if (platform === "win32") {
        return protectWindows(wrapped, WINDOWS_UNPROTECT);
      }

      if (platform === "linux") {
        return decode(await lookUp());
      }

      throw new Error("No OS key protector on this platform.");
    },
  };
}
