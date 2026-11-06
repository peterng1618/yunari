import {
  BUILTIN_LISTING_CATEGORIES,
  type DeclarativeCategory,
} from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import { uiCopy } from "../ui-copy.js";
import {
  bodyOf,
  CATEGORY_ORDER,
  categoryLabel,
  categoryTabs,
} from "./finder-model.js";

function declared(id: string): DeclarativeCategory {
  return { id, label: id, icon: "Shapes", resultKind: id, body: "grid" };
}

describe("the asset finder's tab order", () => {
  it("is alphabetical by the word each tab shows", () => {
    const labels = CATEGORY_ORDER.map((category) => categoryLabel(category));
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });

  it("keeps built-in order and appends an unknown category", () => {
    expect(
      categoryTabs(
        [
          {
            id: "brand",
            label: "Brand",
            icon: "Shapes",
            resultKind: "logo",
            body: "grid",
          },
        ],
        [],
      ),
    ).toEqual([...BUILTIN_LISTING_CATEGORIES, "brand"]);
  });

  it("sorts declared ids that are not built-in", () => {
    expect(
      categoryTabs(
        [declared("logo"), declared("brand")],
        [{ category: "stock" }],
      ),
    ).toEqual([...BUILTIN_LISTING_CATEGORIES, "brand", "logo", "stock"]);
  });

  it("does not repeat a built-in category a listing names", () => {
    expect(categoryTabs([declared("font")], [{ category: "font" }])).toEqual([
      ...BUILTIN_LISTING_CATEGORIES,
    ]);
  });
});

describe("the asset finder's bodies", () => {
  it("falls back to the generic grid for an unknown category", () => {
    expect(bodyOf("brand")).toBe("grid");
  });

  it("keeps the font picker for the font category", () => {
    expect(bodyOf("font")).toBe("font-picker");
  });
});

describe("the asset finder's labels", () => {
  it("keeps the built-in word for a built-in category", () => {
    expect(categoryLabel("colour")).toBe(uiCopy.assets.category.colour);
  });

  it("falls back to the category id for an unknown category", () => {
    expect(categoryLabel("brand")).toBe("brand");
  });
});
