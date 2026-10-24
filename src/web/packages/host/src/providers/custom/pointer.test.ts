import { describe, expect, it } from "vitest";
import { resolvePointer } from "./pointer.js";

/**
 * RFC 6901 walks a document by tokens. Every malformed shape is a miss, never
 * an exception: the pointer comes from `sources.json`, and a reading that
 * cannot be taken is a missing sample rather than a failed fetch.
 */

const document = {
  a: [{ b: 1 }, { b: 2 }],
  "": "empty",
  "~sl": "tilde",
  "sl/": "slash",
  nested: { "a/b": { "~": true } },
};

describe("resolvePointer", () => {
  it("treats the empty pointer as the whole document", () => {
    expect(resolvePointer(document, "")).toEqual({
      found: true,
      value: document,
    });
  });

  it("walks objects and array indices", () => {
    expect(resolvePointer(document, "/a/0/b")).toEqual({
      found: true,
      value: 1,
    });
    expect(resolvePointer(document, "/a/1/b")).toEqual({
      found: true,
      value: 2,
    });
  });

  it("decodes ~1 as / and ~0 as ~", () => {
    expect(resolvePointer(document, "/sl~1")).toEqual({
      found: true,
      value: "slash",
    });
    expect(resolvePointer(document, "/~0sl")).toEqual({
      found: true,
      value: "tilde",
    });
    expect(resolvePointer(document, "/nested/a~1b/~0")).toEqual({
      found: true,
      value: true,
    });
  });

  it("decodes an escape sequence one way only", () => {
    // `~01` is `~0` followed by a literal `1`, so it names the key `~1`,
    // not `/` plus `1`.
    expect(resolvePointer({ "~1": "literal", "/": "slash" }, "/~01")).toEqual({
      found: true,
      value: "literal",
    });
  });

  it("treats an escape that is not ~0 or ~1 as a miss", () => {
    expect(resolvePointer({ "~2": 1 }, "/~2")).toEqual({ found: false });
    expect(resolvePointer({ "~": 1 }, "/~")).toEqual({ found: false });
  });

  it("misses a path that is absent", () => {
    expect(resolvePointer(document, "/a/2/b")).toEqual({ found: false });
    expect(resolvePointer(document, "/missing")).toEqual({ found: false });
  });

  it("does not walk the prototype chain", () => {
    expect(resolvePointer({}, "/toString")).toEqual({ found: false });
    expect(resolvePointer([1, 2], "/length")).toEqual({ found: false });
  });

  it("misses array indices that are not canonical", () => {
    expect(resolvePointer([1, 2], "/01")).toEqual({ found: false });
    expect(resolvePointer([1, 2], "/-")).toEqual({ found: false });
    expect(resolvePointer([1, 2], "/2")).toEqual({ found: false });
  });

  it("misses a pointer into a primitive", () => {
    expect(resolvePointer(5, "/a")).toEqual({ found: false });
    expect(resolvePointer(undefined, "/a")).toEqual({ found: false });
  });

  it("misses a non-empty pointer that does not start with /", () => {
    expect(resolvePointer(document, "a")).toEqual({ found: false });
  });

  it("reads an empty-string key from a lone slash", () => {
    expect(resolvePointer(document, "/")).toEqual({
      found: true,
      value: "empty",
    });
  });
});
