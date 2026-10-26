// @vitest-environment jsdom
import type { TextRun } from "@yunari/renderer-core";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { accessibleName } from "../accessible-name.js";
import { uiCopy } from "../ui-copy.js";
import {
  blur,
  click,
  clickHook,
  mountRunEditor,
  press,
  typeInto,
} from "./runs.test-stage.js";
import { RUN_GLOBALS } from "./runs-fixture.js";

/**
 * The run-editor cases that need the editor's *own* state, rather than what a
 * control writes.
 *
 * The caret cases are about one mechanism: React's row identity keeps a draft
 * and the caret alive across a commit and a re-publish, and discards the draft
 * when the described object changes. The second block is the run tab strip,
 * whose selection is the editor's own state too — never authored, so it writes
 * nothing and records no history.
 */

const twoRuns: readonly TextRun[] = [
  { kind: "literal", text: "CPU ", typeToken: "typeTokens.plain" },
  { kind: "literal", text: "%", typeToken: "typeTokens.plain" },
];

describe("the run editor's own state", () => {
  it("keeps the caret in the field being typed into across a re-publish", async () => {
    const box = mountRunEditor({ runs: twoRuns, globals: RUN_GLOBALS });
    const field = box.pick<HTMLInputElement>('[data-yunari-run-text="0"]');
    field.focus();
    expect(document.activeElement).toBe(field);

    await typeInto(field, "GPU ");
    await act(async () => {
      // The re-publish an unrelated edit or a selection re-read causes.
      box.render();
    });

    // The row is the same element, so the caret was never lost and the
    // half-typed draft was not replaced by the published value.
    const after = box.pick<HTMLInputElement>('[data-yunari-run-text="0"]');
    expect(after).toBe(field);
    expect(document.activeElement).toBe(after);
    expect(after.value).toBe("GPU ");

    await blur(after);
    expect(box.runs()[0]).toMatchObject({ kind: "literal", text: "GPU " });
    return box.dispose();
  });

  it("keeps the caret when Enter commits a literal's text", async () => {
    const box = mountRunEditor({ runs: twoRuns, globals: RUN_GLOBALS });
    const field = box.pick<HTMLInputElement>('[data-yunari-run-text="0"]');
    field.focus();

    await typeInto(field, "GPU ");
    // Enter, not blur: it is the primary commit gesture, and it commits while
    // the field still holds focus. A row key carrying the run's text would
    // remount the input here and drop focus to the document body — the caret
    // rule in `index.ts` cannot recover it, because the row's identity is the
    // very thing that changed.
    await press(field, "Enter");

    expect(box.runs()[0]).toMatchObject({ kind: "literal", text: "GPU " });
    expect(document.activeElement).toBe(field);
    expect(field.isConnected).toBe(true);
    expect(field.value).toBe("GPU ");
    return box.dispose();
  });

  it("adds and removes runs without disturbing the run that stays", async () => {
    const box = mountRunEditor({ runs: twoRuns, globals: RUN_GLOBALS });
    const field = box.pick<HTMLInputElement>('[data-yunari-run-text="0"]');
    await typeInto(field, "GPU ");
    await blur(field);

    // Adding selects the new run, so its fields — not the first run's — are the
    // ones on screen. The first run's committed text survives the re-publish.
    await clickHook(box.host, "data-yunari-run-add");
    expect(box.runs()).toHaveLength(3);
    expect(box.host.querySelector('[data-yunari-run-text="2"]')).not.toBeNull();
    expect(box.host.querySelector('[data-yunari-run-text="0"]')).toBeNull();

    // Removing the selected last run falls back to the first remaining one,
    // still holding the text committed before the add.
    await clickHook(box.host, 'data-yunari-run-remove="2"');
    expect(box.runs()).toHaveLength(2);
    expect(box.pick<HTMLInputElement>('[data-yunari-run-text="0"]').value).toBe(
      "GPU ",
    );
    expect(box.runs()[0]).toMatchObject({ kind: "literal", text: "GPU " });
    expect(box.runs()[1]).toMatchObject({ kind: "literal", text: "%" });
    return box.dispose();
  });

  it("removes the selected run and leaves the survivors on their own rows", async () => {
    // Removing is only reachable from the selected panel now, so the old
    // "remove a run before the draft" case is gone. What must still hold is
    // that the survivors keep their own content and identity when the middle
    // run of three leaves.
    const box = mountRunEditor({
      runs: [
        { kind: "literal", text: "A", typeToken: "typeTokens.plain" },
        { kind: "literal", text: "B", typeToken: "typeTokens.caption" },
        { kind: "literal", text: "C", typeToken: "typeTokens.title" },
      ],
      globals: RUN_GLOBALS,
    });
    await click(box.pick<HTMLElement>('[data-yunari-run-tab="2"]'));
    await clickHook(box.host, 'data-yunari-run-remove="1"');

    expect(box.runs()).toHaveLength(2);
    // The first remaining run is selected, and the run that moved up into
    // second place carries its own text rather than the removed run's.
    expect(box.pick<HTMLInputElement>('[data-yunari-run-text="0"]').value).toBe(
      "A",
    );
    await click(box.pick<HTMLElement>('[data-yunari-run-tab="2"]'));
    expect(box.pick<HTMLInputElement>('[data-yunari-run-text="1"]').value).toBe(
      "C",
    );
    return box.dispose();
  });

  it("removes the selected twin without taking the survivor's text", async () => {
    // Two literals sharing a preset are the same spelling, so a key derived from
    // the run's fields cannot tell them apart. The survivor is the run it was,
    // not the row that moved up under it (vg-249).
    const box = mountRunEditor({
      runs: [
        { kind: "literal", text: "A", typeToken: "typeTokens.plain" },
        { kind: "literal", text: "B", typeToken: "typeTokens.plain" },
      ],
      globals: RUN_GLOBALS,
    });
    const field = box.pick<HTMLInputElement>('[data-yunari-run-text="0"]');
    await typeInto(field, "GPU ");
    await blur(field);

    await click(box.pick<HTMLElement>('[data-yunari-run-tab="2"]'));
    await clickHook(box.host, 'data-yunari-run-remove="1"');

    expect(box.runs()).toHaveLength(1);
    expect(box.pick<HTMLInputElement>('[data-yunari-run-text="0"]').value).toBe(
      "GPU ",
    );
    expect(box.runs()[0]).toMatchObject({ kind: "literal", text: "GPU " });
    return box.dispose();
  });
});

describe("showing one run at a time behind numbered tabs", () => {
  const threeRuns: readonly TextRun[] = [
    { kind: "literal", text: "A", typeToken: "typeTokens.plain" },
    { kind: "literal", text: "B", typeToken: "typeTokens.caption" },
    { kind: "literal", text: "C", typeToken: "typeTokens.title" },
  ];

  const tab = (box: ReturnType<typeof mountRunEditor>, position: number) =>
    box.pick<HTMLElement>(`[data-yunari-run-tab="${position}"]`);

  it("numbers every run's tab and shows only the selected run's fields", () => {
    const box = mountRunEditor({ runs: twoRuns, globals: RUN_GLOBALS });

    const tabs = [
      ...box.host.querySelectorAll<HTMLElement>("[data-yunari-run-tab]"),
    ];
    expect(
      tabs.map((element) => element.getAttribute("data-yunari-run-tab")),
    ).toEqual(["1", "2"]);
    // The visible label is the bare number; the name a reader hears is the one
    // `uiCopy` owns, because "1" alone names no question.
    expect(tabs.map((element) => element.textContent)).toEqual(["1", "2"]);
    expect(tabs.map((element) => accessibleName(element))).toEqual([
      uiCopy.inspectorFields.runTab(1),
      uiCopy.inspectorFields.runTab(2),
    ]);

    expect(box.host.querySelectorAll("[data-yunari-run]")).toHaveLength(1);
    expect(box.host.querySelector('[data-yunari-run-text="0"]')).not.toBeNull();
    expect(box.host.querySelector('[data-yunari-run-text="1"]')).toBeNull();
    return box.dispose();
  });

  it("shows run 2's fields and hides run 1's when its tab is picked", async () => {
    const box = mountRunEditor({ runs: twoRuns, globals: RUN_GLOBALS });

    await click(tab(box, 2));

    expect(tab(box, 2).getAttribute("aria-selected")).toBe("true");
    expect(tab(box, 1).getAttribute("aria-selected")).toBe("false");
    expect(box.host.querySelector('[data-yunari-run-text="0"]')).toBeNull();
    expect(box.pick<HTMLInputElement>('[data-yunari-run-text="1"]').value).toBe(
      "%",
    );
    return box.dispose();
  });

  it("adds a run with the plus and selects the new last run", async () => {
    const box = mountRunEditor({ runs: twoRuns, globals: RUN_GLOBALS });

    await click(box.pick<HTMLElement>("[data-yunari-run-add]"));

    expect(box.runs()).toHaveLength(3);
    expect(
      box
        .pick<HTMLElement>('[data-yunari-run-tab="3"]')
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(box.host.querySelector('[data-yunari-run-text="0"]')).toBeNull();
    expect(box.host.querySelector('[data-yunari-run-text="1"]')).toBeNull();
    expect(box.pick<HTMLInputElement>('[data-yunari-run-text="2"]').value).toBe(
      "",
    );
    return box.dispose();
  });

  it("selects the first remaining run when the selected one is removed", async () => {
    const box = mountRunEditor({ runs: threeRuns, globals: RUN_GLOBALS });
    await click(tab(box, 2));

    await clickHook(box.host, 'data-yunari-run-remove="1"');

    expect(box.runs()).toHaveLength(2);
    expect(box.host.querySelectorAll("[data-yunari-run-tab]")).toHaveLength(2);
    expect(tab(box, 1).getAttribute("aria-selected")).toBe("true");
    expect(box.pick<HTMLInputElement>('[data-yunari-run-text="0"]').value).toBe(
      "A",
    );
    return box.dispose();
  });

  it("selects the first run when the added last run is removed", async () => {
    // `+` leaves the previously selected id behind while it follows the new
    // last run. Removing that run must still land on the FIRST remaining run,
    // not silently restore the tab that was selected before the add.
    const box = mountRunEditor({ runs: threeRuns, globals: RUN_GLOBALS });
    await click(tab(box, 2));
    await click(box.pick<HTMLElement>("[data-yunari-run-add]"));

    await clickHook(box.host, 'data-yunari-run-remove="3"');

    expect(box.runs()).toHaveLength(3);
    expect(tab(box, 1).getAttribute("aria-selected")).toBe("true");
    expect(box.pick<HTMLInputElement>('[data-yunari-run-text="0"]').value).toBe(
      "A",
    );
    return box.dispose();
  });

  it("moves between tabs with the arrow keys", async () => {
    const box = mountRunEditor({ runs: threeRuns, globals: RUN_GLOBALS });
    const first = tab(box, 1);
    await act(async () => {
      first.focus();
    });

    await press(first, "ArrowRight");

    expect(
      box
        .pick<HTMLElement>('[data-yunari-run-tab="2"]')
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(box.pick<HTMLInputElement>('[data-yunari-run-text="1"]').value).toBe(
      "B",
    );
    return box.dispose();
  });

  it("names the plus button for what it adds, not for its glyph", () => {
    const box = mountRunEditor({ runs: twoRuns, globals: RUN_GLOBALS });

    expect(accessibleName(box.pick<HTMLElement>("[data-yunari-run-add]"))).toBe(
      uiCopy.inspectorFields.addRun,
    );
    // A tablist owns tabs. The add button is an action after the strip, so a
    // reader does not hear it announced as a tab nor arrow past it as one.
    expect(
      box
        .pick<HTMLElement>("[data-yunari-run-add]")
        .closest('[role="tablist"]'),
    ).toBeNull();
    return box.dispose();
  });
});
