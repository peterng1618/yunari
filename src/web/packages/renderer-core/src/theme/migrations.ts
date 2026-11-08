import type { ValidationIssue } from "./envelope-semantics.js";
import {
  newerSchemaVersionIssue,
  notThemeObjectIssue,
  parseSchemaMajor,
  SUPPORTED_SCHEMA_MAJOR,
  SUPPORTED_SCHEMA_VERSION,
  schemaVersionRequiredIssue,
  unsupportedSchemaVersionIssue,
} from "./fabric-envelope.js";

/** One N→N+1 step. It sets the target `schemaVersion` itself. */
export type EnvelopeMigration = (
  input: Readonly<Record<string, unknown>>,
) => Readonly<Record<string, unknown>>;

export type MigrationResult =
  | {
      readonly ok: true;
      readonly document: Readonly<Record<string, unknown>>;
      readonly fromMajor: number;
    }
  | { readonly ok: false; readonly issue: ValidationIssue };

/**
 * The oldest major this build reads: the previous major, because no v1
 * document exists. The legacy integer of every accepted major normalises into
 * this range.
 */
export const MIN_SUPPORTED_SCHEMA_MAJOR: number = Math.max(
  2,
  SUPPORTED_SCHEMA_MAJOR - 1,
);

/** The four authored insets of the pre-composition media region. */
const REGION_INSETS = ["left", "top", "right", "bottom"] as const;

/**
 * Converts a pre-composition `media.region` into the anchored composition that
 * replaced it. A side-anchored band keeps the opposite side's inset as its
 * extent; two opposite insets (or a radial blend) become `center`, which has no
 * authored extent.
 */
function compositionFromRegion(
  region: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const insets: Partial<Record<(typeof REGION_INSETS)[number], number>> = {};
  for (const side of REGION_INSETS) {
    const value = region[side];
    if (typeof value === "number" && Number.isFinite(value))
      insets[side] = value;
  }
  if (Object.keys(insets).length === 0) return {};

  const { left, top, right, bottom } = insets;
  const composition: Record<string, unknown> = {};
  const opposite = [
    { inset: left, anchor: "right" },
    { inset: right, anchor: "left" },
    { inset: top, anchor: "bottom" },
    { inset: bottom, anchor: "top" },
  ] as const;

  if (
    (left !== undefined && right !== undefined) ||
    (top !== undefined && bottom !== undefined)
  ) {
    composition["anchor"] = "center";
  } else {
    let largest:
      | { readonly inset: number; readonly anchor: string }
      | undefined;
    for (const candidate of opposite) {
      if (candidate.inset === undefined) continue;
      if (largest === undefined || candidate.inset > largest.inset)
        largest = { inset: candidate.inset, anchor: candidate.anchor };
    }
    if (largest !== undefined) {
      composition["anchor"] = largest.anchor;
      composition["extent"] = Math.min(1, Math.max(0.1, 1 - largest.inset));
    }
  }

  const blend = isRecord(region["blend"]) ? region["blend"] : undefined;
  const length = blend?.["length"];
  if (typeof length === "number" && Number.isFinite(length)) {
    composition["fade"] = length;
    if (blend?.["shape"] === "radial") {
      composition["anchor"] = "center";
      delete composition["extent"];
    }
  }

  return composition;
}

/** The 2 → 3 step: the background paint moves onto its media and the media's
 *  `region` becomes a `composition`. It is pure and changes a current document
 *  only by its version. */
export function migrateFrom2To3(
  input: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const document = { ...input };
  const source = document["background"];
  if (isRecord(source)) {
    const background = { ...source };
    const declaredMedia = background["media"];
    if (isRecord(declaredMedia)) {
      const media = { ...declaredMedia };
      const paint = background["fill"] ?? background["color"];
      if (media["color"] === undefined && paint !== undefined)
        media["color"] = paint;
      delete background["fill"];
      delete background["color"];

      if (isRecord(media["region"]) && media["composition"] === undefined) {
        media["composition"] = compositionFromRegion(media["region"]);
        delete media["region"];
        if (background["mode"] === undefined) background["mode"] = "advanced";
      }
      background["media"] = media;
    } else {
      if (background["color"] === undefined)
        background["color"] = background["fill"];
      delete background["fill"];
    }
    if (background["mode"] === "basic") background["mode"] = "simple";
    document["background"] = background;
  }

  document["schemaVersion"] = SUPPORTED_SCHEMA_VERSION;
  return document;
}

/**
 * Keyed by the major being migrated FROM. It holds one step per accepted older
 * major; a major added without its entry fails the invariant test.
 */
export const SCHEMA_MIGRATIONS: Readonly<Record<number, EnvelopeMigration>> = {
  2: migrateFrom2To3,
};

/**
 * Chains a migration per major from `fromMajor` up to `toMajor`.
 *
 * It never validates and never writes: validation stays with
 * `validateFabricThemeEnvelope`, and a chain that stops short is reported
 * rather than returned half-migrated.
 */
export function runSchemaMigrations(
  document: unknown,
  fromMajor: number,
  toMajor: number,
  migrations: Readonly<Record<number, EnvelopeMigration>>,
): MigrationResult {
  if (!isRecord(document)) return { ok: false, issue: notThemeObjectIssue() };

  let current: Readonly<Record<string, unknown>> = document;
  for (let major = fromMajor; major < toMajor; major += 1) {
    const migrate = migrations[major];
    if (migrate === undefined)
      return {
        ok: false,
        issue: {
          code: "unsupported-schema-version",
          path: "/schemaVersion",
          message: `No migration exists from schema ${major} to schema ${major + 1}.`,
        },
      };
    current = migrate(current);
  }

  if (parseSchemaMajor(current["schemaVersion"]) !== toMajor)
    return {
      ok: false,
      issue: {
        code: "unsupported-schema-version",
        path: "/schemaVersion",
        message: `A migration from schema ${fromMajor} did not reach schema ${toMajor}.`,
      },
    };

  return { ok: true, document: current, fromMajor };
}

/**
 * The read-side migration: normalises a legacy integer major this build
 * accepts, refuses a malformed, newer or too-old version through the
 * validator's own sentences, and chains the accepted majors upward.
 */
export function migrateFabricThemeEnvelope(
  input: unknown,
  migrations: Readonly<Record<number, EnvelopeMigration>> = SCHEMA_MIGRATIONS,
): MigrationResult {
  if (!isRecord(input)) return { ok: false, issue: notThemeObjectIssue() };

  const version = input["schemaVersion"];
  const document =
    typeof version === "number" &&
    Number.isSafeInteger(version) &&
    version >= MIN_SUPPORTED_SCHEMA_MAJOR &&
    version <= SUPPORTED_SCHEMA_MAJOR
      ? { ...input, schemaVersion: `${version}.0.0` }
      : input;

  const major = parseSchemaMajor(document["schemaVersion"]);
  if (major === undefined)
    return { ok: false, issue: schemaVersionRequiredIssue() };
  if (major > SUPPORTED_SCHEMA_MAJOR)
    return { ok: false, issue: newerSchemaVersionIssue(version) };
  if (major < MIN_SUPPORTED_SCHEMA_MAJOR)
    return { ok: false, issue: unsupportedSchemaVersionIssue(version) };
  if (major === SUPPORTED_SCHEMA_MAJOR)
    return { ok: true, document, fromMajor: major };

  return runSchemaMigrations(
    document,
    major,
    SUPPORTED_SCHEMA_MAJOR,
    migrations,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
