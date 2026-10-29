import { describe, expect, it } from "vitest";
import {
  defersToTextEntry,
  PRODUCT_SHORTCUTS,
  productShortcutIds,
} from "./index.js";

describe("productShortcutIds", () => {
  it("names each action once, in the table's own order", () => {
    const ids = productShortcutIds();
    // Derived from the table, so a binding added to one and not the other fails
    // here rather than silently shortening the sheet.
    expect(new Set(ids)).toEqual(
      new Set(PRODUCT_SHORTCUTS.map((binding) => binding.action)),
    );
    // Four actions are bound twice — `edit.redo` to Ctrl+Shift+Z and Ctrl+Y,
    // `edit.delete` to Delete and Backspace, and front/back to a bare and a
    // shifted bracket each — so a list that repeated them would make the sheet
    // say "Redo" twice. 21 distinct actions come out of the table's 25 bindings:
    // Task 3.3's `help.shortcuts` made it 19, plan 5's Task 3 added
    // `publish.surface`, and the asset finder's `file.findAssets` made it 21.
    expect(ids).toHaveLength(21);
    expect(new Set(ids).size).toBe(ids.length);
    // First and last, so the order is the table's own and not sorted by accident.
    // Task 3.3 appends `help.shortcuts`, which raised this to 19 and moved the
    // last; plan 5's Task 3 inserts `publish.surface` ahead of it, so the last is
    // unchanged and the publish chord lands in the table's own place.
    expect(ids[0]).toBe("file.new");
    expect(ids.at(-1)).toBe("help.shortcuts");
  });

  it("keeps the context-only bindings out of the list the shell layout renders", () => {
    // `Escape` is dispatched by the same manager but the file's own comment
    // (`index.ts:67-68`) says it is never displayed by a menu or tooltip.
    expect(productShortcutIds()).not.toContain("view.exit-group");
  });

  it("binds the finder to Ctrl+Shift+F, deferring to a focused field", () => {
    // Not Ctrl+Shift+A: Chromium keeps it for tab search, so a page never sees
    // the press.
    expect(PRODUCT_SHORTCUTS).toContainEqual({
      key: "f",
      modifier: true,
      shift: true,
      action: "file.findAssets",
    });
    // Ctrl+Shift+F opens the finder only where the author is not typing.
    expect(defersToTextEntry("file.findAssets")).toBe(true);
  });
});
