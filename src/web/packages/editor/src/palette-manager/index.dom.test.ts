// @vitest-environment jsdom
import type { Background } from "@yunari/renderer-core";
import { YUNARI_PAINT_PROPERTY } from "@yunari/scene-fabric";
import { Canvas, Group, Rect, Shadow } from "fabric/es";
import { describe, expect, it } from "vitest";
import { paletteTokenUsage, reassignPaletteToken } from "./index.js";

describe("reassignPaletteToken", () => {
  it("rewrites canvas paint refs, background refs and drops the palette entry", () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const shape = new Rect({ id: "panel" });
    shape.set(YUNARI_PAINT_PROPERTY, { fill: "palette.old" });
    canvas.add(shape);
    const background: Background = {
      color: { ref: "palette.old" },
    };
    const palette = {
      old: { name: "Old", value: { kind: "solid", color: "#000" } as const },
      new: { name: "New", value: { kind: "solid", color: "#fff" } as const },
    };

    const result = reassignPaletteToken(
      canvas,
      background,
      palette,
      "old",
      "new",
    );

    expect(shape.get(YUNARI_PAINT_PROPERTY)).toEqual({ fill: "palette.new" });
    expect(result.background?.color).toEqual({ ref: "palette.new" });
    expect(result.palette).toEqual({ new: palette.new });
    expect(result.from).toBe("palette.old");
    expect(result.to).toBe("palette.new");
  });

  it("rewrites a panel's fill, stroke and shadow reference together", () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const panel = new Rect({ id: "panel" });
    panel.set("stroke", "#9fc7e52b");
    panel.set("shadow", new Shadow({ color: "#9fc7e52b", blur: 12 }));
    panel.set(YUNARI_PAINT_PROPERTY, {
      fill: "palette.old",
      stroke: "palette.old",
      shadowColor: "palette.old",
    });
    canvas.add(panel);
    const palette = {
      old: { name: "Old", value: { kind: "solid", color: "#000" } as const },
      new: { name: "New", value: { kind: "solid", color: "#fff" } as const },
    };

    reassignPaletteToken(canvas, undefined, palette, "old", "new");

    // A panel carries three authored references, and a deleted token that
    // reached only the fill would leave a border and a shadow pointing at a
    // token the palette no longer has.
    expect(panel.get(YUNARI_PAINT_PROPERTY)).toEqual({
      fill: "palette.new",
      stroke: "palette.new",
      shadowColor: "palette.new",
    });
    // The live shadow survives the rewrite: only its colour is re-resolved,
    // from the palette change that follows.
    expect(panel.get("shadow")).toBeInstanceOf(Shadow);
    expect((panel.get("shadow") as Shadow).blur).toBe(12);
  });

  it("leaves an unrelated background reference untouched", () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const background: Background = {
      color: { ref: "palette.other" },
    };
    const palette = {
      old: { name: "Old", value: { kind: "solid", color: "#000" } as const },
      new: { name: "New", value: { kind: "solid", color: "#fff" } as const },
    };

    const result = reassignPaletteToken(
      canvas,
      background,
      palette,
      "old",
      "new",
    );

    expect(result.background?.color).toEqual({ ref: "palette.other" });
  });

  it("reports the same objects the delete moves, at any depth", () => {
    // The guard and the panel number are one walk. A token reported unused
    // while an object is painted with it is the bug this pairing prevents, so
    // the assertion is that the reported set is emptied by the delete itself.
    const canvas = new Canvas(document.createElement("canvas"));
    const inner = new Rect({ id: "inner" });
    inner.set(YUNARI_PAINT_PROPERTY, { fill: "palette.old" });
    const group = new Group([inner]);
    canvas.add(group);
    const palette = {
      old: { name: "Old", value: { kind: "solid", color: "#000" } as const },
      spare: {
        name: "Spare",
        value: { kind: "solid", color: "#fff" } as const,
      },
    };

    expect(
      paletteTokenUsage(canvas, palette)["old"]?.map((use) => use.objectId),
    ).toEqual(["inner"]);

    reassignPaletteToken(canvas, undefined, palette, "old", "spare");

    expect(paletteTokenUsage(canvas, palette)["old"]).toEqual([]);
  });

  it("reports nothing for a token no object uses", () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const palette = {
      old: { name: "Old", value: { kind: "solid", color: "#000" } as const },
    };

    expect(paletteTokenUsage(canvas, palette)["old"]).toEqual([]);
  });
});
