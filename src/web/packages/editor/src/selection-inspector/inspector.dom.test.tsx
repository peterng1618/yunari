// @vitest-environment jsdom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { Glyph, KIND_GLYPHS, type LucideIcon } from "../editor-shell/icons.js";
import { uiCopy } from "../ui-copy.js";
import { createInspectorRoot } from "./inspector.js";
import type { SelectionEdits, SelectionView } from "./view.js";

/**
 * The React root and its store. The invariant this file can see is the one the
 * value walk cannot: what crosses the boundary into React is the serialized view
 * and the edit port, and a publish is what makes React re-render — nothing else.
 */

const edits: SelectionEdits = {
  commit: () => false,
  preview: () => false,
  cancelPreview: () => {},
};

function view(overrides: Partial<SelectionView> = {}): SelectionView {
  return {
    targetRevision: 1,
    subject: {
      name: "CPU card",
      authoredName: "CPU card",
      kind: "group",
      key: "cpu.load",
    },
    locked: false,
    sections: [],
    ...overrides,
  };
}

/**
 * The glyph `icon` draws, as markup, so a case compares the header's mark with
 * the vocabulary's own rather than with a class name spelled in this file.
 */
function glyphMarkup(icon: LucideIcon): string {
  const host = document.createElement("div");
  const root = createRoot(host);
  flushSync(() => {
    root.render(createElement(Glyph, { icon, size: 14 }));
  });
  const markup = host.querySelector("svg")?.outerHTML ?? "";
  root.unmount();
  return markup;
}

describe("createInspectorRoot", () => {
  it("renders the subject the published view carries", () => {
    const host = document.createElement("div");
    const root = createInspectorRoot(host);

    root.publish(view(), edits);

    expect(host.textContent).toContain("CPU card");
    // The key survives the type word's removal: it is the object's own fact,
    // not the kind the glyph now draws.
    expect(host.textContent).toContain("cpu.load");
    expect(host.querySelector("[data-yunari-nothing-selected]")).toBeNull();
    root.destroy();
  });

  /** `vg-466`: the kind was a word under the name and is now the kind's own
   *  glyph, before the name, drawn from the vocabulary's one per-kind map. */
  it("draws the kind's glyph before the name, and not the kind's word", () => {
    const host = document.createElement("div");
    const root = createInspectorRoot(host);

    root.publish(
      view({
        subject: {
          name: "CPU card",
          authoredName: "CPU card",
          kind: "text",
          key: undefined,
        },
      }),
      edits,
    );

    expect(
      host.querySelector("[data-yunari-subject-name]")?.previousElementSibling
        ?.outerHTML,
      "the header draws no glyph of the subject's kind before its name",
    ).toBe(glyphMarkup(KIND_GLYPHS.text));
    expect(host.textContent).not.toContain(uiCopy.panels.layerKinds.text);
    root.destroy();
  });

  /** A multi-selection is not a `LayerKind` and has no glyph in the map; its
   *  name already says "Selection", so the header draws the name alone rather
   *  than reaching for a mark from a second table. */
  it("draws no kind glyph for a multi-selection", () => {
    const host = document.createElement("div");
    const root = createInspectorRoot(host);

    root.publish(
      view({
        subject: {
          name: "Selection",
          authoredName: "",
          kind: "activeSelection",
          key: undefined,
        },
      }),
      edits,
    );

    expect(host.querySelector("svg")).toBeNull();
    expect(host.querySelector("[data-yunari-subject-name]")?.textContent).toBe(
      "Selection",
    );
    root.destroy();
  });

  it("prints no key line when the subject carries no key", () => {
    const host = document.createElement("div");
    const root = createInspectorRoot(host);

    root.publish(
      view({
        subject: {
          name: "CPU card",
          authoredName: "CPU card",
          kind: "group",
          key: undefined,
        },
      }),
      edits,
    );

    expect(host.textContent).toBe("CPU card");
    // The *element*, not the text: an unguarded span saying nothing would leave
    // `textContent` where it is, and the header would still hold an empty line
    // under the name.
    const block = host.querySelector("[data-yunari-subject-name]")
      ?.parentElement?.parentElement;
    expect(
      block?.children,
      "the header holds a line for a key it has none of",
    ).toHaveLength(1);
    root.destroy();
  });

  it("names where to choose from when the view has no subject", () => {
    const host = document.createElement("div");
    const root = createInspectorRoot(host);

    root.publish(view({ subject: undefined }), edits);

    expect(
      host.querySelector("[data-yunari-nothing-selected]")?.textContent,
    ).toBe(uiCopy.inspectorFields.nothingSelected);
    root.destroy();
  });

  it("prints the locked note under the hook the browser suite reads it by", () => {
    const host = document.createElement("div");
    const root = createInspectorRoot(host);

    root.publish(view({ locked: true }), edits);

    // The hook is the locator contract (vg-148): the e2e spec finds the note by
    // `[data-yunari-locked]`, so losing it would leave that spec passing on a
    // stale locator while the column stopped saying anything.
    expect(host.querySelector("[data-yunari-locked]")?.textContent).toBe(
      uiCopy.inspectorFields.locked,
    );
    root.destroy();
  });

  it("has no locked note on an unlocked subject", () => {
    const host = document.createElement("div");
    const root = createInspectorRoot(host);

    root.publish(view(), edits);

    expect(host.querySelector("[data-yunari-locked]")).toBeNull();
    root.destroy();
  });

  it("re-renders on the next publish, and only on a publish", () => {
    const host = document.createElement("div");
    const root = createInspectorRoot(host);
    root.publish(view(), edits);

    root.publish(
      view({
        targetRevision: 2,
        subject: {
          name: "Header",
          authoredName: "Header",
          kind: "shape",
          key: undefined,
        },
      }),
      edits,
    );

    expect(host.textContent).toContain("Header");
    expect(host.textContent).not.toContain("CPU card");
    root.destroy();
  });

  it("does not call the edit port from a render", () => {
    const commit = vi.fn(() => false);
    const host = document.createElement("div");
    const root = createInspectorRoot(host);

    root.publish(view(), {
      commit,
      preview: () => false,
      cancelPreview: () => {},
    });

    // The port is a value the surface writes through; rendering it is not a
    // write, and a render that reached the funnel would save history per paint.
    expect(commit).not.toHaveBeenCalled();
    root.destroy();
  });

  it("unmounts its tree on destroy", () => {
    const host = document.createElement("div");
    const root = createInspectorRoot(host);
    root.publish(view(), edits);

    root.destroy();

    expect(host.textContent).toBe("");
  });
});
