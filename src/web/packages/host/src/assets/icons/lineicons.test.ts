import { describe, expect, it } from "vitest";
import {
  LINEICONS_ICONS,
  lineiconsSource,
  searchLineicons,
} from "./lineicons.js";

const context = {
  credential: () => undefined,
  signal: new AbortController().signal,
  fetch: globalThis.fetch,
};

describe("the Lineicons manifest", () => {
  it("is generated as plain SVG data", () => {
    expect(LINEICONS_ICONS.length).toBeGreaterThan(500);

    for (const icon of LINEICONS_ICONS) {
      expect(icon.svg.startsWith("<svg")).toBe(true);
      expect(icon.svg).not.toContain("script");
    }
  });
});

describe("searchLineicons", () => {
  it("treats a space and a hyphen as one separator", () => {
    expect(
      searchLineicons("arrow down", 1).results.map((entry) => entry.id),
    ).toContain("arrow-downward");
  });

  it("pages fifty at a time and never repeats a page", () => {
    const first = searchLineicons("", 1);
    expect(first.results).toHaveLength(50);
    expect(first.totalPages).toBe(Math.ceil(LINEICONS_ICONS.length / 50));

    const second = searchLineicons("", 2);
    expect(
      second.results.some((entry) =>
        first.results.some((previous) => previous.id === entry.id),
      ),
    ).toBe(false);
  });

  it("answers the first page for a page that is not a page number", () => {
    expect(searchLineicons("", 0).results).toEqual(
      searchLineicons("", 1).results,
    );
    expect(searchLineicons("", Number.NaN).results).toEqual(
      searchLineicons("", 1).results,
    );
  });
});

describe("the Lineicons source", () => {
  it("declares a grid body and no credential", () => {
    expect(lineiconsSource).toMatchObject({
      id: "lineicons",
      category: "icon",
      body: "grid",
      requires: undefined,
      configurable: true,
    });
  });

  it("answers an icon's SVG as its bytes", async () => {
    const bytes = await lineiconsSource.bytesOf("arrow-downward", context);

    expect(bytes?.contentType).toBe("image/svg+xml");
    expect(bytes?.filename).toBe("arrow-downward.svg");
    expect(new TextDecoder().decode(bytes?.bytes)).toContain("<svg");
  });

  it("answers nothing for an icon it does not know", async () => {
    expect(
      await lineiconsSource.bytesOf("not-an-icon", context),
    ).toBeUndefined();
  });
});
