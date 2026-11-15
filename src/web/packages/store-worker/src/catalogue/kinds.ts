import {
  type ExecutionProfile,
  type PluginManifest,
  readPluginPackage,
} from "@yunari/extension-api";
import { isStoreItemKind, type StoreItemKind } from "@yunari/renderer-core";
import {
  type CollectionInclude,
  type CollectionPackage,
  MAX_ARCHIVE_BYTES,
  readCollectionPackage,
  readEditorThemePackage,
  readPathPresetPack,
  readWidgetPackage,
} from "@yunari/theme-package";
import { isPackVersion } from "../version/plan.js";

/**
 * The kinds that publish data or code that is not a dashboard theme, and the
 * one place that validates each from its own package reader.
 *
 * A version is never the client's: `planPackVersion` decides what may be
 * published, exactly as `planVersion` does for a theme. The finalize path
 * revalidates the bytes it stored, so a submission's declared digest is checked
 * against the package the store actually holds before a version row exists.
 */

export type PackKind = Exclude<StoreItemKind, "dashboard-theme">;

/** The request body a non-theme submission posts: the header a version request
 *  would carry for a theme, plus the package digest the PUT must match. */
export interface PackSubmission {
  readonly kind: PackKind;
  readonly name: string;
  readonly version: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly sha256: string;
  readonly bytes: number;
}

export type PackSubmissionResult =
  | { readonly ok: true; readonly submission: PackSubmission }
  | { readonly ok: false; readonly message: string };

const SHA256 = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) && Object.hasOwn(value, key) ? value[key] : undefined;
}

/** The submitted header, or the first field that is not what it declares. */
export function readPackSubmission(value: unknown): PackSubmissionResult {
  const kind = field(value, "kind");
  if (!isStoreItemKind(kind))
    return refuse(
      'A pack submission needs a "kind" of editor-theme, widget-pack, path-preset-pack or plugin.',
    );
  if (kind === "dashboard-theme")
    return refuse("A dashboard theme is submitted as an envelope, not a pack.");

  const name = field(value, "name");
  if (typeof name !== "string" || name.trim() === "")
    return refuse("A pack submission needs a non-empty name.");

  const version = field(value, "version");
  if (typeof version !== "string" || !isPackVersion(version))
    return refuse('A pack submission needs a semver version "x.y.z".');

  const metadata = field(value, "metadata");
  if (!isRecord(metadata))
    return refuse("A pack submission needs a metadata object.");

  const sha256 = field(value, "sha256");
  if (typeof sha256 !== "string" || !SHA256.test(sha256))
    return refuse(
      "A pack submission needs a lowercase SHA-256 of the package it will upload.",
    );

  const bytes = field(value, "bytes");
  if (!Number.isSafeInteger(bytes) || (bytes as number) <= 0)
    return refuse("A pack submission needs the package's byte length.");
  if ((bytes as number) > MAX_ARCHIVE_BYTES)
    return refuse(
      `The package exceeds the ${MAX_ARCHIVE_BYTES / (1024 * 1024)} MiB limit.`,
    );

  return {
    ok: true,
    submission: {
      kind,
      name: name.trim(),
      version,
      metadata,
      sha256,
      bytes: bytes as number,
    },
  };
}

function refuse(message: string): PackSubmissionResult {
  return { ok: false, message };
}

export interface FinalizedPackage {
  /** The package's own metadata, which the catalogue names it by. */
  readonly metadata: Readonly<Record<string, unknown>>;
  /** The plugin's execution profile; null for every data kind. */
  readonly executionProfile: ExecutionProfile | null;
  /** The validated plugin manifest, so review reads the package's own bytes
   *  rather than a second parse of the metadata column. */
  readonly manifest?: PluginManifest;
  /** The validated collection manifest, so finalize checks the package's own
   *  includes rather than a second parse of the metadata column. */
  readonly collection?: CollectionPackage;
}

export type FinalizedPackageResult =
  | { readonly ok: true; readonly finalized: FinalizedPackage }
  | { readonly ok: false; readonly message: string };

function utf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * Revalidates the stored bytes through the reader that owns the package kind.
 * The metadata written beside the version is the package's own, never the
 * submission's: a header that disagrees with the bytes would otherwise become
 * the catalogue's name for something else.
 */
export function validateFinalizedPackage(
  kind: StoreItemKind,
  bytes: Uint8Array,
): FinalizedPackageResult {
  if (kind === "dashboard-theme")
    return { ok: false, message: "A dashboard theme is not a pack." };

  if (kind === "widget-pack") {
    const read = readWidgetPackage(bytes);
    if (!read.ok) return read;
    return {
      ok: true,
      finalized: {
        metadata: {
          name: read.name ?? read.document.id,
          units: read.units.map((unit) => ({
            id: unit.id,
            label: unit.label,
          })),
        },
        executionProfile: null,
      },
    };
  }

  if (kind === "path-preset-pack") {
    const text = utf8(bytes);
    if (text === undefined)
      return { ok: false, message: "That path preset pack is not UTF-8." };
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, message: "That path preset pack is not JSON." };
    }
    const read = readPathPresetPack(parsed);
    if (!read.ok) return read;
    return {
      ok: true,
      finalized: {
        metadata: {
          name: read.pack.name,
          presets: read.pack.presets.map((preset) => ({
            id: preset.id,
            label: preset.label,
          })),
        },
        executionProfile: null,
      },
    };
  }

  if (kind === "editor-theme") {
    const read = readEditorThemePackage(bytes);
    if (!read.ok) return read;
    return {
      ok: true,
      finalized: {
        metadata: { name: read.document.name },
        executionProfile: null,
      },
    };
  }

  if (kind === "collection") {
    const read = readCollectionPackage(bytes);
    if (!read.ok) return read;
    return {
      ok: true,
      finalized: {
        metadata: {
          name: read.package.name,
          description: read.package.description,
          includes: read.package.includes,
        },
        executionProfile: null,
        collection: read.package,
      },
    };
  }

  const read = readPluginPackage(bytes);
  if (!read.ok) return read;
  const { manifest } = read.package;
  return {
    ok: true,
    finalized: {
      metadata: {
        name: manifest.name,
        manifest,
        contributions: contributionIdentities(manifest),
      },
      executionProfile: manifest.execution,
      manifest,
    },
  };
}

/**
 * The cross-listing half of collection validation, and pure so it is checked
 * without D1.
 *
 * The package reader owns the manifest's structure — ids, duplicates and
 * bounds. This owns what only the catalogue can answer: whether each included
 * id is published, whether it is the collection itself, and whether it is
 * another collection. `published` maps a published id to its listing kind; an
 * id absent from it is unknown or unpublished.
 */
export function validateCollectionIncludes(
  includes: readonly CollectionInclude[],
  published: ReadonlyMap<string, string>,
  selfId: string,
): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  for (const { id } of includes) {
    if (id === selfId)
      return { ok: false, message: "A collection cannot include itself." };
    const kind = published.get(id);
    if (kind === undefined) {
      return {
        ok: false,
        message: `The collection includes "${id}", which is not a published item.`,
      };
    }
    if (kind === "collection") {
      return {
        ok: false,
        message: `The collection includes "${id}", which is itself a collection; collections are one level deep.`,
      };
    }
  }
  return { ok: true };
}

/** The authority-bearing contribution identities consent and review key on. */
function contributionIdentities(manifest: PluginManifest): readonly string[] {
  const identities: string[] = [];
  for (const [group, entries] of Object.entries(
    manifest.contributes as Readonly<Record<string, unknown>>,
  )) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const id = isRecord(entry) ? entry["id"] : undefined;
      if (typeof id === "string") identities.push(`${group}:${id}`);
    }
  }
  return identities.sort();
}
