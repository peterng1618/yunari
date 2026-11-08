import { describe, expect, it } from "vitest";
import { storedDocumentNeedsRewrite } from "./stored-document.js";

describe("storedDocumentNeedsRewrite", () => {
  it("rewrites only a document older than the current major", () => {
    expect(storedDocumentNeedsRewrite({ schemaVersion: "2.0.0" })).toBe(true);
    expect(storedDocumentNeedsRewrite({ schemaVersion: "2.1.0" })).toBe(true);
    expect(storedDocumentNeedsRewrite({ schemaVersion: 2 })).toBe(true);
    expect(storedDocumentNeedsRewrite({ schemaVersion: 3 })).toBe(true);
    expect(storedDocumentNeedsRewrite({ schemaVersion: "3.0.0" })).toBe(false);
    expect(storedDocumentNeedsRewrite({ schemaVersion: "3.4.9" })).toBe(false);
    expect(storedDocumentNeedsRewrite({ schemaVersion: 4 })).toBe(false);
    expect(storedDocumentNeedsRewrite({ schemaVersion: "nonsense" })).toBe(
      false,
    );
    expect(storedDocumentNeedsRewrite({})).toBe(false);
  });
});
