import {
  type FabricThemeEnvelope,
  readFabricThemeEnvelope,
  validateFabricThemeEnvelope,
} from "@yunari/renderer-core";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  CREDITS,
  MAX_CREDITS_ENTRIES,
  readThemeCredits,
  type ThemeCredits,
} from "./credits";

export * from "./credits";
export * from "./version-ladder";
export * from "./video-envelope";

const MANIFEST = "manifest.json";
const THEME = "theme.json";
/**
 * The theme's picture, in a slot of its own beside the manifest and the
 * document. Not `assets/`: a declared asset is one the renderer loads, and a
 * picture the theme never draws is worse than not shipping it.
 */
const THUMBNAIL = "thumbnail.png";
/** The thumbnail store's own two rules, restated rather than imported: it reads
 *  the library, and a package must not carry a picture that store refuses. */
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Exported so a downloader can stop at the same cap *while reading*: the
 *  reader only ever sees bytes that are already in memory. */
export const MAX_ARCHIVE_BYTES = 95 * 1024 * 1024;
const MAX_ENTRIES = 128;
const MAX_ENTRY_BYTES = 80 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 180 * 1024 * 1024;

export type ThemePackageResult =
  | {
      readonly ok: true;
      readonly envelope: FabricThemeEnvelope;
      readonly assets: Readonly<Record<string, Uint8Array>>;
      /** Absent when the package carried no usable picture. */
      readonly thumbnail?: Uint8Array;
      /** The package's attribution member, when it carried one. */
      readonly credits?: ThemeCredits;
    }
  | { readonly ok: false; readonly message: string };

/**
 * The export writes the envelope, its declared assets and the thumbnail —
 * nothing else. A file in the theme folder is not exported because it is in the
 * folder; every member of a package is written on purpose, and the thumbnail is
 * the one deliberate exception, carried because it was chosen.
 */
export function writeThemePackage(input: {
  readonly envelope: FabricThemeEnvelope;
  readonly assets: Readonly<Record<string, Uint8Array>>;
  /** Optional: a theme saved before the slot existed, or a capture that
   *  failed, exports and imports perfectly well without one. */
  readonly thumbnail?: Uint8Array;
  /** An imported asset is not imported until it carries its credit, so the
   *  member travels with the theme it credits. An empty list is `undefined`:
   *  there is nothing to attribute and no member to write. */
  readonly credits?: ThemeCredits;
}):
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly message: string } {
  const validation = validateFabricThemeEnvelope(input.envelope);
  if (!validation.ok)
    return {
      ok: false,
      message: validation.issues[0]?.message ?? "Invalid theme.",
    };
  const credits =
    input.credits === undefined || input.credits.entries.length === 0
      ? undefined
      : input.credits;
  if (credits !== undefined && credits.entries.length > MAX_CREDITS_ENTRIES)
    return {
      ok: false,
      message: `A theme package carries at most ${MAX_CREDITS_ENTRIES} credits.`,
    };
  const paths = new Set(
    input.envelope.assets?.map((asset) => asset.path) ?? [],
  );
  if (
    Object.keys(input.assets).length !== paths.size ||
    [...paths].some((path) => input.assets[path] === undefined) ||
    // The reader admits assets only under `assets/`, and `thumbnail.png` is a
    // slot of its own now: a declaration naming either would write a package
    // that cannot be opened, or a picture that is really theme media.
    [...paths].some((path) => !path.startsWith("assets/"))
  )
    return {
      ok: false,
      message: "Package assets must exactly match the theme declaration.",
    };
  // The same rule the reader applies, so the writer cannot author the package
  // it would refuse to open.
  const thumbnail = carryable(input.thumbnail);
  return {
    ok: true,
    bytes: zipSync(
      {
        [MANIFEST]: strToU8(
          JSON.stringify({
            format: "yunari-theme-package",
            // Still 1: the thumbnail is an additive member the manifest names
            // when it is used, so a package without one opens unchanged and one
            // with one is refused cleanly by a reader that has no slot for it.
            // A v2 bump would rewrite every fixture to say nothing new.
            version: 1,
            theme: THEME,
            ...(thumbnail === undefined ? {} : { thumbnail: THUMBNAIL }),
            ...(credits === undefined ? {} : { credits: CREDITS }),
          }),
        ),
        [THEME]: strToU8(JSON.stringify(input.envelope)),
        ...(thumbnail === undefined ? {} : { [THUMBNAIL]: thumbnail }),
        ...(credits === undefined
          ? {}
          : { [CREDITS]: strToU8(JSON.stringify(credits)) }),
        ...input.assets,
      },
      { level: 6 },
    ),
  };
}

export function readThemePackage(bytes: Uint8Array): ThemePackageResult {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES)
    return fail("That package is too large to open.");
  try {
    const names = new Set<string>();
    let entries = 0;
    let expanded = 0;
    let unsafe = false;
    const files = unzipSync(bytes, {
      filter(file) {
        entries += 1;
        expanded += file.originalSize;
        const allowed =
          file.name === MANIFEST ||
          file.name === THEME ||
          file.name === THUMBNAIL ||
          file.name === CREDITS ||
          /^assets\/[A-Za-z0-9._/-]{1,200}$/.test(file.name);
        if (
          entries > MAX_ENTRIES ||
          expanded > MAX_EXPANDED_BYTES ||
          file.originalSize > MAX_ENTRY_BYTES ||
          (file.compression !== 0 && file.compression !== 8) ||
          names.has(file.name) ||
          !allowed
        )
          unsafe = true;
        names.add(file.name);
        return !unsafe;
      },
    });
    if (unsafe) return fail("That package contains unsafe archive entries.");
    const manifest = files[MANIFEST];
    const theme = files[THEME];
    if (manifest === undefined || theme === undefined)
      return fail("A package needs manifest.json and theme.json.");
    const parsedManifest = JSON.parse(strFromU8(manifest)) as Record<
      string,
      unknown
    >;
    const declaredThumbnail = parsedManifest["thumbnail"];
    const declaredCredits = parsedManifest["credits"];
    if (
      parsedManifest["format"] !== "yunari-theme-package" ||
      parsedManifest["version"] !== 1 ||
      parsedManifest["theme"] !== THEME ||
      (declaredThumbnail !== undefined && declaredThumbnail !== THUMBNAIL) ||
      (declaredCredits !== undefined && declaredCredits !== CREDITS)
    )
      return fail("Unsupported package manifest.");
    const parsedTheme = JSON.parse(strFromU8(theme));
    const validation = readFabricThemeEnvelope(parsedTheme);
    if (!validation.ok)
      return fail(validation.issues[0]?.message ?? "Invalid theme.");
    const paths = new Set(
      validation.envelope.assets?.map((asset) => asset.path) ?? [],
    );
    const assets = Object.fromEntries(
      Object.entries(files).filter(([path]) => path.startsWith("assets/")),
    );
    // A picture the manifest does not name is a file nobody chose to ship, so
    // the format is not what the manifest says it is.
    const picture = files[THUMBNAIL];
    if (picture !== undefined && declaredThumbnail !== THUMBNAIL)
      return fail("A package thumbnail must be named in its manifest.");
    const thumbnail = carryable(picture);
    // The same rule for attribution: credits a manifest does not name are a
    // file nobody chose to ship. An unreadable member is dropped, not fatal.
    const creditBytes = files[CREDITS];
    if (creditBytes !== undefined && declaredCredits !== CREDITS)
      return fail("A package's credits must be named in its manifest.");
    const credits = readThemeCredits(creditBytes ?? new Uint8Array());
    if (
      Object.keys(files).some(
        (path) =>
          path !== MANIFEST &&
          path !== THEME &&
          path !== THUMBNAIL &&
          path !== CREDITS &&
          !paths.has(path),
      ) ||
      Object.keys(assets).length !== paths.size ||
      [...paths].some((path) => assets[path] === undefined)
    )
      return fail("Package assets must exactly match the theme declaration.");
    return {
      ok: true,
      envelope: validation.envelope,
      assets,
      // A picture the library would refuse is dropped rather than fatal: the
      // theme is the thing that matters, and absence is ordinary.
      ...(thumbnail === undefined ? {} : { thumbnail }),
      ...(credits === undefined ? {} : { credits }),
    };
  } catch {
    return fail("That file is not a readable theme package.");
  }
}

/** The store's own rule, so a package cannot carry a picture it would refuse. */
function carryable(bytes: Uint8Array | undefined): Uint8Array | undefined {
  if (bytes === undefined) return undefined;
  return bytes.byteLength <= MAX_THUMBNAIL_BYTES &&
    bytes.byteLength > PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
    ? bytes
    : undefined;
}

function fail(message: string): ThemePackageResult {
  return { ok: false, message };
}
