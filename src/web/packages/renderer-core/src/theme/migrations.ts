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
 * The oldest major this build reads. The legacy integer `2` is the floor: v1
 * was deleted and no v1 document exists.
 */
export const MIN_SUPPORTED_SCHEMA_MAJOR: number = Math.max(
  2,
  SUPPORTED_SCHEMA_MAJOR - 1,
);

/**
 * Keyed by the major being migrated FROM. Empty at `2.0.0`, where the only
 * older shape is the legacy integer; a major added without its entry fails the
 * invariant test.
 */
export const SCHEMA_MIGRATIONS: Readonly<Record<number, EnvelopeMigration>> =
  {};

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
 * The read-side migration: normalises the legacy integer equal to the current
 * major, refuses a malformed, newer or too-old version through the validator's
 * own sentences, and chains the accepted majors upward.
 */
export function migrateFabricThemeEnvelope(
  input: unknown,
  migrations: Readonly<Record<number, EnvelopeMigration>> = SCHEMA_MIGRATIONS,
): MigrationResult {
  if (!isRecord(input)) return { ok: false, issue: notThemeObjectIssue() };

  const version = input["schemaVersion"];
  const document =
    typeof version === "number" && version === SUPPORTED_SCHEMA_MAJOR
      ? { ...input, schemaVersion: SUPPORTED_SCHEMA_VERSION }
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
