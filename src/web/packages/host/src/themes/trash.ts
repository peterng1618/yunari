import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Moving a theme to the operating system's trash, which is the recovery the
 * delete is built on: a theme is a folder of authored work on disk (ADR-0017),
 * so removing it is not a cleanup. The searches behind each route are why
 * nothing here is `fs.rm`.
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
  /** Paths the runner writes to `listPath` before running: the arguments
   *  reference the file rather than carrying them (Windows' command line is
   *  bounded). Omitted when the arguments carry the paths themselves. */
  readonly list?: readonly string[];
  readonly listPath?: string;
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
    options?: {
      readonly code?: string | number | undefined;
      readonly cause?: unknown;
    },
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
 * so the kind is a platform fact, not a caller's convenience.
 *
 * A short list is one statement per target in one script. A long one cannot be:
 * Windows refuses a command line over 32,767 characters, and the store's own
 * 128-asset cap measured 35,185 inline. Past the budget the paths travel one
 * per line in a file the runner writes, and PowerShell reads that instead.
 */
/** Well below the 32,767-character limit, with room for the executable and the
 *  rest of the argument list. */
const MAX_INLINE_WINDOWS_CHARS = 8_000;

function windows(targets: readonly string[], kind: TrashTarget): TrashRoute {
  // `Add-Type` and then one call per target. The separators belong between the
  // statements, never inside a call's argument list — a `;` after the opening
  // paren made PowerShell read the path as its own statement and fail to parse,
  // so the Windows route had never run. It was asserted as a string and never
  // executed.
  const method = kind === "file" ? "DeleteFile" : "DeleteDirectory";
  const call = (target: string) =>
    `[Microsoft.VisualBasic.FileIO.FileSystem]::${method}(` +
    // A single-quoted PowerShell literal escapes by doubling, which is what
    // a `--themes-dir` holding an apostrophe needs.
    `'${target.replaceAll("'", "''")}'` +
    ", [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs" +
    ", [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)";

  const inline = `Add-Type -AssemblyName Microsoft.VisualBasic; ${targets
    .map(call)
    .join("; ")}`;

  if (inline.length <= MAX_INLINE_WINDOWS_CHARS) {
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-Command", inline],
    };
  }

  const listPath = path.join(
    os.tmpdir(),
    `yunari-trash-${randomUUID()}`,
    "paths.txt",
  );
  const script =
    "Add-Type -AssemblyName Microsoft.VisualBasic; " +
    // Windows PowerShell 5.1's `Get-Content` reads the ANSI code page unless
    // told otherwise, so a UTF-8 list read `café.woff2` back as
    // `cafÃ©.woff2` and deleted a path that does not exist.
    `Get-Content -Encoding UTF8 -LiteralPath '${listPath.replaceAll("'", "''")}' | ` +
    "ForEach-Object { " +
    `[Microsoft.VisualBasic.FileIO.FileSystem]::${method}($_, ` +
    "[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, " +
    "[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin) }";

  return {
    command: "powershell.exe",
    args: ["-NoProfile", "-NonInteractive", "-Command", script],
    list: targets,
    listPath,
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
 * Takes one target or a list; a list is one route per platform, which is fewer
 * processes and one refusal sentence — not atomicity (a partial move is
 * reported as a failure and the caller prunes nothing). Linux answers with
 * several routes, because "is `gio` installed" is not a question this process
 * can answer without running it, and a machine with no desktop session has
 * `trash-put` instead.
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

/** Runs one route, writing its list file first when it carries one. */
async function runRoute(route: TrashRoute): Promise<void> {
  // Only a path `trashPlan` made is swept: the seam takes a caller's route, and
  // `path.dirname("paths.txt")` is `"."`.
  const temporary =
    route.listPath !== undefined && path.isAbsolute(route.listPath)
      ? path.dirname(route.listPath)
      : undefined;

  try {
    if (
      temporary !== undefined &&
      route.listPath !== undefined &&
      route.list !== undefined
    ) {
      try {
        await fs.mkdir(temporary, { recursive: true });
        await fs.writeFile(
          route.listPath,
          `${route.list.join("\n")}\n`,
          "utf8",
        );
      } catch (error: unknown) {
        // A list file this host could not write is not a missing command. The
        // message carries no `code`, so the loop cannot read it as `ENOENT`
        // and fall through to the next route.
        throw new Error(
          `The trash list file could not be written: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    await new Promise<void>((resolve, reject) => {
      execFile(
        route.command,
        [...route.args],
        // A host that has no window of its own must not flash one.
        { windowsHide: true, timeout: 30_000 },
        (error, _stdout, stderr) => {
          if (error) {
            // The code is the whole reason the Linux fallthrough works: `gio`
            // missing is `ENOENT`, and a plain Error would make every refusal
            // look like a platform refusal.
            reject(
              new TrashRefusal(stderr.trim() || error.message, {
                code: (error as NodeJS.ErrnoException).code,
                cause: error,
              }),
            );
            return;
          }
          resolve();
        },
      );
    });
  } finally {
    if (temporary !== undefined) {
      await fs
        .rm(temporary, { recursive: true, force: true })
        .catch(() => undefined);
    }
  }
}

type TrashRunner = (route: TrashRoute) => Promise<void>;

/**
 * Runs a plan's routes in order, falling through only when a command is not
 * installed.
 *
 * Exported so a test can inject a runner: "is `gio` installed" is not a fact a
 * test can arrange on the machine it runs on, and a dropped error code here
 * silently disabled the Linux `trash-put` fallback.
 */
export async function runTrashRoutes(
  routes: readonly TrashRoute[],
  kind: TrashTarget,
  execute: TrashRunner = runRoute,
): Promise<void> {
  let last: string | undefined;
  for (const route of routes) {
    try {
      await execute(route);
      return;
    } catch (error: unknown) {
      // Only a command that is not installed is worth trying the next route
      // for. Anything else is the platform refusing, and its reason is the one
      // the author needs.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      last = `${route.command}: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  }

  throw new TrashRefusal(
    `This PC has no trash command (${routes
      .map((route) => route.command)
      .join(", ")}), so the ${
      kind === "file" ? "file was" : "theme was"
    } left alone rather than deleted permanently.`,
    last === undefined ? undefined : { cause: last },
  );
}

/**
 * Moves a list of targets to the trash, and throws when it cannot.
 *
 * There is deliberately no fallback to a permanent delete. A refused delete is
 * recoverable and a missing feature is a small thing; a silent `fs.rm` of the
 * only copy of an author's theme is the defect this exists to prevent, and it
 * would come back on exactly the machines nobody tested.
 *
 * The whole list goes to one route invocation, which is about fewer processes
 * and one refusal sentence, not atomicity: a multi-statement script and
 * Finder's list can both stop part-way. That is acceptable because the staged
 * copies are disposable and the editor still holds the bytes — a partial move
 * is reported as a failure, and the caller prunes nothing.
 */
async function trashTargets(
  targets: readonly string[],
  kind: TrashTarget,
): Promise<void> {
  if (targets.length === 0) return;

  const plan = trashPlan(process.platform, targets, kind);
  if (!plan.ok) {
    throw new TrashRefusal(plan.reason);
  }

  await runTrashRoutes(plan.routes, kind);
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
