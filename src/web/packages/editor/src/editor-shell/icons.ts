import type { ListingCategory } from "@yunari/renderer-core";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ChartColumn,
  ChartLine,
  ChartNoAxesCombined,
  ChartPie,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CirclePlus,
  CircleX,
  CircuitBoard,
  Clock,
  CloudUpload,
  Cpu,
  Download,
  Ellipse,
  Eye,
  EyeOff,
  FerrisWheel,
  FilePlus2,
  FileText,
  FileUp,
  FolderInput,
  FolderOpen,
  Gauge,
  Gpu,
  HardDrive,
  Hexagon,
  Image as ImageIcon,
  Info,
  Keyboard,
  Layers2,
  LayoutTemplate,
  Link,
  LoaderCircle,
  LoaderPinwheel,
  Lock,
  LogIn,
  LogOut,
  type LucideIcon,
  Maximize2,
  MemoryStick,
  Minus,
  Monitor,
  MonitorActivity,
  Network,
  OctagonAlert,
  Palette,
  Pause,
  Pencil,
  PencilRuler,
  Pipette,
  Play,
  Plus,
  Radar,
  Ratio,
  RefreshCw,
  Save,
  SaveAll,
  Scan,
  Search,
  Settings,
  Shapes,
  Spline,
  Square,
  SquarePen,
  SquarePlus,
  Star,
  Trash2,
  TrendingUp,
  TriangleAlert,
  TriangleRight,
  Type,
  Unlock,
  Upload,
  Video,
  Wallpaper,
  X,
} from "lucide-react";
import type * as React from "react";
import { createElement } from "react";
import type { PathPresetId, ShapeKind } from "../new-object-defaults.js";
import type { PanelConnectionStatus } from "../theme-library-client.js";
import type { LayerKind } from "./layer-tree.js";
import type { RailSlot } from "./rail.js";

/** The glyph component type, re-exported so a surface that holds a glyph in a
 *  prop — `Pane`'s title icon, the domain maps — names it without reaching for
 *  `lucide-react`, which `object-actions.ts` is the one other chrome reader of. */
export type { LucideIcon };

/**
 * The chrome's one icon vocabulary: one family (lucide), one weight
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
 * Authored scene icon generation (`@yunari/theme-kit` `src/icons.ts`) is deliberately
 * outside this: it converts lucide geometry into path commands for the Fabric
 * scene, which is data rather than chrome, and it reads the per-icon modules
 * rather than the React components.
 */

/** The weight rule: the stroke rises as the glyph shrinks, so the rendered
 *  weight stays optically even. The tiers are its own. */
export function glyphStrokeWidth(size: number): number {
  if (size <= 10) return 2;
  if (size <= 13) return 1.8;
  return 1.7;
}

/**
 * A chrome glyph, and the one place its weight is set.
 *
 * `filled` carries **two** things the icon set separates, and neither is a stroke weight:
 * Its own escape where a stroke would be illegible at 12px (the record dot, the
 * live check), and the **on/off channel of a binary state** — the font
 * picker's favourited star, the layer row's locked lock ("locked is a
 * filled lock"). The second is not a licence to fill a glyph for looks; it is
 * the one place a two-valued control can say which of the two it is without a
 * second glyph or a second weight.
 *
 * Every glyph is `aria-hidden`: an icon-only control carries its name on the
 * button, and a decorative mark beside a word is not read twice.
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

/** The design's stack: a card on the canvas is an arbitrary group of elements,
 *  so its row cannot depict it and gets the stack glyph and its name. One glyph
 *  in one place — the rail's Composition slot, the layer row's group mark and
 *  Task 3's `KIND_GLYPHS.group` are all this constant. `Layers2`, not `Layers`:
 *  three planes smudge at 13px, the layer row's size, and the glyph stacks
 *  two. */
export const STACK_GLYPH: LucideIcon = Layers2;

/** The background video's two states: the command that changes it, not the
 *  state it is in, so a playing backdrop shows the pause glyph. */
export const PLAY_GLYPH: LucideIcon = Play;
export const PAUSE_GLYPH: LucideIcon = Pause;

/** The background row's mark. It is the page's wallpaper rather than the image
 *  kind's picture, so a background and an image layer never wear one glyph. */
export const BACKGROUND_GLYPH: LucideIcon = Wallpaper;

/** A video declaration's mark: a declared movie has no preview the pane can
 *  draw, so its card and the cleanup sheet use the control every player
 *  carries. */
export const VIDEO_GLYPH: LucideIcon = Play;

/** The page, the Document slot. */
export const PAGE_GLYPH: LucideIcon = FileText;
/** The two mode glyphs: the library is browsed like a fairground, and the
 *  editor makes a document rather than reading one. */
export const THEMES_MODE_GLYPH: LucideIcon = FerrisWheel;
export const EDITOR_MODE_GLYPH: LucideIcon = PencilRuler;
/** The two sort directions a listing shows on its active sort button. */
export const ASCENDING_GLYPH: LucideIcon = ArrowUp;
export const DESCENDING_GLYPH: LucideIcon = ArrowDown;
/** Settings mode's four This PC pages: the screens, the sensors that feed
 *  them, the units readings print in, and the external readings themselves. */
export const DISPLAYS_GLYPH: LucideIcon = Monitor;
export const HARDWARE_GLYPH: LucideIcon = Cpu;
export const UNITS_GLYPH: LucideIcon = Gauge;
export const READINGS_GLYPH: LucideIcon = Activity;
/** The header's readings-source toggle. It keeps one glyph in both states, so
 *  the selected state — not a second picture — says which source is shown. */
export const MONITOR_ACTIVITY_GLYPH: LucideIcon = MonitorActivity;
/** The tokens palette — the rail's slot and the settings Appearance tab. */
export const PALETTE_GLYPH: LucideIcon = Palette;

/** The Settings pages that split out of Appearance: the preview catalogue and
 *  the author's Path presets. `Ratio` is the proportions a preview frames;
 *  `Shapes` is the mark the Add pane's custom section wears. */
export const PREVIEW_RATIOS_GLYPH: LucideIcon = Ratio;
export const CUSTOM_SHAPES_GLYPH: LucideIcon = Shapes;

/** The inspector's collapse handle points at the edge it gives the stage back;
 *  the reopen handle points back into the column. */
export const INSPECTOR_COLLAPSE_GLYPH: LucideIcon = ChevronRight;
export const INSPECTOR_EXPAND_GLYPH: LucideIcon = ChevronLeft;
/** The picker's eyedropper: a sample taken off the screen, not a paint pick. */
export const PIPETTE_GLYPH: LucideIcon = Pipette;
/** The Add slot's plus, and the camera cluster's zoom-in. */
export const PLUS_GLYPH: LucideIcon = Plus;
/** An add control's mark. A circled plus reads as a button where a bare plus
 *  reads as a glyph; the camera cluster keeps `PLUS_GLYPH`, because there the
 *  plus is a zoom step and shares the toolbar's stroke weight with `MINUS`. */
export const ADD_GLYPH: LucideIcon = CirclePlus;
/** The Assets slot: the declared files as one open collection, rather than the
 *  store's `Folder` for opening a single item. */
export const ASSETS_GLYPH: LucideIcon = FolderOpen;
/** The camera cluster's zoom-out. */
export const MINUS_GLYPH: LucideIcon = Minus;
/** The camera cluster's fit. */
export const FIT_GLYPH: LucideIcon = Scan;
/** The settings gear, the rail's one modal trigger. */
export const SETTINGS_GLYPH: LucideIcon = Settings;
/** A menu's tick. */
export const CHECK_GLYPH: LucideIcon = Check;

/** The two diagnostic severities (the icon-only rule does not apply — the word
 *  follows the glyph, so this is a mark beside a sentence). */
export const ERROR_GLYPH: LucideIcon = OctagonAlert;
export const WARNING_GLYPH: LucideIcon = TriangleAlert;

/** A panel display's connection state, from the Host mode's controls section:
 *  a tick when the device is open, a sweep while it is being opened, a cross
 *  when the host is retrying it. The word follows the glyph, so this is a mark
 *  beside a sentence rather than an icon-only control's name. Keyed by the
 *  status union so a fourth state is a compile error here, not a state with no
 *  mark. */
export const PANEL_STATUS_GLYPHS: Readonly<
  Record<PanelConnectionStatus, LucideIcon>
> = {
  connected: CircleCheck,
  connecting: LoaderCircle,
  disconnected: CircleX,
};

/** A Wallpaper Engine card's failure mark. */
export const ACTION_FAILED_GLYPH: LucideIcon = TriangleAlert;
/** A card's work in flight: the one sweep the finder spins while it waits. */
export const BUSY_GLYPH: LucideIcon = LoaderCircle;

/** The six chart families the document can name. */
export const CHART_GAUGE_GLYPH: LucideIcon = Gauge;
export const CHART_LINE_GLYPH: LucideIcon = ChartLine;
export const CHART_BAR_GLYPH: LucideIcon = ChartColumn;
export const CHART_PIE_GLYPH: LucideIcon = ChartPie;
export const CHART_RADAR_GLYPH: LucideIcon = Radar;
export const CHART_POLAR_BAR_GLYPH: LucideIcon = LoaderPinwheel;

/**
 * One glyph per shape the Add pane offers — basic kinds and custom presets
 * alike — so a shape added to either list fails to compile here until it wears a
 * mark.
 *
 * **Every entry is a lucide glyph, and two of them are approximations.** Lucide
 * has no `arc` or `wedge`. **The Add pane's tiles read this same map and draw
 * nothing of their own**, so a preset's tile and its layer row agree by
 * construction rather than by being copied, and the two cannot drift apart the
 * way a second drawing would let them.
 *
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
export const SHAPE_GLYPHS: Readonly<
  Record<ShapeKind | PathPresetId, LucideIcon>
> = {
  rect: Square,
  ellipse: Ellipse,
  polygon: Hexagon,
  path: Spline,
  line: Minus,
  arc: LoaderCircle,
  wedge: TriangleRight,
};

/**
 * One glyph per known unit, keyed by the unit's own id.
 *
 * **Open, because the set is installed rather than shipped.** A pack names its
 * own units, so a map closed over a build-time union would refuse a pack this
 * build did not anticipate. Any id not listed here wears
 * `CARD_UNIT_FALLBACK_GLYPH`, whose one rule is that it identifies no known
 * unit.
 *
 * **The Add pane's card tiles draw these, the same vocabulary every other tile
 * in that pane draws**, so a unit tile is not a second icon family.
 */
export const CARD_UNIT_GLYPHS: Readonly<Record<string, LucideIcon>> = {
  "group-time-card": Clock,
  "group-cpu-card": Cpu,
  "group-gpu-card": Gpu,
  "group-ram-card": MemoryStick,
  "group-vram-card": CircuitBoard,
  "group-trends-card": TrendingUp,
  "group-storage-card": HardDrive,
  "group-network-card": Network,
};

/** The mark an installed unit this build does not know wears. */
export const CARD_UNIT_FALLBACK_GLYPH: LucideIcon = LayoutTemplate;

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
/** The finder's footer button that opens the same preview a double-click does. */
export const PREVIEW_GLYPH: LucideIcon = Maximize2;

/** The Assets pane's own import door: a file into this theme. The Finder beside
 *  it wears `FIND_GLYPH`, the mark every other search in the chrome uses. */
export const IMPORT_FILE_GLYPH: LucideIcon = FileUp;

/** The Assets pane's two card actions that have no other surface: putting a
 *  file on the canvas, and swapping the bytes of the asset already chosen. The
 *  pair is a square with a plus and the refresh arrows. */
export const PLACE_ON_CANVAS_GLYPH: LucideIcon = SquarePlus;
export const REPLACE_ASSET_GLYPH: LucideIcon = RefreshCw;
/** The Wallpaper Engine toolbar's re-read: the same arrows as Replace, used for
 *  their literal meaning. */
export const REFRESH_GLYPH: LucideIcon = RefreshCw;

/** The store cell's four actions, from the facts band: a pen-in-a-square for
 *  opening the item in the editor, a monitor for assigning it to a display, a
 *  download for exporting it as a package, and the bin for deleting it — the
 *  last is the one the mark in the palette paints `--hot`, which the control's
 *  own `destructive` flag carries. */
export const OPEN_ITEM_GLYPH: LucideIcon = SquarePen;
export const ASSIGN_ITEM_GLYPH: LucideIcon = Monitor;
export const EXPORT_ITEM_GLYPH: LucideIcon = Download;
export const DELETE_ITEM_GLYPH: LucideIcon = Trash2;
/** The library cell's publish control: an upload into the store, the same mark
 *  the online half's install wears for taking an item out of it. */
export const PUBLISH_ITEM_GLYPH: LucideIcon = CloudUpload;

/**
 * The header toolbar's theme-document actions, one glyph each.
 *
 * **These are chrome marks, not the object actions'**, so the toolbar names
 * them here rather than reaching for `lucide-react` itself. Import and Open
 * are two different doors — a package file in, a stored theme in — so they do
 * not wear one folder; Save and Save as are one disc and a stack of discs;
 * Activate wears the monitor because it puts the theme on a display; Export
 * wears the download arrow the store's export action already owns.
 */
export const IMPORT_THEME_GLYPH: LucideIcon = FolderInput;
export const OPEN_THEME_GLYPH: LucideIcon = FolderOpen;
export const SAVE_THEME_GLYPH: LucideIcon = Save;
export const SAVE_THEME_AS_GLYPH: LucideIcon = SaveAll;
export const ACTIVATE_THEME_GLYPH: LucideIcon = Monitor;
export const EXPORT_THEME_GLYPH: LucideIcon = Download;
/** The header toolbar's File commands, beside the document actions above. */
export const NEW_THEME_GLYPH: LucideIcon = FilePlus2;
export const TEMPLATE_THEME_GLYPH: LucideIcon = LayoutTemplate;
export const OPEN_RECENT_GLYPH: LucideIcon = Clock;
export const EXPORT_WIDGET_GLYPH: LucideIcon = Download;

/** The online cell's *Install* control, which the copy marks with an upload
 *  into a tray. *Update* wears the download arrow, the same `EXPORT_ITEM_GLYPH`
 *  the export action does — one mark for "take this in" whichever surface it is
 *  on. */
export const INSTALL_ITEM_GLYPH: LucideIcon = Upload;

/** The way out of a surface that draws no title bar to put one in: the item
 *  modal floats it over the stage's corner, where an × is the only mark that
 *  says "this closes" without a word beside it. */
export const CLOSE_GLYPH: LucideIcon = X;

/** The rail's five slot glyphs, from the table. Keyed by the rail's own slot
 *  union so a new slot is a compile error here rather than a slot with no
 *  mark. Exported because the pane each slot opens wears the same glyph in its
 *  title bar — two owners of "which glyph names this pane" would be two places
 *  for them to disagree. */
export const RAIL_GLYPHS: Readonly<Record<RailSlot, LucideIcon>> = {
  composition: STACK_GLYPH,
  add: ADD_GLYPH,
  assets: ASSETS_GLYPH,
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
 * **its own rule for the group arm**: a group is an arbitrary set of elements,
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
 * mark rather than the one the family rows wear.
 *
 * **`chart` is `ChartNoAxesCombined`, and it used to be `CHART_BAR_GLYPH`**
 *. A chart whose family this build cannot name falls back here, and
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

/** The asset finder's six tabs, one glyph per category. The tab is a place,
 *  not a layer: `Type` for fonts, `Shapes` for icons, the picture and film for
 *  media, `Palette` for presets, and `Wallpaper` for this PC's own library. */
export const FINDER_TAB_GLYPHS: Readonly<Record<ListingCategory, LucideIcon>> =
  {
    font: Type,
    icon: Shapes,
    image: ImageIcon,
    video: Video,
    colour: Palette,
    local: Wallpaper,
  };

/** The tree's open/closed chevrons. Each points the way the press goes, and the
 *  state itself stays on `aria-expanded`. */
export const TWISTY_GLYPHS: Readonly<
  Record<"collapsed" | "expanded", LucideIcon>
> = {
  collapsed: ChevronRight,
  expanded: ChevronDown,
};

/** Locked is a filled lock, unlocked an outline one: at this size the outlines
 *  differ only by a gap in the shackle, so the state rides the fill rather
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
