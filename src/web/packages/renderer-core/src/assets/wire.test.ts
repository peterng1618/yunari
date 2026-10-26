import { describe, expect, it } from "vitest";
import { parseAssetSearchRequest } from "./wire.js";

describe("parseAssetSearchRequest", () => {
  it("parses a well-formed search", () => {
    expect(
      parseAssetSearchRequest(
        { query: "arrow", enabled: ["lucide"], pages: { lucide: 2 } },
        ["lucide", "fontawesome-free"],
      ),
    ).toEqual({
      query: "arrow",
      enabled: ["lucide"],
      pages: { lucide: 2 },
    });
  });

  it("drops an enabled id this host does not know", () => {
    // A stale browser preference must not fail the search, and an unknown id
    // must not reach a source that is not registered.
    expect(
      parseAssetSearchRequest({ query: "arrow", enabled: ["gone", "lucide"] }, [
        "lucide",
      ]),
    ).toEqual({ query: "arrow", enabled: ["lucide"], pages: {} });
  });

  it("refuses a body with no query", () => {
    expect(
      parseAssetSearchRequest({ enabled: ["lucide"] }, ["lucide"]),
    ).toBeUndefined();
    expect(
      parseAssetSearchRequest({ query: 7, enabled: ["lucide"] }, ["lucide"]),
    ).toBeUndefined();
  });

  it("refuses a body whose enabled is not an array", () => {
    expect(
      parseAssetSearchRequest({ query: "arrow", enabled: "lucide" }, [
        "lucide",
      ]),
    ).toBeUndefined();
  });

  it("drops a page that is not a whole page number", () => {
    expect(
      parseAssetSearchRequest(
        {
          query: "arrow",
          enabled: ["lucide"],
          pages: { lucide: 0, "fontawesome-free": 2, extra: null, gone: 3 },
        },
        ["lucide", "fontawesome-free"],
      ),
    ).toEqual({
      query: "arrow",
      enabled: ["lucide"],
      pages: { "fontawesome-free": 2, gone: 3 },
    });
  });

  it("carries a named body through to the host", () => {
    expect(
      parseAssetSearchRequest(
        { query: "inter", enabled: ["font"], body: "font-picker" },
        ["font"],
      ),
    ).toEqual({
      query: "inter",
      enabled: ["font"],
      pages: {},
      body: "font-picker",
    });
  });

  it("drops a body this host does not name, leaving the grid default", () => {
    // A stale browser preference is not a reason to fail a search, as with an
    // unknown source id.
    expect(
      parseAssetSearchRequest(
        { query: "inter", enabled: [], body: "wallpaper-engine" },
        [],
      ),
    ).toEqual({ query: "inter", enabled: [], pages: {} });
    expect(
      parseAssetSearchRequest({ query: "inter", enabled: [], body: 7 }, []),
    ).toEqual({ query: "inter", enabled: [], pages: {} });
  });

  it("answers no pages when the field is absent or not an object", () => {
    expect(parseAssetSearchRequest({ query: "", enabled: [] }, [])).toEqual({
      query: "",
      enabled: [],
      pages: {},
    });
    expect(
      parseAssetSearchRequest(
        { query: "", enabled: [], pages: ["lucide"] },
        [],
      ),
    ).toEqual({ query: "", enabled: [], pages: {} });
  });

  it("refuses a value that is not an object", () => {
    expect(parseAssetSearchRequest(undefined, [])).toBeUndefined();
    expect(parseAssetSearchRequest(null, [])).toBeUndefined();
    expect(parseAssetSearchRequest("{}", [])).toBeUndefined();
  });
});
