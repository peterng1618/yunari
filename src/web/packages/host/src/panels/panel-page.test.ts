import { describe, expect, it } from "vitest";
import { panelPageUrl } from "./panel-page.js";

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

  it("escapes an id that is not a bare word", () => {
    const url = new URL(panelPageUrl(5227, "panel one/2"));
    expect(url.searchParams.get("display")).toBe("panel one/2");
  });
});
