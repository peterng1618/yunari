import {
  type FabricThemeEnvelope,
  readFabricThemeEnvelope,
  validateFabricThemeEnvelope,
} from "@yunari/renderer-core";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  readZipDeclaration,
  ZIP_MAX_CENTRAL_DIRECTORY_BYTES,
  ZIP_MAX_ENTRIES,
} from "./archive-preflight";
import {
  CREDITS,
  MAX_CREDITS_ENTRIES,
  readThemeCredits,
  type ThemeCredits,
} from "./credits";

export * from "./archive-preflight";
export * from "./credits";
export * from "./theme-id";
export * from "./theme-origin";
export * from "./version-ladder";
export * from "./video-envelope";

const MANIFEST = "manifest.json";
const THEME = "theme.json";
const WIDGET = "widget.json";
/** The manifest's kind, once a package is more than a theme: the dashboard
 *  theme and the editor theme share the container and one `theme.json` slot, so
 *  the kind is what keeps each reader from opening the other's document. */
const THEME_KIND = "theme";
/** An editor theme is a token set, not a scene: `theme.json` carries these
 *  values and nothing Fabric-shaped. Declared here because this module owns the
 *  package boundary; the shell's stylesheet is the vocabulary's normative home
 *  and `editor-theme.test.ts` in the editor package holds the two together. */
export const EDITOR_THEME_KIND = "editor-theme";
export const EDITOR_THEME_SCHEMA_VERSION = "1.0.0";
export const EDITOR_THEME_TOKENS = [
  "--bg",
  "--stage",
  "--panel",
  "--panel-2",
  "--yunari-control-bg",
  "--hdr",
  "--edge",
  "--edge-2",
  "--text",
  "--muted",
  "--faint",
  "--accent",
  "--attention",
  "--warn",
  "--hot",
] as const;
export type EditorThemeToken = (typeof EDITOR_THEME_TOKENS)[number];
export type EditorThemeTokens = Readonly<Record<EditorThemeToken, string>>;
/** The format's own name, in one place: a manifest is the only member that
 *  states which kind a package is. */
const WIDGET_FORMAT = "yunari-widget-package";
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
/** The most a theme's own content — its document and every asset it declares —
 *  may come to. The host's stored-theme cap and the editor's size meter share
 *  this number, so a bar the editor shows as full is one a save will refuse. */
export const MAX_THEME_BYTES = 90 * 1024 * 1024;
const MAX_ENTRY_BYTES = 80 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 180 * 1024 * 1024;

/** The one refusal every package member must pass before it is written: the
 *  byte map is exactly the declared paths, each carrying bytes, under `assets/`.
 *  Exported so a caller that must not compress a package asks the writer's own
 *  question rather than restating it. */
export function checkDeclaredAssets(
  envelope: Pick<FabricThemeEnvelope, "assets">,
  assets: Readonly<Record<string, Uint8Array>>,
): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  const paths = new Set(envelope.assets?.map((asset) => asset.path) ?? []);
  if (
    Object.keys(assets).length !== paths.size ||
    [...paths].some((path) => assets[path] === undefined) ||
    // The reader admits assets only under `assets/`, and `thumbnail.png` is a
    // slot of its own now: a declaration naming either would write a package
    // that cannot be opened, or a picture that is really theme media.
    [...paths].some((path) => !path.startsWith("assets/"))
  )
    return {
      ok: false,
      message: "Package assets must exactly match the theme declaration.",
    };
  return { ok: true };
}

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
  const assetsCheck = checkDeclaredAssets(input.envelope, input.assets);
  if (!assetsCheck.ok) return assetsCheck;
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
            kind: THEME_KIND,
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

export type ReadArchiveResult =
  | {
      readonly ok: true;
      readonly files: Readonly<Record<string, Uint8Array>>;
    }
  | { readonly ok: false; readonly message: string };

/** A caller's own bounds. Every field defaults to this package's cap, so a
 *  reader that names none is bounded exactly as the theme readers are. */
export interface PackageArchiveLimits {
  readonly maxArchiveBytes?: number;
  readonly maxEntries?: number;
  readonly maxExpandedBytes?: number;
  readonly maxEntryBytes?: number;
}

/**
 * The one entry gate both package readers pass: size cap, the declared
 * directory's own caps, and the member-name halves the caller owns. The theme
 * and the widget share it because the danger is the archive, not the manifest
 * it names.
 *
 * Exported because the plugin reader opens the same archive under tighter
 * bounds; a caller that supplies none gets the theme package's own caps.
 */
export function readPackageArchive(
  bytes: Uint8Array,
  allowed: (name: string) => boolean,
  unreadable: string,
  limits: PackageArchiveLimits = {},
): ReadArchiveResult {
  const maxArchiveBytes = limits.maxArchiveBytes ?? MAX_ARCHIVE_BYTES;
  const maxEntries = limits.maxEntries ?? ZIP_MAX_ENTRIES;
  const maxExpandedBytes = limits.maxExpandedBytes ?? MAX_EXPANDED_BYTES;
  const maxEntryBytes = limits.maxEntryBytes ?? MAX_ENTRY_BYTES;
  if (bytes.byteLength > maxArchiveBytes)
    return fail("That package is too large to open.");
  // Extraction allocates per declared entry, so a crafted end record is refused
  // before it can be walked. The filter below still counts what it is given:
  // the declaration is what extraction trusts, not what the directory holds.
  const declaration = readZipDeclaration(bytes);
  if (declaration !== undefined) {
    if (declaration.entries > maxEntries)
      return fail(
        `That package declares more than ${maxEntries} archive entries.`,
      );
    if (declaration.centralDirectoryBytes > ZIP_MAX_CENTRAL_DIRECTORY_BYTES)
      return fail("That package declares an oversized archive directory.");
  }
  try {
    const names = new Set<string>();
    let entries = 0;
    let expanded = 0;
    let unsafe = false;
    const files = unzipSync(bytes, {
      filter(file) {
        entries += 1;
        expanded += file.originalSize;
        if (
          entries > maxEntries ||
          expanded > maxExpandedBytes ||
          file.originalSize > maxEntryBytes ||
          (file.compression !== 0 && file.compression !== 8) ||
          names.has(file.name) ||
          !allowed(file.name)
        )
          unsafe = true;
        names.add(file.name);
        return !unsafe;
      },
    });
    if (unsafe) return fail("That package contains unsafe archive entries.");
    return { ok: true, files };
  } catch {
    return fail(unreadable);
  }
}

export function readThemePackage(bytes: Uint8Array): ThemePackageResult {
  const archive = readPackageArchive(
    bytes,
    (name) =>
      name === MANIFEST ||
      name === THEME ||
      name === THUMBNAIL ||
      name === CREDITS ||
      /^assets\/[A-Za-z0-9._/-]{1,200}$/.test(name),
    "That file is not a readable theme package.",
  );
  if (!archive.ok) return fail(archive.message);
  {
    const files = archive.files;
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
      // Absent on packages written before the kind existed; such a package is
      // the dashboard theme the only reader of the time could open.
      (parsedManifest["kind"] !== undefined &&
        parsedManifest["kind"] !== THEME_KIND) ||
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
  }
}

/** A widget is a theme's scene fields without the artboard, which belongs to
 *  the theme it was authored in rather than to the unit a selection becomes. */
export type WidgetDocument = Omit<FabricThemeEnvelope, "artboard">;

/**
 * The artboard the validator is shown for a widget document. It is never
 * written: the envelope validator decides the scene, bindings, globals and
 * assets, and its artboard rule needs a value to read. A widget carries none,
 * so the smallest valid board is supplied for the one check that asks.
 */
const WIDGET_VALIDATION_ARTBOARD = { width: 1, height: 1 } as const;

export type WidgetPackageResult =
  | {
      readonly ok: true;
      readonly document: WidgetDocument;
      readonly assets: Readonly<Record<string, Uint8Array>>;
    }
  | { readonly ok: false; readonly message: string };

/**
 * Writes a selection as a widget package: the manifest, the widget document
 * and the bytes its declaration names — nothing else. The scene inside the
 * document is the caller's extraction; this owner decides only that it is a
 * valid scene, that its bindings resolve and that every declared asset
 * travels.
 */
export function writeWidgetPackage(input: {
  readonly document: WidgetDocument;
  readonly assets: Readonly<Record<string, Uint8Array>>;
}):
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly message: string } {
  const validation = validateFabricThemeEnvelope(
    {
      ...input.document,
      artboard: WIDGET_VALIDATION_ARTBOARD,
    },
    // A widget carries the token its selection is set in, not a theme's three
    // roles: the role requirement is the theme envelope's, not the unit's.
    { requireTrioRoles: false },
  );
  if (!validation.ok)
    return {
      ok: false,
      message: validation.issues[0]?.message ?? "Invalid widget.",
    };
  const assetsCheck = checkDeclaredAssets(validation.envelope, input.assets);
  if (!assetsCheck.ok) return assetsCheck;
  return {
    ok: true,
    bytes: zipSync(
      {
        [MANIFEST]: strToU8(
          JSON.stringify({
            format: WIDGET_FORMAT,
            version: 1,
            widget: WIDGET,
          }),
        ),
        [WIDGET]: strToU8(JSON.stringify(input.document)),
        ...input.assets,
      },
      { level: 6 },
    ),
  };
}

export function readWidgetPackage(bytes: Uint8Array): WidgetPackageResult {
  const archive = readPackageArchive(
    bytes,
    (name) =>
      name === MANIFEST ||
      name === WIDGET ||
      /^assets\/[A-Za-z0-9._/-]{1,200}$/.test(name),
    "That file is not a readable widget package.",
  );
  if (!archive.ok) return fail(archive.message);
  {
    const files = archive.files;
    const manifest = files[MANIFEST];
    const widget = files[WIDGET];
    if (manifest === undefined || widget === undefined)
      return fail("A widget package needs manifest.json and widget.json.");
    const parsedManifest = JSON.parse(strFromU8(manifest)) as Record<
      string,
      unknown
    >;
    if (
      parsedManifest["format"] !== WIDGET_FORMAT ||
      parsedManifest["version"] !== 1 ||
      parsedManifest["widget"] !== WIDGET
    )
      return fail("Unsupported widget package manifest.");
    const parsedWidget = JSON.parse(strFromU8(widget));
    if (
      typeof parsedWidget !== "object" ||
      parsedWidget === null ||
      Array.isArray(parsedWidget) ||
      "artboard" in parsedWidget
    )
      return fail("A widget document must not carry an artboard.");
    const validation = readFabricThemeEnvelope(
      {
        ...parsedWidget,
        artboard: WIDGET_VALIDATION_ARTBOARD,
      },
      { requireTrioRoles: false },
    );
    if (!validation.ok)
      return fail(validation.issues[0]?.message ?? "Invalid widget.");
    const paths = new Set(
      validation.envelope.assets?.map((asset) => asset.path) ?? [],
    );
    const assets = Object.fromEntries(
      Object.entries(files).filter(([path]) => path.startsWith("assets/")),
    );
    if (
      Object.keys(files).some(
        (path) => path !== MANIFEST && path !== WIDGET && !paths.has(path),
      ) ||
      Object.keys(assets).length !== paths.size ||
      [...paths].some((path) => assets[path] === undefined)
    )
      return fail("Package assets must exactly match the widget declaration.");
    const { artboard: _artboard, ...document } = validation.envelope;
    return { ok: true, document, assets };
  }
}

/** The named functions whose arguments are colour values, plus the gradients a
 *  `--bg`/`--stage` may carry. A theme value is one of these or a hex literal:
 *  the values `editor-shell.css` declares are exactly that shape, and a name
 *  such as `red` is refused rather than resolved, because the package names one
 *  palette role and must not acquire a second colour grammar. */
const COLOUR_FUNCTIONS = new Set([
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "hwb",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "color",
  "color-mix",
  "light-dark",
  "linear-gradient",
  "radial-gradient",
  "conic-gradient",
  "repeating-linear-gradient",
  "repeating-radial-gradient",
  "repeating-conic-gradient",
]);

/** A hex length CSS defines: 3, 4, 6 and 8 digits. */
const HEX_LENGTHS = new Set([3, 4, 6, 8]);
const MAX_TOKEN_VALUE = 512;

/** A balanced function call whose name is known and whose body carries no
 *  declaration or block terminator, so a value cannot escape its custom
 *  property. */
function isColourFunction(value: string): boolean {
  const match = /^([a-z-]+)\(([\s\S]*)\)$/i.exec(value);
  if (match === null) return false;
  const name = match[1]?.toLowerCase() ?? "";
  if (!COLOUR_FUNCTIONS.has(name)) return false;
  const body = match[2] ?? "";
  if (/[;{}]/.test(body)) return false;
  let depth = 0;
  for (const character of body) {
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function isTokenValue(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > MAX_TOKEN_VALUE) return false;
  const hex = /^#([0-9a-f]+)$/i.exec(trimmed);
  if (hex !== null) return HEX_LENGTHS.has((hex[1] ?? "").length);
  return isColourFunction(trimmed);
}

type TokenValidation =
  | { readonly ok: true; readonly tokens: EditorThemeTokens }
  | { readonly ok: false; readonly message: string };

/**
 * The one rule both halves of an editor theme pass: every vocabulary token is
 * present, no other name is, and every value is a colour the stylesheet's own
 * grammar admits. A refusal names the token, because the author has to find it.
 */
function validateEditorThemeTokens(value: unknown): TokenValidation {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return fail("An editor theme needs a token map.");
  const map = value as Readonly<Record<string, unknown>>;
  const vocabulary = new Set<string>(EDITOR_THEME_TOKENS);
  const unknown = Object.keys(map)
    .filter((token) => !vocabulary.has(token))
    .sort();
  if (unknown.length > 0)
    return fail(
      `Editor theme token ${unknown[0]} is not part of the editor-shell vocabulary.`,
    );
  for (const token of EDITOR_THEME_TOKENS) {
    const tokenValue = map[token];
    if (tokenValue === undefined)
      return fail(`An editor theme is missing the required token ${token}.`);
    if (!isTokenValue(tokenValue))
      return fail(
        `Editor theme token ${token} has an invalid value ${JSON.stringify(tokenValue)}.`,
      );
  }
  return {
    ok: true,
    tokens: Object.fromEntries(
      EDITOR_THEME_TOKENS.map((token) => [token, map[token] as string]),
    ) as Record<EditorThemeToken, string>,
  };
}

export type EditorThemeDocument = {
  readonly schemaVersion: string;
  readonly name: string;
  readonly tokens: EditorThemeTokens;
};

export type EditorThemePackageResult =
  | { readonly ok: true; readonly document: EditorThemeDocument }
  | { readonly ok: false; readonly message: string };

function validateEditorThemeDocument(value: unknown):
  | { readonly ok: true; readonly document: EditorThemeDocument }
  | {
      readonly ok: false;
      readonly message: string;
    } {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return fail("An editor theme document must be an object.");
  const document = value as Readonly<Record<string, unknown>>;
  if ("scene" in document || "artboard" in document)
    return fail("An editor theme carries no artboard or scene.");
  if (document["schemaVersion"] !== EDITOR_THEME_SCHEMA_VERSION)
    return fail(
      `Schema version ${String(document["schemaVersion"])} is not supported by this build (expected ${EDITOR_THEME_SCHEMA_VERSION}).`,
    );
  if (typeof document["name"] !== "string" || document["name"].trim() === "")
    return fail("An editor theme needs a name.");
  const tokens = validateEditorThemeTokens(document["tokens"]);
  if (!tokens.ok) return tokens;
  return {
    ok: true,
    document: {
      schemaVersion: EDITOR_THEME_SCHEMA_VERSION,
      name: document["name"].trim(),
      tokens: tokens.tokens,
    },
  };
}

/**
 * Writes an editor theme into the same container the dashboard theme and the
 * widget use: the manifest names the kind, and `theme.json` carries the token
 * map with no scene or artboard. The writer is strict, so it cannot author a
 * package its own reader refuses.
 */
export function writeEditorThemePackage(input: {
  readonly name: string;
  readonly tokens: Readonly<Record<string, string>>;
}):
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly message: string } {
  const validated = validateEditorThemeDocument({
    schemaVersion: EDITOR_THEME_SCHEMA_VERSION,
    name: input.name,
    tokens: input.tokens,
  });
  if (!validated.ok) return validated;
  return {
    ok: true,
    bytes: zipSync(
      {
        [MANIFEST]: strToU8(
          JSON.stringify({
            format: "yunari-theme-package",
            version: 1,
            kind: EDITOR_THEME_KIND,
            theme: THEME,
          }),
        ),
        [THEME]: strToU8(JSON.stringify(validated.document)),
      },
      { level: 6 },
    ),
  };
}

/**
 * Reads an editor theme. The archive gate is the theme package's own, and the
 * kind check is what refuses a dashboard theme or a widget by name rather than
 * handing its document to the token validator.
 */
export function readEditorThemePackage(
  bytes: Uint8Array,
): EditorThemePackageResult {
  const archive = readPackageArchive(
    bytes,
    (name) => name === MANIFEST || name === THEME || name === WIDGET,
    "That file is not a readable editor theme package.",
  );
  if (!archive.ok) return fail(archive.message);
  {
    const files = archive.files;
    const manifest = files[MANIFEST];
    const theme = files[THEME];
    if (manifest === undefined)
      return fail("An editor theme package needs manifest.json.");
    let parsedManifest: Record<string, unknown>;
    let parsedTheme: unknown;
    try {
      parsedManifest = JSON.parse(strFromU8(manifest)) as Record<
        string,
        unknown
      >;
    } catch {
      return fail("That file is not a readable editor theme package.");
    }
    if (parsedManifest["format"] !== "yunari-theme-package") {
      return fail(
        parsedManifest["format"] === WIDGET_FORMAT
          ? "That package is a widget, not an editor theme."
          : "That package is not an editor theme.",
      );
    }
    if (
      parsedManifest["version"] !== 1 ||
      parsedManifest["theme"] !== THEME ||
      parsedManifest["kind"] !== EDITOR_THEME_KIND
    )
      return fail(
        parsedManifest["kind"] === THEME_KIND
          ? "That package is a dashboard theme, not an editor theme."
          : "Unsupported package manifest.",
      );
    if (theme === undefined)
      return fail("An editor theme package needs theme.json.");
    // `widget.json` is allowed through the archive gate so a widget package is
    // refused by the kind in its manifest, not as an unsafe archive; a package
    // that says it is an editor theme may carry nothing else.
    if (Object.keys(files).some((name) => name !== MANIFEST && name !== THEME))
      return fail("An editor theme carries no assets.");
    try {
      parsedTheme = JSON.parse(strFromU8(theme));
    } catch {
      return fail("That file is not a readable editor theme package.");
    }
    return validateEditorThemeDocument(parsedTheme);
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

function fail(message: string): {
  readonly ok: false;
  readonly message: string;
} {
  return { ok: false, message };
}
