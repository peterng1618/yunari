import type { FontCut, FontTrioInfo } from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import { applyFontTrio, fontAssetId } from "./type-preset-apply.js";
import type { TypePresets } from "./type-preset-manager/index.js";

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
  it("rewrites every role preset and creates the missing roles", () => {
    const presets = {
      heading: {
        name: "Heading",
        value: {
          family: "Segoe UI",
          size: 32,
          weight: "500",
          lineHeight: 1.2,
          trioRole: "heading" as const,
        },
      },
      // A second heading preset, distinguished by its tracking: two presets
      // sharing a role is what proves every authored value survives the spread.
      metric: {
        name: "Metric",
        value: {
          family: "Segoe UI",
          size: 70,
          weight: "300",
          letterSpacing: 2,
          trioRole: "heading" as const,
        },
      },
      body: {
        name: "Body",
        value: { family: "Segoe UI", size: 14, trioRole: "body" as const },
      },
      custom: { name: "Custom", value: { family: "Georgia", size: 19 } },
    };

    expect(applyFontTrio(presets, trio)).toEqual({
      heading: {
        name: "Heading",
        value: {
          family: "Manrope",
          size: 32,
          weight: 700,
          lineHeight: 1.2,
          trioRole: "heading",
          face: { assetId: headingId },
        },
      },
      metric: {
        name: "Metric",
        value: {
          family: "Manrope",
          size: 70,
          weight: 700,
          letterSpacing: 2,
          trioRole: "heading",
          face: { assetId: headingId },
        },
      },
      body: {
        name: "Body",
        value: {
          family: "Inter",
          size: 14,
          weight: 400,
          trioRole: "body",
          face: { assetId: bodyId },
        },
      },
      custom: { name: "Custom", value: { family: "Georgia", size: 19 } },
      mono: {
        name: "Mono — Fira Code",
        value: {
          family: "Fira Code",
          size: 14,
          weight: 400,
          face: { assetId: monoId },
          trioRole: "mono",
        },
      },
    });
  });

  it("leaves presets with no role untouched", () => {
    const custom = { name: "Only", value: { family: "Georgia", size: 19 } };
    const result = applyFontTrio(
      {
        heading: {
          name: "Heading",
          value: { family: "Segoe UI", size: 32, trioRole: "heading" },
        },
        body: {
          name: "Body",
          value: { family: "Segoe UI", size: 14, trioRole: "body" },
        },
        mono: {
          name: "Code",
          value: { family: "Segoe UI", size: 12, trioRole: "mono" },
        },
        only: custom,
      },
      trio,
    );
    expect(result.only).toEqual(custom);
  });

  it("creates each missing role at its own size without overwriting a taken id", () => {
    const authored = {
      name: "Authored mono",
      value: { family: "Georgia", size: 19 },
    };
    const result = applyFontTrio({ mono: authored }, trio);

    expect(result.mono).toEqual(authored);
    expect(result.heading?.value.size).toBe(46);
    expect(result.body?.value.size).toBe(24);
    expect(result["mono-2"]).toEqual({
      name: "Mono — Fira Code",
      value: {
        family: "Fira Code",
        size: 14,
        weight: 400,
        face: { assetId: monoId },
        trioRole: "mono",
      },
    });
  });

  it("keeps a preset keyed __proto__", () => {
    // A literal `{ "__proto__": … }` sets the prototype, so the fixture has to
    // be parsed: JSON.parse defines `__proto__` as an own key, which is the
    // shape a schema-valid theme file can carry.
    const presets = JSON.parse(
      '{"__proto__":{"name":"Proto","value":{"family":"Georgia","size":19,"trioRole":"heading"}}}',
    ) as TypePresets;
    const result = applyFontTrio(presets, trio);

    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(result["__proto__"]).toEqual({
      name: "Proto",
      value: {
        family: "Manrope",
        size: 19,
        weight: 700,
        face: { assetId: headingId },
        trioRole: "heading",
      },
    });
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
        body: {
          name: "Body",
          value: { family: "Segoe UI", size: 14, trioRole: "body" },
        },
      },
      { ...trio, roles: { body } },
    );

    expect(result.body?.value.weight).toBe(400);
    expect(typeof result.body?.value.weight).toBe("number");
  });
});
