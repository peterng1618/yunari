// @vitest-environment jsdom
import { YUNARI_TEXT_PROPERTY } from "@yunari/scene-fabric";
import { Canvas, IText } from "fabric/es";
import { describe, expect, it } from "vitest";
import { reassignTypeToken } from "./index.js";

describe("reassignTypeToken", () => {
  it("rewrites canvas type-preset refs and drops the preset entry", () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const text = new IText("Hi");
    text.set(YUNARI_TEXT_PROPERTY, {
      runs: [{ kind: "literal", text: "Hi", typeToken: "typeTokens.old" }],
    });
    canvas.add(text);
    const typeTokens = {
      old: { family: "Inter", size: 16 },
      new: { family: "Inter", size: 20 },
    };

    const next = reassignTypeToken(canvas, typeTokens, "old", "new");

    expect(text.get(YUNARI_TEXT_PROPERTY)).toMatchObject({
      runs: [{ typeToken: "typeTokens.new" }],
    });
    expect(next).toEqual({ new: typeTokens.new });
  });
});
