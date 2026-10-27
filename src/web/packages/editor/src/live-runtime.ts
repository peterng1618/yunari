import type {
  Binding,
  FabricGlobals,
  SampleSource,
  SemanticKeyDescriptor,
} from "@yunari/renderer-core";
import { applyAuthoredText, refreshBoundText } from "@yunari/scene-fabric";
import type { StaticCanvas } from "fabric/es";
import { toAuthoringSegments } from "./run-placeholder.js";

/**
 * How often the sample pass repaints text.
 *
 * The fastest cadence any bound value can change at is a clock, and a clock
 * changes once a second. A reading that changes once a second was being
 * re-measured thirty times a second, across every text object in the document,
 * and the text pass is the expensive half of the repaint rather than the chart
 * half. 4 Hz is four times the fastest signal, so a clock's second boundary is
 * never missed and is at most 250 ms late, and it is well above the rate at
 * which a changing digit can be read — a value visible for a quarter of a
 * second is unambiguous, one visible for 33 ms is a blur.
 */
const SAMPLE_TEXT_INTERVAL_MS = 250;

/** Runtime samples update Fabric objects without becoming authored editor state. */
export class LiveRuntime {
  readonly #canvas: StaticCanvas;
  #bindings: Readonly<Record<string, readonly Binding[]>>;
  #source: SampleSource;
  #globals: FabricGlobals | undefined;
  #themeLanguage: string | undefined;
  /** Read per repaint: the catalogue replaces its list when a refresh lands. */
  #descriptors: (() => readonly SemanticKeyDescriptor[]) | undefined;
  /** Read per repaint: the artboard can change while the session is open. */
  #artboardHeight: (() => number) | undefined;
  /** Set by every input a repaint resolves against; cleared by the repaint. */
  #authoredDue = true;
  #lastSampleMs: number | undefined;
  readonly #now: () => number;

  constructor(options: {
    readonly canvas: StaticCanvas;
    readonly bindings?: Readonly<Record<string, readonly Binding[]>>;
    readonly source: SampleSource;
    readonly globals?: FabricGlobals;
    readonly themeLanguage?: string;
    /** The editor catalogue, so a custom descriptor's unitKind converts. */
    readonly descriptors?: () => readonly SemanticKeyDescriptor[];
    /** The artboard height, read at paint time so a size change follows it. */
    readonly artboardHeight?: () => number;
    /** Injectable so a test can hold the loop still; wall clock otherwise. */
    readonly now?: () => number;
  }) {
    this.#canvas = options.canvas;
    this.#bindings = options.bindings ?? {};
    this.#source = options.source;
    this.#globals = options.globals;
    this.#themeLanguage = options.themeLanguage;
    this.#descriptors = options.descriptors;
    this.#artboardHeight = options.artboardHeight;
    this.#now = options.now ?? (() => Date.now());
  }

  /**
   * One object's authoring view — its value runs as tokens.
   *
   * Fabric enters inline editing on the first click's mouse-up, not on the
   * double-click, so the object is already editing by the time an author asks
   * for this. Both refresh passes skip an editing object — that is what keeps a
   * keystroke from being repainted away — so the flag is taken down for the one
   * call that paints it and put straight back. Nothing is rendered between them.
   */
  showAuthoringView(object: { isEditing: boolean }): void {
    const editing = object.isEditing;
    object.isEditing = false;
    try {
      applyAuthoredText(this.#canvas, this.#globals, {
        bindings: this.#bindings,
        transform: toAuthoringSegments,
        only: (candidate) => candidate === object,
        ...(this.#artboardHeight === undefined
          ? {}
          : { artboardHeight: this.#artboardHeight() }),
      });
    } finally {
      // A throw here must not leave Fabric believing the object is not editing,
      // which would strand the caret and the 30 fps skip that protects it.
      object.isEditing = editing;
    }
    // The loop's own copy of the authored pass is what restores every other
    // object after an inline edit, and an edit is a change to authored content
    // that arrives without passing a setter.
    this.#authoredDue = true;
    this.#canvas.requestRenderAll();
  }

  setSource(source: SampleSource): void {
    this.#source = source;
    this.refresh();
  }

  setBindings(bindings: Readonly<Record<string, readonly Binding[]>>): void {
    this.#bindings = bindings;
    // What a bound run paints is decided by its binding, so changing one must
    // repaint rather than wait for the next sample.
    this.refresh();
  }

  setGlobals(globals: FabricGlobals | undefined): void {
    if (globals === this.#globals) return;
    this.#globals = globals;
    // Deliberately not a `refresh`, and that is what makes it work. A palette
    // drag is the reason: the session hands new globals to every owner through
    // one fan-out (`editor-document.ts`'s `#globalsChanged`), and not one of them
    // repaints text, so this pass is the only thing that shows the canvas
    // recolouring as the saturation square is dragged. Marking it due rather than
    // repainting here keeps that within a frame of the pointer without repainting
    // on every one of them.
    this.#authoredDue = true;
  }

  setThemeLanguage(themeLanguage: string | undefined): void {
    if (themeLanguage === this.#themeLanguage) return;
    this.#themeLanguage = themeLanguage;
    // The language decides the words a clock paints, so changing it must repaint
    // rather than wait for the next sample. `setGlobals` above deliberately does
    // not refresh; this one must, because nothing else is scheduled to.
    this.refresh();
  }

  /**
   * Repaint every text object now, because something changed.
   *
   * The change-driven half, and what every setter above calls. A repaint asked
   * for is owed in full and at once, which is why this is not the method the
   * loop calls — `tick` is the same repaint on a slower clock.
   */
  refresh(): void {
    this.#authoredDue = false;
    this.#paintAuthored();
    this.#paintSample();
    this.#lastSampleMs = this.#now();
    this.#canvas.requestRenderAll();
  }

  /**
   * The refresh loop's own call.
   *
   * Separate from `refresh` only in *when* it runs, never in what it does. The
   * scene loop is a fixed 30 fps (0129), and a chart that is animating does not
   * make a clock's seconds change any faster, so the repaint is on the reading's
   * cadence instead, and the canvas is not asked to render at all until then: an
   * unchanged scene re-rendered is thirty identical pictures a second, and the
   * charts request their own render when they move (`chart-manager/index.ts`).
   *
   * **One interval, not two.** `applyAuthoredText` repaints every object from
   * its authored runs, and a value run with no sample resolves to its
   * placeholder; `refreshBoundText` is what puts the reading back. Give each
   * pass its own cadence and every bound object on the canvas flashes to its
   * placeholder between them, four times a second. They are halves of one
   * repaint, so `refresh` runs whole or not at all.
   */
  tick(): void {
    const now = this.#now();
    if (
      !this.#authoredDue &&
      !due(now, this.#lastSampleMs, SAMPLE_TEXT_INTERVAL_MS)
    ) {
      return;
    }
    this.refresh();
  }

  /** Authored content, which a token pass overwrites and this pass restores. */
  #paintAuthored(): void {
    // Both passes must repaint every text object: a token pass overwrites an
    // unbound object's text, so switching back has to restore it even though
    // `refreshBoundText` only handles objects a sample resolves. The object
    // being edited inline is the one exception, and both passes make it.
    //
    // A token is the *editing* view, never a canvas mode: `showAuthoringView`
    // paints it on the object about to be typed into, and this pass is what
    // puts the reading back when that edit ends.
    applyAuthoredText(this.#canvas, this.#globals, {
      bindings: this.#bindings,
      ...(this.#artboardHeight === undefined
        ? {}
        : { artboardHeight: this.#artboardHeight() }),
    });
  }

  #paintSample(): void {
    refreshBoundText(
      this.#canvas,
      this.#bindings,
      this.#source,
      this.#globals,
      undefined,
      this.#themeLanguage,
      this.#descriptors?.(),
      this.#artboardHeight?.(),
    );
  }
}

/** Unmeasured yet, or long enough ago that what it painted may have moved. */
function due(nowMs: number, lastMs: number | undefined, intervalMs: number) {
  return lastMs === undefined || nowMs - lastMs >= intervalMs;
}
