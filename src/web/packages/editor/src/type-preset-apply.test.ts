import type { FontCut, FontTrioInfo } from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import { applyFontTrio, fontAssetId } from "./type-preset-apply.js";
import type { TypeTokens } from "./type-preset-manager/index.js";

function cut(
  role: "heading" | "body" | "mono",
  family: string,
  weight: number,
): FontCut {
  const url = `https://example.test/${role}.woff2`;
  return {
    id: `${role}-${weight}`,
    source: "curated-fonts",
    family,
    weight,
    style: "normal",
    subset: "latin",
    format: "woff2",
    previewUrl: url,
    licence: "SIL Open Font License 1.1",
    sourceUrl: url,
  };
}

const trio: FontTrioInfo = {
  id: "fixture",
  name: "Fixture",
  description: "",
  roles: {
    heading: cut("heading", "Manrope", 700),
    body: cut("body", "Inter", 400),
    mono: cut("mono", "Fira Code", 400),
  },
};

const headingId = fontAssetId(trio.roles.heading!);
const bodyId = fontAssetId(trio.roles.body!);
const monoId = fontAssetId(trio.roles.mono!);

describe("applyFontTrio", () => {
  it("rewrites every role token and creates the missing roles", () => {
    const presets: TypeTokens = {
      heading: { family: "Segoe UI", weight: "500" },
      // Not a role id, so the role rule does not touch it.
      metric: { family: "Segoe UI", weight: "300" },
      body: { family: "Segoe UI" },
      custom: { family: "Georgia" },
    };

    expect(applyFontTrio(presets, trio)).toEqual({
      heading: {
        family: "Manrope",
        weight: 700,
        face: { assetId: headingId },
      },
      metric: { family: "Segoe UI", weight: "300" },
      body: {
        family: "Inter",
        weight: 400,
        face: { assetId: bodyId },
      },
      custom: { family: "Georgia" },
      mono: {
        family: "Fira Code",
        weight: 400,
        face: { assetId: monoId },
      },
    });
  });

  it("leaves tokens with no role untouched", () => {
    const custom = { family: "Georgia" };
    const result = applyFontTrio(
      {
        heading: { family: "Segoe UI", weight: "500" },
        body: { family: "Segoe UI" },
        mono: { family: "Segoe UI", weight: "700" },
        only: custom,
      },
      trio,
    );
    expect(result.only).toEqual(custom);
  });

  it("creates each missing role without overwriting a taken id", () => {
    const authored = { family: "Georgia" };
    const result = applyFontTrio({ other: authored }, trio);

    expect(result.other).toEqual(authored);
    expect(result.heading).toEqual({
      family: "Manrope",
      weight: 700,
      face: { assetId: headingId },
    });
    expect(result.body).toEqual({
      family: "Inter",
      weight: 400,
      face: { assetId: bodyId },
    });
    expect(result.mono).toEqual({
      family: "Fira Code",
      weight: 400,
      face: { assetId: monoId },
    });
  });

  it("keeps a token keyed __proto__", () => {
    // A literal `{ "__proto__": … }` sets the prototype, so the fixture has to
    // be parsed: JSON.parse defines `__proto__` as an own key, which is the
    // shape a schema-valid theme file can carry.
    const presets = JSON.parse(
      '{"__proto__":{"family":"Georgia","weight":"400"}}',
    ) as TypeTokens;
    const result = applyFontTrio(presets, trio);

    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(result["__proto__"]).toEqual({ family: "Georgia", weight: "400" });
  });
});

describe("fontAssetId", () => {
  it("keeps cuts apart that differ only in a separator", () => {
    // Sanitising both to `-` would mint one id, and `adoptFont` splices by id:
    // the second cut's bytes would silently replace the first's.
    const slash = { ...trio.roles.body!, id: "cut:a/b" };
    const at = { ...trio.roles.body!, id: "cut:a@b" };

    expect(fontAssetId(slash)).not.toBe(fontAssetId(at));
    expect(fontAssetId(slash)).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });
});

describe("cut weight", () => {
  it("normalises a provider's string weight to the number the asset carries", () => {
    const body = { ...trio.roles.body!, weight: "400" };
    const result = applyFontTrio(
      {
        body: { family: "Segoe UI" },
      },
      { ...trio, roles: { body } },
    );

    expect(result.body?.weight).toBe(400);
    expect(typeof result.body?.weight).toBe("number");
  });
});
