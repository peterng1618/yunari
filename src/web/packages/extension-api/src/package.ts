import { readPackageArchive } from "@yunari/theme-package";
import {
  PLUGIN_MANIFEST_MEMBER,
  type PluginManifest,
  readPluginManifest,
  validateManifestExecution,
} from "./manifest";

/** The plugin archive is bounded tighter than a theme package: it carries code,
 *  not pictures, and a plugin that needs more than this is not a plugin. */
const MAX_PLUGIN_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_PLUGIN_ENTRIES = 512;
const MAX_PLUGIN_EXPANDED_BYTES = 64 * 1024 * 1024;
const MAX_PLUGIN_ENTRY_BYTES = 64 * 1024 * 1024;
const UNREADABLE = "That file is not a readable plugin package.";

export interface PluginPackage {
  readonly manifest: PluginManifest;
  readonly files: Readonly<Record<string, Uint8Array>>;
}

export type PluginPackageResult =
  | { readonly ok: true; readonly package: PluginPackage }
  | { readonly ok: false; readonly message: string };

/** One installed plugin. `directory` is host-side only: a browser is never told
 *  where a plugin's files live. */
export interface InstalledPlugin {
  readonly key: string;
  readonly publisher: string;
  readonly manifest: PluginManifest;
  readonly directory: string;
  readonly contentHash: string;
}

export interface InstallResult {
  readonly ok: boolean;
  readonly plugin?: InstalledPlugin;
  readonly message?: string;
}

export interface PluginInstaller {
  list(): Promise<readonly InstalledPlugin[]>;
  read(key: string): Promise<InstalledPlugin | undefined>;
  install(bytes: Uint8Array): Promise<InstallResult>;
  remove(key: string): Promise<void>;
}

type PathCheck =
  | { readonly ok: true; readonly directory: boolean }
  | { readonly ok: false; readonly message: string };

function notRelative(name: string): {
  readonly ok: false;
  readonly message: string;
} {
  return {
    ok: false,
    message: `Plugin package path ${JSON.stringify(name)} is not relative to the package root.`,
  };
}

/**
 * Every archive member is a name the installer will join under its version
 * directory. The segment rules are what keep that join inside the directory:
 * no absolute path, drive letter, backslash or NUL, and no empty, `.` or `..`
 * segment. A trailing slash marks a directory the archive names; it is checked
 * as a path and never written, because the writer creates the directories the
 * files need.
 */
function checkArchivePath(name: string): PathCheck {
  if (name.includes("\0"))
    return {
      ok: false,
      message: `Plugin package path ${JSON.stringify(name)} contains a NUL byte.`,
    };
  if (
    name === "" ||
    name.startsWith("/") ||
    name.startsWith("\\") ||
    name.includes("\\") ||
    /^[A-Za-z]:/.test(name)
  )
    return notRelative(name);
  const directory = name.endsWith("/");
  const trimmed = directory ? name.slice(0, -1) : name;
  if (
    trimmed
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  )
    return notRelative(name);
  return { ok: true, directory };
}

function fail(message: string): {
  readonly ok: false;
  readonly message: string;
} {
  return { ok: false, message };
}

/**
 * Reads a plugin package from zip bytes. The archive gate refuses oversized or
 * duplicate entries; this function refuses the member names and then admits the
 * manifest through the same reader every other surface uses. No file reaches
 * disk here — the installer owns that, and it consumes only validated names.
 */
export function readPluginPackage(bytes: Uint8Array): PluginPackageResult {
  const archive = readPackageArchive(bytes, () => true, UNREADABLE, {
    maxArchiveBytes: MAX_PLUGIN_ARCHIVE_BYTES,
    maxEntries: MAX_PLUGIN_ENTRIES,
    maxExpandedBytes: MAX_PLUGIN_EXPANDED_BYTES,
    maxEntryBytes: MAX_PLUGIN_ENTRY_BYTES,
  });
  if (!archive.ok) return fail(archive.message);

  const files: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(archive.files)) {
    const checked = checkArchivePath(name);
    if (!checked.ok) return checked;
    if (!checked.directory) files[name] = content;
  }

  const manifestBytes = files[PLUGIN_MANIFEST_MEMBER];
  if (manifestBytes === undefined)
    return fail(`A plugin package needs ${PLUGIN_MANIFEST_MEMBER}.`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    return fail(UNREADABLE);
  }
  const read = readPluginManifest(parsed);
  if (!read.ok) return fail(read.reason);
  const execution = validateManifestExecution(read.manifest);
  if (!execution.ok) return fail(execution.reason);

  const { main, ui } = read.manifest;
  if (main !== undefined && files[main] === undefined)
    return fail(
      `Plugin package is missing its "main" file ${JSON.stringify(main)}.`,
    );
  if (ui !== undefined && files[ui] === undefined)
    return fail(
      `Plugin package is missing its "ui" file ${JSON.stringify(ui)}.`,
    );

  return { ok: true, package: { manifest: read.manifest, files } };
}
