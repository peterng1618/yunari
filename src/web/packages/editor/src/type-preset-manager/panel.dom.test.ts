// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SelectionStore,
  TokenSelectionStore,
} from "../editor-shell/shell-stores.js";
import {
  newTypeToken,
  starterTypeTokens,
} from "../new-fabric-theme-globals.js";
import { uiCopy } from "../ui-copy.js";
import { createTypeTokenPanel } from "./panel.js";

// The panel appends to the host it is given, and one case reads through
// `document` rather than through the panel's own root, so one test's markup
// would otherwise be the next test's first match.
afterEach(() => document.body.replaceChildren());

const presets = {
  body: { family: "Inter" },
  caption: { family: "Inter" },
};

describe("type token panel", () => {
  it("builds its own section, whose heading names the panel", () => {
    const panel = createTypeTokenPanel(document.body, vi.fn());
    panel.render(presets);

    // `panel-labels.spec.ts` reads every `section h2` and matches the panel's
    // name against its text, so the heading is a plain `<h2>` carrying exactly
    // the table's word and no disclosure chrome beside it.
    expect(panel.root.tagName).toBe("SECTION");
    expect(panel.root.querySelector("h2")?.textContent).toBe(
      uiCopy.panels.typeTokens,
    );
  });

  it("renders a row and a usage figure for each preset", () => {
    const panel = createTypeTokenPanel(
      document.body,
      vi.fn(),
      undefined,
      undefined,
      undefined,
      () => ({ body: [{ objectId: "a", name: "Title" }], caption: [] }),
    );
    panel.render(presets);

    expect(
      panel.root.querySelector(
        '[data-yunari-type-preset-row="body"] [data-yunari-type-preset-usage]',
      )?.textContent,
    ).toBe("1");
    expect(
      panel.root.querySelector('[data-yunari-type-preset-row="caption"]'),
    ).not.toBeNull();
    // The list is a list now: the chooser and the field set it browsed belong
    // to the selection inspector's token section.
    expect(panel.root.querySelector("[data-yunari-type-preset]")).toBeNull();
  });

  it("adds a token under the first free id through the panel's own onChange", () => {
    // The panel is the only production builder of the seeded record now, so the
    // add is driven through the panel rather than through a harness that copies
    // it: this asserts what `EditorDocument.setTypes` actually receives.
    const change = vi.fn();
    const panel = createTypeTokenPanel(document.body, change);
    panel.render(presets);

    panel.root
      .querySelector<HTMLButtonElement>("[data-yunari-type-preset-add]")
      ?.click();

    expect(change).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledWith({
      ...presets,
      type: newTypeToken,
    });
  });

  it("adds on a fresh theme whose roles carry the starter faces", () => {
    // The seed must not be a face a starter role already carries, or the
    // duplicate rule makes Add a no-op on every new theme. Tied to the starter
    // tokens rather than to a copy of their values, so changing either one is
    // caught here.
    const change = vi.fn();
    const panel = createTypeTokenPanel(document.body, change);
    panel.render(starterTypeTokens);

    panel.root
      .querySelector<HTMLButtonElement>("[data-yunari-type-preset-add]")
      ?.click();

    expect(change).toHaveBeenCalledWith({
      ...starterTypeTokens,
      type: newTypeToken,
    });
  });

  it("refuses a duplicate family and weight and points at the existing token", () => {
    // Two tokens with the same family and weight would compute the same name,
    // so the add is refused rather than minting a second one. `body` carries
    // the seed's own face here.
    const change = vi.fn();
    const tokenSelection = new TokenSelectionStore(new SelectionStore());
    const duplicate = { ...presets, body: newTypeToken };
    const panel = createTypeTokenPanel(
      document.body,
      change,
      undefined,
      undefined,
      tokenSelection,
    );
    panel.render(duplicate);

    panel.root
      .querySelector<HTMLButtonElement>("[data-yunari-type-preset-add]")
      ?.click();

    expect(change).not.toHaveBeenCalled();
    expect(tokenSelection.get()).toEqual({ kind: "preset", id: "body" });
  });

  it("unmounts its React tree and removes the section on disposal", () => {
    const panel = createTypeTokenPanel(document.body, vi.fn());
    panel.render(presets);

    panel.destroy();

    expect(panel.root.isConnected).toBe(false);
    // The tree really went with it: a container that React still owned would
    // hand back the markup it rendered.
    expect(panel.root.querySelector("[data-yunari-type-presets]")).toBeNull();
  });
});
