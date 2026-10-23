import { describe, expect, it } from "vitest";
import { YUNARI_GLASS_PROPERTY } from "./glass.js";
import { performanceCostsOf } from "./performance-cost.js";

/** Envelopes built inline: no renderer, no DOM, and nothing revived. The
 *  declaration is the only thing these fixtures get wrong on purpose. */

const GLASS_PANEL = {
  type: "Rect",
  id: "panel",
  [YUNARI_GLASS_PROPERTY]: { blurRadius: 16 },
};

const VIDEO_ASSET = { id: "loop", kind: "video", path: "assets/loop.webm" };
const IMAGE_ASSET = { id: "loop", kind: "image", path: "assets/loop.webm" };

/** A theme whose background is `asset`, drawing `objects` over it. */
function backgroundTheme(
  asset: { id: string; kind: string; path: string },
  objects: readonly unknown[] = [],
): unknown {
  return {
    schemaVersion: 2,
    background: {
      media: { assetId: asset.id, bounds: "theme" },
    },
    assets: [asset],
    scene: { version: "7.4.0", objects },
  };
}

const videoOnly = backgroundTheme(VIDEO_ASSET);
const videoWithGlass = backgroundTheme(VIDEO_ASSET, [GLASS_PANEL]);
const glassOverImage = backgroundTheme(IMAGE_ASSET, [GLASS_PANEL]);
/** No background media and no glass at all. */
const plain = { schemaVersion: 2, scene: { version: "7.4.0", objects: [] } };
/** Glass over nothing: the treatment costs what it composites over. */
const glassOnly = {
  schemaVersion: 2,
  scene: { version: "7.4.0", objects: [GLASS_PANEL] },
};

/** The same fixture with only the asset's declared kind changed: its `path`
 *  still names the video file, so an implementation that sniffed the extension
 *  answers differently from one that reads the declaration. */
function withAssetKind(envelope: unknown, kind: string): unknown {
  const copy = structuredClone(envelope) as { assets: { kind: string }[] };
  copy.assets[0]!.kind = kind;
  return copy;
}

describe("what a theme costs the display it is given to", () => {
  it("finds a video background and no glass", () => {
    expect(performanceCostsOf(videoOnly)).toEqual(["video-background"]);
  });

  it("finds glass over a video", () => {
    expect(performanceCostsOf(videoWithGlass)).toEqual(["glass-over-video"]);
  });

  it("finds glass inside a group, where the editor puts a card", () => {
    const grouped = backgroundTheme(VIDEO_ASSET, [
      {
        type: "Group",
        id: "card",
        objects: [{ type: "Rect", id: "inner" }, GLASS_PANEL],
      },
    ]);

    expect(performanceCostsOf(grouped)).toEqual(["glass-over-video"]);
  });

  it("finds neither for a plain theme, and neither for glass over an image", () => {
    expect(performanceCostsOf(plain)).toEqual([]);
    expect(performanceCostsOf(glassOverImage)).toEqual([]);
    // Glass is only a cost over a video: it composites over nothing here.
    expect(performanceCostsOf(glassOnly)).toEqual([]);
  });

  it("does not call an image background a video one", () => {
    // One field changed from the case above, and the stale path is what proves
    // the declaration decides: an implementation that sniffed the extension
    // answers ["video-background"] here.
    expect(performanceCostsOf(withAssetKind(videoWithGlass, "image"))).toEqual(
      [],
    );
  });

  it("answers no costs for anything malformed, and never throws", () => {
    for (const bad of [undefined, null, 42, "theme", {}, { artboard: 3 }]) {
      expect(performanceCostsOf(bad)).toEqual([]);
    }
  });

  it("answers no costs for a background whose asset is not declared", () => {
    const dangling = {
      schemaVersion: 2,
      artboard: { width: 640, height: 360 },
      background: { media: { assetId: "loop", bounds: "theme" } },
      assets: [],
      scene: { version: "7.4.0", objects: [GLASS_PANEL] },
    };

    expect(performanceCostsOf(dangling)).toEqual([]);
  });
});
