import {
  Activity,
  ChartColumn,
  ChartLine,
  ChartNoAxesCombined,
  ChartPie,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Ellipse,
  Eye,
  EyeOff,
  FileText,
  Folder,
  Gauge,
  Hexagon,
  Image as ImageIcon,
  Info,
  Keyboard,
  Layers2,
  Link,
  LoaderCircle,
  Lock,
  LogIn,
  LogOut,
  type LucideIcon,
  Minus,
  Monitor,
  OctagonAlert,
  Palette,
  Pencil,
  Plus,
  Scan,
  Search,
  Settings,
  Shapes,
  Spline,
  Square,
  Star,
  Trash2,
  TriangleAlert,
  TriangleRight,
  Type,
  Unlock,
  Upload,
  Wallpaper,
  X,
} from "lucide-react";
import type * as React from "react";
import { createElement } from "react";
import type { ShapeKind } from "../new-object-defaults.js";
import type { LayerKind } from "./layer-tree.js";
import type { RailSlot } from "./rail.js";

/** The glyph component type, re-exported so a surface that holds a glyph in a
 *  prop — `Pane`'s title icon, the domain maps — names it without reaching for
 *  `lucide-react`, which `object-actions.ts` is the one other chrome reader of. */
export type { LucideIcon };

/**
 * The chrome's one icon vocabulary (DESIGN.md §6): one family (lucide), one weight
 * rule, and one place that decides either.
 *
 * **This is the vocabulary, and the one place a chrome glyph's family and
 * weight are decided.** `object-actions.ts` is the single other chrome module
 * that reads `lucide-react`, because the action registry owns which icon an
 * action wears; a third reader would be a second owner of "which family and
 * which weight", and two of those is how the shell grew four weights. The
 * domain maps that name a *set* — severities, chart families, settings tabs —
 * keep their shape and draw their members from here, so the vocabulary stays
 * one and the meaning of each set stays with the surface that has it.
 *
 * Authored scene icon generation (`new-fabric-theme-icons.ts`) is deliberately
 * outside this: it converts lucide geometry into path commands for the Fabric
 * scene, which is data rather than chrome, and it reads the per-icon modules
 * rather than the React components.
 */

/** §6's weight rule: the stroke rises as the glyph shrinks, so the rendered
 *  weight stays optically even. The tiers are the drawing's own. */
export function glyphStrokeWidth(size: number): number {
  if (size <= 10) return 2;
  if (size <= 13) return 1.8;
  return 1.7;
}

/**
 * A chrome glyph, and the one place its weight is set.
 *
 * `filled` carries **two** things §6 separates, and neither is a stroke weight:
 * §6's own escape where a stroke would be illegible at 12px (the record dot, the
 * live check), and the **on/off channel of a binary state** — the font
 * picker's favourited star, the layer row's locked lock (`vg-024`, "locked is a
 * filled lock"). The second is not a licence to fill a glyph for looks; it is
 * the one place a two-valued control can say which of the two it is without a
 * second glyph or a second weight.
 *
 * Every glyph is `aria-hidden`: an icon-only control carries its name on the
 * button (§6), and a decorative mark beside a word is not read twice.
 */
export function Glyph(props: {
  readonly icon: LucideIcon;
  readonly size: number;
  readonly filled?: boolean;
}): React.JSX.Element {
  const { icon, size, filled = false } = props;
  return createElement(icon, {
    "aria-hidden": true,
    size,
    strokeWidth: glyphStrokeWidth(size),
    ...(filled ? { fill: "currentColor" } : {}),
  });
}

/** DESIGN.md §7.2's stack: a card on the canvas is an arbitrary group of elements,
 *  so its row cannot depict it and gets the stack glyph and its name. One glyph
 *  in one place — the rail's Composition slot, the layer row's group mark and
 *  Task 3's `KIND_GLYPHS.group` are all this constant. `Layers2`, not `Layers`:
 *  three planes smudge at 13px, the layer row's size, and the drawing stacks
 *  two. */
export const STACK_GLYPH: LucideIcon = Layers2;

/** The background row's mark. It is the page's wallpaper rather than the image
 *  kind's picture, so a background and an image layer never wear one glyph. */
export const BACKGROUND_GLYPH: LucideIcon = Wallpaper;

/** §7.2's page, the Document slot. */
export const PAGE_GLYPH: LucideIcon = FileText;
/** The tokens palette — the rail's slot and the settings Appearance tab. */
export const PALETTE_GLYPH: LucideIcon = Palette;
/** The Add slot's plus, and the camera cluster's zoom-in. */
export const PLUS_GLYPH: LucideIcon = Plus;
/** The camera cluster's zoom-out. */
export const MINUS_GLYPH: LucideIcon = Minus;
/** The camera cluster's fit. */
export const FIT_GLYPH: LucideIcon = Scan;
/** The settings gear, the rail's one modal trigger. */
export const SETTINGS_GLYPH: LucideIcon = Settings;
/** A menu's tick. */
export const CHECK_GLYPH: LucideIcon = Check;

/** The two diagnostic severities (§6's icon-only rule does not apply — the word
 *  follows the glyph, so this is a mark beside a sentence). */
export const ERROR_GLYPH: LucideIcon = OctagonAlert;
export const WARNING_GLYPH: LucideIcon = TriangleAlert;

/** The four chart families the document can name. */
export const CHART_GAUGE_GLYPH: LucideIcon = Gauge;
export const CHART_LINE_GLYPH: LucideIcon = ChartLine;
export const CHART_BAR_GLYPH: LucideIcon = ChartColumn;
export const CHART_PIE_GLYPH: LucideIcon = ChartPie;

/**
 * One glyph per primitive the Add pane offers, keyed by `ShapeKind`, so a
 * primitive added to that list fails to compile here until it wears a mark.
 *
 * **Every entry is a lucide glyph, and four of them are approximations.** Lucide
 * has no `polyline`, `arc` or `wedge`. **The Add pane's tiles read this same map
 * and draw nothing of their own**, so a primitive's tile and its layer row agree
 * by construction rather than by being copied, and the two cannot drift apart
 * the way a second drawing would let them. Each of the three takes the nearest
 * glyph of the same family:
 *
 * - `polyline` is `Activity`, which draws the same open multi-segment line at the
 *   same weight — it is the one lucide glyph whose path is a bare zigzag.
 * - `arc` is `LoaderCircle`, a single open sweep. Nothing in the set names a
 *   sweep, so this is the closest *drawing*; the name is a spinner's.
 * - `wedge` is `TriangleRight`, a right triangle with one rounded corner — the
 *   closest the set has to the quarter-disc a new wedge is drawn as, and
 *   deliberately not `ChartPie`, which the chart family `pie` wears: a wedge
 *   shape row and a pie chart row that rendered one class would leave the mark
 *   naming neither kind, and the row's role column is a different column.
 *
 * `polygon` is `Hexagon` rather than the tile's triangle: the new polygon's own
 * default is six sides (`NEW_POLYGON_SIDES`), so the row's mark is the figure the
 * author actually inserted — and a three-sided mark would name a kind the Add
 * pane does not offer.
 */
export const SHAPE_GLYPHS: Readonly<Record<ShapeKind, LucideIcon>> = {
  rect: Square,
  ellipse: Ellipse,
  polygon: Hexagon,
  polyline: Activity,
  line: Minus,
  path: Spline,
  arc: LoaderCircle,
  wedge: TriangleRight,
};

/** The settings column's other tabs. */
export const KEYBOARD_GLYPH: LucideIcon = Keyboard;
export const CONNECTIONS_GLYPH: LucideIcon = Link;
export const FIND_GLYPH: LucideIcon = Search;
export const INFO_GLYPH: LucideIcon = Info;

/** One-off chrome marks: the row's rename and the keyboard row's rebind, the
 *  font picker's favourite, a group's enter/leave, a row's eye. */
export const PENCIL_GLYPH: LucideIcon = Pencil;
export const STAR_GLYPH: LucideIcon = Star;
export const ENTER_GLYPH: LucideIcon = LogIn;
export const LEAVE_GLYPH: LucideIcon = LogOut;
export const VISIBLE_GLYPH: LucideIcon = Eye;
export const HIDDEN_GLYPH: LucideIcon = EyeOff;

/** The store cell's four actions, from the drawing's facts band
 *  (`mockups/current/store-themes.html`): a folder for opening the item, a
 *  monitor for assigning it to a display, a download for exporting it as a
 *  package, and the bin for deleting it — the last is the one the mark in §4
 *  paints `--hot`, which the control's own `destructive` flag carries. */
export const OPEN_ITEM_GLYPH: LucideIcon = Folder;
export const ASSIGN_ITEM_GLYPH: LucideIcon = Monitor;
export const EXPORT_ITEM_GLYPH: LucideIcon = Download;
export const DELETE_ITEM_GLYPH: LucideIcon = Trash2;

/** The online cell's *Install* control, which the drawing marks with an upload
 *  into a tray (`store-browse.html`). *Update* wears the download arrow, the
 *  same `EXPORT_ITEM_GLYPH` the export action does — the drawing draws one mark
 *  for "take this in" whichever surface it is on. */
export const INSTALL_ITEM_GLYPH: LucideIcon = Upload;

/** The way out of a surface that draws no title bar to put one in: the item
 *  modal floats it over the stage's corner (`store-detail.html`), where an × is
 *  the only mark that says "this closes" without a word beside it. */
export const CLOSE_GLYPH: LucideIcon = X;

/** The rail's four slot glyphs, from §7.2's table. Keyed by the rail's own slot
 *  union so a fifth slot is a compile error here rather than a slot with no
 *  mark. Exported because the pane each slot opens wears the same glyph in its
 *  title bar — two owners of "which glyph names this pane" would be two places
 *  for them to disagree. */
export const RAIL_GLYPHS: Readonly<Record<RailSlot, LucideIcon>> = {
  composition: STACK_GLYPH,
  add: PLUS_GLYPH,
  tokens: PALETTE_GLYPH,
  document: PAGE_GLYPH,
};

/**
 * Exactly one glyph per object kind, and the compile-time half of the closure:
 * a new `LayerKind` with no glyph here does not build. The runtime half is
 * `icons.test.tsx`'s comparison against `uiCopy.panels.layerKinds`, and neither
 * half sees the other's failure — a type-level totality is invisible to a
 * focused run, which is what a plan executes.
 *
 * **§6's own rule for the group arm**: a group is an arbitrary set of elements,
 * so it cannot be depicted — it gets the stack glyph and its name. That is why
 * `group` is `STACK_GLYPH` and nothing else, and why no entry here may be
 * derived from what a row happens to hold.
 *
 * **`text` is a bare `T`; the rounded-rectangle box it was asked for is dropped
 * rather than drawn.** Lucide 1.48.0 has no `T` inside an outline — `SquareText`
 * is a rounded square carrying three text rules and draws no `T` — so the box
 * could only arrive as a hand-authored path, a second icon family inside the map
 * that exists to be the one family. The wording yields to the rule; `Type` is
 * the `T`.
 *
 * **The layer row draws these, one arm per kind.** `text`, `image` and `group`
 * wear this map's own entry; `shape` wears the primitive's own glyph
 * (`SHAPE_GLYPHS`, falling back to this map's generic `Shapes` for a shape whose
 * kind the build does not know); and `chart` answers a different question — the
 * *family* — through `chartFamilyGlyph`, so `chart` here is the kind's generic
 * mark rather than the one four chart rows wear.
 *
 * **`chart` is `ChartNoAxesCombined`, and it used to be `CHART_BAR_GLYPH`**
 * (`vg-489`). A chart whose family this build cannot name falls back here, and
 * while this entry *was* bar's glyph the fallback claimed a family the document
 * never named — `chartMark` reports an unrecognised family as `undefined`
 * precisely so the row cannot do that, and the role abstains to the word
 * "Chart", so the mark was the only thing on the row claiming `bar`. The
 * generic mark is now the one lucide glyph that draws several families at once
 * and no axes, so it names no single family — the chart arm's `Shapes`.
 */
export const KIND_GLYPHS = {
  text: Type,
  shape: Shapes,
  chart: ChartNoAxesCombined,
  group: STACK_GLYPH,
  image: ImageIcon,
  background: BACKGROUND_GLYPH,
} satisfies Readonly<Record<LayerKind, LucideIcon>>;

/** The tree's open/closed chevrons. Each points the way the press goes, and the
 *  state itself stays on `aria-expanded`. */
export const TWISTY_GLYPHS: Readonly<
  Record<"collapsed" | "expanded", LucideIcon>
> = {
  collapsed: ChevronRight,
  expanded: ChevronDown,
};

/** The pager's two steps, from the drawing's own chevrons
 *  (`mockups/current/store-themes.html`): each points the way the press goes,
 *  and the step that would leave the listing is the disabled one rather than a
 *  missing glyph. */
export const PREVIOUS_PAGE_GLYPH: LucideIcon = ChevronLeft;
export const NEXT_PAGE_GLYPH: LucideIcon = ChevronRight;

/** Locked is a filled lock, unlocked an outline one: at this size the outlines
 *  differ only by a gap in the shackle, so the state rides the fill (§6) rather
 *  than a second glyph or a second weight. */
export const LOCK_GLYPH: Readonly<
  Record<
    "locked" | "unlocked",
    { readonly icon: LucideIcon; readonly filled?: true }
  >
> = {
  locked: { icon: Lock, filled: true },
  unlocked: { icon: Unlock },
};
