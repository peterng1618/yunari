import type {
  CatalogueStatus,
  FabricThemeEnvelope,
} from "@yunari/renderer-core";
import {
  classifyThemeChange,
  isSemanticVersion,
  MAX_ARCHIVE_BYTES,
  themeVideoRefusals,
  type VersionLevel,
  versionFor,
  writeThemePackage,
} from "@yunari/theme-package";
import {
  isValidThemeId,
  ThemeConflictError,
  type ThemeStore,
} from "./store.js";
import type { StoreClient } from "./store-client.js";
import type { ThumbnailStore } from "./thumbnails.js";

/**
 * One library theme as the bytes a store submission sends.
 *
 * The Worker builds the item JSON and computes the authoritative version; this
 * only does what needs the local library: read the document, refuse what the
 * store will not take, run the ladder against the authenticated baseline, write
 * the version into the document and build the package.
 */

export interface SubmissionFiles {
  readonly packageBytes: Uint8Array;
  readonly thumbnailBytes: Uint8Array;
  /** The picture's mean relative luminance, which the Worker files the version
   *  by; it never decodes the picture. Absent when this build cannot read the
   *  picture's format, which leaves a media-backed theme unclassified. */
  readonly thumbnailLuminance: number | undefined;
  /** The versioned document the Worker validates and the package carries. */
  readonly envelope: FabricThemeEnvelope;
  /** The version the Worker computed for this submission. */
  readonly version: string;
  /** The version it bumps from, absent on a first publication. */
  readonly from: string | undefined;
  /** What the ladder decided, which the store surface shows after submission. */
  readonly level: VersionLevel;
  /** The state the item holds after finalize, as the version request answered. */
  readonly status: CatalogueStatus;
  /** The Worker's upload route this package is PUT to. */
  readonly uploadUrl: string;
}

export async function submissionFiles(
  themeId: string,
  store: ThemeStore,
  options: {
    readonly thumbnails?: ThumbnailStore;
    readonly now?: () => Date;
    readonly client: StoreClient;
  },
): Promise<
  { ok: true; files: SubmissionFiles } | { ok: false; message: string }
> {
  if (!isValidThemeId(themeId)) {
    return {
      ok: false,
      message: `"${themeId}" is not a theme id this library can hold.`,
    };
  }

  let theme: Awaited<ReturnType<ThemeStore["read"]>>;
  try {
    theme = await store.read(themeId);
  } catch {
    // A store failure can name an absolute path from this PC; the browser is
    // told what happened to the theme, not where the library lives.
    return {
      ok: false,
      message: `The Host's library could not read theme "${themeId}".`,
    };
  }
  if (theme === undefined) {
    return {
      ok: false,
      message: `The Host's library holds no theme with id "${themeId}".`,
    };
  }

  // The store refuses this package, so the author is told here, before a
  // submission exists to upload.
  const videoRefusal = themeVideoRefusals(theme.envelope, theme.assets)[0];
  if (videoRefusal !== undefined) return { ok: false, message: videoRefusal };

  const thumbnail =
    options.thumbnails === undefined
      ? undefined
      : await options.thumbnails.read(themeId);
  // Every item commits a picture beside its version, so a theme without one
  // cannot be submitted: the storefront would hold a path to no file.
  if (thumbnail === undefined) {
    return {
      ok: false,
      message: "This theme has no picture yet; set one before submitting.",
    };
  }

  // The same reading the local listing uses, kept beside the picture when it
  // was stored. The Worker has no decoder, so this is the only place the value
  // can come from; it describes the bytes the submission publishes.
  const thumbnailLuminance = await options.thumbnails?.luminance(themeId);

  // The author's own stored version is the only prior release a submission may
  // descend from — in any state, which is what the authenticated route buys. A
  // refusal throws to the route, which owns the status an author sees.
  const item = await options.client.baseline(themeId);

  if (item !== undefined && !isSemanticVersion(item.version)) {
    return { ok: false, message: unbumpableVersion(item.version) };
  }

  // The stored envelope is the baseline, and the library document the
  // candidate — the order the ladder expects.
  const change = classifyThemeChange(item?.envelope, theme.envelope, {
    previous: item?.credits,
    next: theme.credits,
  });
  if (item !== undefined && change.level === "none") {
    return {
      ok: false,
      message: `Version ${item.version} is published and this theme has not changed since it.`,
    };
  }
  const version = versionFor(item?.version, change);
  if (version === undefined) {
    // `initial` (no published item) always mints a version, so only a stored
    // one the ladder refuses can land here.
    return {
      ok: false,
      message:
        item === undefined
          ? "This theme could not be given a version."
          : unbumpableVersion(item.version),
    };
  }

  // The document the package carries. The library write that records this
  // version happens only after every step that can refuse, so a refused
  // submission never leaves the library ahead of the store.
  const withVersion: FabricThemeEnvelope = {
    ...theme.envelope,
    metadata: { ...theme.envelope.metadata, version },
  };

  // The same writer the export path uses, so the package a reviewer downloads
  // is the package the Install action can open.
  const written = writeThemePackage({
    envelope: withVersion,
    assets: theme.assets,
    thumbnail,
    ...(theme.credits === undefined ? {} : { credits: theme.credits }),
  });
  if (!written.ok) return { ok: false, message: written.message };

  // The reader refuses a package this large, and the Worker checks the object
  // it receives with the same bound: saying so here spares a failed upload.
  if (written.bytes.byteLength > MAX_ARCHIVE_BYTES) {
    return {
      ok: false,
      message:
        `That package is too large to open: ${written.bytes.byteLength} bytes, ` +
        `and a package may be at most ${MAX_ARCHIVE_BYTES} bytes.`,
    };
  }

  // The Worker requires a name for a new item; the document's own is the one
  // the storefront should show, and the library's is the fallback the old
  // submission code read.
  const name = withVersion.metadata?.name ?? theme.name;

  const plan = await options.client.createVersion(themeId, {
    envelope: withVersion,
    name,
    ...(theme.credits === undefined ? {} : { credits: theme.credits }),
  });

  // The store accepted this version, so the library may record it. A stale
  // base is the store's own sentence: another save moved the document on, and
  // the author has to choose what happens next. Any other refusal could name an
  // absolute path, so it is reported without one.
  try {
    await store.write(
      themeId,
      {
        envelope: withVersion,
        assets: theme.assets,
        ...(theme.credits === undefined ? {} : { credits: theme.credits }),
      },
      { base: theme.base },
    );
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof ThemeConflictError
          ? error.message
          : "This theme's new version could not be saved in this PC's library.",
    };
  }

  return {
    ok: true,
    files: {
      packageBytes: written.bytes,
      thumbnailBytes: thumbnail,
      thumbnailLuminance,
      envelope: withVersion,
      version: plan.version,
      from: item?.version,
      level: change.level,
      status: plan.status,
      uploadUrl: plan.uploadUrl,
    },
  };
}

/** The one sentence a version-shaped value the ladder cannot bump gets. */
function unbumpableVersion(version: string): string {
  return `The store's copy of this theme records version "${version}", which cannot be bumped.`;
}
