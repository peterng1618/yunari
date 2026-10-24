import {
  CHART_FAMILIES,
  type ChartFamily,
  type FabricGlobals,
} from "@yunari/renderer-core";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { AssetManager } from "./asset-manager/index.js";
import { CARD_LIBRARY, type CardDiagram } from "./card-library.js";
import type { EditorInteraction } from "./editor-interaction.js";
import {
  createNewShape,
  createNewTextDefaults,
  nextNewObjectPlacement,
  SHAPE_KINDS,
  type ShapeKind,
} from "./new-object-defaults.js";
import { AddPane } from "./panes/add/add-pane.js";
import { FileSection } from "./panes/add/file-section.js";
import type { TextPlacement } from "./text-manager/index.js";
import { uiCopy } from "./ui-copy.js";

export interface NewObjectPanel {
  readonly root: HTMLElement;
  setGlobals(globals: FabricGlobals | undefined): void;
  /**
   * Releases the panel: unmounts the React tree, then removes its host node.
   *
   * Both halves, in that order. The tree's effects own resources outside the
   * node — each glyph-led tile registers a tooltip whose dismissal is a
   * `document`-level `pointerdown` (`editor-shell/controls/tooltip.ts:134`), and
   * only `unmount()` runs the cleanup that removes it. Removing the node alone
   * was complete disposal while this panel was hand-built DOM; it strands twelve
   * listeners now, once per session teardown. `shell-layout.tsx`'s own
   * `destroy()` is the precedent for the release path.
   */
  destroy(): void;
}

export interface NewObjectActions {
  /**
   * Arms the session's one placement gesture. The tile does not construct: the
   * pointer, not the menu, decides whether this is a Text or a Text box and
   * where it lands, and an object made here would appear before that decision.
   */
  readonly addText: () => void;
  readonly addChart: (family: ChartFamily) => void;
  /**
   * Inserts one card as a unit. The session owns this because the copy's
   * readings are envelope state, and a panel that made its own would hold a
   * second copy of what the next save writes.
   *
   * Returns nothing rather than a promise: the session reports a refusal
   * itself, so every surface that dispatches a card is told once, and this
   * panel's `constructing` has no rejection left to report a second time.
   */
  readonly insertCard: (cardId: string) => void;
}

/**
 * The Add pane's file path: the declared-asset library the Assets pane used to
 * be. The session owns every part of it, so the pane is handed the manager and
 * the two ports rather than building any of them.
 */
export interface NewObjectAssets {
  readonly manager: AssetManager;
  /** Told the declarations moved, so the document's own panels re-resolve. */
  readonly changed: () => void;
  /** The envelope-side references no object carries — the artboard's background
   *  media and a type preset's face. */
  readonly isReferenced: (assetId: string) => boolean;
  /** Opens the finder. The modal is the shell's, so the session hands this port
   *  down rather than the panel inventing a second entry path. */
  readonly onFindAssets?: () => void;
}

/** One object an author can insert, named as the control that inserts it. */
export type InsertableObject =
  | { readonly kind: "text"; readonly label: string }
  | {
      readonly kind: "shape";
      readonly label: string;
      readonly shape: ShapeKind;
    }
  | {
      readonly kind: "chart";
      readonly label: string;
      readonly family: ChartFamily;
    }
  | {
      readonly kind: "card";
      readonly label: string;
      readonly card: string;
      /** Which diagram the Add pane's tile draws, read from the unit. */
      readonly diagram: CardDiagram;
    };

/** One heading's worth of them. A heading is what makes "Line" unambiguous. */
export interface InsertGroup {
  /**
   * The kind every object in the group is — a group is homogeneous by
   * construction, because that is what merges one. **This is the group's
   * identity, and the heading is not:** the pane scopes a group by it
   * (`data-yunari-add-group`), and a scope derived from the heading would move
   * the day an author's copy did, which is what the hook exists to stop
   * (`vg-211`).
   */
  readonly kind: InsertableObject["kind"];
  /** The heading, or undefined for an object that stands on its own. */
  readonly label: string | undefined;
  readonly objects: readonly InsertableObject[];
}

/**
 * Everything an author can insert, grouped as the Add pane shows it. **The one
 * owner of that list:** the pane's fieldsets and the canvas context menu both
 * render this, because two lists that must agree and do not is how a panel —
 * the object this composition is mostly made of — came to be missing from one
 * surface while the other had it.
 *
 * **Units and primitives are both here, and neither is a fallback for the
 * other.** The card library is the fast path for the common case and the
 * primitives are the tool for the case nobody anticipated, which is the case
 * this product is for (§77, §139). Dropping either is a decision, not a
 * simplification — the test that pins both sections is what makes it one.
 */
export function insertGroups(): readonly InsertGroup[] {
  const objects: readonly InsertableObject[] = [
    ...CARD_LIBRARY.map((unit) => ({
      kind: "card" as const,
      label: unit.label,
      card: unit.id,
      diagram: unit.diagram,
    })),
    { kind: "text", label: uiCopy.panels.text },
    ...SHAPE_KINDS.map((shape) => ({
      kind: "shape" as const,
      label: uiCopy.shapeKinds[shape],
      shape,
    })),
    ...CHART_FAMILIES.map((family) => ({
      kind: "chart" as const,
      label: uiCopy.chartFamilies[family],
      family,
    })),
  ];

  const groups: InsertGroup[] = [];
  for (const object of objects) {
    const { kind } = object;
    const label = groupOf(object);
    const last = groups[groups.length - 1];
    // Merged by kind rather than by heading: the heading is copy, and two
    // groups drawn under one word would be one group.
    if (last !== undefined && last.kind === kind) {
      groups[groups.length - 1] = {
        kind,
        label,
        objects: [...last.objects, object],
      };
    } else {
      groups.push({ kind, label, objects: [object] });
    }
  }

  return groups;
}

/** The heading a group is drawn under, or undefined where its object stands
 *  alone. The heading is not the group's identity — `kind` is. */
function groupOf(object: InsertableObject): string | undefined {
  switch (object.kind) {
    case "text":
      return undefined;
    case "card":
      return uiCopy.panels.cards;
    case "shape":
      return uiCopy.panels.shapes;
    case "chart":
      return uiCopy.panels.charts;
  }
}

/** A text object, placed where the gesture ended and named by the class the
 *  gesture asked for. */
export function insertNewText(
  editor: EditorInteraction,
  globals: FabricGlobals | undefined,
  placement: TextPlacement,
): void {
  const content = "New text";
  const text = editor.textManager.addText({
    text: content,
    ...createNewTextDefaults(globals, content, placement, placement.box),
  });
  // The caret, so typing goes somewhere. Asking for a text box and then having
  // to double-click it before the first character lands is a second, undiscoverable
  // step: the object appears selected, the status says nothing about editing, and
  // a keystroke after Insert went nowhere at all. Every editor this product is
  // measured against puts you in the text as soon as you ask for a text box.
  // Deferred a frame, because the menu this was opened from takes focus back
  // for itself as it closes — entering synchronously put the caret in and then
  // lost it, which is the same defect in a different costume.
  requestAnimationFrame(() => {
    if (editor.canvas.getActiveObject() !== text) return;
    text.enterEditing();
    text.selectAll();
  });
}

/**
 * A shape, added through the canvas as one history entry and left selected.
 * Shared with the canvas context menu so the two surfaces cannot insert
 * different objects under the same name.
 */
export function insertNewShape(
  editor: EditorInteraction,
  globals: FabricGlobals | undefined,
  kind: ShapeKind,
): void {
  // The id is the stable key bindings, the schema path and the envelope carry,
  // so it names the kind the button made. F1.8 gave the *display* the right
  // name and an author never sees the id, which is exactly why a circle keyed
  // `panel-…` survived: nobody reading the screen sees it.
  const inserted = createNewShape(
    `${kind}-${crypto.randomUUID()}`,
    globals,
    kind,
    nextNewObjectPlacement(editor),
  );
  editor.canvas.add(inserted);
  editor.canvas.setActiveObject(inserted);
  editor.historyManager.saveState();
  editor.canvas.requestRenderAll();
}

/**
 * Runs a construction that refuses when the theme has no reference to give it —
 * a palette without a usable token or type presets without a body. Reported
 * through the editor's own diagnostics, because a throw out of a click handler
 * leaves the author with a button that silently does nothing.
 *
 * **Exported, and the one owner of a construction's refusal** (`vg-484`). Two
 * surfaces construct outside this pane — the layer footer and the canvas context
 * menu — and neither can report a refusal itself: the footer's `bridge.run` arm
 * and the menu's `creationGroups` both hold a `void`, so the throw reached
 * nobody and the control silently did nothing. The session façade delegates
 * every construction here rather than growing a second catcher, so the words are
 * this function's wherever a construction is dispatched from.
 *
 * This pane's own `insertObject` still routes through it, for the chart arm
 * (`ChartManager.addChart` throws its own refusal) and for the two "needs the
 * editor session" wiring refusals below. A card's own refusal is reported by the
 * session, which owns it, so there is nothing here for this to report twice.
 */
export function constructing(
  editor: EditorInteraction,
  build: () => void | Promise<void>,
): void {
  const report = (error: unknown): void => {
    editor.errorManager.warn(
      "controls",
      error instanceof Error ? error.message : String(error),
    );
  };
  try {
    void Promise.resolve(build()).catch(report);
  } catch (error) {
    report(error);
  }
}

/**
 * One object, constructed. The pane routes every tile here rather than holding
 * its own switch, so the eligibility gates, the refusals and the wrapper above
 * stay in the module that owns the list.
 *
 * One construction each — the card library owns what a card is, the defaults
 * module owns what a new shape is, and the canvas and history the editor
 * already exposes own where it lands and how it is recorded.
 */
export function insertObject(
  editor: EditorInteraction,
  globals: FabricGlobals | undefined,
  actions: NewObjectActions | undefined,
  object: InsertableObject,
): void {
  constructing(editor, () => {
    switch (object.kind) {
      case "text": {
        const addText = actions?.addText;
        // The same refusal the card path makes: the placement state belongs to
        // the session, and a tile that armed nothing would be silent.
        if (addText === undefined) {
          throw new Error(
            "Text placement needs the editor session that owns the text manager.",
          );
        }
        return addText();
      }
      case "shape":
        insertNewShape(editor, globals, object.shape);
        return;
      case "card": {
        const insert = actions?.insertCard;
        // Refused rather than ignored: a library tile that quietly does nothing
        // is the one failure an author cannot diagnose.
        if (insert === undefined) {
          throw new Error(
            "The card library needs the editor session that owns the document's bindings.",
          );
        }
        return insert(object.card);
      }
      case "chart": {
        const chart = actions?.addChart;
        // The same refusal the card path makes, for the same reason: with
        // `actions?.addChart(…)` this was the one tile in the pane that could
        // swallow its own dispatch — a chart tile that quietly did nothing is
        // the failure an author cannot diagnose.
        if (chart === undefined) {
          throw new Error(
            "The chart families need the editor session that owns the document's charts.",
          );
        }
        return chart(object.family);
      }
    }
  });
}

/** Yunari creates semantic text while the editor retains generic construction and history. */
export function createNewObjectPanel(
  host: HTMLElement,
  editor: EditorInteraction,
  globals: FabricGlobals | undefined,
  actions?: NewObjectActions,
  assets?: NewObjectAssets,
): NewObjectPanel {
  // Read at construction time rather than captured by the render, so a theme
  // edit that arrives through `setGlobals` reaches the next insertion — the
  // contract the imperative panel had, and the reason this is a box rather than
  // a prop React would have to re-render for.
  const current: { globals: FabricGlobals | undefined } = { globals };
  const root = document.createElement("section");
  // No `data-yunari-panel` and no heading here: the pane that mounts this panel
  // owns the name and the title bar, and a second element under either is a
  // strict-mode failure for every locator that browses by it.
  host.append(root);

  const reactRoot: Root = createRoot(root);
  // Flushed, so a caller that reads the pane straight after building it sees
  // the tiles rather than the empty frame before React's first commit.
  flushSync(() => {
    reactRoot.render(
      createElement(
        AddPane,
        {
          groups: insertGroups(),
          onInsert: (object) =>
            insertObject(editor, current.globals, actions, object),
        },
        // The file path sits at the foot, inside the pane `Pane` already named:
        // `§5.2` puts the declared-asset library in Add, and a second surface
        // under its own name is what this task removes.
        assets === undefined
          ? null
          : createElement(FileSection, {
              manager: assets.manager,
              editor,
              changed: assets.changed,
              isReferenced: assets.isReferenced,
              ...(assets.onFindAssets === undefined
                ? {}
                : { onFindAssets: assets.onFindAssets }),
            }),
      ),
    );
  });

  return {
    root,
    setGlobals(nextGlobals) {
      current.globals = nextGlobals;
    },
    destroy() {
      reactRoot.unmount();
      root.remove();
    },
  };
}
