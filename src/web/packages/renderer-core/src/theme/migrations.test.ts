import { describe, expect, it } from "vitest";
import type { ValidationIssue } from "./envelope-semantics.js";
import {
  parseSchemaMajor,
  SUPPORTED_SCHEMA_MAJOR,
  SUPPORTED_SCHEMA_VERSION,
} from "./fabric-envelope.js";
import {
  readFabricThemeEnvelope,
  validateFabricThemeEnvelope,
} from "./fabric-envelope-validate.js";
import {
  type EnvelopeMigration,
  MIN_SUPPORTED_SCHEMA_MAJOR,
  type MigrationResult,
  migrateFabricThemeEnvelope,
  runSchemaMigrations,
  SCHEMA_MIGRATIONS,
} from "./migrations.js";

/** The smallest document the strict validator accepts. */
function envelope(
  schemaVersion: unknown = SUPPORTED_SCHEMA_VERSION,
): Record<string, unknown> {
  return {
    schemaVersion,
    fabricVersion: "7.4.0",
    id: "theme",
    metadata: { themeLanguage: "en" },
    artboard: { width: 400, height: 300 },
    scene: { version: "7.4.0", objects: [] },
  };
}

function migrationIssue(result: MigrationResult): ValidationIssue {
  if (result.ok) throw new Error("expected a refusal");
  return result.issue;
}

function strictIssue(input: unknown): ValidationIssue {
  const result = validateFabricThemeEnvelope(input);
  if (result.ok) throw new Error("expected the strict validator to refuse");
  const [issue] = result.issues;
  if (issue === undefined) throw new Error("expected an issue");
  return issue;
}

describe("runSchemaMigrations", () => {
  it("applies a chain in ascending order and carries every field forward", () => {
    const order: number[] = [];
    const migrations: Record<number, EnvelopeMigration> = {
      1: (input) => {
        order.push(1);
        return { ...input, schemaVersion: "2.0.0", addedIn2: true };
      },
      2: (input) => {
        order.push(2);
        return { ...input, schemaVersion: "3.0.0", addedIn3: true };
      },
    };

    const result = runSchemaMigrations(
      { schemaVersion: "1.0.0", id: "theme" },
      1,
      3,
      migrations,
    );

    expect(result.ok).toBe(true);
    expect(order).toEqual([1, 2]);
    if (!result.ok) throw new Error("expected the chain to run");
    expect(result.fromMajor).toBe(1);
    expect(result.document).toMatchObject({
      schemaVersion: "3.0.0",
      id: "theme",
      addedIn2: true,
      addedIn3: true,
    });
  });

  it("refuses a missing step without returning a partial document", () => {
    const result = runSchemaMigrations({ schemaVersion: "1.0.0" }, 1, 3, {
      1: (input) => ({ ...input, schemaVersion: "2.0.0" }),
    });

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("document");
    expect(migrationIssue(result)).toMatchObject({
      code: "unsupported-schema-version",
      path: "/schemaVersion",
    });
  });

  it("refuses a migration that does not set the target major", () => {
    const result = runSchemaMigrations({ schemaVersion: "2.0.0" }, 2, 3, {
      2: (input) => ({ ...input, touched: true }),
    });

    expect(result.ok).toBe(false);
    expect(migrationIssue(result)).toMatchObject({
      code: "unsupported-schema-version",
      path: "/schemaVersion",
    });
  });

  it("refuses a non-object input with the sentence the strict validator prints", () => {
    const result = migrateFabricThemeEnvelope("not a theme");

    expect(migrationIssue(result)).toEqual(strictIssue("not a theme"));
  });

  it("refuses a malformed schemaVersion with the strict validator's own sentence", () => {
    for (const schemaVersion of [3, "2", "v2.0.0", {}, null, undefined]) {
      const input = { ...envelope(), schemaVersion };
      expect(migrationIssue(migrateFabricThemeEnvelope(input))).toEqual(
        strictIssue(input),
      );
    }
  });
});

describe("migrateFabricThemeEnvelope", () => {
  it("returns a current document unchanged", () => {
    const document = envelope();
    const result = migrateFabricThemeEnvelope(document);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the current document to pass");
    expect(result.document).toEqual(document);
    expect(result.fromMajor).toBe(SUPPORTED_SCHEMA_MAJOR);
  });

  it("normalises the legacy integer equal to the current major", () => {
    const legacy = { ...envelope(), schemaVersion: SUPPORTED_SCHEMA_MAJOR };
    const result = migrateFabricThemeEnvelope(legacy);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the legacy integer to normalise");
    expect(result.document["schemaVersion"]).toBe(SUPPORTED_SCHEMA_VERSION);
    expect(result.fromMajor).toBe(SUPPORTED_SCHEMA_MAJOR);
  });

  it("refuses any other integer", () => {
    for (const schemaVersion of [
      SUPPORTED_SCHEMA_MAJOR + 1,
      MIN_SUPPORTED_SCHEMA_MAJOR - 1,
    ]) {
      const input = { ...envelope(), schemaVersion };
      expect(migrationIssue(migrateFabricThemeEnvelope(input))).toEqual(
        strictIssue(input),
      );
    }
  });

  it("refuses a newer major and a major below the supported floor", () => {
    const newer = { ...envelope(), schemaVersion: "3.0.0" };
    expect(migrationIssue(migrateFabricThemeEnvelope(newer))).toEqual(
      strictIssue(newer),
    );

    const below = {
      ...envelope(),
      schemaVersion: `${MIN_SUPPORTED_SCHEMA_MAJOR - 1}.0.0`,
    };
    expect(migrationIssue(migrateFabricThemeEnvelope(below))).toEqual(
      strictIssue(below),
    );
  });
});

describe("readFabricThemeEnvelope", () => {
  it("accepts a current document", () => {
    const result = readFabricThemeEnvelope(envelope());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a current document to read");
    expect(result.envelope.schemaVersion).toBe(SUPPORTED_SCHEMA_VERSION);
  });

  it("accepts the legacy integer", () => {
    const result = readFabricThemeEnvelope({
      ...envelope(),
      schemaVersion: SUPPORTED_SCHEMA_MAJOR,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the legacy integer to read");
    expect(result.envelope.schemaVersion).toBe(SUPPORTED_SCHEMA_VERSION);
  });

  it("returns the validator's refusal for an unsupported version", () => {
    const input = {
      ...envelope(),
      schemaVersion: `${MIN_SUPPORTED_SCHEMA_MAJOR - 1}.0.0`,
    };
    const result = readFabricThemeEnvelope(input);
    const strict = validateFabricThemeEnvelope(input);

    expect(result.ok).toBe(false);
    if (result.ok || strict.ok) throw new Error("expected both to refuse");
    expect(result.issues).toEqual(strict.issues);
  });

  it("passes the validator's options through", () => {
    const noRoles = {
      ...envelope(),
      globals: {
        typePresets: {
          body: {
            name: "Body",
            value: { family: "Inter", size: 16 },
          },
        },
      },
    };

    expect(readFabricThemeEnvelope(noRoles).ok).toBe(true);
    expect(
      readFabricThemeEnvelope(noRoles, { requireTrioRoles: true }).ok,
    ).toBe(false);
  });
});

describe("the shipped migration table", () => {
  it("covers every major the reader accepts below the current one", () => {
    expect(MIN_SUPPORTED_SCHEMA_MAJOR).toBe(
      Math.max(2, SUPPORTED_SCHEMA_MAJOR - 1),
    );

    const accepted = [];
    for (
      let major = MIN_SUPPORTED_SCHEMA_MAJOR;
      major < SUPPORTED_SCHEMA_MAJOR;
      major += 1
    )
      accepted.push(major);

    for (const major of accepted)
      expect(SCHEMA_MIGRATIONS[major], `schema ${major}`).toBeTypeOf(
        "function",
      );

    // The loop is a forward obligation: at 2.0.0 it names no major.
    expect(accepted).toEqual(
      Array.from(
        {
          length: Math.max(
            0,
            SUPPORTED_SCHEMA_MAJOR - MIN_SUPPORTED_SCHEMA_MAJOR,
          ),
        },
        (_, index) => MIN_SUPPORTED_SCHEMA_MAJOR + index,
      ),
    );
  });

  it("agrees with parseSchemaMajor about the current version", () => {
    expect(parseSchemaMajor(SUPPORTED_SCHEMA_VERSION)).toBe(
      SUPPORTED_SCHEMA_MAJOR,
    );
  });
});
