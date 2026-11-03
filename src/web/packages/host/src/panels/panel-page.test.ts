import { describe, expect, it } from "vitest";
import { panelPageUrl, themePageUrl } from "./panel-page.js";

/**
 * The page a hardware panel renders. `panel=1` is what the player reads to make
 * an unmarked glass panel sample the declared still, so a URL that loses it
 * renders a panel the browser can follow but the panel cannot show.
 */
describe("the panel page URL", () => {
  it("names the display and marks the page as a panel", () => {
    const url = new URL(panelPageUrl(5227, "turzx-1"));
    expect(url.origin).toBe("http://127.0.0.1:5227");
    expect(url.searchParams.get("display")).toBe("turzx-1");
    expect(url.searchParams.get("panel")).toBe("1");
  });

  it("says when the device plays the clip itself", () => {
    const url = new URL(panelPageUrl(5227, "turzx-1", true));
    expect(url.searchParams.get("clip")).toBe("1");
  });

  it("leaves the flag off a still panel", () => {
    const url = new URL(panelPageUrl(5227, "kraken-1", false));
    expect(url.searchParams.get("clip")).toBeNull();
  });

  it("escapes an id that is not a bare word", () => {
    const url = new URL(panelPageUrl(5227, "panel one/2"));
    expect(url.searchParams.get("display")).toBe("panel one/2");
  });

  it("names the theme a preview renders, escaped", () => {
    const url = new URL(panelPageUrl(5227, "turzx-1", true, "night sky/2"));
    expect(url.searchParams.get("theme")).toBe("night sky/2");
    expect(url.searchParams.get("clip")).toBe("1");
  });

  it("leaves the theme off a page that renders the display's own choice", () => {
    const url = new URL(panelPageUrl(5227, "turzx-1", false));
    expect(url.searchParams.get("theme")).toBeNull();
  });
});

describe("the theme page URL", () => {
  it("names only the theme, escaped", () => {
    const url = new URL(themePageUrl(5227, "night sky/2"));
    expect(url.origin).toBe("http://127.0.0.1:5227");
    expect(url.searchParams.get("theme")).toBe("night sky/2");
    expect(url.searchParams.has("display")).toBe(false);
    expect(url.searchParams.has("panel")).toBe(false);
  });
});
