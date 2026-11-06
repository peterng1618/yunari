import { randomBytes } from "node:crypto";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  type InstalledPlugin,
  type InstallResult,
  type PluginInstaller,
  qualifiedPluginKey,
  readPluginManifest,
  readPluginPackage,
} from "@yunari/extension-api";
import { createJsonFile } from "../settings/json-file.js";
import { contentHash } from "./content-hash.js";

/** A local install is its own publisher: the manifest's `publisher` is a
 *  published-plugin field and never decides where a local package lives. */
const LOCAL_PUBLISHER = "local";
const INDEX_FILE = "installed.json";

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

/** True when `target` is strictly below `root`, in the platform's own path
 *  grammar. The index is host-written, but a hand-edited path must not make
 *  `remove` delete a tree outside the extensions folder. */
function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
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
      if (key !== qualifiedPluginKey(publisher, manifest.manifest.id))
        throw new Error(
          `Plugin index refused: entry ${JSON.stringify(key)} disagrees with its plugin key.`,
        );

      const resolved = path.resolve(directory);
      if (!within(root, resolved))
        throw new Error(
          `Plugin index refused: entry ${JSON.stringify(key)} points outside the extensions folder.`,
        );

      plugins[key] = {
        key,
        publisher,
        manifest: manifest.manifest,
        directory: resolved,
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

      // A sibling temp directory makes the rename atomic within one volume.
      const temporary = path.join(
        path.dirname(target),
        `.${manifest.version}.${randomBytes(6).toString("hex")}.tmp`,
      );

      try {
        await writeTree(temporary, files);
        let aside: string | undefined;
        if (await exists(target)) {
          aside = `${target}.${randomBytes(6).toString("hex")}.old`;
          await rename(target, aside);
        }
        try {
          await rename(temporary, target);
        } catch (error) {
          if (aside !== undefined)
            await rename(aside, target).catch(() => undefined);
          throw error;
        }
        if (aside !== undefined)
          await rm(aside, { recursive: true, force: true });
      } catch (error) {
        await rm(temporary, { recursive: true, force: true }).catch(
          () => undefined,
        );
        return {
          ok: false,
          message: `The plugin could not be installed: ${reason(error)}`,
        };
      }

      const plugin: InstalledPlugin = {
        key,
        publisher: LOCAL_PUBLISHER,
        manifest,
        directory: target,
        contentHash: hash,
      };

      try {
        await stored.mutate((index) => ({
          next: {
            version: 1,
            plugins: { ...index.plugins, [key]: plugin },
          },
          result: undefined,
        }));
      } catch (error) {
        return {
          ok: false,
          message: `The plugin was written but not recorded: ${reason(error)}`,
        };
      }

      // One directory per key is the installed version; a superseded one is
      // removed only after the index names the replacement.
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
