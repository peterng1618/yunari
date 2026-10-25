import { execFile } from "node:child_process";

/**
 * Moving a theme to the operating system's trash, which is the recovery the
 * delete is built on: a theme is a folder of authored work on disk (ADR-0017),
 * so removing it is not a cleanup. See `docs/decisions/0021` for the searches
 * behind each route and why nothing here is `fs.rm`.
 *
 * Node has no trash API at any version — `fs.trash` and `fsPromises.trash` are
 * both `undefined` on Node 24 — and the host takes no runtime dependency
 * (`packages/host/package.json`, `"//"`). So each platform is reached by the
 * mechanism it already ships, and by nothing else.
 */

/** A process to run, and what to run it on. */
export interface TrashRoute {
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * A refusal to move a folder to the trash.
 *
 * **Typed because its words name the folder.** The route that answers a caller
 * must tell "the platform refused" from "the store's own rule refused", and the
 * errno alone cannot: a failed `execFile` rejects with a plain `Error` carrying
 * stderr or `Command failed: … '<path>'`, no `code`. This class is the second
 * platform shape `server.ts` recognises, so the path stays in the log.
 */
export class TrashRefusal extends Error {
  /** The child process's errno, when it had one: `ENOENT` is what lets the
   *  Linux route list try its next command instead of giving up. */
  readonly code: string | number | undefined;

  constructor(
    message: string,
    options?: { readonly code?: string | number; readonly cause?: unknown },
  ) {
    super(
      message,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.code = options?.code;
  }
}

/** AppleScript string literals escape a backslash before the quote. */
function appleScriptString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/**
 * Windows: the Shell's own recycle path, through the VisualBasic runtime that
 * ships in Windows PowerShell. `SHFileOperation` with `FOF_ALLOWUNDO` is the
 * real API and has no Node binding; this is what the `trash` package's own
 * 28 KB `windows-trash.exe` does. The enum is `RecycleOption` —
 * `RecycleBinOption` does not exist, and naming it fails at run time.
 */
function windows(folder: string): TrashRoute {
  // Two statements, not five: `Add-Type` and then ONE method call. The
  // separators belong between the statements, never inside the call's
  // argument list — a `;` after the opening paren made PowerShell read the
  // path as its own statement and fail to parse, so the Windows route had
  // never run. It was asserted as a string and never executed.
  const call =
    "[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(" +
    // A single-quoted PowerShell literal escapes by doubling, which is what
    // a `--themes-dir` holding an apostrophe needs.
    `'${folder.replaceAll("'", "''")}'` +
    ", [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs" +
    ", [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)";

  return {
    command: "powershell.exe",
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Add-Type -AssemblyName Microsoft.VisualBasic; " + call,
    ],
  };
}

/**
 * macOS: the Finder route rather than `NSFileManager.trashItem`, which needs a
 * native binary. Finder costs a TCC Automation prompt on first use and is what
 * buys **Put Back** — the folder comes back where it was, which is the whole
 * claim the delete makes. `NSFileManager` gives neither that nor a binary the
 * host is allowed to ship.
 */
function macos(folder: string): TrashRoute {
  return {
    command: "osascript",
    args: [
      "-e",
      `tell application "Finder" to delete POSIX file ${appleScriptString(folder)}`,
    ],
  };
}

/** What each Linux route would run, in the order it would be tried. */
function linux(folder: string): readonly TrashRoute[] {
  return [
    // `gio` is GIO's `g_file_trash`, the desktop's own implementation of the
    // freedesktop.org specification. It takes the path positionally.
    { command: "gio", args: ["trash", folder] },
    // `trash-put` from trash-cli, and the only route on a machine with no
    // desktop session. It takes `--`, so a `--themes-dir` beginning with a dash
    // is a path rather than an option.
    { command: "trash-put", args: ["--", folder] },
  ];
}

/** What this platform's trash is reached by, or why it has none. */
type TrashPlan =
  | { readonly ok: true; readonly routes: readonly TrashRoute[] }
  | { readonly ok: false; readonly reason: string };

/**
 * The routes this platform's own trash is reached by, in the order they would
 * be tried, or the reason there are none.
 *
 * Linux answers with several, because "is `gio` installed" is not a question
 * this process can answer without running it, and a machine with no desktop
 * session has `trash-put` instead.
 */
export function trashPlan(
  platform: NodeJS.Platform,
  folder: string,
): TrashPlan {
  switch (platform) {
    case "win32":
      return { ok: true, routes: [windows(folder)] };
    case "darwin":
      return { ok: true, routes: [macos(folder)] };
    case "linux":
      return { ok: true, routes: linux(folder) };
    default:
      return {
        ok: false,
        reason:
          `Moving a theme to the trash is not implemented for ${platform}, so ` +
          "the theme was left alone rather than deleted permanently.",
      };
  }
}

/** A trash operation, run as a child process, resolving with its stderr. */
function run(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      // A host that has no window of its own must not flash one.
      { windowsHide: true, timeout: 30_000 },
      (error, _stdout, stderr) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException).code;

          reject(
            new TrashRefusal(stderr.trim() || error.message, {
              ...(code === undefined ? {} : { code }),
              cause: error,
            }),
          );
          return;
        }
        resolve(stderr);
      },
    );
  });
}

/**
 * Moves a folder to the trash, and throws when it cannot.
 *
 * There is deliberately no fallback to a permanent delete. A refused delete is
 * recoverable and a missing feature is a small thing; a silent `fs.rm` of the
 * only copy of an author's theme is the defect this exists to prevent, and it
 * would come back on exactly the machines nobody tested.
 */
export async function moveToTrash(
  folder: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const plan = trashPlan(platform, folder);
  if (!plan.ok) {
    throw new TrashRefusal(plan.reason);
  }

  let last: string | undefined;
  for (const { command, args } of plan.routes) {
    try {
      await run(command, args);
      return;
    } catch (error: unknown) {
      // Only a command that is not installed is worth trying the next route
      // for. Anything else is the platform refusing, and its reason is the one
      // the author needs.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      last = `${command}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  throw new TrashRefusal(
    `This PC has no trash command (${plan.routes
      .map((route) => route.command)
      .join(
        ", ",
      )}), so the theme was left alone rather than deleted permanently.`,
    last === undefined ? undefined : { cause: last },
  );
}
