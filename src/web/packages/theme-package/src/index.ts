import {
  type AssetReference,
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
export * from "./path-preset-pack";
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
/** The manifest a widget package is written with, in one place: the reader's
 *  admitted key set is derived from this object, so the writer cannot emit a
 *  manifest its own reader refuses. */
const WIDGET_MANIFEST_BASE = {
  format: WIDGET_FORMAT,
  version: 1,
  widget: WIDGET,
} as const;
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

/** A unit a package manifest names, before its object is found in the scene. */
export interface WidgetPackUnitRef {
  readonly id: string;
  readonly label: string;
  readonly objectId: string;
}

/** One installed pack as a listing (and an import answer) names it. The host
 *  reads it from a stored zip; the editor and the MCP server read it from the
 *  listing route, so all three name a pack the same way. */
export interface WidgetPackSummary {
  readonly id: string;
  readonly name: string;
  readonly version: string | undefined;
  readonly units: readonly { readonly id: string; readonly label: string }[];
}

/** One insertion unit, carrying its own subtree, bindings and asset bytes. */
export interface WidgetUnit {
  readonly id: string;
  readonly label: string;
  readonly document: WidgetDocument;
  readonly declarations: readonly AssetReference[];
  readonly assets: Readonly<Record<string, Uint8Array>>;
}

export type WidgetPackageResult =
  | {
      readonly ok: true;
      readonly document: WidgetDocument;
      readonly assets: Readonly<Record<string, Uint8Array>>;
      readonly units: readonly WidgetUnit[];
      readonly name: string | undefined;
      readonly version: string | undefined;
    }
  | { readonly ok: false; readonly message: string };

/** The manifest keys this reader admits; a package naming any other is not one
 *  it can understand well enough to open. Derived from the writer's own
 *  manifest so the two cannot drift. */
const WIDGET_MANIFEST_KEYS = new Set([
  ...Object.keys(WIDGET_MANIFEST_BASE),
  "units",
]);
const WIDGET_UNIT_KEYS = new Set(["id", "label", "objectId"]);

type WidgetManifestResult =
  | {
      readonly ok: true;
      readonly units: readonly WidgetPackUnitRef[] | undefined;
    }
  | { readonly ok: false; readonly message: string };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The strict manifest check: the format's three keys and an optional unit
 *  list, each entry of which is exactly its three strings. */
function readWidgetManifest(value: unknown): WidgetManifestResult {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !WIDGET_MANIFEST_KEYS.has(key)) ||
    value["format"] !== WIDGET_MANIFEST_BASE.format ||
    value["version"] !== WIDGET_MANIFEST_BASE.version ||
    value["widget"] !== WIDGET_MANIFEST_BASE.widget
  )
    return fail("Unsupported widget package manifest.");
  const declared = value["units"];
  if (declared === undefined) return { ok: true, units: undefined };
  if (!Array.isArray(declared))
    return fail("Unsupported widget package manifest.");
  const units: WidgetPackUnitRef[] = [];
  for (const entry of declared) {
    if (
      !isRecord(entry) ||
      Object.keys(entry).some((key) => !WIDGET_UNIT_KEYS.has(key))
    )
      return fail("Unsupported widget package manifest.");
    const id = entry["id"];
    const label = entry["label"];
    const objectId = entry["objectId"];
    if (
      typeof id !== "string" ||
      id.trim() === "" ||
      typeof label !== "string" ||
      typeof objectId !== "string" ||
      objectId.trim() === ""
    )
      return fail("Unsupported widget package manifest.");
    units.push({ id, label, objectId });
  }
  return { ok: true, units };
}

/** Every object id in a unit's subtree, the root included. */
function subtreeIds(object: Readonly<Record<string, unknown>>): Set<string> {
  const ids = new Set<string>();
  const visit = (value: Readonly<Record<string, unknown>>): void => {
    const id = value["id"];
    if (typeof id === "string") ids.add(id);
    const children = value["objects"];
    if (Array.isArray(children))
      for (const child of children) if (isRecord(child)) visit(child);
  };
  visit(object);
  return ids;
}

/** The asset declarations the subtree names anywhere in its JSON. A reference
 *  is an `assetId` key, so one walk covers an object's `yunariAsset`, a text
 *  run's face and a media layer alike. */
function referencedAssetIds(value: unknown): Set<string> {
  const ids = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!isRecord(node)) return;
    for (const [key, child] of Object.entries(node)) {
      if (key === "assetId" && typeof child === "string") ids.add(child);
      else visit(child);
    }
  };
  visit(value);
  return ids;
}

/** The package's own units when authored, otherwise one unit per top-level
 *  object the editor stamped with provenance. Derived ids are made unique:
 *  two copies of one card share a `widgetId`, and neither may lose its unit. */
function unitRefs(
  objects: readonly Readonly<Record<string, unknown>>[],
  declared: readonly WidgetPackUnitRef[] | undefined,
): readonly WidgetPackUnitRef[] {
  if (declared !== undefined) return declared;
  const refs: WidgetPackUnitRef[] = [];
  const taken = new Set<string>();
  for (const object of objects) {
    const provenance = object["provenance"];
    if (!isRecord(provenance)) continue;
    const widgetId = provenance["widgetId"];
    // A blank id names no unit; provenance without one is not a unit at all.
    if (typeof widgetId !== "string" || widgetId.trim() === "") continue;
    // A validated top-level scene object always carries an id; without one
    // there is no object to bind the unit to.
    const objectId = object["id"];
    if (typeof objectId !== "string") continue;
    const widgetName = provenance["widgetName"];
    let id = widgetId;
    let counter = 2;
    while (taken.has(id)) {
      id = `${widgetId}-${counter}`;
      counter += 1;
    }
    taken.add(id);
    refs.push({
      id,
      label:
        typeof widgetName === "string" && widgetName.trim() !== ""
          ? widgetName
          : widgetId,
      objectId,
    });
  }
  return refs;
}

type UnitsResult =
  | { readonly ok: true; readonly units: readonly WidgetUnit[] }
  | { readonly ok: false; readonly message: string };

function deriveUnits(
  document: WidgetDocument,
  files: Readonly<Record<string, Uint8Array>>,
  declared: readonly WidgetPackUnitRef[] | undefined,
): UnitsResult {
  const rawObjects = document.scene["objects"];
  const objects = Array.isArray(rawObjects) ? rawObjects.filter(isRecord) : [];
  const byId = new Map<string, Readonly<Record<string, unknown>>>();
  for (const object of objects) {
    const id = object["id"];
    if (typeof id === "string") byId.set(id, object);
  }
  const seen = new Set<string>();
  const units: WidgetUnit[] = [];
  for (const ref of unitRefs(objects, declared)) {
    if (seen.has(ref.id))
      return fail(`Widget unit "${ref.id}" is declared more than once.`);
    seen.add(ref.id);
    const object = byId.get(ref.objectId);
    if (object === undefined)
      return fail(
        `Widget unit "${ref.id}" names no top-level object "${ref.objectId}".`,
      );
    const ids = subtreeIds(object);
    const assetIds = referencedAssetIds(object);
    // The unit keeps the package globals, so every face those tokens name
    // travels with it: a type-token face pointing at a filtered-out declaration
    // would make the unit document invalid.
    for (const token of Object.values(document.globals?.typeTokens ?? {}))
      if (token.face !== undefined) assetIds.add(token.face.assetId);
    const declarations = (document.assets ?? []).filter((asset) =>
      assetIds.has(asset.id),
    );
    const assets: Record<string, Uint8Array> = {};
    for (const declaration of declarations) {
      const bytes = files[declaration.path];
      if (bytes !== undefined) assets[declaration.path] = bytes;
    }
    const bindings = Object.fromEntries(
      Object.entries(document.bindings ?? {}).filter(([id]) => ids.has(id)),
    );
    units.push({
      id: ref.id,
      label: ref.label,
      document: {
        schemaVersion: document.schemaVersion,
        fabricVersion: document.fabricVersion,
        id: document.id,
        scene: { ...document.scene, objects: [object] },
        ...(document.metadata === undefined
          ? {}
          : { metadata: document.metadata }),
        ...(document.globals === undefined
          ? {}
          : { globals: document.globals }),
        ...(Object.keys(bindings).length === 0 ? {} : { bindings }),
        ...(declarations.length === 0 ? {} : { assets: declarations }),
      },
      declarations,
      assets,
    });
  }
  return { ok: true, units };
}

/**
 * The first declaration carrying no digest, or `undefined`.
 *
 * A digest is the package's proof that the bytes are the ones it declares. The
 * reader refuses one it cannot verify, and the writer refuses to produce one:
 * a theme may declare an asset without a digest, so an export taken from such a
 * theme would otherwise be a package its own importer rejects.
 */
function undigestedAsset(
  assets: readonly AssetReference[] | undefined,
): AssetReference | undefined {
  return assets?.find((asset) => asset.sha256 === undefined);
}

/**
 * Reads a widget package from its unpacked member map. The archive gate lives
 * in `readWidgetPackage`; this owner decides the manifest, the document, the
 * asset declaration and every unit the package offers.
 */
export function readWidgetPackageFiles(
  files: Readonly<Record<string, Uint8Array>>,
): WidgetPackageResult {
  const manifest = files[MANIFEST];
  const widget = files[WIDGET];
  if (manifest === undefined || widget === undefined)
    return fail("A widget package needs manifest.json and widget.json.");
  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(strFromU8(manifest));
  } catch {
    return fail("Unsupported widget package manifest.");
  }
  const manifestCheck = readWidgetManifest(parsedManifest);
  if (!manifestCheck.ok) return manifestCheck;
  let parsedWidget: unknown;
  try {
    parsedWidget = JSON.parse(strFromU8(widget));
  } catch {
    return fail("Invalid widget.");
  }
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
  // A digest is the package's proof that the bytes are the ones it declares.
  // Insertion verifies it, so a declaration without one would install, list,
  // and only then fail when an author tried to use the unit.
  const undigested = undigestedAsset(validation.envelope.assets);
  if (undigested !== undefined)
    return fail(`Package asset ${undigested.path} declares no SHA-256 digest.`);
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
  const units = deriveUnits(document, files, manifestCheck.units);
  if (!units.ok) return units;
  return {
    ok: true,
    document,
    assets,
    units: units.units,
    name: document.metadata?.name,
    version: document.metadata?.version,
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
  return readWidgetPackageFiles(archive.files);
}

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
  const undigested = undigestedAsset(validation.envelope.assets);
  if (undigested !== undefined)
    return {
      ok: false,
      message: `Package asset ${undigested.path} declares no SHA-256 digest.`,
    };
  const assetsCheck = checkDeclaredAssets(validation.envelope, input.assets);
  if (!assetsCheck.ok) return assetsCheck;
  return {
    ok: true,
    bytes: zipSync(
      {
        [MANIFEST]: strToU8(JSON.stringify(WIDGET_MANIFEST_BASE)),
        [WIDGET]: strToU8(JSON.stringify(input.document)),
        ...input.assets,
      },
      { level: 6 },
    ),
  };
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
