import { describe, expect, it } from "vitest";
import {
  allowsStyleProperty,
  anyHasCapability,
  hasCapability,
  isDerivedCapability,
  isKnownStyleProperty,
  NODE_CAPABILITIES,
  STYLE_PROPERTIES,
  stylePropertiesFor,
  transformPropertiesFor,
} from "./capabilities.js";
import { NODE_TYPES } from "./document.js";

describe("the capability matrix", () => {
  it("has a row for every declared node type", () => {
    for (const type of NODE_TYPES) {
      expect(NODE_CAPABILITIES[type]).toBeDefined();
    }

    expect(Object.keys(NODE_CAPABILITIES).sort()).toEqual(
      [...NODE_TYPES].sort(),
    );
  });

  it("gives every type identity and flags", () => {
    // Name, visibility and lock apply to anything that can be selected —
    // including a group, which is why it still appears in the inspector at all.
    for (const type of NODE_TYPES) {
      expect(hasCapability(type, "identity")).toBe(true);
      expect(hasCapability(type, "flags")).toBe(true);
    }
  });

  it("lists no property group twice for one type", () => {
    for (const type of NODE_TYPES) {
      const groups = NODE_CAPABILITIES[type];

      expect(new Set(groups).size).toBe(groups.length);
    }
  });
});

describe("a group is an editor entity, not a drawable", () => {
  it("presents no geometry at all", () => {
    // Its transform IS its children's values, so a row would restate something
    // the group does not own. Moving and rotating a group is still done — on
    // the canvas, where the gesture translates into child values. D0 is
    // satisfied by the operation existing, not by a row repeating it.
    for (const group of ["position", "size", "rotation"] as const) {
      expect(hasCapability("group", group)).toBe(false);
    }

    expect(transformPropertiesFor("group")).toEqual([]);
  });

  it("has no derived capabilities either, now that the transform rows are gone", () => {
    for (const type of NODE_TYPES) {
      for (const group of ["position", "size", "rotation"] as const) {
        expect(isDerivedCapability(type, group)).toBe(false);
      }
    }
  });

  it("leaves every drawable a full stored transform", () => {
    for (const type of [
      "rectangle",
      "ellipse",
      "line",
      "text",
      "image",
      "video",
      "chart",
    ] as const) {
      expect(transformPropertiesFor(type)).toEqual([
        "x",
        "y",
        "width",
        "height",
        "rotation",
      ]);
    }
  });

  it("has no paint of any kind", () => {
    for (const group of [
      "fill",
      "stroke",
      "shadow",
      "opacity",
      "typography",
    ] as const) {
      expect(hasCapability("group", group)).toBe(false);
    }
  });

  it("has no bindings — it displays nothing itself", () => {
    expect(hasCapability("group", "bindings")).toBe(false);
  });

  it("carries no style properties at all", () => {
    expect(stylePropertiesFor("group")).toEqual([]);
  });
});

describe("per-type capabilities", () => {
  it("gives text a typography group but no fill", () => {
    // The renderer maps `fill` to `color` in text mode and then overwrites it,
    // so offering both showed two rows for one property.
    expect(hasCapability("text", "typography")).toBe(true);
    expect(hasCapability("text", "fill")).toBe(false);
    expect(allowsStyleProperty("text", "fill")).toBe(false);
    expect(allowsStyleProperty("text", "color")).toBe(true);
  });

  it("gives a rectangle a fill but no typography", () => {
    expect(allowsStyleProperty("rectangle", "fill")).toBe(true);
    expect(allowsStyleProperty("rectangle", "fontSize")).toBe(false);
  });

  it("gives corner radius to a rectangle and not an ellipse", () => {
    expect(hasCapability("rectangle", "cornerRadius")).toBe(true);
    expect(hasCapability("ellipse", "cornerRadius")).toBe(false);
  });

  it("gives an image no fill or stroke", () => {
    // Tinting a bitmap is not something this format does (§170).
    expect(hasCapability("image", "fill")).toBe(false);
    expect(hasCapability("image", "stroke")).toBe(false);
  });

  it("gives a chart its family settings and no element paint", () => {
    // Otherwise a chart has two colour systems.
    expect(hasCapability("chart", "chartSettings")).toBe(true);
    expect(hasCapability("chart", "fill")).toBe(false);
    expect(hasCapability("chart", "typography")).toBe(false);
  });

  it("gives every drawable an element-level opacity", () => {
    // The deliberate exception to "colour is theme-level": opacity is a
    // property of this instance, not a shared token.
    for (const type of [
      "rectangle",
      "ellipse",
      "text",
      "image",
      "chart",
    ] as const) {
      expect(hasCapability(type, "opacity")).toBe(true);
    }
  });
});

describe("anyHasCapability", () => {
  it("is true when one member of a mixed selection supports it", () => {
    // A row shows when at least one member can use it; hiding everything not
    // universally supported makes a mixed selection look propertyless.
    expect(anyHasCapability(["group", "rectangle"], "fill")).toBe(true);
  });

  it("is false when none do", () => {
    expect(anyHasCapability(["group", "image"], "typography")).toBe(false);
  });

  it("is false for an empty selection", () => {
    expect(anyHasCapability([], "fill")).toBe(false);
  });
});

describe("the style property vocabulary", () => {
  it("recognises the properties the renderer reads", () => {
    for (const property of [
      "fill",
      "color",
      "opacity",
      "strokeColor",
      "strokeWidth",
      "strokeDash",
      "shadowColor",
      "shadowBlur",
      "shadowOffsetX",
      "shadowOffsetY",
      "fontFamily",
      "fontSize",
      "fontWeight",
      "letterSpacing",
      "lineHeight",
      "tabularNumerals",
    ]) {
      expect(isKnownStyleProperty(property)).toBe(true);
    }
  });

  it("rejects the typo that used to pass schema AND validation silently", () => {
    expect(isKnownStyleProperty("strokewidth")).toBe(false);
    expect(isKnownStyleProperty("fontFmaily")).toBe(false);
    expect(isKnownStyleProperty("background")).toBe(false);
  });

  it("declares each property exactly once across the groups", () => {
    expect(new Set(STYLE_PROPERTIES).size).toBe(STYLE_PROPERTIES.length);
  });
});
