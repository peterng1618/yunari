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

/** AppleScript string literals escape a backslash before the quote. */
function appleScriptString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** What a trash route is asked to take: a theme's folder, or one asset file. */
export type TrashTarget = "folder" | "file";

/**
 * Windows: the Shell's own recycle path, through the VisualBasic runtime that
 * ships in Windows PowerShell. `SHFileOperation` with `FOF_ALLOWUNDO` is the
 * real API and has no Node binding; this is what the `trash` package's own
 * 28 KB `windows-trash.exe` does. The enum is `RecycleOption` —
 * `RecycleBinOption` does not exist, and naming it fails at run time.
 *
 * The VisualBasic call names what it takes — `DeleteDirectory` or `DeleteFile` —
 * so the kind is a platform fact, not a caller's convenience. Every target is
 * one `DeleteFile` statement in the same script, so a refusal is one process's
 * answer for the whole list.
 */
function windows(targets: readonly string[], kind: TrashTarget): TrashRoute {
  // `Add-Type` and then one call per target. The separators belong between the
  // statements, never inside a call's argument list — a `;` after the opening
  // paren made PowerShell read the path as its own statement and fail to parse,
  // so the Windows route had never run. It was asserted as a string and never
  // executed.
  const method = kind === "file" ? "DeleteFile" : "DeleteDirectory";
  const calls = targets.map(
    (target) =>
      `[Microsoft.VisualBasic.FileIO.FileSystem]::${method}(` +
      // A single-quoted PowerShell literal escapes by doubling, which is what
      // a `--themes-dir` holding an apostrophe needs.
      `'${target.replaceAll("'", "''")}'` +
      ", [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs" +
      ", [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)",
  );

  return {
    command: "powershell.exe",
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Add-Type -AssemblyName Microsoft.VisualBasic; ${calls.join("; ")}`,
    ],
  };
}

/**
 * macOS: the Finder route rather than `NSFileManager.trashItem`, which needs a
 * native binary. Finder costs a TCC Automation prompt on first use and is what
 * buys **Put Back** — the folder comes back where it was, which is the whole
 * claim the delete makes. `NSFileManager` gives neither that nor a binary the
 * host is allowed to ship.
 *
 * One `delete` takes a list, so the whole set is one automation answer.
 */
function macos(targets: readonly string[]): TrashRoute {
  const files = targets.map(
    (target) => `POSIX file ${appleScriptString(target)}`,
  );
  const script =
    files.length === 1
      ? `tell application "Finder" to delete ${files[0] ?? ""}`
      : `tell application "Finder" to delete {${files.join(", ")}}`;

  return { command: "osascript", args: ["-e", script] };
}

/** What each Linux route would run, in the order it would be tried. */
function linux(targets: readonly string[]): readonly TrashRoute[] {
  return [
    // `gio` is GIO's `g_file_trash`, the desktop's own implementation of the
    // freedesktop.org specification. It takes every path positionally.
    { command: "gio", args: ["trash", ...targets] },
    // `trash-put` from trash-cli, and the only route on a machine with no
    // desktop session. It takes `--`, so a `--themes-dir` beginning with a dash
    // is a path rather than an option.
    { command: "trash-put", args: ["--", ...targets] },
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
 * Takes one target or a list; a list is one route per platform, because a
 * refusal part-way through a list must not leave the earlier targets already
 * moved. Linux answers with several routes, because "is `gio` installed" is not
 * a question this process can answer without running it, and a machine with no
 * desktop session has `trash-put` instead.
 */
export function trashPlan(
  platform: NodeJS.Platform,
  targets: string | readonly string[],
  kind: TrashTarget = "folder",
): TrashPlan {
  const list = typeof targets === "string" ? [targets] : targets;

  switch (platform) {
    case "win32":
      return { ok: true, routes: [windows(list, kind)] };
    case "darwin":
      return { ok: true, routes: [macos(list)] };
    case "linux":
      return { ok: true, routes: linux(list) };
    default:
      return {
        ok: false,
        reason:
          (kind === "file"
            ? "Moving an asset to the trash is not implemented for "
            : "Moving a theme to the trash is not implemented for ") +
          `${platform}, so the ${
            kind === "file" ? "files were" : "theme was"
          } left alone rather than deleted permanently.`,
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
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(stderr);
      },
    );
  });
}

/**
 * Moves a list of targets to the trash, and throws when it cannot.
 *
 * There is deliberately no fallback to a permanent delete. A refused delete is
 * recoverable and a missing feature is a small thing; a silent `fs.rm` of the
 * only copy of an author's theme is the defect this exists to prevent, and it
 * would come back on exactly the machines nobody tested.
 *
 * The whole list is one invocation per platform route: a refusal on the Nth
 * target must not leave the first N-1 already moved to the trash.
 */
async function trashTargets(
  targets: readonly string[],
  kind: TrashTarget,
): Promise<void> {
  if (targets.length === 0) return;

  const plan = trashPlan(process.platform, targets, kind);
  if (!plan.ok) {
    throw new Error(plan.reason);
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

  throw new Error(
    `This PC has no trash command (${plan.routes
      .map((route) => route.command)
      .join(", ")}), so the ${
      kind === "file" ? "file was" : "theme was"
    } left alone rather than deleted permanently.`,
    last === undefined ? undefined : { cause: last },
  );
}

/** Moves a theme's folder to the trash. */
export async function moveToTrash(folder: string): Promise<void> {
  await trashTargets([folder], "folder");
}

/** Moves files to the trash, as one invocation for the whole list. */
export async function moveFilesToTrash(
  paths: readonly string[],
): Promise<void> {
  await trashTargets(paths, "file");
}
