import { randomBytes } from "node:crypto";
import { mkdir, open, rename, rm, rmdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  type InstalledPlugin,
  type InstallResult,
  type PluginInstaller,
  qualifiedPluginKey,
  readPluginManifest,
  readPluginPackage,
  validateManifestExecution,
} from "@yunari/extension-api";
import { createJsonFile } from "../settings/json-file.js";
import { contentHash } from "./content-hash.js";

/** A local install is its own publisher: the manifest's `publisher` is a
 *  published-plugin field and never decides where a local package lives. */
const LOCAL_PUBLISHER = "local";
const INDEX_FILE = "installed.json";
const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;

interface InstalledIndex {
  readonly version: 1;
  readonly plugins: Readonly<Record<string, InstalledPlugin>>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/**
 * Writes every validated member under a fresh directory, syncing each file
 * before the directory is renamed into place.
 */
async function writeTree(
  directory: string,
  files: Readonly<Record<string, Uint8Array>>,
): Promise<void> {
  for (const [name, bytes] of Object.entries(files)) {
    const target = path.join(directory, ...name.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    const handle = await open(target, "wx");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}

/**
 * The installed-plugin index. A missing or unreadable file reads as empty so a
 * poll never fails over it; a mutator refuses an unreadable one instead of
 * replacing what it cannot account for.
 */
function createIndex(root: string) {
  const normalize = (parsed: unknown): InstalledIndex => {
    if (
      !isRecord(parsed) ||
      parsed["version"] !== 1 ||
      !isRecord(parsed["plugins"])
    )
      throw new Error("Plugin index refused: it is not version 1.");

    const plugins: Record<string, InstalledPlugin> = {};
    for (const [key, value] of Object.entries(parsed["plugins"])) {
      if (!isRecord(value))
        throw new Error(
          `Plugin index refused: entry ${JSON.stringify(key)} is not an object.`,
        );
      const publisher = value["publisher"];
      const directory = value["directory"];
      const hash = value["contentHash"];
      if (
        typeof publisher !== "string" ||
        typeof directory !== "string" ||
        typeof hash !== "string"
      )
        throw new Error(
          `Plugin index refused: entry ${JSON.stringify(key)} is incomplete.`,
        );

      const manifest = readPluginManifest(value["manifest"]);
      if (!manifest.ok)
        throw new Error(
          `Plugin index refused: entry ${JSON.stringify(key)} carries an invalid manifest: ${manifest.reason}`,
        );
      // A hand-edited index may declare a profile its own contributions cannot
      // carry, so the execution rule is re-applied here, not only at install.
      const execution = validateManifestExecution(manifest.manifest);
      if (!execution.ok)
        throw new Error(
          `Plugin index refused: entry ${JSON.stringify(key)} carries an impossible execution profile: ${execution.reason}`,
        );
      // The publisher is not echoed from the file: this installer only owns
      // local installs, and a hand-edited segment must never steer a path.
      if (publisher !== LOCAL_PUBLISHER)
        throw new Error(
          `Plugin index refused: entry ${JSON.stringify(key)} names an unknown publisher.`,
        );
      if (key !== qualifiedPluginKey(publisher, manifest.manifest.id))
        throw new Error(
          `Plugin index refused: entry ${JSON.stringify(key)} disagrees with its plugin key.`,
        );

      if (!CONTENT_HASH_PATTERN.test(hash))
        throw new Error(
          `Plugin index refused: entry ${JSON.stringify(key)} carries an invalid content hash.`,
        );

      // The directory is not caller data: it is exactly where this installer
      // puts that publisher, id and version. A record that disagrees is not a
      // tree this index may remove or trust.
      const expected = path.join(
        root,
        LOCAL_PUBLISHER,
        manifest.manifest.id,
        manifest.manifest.version,
      );
      if (path.resolve(directory) !== path.resolve(expected))
        throw new Error(
          `Plugin index refused: entry ${JSON.stringify(key)} names a directory it does not own.`,
        );

      plugins[key] = {
        key,
        publisher: LOCAL_PUBLISHER,
        manifest: manifest.manifest,
        directory: expected,
        contentHash: hash,
      };
    }

    return { version: 1, plugins };
  };

  return createJsonFile<InstalledIndex>(root, INDEX_FILE, {
    normalize,
    empty: () => ({ version: 1, plugins: {} }),
  });
}

/** The plugins installed under this PC's extensions folder. */
export function createPluginInstaller(directory: string): PluginInstaller {
  const root = path.resolve(directory);
  const stored = createIndex(root);

  return {
    async list() {
      const index = await stored.read();
      return Object.keys(index.plugins)
        .sort()
        .map((key) => index.plugins[key] as InstalledPlugin);
    },

    async read(key) {
      return (await stored.read()).plugins[key];
    },

    async install(bytes): Promise<InstallResult> {
      const read = readPluginPackage(bytes);
      if (!read.ok) return { ok: false, message: read.message };

      const { manifest, files } = read.package;
      const key = qualifiedPluginKey(LOCAL_PUBLISHER, manifest.id);
      const hash = contentHash(files);
      const target = path.join(
        root,
        LOCAL_PUBLISHER,
        manifest.id,
        manifest.version,
      );

      const current = (await stored.read()).plugins[key];
      if (
        current !== undefined &&
        current.manifest.version === manifest.version &&
        current.contentHash === hash &&
        (await exists(current.directory))
      )
        return { ok: true, plugin: current };

      const parent = path.dirname(target);
      // A sibling temp directory makes the rename atomic within one volume.
      const temporary = path.join(
        parent,
        `.${manifest.version}.${randomBytes(6).toString("hex")}.tmp`,
      );
      const plugin: InstalledPlugin = {
        key,
        publisher: LOCAL_PUBLISHER,
        manifest,
        directory: target,
        contentHash: hash,
      };

      try {
        await writeTree(temporary, files);
      } catch (error) {
        await rm(temporary, { recursive: true, force: true }).catch(
          () => undefined,
        );
        // Non-recursive: removes `<publisher>/<id>` only when this attempt left
        // it empty, never another version's tree.
        await rmdir(parent).catch(() => undefined);
        return {
          ok: false,
          message: `The plugin could not be installed: ${reason(error)}`,
        };
      }

      // Move any previous tree aside, place the new one, then record it. The
      // index write is what makes the install live; until it succeeds the
      // previous tree is restored.
      const aside = (await exists(target))
        ? `${target}.old-${randomBytes(6).toString("hex")}`
        : undefined;
      try {
        if (aside !== undefined) await rename(target, aside);
        await rename(temporary, target);
      } catch (error) {
        if (aside !== undefined)
          await rename(aside, target).catch(() => undefined);
        await rm(temporary, { recursive: true, force: true }).catch(
          () => undefined,
        );
        await rmdir(parent).catch(() => undefined);
        return {
          ok: false,
          message: `The plugin could not be installed: ${reason(error)}`,
        };
      }

      try {
        await stored.mutate((index) => ({
          next: {
            version: 1,
            plugins: { ...index.plugins, [key]: plugin },
          },
          result: undefined,
        }));
      } catch (error) {
        // Not live until the index names it: remove the new tree and put the
        // superseded version back.
        await rm(target, { recursive: true, force: true }).catch(
          () => undefined,
        );
        if (aside !== undefined)
          await rename(aside, target).catch(() => undefined);
        return {
          ok: false,
          message: `The plugin was not installed: ${reason(error)}`,
        };
      }

      // An aside that cannot be removed is an orphan, not live state; the
      // install itself succeeded.
      if (aside !== undefined)
        await rm(aside, { recursive: true, force: true }).catch(
          () => undefined,
        );

      // One directory per key is the installed version; a superseded version
      // directory is removed only after the index names the replacement.
      if (current !== undefined && current.directory !== target)
        await rm(current.directory, { recursive: true, force: true }).catch(
          () => undefined,
        );

      return { ok: true, plugin };
    },

    async remove(key) {
      const entry = (await stored.read()).plugins[key];
      if (entry === undefined) return;

      await stored.mutate((index) => {
        const plugins = { ...index.plugins };
        delete plugins[key];
        return { next: { version: 1, plugins }, result: undefined };
      });

      await rm(entry.directory, { recursive: true, force: true });
    },
  };
}
