import { describe, expect, it } from "vitest";
import type { AssetSource } from "./source.js";
import { ASSET_SOURCES, createAssetSources } from "./sources.js";

/** The registry's four colour adapters, each named by the preset it yields:
 *  a source whose `presetKind` drifted would be asked for the wrong kind by the
 *  finder's filter. */
const COLOUR_KINDS: Readonly<Record<string, "palette" | "gradient">> = {
  colorhunt: "palette",
  colorswoop: "palette",
  uigradients: "gradient",
  webgradients: "gradient",
};

describe("ASSET_SOURCES", () => {
  it("registers the four colour sources with their preset kinds", () => {
    const byId = new Map(ASSET_SOURCES.map((source) => [source.id, source]));

    for (const [id, kind] of Object.entries(COLOUR_KINDS)) {
      const source = byId.get(id);
      expect(source, id).toBeDefined();
      expect(source?.category).toBe("colour");
      expect(source?.presetKind).toBe(kind);
    }
  });

  it("still registers the sources that predate the Colours tab", () => {
    const ids = ASSET_SOURCES.map((source) => source.id);

    for (const id of [
      "lucide",
      "lineicons",
      "fontawesome-free",
      "unsplash",
      "wallpaper-engine",
    ]) {
      expect(ids).toContain(id);
    }
  });
});

describe("createAssetSources", () => {
  const pluginSource: AssetSource = {
    id: "acme",
    label: "Acme",
    category: "image",
    body: "grid",
    requires: undefined,
    configurable: false,
    search: async () => ({ results: [], totalPages: undefined }),
    bytesOf: async () => undefined,
  };

  it("appends plugin sources after every built-in", () => {
    const sources = createAssetSources(ASSET_SOURCES, [pluginSource]);

    expect(sources.slice(0, ASSET_SOURCES.length)).toEqual(ASSET_SOURCES);
    expect(sources.at(-1)).toBe(pluginSource);
  });
});
