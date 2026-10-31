// @vitest-environment jsdom
import { Canvas, Rect, Textbox } from "fabric/es";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accessibleName } from "./accessible-name.js";
import { createArtboardPanel } from "./artboard-panel.js";
import type { EditorShellBridge } from "./editor-shell/bridge.js";
import { CanvasDock } from "./editor-shell/canvas-dock.js";
import { STACK_GLYPH } from "./editor-shell/icons.js";
import { LayerActions } from "./editor-shell/layer-panel.js";
import { DEFAULT_SHELL_PALETTE } from "./editor-shell/palette.js";
import { Pane } from "./editor-shell/pane.js";
import { Rail } from "./editor-shell/rail.js";
import { Settings } from "./editor-shell/settings.js";
import { chooseArtboardSize } from "./new-document-chooser.js";
import { createNewObjectPanel } from "./new-object-panel.js";
import { createPalettePanel } from "./palette-manager/panel.js";
import { createAssetsPane } from "./panes/assets/assets-pane.js";
import { createTokenInspectorPanel } from "./panes/tokens/token-inspector.js";
import { createSelectionInspector } from "./selection-inspector/index.js";
import { createTypeTokenPanel } from "./type-preset-manager/panel.js";
import { uiCopy } from "./ui-copy.js";

// jsdom has never had a `PointerEvent`, and Base UI re-dispatches a click
// through one to carry modifier state — the shim `control.dom.test.tsx` supplies
// for the same reason.
window.PointerEvent ??= MouseEvent as never;

// React only flushes work scheduled inside `act` when it has been told it is in
// a test; without this the modal's first render lands after the assertion.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Every control these panels render has a name a screen reader reads.
 *
 * The panels are audited together because the defect was in all of them and a
 * test per panel would let the next unnamed control in be a new finding rather
 * than a red test. The names themselves are checked by name in the panels' own
 * tests; what is checked here is the invariant, so a new field added without
 * one fails here.
 *
 * The audit grew from three panels to four when vg-103's fix reached the chart
 * settings section and the very next control written beside it — the vertical
 * text alignment select — shipped with no `id` at all. vg-103's own test walked
 * one section's controls, so the shape of the fix was "a section", and a
 * control written tomorrow in a different section was nobody's red test.
 *
 * **Adding a panel to the editor means adding it to `mountPanels` below.** That
 * is the whole limit of this file, and it was invisible until vg-114: the asset
 * pane and the new-theme chooser had gone years without appearing here, so a
 * control written in either was nobody's red test. The list is the contract —
 * an unmounted panel is not audited, not "audited and clean".
 */

/** The elements a person can focus, so the audit is over what they can reach. */
const FOCUSABLE = "a[href],button,input,select,textarea,[tabindex]";

/** The form controls among them, which are the ones an id or a label points at. */
const FIELDS = "input,select,textarea";

/**
 * Whether a person can reach this at all, which is the audit's premise.
 *
 * `[hidden]` is `display: none`, and a browser puts no such element in the
 * accessibility tree — it cannot be focused, and it is not announced. Measured
 * in Chromium over the Add pane's file section: the tree holds `combobox "Asset"`,
 * `button "Import a file"`, `button "Replace asset"`, `button "Remove asset"` and
 * the alert, and **neither** `<input type="file">` is in it, though the markup
 * has both. They are the two file pickers the Import and Replace buttons drive,
 * and the buttons are named and audited here.
 *
 * So naming them would mean a `<label for>` pointing at something nobody can
 * reach — a control that passes this audit by being absent from the product.
 * Hiding a control to escape it removes it from the author's reach as surely;
 * that is what `[hidden]` means, and it is one escape worth naming rather than
 * pretending the audit is absolute.
 *
 * `aria-hidden="true"` is the **second spelling of that same fact**, and it is
 * how Base UI renders the value carrier behind a control it paints itself:
 * `tabIndex: -1` and `aria-hidden: true` by construction, one per primitive
 * that keeps a real form value behind a styled surface — the input a select
 * submits its value through (`@base-ui/react/select/root/SelectRoot.mjs`) and
 * the checkbox a switch keeps its checked state in
 * (`@base-ui/react/switch/root/SwitchRoot.mjs`). It is **not** a blanket "Base
 * UI hides its inputs": Base UI's slider is the counter-example, and the
 * `input[type=range]` it renders is the control a person operates, so it is
 * named and audited here (`control-slider.tsx`).
 *
 * A carrier is hidden by `clip-path`, not by `[hidden]`, so it is in the markup
 * and in no accessibility tree: unfocusable and unannounced, exactly what the
 * file pickers are. The Tokens pane's five selects — the paint section's kind
 * and reassignment, and the selected type token's family, weight and
 * reassignment choosers — the run
 * editor's five — its
 * four selects and its swatch, which is `SelectControl` with an adornment — the
 * inspector's three paint selects and its three toggles are what this exclusion is
 * for; naming them would create the `<label for>` pointing at nothing this
 * comment already refuses.
 *
 * Neither exclusion is a hole, and the sibling test is why: every element this
 * predicate skips is enumerated in "names every skipped element", so a control
 * that looks away is a line somebody has to read and agree with, rather than a
 * gap the audit passes over in silence.
 */
const reached = (element: HTMLElement): boolean =>
  !element.hidden && element.getAttribute("aria-hidden") !== "true";

/** The elements a `<label for>` may name. `output` is one of them. */
const LABELABLE = "button,input,meter,output,progress,select,textarea";

afterEach(async () => {
  // React schedules follow-up work through a macrotask; unmounting and then
  // letting that task run is what keeps it from firing after the worker has
  // torn the jsdom environment down, where it reads `window` and throws.
  await act(async () => {
    settingsRoot?.unmount();
    chromeRoot?.unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  settingsRoot = undefined;
  chromeRoot = undefined;
  localStorage.clear();
  document.body.replaceChildren();
});

describe("editor panels", () => {
  it("gives every control an accessible name", () => {
    const { root } = mountPanels();
    const unnamed = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter(reached)
      .filter((element) => accessibleName(element) === "")
      .map(identity);
    expect(unnamed).toEqual([]);
  });

  it("leaves no label naming nothing", () => {
    const { root } = mountPanels();
    const dangling = Array.from(root.querySelectorAll("label"))
      .filter((label) => {
        if (label.htmlFor !== "") return label.htmlFor === "";
        return label.querySelector(LABELABLE) === null;
      })
      .map((label) => label.textContent ?? "");
    expect(dangling).toEqual([]);
  });

  it("names each control by a label that holds nothing else", () => {
    // The one rule that separates a label which is *legitimately* unassociated
    // from one that is associated by containment and should not be. A label
    // with no `for` names the first labelable element inside it, and it is
    // named by its own text content — so a second element left inside it joins
    // the control's accessible name, whether or not that element is labelable.
    //
    // Measured on the live run editor: the Format field was announced as
    // "Format 04:38 Tokens: YYYY YY · MMMM MMM MM M · dddd ddd · DD D · HH H
    // hh h · mm ss · A a. Words in [square brackets]." — a live clock and a
    // whole vocabulary, read as the field's name, changing every minute. The
    // preview is a `<span>` and the vocabulary a `<p>`, neither of them
    // labelable, so counting labelable descendants would have passed it.
    //
    // So this is not "every label needs an `htmlFor`". A `<legend>`, a group
    // heading and a label wrapping exactly one control are all fine — and a
    // control's own children do not count, because the platform reads a
    // `<select>`'s options as its value rather than as the label's words.
    const { root } = mountPanels();
    const crowded = Array.from(root.querySelectorAll("label"))
      .filter((label) => label.htmlFor === "")
      .filter((label) => {
        const children = [...label.children];
        return (
          children.length > 1 ||
          (children[0] !== undefined && !children[0].matches(LABELABLE))
        );
      })
      .map((label) => identity(label));
    expect(crowded).toEqual([]);
  });

  it("leaves no two controls sharing one id", () => {
    // The run editor renders the same fields once per run, so a positional id
    // would collide and the second control's label would name the first.
    const { root } = mountPanels();
    const seen = new Map<string, number>();
    for (const element of root.querySelectorAll<HTMLElement>("[id]")) {
      seen.set(element.id, (seen.get(element.id) ?? 0) + 1);
    }
    expect([...seen].filter(([, n]) => n > 1)).toEqual([]);
  });

  it("gives every form control an id, so no field here is reachable only by position", () => {
    // Form controls, not buttons: a button is named by its own text and is
    // found by role and name, while a field is the thing a `<label for>` and an
    // `aria-labelledby` have to point at. vg-103 fixed one section and the
    // vertical text alignment select written beside it a moment later still
    // shipped with none, because the test walked the section rather than the
    // editor.
    const { root } = mountPanels();
    const anonymous = Array.from(
      root.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >(FIELDS),
    )
      .filter(reached)
      .filter((control) => control.id === "")
      .map(identity);
    expect(anonymous).toEqual([]);
  });

  it("names every skipped element, so the audit's blind spot stays named", () => {
    // `reached` is the one place this file looks away, and a carve-out nobody
    // can see is how an audit rots. Enumerating them keeps it honest in both
    // directions: one more skipped control is a decision someone has to take,
    // and an empty list means a panel stopped being mounted — the exact failure
    // vg-114 recorded, where the asset pane and the chooser had never been here
    // at all.
    //
    // Both shapes are in here, and the list is longer than it was for two
    // reasons: the run editor's converted selects (its swatch included) and the
    // inspector's own paint selects and toggles. `INPUT[type=file]` is
    // `[hidden]`, and an `aria-hidden` input is a Base UI value carrier — a
    // select's submitted value (`INPUT[type=][aria-hidden]`) or a switch's
    // checked state (`INPUT[type=checkbox][aria-hidden]`) — never one a person
    // can focus. The exact set is pinned below, one comment per control, so a
    // primitive that starts hiding something new is a line to read.
    const { root } = mountPanels();
    const skipped = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((element) => !reached(element))
      .map(
        (element) =>
          `${element.tagName}[type=${element.getAttribute("type") ?? ""}]${
            element.getAttribute("aria-hidden") === "true"
              ? "[aria-hidden]"
              : ""
          }`,
      );
    expect(skipped).toEqual([
      // The Document pane's four, and it leads the list because it is the first
      // thing in `root` that renders one. The artboard panel was imperative
      // until Task 8, so its natives were not skipped at all; every control on it
      // is `ControlSelect` now, and each is a Base UI value carrier. It held
      // three more until the background's colour, media and fit moved to the
      // inspector's own column.
      "INPUT[type=][aria-hidden]", // Theme language
      "INPUT[type=][aria-hidden]", // Ratio
      "INPUT[type=][aria-hidden]", // Orientation
      "INPUT[type=][aria-hidden]", // Resolution
      // The selected type token's inspector, mounted after the palette pane:
      // its family and weight choosers, each a `ControlSelect`'s value carrier.
      // Its reassignment chooser is not here because it is not on screen: the
      // box is revealed by the first Delete press and starts empty,
      // so nothing before that point can reach it.
      "INPUT[type=][aria-hidden]", // Family (token)
      "INPUT[type=][aria-hidden]", // Weight (token)
      // The paint section of the same inspector, after the preset section: its
      // kind switch, and the gradient editor's fifteen preset rows (each a Base
      // UI `Radio`'s value carrier, mounted because `glow` is a gradient). Its
      // reassignment chooser waits for a Delete press the same way.
      "INPUT[type=][aria-hidden]", // Paint kind
      "INPUT[type=radio][aria-hidden]", // Vital Ocean
      "INPUT[type=radio][aria-hidden]", // Kale Salad
      "INPUT[type=radio][aria-hidden]", // Disco Club
      "INPUT[type=radio][aria-hidden]", // Shady Lane
      "INPUT[type=radio][aria-hidden]", // Retro Wagon
      "INPUT[type=radio][aria-hidden]", // Fresco Crush
      "INPUT[type=radio][aria-hidden]", // Cucumber Water
      "INPUT[type=radio][aria-hidden]", // Sea Salt
      "INPUT[type=radio][aria-hidden]", // Par Four
      "INPUT[type=radio][aria-hidden]", // Ooey Gooey
      "INPUT[type=radio][aria-hidden]", // Bloody Mimosa
      "INPUT[type=radio][aria-hidden]", // Lovely Lilly
      "INPUT[type=radio][aria-hidden]", // Aqua Spray
      "INPUT[type=radio][aria-hidden]", // Mello Yellow
      "INPUT[type=radio][aria-hidden]", // Dusty Cactus
      // The run editor's five: four `ControlSelect`s and one `ControlSwatch`,
      // which is `SelectControl` with an adornment — each a Base UI select's
      // value carrier.
      "INPUT[type=][aria-hidden]", // Type token (run)
      "INPUT[type=][aria-hidden]", // Colour (ControlSwatch)
      "INPUT[type=][aria-hidden]", // Reads
      "INPUT[type=][aria-hidden]", // Unit display
      "INPUT[type=][aria-hidden]", // Zone
      // The shape's three paint selects: `ControlSelect` again.
      "INPUT[type=][aria-hidden]", // Fill
      "INPUT[type=][aria-hidden]", // Stroke
      "INPUT[type=][aria-hidden]", // Shadow
      // The inspector's one toggle. It was three: deliberate bleed on both
      // mounts, which went with its mark, and frosted
      // glass on the shape alone. The text run's frost toggle is gone with its
      // section — a `Textbox` cannot be frosted, so `vg-465` offers it no glass
      // section at all rather than a switch that writes nothing.
      "INPUT[type=checkbox][aria-hidden]", // Frosted glass, shape
      // The Assets pane's two file pickers, `[hidden]` and driven by the Import
      // and Replace controls. The declared-asset chooser that used to sit ahead
      // of them was a `ControlSelect`; the list is a card per file now, so it
      // renders no value carrier.
      "INPUT[type=file]", // Import
      "INPUT[type=file]", // Replace
      // The new-theme chooser, mounted as the session opens it: a `Dialog`, and
      // four `ControlSelect`s between its two focus guards — the display, and
      // the ratio, orientation and resolution behind Custom — each a Base UI
      // value carrier.
      "SPAN[type=][aria-hidden]", // The chooser's leading focus guard
      "INPUT[type=][aria-hidden]", // Display
      "INPUT[type=][aria-hidden]", // Ratio
      "INPUT[type=][aria-hidden]", // Orientation
      "INPUT[type=][aria-hidden]", // Resolution
      "SPAN[type=][aria-hidden]", // The chooser's trailing focus guard
      // The settings modal's focus-trap sentinels, and the only pair here that
      // belongs to a library rather than to us: `FloatingFocusManager` renders
      // one `span` before the popup and one after it, `tabindex="0"` on purpose
      // — they are what catches a Tab trying to leave the popup — and
      // `aria-hidden` so no reader announces them. Named rather than filtered
      // silently, and asserted as a pair below.
      "SPAN[type=][aria-hidden]", // The modal's leading focus guard
      "SPAN[type=][aria-hidden]", // The modal's trailing focus guard
    ]);

    // And the `aria-hidden` exclusion is earned rather than assumed. The
    // attribute alone is not the fact that puts something out of reach —
    // `tabIndex: -1` is, and Base UI sets both on a value carrier. A component
    // of ours that put `aria-hidden` on something an author can still focus
    // would be a control this audit stopped looking at, so that is asserted
    // here rather than read off the source and hoped for.
    //
    // The dialogs' focus guards are the one exception, and they are the
    // library's: both are `tabindex="0"` and `aria-hidden="true"` by
    // construction, which is the trap working rather than a control that has
    // looked away. Asserted as exactly those four — one pair per open `Dialog`,
    // the chooser's and the modal's — so a third dialog, or a third
    // `aria-hidden` focusable of ours, fails here.
    const hiddenFocusable = Array.from(
      root.querySelectorAll<HTMLElement>('[aria-hidden="true"]'),
    ).filter((element) => element.tabIndex >= 0);
    expect(
      hiddenFocusable.map((element) =>
        element.hasAttribute("data-base-ui-focus-guard")
          ? `guard:${element.getAttribute("data-type")}`
          : element.outerHTML.slice(0, 60),
      ),
    ).toEqual(["guard:inside", "guard:inside", "guard:inside", "guard:inside"]);
  });

  it("names the release version, which no form control owns", () => {
    const { root } = mountPanels();
    const version = root.querySelector("[data-yunari-theme-version]")!;
    expect(accessibleName(version)).toBe("Release version");
  });

  it("names every output, because an output announces itself", () => {
    // `output` is a live region: it speaks without being focused, so an
    // unnamed one is a status line with no subject.
    const { root } = mountPanels();
    const unnamed = Array.from(root.querySelectorAll("output"))
      .filter((element) => accessibleName(element) === "")
      .map((element) => element.outerHTML.slice(0, 60));
    expect(unnamed).toEqual([]);
  });

  it("names the gradient editor's stop handles, which the token inspector reaches", () => {
    // The census that also mounts the editor excludes these by its glyph clause
    // — a drag handle draws no glyph — so this audit is the only place their
    // names are read, and only for as long as the token inspector mounts the
    // editor for its gradient paint. Pinned so the mount going quiet is a red
    // case rather than the gap `vg-333` found.
    const { root } = mountPanels();
    const handles = Array.from(
      root.querySelectorAll<HTMLElement>("[data-testid^='gradient-stop-']"),
    );
    expect(handles.map((handle) => accessibleName(handle))).toEqual([
      uiCopy.panels.stopPosition(1),
      uiCopy.panels.stopPosition(2),
    ]);
  });

  it("mounts the token inspector, so the fields it adds are audited", () => {
    // An entry in `mountPanels` that renders nothing is the same vacuity the
    // file's header warns about, so this reads the controls back rather than
    // trusting the mount: an unroled token renders family, weight and Delete —
    // the reassignment select arrives only after a Delete press. This is the
    // token section; `mountPanels` mounts the paint section as a second
    // inspector, after it.
    const { root } = mountPanels();
    const inspector = root.querySelector("[data-yunari-token-inspector]");
    expect(inspector).not.toBeNull();
    const controls = Array.from(
      inspector?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
    ).filter(reached);
    expect(controls).toHaveLength(3);
    expect(controls.map((control) => accessibleName(control))).not.toContain(
      "",
    );
  });
});

/**
 * The panels this file audits, mounted at once: the artboard panel, the palette
 * panel, the type preset panel, the token inspector's two sections (a preset and
 * a paint), the selection inspector on two disjoint field
 * sets, the Add pane, the new-theme chooser and the Settings modal — and, since
 * plan 6 Task 4, the shell's own React chrome: the rail, the pane's chrome with
 * its action footer, and the canvas dock (`mountShellChrome`, which is also
 * where the reason the Composition tree is *not* among them is written down).
 *
 * Each in a state that shows every field it can render: a gradient with stops,
 * a font picker, a delete control, and a text object with a run bound to a
 * clock — the inspector's richest selection, and the one that reaches the
 * format and zone fields nothing else does.
 *
 * The gradient with stops is `components/ui/gradient-editor.tsx`, and the
 * palette panel is what reaches it: selecting the `glow` token below renders the
 * editor, so its two stop handles are controls this audit names (`vg-333`). It
 * is not mounted a second time here — a duplicate would be one more control
 * with the same name, not wider coverage.
 *
 * **This list is the coverage.** An editor panel that is not mounted here is
 * not audited, and the assertions below pass on it by never seeing it — which
 * is how two file inputs and three dropdowns went unaudited until vg-114 named
 * them. Mount a panel when it is written; do not read a green run here as
 * "the editor is clean".
 *
 * The returned root is `document.body` rather than the mounting, because the
 * Settings modal is a `Dialog` and Base UI portals it to the body: the audit
 * has to read where the modal is, or it audits the six panels and passes over
 * the twenty rows of the reference the author actually edits.
 */
function mountPanels(): { root: HTMLElement } {
  const root = document.createElement("div");
  document.body.append(root);

  createArtboardPanel(root, () => undefined, {
    onMetadataChange: () => undefined,
  }).render(
    { width: 1280, height: 720 },
    { name: "Living Room", version: "1.2.3", themeLanguage: "en" },
  );

  createPalettePanel(root, () => undefined).render({
    none: { name: "None", value: { kind: "solid", color: "transparent" } },
    accent: { name: "Accent", value: { kind: "solid", color: "#00b8d9" } },
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
  });

  createTypeTokenPanel(
    root,
    () => undefined,
    () => undefined,
    {
      applyFace: async () => undefined,
      applyTrio: async () => undefined,
    },
  ).render({
    body: { family: "Inter" },
    caption: { family: "Inter" },
  });

  // The selected token's own column. An unroled token, because its editable
  // family and weight are the controls a bound form replaces with Unbind, and
  // the role rows draw no reassignment-and-delete pair.
  const tokenPresets = {
    body: { family: "Inter" },
    caption: { family: "Inter" },
  };
  createTokenInspectorPanel(root, {
    onChange: () => undefined,
    onDelete: () => undefined,
    unbindFace: () => undefined,
    // A declared face, so the weight row is the select the session's own
    // `facesOf` draws rather than the read-only fallback.
    facesOf: () => [{ assetId: "inter-400", weight: 400, style: "normal" }],
    paints: undefined,
  }).render({ kind: "preset", id: "caption" }, tokenPresets, {
    typeTokens: tokenPresets,
  });

  // The paint half of the token inspector, in its own section: the gradient
  // branch renders the track, its two stop handles and the two wells, which a
  // solid token does not. Mounted after the preset section so the inspector
  // case below reads that one's controls.
  const paintPalette = {
    glow: {
      name: "Glow",
      value: {
        kind: "gradient" as const,
        angle: 45,
        stops: [
          { offset: 0, color: "#ffffff" },
          { offset: 1, color: "#000000" },
        ],
      },
    },
  };
  createTokenInspectorPanel(root, {
    onChange: () => undefined,
    onDelete: () => undefined,
    unbindFace: () => undefined,
    paints: {
      palette: () => paintPalette,
      onChange: () => undefined,
      onDelete: () => undefined,
      usage: undefined,
    },
  }).render({ kind: "paint", id: "glow" }, {}, undefined);

  mountSelectionInspector(root);

  // The Add pane draws only the insert tiles now; the declared files and their
  // import live in the Assets pane, so the audit has to read both panes.
  const editor = {
    canvas: {
      add: vi.fn(),
      setActiveObject: vi.fn(),
      requestRenderAll: vi.fn(),
      getObjects: () => [],
    },
    artboard: () => ({ width: 1280, height: 720 }),
    historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
    textManager: { addText: vi.fn() },
    errorManager: { warn: vi.fn(), error: vi.fn() },
  } as never;
  createNewObjectPanel(root, editor, undefined, undefined);
  createAssetsPane(root, {
    editor,
    manager: {
      declarations: [
        { id: "hero", kind: "image", path: "assets/hero.png" },
        { id: "clip", kind: "video", path: "assets/clip.mp4" },
      ],
      previewUrl: () => "blob:hero",
      placeImage: vi.fn(async () => undefined),
      remove: vi.fn(() => false),
      import: vi.fn(async () => ({
        id: "new",
        kind: "image",
        path: "a.png",
      })),
      replace: vi.fn(async () => undefined),
      hydrate: vi.fn(async () => undefined),
      subscribe: vi.fn(() => () => {}),
    } as never,
    isReferenced: () => false,
    onFontCommit: async () => ({ ok: true, message: "" }),
  });

  // The new-theme chooser, opened as the session opens it: a `Dialog`, so it is
  // portalled to `body` and audited through the body the caller returns, and
  // every control on it is a `ControlSelect` or a `ControlPair` value carrier.
  act(() => {
    void chooseArtboardSize({ width: 1280, height: 720 });
  });

  mountShellChrome(root);

  mountSettings();

  return { root: document.body };
}

/**
 * The shell's own React chrome, which this audit had been reading past: the
 * rail, the Composition pane's chrome with the action footer `shell-layout`
 * gives it, and the canvas dock.
 *
 * They are mounted as themselves rather than through `shell-layout`, because
 * the shell is assembled from imperative hosts and this file is where a control
 * gets named — the three carry the shell's icon-only buttons (four rail slots
 * and the gear, the pane footer's object actions, the dock's two halves), and
 * each draws its own button rather than `ControlIconButton`, which is exactly
 * the shape an audit that walked one panel would miss.
 *
 * The pane's body is a stand-in. What the tree *inside* it renders is
 * `composition-pane.tsx`'s own surface, and its treeitems are named from their
 * content, which is the one mechanism `accessibleName` reads for buttons alone;
 * mounting the tree here would report it as unnamed for a reason that is about
 * the reader rather than about the panel.
 */
function mountShellChrome(root: HTMLElement): void {
  const bridge = {
    snapshot: () => ({ selectedCount: 1, locked: false, activeKind: "object" }),
    target: () => ({
      kind: "object",
      locked: false,
      memberCount: 1,
      isGroup: false,
    }),
    canArrange: () => false,
    subscribe: () => () => undefined,
    run: vi.fn(),
  } as unknown as EditorShellBridge;
  const host = document.createElement("div");
  root.append(host);
  const reactRoot = createRoot(host);
  chromeRoot = reactRoot;
  act(() => {
    reactRoot.render(
      createElement(
        Fragment,
        null,
        createElement(Rail, {
          slot: "composition",
          collapsed: false,
          onChoose: () => undefined,
          onOpenSettings: () => undefined,
        }),
        createElement(Pane, {
          id: "layers",
          title: uiCopy.panels.layers,
          icon: STACK_GLYPH,
          footer: createElement(LayerActions, { bridge }),
          children: createElement("div", null),
        }),
        createElement(CanvasDock, { bridge }),
      ),
    );
  });
}

let chromeRoot: Root | undefined;

let settingsRoot: Root | undefined;

/**
 * The Settings modal, open on the Keyboard tab.
 *
 * The modal is a `Dialog`, so it is portalled to `body` and is audited through
 * the body the caller returns. Base UI mounts only the *active* tab panel, so
 * the Keyboard tab is clicked after mount: without that click the modal renders
 * the six palette rows and the twenty action rows of the reference — every
 * arm button, every per-row Reset and Reset all — are in no tree at all, which
 * is exactly the audit gap vg-114's comment describes.
 *
 * The Appearance tab's six rows and its follow toggle are the same modal and
 * are driven by `settings.dom.test.tsx`; this mount is the Keyboard tab because
 * that is where the controls nothing else names live.
 */
function mountSettings(): void {
  const host = document.createElement("div");
  document.body.append(host);
  const reactRoot = createRoot(host);
  settingsRoot = reactRoot;
  act(() => {
    reactRoot.render(
      createElement(Settings, {
        open: true,
        onOpenChange: () => undefined,
        storage: localStorage,
        palette: DEFAULT_SHELL_PALETTE,
        following: true,
        onPalette: () => undefined,
        onFollowing: () => undefined,
        overrides: {},
        onOverrides: () => undefined,
        // The About tab's fact is irrelevant to the accessible-name audit, and
        // the Keyboard tab it does open carries no version; the document this
        // mounts carries none.
        releaseVersion: undefined,
      }),
    );
  });
  const keyboard = Array.from(
    document.querySelectorAll<HTMLElement>('[role="tab"]'),
  ).find((tab) => tab.textContent?.trim() === uiCopy.settings.keyboard);
  if (keyboard === undefined) throw new Error("no Keyboard tab in the modal.");
  act(() => {
    keyboard.click();
  });
}

/**
 * The selection inspector, on a text object whose one run reads a clock, and on
 * a shape.
 *
 * A shape and a text object render disjoint field sets — panel material and a
 * corner radius against runs, layout and bindings — so the audit needs both.
 * One canvas and one inspector each, rather than two renders of one: `render()`
 * clears the panel it rebuilds, and two inspectors on one canvas would both
 * follow the selection to whichever object was made active last.
 */
function mountSelectionInspector(root: HTMLElement): void {
  const text = new Textbox("", { id: "clock-label" });
  text.set("yunariText", {
    align: "centre",
    verticalAlign: "middle",
    box: { width: 140, height: 27 },
    runs: [{ kind: "value", bindingId: "clock-time" }],
  });
  const shape = new Rect({ left: 0, top: 0, width: 40, height: 20 });
  shape.set("yunariGlass", { blurRadius: 16 });

  for (const selection of [text, shape]) {
    const canvas = new Canvas(document.createElement("canvas"));
    canvas.add(selection);
    canvas.setActiveObject(selection);
    const editor = {
      canvas,
      historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
      errorManager: { warn: vi.fn(), error: vi.fn() },
      cropManager: { active: false, target: undefined },
      artboard: () => ({ width: 1920, height: 1080 }),
    };
    const globals = {
      palette: {
        ink: { name: "Ink", value: { kind: "solid", color: "#ffffff" } },
      },
      typeTokens: {
        body: { name: "Body", value: { family: "Inter", size: 16 } },
      },
    };

    const host = document.createElement("div");
    root.append(host);
    createSelectionInspector(host, {
      editor: editor as never,
      globals: globals as never,
      nodeBindings: () => [{ id: "clock-time", semanticKey: "date.today" }],
      refreshGlass: vi.fn(),
    });
  }
}

/** A stable handle for the failure message: the attribute the panel is found by. */
function identity(element: HTMLElement): string {
  const data = Object.entries(element.dataset).find(
    ([, value]) => value === "",
  );
  return data === undefined
    ? element.outerHTML.slice(0, 60)
    : `[data-${data[0]}]`;
}
