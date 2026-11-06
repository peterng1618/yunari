import { randomBytes } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  readWidgetPackage,
  type WidgetPackageResult,
} from "@yunari/theme-package";

/** The one file an installed pack is: the zip the reader opened. */
const PACKAGE = "package.zip";

/** A pack summary, as a listing and an import answer carry it. */
export interface WidgetPackSummary {
  readonly id: string;
  readonly name: string;
  readonly version: string | undefined;
  readonly units: readonly { readonly id: string; readonly label: string }[];
}

export interface WidgetPackStore {
  list(): Promise<readonly WidgetPackSummary[]>;
  read(id: string): Promise<Uint8Array | undefined>;
  install(
    bytes: Uint8Array,
  ): Promise<
    | { readonly ok: true; readonly pack: WidgetPackSummary }
    | { readonly ok: false; readonly message: string }
  >;
  remove(id: string): Promise<void>;
}

/** A pack id is one path segment under the settings directory: a reader's
 *  `document.id` already matches `STABLE_ID_PATTERN`, but a route parameter or
 *  a bundled package is not the reader's to trust. */
export function isPackId(id: string): boolean {
  return (
    id !== "" &&
    id !== "." &&
    id !== ".." &&
    !id.includes("/") &&
    !id.includes("\\") &&
    !id.includes("..")
  );
}

type InstalledPackage = Extract<WidgetPackageResult, { readonly ok: true }>;

function summaryOf(result: InstalledPackage): WidgetPackSummary {
  return {
    id: result.document.id,
    // A package without a name is still a pack; its id is the name it has.
    name: result.name ?? result.document.id,
    version: result.version,
    units: result.units.map((unit) => ({ id: unit.id, label: unit.label })),
  };
}

/** A stored pack that no longer validates is not served. The console is the
 *  host's error path for a file it refuses; the caller gets nothing. */
function report(id: string, message: string): void {
  console.error(`Widget pack ${id}: ${message}`);
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

/**
 * Installed widget packs, one directory each: `<directory>/<packId>/package.zip`.
 *
 * A package is read before it is written, so an invalid one leaves nothing
 * behind. The bytes are written into a temporary directory and renamed into
 * place, replacing a same-id install by renaming the old directory aside first —
 * a reader never sees a half-written pack, and a failed swap restores the old
 * one.
 *
 * Bundled packages are read at list and read time and never written: they are
 * the app's own, not this machine's files.
 */
export function createWidgetPackStore(
  directory: string,
  options?: { readonly bundled?: readonly Uint8Array[] },
): WidgetPackStore {
  const bundled = options?.bundled ?? [];

  function packagePath(id: string): string | undefined {
    return isPackId(id) ? path.join(directory, id, PACKAGE) : undefined;
  }

  /** The reader's answer for bytes, logging an invalid bundled package once. */
  async function readBundled(
    bytes: Uint8Array,
    id: string | undefined,
  ): Promise<Uint8Array | undefined> {
    const result = readWidgetPackage(bytes);
    if (!result.ok) {
      if (id !== undefined) report(id, result.message);
      return undefined;
    }
    if (id === undefined || result.document.id === id) return bytes;
    return undefined;
  }

  async function readInstalled(
    id: string,
  ): Promise<
    | { readonly bytes: Uint8Array; readonly result: InstalledPackage }
    | undefined
  > {
    const target = packagePath(id);
    if (target === undefined) return undefined;

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(target));
    } catch (error) {
      if (!isMissing(error)) report(id, "the package could not be read.");
      return undefined;
    }

    // A directory whose bytes no longer validate is skipped and reported,
    // never served — including to a caller that named its id.
    const result = readWidgetPackage(bytes);
    if (!result.ok) {
      report(id, result.message);
      return undefined;
    }
    if (result.document.id !== id) {
      report(id, `its document id is ${result.document.id}.`);
      return undefined;
    }
    return { bytes, result };
  }

  return {
    async list() {
      const summaries: WidgetPackSummary[] = [];
      const seen = new Set<string>();

      let entries: Dirent[];
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (!isMissing(error))
          report(directory, "the folder could not be read.");
        entries = [];
      }

      for (const entry of entries) {
        // Temporary installs and the old directory of a replacement are
        // dot-prefixed and are not packs.
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        const installed = await readInstalled(entry.name);
        if (installed === undefined) continue;
        seen.add(installed.result.document.id);
        summaries.push(summaryOf(installed.result));
      }

      for (const bytes of bundled) {
        const result = readWidgetPackage(bytes);
        if (!result.ok) {
          report("bundled", result.message);
          continue;
        }
        if (seen.has(result.document.id)) continue;
        seen.add(result.document.id);
        summaries.push(summaryOf(result));
      }

      return summaries;
    },

    async read(id) {
      if (!isPackId(id)) return undefined;
      const installed = await readInstalled(id);
      if (installed !== undefined) return installed.bytes;
      for (const bytes of bundled) {
        const found = await readBundled(bytes, id);
        if (found !== undefined) return found;
      }
      return undefined;
    },

    async install(bytes) {
      const result = readWidgetPackage(bytes);
      if (!result.ok) return result;
      const id = result.document.id;
      if (!isPackId(id)) {
        return { ok: false, message: "That package has an unusable id." };
      }

      await mkdir(directory, { recursive: true });
      const temporary = await mkdtemp(path.join(directory, ".install-"));
      const target = path.join(directory, id);
      const aside = path.join(
        directory,
        `.old-${randomBytes(6).toString("hex")}`,
      );
      let movedAside = false;

      try {
        await writeFile(path.join(temporary, PACKAGE), bytes);
        try {
          await rename(target, aside);
          movedAside = true;
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
        await rename(temporary, target);
      } catch (error) {
        await rm(temporary, { recursive: true, force: true }).catch(
          () => undefined,
        );
        if (movedAside) {
          await rename(aside, target).catch(() => undefined);
        }
        throw error;
      }

      if (movedAside) {
        await rm(aside, { recursive: true, force: true }).catch(
          () => undefined,
        );
      }
      return { ok: true, pack: summaryOf(result) };
    },

    async remove(id) {
      if (!isPackId(id)) return;
      // A bundled pack is not on disk; removing its id removes nothing.
      await rm(path.join(directory, id), { recursive: true, force: true });
    },
  };
}
