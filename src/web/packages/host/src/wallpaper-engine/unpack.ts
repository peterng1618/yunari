import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import type { LibraryItem } from "./library.js";
import type { WallpaperEngineInstall } from "./locate.js";
import { memberBytes, readScenePackage } from "./pkg.js";
import { insideOf } from "./resolve.js";

/**
 * A subscribed `scene.pkg` written out as an editable project (§8, step 2).
 * The package is a table walk and a byte copy — no decompression, no `.tex`
 * decoding — and the descriptor is the item's own with `file` switched to the
 * member the editor opens.
 */

export type UnpackResult =
  | { readonly ok: true; readonly name: string; readonly reused: boolean }
  | {
      readonly ok: false;
      readonly reason: "no-install" | "unreadable" | "refused";
    };

/** `project()` adds whether the editor process actually spawned. */
export type ProjectResult =
  | {
      readonly ok: true;
      readonly name: string;
      readonly reused: boolean;
      readonly launched: boolean;
    }
  | {
      readonly ok: false;
      readonly reason: "no-install" | "unreadable" | "refused";
    };

export interface ExportFile {
  readonly name: string;
  readonly format: "png" | "mp4";
  readonly modified: number;
  readonly size: number;
}

/** A workshop id names one directory and nothing else; anything else is refused
 *  before a path exists. */
const DIRECTORY_NAME = /^[A-Za-z0-9]+$/;

/** A Windows drive prefix, which `path.isAbsolute` misses for `C:name`. */
const DRIVE = /^[A-Za-z]:/;

/** The member the editor opens, and the one whose presence makes the rewritten
 *  descriptor honest. */
const SCENE_MEMBER = "scene.json";

/**
 * Where a member may be written, or `undefined` for a name that is not a safe
 * relative path. A member name is third-party data: real packages nest members
 * under `/` (`materials/sky.tex`) and never use `\`, so nesting is allowed and
 * reuse is refused rather than sanitised — an absolute path, a drive letter, a
 * backslash, or an empty/`.`/`..` segment answers `unreadable` and leaves
 * nothing behind.
 */
function memberTarget(directory: string, name: string): string | undefined {
  const segments = name.split("/");

  if (
    name === "" ||
    name.includes("\\") ||
    DRIVE.test(name) ||
    path.isAbsolute(name) ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    return undefined;
  }

  const target = path.resolve(directory, ...segments);
  return insideOf(directory, target) ? target : undefined;
}

function descriptorOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Every member, then the descriptor; throws on anything that makes the project
 *  incomplete, and the caller removes the directory it created. */
async function writeProject(
  item: LibraryItem,
  directory: string,
): Promise<void> {
  const pkg = readScenePackage(await fs.readFile(item.payload));
  if (pkg === undefined || !pkg.members.has(SCENE_MEMBER)) {
    throw new Error("unreadable scene package");
  }

  const descriptor = descriptorOf(
    JSON.parse(
      await fs.readFile(path.join(item.directory, "project.json"), "utf8"),
    ),
  );
  if (descriptor === undefined) {
    throw new Error("unreadable project descriptor");
  }

  const targets = new Map<string, string>();
  for (const name of pkg.members.keys()) {
    const target = memberTarget(directory, name);
    if (target === undefined) {
      throw new Error(`refused member name: ${name}`);
    }
    targets.set(name, target);
  }

  for (const [name, target] of targets) {
    const bytes = memberBytes(pkg, name);
    if (bytes === undefined) {
      throw new Error(`missing member: ${name}`);
    }
    // Inside the directory this run created, so a nested member's parents are
    // this run's to make; `recursive` never escapes it.
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
  }

  // The one packed-only field: a subscribed project says `scene.pkg`, while a
  // source project — the shape the editor opens — says `scene.json`.
  await fs.writeFile(
    path.join(directory, "project.json"),
    JSON.stringify({ ...descriptor, file: SCENE_MEMBER }, null, 2),
    "utf8",
  );
}

/**
 * Writes one item's package under `projects/myprojects/<workshopId>/`. Never
 * launches, never removes a directory it did not create: `EEXIST` is the reuse
 * branch, and any failure after this run's `mkdir` removes only that directory.
 */
export async function unpackScene(
  install: WallpaperEngineInstall,
  item: LibraryItem,
): Promise<UnpackResult> {
  const name = item.workshopId;
  if (!DIRECTORY_NAME.test(name)) {
    return { ok: false, reason: "refused" };
  }

  const directory = path.join(install.myProjects, name);

  try {
    // Not `recursive`: the parent is the install's own `myprojects`, and its
    // absence is a refusal rather than a tree this route creates.
    await fs.mkdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return { ok: true, name, reused: true };
    }
    return { ok: false, reason: "refused" };
  }

  try {
    await writeProject(item, directory);
  } catch {
    await fs
      .rm(directory, { recursive: true, force: true })
      .catch(() => undefined);
    return { ok: false, reason: "unreadable" };
  }

  return { ok: true, name, reused: false };
}

/**
 * Starts the editor on an unpacked project and settles when the process has
 * spawned (`true`) or failed to (`false`). It never waits for the editor to
 * run, sends it nothing and polls nothing (R1). No stdin, and no arguments
 * after the launch.
 */
export function launchEditor(
  install: WallpaperEngineInstall,
  projectDirectory: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;

    try {
      child = spawn(install.editor, ["-project", projectDirectory], {
        detached: true,
        stdio: "ignore",
      });
    } catch {
      // A synchronous throw (an invalid command) never spawned anything.
      resolve(false);
      return;
    }

    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
    // `ENOENT` arrives here rather than throwing, and an unhandled `error`
    // event would take the host down — so it is the answer, not a crash.
    child.once("error", () => {
      resolve(false);
    });
  });
}
