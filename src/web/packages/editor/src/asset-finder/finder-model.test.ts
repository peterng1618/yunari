import { describe, expect, it } from "vitest";
import { uiCopy } from "../ui-copy.js";
import { CATEGORY_ORDER } from "./finder-model.js";

describe("the asset finder's tab order", () => {
  it("is alphabetical by the word each tab shows", () => {
    const labels = CATEGORY_ORDER.map(
      (category) => uiCopy.assets.category[category],
    );
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });
});
