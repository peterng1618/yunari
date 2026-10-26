import type { FabricGlobals } from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import { orderedTokens, tokenIdOfFace, tokenName } from "./name.js";

describe("tokenName", () => {
  it("prefixes a role id with its role word, capitalised", () => {
    expect(tokenName("heading", { family: "Segoe UI", weight: 600 })).toBe(
      "[Heading] Segoe UI 600",
    );
    expect(tokenName("body", { family: "Inter", weight: "400" })).toBe(
      "[Body] Inter 400",
    );
    expect(tokenName("mono", { family: "Fira Code", weight: 400 })).toBe(
      "[Mono] Fira Code 400",
    );
  });

  it("computes an unroled token's name from its face alone", () => {
    expect(tokenName("caption", { family: "Manrope", weight: 600 })).toBe(
      "Manrope 600",
    );
  });

  it("omits the weight when the token carries none", () => {
    expect(tokenName("body", { family: "Inter" })).toBe("[Body] Inter");
    expect(tokenName("caption", { family: "Manrope", weight: "" })).toBe(
      "Manrope",
    );
  });

  it("prints a string weight and a numeric weight alike", () => {
    expect(tokenName("caption", { family: "Manrope", weight: "600" })).toBe(
      tokenName("caption", { family: "Manrope", weight: 600 }),
    );
  });
});

describe("orderedTokens", () => {
  it("puts the three roles first in heading/body/mono order, then names", () => {
    const globals = {
      typeTokens: {
        zebra: { family: "Zebra Sans", weight: 400 },
        mono: { family: "Fira Code", weight: 400 },
        alpha: { family: "Alpha", weight: 400 },
        body: { family: "Inter", weight: 400 },
        heading: { family: "Manrope", weight: 700 },
      },
    } as unknown as FabricGlobals;

    expect(orderedTokens(globals).map((entry) => entry.id)).toEqual([
      "heading",
      "body",
      "mono",
      "alpha",
      "zebra",
    ]);
  });

  it("orders an unroled token by its computed name, not its id", () => {
    const globals = {
      typeTokens: {
        a: { family: "Zebra", weight: 400 },
        z: { family: "Alpha", weight: 400 },
      },
    } as unknown as FabricGlobals;

    expect(orderedTokens(globals).map((entry) => entry.id)).toEqual(["z", "a"]);
  });

  it("reads a missing globals bag as no tokens", () => {
    expect(orderedTokens(undefined)).toEqual([]);
  });
});

describe("tokenIdOfFace", () => {
  it("matches a stored string weight against a numeric one", () => {
    expect(
      tokenIdOfFace({ body: { family: "Inter", weight: "400" } }, "Inter", 400),
    ).toBe("body");
    expect(
      tokenIdOfFace({ body: { family: "Inter", weight: 400 } }, "Inter", "400"),
    ).toBe("body");
  });

  it("normalises whitespace on both the stored and the offered weight", () => {
    expect(
      tokenIdOfFace(
        { body: { family: " Inter ", weight: " 400 " } },
        "Inter",
        400,
      ),
    ).toBe("body");
  });

  it("answers undefined when no token carries the face", () => {
    expect(
      tokenIdOfFace({ body: { family: "Inter", weight: 400 } }, "Segoe UI", 600),
    ).toBeUndefined();
  });
});
