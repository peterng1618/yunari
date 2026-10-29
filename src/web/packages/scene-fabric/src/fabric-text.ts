import type {
  Binding,
  FabricGlobals,
  PlanBox,
  PlanNode,
  PlanTextLayout,
  PlanTextSegment,
  ResolvedStyle,
  SampleSource,
  SemanticKeyDescriptor,
  TextContent,
  TextRun,
  UnitPreferences,
} from "@yunari/renderer-core";
import { emptySampleSource, resolveTextSegments } from "@yunari/renderer-core";
import {
  FabricText,
  Group,
  IText,
  Rect,
  type StaticCanvas,
  Textbox,
  type TextProps,
} from "fabric/es";
import {
  applyClip,
  assertBox,
  authoredBox,
  boxFrom,
  guardBoxWidth,
  placeInBox,
  scaleOf,
  withLineCapacity,
} from "./authored-box.js";
import { paintFor } from "./paint.js";
import { placementFor } from "./placement.js";
import { textShapeFor } from "./text-runs.js";

/**
 * The Fabric class is the width mode: `Textbox` wraps inside a fixed width,
 * `IText` measures its own. Fabric has no vertical alignment/overflow box, so
 * placement, clipping and ellipsis are handled here.
 *
 * A `Textbox` also has no fixed box: `initDimensions` widens it to its longest
 * unbreakable run and never narrows (`fabric/dist/index.mjs:18453`), and
 * `width` is one of its `textLayoutProperties` (`:18760`), so every width write
 * re-enters that. The author's box therefore lives on the object as authored
 * content and is re-asserted here; see.
 */

/** Fabric's typings make `Textbox` incompatible with `FabricText` under exact optional types. */
export type PlanTextObject = FabricText | Textbox;

/** Fabric property that preserves authored text semantics without a parallel scene tree. */
export const YUNARI_TEXT_PROPERTY = "yunariText";

const YUNARI_TEXT_LAYOUT_PROPERTY = "yunariTextLayout";
const ELLIPSIS = "…";

type RuntimeTextLayout = Readonly<{
  readonly box: PlanBox;
  readonly layout: PlanTextLayout;
  readonly style: PlanNode["style"];
}>;

/**
 * Fabric's own flag.
 *
 * `IText` and not `Textbox`, because that is what the editor's double-click
 * guard admits: an unwrapped object is still an `IText` and is still editable,
 * so restricting this to `Textbox` would leave an object the author can type
 * into being repainted from a sample underneath the caret.
 */
function isEditing(object: PlanTextObject): boolean {
  return object instanceof IText && object.isEditing;
}

/** Marks a `Textbox` whose line origin has been made to follow `verticalAlign`. */
const VERTICAL_ALIGNED = Symbol.for("yunari.textVerticalAlign");

/** The alignment each guarded object currently paints with. */
const verticalAlignOf = new WeakMap<object, PlanTextLayout["verticalAlign"]>();

/**
 * Move the type inside a fixed box, the way the authored vertical alignment asks.
 *
 * Fabric draws every line from the top of the object, and a `Textbox` in this
 * renderer is the authored box on both axes (`assertBox`), so `placeInBox` has
 * no slack to move it through: the object's height already is the box. The
 * renderer's own line origin is the one place Fabric asks where the first line
 * starts (`_getTopOffset`, `fabric/dist/index.mjs:15850`), so the slack between
 * the box and the measured text is added there. Installed as an instance method
 * rather than a fork of `Textbox`: everything else about the measurement,
 * wrapping and clipping stays Fabric's.
 */
function applyVerticalAlign(
  object: PlanTextObject,
  verticalAlign: PlanTextLayout["verticalAlign"],
): void {
  if (!(object instanceof Textbox)) {
    // An unwrapped object is its own measurement, so `placeInBox` already moves
    // it inside the box on both axes.
    return;
  }

  if (!(VERTICAL_ALIGNED in object)) {
    const base = (
      object as unknown as { _getTopOffset(): number }
    )._getTopOffset.bind(object);
    Object.defineProperty(object, "_getTopOffset", {
      configurable: true,
      value: () => {
        const align = verticalAlignOf.get(object) ?? "top";
        if (align === "top") return base();
        const slack = object.height - object.calcTextHeight();
        return base() + (align === "bottom" ? slack : slack / 2);
      },
    });
    Object.defineProperty(object, VERTICAL_ALIGNED, { value: true });
  }

  verticalAlignOf.set(object, verticalAlign);
}

/**
 * The alignment the class implies, with Fabric's fallbacks.
 *
 * The Fabric class owns the width mode: a `Textbox` wraps inside its authored
 * box, an `IText` measures its own width and has nothing to clip. An old
 * document's authored `wrap` (or a box-only key on an auto text) is therefore
 * ignored, never migrated.
 *
 * Split from `runtimeLayout` because the cache below serves the *measured* half
 * of the layout and must not serve this half: an editor control rewrites these
 * into the authored content and then asks the pass to reapply, so reading them
 * from the cache is reading the value the author just replaced.
 */
export function authoredAlignment(
  object: PlanTextObject,
  authored: TextContent,
): PlanTextLayout {
  const wraps = object instanceof Textbox;

  return {
    wrap: wraps,
    overflow: wraps ? (authored.overflow ?? "clip") : "visible",
    align: authored.align ?? "left",
    verticalAlign: wraps ? (authored.verticalAlign ?? "top") : "top",
  };
}

function runtimeLayout(
  object: PlanTextObject,
  authored: TextContent,
): RuntimeTextLayout {
  const saved = object.get(YUNARI_TEXT_LAYOUT_PROPERTY) as
    | RuntimeTextLayout
    | undefined;
  if (saved !== undefined) {
    // The box and the alignment are authored state the author can edit between
    // two passes — `Size`, `Align` and `Vertical text align` all work by
    // rewriting the authored content and calling `applyAuthoredText`. Returning
    // `saved` whole made the object keep the width and placement the control
    // had just replaced, so both are re-read here; only the style and the
    // measured capacity survive from the cache.
    const box = authoredBox(object, authored) ?? saved.box;
    return {
      ...saved,
      box,
      layout: withLineCapacity(
        object,
        box,
        authoredAlignment(object, authored),
      ),
    };
  }

  const scaleX = scaleOf(object.scaleX);
  const scaleY = scaleOf(object.scaleY);
  const clip = object.clipPath;
  const layout = authoredAlignment(object, authored);

  // The authored box first, then the clip that carries it: reading the clip
  // first would make the second pass see whatever the first one measured.
  const fixed = authoredBox(object, authored);
  if (fixed !== undefined) {
    return {
      box: fixed,
      layout: withLineCapacity(object, fixed, layout),
      style: styleFor(object),
    };
  }

  if (clip instanceof Rect) {
    const box = boxFrom(
      object,
      clip.width,
      clip.height,
      clip.left * scaleX,
      clip.top * scaleY,
    );
    return {
      box,
      // A legacy document's clip is the same authored box, so a Textbox holding
      // one has the same line capacity it would have from `yunariText.box`.
      layout: withLineCapacity(object, box, layout),
      style: styleFor(object),
    };
  }

  // Visible text has no clip carrying its authored box. Its old measured edge
  // is enough to reconstruct alignment before runtime text changes its width.
  return {
    box: boxFrom(object, object.width, object.height),
    layout,
    style: styleFor(object),
  };
}

function styleFor(object: PlanTextObject): PlanNode["style"] {
  return {
    color: object.fill,
    fontFamily: object.fontFamily,
    fontSize: object.fontSize,
    fontWeight: object.fontWeight,
    lineHeight: object.lineHeight,
  };
}

export function isTextObject(object: object): object is PlanTextObject {
  return object instanceof FabricText;
}

export function buildText(node: PlanNode, box: PlanBox): PlanTextObject {
  if (node.content.kind !== "text") {
    throw new Error("buildText received a non-text node.");
  }

  const placement = placementFor(box);
  const common: Partial<TextProps> = {
    ...paintFor(node.style, "text"),
    originX: "center" as const,
    originY: "center" as const,
    textAlign: node.content.layout.align,
    angle: placement.angle,
    scaleX: placement.scaleX,
    scaleY: placement.scaleY,
  };

  // `applyText` owns text, run styles and measurement-dependent placement.
  const object = node.content.layout.wrap
    ? new Textbox("", { ...common, width: box.width })
    : new IText("", common);

  applyText(object, node, box);
  object.set(YUNARI_TEXT_PROPERTY, node.content.authored);
  object.set(YUNARI_TEXT_LAYOUT_PROPERTY, {
    box,
    layout: node.content.layout,
    style: node.style,
  } satisfies RuntimeTextLayout);

  return object;
}

export function updateText(
  object: PlanTextObject,
  node: PlanNode,
  box: PlanBox,
): void {
  if (node.content.kind !== "text") {
    return;
  }

  const placement = placementFor(box);

  if (object instanceof Textbox) {
    object.set("width", box.width);
  }

  object.set({
    textAlign: node.content.layout.align,
    angle: placement.angle,
    scaleX: placement.scaleX,
    scaleY: placement.scaleY,
  });

  applyText(object, node, box);
  object.set(YUNARI_TEXT_LAYOUT_PROPERTY, {
    box,
    layout: node.content.layout,
    style: node.style,
  } satisfies RuntimeTextLayout);
}

/** Apply sampled values while retaining the authored runs used for persistence. */
/**
 * Reapplies a text object's own authored runs to Fabric, with no source or
 * bindings involved. The editor needs this after an author changes a run: the
 * authored content is what they edited, and Fabric's per-character styles are
 * what they see. `refreshBoundText` cannot serve that case, since it refreshes
 * only objects a sample resolves.
 */
interface ApplyAuthoredTextOptions {
  /**
   * Rewrites resolved segments before they are painted. The editor uses it to
   * show a value run's token while authoring; a display never supplies it, so a
   * token can never reach a screen.
   */
  readonly transform?: (
    segments: readonly PlanTextSegment[],
    runs: readonly TextRun[],
    bindings: readonly Binding[],
    object: PlanTextObject,
  ) => readonly PlanTextSegment[];
  readonly bindings?: Readonly<Record<string, readonly Binding[]>>;
  /**
   * The artboard height, when the caller knows it. A run that authored no size
   * takes the role default it implies, which is the same number the player and
   * the inspector derive.
   */
  readonly artboardHeight?: number;
  /**
   * Narrows the pass to the objects it admits. The editor seeds one object's
   * authoring view on the way into inline editing, and repainting the whole
   * canvas for that would flash every other token for a frame.
   */
  readonly only?: (object: object) => boolean;
}

/**
 * The object's own typography is its first run's, resolved.
 *
 * `fontFamily`, `fontSize` and `fontWeight` also reach Fabric per grapheme, but
 * `charSpacing` and `lineHeight` are whole-object properties Fabric measures
 * once, so a run's tracking can only arrive here. A run that authored no
 * tracking clears the object's, the way the old token field did.
 */
function runTypePaint(
  style: ResolvedStyle | undefined,
): Readonly<Record<string, unknown>> {
  const paint = paintFor(style ?? {}, "text");
  return {
    ...(paint["fontFamily"] === undefined
      ? {}
      : { fontFamily: paint["fontFamily"] }),
    ...(paint["fontSize"] === undefined ? {} : { fontSize: paint["fontSize"] }),
    ...(paint["fontWeight"] === undefined
      ? {}
      : { fontWeight: paint["fontWeight"] }),
    ...(paint["lineHeight"] === undefined
      ? {}
      : { lineHeight: paint["lineHeight"] }),
    charSpacing: paint["charSpacing"] ?? 0,
  };
}

export function applyAuthoredText(
  canvas: StaticCanvas,
  globals: FabricGlobals | undefined,
  options: ApplyAuthoredTextOptions = {},
): void {
  const apply = (objects: readonly object[]): void => {
    for (const object of objects) {
      // An object the author is typing into is Fabric's, for as long as they
      // are: a periodic repaint here would replace the text under the caret
      // every tick. Whichever pass put the token there owns it until the edit
      // ends. A display never edits, so nothing is skipped there.
      const editing = isTextObject(object) && isEditing(object);

      if (isTextObject(object) && !editing) {
        const id = object.get("id");
        const authored = object.get(YUNARI_TEXT_PROPERTY);

        if (
          typeof id === "string" &&
          isTextContent(authored) &&
          (options.only === undefined || options.only(object))
        ) {
          guardBoxWidth(object);
          // Literal runs resolve against globals alone; a value run contributes
          // nothing without a sample, and keeps its authored placeholder. No
          // language is threaded here because nothing that reaches this path can
          // consult one: the empty source resolves no reading to spell.
          const resolved = resolveTextSegments(
            id,
            authored.runs,
            options.bindings?.[id] ?? [],
            {
              source: emptySampleSource,
              ...(options.artboardHeight === undefined
                ? {}
                : { artboardHeight: options.artboardHeight }),
            },
            globals ?? {},
            [],
          );
          const segments =
            options.transform === undefined
              ? resolved
              : options.transform(
                  resolved,
                  authored.runs,
                  options.bindings?.[id] ?? [],
                  object,
                );
          const shape = textShapeFor(segments, {}, (value) =>
            object.graphemeSplit(value),
          );
          // Authored layout belongs to the same content, so reapplying the
          // text must reapply it: alignment lives only here and at construction,
          // and a layout control would otherwise change nothing on screen.
          //
          // **No `initDimensions` after this `set`.** Every key written here is
          // one of Fabric's `textLayoutProperties` (`fabric/dist/index.mjs:4131`),
          // and `Text.set` re-measures on all of them before it returns
          // (`:16295`). A second call measures the identical state again — and
          // the refresh loop runs this pass over every text object in the
          // document thirty times a second, so it was one wasted measure per
          // object per pass for the whole of an idle editor.
          object.set({
            ...runTypePaint(segments[0]?.style),
            text: shape.text,
            styles: shape.styles,
            ...(authored.align === undefined
              ? {}
              : { textAlign: authored.align }),
          });
          // `refreshLayout` restores the box, places by both alignments and
          // clips; it has to follow this last measure, which widens to the
          // longest run and would otherwise be what it reads.
          refreshLayout(object, segments, runtimeLayout(object, authored));
        }
      }

      const children = (
        object as { getObjects?: () => readonly object[] }
      ).getObjects?.();
      if (children !== undefined) apply(children);
    }
  };

  apply(canvas.getObjects());
}

export function refreshBoundText(
  canvas: StaticCanvas,
  bindings: Readonly<Record<string, readonly Binding[]>>,
  source: SampleSource,
  globals: FabricGlobals | undefined,
  units?: UnitPreferences,
  themeLanguage?: string,
  descriptors?: readonly SemanticKeyDescriptor[],
  artboardHeight?: number,
): void {
  let changed = false;
  const refresh = (objects: readonly object[]): void => {
    for (const object of objects) {
      if (isTextObject(object)) {
        const id = object.get("id");
        const authored = object.get(YUNARI_TEXT_PROPERTY);
        if (
          typeof id === "string" &&
          isTextContent(authored) &&
          bindings[id] !== undefined &&
          // The same reason as the authoring pass: the object the author is
          // typing into is not repainted from a sample.
          !isEditing(object)
        ) {
          const segments = resolveTextSegments(
            id,
            authored.runs,
            bindings[id],
            {
              source,
              ...(units === undefined ? {} : { units }),
              ...(themeLanguage === undefined ? {} : { themeLanguage }),
              ...(descriptors === undefined ? {} : { descriptors }),
              ...(artboardHeight === undefined ? {} : { artboardHeight }),
            },
            globals ?? {},
            [],
          );
          const layoutState = runtimeLayout(object, authored);
          const shape = textShapeFor(segments, {}, (value) =>
            object.graphemeSplit(value),
          );
          const paint = runTypePaint(segments[0]?.style);
          // **Only a change to what it paints repaints.** A clock sampled once a
          // second paints its seconds once a second, but a minutes or days clock
          // paints only when its own text moves — the sample cadence is the
          // host's, not the author's. The run's type is compared too: a role
          // default can change while the string stays the same (0128).
          if (
            object.text === shape.text &&
            (authored.align === undefined ||
              object.textAlign === authored.align) &&
            Object.entries(paint).every(
              ([key, value]) =>
                (object as unknown as Record<string, unknown>)[key] === value,
            )
          ) {
            continue;
          }
          changed = true;
          guardBoxWidth(object);
          // Measured by the `set` itself, for the reason given in
          // `applyAuthoredText` above.
          object.set({
            ...paint,
            text: shape.text,
            styles: shape.styles,
            ...(authored.align === undefined
              ? {}
              : { textAlign: authored.align }),
          });
          refreshLayout(object, segments, layoutState);
        }
      }
      if (object instanceof Group) refresh(object.getObjects());
    }
  };

  refresh(canvas.getObjects());
  if (changed) canvas.requestRenderAll();
}

/** Reapply stored authored layout after runtime text changes. */
function refreshLayout(
  object: PlanTextObject,
  segments: readonly PlanTextSegment[],
  state: RuntimeTextLayout,
): void {
  const { box, layout, style } = state;
  if (layout.overflow === "ellipsis" && !fits(object, box, layout)) {
    write(object, ellipsised(object, segments, style, box, layout), style);
  }

  // After the ellipsis rewrite too: that `write` is a `set` and re-enters
  // `initDimensions`, which widens the object to its longest run and re-derives
  // its height from the text — the same thing the pass-level restore exists to
  // undo, one call later. The restore is also what makes the canvas agree: it
  // carries the two caches `_set` would have refreshed, so the selection frame,
  // the snap guides and `arrange` read the box rather than the widened text.
  assertBox(object, box);
  applyVerticalAlign(object, layout.verticalAlign);
  placeInBox(object, box, layout);
  applyClip(object, layout, box);
}

/** Write, measure, overflow-adjust and position text inside its authored box. */
function applyText(object: PlanTextObject, node: PlanNode, box: PlanBox): void {
  if (node.content.kind !== "text") {
    return;
  }

  const { layout, segments } = node.content;

  write(object, segments, node.style);

  if (layout.overflow === "ellipsis" && !fits(object, box, layout)) {
    write(
      object,
      ellipsised(object, segments, node.style, box, layout),
      node.style,
    );
  }

  placeInBox(object, box, layout);
  applyVerticalAlign(object, layout.verticalAlign);
  applyClip(object, layout, box);
}

function isTextContent(value: unknown): value is TextContent {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as Record<string, unknown>)["runs"])
  );
}

/** `initDimensions` must follow text/style changes before alignment uses measurements. */
function write(
  object: PlanTextObject,
  segments: readonly PlanTextSegment[],
  nodeStyle: PlanNode["style"],
): void {
  const shape = textShapeFor(segments, nodeStyle, (value) =>
    object.graphemeSplit(value),
  );

  object.set({ text: shape.text, styles: shape.styles });
  object.initDimensions();
}

/** Wrapped overflow is line-count based; unwrapped ellipsis is width based. */
function fits(
  object: PlanTextObject,
  box: PlanBox,
  layout: PlanTextLayout,
): boolean {
  if (layout.wrap) {
    return (
      layout.maxLines === undefined ||
      object.textLines.length <= layout.maxLines
    );
  }

  return object.width <= box.width;
}

/** Find the longest grapheme prefix that fits when suffixed with an ellipsis. */
function ellipsised(
  object: PlanTextObject,
  segments: readonly PlanTextSegment[],
  nodeStyle: PlanNode["style"],
  box: PlanBox,
  layout: PlanTextLayout,
): readonly PlanTextSegment[] {
  const total = segments.reduce(
    (count, segment) => count + object.graphemeSplit(segment.text).length,
    0,
  );

  let low = 0;
  let high = total;

  while (low < high) {
    const probe = Math.ceil((low + high) / 2);

    write(object, truncate(object, segments, probe), nodeStyle);

    if (fits(object, box, layout)) {
      low = probe;
    } else {
      high = probe - 1;
    }
  }

  return truncate(object, segments, low);
}

function truncate(
  object: PlanTextObject,
  segments: readonly PlanTextSegment[],
  graphemes: number,
): readonly PlanTextSegment[] {
  const kept: PlanTextSegment[] = [];
  let remaining = graphemes;

  for (const segment of segments) {
    if (remaining <= 0) {
      break;
    }

    const parts = object.graphemeSplit(segment.text);

    kept.push(
      parts.length <= remaining
        ? segment
        : { ...segment, text: parts.slice(0, remaining).join("") },
    );

    remaining -= parts.length;
  }

  const last = kept[kept.length - 1];

  if (last === undefined) {
    return [{ ...(segments[0] ?? { text: "", style: {} }), text: ELLIPSIS }];
  }

  kept[kept.length - 1] = { ...last, text: `${last.text}${ELLIPSIS}` };

  return kept;
}

/** Report text treatments the canvas path still cannot express honestly. */
export function textGaps(node: PlanNode): readonly string[] {
  if (node.content.kind !== "text") {
    return [];
  }

  const gaps: string[] = [];
  const { layout } = node.content;

  if (
    layout.overflow === "ellipsis" &&
    layout.wrap &&
    layout.maxLines === undefined
  ) {
    gaps.push(
      "wrapped text cannot be ellipsised without a resolved font size — clipped instead",
    );
  }

  const shape = textShapeFor(node.content.segments, node.style, (value) => [
    ...value,
  ]);

  for (const property of shape.unsupported) {
    gaps.push(
      `"${property}" differs per run, which only a whole object can carry`,
    );
  }

  return gaps;
}
