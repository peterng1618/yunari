import { describe, expect, it } from "vitest";
import {
  COLLECTION_PACKAGE_FORMAT,
  MAX_COLLECTION_INCLUDES,
  readCollectionPackage,
} from "./collection-package.js";

const ITEM = "3f2a1c9e-8b7d-4c6a-9e0f-1a2b3c4d5e6f";
const OTHER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

function bytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function manifest(overrides: Record<string, unknown> = {}): unknown {
  return {
    format: COLLECTION_PACKAGE_FORMAT,
    version: 1,
    name: "Acme Kit",
    description: "",
    includes: [{ id: ITEM }],
    ...overrides,
  };
}

function refusal(packageBytes: Uint8Array): string {
  const result = readCollectionPackage(packageBytes);
  if (result.ok) throw new Error("expected the collection to be refused");
  return result.message;
}

describe("reading a collection package", () => {
  it("reads a minimal collection", () => {
    expect(readCollectionPackage(bytes(manifest()))).toEqual({
      ok: true,
      package: {
        name: "Acme Kit",
        description: "",
        includes: [{ id: ITEM, optional: false }],
      },
    });
  });

  it("refuses bytes that are not UTF-8", () => {
    expect(refusal(new Uint8Array([0x7b, 0xff, 0x7d]))).toMatch(/UTF-8/);
  });

  it("refuses a wrong format or version", () => {
    expect(
      refusal(bytes(manifest({ format: "yunari-something-else" }))),
    ).toMatch(/format/);
    expect(refusal(bytes(manifest({ version: 2 })))).toMatch(/version/);
  });

  it("refuses an empty name, an empty includes list, and more than 64 includes", () => {
    expect(refusal(bytes(manifest({ name: "   " })))).toMatch(/name/);
    expect(refusal(bytes(manifest({ includes: [] })))).toMatch(/include/);
    expect(
      refusal(
        bytes(
          manifest({
            includes: Array.from(
              { length: MAX_COLLECTION_INCLUDES + 1 },
              () => ({
                id: ITEM,
              }),
            ),
          }),
        ),
      ),
    ).toMatch(/include/);
  });

  it("refuses a name of more than 200 characters or a description over 2000", () => {
    expect(refusal(bytes(manifest({ name: "a".repeat(201) })))).toMatch(/name/);
    expect(refusal(bytes(manifest({ description: "a".repeat(2001) })))).toMatch(
      /description/,
    );
  });

  it("refuses a non-catalogue id and a duplicate id", () => {
    expect(
      refusal(bytes(manifest({ includes: [{ id: "Not-A-UUID" }] }))),
    ).toMatch(/id/);
    expect(
      refusal(bytes(manifest({ includes: [{ id: ITEM }, { id: ITEM }] }))),
    ).toMatch(/twice/);
  });

  it("refuses a present optional that is not a boolean", () => {
    expect(
      refusal(bytes(manifest({ includes: [{ id: ITEM, optional: "yes" }] }))),
    ).toMatch(/optional/);
  });

  it("defaults optional to false and keeps an explicit true", () => {
    const result = readCollectionPackage(
      bytes(
        manifest({
          includes: [{ id: ITEM }, { id: OTHER, optional: true }],
        }),
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.package.includes).toEqual([
      { id: ITEM, optional: false },
      { id: OTHER, optional: true },
    ]);
  });
});
