import { describe, expect, it } from "vitest";
import { uiCopy } from "../ui-copy.js";
import { productShortcutIds } from "./index.js";
import { shortcutReferenceGroups } from "./reference.js";

describe("shortcutReferenceGroups", () => {
  it("lists every action the table binds, once, across the groups", () => {
    const rows = shortcutReferenceGroups().flatMap((group) => group.rows);
    // Derived, never a literal: the sheet is a projection of
    // `PRODUCT_SHORTCUTS`, and a binding added to the table must arrive here.
    // **No literal count stands beside this one.** Task 1.1's test already pins
    // the table's own size; a second pin here would need editing in the same
    // commit that mints `help.shortcuts`, and the claim under test is the
    // projection, not the size of its input.
    expect(rows).toHaveLength(productShortcutIds().length);
  });

  it("gives every row a word to read and a chord to press", () => {
    for (const group of shortcutReferenceGroups()) {
      expect(group.label).not.toBe("");
      for (const row of group.rows) {
        expect(row.label).not.toBe("");
        expect(row.chord).not.toBe("");
      }
    }
  });

  it("words a row with the product's own name for the action", () => {
    // The two assertions above cannot see a label, because an action id is a
    // non-empty string too — a lookup that returned `action` instead of its
    // word would pass both. This is the one that pins the word.
    const labels = shortcutReferenceGroups()
      .flatMap((group) => group.rows)
      .map((row) => row.label);
    expect(labels).toContain(uiCopy.actions.undo);
    expect(labels).toContain(uiCopy.file.newDocument);
  });

  it("heads the groups by the prefix of the id, in the table's order", () => {
    // Five groups, because Task 3.3 minted `help.shortcuts` and plan 5's Task 3
    // minted `publish.surface`: a group appears when an action lands in it, so
    // the sheet never draws an empty heading over nothing.
    expect(shortcutReferenceGroups().map((group) => group.label)).toEqual([
      "File",
      "Edit",
      "Canvas",
      "Publish",
      "Help",
    ]);
  });

  it("carries the action's own id on every row", () => {
    // The Keyboard tab edits a binding, so a row that carried only its words
    // would force that reader to match on a label.
    const rows = shortcutReferenceGroups().flatMap((group) => group.rows);
    expect(new Set(rows.map((row) => row.action))).toEqual(
      new Set(productShortcutIds()),
    );
  });
});
