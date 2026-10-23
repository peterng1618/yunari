import {
  CHART_PAINT_FIELDS,
  CHART_SETTINGS_FIELDS,
} from "../charts/settings-fields.js";
import { isTimeZoneName } from "../scene/datetime/instant.js";
import { isLocaleName } from "../scene/datetime/names.js";
import { isCatalogueId } from "./catalogue-index.js";
import {
  CHART_FAMILIES,
  type ChartFamily,
  isSemanticVersion,
  MAX_ARTBOARD_DIMENSION,
  MAX_NODE_COUNT,
  MAX_NODE_DEPTH,
  MAX_TAGS,
  STABLE_ID_PATTERN,
  TAG_PATTERN,
} from "./document.js";
import { envelopeKeysFor, knownKeysFor } from "./envelope-keys.js";
import {
  namedEnvelope,
  type ValidationIssue,
  validateEnvelopeSemantics,
} from "./envelope-semantics.js";
import {
  type FabricThemeEnvelope,
  SUPPORTED_SCHEMA_VERSION,
} from "./fabric-envelope.js";
import {
  isGlassTreatment,
  MAX_GLASS_BLUR_RADIUS,
  supportsGlass,
  YUNARI_GLASS_PROPERTY,
} from "./glass.js";
import { isObjectName, YUNARI_NAME_PROPERTY } from "./object-name.js";

/** Bounds malformed Fabric JSON before it reaches Fabric's asynchronous revival. */
const MAX_SCENE_DEPTH = MAX_NODE_DEPTH + 8;

export type FabricEnvelopeValidationResult =
  | { readonly ok: true; readonly envelope: FabricThemeEnvelope }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

/**
 * Validates the versioned product envelope; Fabric compatibility remains
 * scene-fabric's boundary.
 *
 * This is the loader: it is where a document becomes an envelope, whatever
 * brought the bytes here — a stored `theme.json`, the host's document route, a
 * package an author opened. So it is also where a document that carries no name
 * gains one ({@link namedEnvelope}), because the published schema refuses an
 * empty `metadata.name` and a stored document that validated before that bound
 * is not allowed to stop loading because of it.
 */
export function validateFabricThemeEnvelope(
  input: unknown,
  options: { readonly requireTrioRoles?: boolean } = {},
): FabricEnvelopeValidationResult {
  if (!isRecord(input)) {
    return fail("not-an-object", "", "The theme must be a JSON object.");
  }

  // An unknown version cannot be safely interpreted, so report it alone (§141).
  const version = input["schemaVersion"];
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return fail(
      "missing-field",
      "/schemaVersion",
      "schemaVersion is required and must be an integer.",
    );
  }
  if (version > SUPPORTED_SCHEMA_VERSION) {
    return fail(
      "newer-schema-version",
      "/schemaVersion",
      `This theme was made with a newer version of Yunari (schema ${version}). Update Yunari to open it.`,
    );
  }
  if (version !== SUPPORTED_SCHEMA_VERSION) {
    return fail(
      "unsupported-schema-version",
      "/schemaVersion",
      `Schema version ${version} is not supported by this build (expected ${SUPPORTED_SCHEMA_VERSION}).`,
    );
  }

  const issues: ValidationIssue[] = [];
  unknownKeys(input, "", envelopeKeysFor("envelope"), "A theme", issues);
  if (
    typeof input["fabricVersion"] !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(input["fabricVersion"])
  ) {
    issues.push(
      issue(
        "wrong-type",
        "/fabricVersion",
        "fabricVersion must be a pinned major.minor.patch version.",
      ),
    );
  }
  validateEnvelopeSemantics(input, issues);
  themeLanguage(input["metadata"], issues);
  styleTags(input["metadata"], issues);
  remixOf(input["metadata"], issues);
  v2Globals(input["globals"], issues);
  backgroundPaintReferences(input["background"], input["globals"], issues);
  paletteNone(input["globals"], issues);
  palettePaints(input["globals"], issues);
  editorMetadata(input["editorMetadata"], issues);
  rejectGifAssets(input["assets"], issues);
  fontPresetFaces(
    input["globals"],
    input["assets"],
    options.requireTrioRoles === true,
    issues,
  );
  const sceneIds = scene(input["scene"], issues);
  scenePaintReferences(input["scene"], input["globals"], issues);
  sceneTypeReferences(input["scene"], input["globals"], issues);
  chartSettingsReferences(input["scene"], input["globals"], issues);
  bindings(input["bindings"], sceneIds, issues);

  return issues.length === 0
    ? {
        ok: true,
        envelope: namedEnvelope(input as unknown as FabricThemeEnvelope),
      }
    : { ok: false, issues };
}

/**
 * A v2 theme states the language its text is written in, so its clock reads in
 * the language its author wrote it in and a library can filter on the fact. A
 * tag that is malformed, or well formed and unsupported, is refused here rather
 * than rendered as English behind the author's back.
 */
function themeLanguage(metadata: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(metadata)) {
    issues.push(
      issue(
        "missing-field",
        "/metadata/themeLanguage",
        "A theme must declare its language, so its text reads in the language it was written in.",
      ),
    );
    return;
  }

  const language = metadata["themeLanguage"];

  if (language === undefined) {
    issues.push(
      issue(
        "missing-field",
        "/metadata/themeLanguage",
        "A theme must declare its language, so its text reads in the language it was written in.",
      ),
    );
    return;
  }

  if (typeof language !== "string" || !isLocaleName(language)) {
    issues.push(
      issue(
        "invalid-enum",
        "/metadata/themeLanguage",
        `themeLanguage "${String(language)}" is not a language this runtime can render.`,
      ),
    );
  }
}

/**
 * A theme's style tags: the shape and the count, and the whole of what the format
 * enforces.
 *
 * Membership is unchecked on purpose — the vocabulary is the catalogue's, and a
 * tag it does not yet know has to be writable before it can join it — and a
 * duplicate is left for the facet to collapse rather than refused here
 * (docs/decisions/0087).
 */
function styleTags(metadata: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(metadata)) return;
  const tags = metadata["tags"];
  if (tags === undefined) return;

  if (!Array.isArray(tags)) {
    issues.push(
      issue(
        "wrong-type",
        "/metadata/tags",
        `Style tags must be an array of at most ${MAX_TAGS} lowercase tags.`,
      ),
    );
    return;
  }

  if (tags.length > MAX_TAGS) {
    issues.push(
      issue(
        "out-of-range",
        "/metadata/tags",
        `A theme declares at most ${MAX_TAGS} style tags; this one declares ${tags.length}.`,
      ),
    );
  }

  for (const [index, tag] of tags.entries()) {
    if (typeof tag === "string" && TAG_PATTERN.test(tag)) continue;
    issues.push(
      issue(
        typeof tag === "string" ? "invalid-id" : "wrong-type",
        `/metadata/tags/${index}`,
        `A style tag must match ${TAG_PATTERN.source} — 1–24 lowercase letters, digits or hyphens; got ${JSON.stringify(tag) ?? String(tag)}.`,
      ),
    );
  }
}

/**
 * The catalogue item a theme was remixed from: provenance for the credit line,
 * never a live link. The parent's existence is deliberately unchecked — a remix
 * may be published before its parent — so only the shape is decided here, one
 * issue per malformed member.
 */
function remixOf(metadata: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(metadata)) return;
  const value = metadata["remixOf"];
  if (value === undefined) return;

  if (!isRecord(value)) {
    issues.push(
      issue("wrong-type", "/metadata/remixOf", "remixOf must be an object."),
    );
    return;
  }

  for (const key of Object.keys(value))
    if (key !== "catalogueId" && key !== "name" && key !== "version")
      issues.push(
        issue(
          "unknown-field",
          `/metadata/remixOf/${key}`,
          `A remix credit has no "${key}" property.`,
        ),
      );

  const catalogueId = value["catalogueId"];
  if (catalogueId === undefined)
    issues.push(
      issue(
        "missing-field",
        "/metadata/remixOf/catalogueId",
        "A remix credit needs the parent's catalogue id.",
      ),
    );
  else if (typeof catalogueId !== "string" || !isCatalogueId(catalogueId))
    issues.push(
      issue(
        "invalid-id",
        "/metadata/remixOf/catalogueId",
        `A remix credit's catalogueId must be a lowercase UUID; got ${JSON.stringify(catalogueId)}.`,
      ),
    );

  const name = value["name"];
  if (name === undefined)
    issues.push(
      issue(
        "missing-field",
        "/metadata/remixOf/name",
        "A remix credit needs the parent's name.",
      ),
    );
  else if (typeof name !== "string" || name.length === 0)
    issues.push(
      issue(
        "wrong-type",
        "/metadata/remixOf/name",
        "A remix credit's name must be a non-empty string.",
      ),
    );

  const version = value["version"];
  if (version === undefined)
    issues.push(
      issue(
        "missing-field",
        "/metadata/remixOf/version",
        "A remix credit needs the version it was remixed from.",
      ),
    );
  else if (typeof version !== "string" || !isSemanticVersion(version))
    issues.push(
      issue(
        "wrong-type",
        "/metadata/remixOf/version",
        "A remix credit's version must be semantic major.minor.patch.",
      ),
    );
}

function fontPresetFaces(
  globals: unknown,
  assets: unknown,
  requireTrioRoles: boolean,
  issues: ValidationIssue[],
): void {
  if (!isRecord(globals) || !isRecord(globals["typePresets"])) return;
  const presets = globals["typePresets"];
  const fontAssets = new Map<string, Record<string, unknown>>();
  if (Array.isArray(assets)) {
    for (const asset of assets) {
      if (
        isRecord(asset) &&
        asset["kind"] === "font" &&
        typeof asset["id"] === "string"
      )
        fontAssets.set(asset["id"], asset);
    }
  }
  const roles = new Set<string>();
  for (const [id, entry] of Object.entries(presets)) {
    const value =
      isRecord(entry) && isRecord(entry["value"]) ? entry["value"] : undefined;
    if (value === undefined) continue;
    if (typeof value["trioRole"] === "string") roles.add(value["trioRole"]);
    const face = isRecord(value["face"]) ? value["face"] : undefined;
    if (face === undefined) {
      if (requireTrioRoles)
        issues.push(
          issue(
            "missing-field",
            `/globals/typePresets/${id}/value/face`,
            "New theme type presets need a declared packaged font face.",
          ),
        );
      continue;
    }
    const assetId = face["assetId"];
    const asset =
      typeof assetId === "string" ? fontAssets.get(assetId) : undefined;
    if (
      asset === undefined ||
      asset["family"] !== value["family"] ||
      (value["weight"] !== undefined && asset["weight"] !== value["weight"])
    ) {
      issues.push(
        issue(
          "unresolved-asset-ref",
          `/globals/typePresets/${id}/value/face/assetId`,
          "A type preset face must reference a declared matching font asset.",
        ),
      );
    }
  }
  if (
    requireTrioRoles &&
    !["heading", "body", "mono"].every((role) => roles.has(role))
  ) {
    issues.push(
      issue(
        "missing-field",
        "/globals/typePresets",
        "New themes need heading, body and mono type-preset roles.",
      ),
    );
  }
}

/** Fabric text font properties are resolved cache; runs own their type-preset references. */
function sceneTypeReferences(
  scene: unknown,
  globals: unknown,
  issues: ValidationIssue[],
): void {
  if (!isRecord(scene) || !Array.isArray(scene["objects"])) return;
  const presets =
    isRecord(globals) && isRecord(globals["typePresets"])
      ? globals["typePresets"]
      : undefined;
  const palette =
    isRecord(globals) && isRecord(globals["palette"])
      ? globals["palette"]
      : undefined;
  const visit = (object: unknown, path: string): void => {
    if (!isRecord(object)) return;
    if (isTextObject(object)) {
      const authored = isRecord(object["yunariText"])
        ? object["yunariText"]
        : undefined;
      textBox(authored?.["box"], `${path}/yunariText/box`, issues);
      const runs =
        authored !== undefined && Array.isArray(authored["runs"])
          ? authored["runs"]
          : undefined;
      if (runs === undefined || runs.length === 0) {
        issues.push(
          issue(
            "unresolved-global-ref",
            `${path}/yunariText`,
            "Text objects need authored runs with typePreset and palette references.",
          ),
        );
      } else {
        for (const [index, run] of runs.entries()) {
          const ref = isRecord(run) ? run["typePreset"] : undefined;
          const preset =
            typeof ref === "string" && ref.startsWith("typePresets.")
              ? presets?.[ref.slice("typePresets.".length)]
              : undefined;
          if (!isRecord(preset) || !isRecord(preset["value"])) {
            issues.push(
              issue(
                "unresolved-global-ref",
                `${path}/yunariText/runs/${index}/typePreset`,
                "Text runs must reference an existing type preset.",
              ),
            );
          }
          const style =
            isRecord(run) && run["style"] !== undefined
              ? run["style"]
              : undefined;
          if (style !== undefined && !isRecord(style)) {
            issues.push(
              issue(
                "wrong-type",
                `${path}/yunariText/runs/${index}/style`,
                "Text run style must be an object.",
              ),
            );
            continue;
          }
          if (style !== undefined)
            unknownKeys(
              style,
              `${path}/yunariText/runs/${index}/style`,
              ["color"],
              "A text run style",
              issues,
            );
          const color = style?.["color"];
          const colorRef = isRecord(color) ? color["ref"] : undefined;
          if (
            typeof colorRef !== "string" ||
            !colorRef.startsWith("palette.") ||
            palette?.[colorRef.slice("palette.".length)] === undefined
          ) {
            issues.push(
              issue(
                "unresolved-global-ref",
                `${path}/yunariText/runs/${index}/style/color`,
                "Text runs must reference an existing palette token for colour.",
              ),
            );
          }
        }
      }
    }
    if (Array.isArray(object["objects"]))
      object["objects"].forEach((child, index) =>
        visit(child, `${path}/objects/${index}`),
      );
  };
  scene["objects"].forEach((object, index) =>
    visit(object, `/scene/objects/${index}`),
  );
}

function isTextObject(object: Record<string, unknown>): boolean {
  return (
    object["type"] === "Textbox" ||
    object["type"] === "IText" ||
    object["type"] === "FabricText"
  );
}

/**
 * A fixed text box, on the v2 scene's own copy of the authored content.
 *
 * Fabric keeps `width` on the object too, but that is a cache the renderer
 * re-asserts: this is the copy the author's size survives in, so a malformed
 * one is refused before anything measures text into it.
 */
function textBox(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (value === undefined) return;

  const sized = (dimension: "width" | "height"): boolean => {
    const size = isRecord(value) ? value[dimension] : undefined;
    return (
      typeof size === "number" &&
      Number.isFinite(size) &&
      size > 0 &&
      size <= MAX_ARTBOARD_DIMENSION
    );
  };

  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => key !== "width" && key !== "height") ||
    !sized("width") ||
    !sized("height")
  ) {
    issues.push(
      issue(
        "invalid-fabric-scene",
        path,
        `A text box must be exactly { width, height }, each a number from 0 to ${MAX_ARTBOARD_DIMENSION} scene units.`,
      ),
    );
  }
}

/** v2 removes legacy global groups; palette and type presets own authored style. */
function v2Globals(value: unknown, issues: ValidationIssue[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push(
      issue("wrong-type", "/globals", "v2 globals must be an object."),
    );
    return;
  }
  unknownKeys(
    value,
    "/globals",
    envelopeKeysFor("globals"),
    "v2 globals",
    issues,
  );
}

/** Background paint is authored through palette tokens, never a local literal. */
function backgroundPaintReferences(
  background: unknown,
  globals: unknown,
  issues: ValidationIssue[],
): void {
  if (!isRecord(background)) return;
  const palette =
    isRecord(globals) && isRecord(globals["palette"])
      ? globals["palette"]
      : undefined;
  const value = background["color"];
  if (value === undefined) return;
  const ref = isRecord(value) ? value["ref"] : undefined;
  if (
    typeof ref !== "string" ||
    !ref.startsWith("palette.") ||
    palette?.[ref.slice("palette.".length)] === undefined
  ) {
    issues.push(
      issue(
        "unresolved-global-ref",
        "/background/color",
        "background must reference an existing palette token.",
      ),
    );
  }
}

/** Resolved Fabric paint is a cache; its authored owner is always a palette token. */
function scenePaintReferences(
  scene: unknown,
  globals: unknown,
  issues: ValidationIssue[],
): void {
  if (!isRecord(scene) || !Array.isArray(scene["objects"])) return;
  const palette =
    isRecord(globals) && isRecord(globals["palette"])
      ? globals["palette"]
      : undefined;
  const visit = (object: unknown, path: string): void => {
    if (!isRecord(object)) return;
    const refs = isRecord(object["yunariPaint"])
      ? object["yunariPaint"]
      : undefined;
    for (const property of ["fill", "stroke", "shadowColor"] as const) {
      if (!hasResolvedPaint(object, property)) continue;
      const ref = refs?.[property];
      const token = paletteToken(ref, palette);
      if (token === undefined) {
        issues.push(
          issue(
            "unresolved-global-ref",
            `${path}/${property}`,
            `${property} must reference an existing palette token through yunariPaint.`,
          ),
        );
        continue;
      }
      // Fabric's Shadow.color is a string, so a gradient token cannot paint
      // one. Refusing it here matches how every other unappliable reference is
      // reported, instead of leaving a ref that resolves on paper and is
      // silently dropped at paint time.
      if (property === "shadowColor" && !isSolidPaint(token)) {
        issues.push(
          issue(
            "unresolved-global-ref",
            `${path}/${property}`,
            "shadowColor must reference a solid palette token.",
          ),
        );
      }
    }
    if (Array.isArray(object["objects"]))
      object["objects"].forEach((child, index) =>
        visit(child, `${path}/objects/${index}`),
      );
  };
  scene["objects"].forEach((object, index) =>
    visit(object, `/scene/objects/${index}`),
  );
}

/** The palette entry a `palette.` reference names, or `undefined` if none. */
function paletteToken(
  ref: unknown,
  palette: Record<string, unknown> | undefined,
): unknown {
  if (typeof ref !== "string" || !ref.startsWith("palette.")) return undefined;
  return palette?.[ref.slice("palette.".length)];
}

/** A palette value that can become a single Fabric colour. */
function isSolidPaint(entry: unknown): boolean {
  // Older fixtures and `applyPaints` both accept a bare string; the published
  // shape nests it under `value`.
  if (typeof entry === "string") return entry.length > 0;
  if (!isRecord(entry)) return false;
  const value = entry["value"];
  if (typeof value === "string") return value.length > 0;
  return isRecord(value) && value["kind"] === "solid";
}

/**
 * A shadow carries its colour inside Fabric's own nested object, so the
 * presence test differs from the flat fill/stroke properties. Fabric also
 * accepts the CSS string form and parses it into a real Shadow, so a string is
 * a resolved colour too and must be checked the same way.
 */
function hasResolvedPaint(
  object: Record<string, unknown>,
  property: "fill" | "stroke" | "shadowColor",
): boolean {
  if (property === "shadowColor") {
    const shadow = object["shadow"];
    if (typeof shadow === "string") return shadow.trim().length > 0;
    return (
      isRecord(shadow) &&
      shadow["color"] !== undefined &&
      shadow["color"] !== null &&
      shadow["color"] !== ""
    );
  }
  return (
    object[property] !== undefined &&
    object[property] !== null &&
    object[property] !== ""
  );
}

/**
 * A chart's settings are semantic authored values: its paint is a palette
 * reference, never an embedded literal colour, and every scalar is read against
 * the descriptor table that owns it (`charts/settings-fields.ts`) rather than
 * against a second list here. Both are decided in one pass over the scene, so
 * one traversal reports both.
 */
function chartSettingsReferences(
  scene: unknown,
  globals: unknown,
  issues: ValidationIssue[],
): void {
  if (!isRecord(scene) || !Array.isArray(scene["objects"])) return;
  const palette =
    isRecord(globals) && isRecord(globals["palette"])
      ? globals["palette"]
      : undefined;
  const visit = (object: unknown, path: string): void => {
    if (!isRecord(object)) return;
    if (object["type"] === "YunariChart")
      chartSettings(object, path, palette, issues);
    if (Array.isArray(object["objects"]))
      object["objects"].forEach((child, index) =>
        visit(child, `${path}/objects/${index}`),
      );
  };
  scene["objects"].forEach((object, index) =>
    visit(object, `/scene/objects/${index}`),
  );
}

/**
 * One chart's own settings.
 *
 * An unknown family has no descriptors to read, so it is left to the editor
 * rather than refused here; a chart with no settings is the authored default.
 * `settings` itself must be an object, because an array or a scalar is not a
 * settings bag and would otherwise skip every check below.
 */
function chartSettings(
  object: Record<string, unknown>,
  path: string,
  palette: Record<string, unknown> | undefined,
  issues: ValidationIssue[],
): void {
  const family = object["family"];
  if (typeof family !== "string" || !isChartFamily(family)) return;
  const settings = object["settings"];
  if (settings === undefined) return;
  if (!isRecord(settings)) {
    issues.push(
      issue(
        "wrong-type",
        `${path}/settings`,
        "Chart settings must be an object.",
      ),
    );
    return;
  }

  // The allowed key set is the descriptor table's own reading: a nested field's
  // top-level key is the first segment of its write path, so `total` and
  // `animation` are in the set without this file listing them.
  const allowed = new Set<string>();
  for (const descriptor of CHART_SETTINGS_FIELDS[family])
    allowed.add(descriptor.path?.[0] ?? descriptor.property);
  for (const descriptor of CHART_PAINT_FIELDS[family])
    allowed.add(descriptor.property);
  unknownKeys(settings, `${path}/settings`, [...allowed], "A chart", issues);

  chartScalars(settings, family, path, issues);

  for (const descriptor of CHART_PAINT_FIELDS[family]) {
    const value = settings[descriptor.property];
    if (value === undefined) continue;
    const paints = Array.isArray(value) ? value : [value];
    paints.forEach((paint, index) =>
      chartPaint(
        paint,
        `${path}/settings/${descriptor.property}${Array.isArray(value) ? `/${index}` : ""}`,
        palette,
        issues,
      ),
    );
  }
}

/**
 * Each scalar against its own descriptor's bound.
 *
 * Absent is an authorable state, so only a present value is refused. A
 * descriptor whose ceiling is a `bound` (`drawnBox`, `halfDrawnBox`) carries no
 * numeric `max`: the ceiling is the chart's drawn box, which the envelope cannot
 * know, and inventing one would refuse a document for a reason the loader cannot
 * see.
 */
function chartScalars(
  settings: Record<string, unknown>,
  family: ChartFamily,
  path: string,
  issues: ValidationIssue[],
): void {
  for (const descriptor of CHART_SETTINGS_FIELDS[family]) {
    if (descriptor.kind !== "number") continue;
    const field = descriptor.path ?? [descriptor.property];
    const value = valueAt(settings, field);
    if (value === undefined) continue;
    const where = `${path}/settings/${field.join("/")}`;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      issues.push(
        issue(
          "wrong-type",
          where,
          `${descriptor.property} must be a finite number.`,
        ),
      );
      continue;
    }
    if (descriptor.min !== undefined && value < descriptor.min) {
      issues.push(
        issue(
          "out-of-range",
          where,
          `${descriptor.property} must be at least ${descriptor.min}.`,
        ),
      );
    } else if (descriptor.max !== undefined && value > descriptor.max) {
      issues.push(
        issue(
          "out-of-range",
          where,
          `${descriptor.property} must be at most ${descriptor.max}.`,
        ),
      );
    }
  }

  // The pair is refused where the pair is complete: a half on its own is not a
  // range, and neither half's descriptor carries a bound of its own.
  for (const [lower, upper] of scalarPairs(family)) {
    const low = settings[lower];
    const high = settings[upper];
    if (typeof low !== "number" || !Number.isFinite(low)) continue;
    if (typeof high !== "number" || !Number.isFinite(high)) continue;
    if (low >= high)
      issues.push(
        issue(
          "out-of-range",
          `${path}/settings/${upper}`,
          `${upper} must be above ${lower}.`,
        ),
      );
  }

  if (family === "pie") pieTotal(settings, path, issues);
}

/**
 * The scalar pairs a family's own descriptors make impossible when equal or
 * crossed.
 *
 * A family that declares **both** a `min` and a `max` descriptor has a reading
 * range, and it is crossed whichever family it is — gauge and bar draw a
 * reading against it, line's two are its optional axis bounds, and all three
 * are the table's own declaration rather than a family list kept here. The
 * donut's radius pair has two names of its own, so it is named.
 */
function scalarPairs(
  family: ChartFamily,
): readonly (readonly [string, string])[] {
  if (family === "pie") return [["innerRadiusPercent", "outerRadiusPercent"]];
  // Both pairs are top-level today; one that gains a `path` must be read through it.
  const properties = new Set(
    CHART_SETTINGS_FIELDS[family].map((descriptor) => descriptor.property),
  );
  return properties.has("min") && properties.has("max") ? [["min", "max"]] : [];
}

/**
 * A pie's total is the one scalar one level down: a fixed total with no value is
 * a whole nobody stated, so the parts cannot be read as shares of it.
 */
function pieTotal(
  settings: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[],
): void {
  const total = settings["total"];
  if (total === undefined) return;
  if (!isRecord(total)) {
    issues.push(
      issue(
        "wrong-type",
        `${path}/settings/total`,
        "A pie total must be an object.",
      ),
    );
    return;
  }
  const kind = total["kind"];
  if (kind !== "sum" && kind !== "fixed") {
    issues.push(
      issue(
        "invalid-enum",
        `${path}/settings/total/kind`,
        "A pie total kind must be one of: sum, fixed.",
      ),
    );
    return;
  }
  if (kind === "fixed" && total["value"] === undefined) {
    issues.push(
      issue(
        "missing-field",
        `${path}/settings/total/value`,
        "A fixed pie total needs a value.",
      ),
    );
  }
}

function isChartFamily(value: string): value is ChartFamily {
  return (CHART_FAMILIES as readonly string[]).includes(value);
}

/** The value a descriptor's write path names, or `undefined` if any step is absent. */
function valueAt(
  record: Record<string, unknown>,
  path: readonly string[],
): unknown {
  let current: unknown = record;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function chartPaint(
  value: unknown,
  path: string,
  palette: Record<string, unknown> | undefined,
  issues: ValidationIssue[],
): void {
  if (!isRecord(value)) {
    issues.push(
      issue(
        "unresolved-global-ref",
        path,
        "Chart paint must reference a palette token.",
      ),
    );
    return;
  }
  if (typeof value["ref"] === "string") {
    const id = value["ref"].startsWith("palette.")
      ? value["ref"].slice("palette.".length)
      : "";
    if (
      id === "" ||
      palette?.[id] === undefined ||
      Object.keys(value).length !== 1
    ) {
      issues.push(
        issue(
          "unresolved-global-ref",
          path,
          "Chart paint must reference an existing palette token.",
        ),
      );
    }
    return;
  }
  if (value["kind"] === "thresholds" && Array.isArray(value["bands"])) {
    value["bands"].forEach((band, index) =>
      chartPaintBand(band, `${path}/bands/${index}`, palette, issues),
    );
    return;
  }
  issues.push(
    issue(
      "unresolved-global-ref",
      path,
      "Chart paint must reference a palette token or threshold bands of solid tokens.",
    ),
  );
}

function chartPaintBand(
  value: unknown,
  path: string,
  palette: Record<string, unknown> | undefined,
  issues: ValidationIssue[],
): void {
  if (
    !isRecord(value) ||
    !Number.isFinite(value["offset"]) ||
    typeof value["ref"] !== "string" ||
    !value["ref"].startsWith("palette.")
  ) {
    issues.push(
      issue(
        "unresolved-global-ref",
        path,
        "A chart threshold band needs an offset and palette token reference.",
      ),
    );
    return;
  }
  const id = value["ref"].slice("palette.".length);
  const entry = palette?.[id];
  if (
    !isRecord(entry) ||
    !isRecord(entry["value"]) ||
    entry["value"]["kind"] !== "solid"
  ) {
    issues.push(
      issue(
        "unresolved-global-ref",
        path,
        "A chart threshold band must reference an existing solid palette token.",
      ),
    );
  }
}

/** `palette.none` is the immutable transparent fallback for v2 authoring. */
function paletteNone(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value) || value["palette"] === undefined) return;
  const palette = value["palette"];
  if (!isRecord(palette)) return;
  const none = palette["none"];
  if (
    !isRecord(none) ||
    none["name"] !== "None" ||
    !isRecord(none["value"]) ||
    none["value"]["kind"] !== "solid" ||
    none["value"]["color"] !== "transparent"
  ) {
    issues.push(
      issue(
        "missing-field",
        "/globals/palette/none",
        "palette.none must be the immutable transparent token.",
      ),
    );
  }
}

/** v2 palette tokens are paints, not untyped values carried from the old document model. */
function palettePaints(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value) || !isRecord(value["palette"])) return;
  for (const [id, entry] of Object.entries(value["palette"])) {
    const path = `/globals/palette/${id}/value`;
    if (!isRecord(entry) || !isRecord(entry["value"])) {
      issues.push(
        issue(
          "wrong-type",
          path,
          "A palette value must be a solid or linear gradient paint.",
        ),
      );
      continue;
    }
    const paint = entry["value"];
    if (paint["kind"] === "solid") {
      if (
        typeof paint["color"] !== "string" ||
        paint["color"].length === 0 ||
        Object.keys(paint).length !== 2
      ) {
        issues.push(
          issue(
            "wrong-type",
            path,
            "A solid palette paint needs only a non-empty CSS colour.",
          ),
        );
      }
      continue;
    }
    if (
      paint["kind"] !== "gradient" ||
      !Number.isFinite(paint["angle"]) ||
      !Array.isArray(paint["stops"]) ||
      paint["stops"].length < 2 ||
      Object.keys(paint).length !== 3
    ) {
      issues.push(
        issue(
          "wrong-type",
          path,
          "A gradient palette paint needs an angle and at least two stops.",
        ),
      );
      continue;
    }
    let previous = -1;
    for (const [index, stop] of paint["stops"].entries()) {
      if (
        !isRecord(stop) ||
        !Number.isFinite(stop["offset"]) ||
        (stop["offset"] as number) < 0 ||
        (stop["offset"] as number) > 1 ||
        (stop["offset"] as number) < previous ||
        typeof stop["color"] !== "string" ||
        stop["color"].length === 0 ||
        Object.keys(stop).length !== 2
      ) {
        issues.push(
          issue(
            "wrong-type",
            `${path}/stops/${index}`,
            "Gradient stops need ascending 0–1 offsets and non-empty CSS colours.",
          ),
        );
      } else previous = stop["offset"] as number;
    }
  }
}

function editorMetadata(value: unknown, issues: ValidationIssue[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push(
      issue(
        "wrong-type",
        "/editorMetadata",
        "editorMetadata must be a JSON object.",
      ),
    );
    return;
  }
  jsonSafe(value, "/editorMetadata", 0, issues);
}

function rejectGifAssets(value: unknown, issues: ValidationIssue[]): void {
  if (!Array.isArray(value)) return;
  for (const [index, asset] of value.entries()) {
    if (isRecord(asset) && asset["kind"] === "gif") {
      issues.push(
        issue(
          "invalid-enum",
          `/assets/${index}/kind`,
          "An asset kind must be one of: image, svg, video, font.",
        ),
      );
    }
  }
}

function bindings(
  value: unknown,
  sceneIds: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push(
      issue(
        "wrong-type",
        "/bindings",
        "bindings must be an object keyed by scene object id.",
      ),
    );
    return;
  }
  const ids = new Set<string>();
  for (const [objectId, entries] of Object.entries(value)) {
    stableId(objectId, `/bindings/${objectId}`, "A bound object id", issues);
    if (!sceneIds.has(objectId)) {
      issues.push(
        issue(
          "unresolved-binding-ref",
          `/bindings/${objectId}`,
          `Object "${objectId}" is not in this scene.`,
        ),
      );
    }
    if (!Array.isArray(entries)) {
      issues.push(
        issue(
          "wrong-type",
          `/bindings/${objectId}`,
          "Bindings for an object must be an array.",
        ),
      );
      continue;
    }
    for (const [index, entry] of entries.entries()) {
      const path = `/bindings/${objectId}/${index}`;
      if (!isRecord(entry)) {
        issues.push(issue("wrong-type", path, "A binding must be an object."));
        continue;
      }
      unknownKeys(entry, path, knownKeysFor("binding"), "A binding", issues);
      if (stableId(entry["id"], `${path}/id`, "A binding id", issues)) {
        if (ids.has(entry["id"])) {
          issues.push(
            issue(
              "duplicate-id",
              `${path}/id`,
              `Binding id "${entry["id"]}" is used more than once.`,
            ),
          );
        }
        ids.add(entry["id"]);
      }
      if (
        typeof entry["semanticKey"] !== "string" ||
        entry["semanticKey"].length === 0 ||
        entry["semanticKey"].length > 120
      ) {
        issues.push(
          issue(
            "missing-field",
            `${path}/semanticKey`,
            "A binding needs a semantic key of 1–120 characters.",
          ),
        );
      }
      if (
        entry["precision"] !== undefined &&
        (!Number.isInteger(entry["precision"]) ||
          (entry["precision"] as number) < 0 ||
          (entry["precision"] as number) > 6)
      ) {
        issues.push(
          issue(
            "out-of-range",
            `${path}/precision`,
            "precision must be an integer from 0 to 6.",
          ),
        );
      }
      if (
        entry["unitDisplay"] !== undefined &&
        !["none", "short", "long"].includes(entry["unitDisplay"] as string)
      ) {
        issues.push(
          issue(
            "invalid-enum",
            `${path}/unitDisplay`,
            "unitDisplay must be one of: none, short, long.",
          ),
        );
      }
      for (const key of ["scale", "offset"] as const) {
        if (
          entry[key] !== undefined &&
          (typeof entry[key] !== "number" || !Number.isFinite(entry[key]))
        ) {
          issues.push(
            issue(
              "wrong-type",
              `${path}/${key}`,
              `${key} must be a finite number.`,
            ),
          );
        }
      }
      for (const key of ["format", "timeZone"] as const) {
        const value = entry[key];
        if (value === undefined) continue;

        if (typeof value !== "string" || value.length > 64) {
          issues.push(
            issue(
              "wrong-type",
              `${path}/${key}`,
              `${key} must be a string of at most 64 characters.`,
            ),
          );
        } else if (key === "timeZone" && !isTimeZoneName(value)) {
          issues.push(
            issue(
              "invalid-enum",
              `${path}/${key}`,
              `timeZone "${value}" is not a zone this runtime knows.`,
            ),
          );
        }
      }
    }
  }
}

function scene(value: unknown, issues: ValidationIssue[]): ReadonlySet<string> {
  const ids = new Set<string>();
  if (!isRecord(value)) {
    issues.push(
      issue("invalid-fabric-scene", "/scene", "scene must be a JSON object."),
    );
    return ids;
  }
  if (
    typeof value["version"] !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(value["version"])
  ) {
    issues.push(
      issue(
        "invalid-fabric-scene",
        "/scene/version",
        "scene.version must be a version string.",
      ),
    );
  }
  if (!Array.isArray(value["objects"])) {
    issues.push(
      issue(
        "invalid-fabric-scene",
        "/scene/objects",
        "scene.objects must be an array.",
      ),
    );
    return ids;
  }
  const count = { value: 0 };
  for (const [index, object] of value["objects"].entries()) {
    sceneObject(object, `/scene/objects/${index}`, 0, ids, count, issues);
  }
  return ids;
}

function sceneObject(
  value: unknown,
  path: string,
  depth: number,
  ids: Set<string>,
  count: { value: number },
  issues: ValidationIssue[],
): void {
  if (!isRecord(value)) {
    issues.push(
      issue("invalid-fabric-scene", path, "A scene object must be an object."),
    );
    return;
  }
  count.value += 1;
  if (count.value > MAX_NODE_COUNT) {
    issues.push(
      issue(
        "too-many-nodes",
        path,
        `The scene exceeds the maximum of ${MAX_NODE_COUNT} objects.`,
      ),
    );
    return;
  }
  if (depth > MAX_SCENE_DEPTH) {
    issues.push(
      issue(
        "too-deep",
        path,
        `Scene nesting exceeds the maximum depth of ${MAX_SCENE_DEPTH}.`,
      ),
    );
    return;
  }
  if (stableId(value["id"], `${path}/id`, "An object id", issues)) {
    if (ids.has(value["id"])) {
      issues.push(
        issue(
          "duplicate-id",
          `${path}/id`,
          `Object id "${value["id"]}" is used more than once.`,
        ),
      );
    }
    ids.add(value["id"]);
  }
  if (typeof value["type"] !== "string" || value["type"].length === 0) {
    issues.push(
      issue(
        "invalid-fabric-scene",
        `${path}/type`,
        "A scene object needs a type.",
      ),
    );
  }
  objectGlass(value, path, issues);
  objectName(value, path, issues);
  if (!jsonSafe(value, path, depth, issues)) return;
  if (value["objects"] !== undefined) {
    if (!Array.isArray(value["objects"])) {
      issues.push(
        issue(
          "invalid-fabric-scene",
          `${path}/objects`,
          "A group objects property must be an array.",
        ),
      );
    } else {
      for (const [index, child] of value["objects"].entries()) {
        sceneObject(
          child,
          `${path}/objects/${index}`,
          depth + 1,
          ids,
          count,
          issues,
        );
      }
    }
  }
}

/**
 * The authored glass treatment, refused before revival rather than coerced.
 * An unsupported object kind is a separate refusal: Task 1 measured a clipped
 * backdrop for rectangles and groups only, so anything else is refused until
 * it has been measured rather than rendering an unproven treatment.
 */
function objectGlass(
  value: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[],
): void {
  const treatment = value[YUNARI_GLASS_PROPERTY];
  if (treatment === undefined) return;
  if (typeof value["type"] === "string" && !supportsGlass(value["type"])) {
    issues.push(
      issue(
        "invalid-enum",
        `${path}/${YUNARI_GLASS_PROPERTY}`,
        `A ${value["type"]} cannot carry a glass treatment.`,
      ),
    );
    return;
  }
  if (!isGlassTreatment(treatment))
    issues.push(
      issue(
        "invalid-fabric-scene",
        `${path}/${YUNARI_GLASS_PROPERTY}`,
        `A glass treatment must be exactly { blurRadius }, a number from 0 to ${MAX_GLASS_BLUR_RADIUS} artboard units.`,
      ),
    );
}

/**
 * The display name an object carries beside its stable id, refused before
 * revival rather than coerced. Absence is legal and means the id stands in —
 * a scene authored before the field still opens — so only a present value that
 * is not a readable label is a refusal.
 */
function objectName(
  value: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[],
): void {
  const name = value[YUNARI_NAME_PROPERTY];
  if (name === undefined || isObjectName(name)) return;
  issues.push(
    issue(
      "invalid-fabric-scene",
      `${path}/${YUNARI_NAME_PROPERTY}`,
      "An object name must be a non-blank string, so the layer list has something to show.",
    ),
  );
}

function jsonSafe(
  value: unknown,
  path: string,
  depth: number,
  issues: ValidationIssue[],
): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return true;
    issues.push(
      issue(
        "invalid-fabric-scene",
        path,
        "Scene values must be finite JSON values.",
      ),
    );
    return false;
  }
  if (depth > MAX_SCENE_DEPTH + 8) {
    issues.push(
      issue("too-deep", path, "The scene JSON is too deeply nested."),
    );
    return false;
  }
  if (Array.isArray(value))
    return value.every((item, index) =>
      jsonSafe(item, `${path}/${index}`, depth + 1, issues),
    );
  if (isRecord(value))
    return Object.entries(value).every(([key, item]) =>
      jsonSafe(item, `${path}/${key}`, depth + 1, issues),
    );
  issues.push(
    issue("invalid-fabric-scene", path, "Scene values must be JSON-safe."),
  );
  return false;
}

function stableId(
  value: unknown,
  path: string,
  what: string,
  issues: ValidationIssue[],
): value is string {
  if (typeof value === "string" && STABLE_ID_PATTERN.test(value)) return true;
  issues.push(
    issue(
      "invalid-id",
      path,
      `${what} must match ${STABLE_ID_PATTERN.source} — 1–64 letters, digits, underscores or dashes.`,
    ),
  );
  return false;
}

function unknownKeys(
  value: Record<string, unknown>,
  path: string,
  allowed: readonly string[],
  what: string,
  issues: ValidationIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key))
      issues.push(
        issue(
          "unknown-field",
          `${path}/${key}`,
          `${what} has no "${key}" property.`,
        ),
      );
  }
}

function fail(
  code: ValidationIssue["code"],
  path: string,
  message: string,
): FabricEnvelopeValidationResult {
  return { ok: false, issues: [issue(code, path, message)] };
}

function issue(
  code: ValidationIssue["code"],
  path: string,
  message: string,
): ValidationIssue {
  return { code, path, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
