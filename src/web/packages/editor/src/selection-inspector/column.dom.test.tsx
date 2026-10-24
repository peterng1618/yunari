// @vitest-environment jsdom
import {
  type Binding,
  SEMANTIC_KEYS,
  SETTINGS_SECTIONS,
} from "@yunari/renderer-core";
import { FabricImage, type FabricObject, IText, Rect, Textbox } from "fabric/es";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChartEdits } from "../chart-manager/chart-fields.js";
import { uiCopy } from "../ui-copy.js";
import { backgroundColumn } from "./background-column.js";
import { SelectionColumn } from "./column.js";
import { idleCrop, idleCropEdits } from "./idle-crop.test-stage.js";
import { type ColumnContext, perKindColumn } from "./per-kind-column.js";
import {
  type ColumnSectionView,
  type FontFaceEdits,
  type ProjectionPorts,
  projectSelection,
  type RunEdits,
  readField,
  type SelectionEdits,
  type SelectionView,
} from "./view.js";

// jsdom has never had a `PointerEvent`, and Base UI re-dispatches a click
// through one to carry modifier state; a toggle click throws without it.
window.PointerEvent ??= MouseEvent as never;

/**
 * The section chrome the column owns now that it is React: the order the
 * questions are asked in, the header a section with nothing in it does not get,
 * which sections start closed, and the open state surviving a re-publish.
 *
 * The order assertion is written against `SETTINGS_SECTIONS` rather than a
 * literal list on purpose: Review Focus 2's failure is a React tree that renders
 * Layer above Content while the data plan's own order test still passes, so this
 * is the instrument that has to read the owner's order, not a copy of it.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const edits: SelectionEdits = {
  commit: () => false,
  preview: () => false,
  cancelPreview: () => {},
};

/** A run-editor port that records nothing: this file reads the chrome, not writes. */
const runs: RunEdits = {
  setRunText: () => false,
  setRunPreset: () => false,
  setRunColour: () => false,
  setUnitDisplay: () => false,
  setSource: () => false,
  setFormat: () => false,
  setZone: () => false,
  writeLayout: () => false,
  addRun: () => false,
  removeRun: () => false,
};

/** A chart port that records nothing, for the same reason. */
const chart: ChartEdits = {
  onSettings: () => {},
  onBinding: () => {},
  onAspect: () => {},
  onAddBinding: () => {},
  onRemoveBinding: () => {},
};

/** A crop port that records nothing: this file reads the chrome, not writes. */
const crop = idleCropEdits();

/** A face-field port that records nothing, for the same reason. */
const font: FontFaceEdits = {
  applyFace: async () => undefined,
  applyTrio: async () => undefined,
  listFavorites: async () => [],
  saveFavorites: async (ids) => ids,
};

function ports(): ProjectionPorts {
  return {
    globals: undefined,
    locale: undefined,
    nodeBindings: undefined,
    sampleSource: undefined,
    geometry: { read: readField },
  };
}

/** Enough of an editor for the per-kind builders: they read the canvas and warn
    through the error manager, and this file is about none of those. */
function context(): ColumnContext {
  return {
    editor: {
      canvas: {
        getActiveObject: () => undefined,
        getObjects: () => [],
        requestRenderAll: () => {},
      },
      historyManager: { attachGlobals: () => {}, saveState: () => {} },
      errorManager: { warn: () => {}, error: () => {} },
      cropManager: idleCrop(),
    } as never,
    globals: undefined,
    locale: undefined,
    geometry: {
      read: readField,
      write: () => {},
    },
    stillTarget: () => true,
    commit: () => {},
    rerender: () => {},
    refreshGlass: () => {},
    nodeBindings: undefined,
    onNodeBindingsChange: undefined,
    sampleSource: undefined,
    // An owner that can write a face, so a text object's column is the one the
    // editor builds rather than one with the field withheld.
    canWriteFontFace: true,
  };
}

/** The view the column would be handed for an object, projected for real: the
    order under test is the one `perKindColumn` decides, so a hard-coded order
    there has to reach this. */
function viewOf(object: FabricObject): SelectionView {
  return projectSelection(object, 1, ports(), perKindColumn(object, context()));
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
});

/** Renders a view and returns the section elements in document order. */
function renderedSections(view: SelectionView): HTMLElement[] {
  act(() => {
    root.render(
      <SelectionColumn
        view={view}
        edits={edits}
        runs={runs}
        chart={chart}
        crop={crop}
        font={font}
      />,
    );
  });
  return [...host.querySelectorAll<HTMLElement>("[data-yunari-section]")];
}

const headerOf = (id: string): HTMLButtonElement =>
  host.querySelector<HTMLButtonElement>(
    `[data-yunari-section="${id}"] > h2 > button`,
  )!;

const isOpen = (id: string): boolean =>
  headerOf(id).getAttribute("aria-expanded") === "true";

/** A real edit, as React sees one: the prototype setter, because React's own
 *  tracker would suppress a plain assignment, and the blur is the commit. */
async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input) as HTMLInputElement,
      "value",
    )?.set;
    if (setter === undefined) input.value = value;
    else setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    // `focusout` is the event React's `onBlur` is delegated from; the host is
    // detached here, so `blur()` would have nothing to move focus from.
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

describe("SelectionColumn", () => {
  it("renders the questions in the order SETTINGS_SECTIONS decides", () => {
    // A plain rect has no Content question of its own — the name moved into the
    // heading — so the column is the vocabulary minus that empty section, in the
    // owner's order.
    const ids = renderedSections(
      viewOf(new Rect({ width: 40, height: 20 })),
    ).map((element) => element.dataset["yunariSection"]);

    expect(ids).toEqual(
      SETTINGS_SECTIONS.map((section) => section.id).filter(
        (id) => id !== "content",
      ),
    );
  });

  it("renders no header at all for a section with nothing in it", () => {
    // A text object has no Paint row of its own: `vg-465` moved the glass
    // refusal into the lead block above the sections, and this rule takes the
    // whole section away rather than standing a header over one sentence. A
    // locked object drops every section at once, which is the case asserted
    // beside this one (`index.dom.test.ts`).
    const text = new IText("", { left: 0, top: 0 });
    text.set({
      yunariText: {
        runs: [{ kind: "literal", text: "Hi", typePreset: "typePresets.body" }],
      },
    });
    const view = viewOf(text);
    const ids = renderedSections(view).map(
      (element) => element.dataset["yunariSection"],
    );

    expect(ids).not.toContain("paint");
    expect(ids).toContain("content");
    expect(ids).toEqual(view.sections.map((section) => section.id));
  });

  it("starts every section open, Position included", () => {
    const view = viewOf(new Rect({ width: 40, height: 20 }));
    renderedSections(view);

    // Position was the one section put away, on the reasoning that geometry is
    // set once. It is what an object is usually selected *for*, so it is open —
    // and so is every other question the kind has: the column stops deciding
    // that for the author (item 13, DESIGN.md §7.4).
    for (const section of view.sections)
      expect(isOpen(section.id), section.id).toBe(true);
  });

  /** `vg-466`: the subject block's `border-b` is the boundary between the
   *  header and the first section, so a `border-t` here drew one hairline twice.
   *  Every later section keeps its own top rule — that boundary is between two
   *  sections, and nothing above draws it. */
  it("draws the hairline into the first section once, not twice", () => {
    const sections = renderedSections(
      viewOf(new Rect({ width: 40, height: 20 })),
    );

    expect(
      sections[0]?.className,
      "the section's own shape was lost",
    ).toContain("py-[var(--space-12)]");
    expect(
      sections[0]?.className,
      "the first section draws a second rule under the subject block's own",
    ).not.toContain("border-t");
    for (const element of sections.slice(1)) {
      expect(
        element.className,
        `${element.dataset["yunariSection"]} lost its top rule, so two sections ` +
          "now run together",
      ).toContain("border-t");
    }
  });

  it("marks the Size halves read-only for a text, and editable for a text box", () => {
    const runs = {
      runs: [{ kind: "literal", text: "Hi", typePreset: "typePresets.body" }],
    };
    const auto = new IText("Hi", { left: 0, top: 0 });
    auto.set("yunariText", runs);
    const box = new Textbox("Hi", { left: 0, top: 0, width: 120 });
    box.set("yunariText", runs);

    const sizeHalves = (object: FabricObject) => {
      const position = viewOf(object).sections.find(
        (section) => section.id === "position",
      );
      const pair = position?.fields.find(
        (field) => field.id === "width-height",
      );
      if (pair?.control !== "pair") throw new Error("no Size pair");
      return pair.halves;
    };

    // A text's W/H are measurements it grows from: the column states that by
    // making both halves read-only, while the box keeps the box writes.
    expect(sizeHalves(auto).map((half) => half.readOnly)).toEqual([true, true]);
    expect(sizeHalves(box).map((half) => "readOnly" in half)).toEqual([
      false,
      false,
    ]);
  });

  it("renders the Size halves as read-only inputs for a text", () => {
    const text = new IText("Hi", { left: 0, top: 0 });
    text.set("yunariText", {
      runs: [{ kind: "literal", text: "Hi", typePreset: "typePresets.body" }],
    });
    renderedSections(viewOf(text));

    expect(
      host.querySelector<HTMLInputElement>('[data-yunari-geometry="width"]')
        ?.readOnly,
    ).toBe(true);
    expect(
      host.querySelector<HTMLInputElement>('[data-yunari-geometry="height"]')
        ?.readOnly,
    ).toBe(true);
    // Position is not the class's contract: it stays editable.
    expect(
      host.querySelector<HTMLInputElement>('[data-yunari-geometry="left"]')
        ?.readOnly,
    ).toBe(false);
  });

  it("keeps the disclosure the author chose across a re-publish", () => {
    const view = viewOf(new Rect({ width: 40, height: 20 }));
    renderedSections(view);

    act(() => headerOf("position").click());
    expect(isOpen("position")).toBe(false);
    expect(isOpen("paint")).toBe(true);

    // A re-publish is a new view on the same tree, the way a selection change
    // reaches the column. Rebuilding the sections would return Position to its
    // default and collapse Paint under the author's hands.
    renderedSections({ ...view, targetRevision: 2 });

    expect(isOpen("position")).toBe(false);
    expect(isOpen("paint")).toBe(true);
  });

  /**
   * `vg-254`: the slider is the one row that reaches all three write routes — a
   * preview while the gesture moves, one commit when it ends, and a cancel that
   * puts the value the press started from back. A pointer *drag* is a gesture
   * jsdom has no layout to resolve (see `ControlSlider`), so this pins the
   * wiring and `inspector-sections.spec.ts` pins the drag itself.
   */
  it("drives a slider's preview, commit and cancel through the edit port", async () => {
    const commit = vi.fn(() => false);
    const preview = vi.fn(() => false);
    const cancelPreview = vi.fn();
    const port: SelectionEdits = { commit, preview, cancelPreview };

    const rect = new Rect({ width: 40, height: 20 });
    rect.set({ opacity: 0.5 });
    act(() => {
      root.render(
        <SelectionColumn
          view={viewOf(rect)}
          edits={port}
          runs={runs}
          chart={chart}
          crop={crop}
          font={font}
        />,
      );
    });
    const track = host.querySelector<HTMLInputElement>(
      "[data-yunari-opacity]",
    )!;

    // One keyboard step: the moving value reaches the preview and the release
    // reaches the commit, with the same field and the same number.
    await act(async () => track.focus());
    await act(async () => {
      track.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(preview).toHaveBeenCalledWith(1, "opacity", 51);
    expect(commit).toHaveBeenCalledWith(1, "opacity", 51);

    // Escape during a press abandons it: the cancel carries the value the press
    // started from, which is the view's — not the number the preview last wrote.
    await act(async () => {
      track.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
    await act(async () => {
      track.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(cancelPreview).toHaveBeenCalledTimes(1);
    expect(cancelPreview).toHaveBeenCalledWith(1, "opacity", 50);
  });

  /**
   * The background's percent fields: a fraction is stored, a percentage is
   * shown, and the number the write boundary receives is the fraction again.
   */
  it("renders a stored fraction as a percentage and commits the fraction", async () => {
    const commit = vi.fn(() => false);
    const port: SelectionEdits = {
      commit,
      preview: () => false,
      cancelPreview: () => {},
    };
    const view: SelectionView = {
      targetRevision: 1,
      subject: {
        name: "Background",
        authoredName: "",
        kind: "background",
        key: undefined,
      },
      locked: false,
      sections: backgroundColumn({
        background: {
          media: { assetId: "a", bounds: "theme", offsetX: 0.25 },
        },
        assets: [],
        globals: undefined,
      }),
    };
    act(() => {
      root.render(
        <SelectionColumn
          view={view}
          edits={port}
          runs={runs}
          chart={chart}
          crop={crop}
          font={font}
        />,
      );
    });

    const offsetX = host.querySelector<HTMLInputElement>(
      "[data-yunari-background-offset-x]",
    )!;
    expect(offsetX.value).toBe("25");
    // The number is scaled, so the well says into what (0096): a bare "25"
    // reads as a pixel offset.
    expect(offsetX.parentElement?.textContent).toContain("%");

    // The pair's own divide: a percentage typed here has to reach the model as
    // the fraction the field stores.
    await typeInto(offsetX, "50");
    expect(commit).toHaveBeenCalledWith(1, "background.offsetX", 0.5);

    const flipX = host.querySelector<HTMLButtonElement>(
      "[data-yunari-background-flip-x]",
    )!;
    flipX.click();
    expect(commit).toHaveBeenCalledWith(1, "background.flipX", true);
  });

  /**
   * `vg-268`/`vg-283`: the face picker the font catalogue plan shipped is
   * mounted on the field the ruling named as its owner, and the face it picks is
   * applied to the preset the object is set in — a text object has no face of
   * its own, a run names a preset and the preset carries the face. This pins the
   * mount and the write, which is the whole of what the two rows asked for.
   * The face field is a button now: the catalogue browser it used to mount
   * lives in the finder's Fonts body (task 12), so the field's whole job is to
   * ask for that surface. The preset a face applies to is read where the write
   * happens, because only the session still holds the selected object.
   */
  it("renders a button that asks for the finder instead of the picker", async () => {
    const openPicker = vi.fn();
    const text = new IText("", { left: 0, top: 0 });
    text.set({
      yunariText: {
        runs: [{ kind: "literal", text: "Hi", typePreset: "typePresets.body" }],
      },
    });

    await act(async () => {
      root.render(
        <SelectionColumn
          view={viewOf(text)}
          edits={edits}
          runs={runs}
          chart={chart}
          crop={crop}
          font={font}
          onOpenFontPicker={openPicker}
        />,
      );
    });

    const field = host.querySelector("[data-yunari-font-face-field]");
    expect(field).not.toBeNull();
    // The picker stayed with the catalogue: nothing of it is mounted here.
    expect(field?.querySelector("[data-yunari-font-picker]")).toBeNull();

    const button = field?.querySelector<HTMLButtonElement>(
      "[data-yunari-open-font-picker]",
    );
    expect(button?.textContent).toBe(uiCopy.assets.openFontPicker);
    await act(async () => button?.click());

    expect(openPicker).toHaveBeenCalledTimes(1);
  });
});

/**
 * The image reading. An image's Content column asks which reading supplies its
 * picture; only the catalogue's image-capable descriptors are offered, so a
 * numeric sensor is not a choice the row can make. The write itself is the
 * funnel's (`index.ts`), and the browser proof of a reading reaching a display
 * is `tests/e2e/image-binding.spec.ts`.
 */
describe("an image's sensor field", () => {
  function image(id?: string): FabricImage {
    const object = new FabricImage(document.createElement("img"));
    if (id !== undefined) object.set("id", id);
    return object;
  }

  const imageContext = (bindings: readonly Binding[]) => {
    const base = context();
    return {
      ...base,
      descriptors: () => SEMANTIC_KEYS,
      nodeBindings: () => bindings,
    };
  };

  it("offers only image-capable readings and shows the bound one", () => {
    const sections = perKindColumn(
      image("artwork"),
      imageContext([{ id: "image", semanticKey: "media.artwork" }]),
    );
    const content = sections.find((section) => section.id === "content");
    const field = content?.fields.find(
      (candidate) => candidate.id === "image-binding",
    );

    expect(field?.control).toBe("select");
    if (field?.control !== "select") throw new Error("no sensor field");
    expect(field.value).toBe("media.artwork");
    const offered = field.options.map((option) => option.id);
    expect(offered).toContain("media.artwork");
    // A numeric reading is not a picture, and the list says so.
    expect(offered).not.toContain("cpu.load");
  });

  it("is withheld from a locked image and from one with no id", () => {
    const offersSensor = (sections: readonly ColumnSectionView[]): boolean =>
      sections.some((section) =>
        section.fields.some((field) => field.id === "image-binding"),
      );

    const locked = image("artwork");
    locked.set({ locked: true });
    expect(offersSensor(perKindColumn(locked, imageContext([])))).toBe(false);
    // The lock is what withheld it: unlocked, the same object has the row.
    expect(
      offersSensor(perKindColumn(image("artwork"), imageContext([]))),
    ).toBe(true);

    expect(offersSensor(perKindColumn(image(), imageContext([])))).toBe(false);
  });

  it("is not offered to a shape", () => {
    const content = perKindColumn(new Rect(), context()).find(
      (section) => section.id === "content",
    );
    expect(content?.fields.some((field) => field.id === "image-binding")).toBe(
      false,
    );
  });

  it("renders the bound reading on the control a suite can locate", () => {
    const object = image("artwork");
    const sections = perKindColumn(
      object,
      imageContext([{ id: "image", semanticKey: "game.artwork" }]),
    );
    renderedSections(projectSelection(object, 1, ports(), sections));

    const trigger = host.querySelector<HTMLElement>(
      "[data-yunari-image-sensor]",
    );
    expect(trigger).not.toBeNull();
    expect(
      trigger
        ?.querySelector("[data-yunari-value]")
        ?.getAttribute("data-yunari-value"),
    ).toBe("game.artwork");
  });
});
