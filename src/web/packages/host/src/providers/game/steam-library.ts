import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { powershellPath } from "../helpers/supervisor.js";

/**
 * Steam's local library, read from the files Steam itself writes.
 *
 * `libraryfolders.vdf` and `appmanifest_*.acf` are Valve KeyValues text. Only a
 * handful of fields are read, so the reader below owns the grammar rather than
 * adding a dependency. The Steam root comes from HKCU through
 * PowerShell: Node has no registry API and a native addon is not allowed.
 */

export interface SteamApp {
  readonly appId: string;
  readonly name: string;
  /** Absolute `<library>\steamapps\common\<installdir>`. */
  readonly installDir: string;
}

type VdfValue = string | VdfObject;
interface VdfObject {
  readonly [key: string]: VdfValue;
}

const INVALID = undefined;

function isObject(value: VdfValue | undefined): value is VdfObject {
  return typeof value === "object" && value !== null;
}

/** Index just past the next non-space, non-comment character. */
class VdfReader {
  readonly #text: string;
  #at = 0;

  constructor(text: string) {
    this.#text = text;
  }

  #skip(): void {
    while (this.#at < this.#text.length) {
      const char = this.#text[this.#at];

      if (
        char === " " ||
        char === "\t" ||
        char === "\r" ||
        char === "\n" ||
        char === "\uFEFF"
      ) {
        this.#at += 1;
        continue;
      }

      if (char === "/" && this.#text[this.#at + 1] === "/") {
        const end = this.#text.indexOf("\n", this.#at + 2);
        this.#at = end === -1 ? this.#text.length : end + 1;
        continue;
      }

      break;
    }
  }

  #string(): string | undefined {
    if (this.#text[this.#at] !== '"') return INVALID;
    this.#at += 1;

    let value = "";
    while (this.#at < this.#text.length) {
      const char = this.#text[this.#at];

      if (char === '"') {
        this.#at += 1;
        return value;
      }

      if (char === "\\") {
        const next = this.#text[this.#at + 1];

        if (next === undefined) return INVALID;
        value += next === "n" ? "\n" : next === "t" ? "\t" : next;
        this.#at += 2;
        continue;
      }

      value += char;
      this.#at += 1;
    }

    return INVALID;
  }

  #pairs(untilBrace: boolean): VdfObject | undefined {
    const out: Record<string, string | VdfObject> = {};

    while (true) {
      this.#skip();
      const char = this.#text[this.#at];

      if (char === undefined) return untilBrace ? INVALID : out;

      if (char === "}") {
        if (!untilBrace) return INVALID;
        this.#at += 1;
        return out;
      }

      const key = this.#string();
      if (key === undefined) return INVALID;

      this.#skip();
      const kind = this.#text[this.#at];

      if (kind === '"') {
        const value = this.#string();
        if (value === undefined) return INVALID;
        out[key] = value;
        continue;
      }

      if (kind === "{") {
        this.#at += 1;
        const value = this.#pairs(true);
        if (value === undefined) return INVALID;
        out[key] = value;
        continue;
      }

      return INVALID;
    }
  }

  read(): VdfObject | undefined {
    const value = this.#pairs(false);
    this.#skip();
    return value !== undefined && this.#at === this.#text.length
      ? value
      : INVALID;
  }
}

function parseVdf(text: string): VdfObject | undefined {
  return new VdfReader(text).read();
}

function uniquePaths(paths: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of paths) {
    if (value === "") continue;
    const key = path.win32.normalize(value).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }

  return out;
}

/**
 * The library paths a `libraryfolders.vdf` lists. The modern shape nests a
 * `"path"` under each numbered entry; the older one maps the number straight to
 * a path. A file that cannot be parsed leaves the Steam root as its own
 * library.
 */
export function parseLibraryFolders(
  vdf: string,
  steamRoot: string,
): readonly string[] {
  const root = parseVdf(vdf);
  const folders = root?.["libraryfolders"];

  if (!isObject(folders)) return [steamRoot];

  const listed: string[] = [];

  for (const [key, value] of Object.entries(folders)) {
    if (typeof value === "string") {
      // The older shape numbers its libraries; other keys are metadata.
      if (/^\d+$/.test(key)) listed.push(value);
      continue;
    }

    const folder = isObject(value) ? value["path"] : undefined;
    if (typeof folder === "string") listed.push(folder);
  }

  const unique = uniquePaths(listed);
  return unique.length === 0 ? [steamRoot] : unique;
}

/** One manifest's fields, with `installdir` exactly as Steam wrote it. */
export function parseAppManifest(
  acf: string,
): { appId: string; name: string; installDir: string } | undefined {
  const root = parseVdf(acf);
  const state = root?.["AppState"];

  if (!isObject(state)) return undefined;

  const appId = state["appid"];
  const name = state["name"];
  const installDir = state["installdir"];

  if (typeof appId !== "string" || appId.trim() === "") return undefined;
  if (typeof name !== "string" || name.trim() === "") return undefined;
  if (typeof installDir !== "string" || installDir.trim() === "") {
    return undefined;
  }

  return {
    appId: appId.trim(),
    name: name.trim(),
    installDir: installDir.trim(),
  };
}

function folded(target: string): string {
  return path.win32.normalize(target).toLowerCase();
}

/**
 * The app whose `installDir` contains this executable, if any. Containment is
 * a segment check with Windows semantics: a prefix test would put
 * `...\Half-Life2\hl2.exe` inside `...\Half-Life`.
 */
export function matchProcess(
  executablePath: string,
  apps: readonly SteamApp[],
): SteamApp | undefined {
  const executable = folded(executablePath);
  let best: SteamApp | undefined;
  let bestLength = -1;

  for (const app of apps) {
    if (!path.win32.isAbsolute(app.installDir)) continue;

    let directory = folded(app.installDir);
    if (!directory.endsWith("\\")) directory += "\\";

    if (executable.startsWith(directory) && directory.length > bestLength) {
      best = app;
      bestLength = directory.length;
    }
  }

  return best;
}

async function readText(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Every installed Steam app this machine's libraries describe. A missing or
 * unreadable file is skipped: an absent Steam install is no apps, not an error.
 */
export async function readSteamApps(
  steamRoot: string,
): Promise<readonly SteamApp[]> {
  const rootVdf = path.win32.join(steamRoot, "steamapps", "libraryfolders.vdf");
  const vdf = await readText(rootVdf);
  const listed =
    vdf === undefined ? [steamRoot] : parseLibraryFolders(vdf, steamRoot);
  const libraries = uniquePaths([steamRoot, ...listed]);
  const apps: SteamApp[] = [];
  const seen = new Set<string>();

  for (const library of libraries) {
    const appsDir = path.win32.join(library, "steamapps");
    let entries: readonly Dirent[];

    try {
      entries = await fs.readdir(appsDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!/^appmanifest_\d+\.acf$/i.test(entry.name)) continue;

      const text = await readText(path.win32.join(appsDir, entry.name));
      const manifest = text === undefined ? undefined : parseAppManifest(text);

      if (manifest === undefined || seen.has(manifest.appId)) continue;
      seen.add(manifest.appId);

      apps.push({
        appId: manifest.appId,
        name: manifest.name,
        installDir: path.win32.join(appsDir, "common", manifest.installDir),
      });
    }
  }

  return apps;
}

const STEAM_ROOT_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$value = (Get-ItemProperty -Path 'HKCU:\\Software\\Valve\\Steam' -Name SteamPath -ErrorAction SilentlyContinue).SteamPath
if ($null -ne $value -and "$value" -ne '') {
  $line = [ordered]@{ kind = 'steam'; root = [string]$value }
  [Console]::Out.WriteLine(($line | ConvertTo-Json -Compress))
}
`;

/** Runs PowerShell and answers its stdout, or `undefined` when it failed. */
export type SteamRootExec = (
  executable: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<string | undefined>;

function runPowerShell(
  executable: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      executable,
      args,
      { windowsHide: true, timeout: timeoutMs, encoding: "utf8" },
      (error, stdout) => {
        resolve(error ? undefined : stdout);
      },
    );
  });
}

/** The root from the helper's first `{"kind":"steam"}` line. */
function steamRootFrom(output: string | undefined): string | undefined {
  if (output === undefined) return undefined;

  for (const line of output.split(/\r?\n/)) {
    let parsed: unknown;

    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (typeof parsed !== "object" || parsed === null) continue;

    const record = parsed as Record<string, unknown>;
    const root = record["root"];

    if (record["kind"] === "steam" && typeof root === "string" && root !== "") {
      return root;
    }
  }

  return undefined;
}

export interface SteamRootOptions {
  /** Injected so a test does not depend on this machine's registry. */
  readonly pathExists?: (file: string) => boolean;
  readonly timeoutMs?: number;
  readonly exec?: SteamRootExec;
}

/**
 * Steam's root from HKCU, looked up once per demand window by the provider.
 * An absent key, absent PowerShell or a failed run is `undefined`, not a
 * failure.
 */
export function resolveSteamRoot(
  options: SteamRootOptions = {},
): Promise<string | undefined> {
  const executable = powershellPath(options.pathExists);

  if (executable === undefined) return Promise.resolve(undefined);

  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    Buffer.from(STEAM_ROOT_SCRIPT, "utf16le").toString("base64"),
  ];

  const run = options.exec ?? runPowerShell;

  return run(executable, args, options.timeoutMs ?? 10_000).then(
    steamRootFrom,
    () => undefined,
  );
}
