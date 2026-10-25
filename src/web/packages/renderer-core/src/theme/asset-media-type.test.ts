import { describe, expect, it } from "vitest";
import { ASSET_EXTENSIONS, themeAssetContentType } from "./asset-media-type.js";

/**
 * The media type of a theme asset is the declared kind's, never the path's.
 *
 * A path an author can write and a kind they can type are two independent
 * fields, so the pair is what decides; a `.html` file declared as an image is
 * neither an image nor a page.
 */

describe("theme asset media type", () => {
  it("answers the media type of an extension the kind allows", () => {
    expect(themeAssetContentType({ kind: "image", path: "assets/x.png" })).toBe(
      "image/png",
    );
    expect(themeAssetContentType({ kind: "svg", path: "assets/x.svg" })).toBe(
      "image/svg+xml",
    );
    expect(themeAssetContentType({ kind: "video", path: "assets/x.mp4" })).toBe(
      "video/mp4",
    );
    expect(
      themeAssetContentType({ kind: "font", path: "assets/x.woff2" }),
    ).toBe("font/woff2");
  });

  it("refuses an extension the kind does not allow", () => {
    expect(
      themeAssetContentType({ kind: "image", path: "assets/x.html" }),
    ).toBeUndefined();
    expect(
      themeAssetContentType({ kind: "image", path: "assets/x.js" }),
    ).toBeUndefined();
    // SVG and GIF have their own kinds; declaring them as an image is a
    // mismatch, not a broader image type.
    expect(
      themeAssetContentType({ kind: "image", path: "assets/x.svg" }),
    ).toBeUndefined();
    expect(
      themeAssetContentType({ kind: "image", path: "assets/x.gif" }),
    ).toBeUndefined();
    expect(
      themeAssetContentType({ kind: "video", path: "assets/x.png" }),
    ).toBeUndefined();
    expect(
      themeAssetContentType({ kind: "image", path: "assets/x" }),
    ).toBeUndefined();
  });

  it("refuses a kind it does not know", () => {
    expect(
      themeAssetContentType({ kind: "executable", path: "assets/x.png" }),
    ).toBeUndefined();
  });

  it("names exactly the extensions each kind may carry", () => {
    expect(ASSET_EXTENSIONS).toEqual({
      image: ["png", "jpg", "jpeg", "webp", "avif"],
      svg: ["svg"],
      gif: ["gif"],
      video: ["mp4", "webm"],
      font: ["woff2"],
    });
  });
});
