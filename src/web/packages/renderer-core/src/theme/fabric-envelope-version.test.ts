import { describe, expect, it } from "vitest";
import {
  parseSchemaMajor,
  SUPPORTED_SCHEMA_MAJOR,
  SUPPORTED_SCHEMA_VERSION,
} from "./fabric-envelope.js";
import { validateFabricThemeEnvelope } from "./fabric-envelope-validate.js";

/** The smallest document the strict validator accepts, with the version given. */
function envelope(schemaVersion: unknown): Record<string, unknown> {
  return {
    schemaVersion,
    fabricVersion: "7.4.0",
    id: "theme",
    metadata: { themeLanguage: "en" },
    artboard: { width: 400, height: 300 },
    globals: {
      typeTokens: {
        heading: { family: "Inter", weight: 700 },
        body: { family: "Inter", weight: 400 },
        mono: { family: "Consolas, monospace", weight: 400 },
      },
    },
    scene: { version: "7.4.0", objects: [] },
  };
}

function firstIssue(result: ReturnType<typeof validateFabricThemeEnvelope>) {
  if (result.ok) throw new Error("expected a refusal");
  const [issue] = result.issues;
  if (issue === undefined) throw new Error("expected an issue");
  return issue;
}

describe("the schema version is semantic", () => {
  it("pins the supported version and derives its major rather than writing it twice", () => {
    expect(SUPPORTED_SCHEMA_VERSION).toBe("2.0.0");
    expect(SUPPORTED_SCHEMA_MAJOR).toBe(2);
    expect(parseSchemaMajor(SUPPORTED_SCHEMA_VERSION)).toBe(
      SUPPORTED_SCHEMA_MAJOR,
    );
  });

  it("accepts the current version", () => {
    expect(validateFabricThemeEnvelope(envelope("2.0.0")).ok).toBe(true);
  });

  it("accepts a later minor and patch of the same major", () => {
    expect(validateFabricThemeEnvelope(envelope("2.4.9")).ok).toBe(true);
  });

  it("refuses the legacy integer, naming the shape it wants", () => {
    const issue = firstIssue(validateFabricThemeEnvelope(envelope(2)));

    expect(issue.code).toBe("missing-field");
    expect(issue.path).toBe("/schemaVersion");
    expect(issue.message).toContain("major.minor.patch");
  });

  it.each(["2", "2.0", "2.0.0.0", "v2.0.0"])(
    "refuses the malformed version %s",
    (version) => {
      const issue = firstIssue(validateFabricThemeEnvelope(envelope(version)));

      expect(issue.code).toBe("missing-field");
      expect(issue.path).toBe("/schemaVersion");
      expect(issue.message).toContain("major.minor.patch");
    },
  );

  it("refuses a newer major as newer, comparing numerically", () => {
    // `"10.0.0" < "2.0.0"` is true as strings, so a lexicographic compare
    // would call a newer document unsupported instead of newer.
    for (const version of ["3.0.0", "10.0.0"]) {
      const issue = firstIssue(validateFabricThemeEnvelope(envelope(version)));

      expect(issue.code).toBe("newer-schema-version");
      expect(issue.path).toBe("/schemaVersion");
      expect(issue.message).toContain(version);
    }
  });

  it("refuses an older major as unsupported, naming the expected version", () => {
    const issue = firstIssue(validateFabricThemeEnvelope(envelope("1.0.0")));

    expect(issue.code).toBe("unsupported-schema-version");
    expect(issue.path).toBe("/schemaVersion");
    expect(issue.message).toContain("1.0.0");
    expect(issue.message).toContain("2.0.0");
  });

  it("reads a major numerically, and nothing else", () => {
    expect(parseSchemaMajor("10.0.0")).toBe(10);
    expect(parseSchemaMajor("2.4.9")).toBe(2);
    expect(parseSchemaMajor("2")).toBeUndefined();
    expect(parseSchemaMajor(2)).toBeUndefined();
    expect(parseSchemaMajor(undefined)).toBeUndefined();
  });
});
