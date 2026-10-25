import { spawn } from "node:child_process";

/**
 * The OS facility that protects the store's one data key.
 *
 * Wrapping keeps the key out of a file an attacker can copy to another account
 * or machine: DPAPI `CurrentUser` on Windows, the Secret Service through
 * `secret-tool` on Linux. Neither needs a password per start, and neither is a
 * substitute for file permissions against another process running as the same
 * user.
 */
export interface KeyProtector {
  available(): Promise<boolean>;
  /** Encrypts the 32-byte data key with the OS facility. */
  wrap(key: Uint8Array): Promise<Uint8Array>;
  unwrap(wrapped: Uint8Array): Promise<Uint8Array>;
}

/** A spawn that never reached the program, as opposed to one that failed. */
class SpawnFailure extends Error {}

const WINDOWS_BINARIES = ["powershell", "pwsh"] as const;
const WINDOWS_ARGS = ["-NoProfile", "-NonInteractive", "-Command"] as const;

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
const SECRET_TOOL_ATTRIBUTES = ["service", "yunari", "purpose", "secret-key"] as const;

/**
 * Runs the program and returns stdout.
 *
 * Errors carry the program and its exit status only. Stderr is deliberately not
 * included: a child that echoes its input would put key bytes in a message the
 * caller may log.
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
      reject(new SpawnFailure(`${command} could not be started.`, { cause: error }));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve(Buffer.concat(output));
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

/** PowerShell 5.1 or 7, whichever this machine has; cached once resolved. */
let resolvedBinary: string | undefined;
let triedBinaries = false;

async function windowsBinary(): Promise<string | undefined> {
  if (triedBinaries) return resolvedBinary;
  triedBinaries = true;

  for (const candidate of WINDOWS_BINARIES) {
    try {
      await run(candidate, [...WINDOWS_ARGS, "exit 0"], Buffer.alloc(0));
      resolvedBinary = candidate;
      return candidate;
    } catch {
      // Try the next one; none left means the OS facility is unavailable.
    }
  }

  return undefined;
}

async function protectWindows(key: Uint8Array, script: string): Promise<Buffer> {
  const command = await windowsBinary();
  if (command === undefined) {
    throw new Error("PowerShell is not available for the OS key protector.");
  }

  // The script decodes its stdin, so the bytes cross the pipe as base64 text.
  const encoded = Buffer.from(Buffer.from(key).toString("base64"), "utf8");
  return decode(await run(command, [...WINDOWS_ARGS, script], encoded));
}

async function lookUpLinux(): Promise<Buffer> {
  return run(SECRET_TOOL, ["lookup", ...SECRET_TOOL_ATTRIBUTES], Buffer.alloc(0));
}

export function createOsKeyProtector(): KeyProtector {
  const platform = process.platform;
  let availability: boolean | undefined;

  const check = async (): Promise<boolean> => {
    if (platform === "win32") return (await windowsBinary()) !== undefined;

    if (platform === "linux") {
      try {
        await lookUpLinux();
        return true;
      } catch (error) {
        // A missing `secret-tool` is unavailable. A lookup that ran and simply
        // found no stored key is not: the first write has to be able to store
        // one, so only the spawn failing leaves the facility unusable.
        return !(error instanceof SpawnFailure);
      }
    }

    return false;
  };

  return {
    async available() {
      availability ??= await check();
      return availability;
    },

    async wrap(key) {
      if (platform === "win32") {
        return protectWindows(key, WINDOWS_PROTECT);
      }

      if (platform === "linux") {
        // `secret-tool store` reads the secret from stdin and prints nothing;
        // the key lives in the keyring, not in `secret.key`. The returned
        // marker is not key material.
        await run(
          SECRET_TOOL,
          ["store", "--label", "Yunari secret key", ...SECRET_TOOL_ATTRIBUTES],
          Buffer.from(Buffer.from(key).toString("base64"), "utf8"),
        );
        return Buffer.alloc(0);
      }

      throw new Error("No OS key protector on this platform.");
    },

    async unwrap(wrapped) {
      if (platform === "win32") {
        return protectWindows(wrapped, WINDOWS_UNPROTECT);
      }

      if (platform === "linux") {
        return decode(await lookUpLinux());
      }

      throw new Error("No OS key protector on this platform.");
    },
  };
}
