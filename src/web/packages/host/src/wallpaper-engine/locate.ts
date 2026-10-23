import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Where Wallpaper Engine is, and every Steam library that holds workshop items
 * for it (§1.1). Nothing here is Windows-only by intent, but the install is:
 * the registry is the only offline way to find Steam, and `wallpaperui.exe` is
 * the install's own proof that it is there.
 */

export interface WallpaperEngineInstall {
  /** `<steam>/steamapps/common/wallpaper_engine` */
  readonly root: string;
  /** `<library>/steamapps/workshop/content/431960`, one per Steam library. */
  readonly libraries: readonly string[];
  /** `<root>/projects/myprojects` */
  readonly myProjects: string;
  /** `<root>/bin/wallpaperui.exe` */
  readonly editor: string;
}

/** Wallpaper Engine's Steam app id, and so its workshop content directory. */
const APP_ID = "431960";
const STEAM_KEY = "HKCU\\Software\\Valve\\Steam";
const PROGRAM_FILES = [
  "C:\\Program Files (x86)\\Steam",
  "C:\\Program Files\\Steam",
];

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

/** `reg query … /v SteamPath`, resolving with its output or `undefined`. */
function steamPathOutput(): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "reg",
      ["query", STEAM_KEY, "/v", "SteamPath"],
      { windowsHide: true, timeout: 10_000 },
      (error, stdout) => {
        resolve(error ? undefined : stdout);
      },
    );
  });
}

function steamPathFrom(output: string): string | undefined {
  const match = /SteamPath\s+REG_SZ\s+(.+)/.exec(output);
  const value = match?.[1]?.trim().replace(/^"(.*)"$/, "$1");
  return value === undefined || value === "" ? undefined : value;
}

/**
 * The `"path"` values of a `libraryfolders.vdf`, read line by line. The format
 * is Valve's KeyValues; every line this needs is one quoted pair, so there is
 * no grammar here and nothing to depend on. A path holding an escaped
 * backslash is read as written — Windows treats the doubled separator as one.
 */
async function libraryRoots(vdf: string): Promise<readonly string[]> {
  let text: string;
  try {
    text = await fs.readFile(vdf, "utf8");
  } catch {
    return [];
  }

  const roots: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*"path"\s+"(.+)"\s*$/.exec(line);
    if (match?.[1] !== undefined) {
      roots.push(match[1]);
    }
  }
  return roots;
}

/** A candidate install and the Steam root its libraries are listed from. */
interface Candidate {
  readonly root: string;
  readonly steamRoot: string;
}

async function candidates(
  env: NodeJS.ProcessEnv,
): Promise<readonly Candidate[]> {
  const hook = env.YUNARI_WALLPAPER_ENGINE;
  if (hook !== undefined && hook !== "") {
    // The test hook, and the only candidate when it is set: falling through to
    // the registry would make a case that asserts "no install" read this PC's.
    const root = path.resolve(hook);
    return [{ root, steamRoot: path.resolve(root, "..", "..", "..") }];
  }

  const fromReg = steamPathFrom((await steamPathOutput()) ?? "");
  const steamRoots =
    fromReg === undefined ? PROGRAM_FILES : [fromReg, ...PROGRAM_FILES];

  return steamRoots.map((steamRoot) => ({
    root: path.join(steamRoot, "steamapps", "common", "wallpaper_engine"),
    steamRoot,
  }));
}

/**
 * The install and its libraries, or `undefined` when there is none. Off
 * Windows this answers immediately: there is no registry to query and the
 * paths below do not exist, so nothing is touched.
 */
export async function locateInstall(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<WallpaperEngineInstall | undefined> {
  if (platform !== "win32") {
    return undefined;
  }

  for (const { root, steamRoot } of await candidates(env)) {
    const editor = path.join(root, "bin", "wallpaperui.exe");
    if (!(await exists(editor))) {
      continue;
    }

    const libraries: string[] = [];
    // Windows paths are case-insensitive, so the same library arrives spelled
    // two ways: the Steam root as the registry gave it, and again as the vdf
    // lists it. The key is folded; the first spelling is the one returned.
    const seen = new Set<string>();
    const listed = await libraryRoots(
      path.join(steamRoot, "steamapps", "libraryfolders.vdf"),
    );
    // The Steam root is a library of its own, and older `libraryfolders.vdf`
    // files do not list it.
    for (const libraryRoot of [steamRoot, ...listed]) {
      const content = path.join(
        libraryRoot,
        "steamapps",
        "workshop",
        "content",
        APP_ID,
      );
      const key = content.toLowerCase();
      if (!seen.has(key) && (await exists(content))) {
        seen.add(key);
        libraries.push(content);
      }
    }

    return {
      root,
      libraries,
      myProjects: path.join(root, "projects", "myprojects"),
      editor,
    };
  }

  return undefined;
}
