import {
  type ChartContent,
  type ChartFamily,
  defaultBarSettings,
  defaultGaugeSettings,
  defaultLineSettings,
  defaultPieSettings,
  defaultPolarBarSettings,
  defaultRadarSettings,
  type FabricGlobals,
  type TypeToken,
} from "@yunari/renderer-core";
import {
  type FabricPaintRefs,
  fabricArtboardPaint,
  YUNARI_PAINT_PROPERTY,
  YUNARI_TEXT_PROPERTY,
} from "@yunari/scene-fabric";
import {
  CARD_SURFACE_TOKENS,
  contentPaletteToken,
  SURFACE_TOKENS,
  surfacePaletteToken,
} from "@yunari/theme-kit";
import { BUILTIN_PATH_PRESETS, type PathPreset } from "@yunari/theme-package";
import {
  Ellipse,
  type FabricObject,
  type Gradient,
  Path,
  Polygon,
  Rect,
} from "fabric/es";
import { userPathPreset } from "./path-presets.js";
import { uiCopy } from "./ui-copy.js";

/** Semantic defaults for a new object; generic construction remains editor-owned. */
interface NewPaintDefaults {
  readonly fill: unknown;
  readonly [YUNARI_PAINT_PROPERTY]: FabricPaintRefs;
}

interface NewTextDefaults extends NewPaintDefaults {
  /** What the layer list shows until the author renames it; the id stays the key. */
  readonly name: string;
  /** The authored box of a fixed text. Absent for a Text, which measures its
   *  own ink. */
  readonly box?: { readonly width: number; readonly height: number };
  /** Placement, so a new object does not straddle the artboard corner. */
  readonly left: number;
  readonly top: number;
  /** Artboard coordinates, as `NewPanelDefaults` already sets them, so the
      inspector's X and Y are the text's own edges rather than its middle. */
  readonly originX: "left";
  readonly originY: "top";
  readonly fontFamily: string;
  readonly fontWeight?: string | number;
  readonly [YUNARI_TEXT_PROPERTY]: {
    /** Upright characters, one per line. Absent means ordinary horizontal flow. */
    readonly vertical?: boolean;
    readonly runs: readonly [
      {
        readonly kind: "literal";
        readonly text: string;
        readonly typeToken: `typeTokens.${string}`;
        readonly style: {
          readonly color: { readonly ref: `palette.${string}` };
        };
      },
    ];
  };
}

/** Where a new object is placed, inset from the artboard corner. */
export const NEW_OBJECT_INSET = 40;

/**
 * How far each new object steps from the last, on both axes.
 *
 * Twice the inset, so the second object sits at double the margin and the
 * staircase is unmistakable rather than a rounding error, and a fifth of a new
 * object's width — enough of the one underneath to see and click it. Large
 * enough that twenty columns fit the reference artboard, small enough that a
 * dozen objects do not cross it.
 */
export const NEW_OBJECT_STEP = 80;

/**
 * What a newly inserted object is called until the author renames it: the label
 * of the control that made it. The Add pane already spells every object, so
 * reusing those words is the naming this repo has — and a new object that
 * arrived as a bare uuid would leave the layer list unreadable from the first
 * click, with nothing to tell two panels apart.
 *
 * Every kind the Add pane can insert is covered. A shape excluded here would
 * not fall back to its id but to the panel name, so an ellipse would be listed
 * as a Panel — a second object wearing the first one's name is worse than no
 * name at all.
 */
export function newObjectName(
  kind: "panel" | "text" | "image" | "group" | ChartFamily | ShapeInsertion,
): string {
  if (kind === "text") return uiCopy.panels.text;
  if (kind === "panel") return uiCopy.panels.panel;
  if (kind === "image") return uiCopy.panels.image;
  if (kind === "group") return uiCopy.panels.group;
  if (kind in uiCopy.chartFamilies) {
    return uiCopy.chartFamilies[kind as ChartFamily];
  }
  return uiCopy.shapeKinds[kind as ShapeKind];
}

/** A name for a shape insertion: `line` here is the custom preset, not the
 *  chart family `newObjectName` resolves it to. */
export function newShapeName(kind: ShapeInsertion): string {
  if (isPathPreset(kind)) {
    if (kind.startsWith("user:") || kind.startsWith("pack:")) {
      return userPathPreset(kind)?.label ?? uiCopy.shapeKinds.path;
    }
    return uiCopy.pathPresets[kind as PathPresetId];
  }
  return newObjectName(kind);
}

/** A new panel's size in whole artboard units: a card, not a full artboard. */
export const NEW_PANEL_SIZE = { width: 360, height: 200 } as const;

/** A new panel's corner radius, from the starter theme's own card border. */
const NEW_PANEL_RADIUS = 10;

/** The artboard a new object has to stay inside, and nothing more. */
interface NewObjectArtboard {
  readonly width: number;
  readonly height: number;
}

/** The artboard as the editor sees it *now*. A getter rather than a value because
    the artboard is resizable: a placement computed against the frame the author
    has since replaced is a ladder that no longer ends inside the picture. */
type NewObjectArtboardSource = () => NewObjectArtboard;

/**
 * Where the n-th new object lands: the inset plus n steps, wrapping back to
 * the inset when the next step would carry the object off the artboard.
 *
 * **The one place a new object's position is decided.** The shapes, the text
 * and the charts each carried their own inset, and two kinds of object each
 * believing they own the corner is how three shapes came to stack behind one
 * another — three layer rows, one visible shape, and an inspector reading
 * `Ellipse / X 40 / Y 40` for what the author sees as a rectangle.
 *
 * The step wraps on the **artboard**, not on a count of steps. The artboard is
 * the authored frame and an object outside it is not shown at all, so a ladder
 * that simply kept going would walk its last objects into the letterbox. The
 * two axes wrap independently, because a wide artboard must not let a short one
 * run its ladder off the bottom edge.
 *
 * **Placement at insert time, and nothing more (§67).** The result is written
 * as an ordinary `left`/`top` on the object, so a saved scene carries the
 * coordinates and nothing that says which step produced them: an object
 * inserted second opens at the same place on any machine, with no record that
 * it was the second. Undo restores the object, not the rule.
 */
export function newObjectPlacement(
  index: number,
  artboard: NewObjectArtboard,
): { readonly left: number; readonly top: number } {
  // The ladder is measured against the new object's own footprint, so the last
  // step still lands the whole object inside the frame. A chart is smaller and
  // a text object smaller again, so the largest default is the bound that keeps
  // every one of them on the artboard.
  const stepsAlong = (axis: number, footprint: number): number => {
    const steps =
      Math.floor((axis - NEW_OBJECT_INSET - footprint) / NEW_OBJECT_STEP) + 1;
    return steps < 1 ? 1 : steps;
  };
  const columns = stepsAlong(artboard.width, NEW_PANEL_SIZE.width);
  const rows = stepsAlong(artboard.height, NEW_PANEL_SIZE.height);
  const column = index % columns;
  const row = Math.floor(index / columns) % rows;
  return {
    left: NEW_OBJECT_INSET + column * NEW_OBJECT_STEP,
    top: NEW_OBJECT_INSET + row * NEW_OBJECT_STEP,
  };
}

/** Artboard coordinates, so the inspector's X and Y are the object's edges. */
function placed(placement: { readonly left: number; readonly top: number }): {
  readonly left: number;
  readonly top: number;
  readonly originX: "left";
  readonly originY: "top";
} {
  return { ...placement, originX: "left", originY: "top" };
}

/**
 * Where the next new object lands, read off the editor rather than kept.
 *
 * Both inputs come from the editor itself — the object count from the canvas it
 * is about to join, the frame from the artboard that canvas is a viewport onto
 * — so a caller cannot place an object against a different canvas or a stale
 * artboard than the one it is inserting into. There is no counter to drift out
 * of step with the document: an undo that removes an object shortens the
 * ladder, and the next insert fills the gap it left.
 *
 * Neither input is ever written to the scene, so nothing about the cascade
 * reaches a saved file (§67).
 */
export function nextNewObjectPlacement(editor: {
  readonly canvas: { getObjects(): readonly unknown[] };
  readonly artboard: NewObjectArtboardSource;
}): { readonly left: number; readonly top: number } {
  return newObjectPlacement(
    editor.canvas.getObjects().length,
    editor.artboard(),
  );
}

interface NewPanelDefaults extends NewPaintDefaults {
  /** Narrowed from `NewPaintDefaults`, so a panel goes straight into Fabric's
      own `Rect` constructor without a cast at the call site. */
  readonly fill: string | Gradient<"linear">;
  /** What the layer list shows until the author renames it; the id stays the key. */
  readonly name: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly rx: number;
  readonly ry: number;
  /** Artboard coordinates, so the inspector's X and Y are the panel's edges. */
  readonly originX: "left";
  readonly originY: "top";
}

/**
 * The surface a new shape is filled with, and where it lands. One rule for
 * every kind: a shape an author draws a card on must be as legible as a panel.
 */
function newShapeSurface(
  globals: FabricGlobals | undefined,
  placement: { readonly left: number; readonly top: number },
): Omit<NewPanelDefaults, "width" | "height" | "rx" | "ry" | "name"> {
  const selected = surfacePalette(globals, CARD_SURFACE_TOKENS);
  if (selected === undefined)
    throw new Error("A new shape requires a palette token.");
  const [id, entry] = selected;
  const fill = fabricArtboardPaint(
    entry.value,
    NEW_PANEL_SIZE.width,
    NEW_PANEL_SIZE.height,
  );

  if (fill === undefined)
    throw new Error(`Palette token "palette.${id}" cannot paint a new shape.`);

  return {
    ...placed(placement),
    fill,
    [YUNARI_PAINT_PROPERTY]: { fill: `palette.${id}` },
  };
}

/** Supplies a surface-backed, sized, rounded placement for a new panel. */
export function createNewPanelDefaults(
  globals: FabricGlobals | undefined,
  placement: { readonly left: number; readonly top: number },
): NewPanelDefaults {
  return {
    ...newShapeSurface(globals, placement),
    name: newObjectName("panel"),
    width: NEW_PANEL_SIZE.width,
    height: NEW_PANEL_SIZE.height,
    rx: NEW_PANEL_RADIUS,
    ry: NEW_PANEL_RADIUS,
  };
}

/**
 * The basic geometries Fabric 7 ships, in the order the Add pane offers them.
 * One list: the pane's buttons, the geometry below and the inspector's own
 * fields all read it, so a shape is never described in two places.
 *
 * Custom figures are not kinds of their own. A line, an arc and a sector are
 * all `Path` data, so they live in `PATH_PRESETS` below and arrive as the same
 * class a hand-authored path does.
 */
export const SHAPE_KINDS = ["rect", "ellipse", "polygon", "path"] as const;

export type ShapeKind = (typeof SHAPE_KINDS)[number];

/**
 * The custom shapes the Add pane offers, in the order it offers them. Each is a
 * preset of `Path`: a data string plus which property its paint belongs on.
 * Both the ids and the rows come from `BUILTIN_PATH_PRESETS`, so a builtin the
 * owner gains cannot be silently absent here.
 */
export type PathPresetId = (typeof BUILTIN_PATH_PRESETS)[number]["id"];

export const PATH_PRESET_IDS: readonly PathPresetId[] =
  BUILTIN_PATH_PRESETS.map((preset) => preset.id);

/** A preset the author added in Settings, or one an installed pack carries.
 *  Its label and data live in the live list rather than in this module. */
export type UserPathPresetId = `user:${string}`;

/** A preset an installed pack carries. The prefix keeps one pack's ids from
 *  colliding with another's or with the author's own rows. */
export type PackPathPresetId = `pack:${string}`;

export type CustomShapeId = PathPresetId | UserPathPresetId | PackPathPresetId;

/** Everything that inserts a shape — a basic kind or a custom preset. */
export type ShapeInsertion = ShapeKind | CustomShapeId;

/** Whether an id names a custom shape rather than a basic geometry. */
export function isPathPreset(value: string): value is CustomShapeId {
  return (
    (PATH_PRESET_IDS as readonly string[]).includes(value) ||
    value.startsWith("user:") ||
    value.startsWith("pack:")
  );
}

/**
 * A stroke wide enough to read at artboard scale, and the round caps and joins
 * an open shape's corners need: a miter on a sharp polyline runs a long spike
 * past the point the author placed.
 */
const NEW_SHAPE_STROKE_WIDTH = 2;

/**
 * An open custom shape is stroked rather than filled — a horizontal line and an
 * arc are what they are drawn with — so it takes a content token, which is the
 * palette's own answer to "a colour visible against the surface".
 *
 * A basic path is not one of them. It is filled: `NEW_PATH` closes with `Z`, so
 * a new path arrives as a closed shape and takes the surface like a rect does.
 * The rule is about a shape's *data*, not its class, and a path's closedness is
 * whatever the author types — which is also why `paintPropertyFor` decides from
 * the fill it finds rather than from the kind.
 */
function newShapeStroke(
  globals: FabricGlobals | undefined,
  placement: { readonly left: number; readonly top: number },
): {
  readonly fill: null;
  readonly stroke: string | Gradient<"linear">;
  readonly strokeWidth: number;
  readonly strokeLineCap: "round";
  readonly strokeLineJoin: "round";
  readonly [YUNARI_PAINT_PROPERTY]: { readonly stroke: `palette.${string}` };
} & ReturnType<typeof placed> {
  const [id, entry] = firstPalette(globals);
  const stroke = fabricArtboardPaint(entry.value, 1, 1);

  if (stroke === undefined)
    throw new Error(`Palette token "palette.${id}" cannot paint a new shape.`);

  return {
    ...placed(placement),
    fill: null,
    stroke,
    strokeWidth: NEW_SHAPE_STROKE_WIDTH,
    strokeLineCap: "round",
    strokeLineJoin: "round",
    [YUNARI_PAINT_PROPERTY]: { stroke: `palette.${id}` },
  };
}

/**
 * A hexagon rather than a triangle: a triangle has its own entry, and three is
 * the one side count that cannot show what the side-count field does.
 */
const NEW_POLYGON_SIDES = 6;

/**
 * Evenly spaced corners around a box, scaled to fill it.
 *
 * The one place a shape is described by something other than its points: Fabric
 * 7 dropped `numPoints`, so the count an author edits is recomputed into the
 * corners the scene actually stores — the same thing Fabric 5 did, and the
 * points remain the only persisted truth. Filling the box rather than inscribing
 * a circle in it is what keeps the side count from silently resizing a shape
 * whose width and height the author already set.
 */
export function cornersForSides(
  sides: number,
  width: number,
  height: number,
): { x: number; y: number }[] {
  const unit = Array.from({ length: sides }, (_, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / sides;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  });
  // An even spread never reaches the unit circle on both axes, so each is
  // stretched to the box: a hexagon with a corner at the top is otherwise
  // 86.6 % of the width the author set.
  const reachX = width / (2 * Math.max(...unit.map(({ x }) => Math.abs(x))));
  const reachY = height / (2 * Math.max(...unit.map(({ y }) => Math.abs(y))));
  return unit.map(({ x, y }) => ({
    x: width / 2 + x * reachX,
    y: height / 2 + y * reachY,
  }));
}

/**
 * An arrow, as the SVG data a path is authored in. A path is arbitrary data, so
 * its default is the one shape here that no other entry draws and whose own
 * field is visibly worth editing.
 */
const NEW_PATH = `M 0 ${NEW_PANEL_SIZE.height / 2} L ${NEW_PANEL_SIZE.width / 2} ${NEW_PANEL_SIZE.height / 2} L ${NEW_PANEL_SIZE.width / 2} ${NEW_PANEL_SIZE.height / 4} L ${NEW_PANEL_SIZE.width} ${NEW_PANEL_SIZE.height / 2} L ${NEW_PANEL_SIZE.width / 2} ${(NEW_PANEL_SIZE.height * 3) / 4} L ${NEW_PANEL_SIZE.width / 2} ${NEW_PANEL_SIZE.height} L 0 ${NEW_PANEL_SIZE.height / 2} Z`;

/**
 * The custom shapes, as data. **Nothing here is a class**: each preset
 * constructs Fabric's `Path`, whose SVG data is the only geometry a scene
 * stores, so a future custom shape is another entry rather than a type.
 *
 * The rows come from `BUILTIN_PATH_PRESETS`, the same owner the host stores and
 * the Settings page read; this module only names which ids the Add pane offers.
 */
export const PATH_PRESETS: Readonly<Record<PathPresetId, PathPreset>> = {
  line: builtinPreset("line"),
  arc: builtinPreset("arc"),
  wedge: builtinPreset("wedge"),
};

function builtinPreset(id: PathPresetId): PathPreset {
  const preset = BUILTIN_PATH_PRESETS.find((candidate) => candidate.id === id);
  if (preset === undefined) {
    throw new Error(`The built-in path preset "${id}" is missing.`);
  }
  return preset;
}

/**
 * Constructs one new shape.
 *
 * The class lives here rather than at the click site because Fabric takes a
 * polygon's points and a path's commands as constructor arguments, not as
 * options: seven option bags would be seven wrong calls. Where the object lands
 * and how the edit is recorded stay with the editor.
 */
export function createNewShape(
  id: string,
  globals: FabricGlobals | undefined,
  kind: ShapeInsertion,
  placement: { readonly left: number; readonly top: number },
): FabricObject {
  const { width, height } = NEW_PANEL_SIZE;
  // Beside the id in every branch: a shape the author inserted must be as
  // nameable as a text object, and an unnamed one is listed by its uuid.
  const name = newShapeName(kind);

  switch (kind) {
    case "rect":
      // The panel defaults carry the panel's own name, so this one's wins.
      return new Rect({
        id,
        ...createNewPanelDefaults(globals, placement),
        name,
      });
    case "ellipse":
      // **A circle by default.** There is no Circle kind any more, because a
      // circle was never protected from becoming an ellipse — nothing tied its
      // scales together — so it bought nothing an author could not undo with one
      // number. What it did buy was the common case: a dot, a ring, a chip.
      // So a new ellipse arrives round, and stretching it is one edit away.
      return new Ellipse({
        id,
        name,
        ...newShapeSurface(globals, placement),
        rx: width / 2,
        ry: width / 2,
      });
    case "polygon": {
      // A value rather than a fresh literal: Fabric infers its options type
      // from one, and the inferred type has no room for the authored `id`.
      const options = { id, name, ...newShapeSurface(globals, placement) };
      return new Polygon(
        cornersForSides(NEW_POLYGON_SIDES, width, height),
        options,
      );
    }
    case "path":
      return new Path(NEW_PATH, {
        id,
        name,
        ...newShapeSurface(globals, placement),
      });
    case "line":
    case "arc":
    case "wedge":
      return newPresetShape(id, name, PATH_PRESETS[kind], globals, placement);
    default: {
      const preset = userPathPreset(kind);
      if (preset === undefined) {
        throw new Error(`The path preset "${kind}" is no longer available.`);
      }
      return newPresetShape(id, name, preset, globals, placement);
    }
  }
}

/** One custom shape, drawn as a `Path` with either the ink or the card surface. */
function newPresetShape(
  id: string,
  name: string,
  preset: PathPreset,
  globals: FabricGlobals | undefined,
  placement: { readonly left: number; readonly top: number },
): Path {
  if (preset.paint === "stroke") {
    return new Path(preset.data, {
      id,
      name,
      ...newShapeStroke(globals, placement),
    });
  }
  return new Path(preset.data, {
    id,
    name,
    ...newShapeSurface(globals, placement),
  });
}

/** Supplies valid authored references without making defaults document state. */
export function createNewPaintDefaults(
  globals: FabricGlobals | undefined,
): NewPaintDefaults {
  const ink = newInk(globals);
  return { fill: ink.color, [YUNARI_PAINT_PROPERTY]: { fill: ink.ref } };
}

/** The ink a new content object draws with, resolved and referenced together.
 *
 * Exported because a construct that draws *lines* rather than fills — the
 * finder's imported icons — needs the same choice without a fill in it: two
 * copies of the token preference would paint icons in a colour a new shape
 * never uses. */
export function newInk(globals: FabricGlobals | undefined): {
  readonly color: string | Gradient<"linear">;
  readonly ref: `palette.${string}`;
} {
  const [id, entry] = firstPalette(globals);
  const ref = `palette.${id}` as const;
  const color = fabricArtboardPaint(entry.value, 1, 1);

  if (color === undefined)
    throw new Error(`Palette token "${ref}" cannot paint a new object.`);

  return { color, ref };
}

/** Supplies the paint and per-run typography required by a new text object. A
 *  `box` is the gesture's drag rectangle: it names the object `Text box` and
 *  travels to `addText`, which constructs a `Textbox` from it. `vertical` stacks
 *  its characters upright, one per line, as authored content rather than an
 *  angle, so a dynamic run stacks the same way. */
export function createNewTextDefaults(
  globals: FabricGlobals | undefined,
  text: string,
  placement: { readonly left: number; readonly top: number },
  box?: { readonly width: number; readonly height: number },
  vertical = false,
): NewTextDefaults {
  const paint = createNewPaintDefaults(globals);
  const [id, preset] = firstTypeToken(globals);
  const typeToken = `typeTokens.${id}` as const;
  const color = paint[YUNARI_PAINT_PROPERTY].fill;

  if (color === undefined)
    throw new Error("New text requires a palette reference.");

  return {
    ...paint,
    name: box === undefined ? newObjectName("text") : uiCopy.panels.textBox,
    // Fabric's own default is (0,0), which puts a new object on the artboard
    // corner where it is awkward to select. Charts already start inset; text
    // must too — and from the same cascade, not its own inset.
    ...placed(placement),
    ...(box === undefined ? {} : { box }),
    fontFamily: preset.family,
    ...(preset.weight === undefined ? {} : { fontWeight: preset.weight }),
    [YUNARI_TEXT_PROPERTY]: {
      ...(vertical ? { vertical: true } : {}),
      runs: [
        { kind: "literal", text, typeToken, style: { color: { ref: color } } },
      ],
    },
  };
}

/** Supplies token-backed chart settings without making defaults document state. */
export function createNewChartDefaults(
  globals: FabricGlobals | undefined,
  family: "gauge",
): Extract<ChartContent, { readonly family: "gauge" }>["settings"];
export function createNewChartDefaults(
  globals: FabricGlobals | undefined,
  family: "line",
): Extract<ChartContent, { readonly family: "line" }>["settings"];
export function createNewChartDefaults(
  globals: FabricGlobals | undefined,
  family: "bar",
): Extract<ChartContent, { readonly family: "bar" }>["settings"];
export function createNewChartDefaults(
  globals: FabricGlobals | undefined,
  family: "pie",
): Extract<ChartContent, { readonly family: "pie" }>["settings"];
export function createNewChartDefaults(
  globals: FabricGlobals | undefined,
  family: "radar",
): Extract<ChartContent, { readonly family: "radar" }>["settings"];
export function createNewChartDefaults(
  globals: FabricGlobals | undefined,
  family: "polarBar",
): Extract<ChartContent, { readonly family: "polarBar" }>["settings"];
export function createNewChartDefaults(
  globals: FabricGlobals | undefined,
  family: ChartFamily,
): ChartContent["settings"];
export function createNewChartDefaults(
  globals: FabricGlobals | undefined,
  family: ChartFamily,
): ChartContent["settings"] {
  const paint = createNewPaintDefaults(globals)[YUNARI_PAINT_PROPERTY].fill;
  const surface = surfacePalette(globals, SURFACE_TOKENS);

  if (paint === undefined || surface === undefined) {
    throw new Error("New charts require a palette reference.");
  }

  // A chart needs both: content (its data) and a surface (its track). Using the
  // content token for the track would paint the background in the data colour.
  const ref = { ref: paint } as const;
  const surfaceRef = { ref: `palette.${surface[0]}` } as const;

  switch (family) {
    case "gauge":
      return { ...defaultGaugeSettings, track: surfaceRef, progress: ref };
    case "line": {
      const { area: _area, ...settings } = defaultLineSettings;
      return { ...settings, stroke: ref, palette: [ref] };
    }
    case "bar":
      return { ...defaultBarSettings, fill: ref, track: surfaceRef };
    case "pie":
      return {
        ...defaultPieSettings,
        palette: [ref],
        remainderFill: surfaceRef,
      };
    case "radar":
      // No area: an outline is what a radar is for until the author asks for
      // the fill, and an optional setting arrives absent.
      return { ...defaultRadarSettings, stroke: ref };
    case "polarBar":
      return { ...defaultPolarBarSettings, fill: ref, track: surfaceRef };
  }
}

/**
 * A *frosted* card takes the frosted surface first, and the plain one after it.
 *
 * The two are not one surface at two strengths. `panel` is 85 % opaque, so a
 * blur beneath it is a blur of nothing and the card reads as a tint; glass is a
 * diffusion, a grain and a saturation over a tint that transmits, so a shape
 * carrying the treatment has to carry the surface that transmits with it.
 */
const GLAZED_SURFACE_TOKENS = ["frost", ...CARD_SURFACE_TOKENS];

/**
 * The fill a shape should carry once it is frosted, or `undefined` when the one
 * it holds is the author's own.
 *
 * **A default follows the treatment; a choice survives it.** The two are told
 * apart by asking this module, which wrote them: a reference is a default
 * exactly when it is the reference a new shape is given right now, and
 * anything else — a token the author picked, or a shape saved before it carried
 * a reference at all — is left as it is. Nothing records which hand set a
 * reference, so the current default is the only honest test; a stored flag would
 * be a second model for "was this chosen", and it would have to stay true across
 * every undo.
 */
export function frostedShapeFill(
  globals: FabricGlobals | undefined,
  current: `palette.${string}` | undefined,
): `palette.${string}` | undefined {
  const plain = surfacePalette(globals, CARD_SURFACE_TOKENS);
  const glazed = surfacePalette(globals, GLAZED_SURFACE_TOKENS);
  // One surface cannot become another, and a document with no palette has
  // nothing to draw a card with — so there is no edit to make either way.
  if (plain === undefined || glazed === undefined) return undefined;
  if (glazed[0] === plain[0]) return undefined;
  if (current !== undefined && current !== `palette.${plain[0]}`)
    return undefined;
  return `palette.${glazed[0]}`;
}

/** The token for a surface an object draws on: a chart track, a card fill.
    `candidates` is that job's surface vocabulary — a card and a chart track are
    not the same surface, and the caller owns which. A document with no palette
    at all is `undefined` rather than a throw: a caller creating an object has
    nothing to create it from and refuses by name, and a caller repairing one
    only ever has an edit to skip. */
function surfacePalette(
  globals: FabricGlobals | undefined,
  candidates: readonly string[],
):
  | readonly [string, NonNullable<FabricGlobals["palette"]>[string]]
  | undefined {
  return surfacePaletteToken(globals?.palette, candidates);
}

function firstPalette(
  globals: FabricGlobals | undefined,
): readonly [string, NonNullable<FabricGlobals["palette"]>[string]] {
  const selected = contentPaletteToken(globals?.palette);
  if (selected === undefined)
    throw new Error("New objects require a palette token.");
  return selected;
}

/**
 * The token a new text object takes: the first entry, in insertion order.
 *
 * The producer orders the roles body first, so the first token is the editor's
 * default face. A new text carries no size of its own — size, leading and
 * tracking are the run's `style`, and an unauthored one takes the renderer's
 * role default (`defaultTypeSize`). A document with no tokens has no face to
 * write, so insertion refuses by name.
 */
function firstTypeToken(
  globals: FabricGlobals | undefined,
): readonly [string, TypeToken] {
  const first = Object.entries(globals?.typeTokens ?? {})[0];

  if (first === undefined) {
    throw new Error("New text requires a type token.");
  }

  return first;
}
