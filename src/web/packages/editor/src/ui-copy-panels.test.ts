// @vitest-environment jsdom
/**
 * The copy net over the imperative panels and the picker they mount: every word
 * they show comes from `uiCopy`, or is data — a token's name, a locale's, an
 * asset's, a preset's.
 *
 * **What this half reads.** The artboard, palette and type-preset panels are
 * read for their own DOM, and the font picker — a React island the type-preset
 * panel mounts, so the panels' net never reaches it — is mounted here directly.
 * The palette's paint kinds and both unit display lists are read from the Base
 * UI popups their triggers open, because a closed control prints the chosen
 * value rather than the words it offers.
 *
 * **What it deliberately does not read, and why.** A control that prints a
 * *value* is read for the concept and not the reading: a select's trigger shows
 * the chosen token or unit, and a token well the document's own name. Most
 * option text is data — a token's name, a locale's, an asset's, a preset's, a
 * face's family — and is deliberately not covered; the paint kinds are copy and
 * are listed by name.
 *
 * The table's own rules are `ui-copy.test.ts`, and the landed React surfaces —
 * the shell, the Settings modal, the colour picker, the selection column, the
 * opened menus and the canvas context menu — are `ui-copy-surfaces.test.ts`.
 */
import { Canvas, Textbox } from "fabric/es";
import { act, createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { createArtboardPanel } from "./artboard-panel.js";
import {
  ChartContentFields,
  type ChartEdits,
  ChartPaintFields,
} from "./chart-manager/chart-fields.js";
import {
  type ChartFieldTarget,
  chartContentView,
  chartPaintView,
} from "./chart-manager/panel.js";
import { catalogFaces, fontTrios } from "./font-catalog.js";
import { FontPicker } from "./font-picker/font-picker.js";
import { createPalettePanel } from "./palette-manager/panel.js";
import { projectRuns, RunEditor } from "./selection-inspector/runs.js";
import type { RunEdits } from "./selection-inspector/view.js";
import { createTypePresetPanel } from "./type-preset-manager/panel.js";
import { uiCopy } from "./ui-copy.js";
import { copy, spokenText } from "./ui-copy-readers.js";

/** A run-editor write port that records nothing: this file reads copy, not writes. */
function runEdits(): RunEdits {
  return {
    setRunText: () => true,
    setRunPreset: () => true,
    setRunColour: () => true,
    setUnitDisplay: () => true,
    setSource: () => true,
    setFormat: () => true,
    setZone: () => true,
    writeLayout: () => true,
    addRun: () => true,
    removeRun: () => true,
  };
}

/**
 * The three panels say no word the table does not hold.
 *
 * A string literal in a panel is invisible to a reviewer reading `ui-copy.ts`
 * and invisible to the pictograph rule in `ui-copy.test.ts`, which only sees
 * the table. The cost is not the duplication — it is that the words an author
 * reads have no owner, so a rename fixes one surface and silently misses the
 * other.
 *
 * The net is the panels' own rendered labels and buttons, so a literal is
 * caught at the point it is written rather than by a grep that also matches
 * authored theme data. Most option text is data — a token's name, a locale's,
 * an asset's, a preset's — and is deliberately not covered; the paint kinds
 * are copy and are listed by name.
 */
it("leaves the three panels with no copy of their own", async () => {
  const root = document.createElement("div");
  document.body.append(root);

  createArtboardPanel(root, () => undefined, {
    onMetadataChange: () => undefined,
  }).render(
    { width: 1280, height: 720 },
    { name: "Living Room", themeLanguage: "en" },
  );
  const palettePanel = createPalettePanel(
    root,
    () => undefined,
    () => undefined,
  );
  await act(async () => {
    palettePanel.render({
      background: {
        name: "Background",
        value: { kind: "solid", color: "#000" },
      },
      glow: {
        name: "Glow",
        value: {
          kind: "gradient",
          angle: 45,
          stops: [
            { offset: 0, color: "#ffffff" },
            { offset: 1, color: "#000000" },
          ],
        },
      },
      accent: { name: "Accent", value: { kind: "solid", color: "#0ff" } },
    });
    // The gradient and delete branches, because a solid token renders neither.
    // The token list is React now, so the branch is opened by choosing the row
    // rather than by setting a native `<select>`'s value.
    const glow = root.querySelector<HTMLElement>(
      '[data-yunari-palette-token-row="glow"]',
    );
    if (glow === null) throw new Error("the Tokens pane listed no glow token");
    glow.click();
  });
  createTypePresetPanel(
    root,
    () => undefined,
    () => undefined,
    {
      preview: async () => undefined,
      applyFace: async () => undefined,
      applyTrio: async () => undefined,
    },
  ).render({
    body: { name: "Body", value: { family: "Inter", size: 16 } },
    caption: { name: "Caption", value: { family: "Inter", size: 12 } },
  });

  // The palette's paint kinds, which are copy. They live in a Base UI popup that
  // exists only while it is open, so they are read the way an author reads them.
  // The other option lists in these panels are data — a token's name, a locale's,
  // an asset's, a preset's — and are deliberately not covered.
  const paintKinds = await openUnitDisplayOptions(
    root,
    "[data-yunari-palette-kind]",
  );
  // Non-vacuous, and said with a number. `openUnitDisplayOptions` returns an
  // empty list when its selector matches nothing, so without this the read above
  // could cover nothing at all — and because a select's trigger is excluded from
  // the button net, a hard-coded kind word would then go uncovered too. Two is
  // what the pane offers (`solid`, `gradient`), read off the opened list.
  expect(paintKinds).toHaveLength(2);
  const owned = new Set(copy());
  const spoken = [
    ...Array.from(root.querySelectorAll("label"), (label) => label.textContent),
    // Two kinds of button are excluded, both because their text is data. A token
    // well prints the document's own token name and usage figure; a select's
    // trigger prints the chosen value, which on every panel here is a token's
    // name, a preset's, a unit's or a locale's — the chevron beside it is
    // decoration. The words a select *offers* are copy and are read from its
    // open list, so excluding the closed control loses nothing.
    ...Array.from(root.querySelectorAll("button"))
      .filter(
        (button) =>
          button.getAttribute("data-yunari-palette-token-row") === null &&
          button.querySelector("[data-yunari-value]") === null,
      )
      .map((button) => spokenText(button)),
    ...paintKinds,
  ]
    .map((text) => text?.trim() ?? "")
    // The release version's and the language sample's values are readings, not
    // copy: one is the document's own version, the other the platform's spelling
    // of a date in the chosen language.
    .filter((text) => text !== "" && !/^[\d.v-]+$/.test(text));
  expect(spoken.filter((text) => !owned.has(text))).toEqual([]);

  // This test mounts three panels that nothing unmounts, and the paint-kind list
  // it opened portals into `document.body`. Left standing, that popup is the next
  // test's `[role="option"]` set — read as four extra unit-display words.
  await act(async () => palettePanel.destroy());
  document.body.replaceChildren();
});

/**
 * The font picker says no word the table does not hold.
 *
 * The picker is a React island the type-preset panel mounts, so the net above —
 * which reads the three imperative panels' DOM — does not reach it. A string
 * literal in `font-picker.tsx` would therefore be invisible to the rule that
 * exists to catch exactly that, which is why the picker is mounted here
 * directly rather than waiting for the panel that will host it.
 *
 * Data is excluded on purpose, the way it is above: a face's family name, a
 * trio's name and an upstream facet value are the catalogue's words, not this
 * component's. The facet values in particular are the tags Fonttrio assigned,
 * and they round-trip into the query, so a test that demanded the table own
 * "versatile (107)" would be demanding the table own the catalogue.
 */
it("leaves the font picker with no copy of its own", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  const reactRoot = createRoot(root);
  await act(async () =>
    reactRoot.render(
      createElement(FontPicker, {
        trios: fontTrios(),
        faces: catalogFaces(),
        favorites: [],
        // A cache that never loads, so every row renders its "still coming"
        // note: the note is copy, and a specimen that arrived would hide it.
        cache: {
          ensure: () => new Promise<void>(() => undefined),
          resident: () => undefined,
          release: () => undefined,
        },
        onApplyTrio: () => undefined,
        onApplyFace: () => undefined,
        onToggleFavorite: () => undefined,
      }),
    ),
  );

  const owned = new Set(copy());
  const spoken = [
    // Labels and their accessible names: the search field, the three facets,
    // the sort, the trio chooser, and the two states of the favourite toggle.
    // A converted chooser's own words are here: the facet's "any" entry is the
    // row's label, so the closed control prints the table's word and no second
    // read is needed.
    ...Array.from(root.querySelectorAll("label"), (label) => label.textContent),
    ...Array.from(root.querySelectorAll("[aria-label]"), (element) =>
      element.getAttribute("aria-label"),
    ),
    // The picker's own buttons, minus the rows whose text is a catalogue name
    // and the choosers' triggers, whose text is the value they print — a face's
    // family, a trio's name — plus the control set's own `▼`.
    ...Array.from(root.querySelectorAll("button"))
      .filter(
        (button) =>
          !button.hasAttribute("data-yunari-font-face-row") &&
          !button.hasAttribute("data-yunari-font-trio-row") &&
          button.querySelector("[data-yunari-value]") === null,
      )
      .map((button) => button.textContent),
  ]
    .map((text) => text?.trim() ?? "")
    .filter((text) => text !== "" && !/^[\d.v-]+$/.test(text));
  expect(spoken.filter((text) => !owned.has(text))).toEqual([]);
  reactRoot.unmount();
});

/** The two states of the favourite toggle name two different actions, so a
 *  screen reader can tell what the press will do. Pinned here beside the copy
 *  rule rather than only in the picker's own test because both words have to
 *  come from the table for the rule above to mean anything. */
it("names both states of the favourite toggle", () => {
  expect(uiCopy.panels.fontFavorite).not.toBe(uiCopy.panels.fontUnfavorite);
  for (const word of [
    uiCopy.panels.fontFavorite,
    uiCopy.panels.fontUnfavorite,
  ]) {
    expect(/\p{S}/u.test(word)).toBe(false);
  }
});

/**
 * The four unit display words have one owner, in both panels that offer them.
 *
 * Scoped to these four on purpose. Both panels carry dozens more literals —
 * "Precision", "Start angle", "Rounded ends" and the rest of the chart panel's
 * fields — and folding them into the net above would be F1.25's row, not this
 * one's. What vg-113 moved was four words that were written twice with nothing
 * joining them, and this is the net under that much and no more.
 *
 * The number is load-bearing too: eight is four options in two panels, so a
 * control that stopped rendering takes this red rather than emptying the set.
 */
it("gives the unit display options one owner, in both panels that offer them", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  // One control at a time: both are selects whose list lives in a portal, and a
  // read has to see its own four rather than the previous control's four beside
  // them. The chart's own host is unmounted before the run panel is mounted.
  const offered = [
    ...(await chartUnitDisplayOptions(root)),
    ...(await runUnitDisplayOptions(root)),
  ];
  const owned = new Set(copy());
  expect(offered).toHaveLength(8);
  expect(offered.filter((text) => !owned.has(text))).toEqual([]);
});

/**
 * The four words a control offers, read from the list its trigger opens.
 *
 * Both controls are Base UI selects now, so their options exist in the DOM only
 * while the popup is open. Reading them any other way would read the table the
 * list is built from and agree with itself.
 */
async function openUnitDisplayOptions(
  host: HTMLElement,
  selector: string,
): Promise<string[]> {
  const trigger = host.querySelector<HTMLElement>(selector);
  if (trigger === null) return [];
  await act(async () => {
    trigger.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
  await act(async () => {
    for (let round = 0; round < 3; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')].map(
    (option) => option.textContent ?? "",
  );
}

/** The chart panel's four, read from a chart the owner projects and a stage that
    is unmounted again so the run panel's list is the only one open. */
async function chartUnitDisplayOptions(root: HTMLElement): Promise<string[]> {
  const gauge: ChartFieldTarget = {
    id: "gauge",
    content: {
      family: "gauge",
      settings: {
        startAngle: 90,
        endAngle: -270,
        min: 0,
        max: 100,
        thickness: 10,
        track: { kind: "solid", color: "#000" },
        progress: { kind: "solid", color: "#fff" },
        roundCap: true,
      },
    },
    bindings: [{ id: "g", semanticKey: "ram.used.percent" }],
  };
  // The words are what this file reads; the writes go nowhere.
  const edits: ChartEdits = {
    onSettings: () => {},
    onBinding: () => {},
    onAspect: () => {},
    onAddBinding: () => {},
    onRemoveBinding: () => {},
  };
  const host = document.createElement("div");
  root.append(host);
  const chartRoot = createRoot(host);
  flushSync(() => {
    chartRoot.render([
      createElement(ChartContentFields, {
        key: "content",
        view: chartContentView(gauge),
        edits,
      }),
      createElement(ChartPaintFields, {
        key: "paint",
        view: chartPaintView(gauge, undefined),
        edits,
      }),
    ]);
  });

  const offered = await openUnitDisplayOptions(
    host,
    "[data-yunari-binding-field$='.unitDisplay']",
  );
  await act(async () => {
    chartRoot.unmount();
  });
  host.remove();
  return offered;
}

/**
 * The run panel's four, from the one state that renders its control.
 *
 * A value run on a reading is the only state that renders it; a literal run has
 * no reading to take a unit off.
 */
async function runUnitDisplayOptions(root: HTMLElement): Promise<string[]> {
  const canvas = new Canvas(document.createElement("canvas"));
  const object = new Textbox("", { id: "clock-label" });
  object.set("yunariText", {
    align: "left",
    runs: [{ kind: "value", bindingId: "clock-time" }],
  });
  canvas.add(object);

  let bindings: readonly { id: string; semanticKey: string }[] = [
    { id: "clock-time", semanticKey: "date.today" },
  ];
  const host = document.createElement("div");
  root.append(host);
  const runRoot = createRoot(host);
  const runs = projectRuns(object as never, "clock-label", {
    globals: undefined,
    locale: undefined,
    nodeBindings: () => bindings,
    sampleSource: () => ({ latest: () => undefined, history: () => [] }),
    swatchValue: () => undefined,
  });
  if (runs !== undefined) {
    flushSync(() =>
      runRoot.render(createElement(RunEditor, { runs, edits: runEdits() })),
    );
  }
  return openUnitDisplayOptions(host, "[data-yunari-run-unit-display]");
}
