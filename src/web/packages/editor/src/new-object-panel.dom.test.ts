// @vitest-environment jsdom

import { CHART_FAMILIES } from "@yunari/renderer-core";
import { YUNARI_PAINT_PROPERTY } from "@yunari/scene-fabric";
import { Ellipse, Line, Path, Polygon, Polyline, Rect } from "fabric/es";
import { describe, expect, it, vi } from "vitest";
import { CARD_LIBRARY } from "./card-library.js";
import { SHAPE_KINDS } from "./new-object-defaults.js";
import { createNewObjectPanel, insertNewText } from "./new-object-panel.js";
import { uiCopy } from "./ui-copy.js";

/** The smallest globals an insertion needs: one palette token to paint with. */
const GLOBALS = {
  palette: {
    ink: { name: "Ink", value: { kind: "solid" as const, color: "#102030" } },
  },
  typePresets: {
    body: { name: "Body", value: { family: "Inter", size: 16, weight: "600" } },
  },
};

/** The object `addText` hands back. An insert asks for no box yet, so the
 *  manager's no-box branch constructs an `IText`; the fake only needs the
 *  caret calls both classes share. */
function textWithEditing() {
  return {
    enterEditing: vi.fn(function (this: { isEditing: boolean }) {
      this.isEditing = true;
    }),
    selectAll: vi.fn(),
    isEditing: false,
  };
}

/** The construction surface a panel insertion writes through: the canvas and
    the history, exactly as the editor's own managers use them. */
function editorStub() {
  const canvas = {
    add: vi.fn(),
    setActiveObject: vi.fn(),
    requestRenderAll: vi.fn(),
    getActiveObject: vi.fn((): unknown => undefined),
    // The cascade reads the document's own object count off the canvas, so a
    // stub that could not answer would leave the placement unexercised.
    getObjects: vi.fn(() => [] as unknown[]),
  };
  const historyManager = { saveState: vi.fn() };
  return {
    canvas,
    // The authored frame a placement has to land inside.
    artboard: () => ({ width: 1920, height: 1080 }),
    historyManager,
    textManager: {
      addText: vi.fn((_options?: Record<string, unknown>): unknown =>
        textWithEditing(),
      ),
    },
    errorManager: { warn: vi.fn(), error: vi.fn() },
  };
}

/** The chart buttons live in their own group, so "Line" names two different
    things in this panel and the group is what tells them apart. */
function chartButton(root: HTMLElement, label: string): HTMLButtonElement {
  return [...root.querySelectorAll("button")].find(
    (button) =>
      accessibleName(button) === label &&
      button.closest("fieldset")?.querySelector("legend")?.textContent ===
        uiCopy.panels.charts,
  )!;
}

/** What a reader is told a control is. The pane's shape and chart tiles are
 *  glyph-led — their own text is empty — so the name is read the way a screen
 *  reader reads it, from `aria-label` where there is one. */
function accessibleName(control: HTMLElement): string {
  return control.getAttribute("aria-label") ?? control.textContent ?? "";
}

const palette = {
  palette: {
    none: {
      name: "None",
      value: { kind: "solid" as const, color: "transparent" },
    },
    background: {
      name: "Background",
      value: { kind: "solid" as const, color: "#0c0e13" },
    },
  },
  typePresets: {
    body: { name: "Body", value: { family: "Inter", size: 16 } },
  },
} as const;

describe("new object panel", () => {
  it("inserts a rectangle through the canvas, selected, as one history entry", () => {
    const editor = editorStub();
    const panel = createNewObjectPanel(
      document.body,
      editor as never,
      palette as never,
    );

    panel.root
      .querySelector<HTMLButtonElement>("[data-yunari-panel-add]")!
      .click();

    const inserted = editor.canvas.add.mock.calls[0]?.[0];
    expect(inserted).toBeInstanceOf(Rect);
    // Insertion is a construction, not a shape factory call: one object, one
    // activation, one history entry.
    expect(editor.canvas.add).toHaveBeenCalledTimes(1);
    expect(editor.canvas.setActiveObject).toHaveBeenCalledWith(inserted);
    expect(editor.historyManager.saveState).toHaveBeenCalledTimes(1);
  });

  it("gives the inserted panel a palette-backed surface fill", () => {
    const editor = editorStub();
    const panel = createNewObjectPanel(
      document.body,
      editor as never,
      palette as never,
    );

    panel.root
      .querySelector<HTMLButtonElement>("[data-yunari-panel-add]")!
      .click();

    // The saved document is only palette-reassignable if the new panel carries
    // its own reference rather than a literal colour. This palette has no card
    // token, so it takes the surface it does have.
    expect(
      editor.canvas.add.mock.calls[0]?.[0].get(YUNARI_PAINT_PROPERTY),
    ).toEqual({ fill: "palette.background" });
  });

  it("fills an inserted shape with the card token when the palette has one", () => {
    const editor = editorStub();
    const panel = createNewObjectPanel(
      document.body,
      editor as never,
      {
        ...palette,
        palette: {
          ...palette.palette,
          panel: {
            name: "Panel",
            value: { kind: "solid" as const, color: "#081523d9" },
          },
        },
      } as never,
    );

    panel.root
      .querySelector<HTMLButtonElement>('[data-yunari-panel-add="ellipse"]')!
      .click();

    // A shape the author draws is a card they will put something on. Filled with
    // the scene's own backdrop it is not a shape at all, and nothing an author
    // cannot see can be selected or edited.
    expect(
      editor.canvas.add.mock.calls[0]?.[0].get(YUNARI_PAINT_PROPERTY),
    ).toEqual({ fill: "palette.panel" });
  });

  it("labels the panel button for an author and a screen reader", () => {
    const panel = createNewObjectPanel(
      document.body,
      editorStub() as never,
      palette as never,
    );
    const button = panel.root.querySelector<HTMLButtonElement>(
      "[data-yunari-panel-add]",
    )!;

    expect(button.type).toBe("button");
    expect(accessibleName(button).trim().length).toBeGreaterThan(0);
  });

  it("reports a construction the theme cannot supply a reference for", () => {
    const editor = editorStub();
    const panel = createNewObjectPanel(
      document.body,
      editor as never,
      // No palette token at all, so the defaults factory refuses.
      undefined,
    );

    panel.root
      .querySelector<HTMLButtonElement>("[data-yunari-panel-add]")!
      .click();

    // Reported through the editor's own diagnostics: a throw out of a click
    // handler would leave the author with a button that silently does nothing.
    expect(editor.errorManager.warn).toHaveBeenCalledWith(
      "controls",
      expect.stringContaining("palette token"),
    );
    expect(editor.canvas.add).not.toHaveBeenCalled();
  });

  it.each([
    ["Gauge", "gauge"],
    ["Line", "line"],
    ["Bar", "bar"],
    ["Pie", "pie"],
    ["Radar", "radar"],
    ["Polar bar", "polarBar"],
  ] as const)("delegates %s to ChartManager", (label, family) => {
    const addChart = vi.fn();
    const panel = createNewObjectPanel(
      document.body,
      // `addText` returns a text object, never undefined — see `TextManager`. A
      // bare `vi.fn()` broke that contract, and the panel's deferred caret
      // callback then dereferenced the undefined: its guard compares the canvas's
      // active object against the returned one, and `undefined !== undefined` is
      // false, so it fell through. Every full run printed an Unhandled Errors
      // block that had nothing to do with what any of these tests were checking.
      {
        textManager: {
          addText: vi.fn((_options?: Record<string, unknown>): unknown =>
            textWithEditing(),
          ),
        },
      } as never,
      undefined,
      { addText: vi.fn(), addChart, insertCard: vi.fn() },
    );

    chartButton(panel.root, label).click();

    expect(addChart).toHaveBeenCalledWith(family);
  });

  it("reports a chart construction the theme cannot reference, like every sibling", () => {
    // `ChartManager.addChart` calls `newChart` into `createNewChartDefaults`
    // with no handler of its own, so an unwrapped chart button is the only one
    // in this panel that fails silently.
    const addChart = vi.fn(() => {
      throw new Error("A new chart requires a palette token.");
    });
    const editor = editorStub();
    const panel = createNewObjectPanel(
      document.body,
      editor as never,
      undefined,
      {
        addText: vi.fn(),
        addChart,
        insertCard: vi.fn(),
      },
    );

    for (const label of ["Gauge", "Line", "Bar", "Pie", "Radar", "Polar bar"]) {
      chartButton(panel.root, label).click();
    }

    // All six, not one: the wrapper is the module's, so a button that opted
    // out would be a silent failure the author cannot see.
    expect(addChart).toHaveBeenCalledTimes(6);
    expect(editor.errorManager.warn).toHaveBeenCalledTimes(6);
    for (const call of editor.errorManager.warn.mock.calls) {
      expect(call[0]).toBe("controls");
      expect(call[1]).toContain("palette token");
    }
  });

  it("offers every primitive Fabric ships as a named shape, not one panel", () => {
    const { root } = createNewObjectPanel(
      document.body,
      editorStub() as never,
      palette as never,
    );

    // One list, read by the panel: a shape the author cannot insert is the same
    // gap as a shape with no properties.
    const group = [...root.querySelectorAll("fieldset")].find(
      (candidate) =>
        candidate.querySelector("legend")?.textContent === uiCopy.panels.shapes,
    )!;
    expect(
      [...group.querySelectorAll("button")].map((button) =>
        button.getAttribute("data-yunari-panel-add"),
      ),
    ).toEqual([...SHAPE_KINDS]);
  });

  it("groups the shapes so the shape Line is not the chart Line", () => {
    const { root } = createNewObjectPanel(
      document.body,
      editorStub() as never,
      palette as never,
    );

    // "Line" is both a chart family and a primitive. A flat chip list would put
    // the same word on two buttons and leave the author to guess which is which.
    expect(
      chartButton(root, uiCopy.chartFamilies.line).closest("fieldset"),
    ).not.toBe(
      root.querySelector('[data-yunari-panel-add="line"]')?.closest("fieldset"),
    );
    const shape = root.querySelector<HTMLElement>(
      '[data-yunari-panel-add="line"]',
    );
    expect(shape === null ? "" : accessibleName(shape)).toBe(
      uiCopy.shapeKinds.line,
    );
  });

  it("groups the chart families as their own list rather than strays under Shape", () => {
    const { root } = createNewObjectPanel(
      document.body,
      editorStub() as never,
      palette as never,
    );

    // The charts were peers of Panel before the shapes arrived, and F1.9 left
    // four unlabelled chips under a legend that is not about them: the visual
    // orphaning and the "Line" ambiguity are one defect, and the group's name
    // is what resolves both — for a screen reader and for a test.
    const groups = [...root.querySelectorAll("fieldset")];
    expect(
      groups.map((group) => group.querySelector("legend")?.textContent),
    ).toEqual([
      uiCopy.panels.cards,
      uiCopy.panels.shapes,
      uiCopy.panels.charts,
    ]);

    for (const family of ["gauge", "line", "bar", "pie"] as const) {
      const button = chartButton(root, uiCopy.chartFamilies[family]);
      expect(
        button.closest("fieldset")?.querySelector("legend")?.textContent,
        family,
      ).toBe(uiCopy.panels.charts);
    }
  });

  it("leaves the two Line buttons in groups a screen reader can tell apart", () => {
    const { root } = createNewObjectPanel(
      document.body,
      editorStub() as never,
      palette as never,
    );

    // Neither button's own name changes — the group is the difference, and it
    // is what an author navigating by group hears before the name.
    const lines = [...root.querySelectorAll("button")].filter(
      (button) => accessibleName(button) === uiCopy.shapeKinds.line,
    );
    expect(lines).toHaveLength(2);
    const groups = new Set(
      lines.map(
        (button) =>
          button.closest("fieldset")?.querySelector("legend")?.textContent,
      ),
    );
    expect(groups).toEqual(
      new Set([uiCopy.panels.shapes, uiCopy.panels.charts]),
    );
  });

  // No circle and no triangle: both are shapes the editor no longer offers.
  // A circle is an ellipse that nothing kept round, and a triangle is a
  // 3-sided polygon, so each had an entry that added nothing the other could
  // not already produce. See vg-078.
  it.each([
    ["rect", Rect],
    ["ellipse", Ellipse],
    ["polygon", Polygon],
    ["polyline", Polyline],
    ["line", Line],
    ["path", Path],
  ] as const)("inserts a %s as its own Fabric class", (kind, Class) => {
    const editor = editorStub();
    const { root } = createNewObjectPanel(
      document.body,
      editor as never,
      palette as never,
    );

    root
      .querySelector<HTMLButtonElement>(`[data-yunari-panel-add="${kind}"]`)!
      .click();

    const inserted = editor.canvas.add.mock.calls[0]?.[0];
    expect(inserted).toBeInstanceOf(Class);
    // One construction, not a factory call per shape: one object, one
    // activation, one history entry.
    expect(editor.canvas.setActiveObject).toHaveBeenCalledWith(inserted);
    expect(editor.historyManager.saveState).toHaveBeenCalledTimes(1);
  });

  it.each([...SHAPE_KINDS])(
    "gives an inserted %s an id that names its own kind",
    (kind) => {
      const editor = editorStub();
      const { root } = createNewObjectPanel(
        document.body,
        editor as never,
        palette as never,
      );

      root
        .querySelector<HTMLButtonElement>(`[data-yunari-panel-add="${kind}"]`)!
        .click();

      // The id is the stable key bindings, the schema path and the envelope all
      // carry, so a circle keyed `panel-…` misleads everyone who reads the
      // document rather than the screen. Same shape as F1.8 caught in reverse:
      // an object wearing another kind's identity. F1.8 gave the *display* the
      // right name, which is why an author never sees this — the key is what
      // everyone else reads.
      expect(
        (editor.canvas.add.mock.calls[0]?.[0] as { id?: string }).id,
        kind,
      ).toMatch(new RegExp(`^${kind}-[0-9a-f]{8}-`));
    },
  );

  it.each([...SHAPE_KINDS])(
    "names the %s button for a screen reader",
    (kind) => {
      const { root } = createNewObjectPanel(
        document.body,
        editorStub() as never,
        palette as never,
      );
      const button = root.querySelector<HTMLButtonElement>(
        `[data-yunari-panel-add="${kind}"]`,
      )!;

      expect(button.type).toBe("button");
      // The tile is glyph-led, so the name is the accessible one: the same
      // string a tooltip shows and a screen reader announces.
      expect(accessibleName(button).trim()).toBe(uiCopy.shapeKinds[kind]);
    },
  );

  it("reports a shape the theme cannot supply a reference for", () => {
    const editor = editorStub();
    const { root } = createNewObjectPanel(
      document.body,
      editor as never,
      undefined,
    );

    for (const kind of SHAPE_KINDS) {
      root
        .querySelector<HTMLButtonElement>(`[data-yunari-panel-add="${kind}"]`)!
        .click();
    }

    // All eight, not one: the wrapper is the module's, so a shape button that
    // opted out would be a silent failure the author cannot see.
    expect(editor.errorManager.warn).toHaveBeenCalledTimes(SHAPE_KINDS.length);
    for (const call of editor.errorManager.warn.mock.calls) {
      expect(call[0]).toBe("controls");
      expect(call[1]).toContain("palette token");
    }
    expect(editor.canvas.add).not.toHaveBeenCalled();
  });

  it("draws no file section in the Add pane", () => {
    // Local files belong to the Assets pane (DESIGN.md §7.2): the Add pane is
    // insertion-only, so neither an import control nor a finder link lives here.
    const { root } = createNewObjectPanel(
      document.body,
      editorStub() as never,
      palette as never,
    );

    for (const selector of [
      "[data-yunari-asset-import]",
      "[data-yunari-asset-import-background]",
      "[data-yunari-find-assets]",
      "[data-yunari-asset-select]",
    ]) {
      expect(root.querySelector(selector), selector).toBeNull();
    }
  });

  it("arms the session's text route instead of constructing at the click", () => {
    // The pointer, not the menu, decides what the text is and where it lands.
    // A tile that constructed here would make the placement gesture a second,
    // later step after an object had already appeared.
    const addText = vi.fn();
    const editor = editorStub();
    const panel = createNewObjectPanel(
      document.body,
      editor as never,
      GLOBALS as never,
      { addText, addChart: vi.fn(), insertCard: vi.fn() },
    );

    [...panel.root.querySelectorAll("button")]
      .find((button) => button.textContent === uiCopy.panels.text)!
      .click();

    expect(addText).toHaveBeenCalledOnce();
    expect(editor.textManager.addText).not.toHaveBeenCalled();
    expect(editor.canvas.add).not.toHaveBeenCalled();
  });

  it("refuses the text tile rather than doing nothing when there is no session", () => {
    const editor = editorStub();
    const root = createNewObjectPanel(
      document.body,
      editor as never,
      GLOBALS as never,
    ).root;

    [...root.querySelectorAll("button")]
      .find((button) => button.textContent === uiCopy.panels.text)!
      .click();

    expect(editor.errorManager.warn).toHaveBeenCalledWith(
      "controls",
      expect.stringContaining("text manager"),
    );
    expect(editor.textManager.addText).not.toHaveBeenCalled();
  });

  it("inserts a Text at the placement point and with no authored box", () => {
    const editor = editorStub();

    insertNewText(editor as never, GLOBALS as never, { left: 120, top: 80 });

    const options = editor.textManager.addText.mock.calls[0]?.[0] as {
      left: number;
      top: number;
      name: string;
      text: string;
      box?: unknown;
    };
    expect(options).toMatchObject({ text: "New text", left: 120, top: 80 });
    expect(options.name).toBe(uiCopy.panels.text);
    expect("box" in options).toBe(false);
    expect(editor.textManager.addText).toHaveBeenCalledOnce();
  });

  it("inserts a Text box with the rectangle the drag drew", () => {
    const editor = editorStub();
    const box = { width: 240, height: 96 };

    insertNewText(editor as never, GLOBALS as never, {
      left: 120,
      top: 80,
      box,
    });

    const options = editor.textManager.addText.mock.calls[0]?.[0] as {
      name: string;
      box?: unknown;
    };
    expect(options.name).toBe(uiCopy.panels.textBox);
    expect(options.box).toEqual(box);
  });

  it("leaves the one history entry to the text manager's own addText", () => {
    // `insertNewText` constructs once and saves nothing itself: `addText` is
    // the owner of the entry, and its own suite pins that it saves once.
    const editor = editorStub();

    insertNewText(editor as never, GLOBALS as never, { left: 10, top: 10 });

    expect(editor.textManager.addText).toHaveBeenCalledOnce();
    expect(editor.historyManager.saveState).not.toHaveBeenCalled();
  });
});

describe("the chooser offers units and primitives", () => {
  /** The panel the session builds: a card needs the envelope's bindings. */
  function chooser(): HTMLElement {
    return createNewObjectPanel(
      document.body,
      editorStub() as never,
      palette as never,
      { addText: vi.fn(), addChart: vi.fn(), insertCard: vi.fn() },
    ).root;
  }

  function buttonsIn(root: HTMLElement, legend: string): HTMLButtonElement[] {
    const fieldset = [...root.querySelectorAll("fieldset")].find(
      (group) => group.querySelector("legend")?.textContent === legend,
    );
    return [...(fieldset?.querySelectorAll("button") ?? [])];
  }

  // THE gate. The unit is the fast path for the common case; the primitive is
  // the tool for the case nobody anticipated, which is the case this product is
  // for. Neither greyed, neither described as a fallback — so this test fails
  // the moment the library quietly becomes the only way in.
  it("populates both sections and disables neither", () => {
    const root = chooser();

    const cards = buttonsIn(root, uiCopy.panels.cards);
    const shapes = buttonsIn(root, uiCopy.panels.shapes);
    const charts = buttonsIn(root, uiCopy.panels.charts);

    expect(cards).toHaveLength(CARD_LIBRARY.length);
    expect(shapes).toHaveLength(SHAPE_KINDS.length);
    expect(charts).toHaveLength(CHART_FAMILIES.length);
    // Text stands on its own outside any fieldset, and is still offered.
    expect(
      [...root.querySelectorAll("button")].map((b) => b.textContent),
    ).toContain(uiCopy.panels.text);

    for (const control of root.querySelectorAll("button")) {
      expect(control.disabled, control.textContent ?? "").toBe(false);
    }
  });

  it("calls neither section a fallback", () => {
    const root = chooser();
    const spoken = [...root.querySelectorAll("legend, button")]
      .map((node) => node.textContent ?? "")
      .join(" ");

    for (const word of ["fallback", "advanced", "basic", "simple", "expert"]) {
      expect(spoken.toLowerCase(), word).not.toContain(word);
    }
  });

  it("delegates a card button to the session, which owns the readings", () => {
    const insertCard = vi.fn();
    const root = createNewObjectPanel(
      document.body,
      editorStub() as never,
      palette as never,
      { addText: vi.fn(), addChart: vi.fn(), insertCard },
    ).root;

    buttonsIn(root, uiCopy.panels.cards)[0]?.click();

    expect(insertCard).toHaveBeenCalledWith(CARD_LIBRARY[0]?.id);
  });

  it("refuses a card button rather than doing nothing when there is no session", () => {
    const editor = editorStub();
    const root = createNewObjectPanel(
      document.body,
      editor as never,
      palette as never,
    ).root;

    // A library button that quietly does nothing is the one failure an author
    // cannot diagnose, so it reports through the same diagnostics as every
    // other construction that refuses.
    buttonsIn(root, uiCopy.panels.cards)[0]?.click();

    expect(editor.errorManager.warn).toHaveBeenCalledWith(
      "controls",
      expect.stringContaining("card library"),
    );
  });

  it("names every card for a screen reader, by its own unit", () => {
    const root = chooser();

    expect(
      buttonsIn(root, uiCopy.panels.cards).map((b) => b.textContent),
    ).toEqual(CARD_LIBRARY.map((unit) => unit.label));
  });
});

describe("a new text object takes the caret", () => {
  it("enters editing after the insert, so the first keystroke lands", async () => {
    // Asking for a text box and then having to double-click it before the first
    // character lands is a second, undiscoverable step: the object appears
    // selected, the status says nothing about editing, and typing after Insert
    // went nowhere.
    const editor = editorStub();
    const created = textWithEditing();
    editor.textManager.addText = vi.fn(
      (): ReturnType<typeof textWithEditing> => created,
    );
    // A fresh insert leaves its object selected, which is the state the guard
    // checks before taking the caret.
    editor.canvas.getActiveObject = vi.fn((): unknown => created);

    insertNewText(editor as never, GLOBALS, { left: 40, top: 40 });
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    expect(editor.textManager.addText).toHaveBeenCalledOnce();
    expect(created.enterEditing).toHaveBeenCalled();
    expect(created.selectAll).toHaveBeenCalled();
  });

  it("does not enter editing an object the author has since changed", async () => {
    // The caret is taken a frame late, because the menu takes focus back for
    // itself as it closes. If the author moved on in that frame, stealing
    // focus from whatever they are now on would be the defect being fixed.
    const editor = editorStub();
    const created = textWithEditing();
    const other = textWithEditing();
    editor.textManager.addText = vi.fn(
      (): ReturnType<typeof textWithEditing> => created,
    );
    editor.canvas.getActiveObject = vi.fn((): unknown => other);

    insertNewText(editor as never, GLOBALS, { left: 40, top: 40 });
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    expect(created.enterEditing).not.toHaveBeenCalled();
  });
});
