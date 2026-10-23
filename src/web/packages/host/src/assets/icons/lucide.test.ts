import { describe, expect, it } from "vitest";
import { LUCIDE_ICONS, lucideSource, searchLucide } from "./lucide.js";

const context = {
  credential: () => undefined,
  signal: new AbortController().signal,
  fetch: globalThis.fetch,
};

describe("the Lucide manifest", () => {
  it("is generated as plain SVG data", () => {
    expect(LUCIDE_ICONS.length).toBeGreaterThan(1000);

    for (const icon of LUCIDE_ICONS) {
      expect(icon.svg.startsWith("<svg")).toBe(true);
      expect(icon.svg).not.toContain("script");
    }
  });
});

describe("searchLucide", () => {
  it("treats a space and a hyphen as one separator", () => {
    expect(
      searchLucide("arrow down", 1).results.map((entry) => entry.id),
    ).toContain("arrow-down");
  });

  it("pages fifty at a time and never repeats a page", () => {
    const first = searchLucide("", 1);
    expect(first.results).toHaveLength(50);
    expect(first.totalPages).toBe(Math.ceil(LUCIDE_ICONS.length / 50));

    const second = searchLucide("", 2);
    expect(second.results[0]?.id).not.toBe(first.results[0]?.id);
    expect(
      second.results.some((entry) =>
        first.results.some((previous) => previous.id === entry.id),
      ),
    ).toBe(false);
  });

  it("answers the first page for a page that is not a page number", () => {
    expect(searchLucide("", 0).results).toEqual(searchLucide("", 1).results);
    expect(searchLucide("", Number.NaN).results).toEqual(
      searchLucide("", 1).results,
    );
  });
});

describe("the Lucide source", () => {
  it("declares a grid body and no credential", () => {
    expect(lucideSource).toMatchObject({
      id: "lucide",
      category: "icon",
      body: "grid",
      requires: undefined,
      configurable: true,
    });
  });

  it("answers an icon's SVG as its bytes", async () => {
    const bytes = await lucideSource.bytesOf("arrow-down", context);

    expect(bytes?.contentType).toBe("image/svg+xml");
    expect(bytes?.filename).toBe("arrow-down.svg");
    expect(new TextDecoder().decode(bytes?.bytes)).toContain("<svg");
  });

  it("answers nothing for an icon it does not know", async () => {
    expect(await lucideSource.bytesOf("not-an-icon", context)).toBeUndefined();
  });
});
