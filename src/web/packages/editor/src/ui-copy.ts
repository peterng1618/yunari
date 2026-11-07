/** Typed package-local visible editor copy (§35). Authored theme text,
 * telemetry values and developer errors stay outside this module.
 *
 * Exempt from the 800-line stop, which is written for source files:
 * this is a flat string table whose bulk is the reason each word is the word,
 * so splitting it by namespace would file the same words across five tables
 * and buy the count nothing but a fifth owner of one convention. */

import {
  type AssignableGroup,
  type BuiltinListingCategory,
  type ChartFamily,
  type ColourMode,
  DASHBOARD_THEME_KIND,
  type Orientation,
  type SemanticFamily,
} from "@yunari/renderer-core";
import { BUILTIN_PATH_PRESETS, type VersionLevel } from "@yunari/theme-package";
import type { LocalAssetReference } from "./asset-manager/index.js";
import type { ShortcutPrefix } from "./shortcut-manager/display.js";
import type { InstallState } from "./store-mode/install-state.js";
import type { CellAction } from "./store-mode/local-source.js";

/**
 * The one name per chart family, hoisted so the layer role vocabulary can
 * compose a row's string from the same words the Add pane and the canvas
 * context menu offer. A second spelling of `Gauge` would be a second owner of
 * the same fact.
 */
const chartFamilyLabels = {
  gauge: "Gauge",
  line: "Line",
  bar: "Bar",
  pie: "Pie",
  radar: "Radar",
  polarBar: "Polar bar",
} as const satisfies Record<ChartFamily, string>;

/**
 * The generic word for each kind of layer. `layer-tree.ts`'s row-name fallback
 * reads these, so the six kind words have one owner rather than a private
 * table beside the projection. Keys mirror `LayerKind`: a kind added there
 * without one fails to compile where the projection indexes this.
 */
const layerKindLabels = {
  text: "Text",
  shape: "Shape",
  chart: "Chart",
  group: "Group",
  image: "Image",
  background: "Background",
} as const;

/**
 * How a row's role reads: one function per arm of `LayerRole`, each turning the
 * facts the projection reports into the words the row shows.
 *
 * A chart whose family this build does not know shows the kind word rather than
 * a neighbour's family the document never claimed, and a chart drawing more
 * than one series says how many (`Line ×3`) — the family alone would hide the
 * difference between one reading and three.
 */
const layerRoles = {
  text: (): string => layerKindLabels.text,
  shape: (): string => layerKindLabels.shape,
  image: (): string => layerKindLabels.image,
  background: (): string => layerKindLabels.background,
  group: (unit: string | undefined): string => unit ?? layerKindLabels.group,
  chart: (family: ChartFamily | undefined, series: number): string => {
    const label =
      family === undefined ? layerKindLabels.chart : chartFamilyLabels[family];
    return series > 1 ? `${label} ×${series}` : label;
  },
} as const;

/** A row's file size. `Intl` owns the unit word, the separator and the
 *  rounding; the only choice here is which unit the number is in. */
const KILOBYTE = new Intl.NumberFormat(undefined, {
  style: "unit",
  unit: "kilobyte",
  maximumFractionDigits: 1,
});
const MEGABYTE = new Intl.NumberFormat(undefined, {
  style: "unit",
  unit: "megabyte",
  maximumFractionDigits: 1,
});

/** One byte count as a reading, shared by the two surfaces that print one. */
const fileSize = (bytes: number): string =>
  bytes < 1024 * 1024
    ? KILOBYTE.format(bytes / 1024)
    : MEGABYTE.format(bytes / (1024 * 1024));

/** A clip length as a person reads it: whole minutes and zero-padded seconds. */
const clipDuration = (milliseconds: number): string => {
  const total = Math.max(0, Math.round(milliseconds / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/**
 * One label per built-in custom shape, derived from the same list the host
 * stores and the editor's catalogue reads. A fourth builtin gains its word
 * here without a second spelling, and the map stays total for a `PathPresetId`.
 */
const pathPresetLabels = Object.fromEntries(
  BUILTIN_PATH_PRESETS.map((preset) => [preset.id, preset.label]),
) as Record<(typeof BUILTIN_PATH_PRESETS)[number]["id"], string>;

export const uiCopy = {
  brand: "Yunari",
  /** The rail's five slots. A slot's word is both its tooltip and its
   *  accessible name: the slot is icon-only, so it has no text of its own, and
   *  a glyph stored as a translatable string would be announced as a word and
   *  could not inherit a shell colour. One word per slot, from the one owner
   *  of which slots exist (`rail.tsx`). */
  rail: {
    /** The rail's own name, so a screen reader is told what the group of
     *  slots chooses between before it reads each one. */
    label: "Editor panes",
    slots: {
      composition: "Layers",
      add: "Add",
      /** Every declared file, its import and placement, and the finder link. */
      assets: "Assets",
      tokens: "Design tokens",
      /** The artboard, background, metadata and reference panels — one pane,
       *  because they are the theme's own settings. */
      document: "Theme settings",
    },
  },
  /** The settings modal the rail's gear opens. A modal is a surface, not
   *  a pane, so its words live here rather than under `rail`: the three tabs
   *  are the table, and `close` is the `Dialog.Close` the modal renders so a
   *  touch screen reader — with no Escape key — can still leave it. */
  settings: {
    title: "Settings",
    appearance: "Appearance",
    /** The author-managed preview ratios the display menu lists. */
    previews: "Previews",
    keyboard: "Keyboard",
    connections: "Connections",
    about: "About",
    close: "Close",
    /** The grouped navigation column. `thisPc` is the machine and its screens;
     *  `editor` is how the author works on this machine. The group headings
     *  are the only place those words appear, so a page cannot be filed twice. */
    groups: {
      thisPc: "This PC",
      editor: "Editor",
    },
    /** One word per page, and the same word the page's own heading prints. The
     *  nav and the header read this map, so a page cannot appear with one name
     *  and open under another. */
    pages: {
      displays: "Displays",
      hardware: "Hardware",
      units: "Units & time",
      readings: "Readings",
      appearance: "Appearance",
      previews: "Preview ratios",
      pathPresets: "Custom shape presets",
      keyboard: "Keyboard",
      assetSources: "Asset sources",
      about: "About",
      extensions: "Extensions",
    } as const,
    /** A page's one-sentence promise, under its heading. The host pages reuse
     *  the hints their sections already owned; the two editor pages that had a
     *  modal rather than a page gain the sentence that says what they hold. */
    pageHints: {
      displays:
        "Each display shows its own theme. Assign one from the theme's row in Themes.",
      hardware:
        "Which hardware the Host reports. These apply to every theme, unless a theme asks for something different.",
      units:
        "How the Host's readings are shown. A theme decides how a clock reads; this decides which zone it reads and which units temperatures use.",
      readings:
        "Where this PC's weather and custom readings come from, and how often they are read.",
      appearance: "The editor's own palette.",
      previews:
        "The display menu offers each ratio below, in both orientations where it has two. Fit is always there.",
      pathPresets:
        "The shapes the Add pane's Custom Shape section offers. A closed path is filled; an open one is stroked.",
      keyboard: "Every product action, and the chord that runs it.",
      assetSources:
        "Keys stay on this machine. Stored values are never shown again, only the last four characters.",
      about: "Yunari, a dashboard theme editor.",
      extensions:
        "Installed plugins, what each one asks for, and which provider answers a shared reading first.",
    } as const,
    /** The Connections tab: the one place a provider key is entered, because
     *  every remote source reads from here rather than growing its own field. */
    connectionsHeading: "Asset sources",
    connectionsIntro:
      "Keys stay on this machine. Stored values are never shown again, only the last four characters.",
    connectionsEmpty: "No source needs a key yet.",
    connectionsSaved: (hint: string): string => `Saved ····${hint}`,
    connectionsNotSet: "Not set",
    connectionsPlaceholder: "Access key",
    connectionsSave: "Save",
    connectionsClear: "Clear",
    connectionsVerify: "Verify",
    connectionsWhereToGetKey: "Where to get a key",
    connectionsFooter:
      "Keys are stored in a local settings file and sent only to the source that owns them.",
    /** The Extensions page. A capability name is the manifest's own word and
     *  is never translated; these are the labels around it. */
    extensions: {
      installHeading: "Install",
      installHint:
        "Choose one .zip package. Its contents are validated on this PC before anything is installed.",
      installLabel: "Extension package",
      installedHeading: "Installed extensions",
      empty: "No extensions are installed.",
      capabilities: "Capabilities",
      contributions: "Contributions",
      devices: "Device ids",
      commands: "Panel commands",
      publisher: "Publisher",
      /** A sandboxed settings frame saves through `settings.set`, which is a
       *  write: the frame cannot mint the gesture itself, so the host draws
       *  this one control. */
      frameEnableControls: "Enable controls",
      /** The kill list names this plugin: it stops loading, and the advisory is
       *  the store's own HTTPS link to why. */
      revoked: "The store revoked this plugin.",
      revokedAdvisory: "Read the advisory",
      /** A held update: the same facts the update policy held it for. */
      reviewHeading: "Update held for review",
      reviewReasons: "This update asks for something new:",
      reviewApprove: "Install update",
      reviewDismiss: "Keep the installed version",
      consent: {
        "not-required": "No consent needed · descriptor only",
        granted: "Approved",
        missing: "Not approved",
      },
      providerHeading: "Provider order",
      providerHint:
        "When two providers answer the same reading, the first one listed answers. Built-in providers are not part of this list.",
      noProviders: "No extension provides sensor readings.",
    },
    /** The About tab: what the editor is, and the facts this build can read.
     *  The provenance is one sentence naming the product; the three fact labels
     *  say which fact each row is, and the release fact's *label* is the
     *  Document pane's own word (`panels.releaseVersion`), reused rather than
     *  respelled so one fact keeps one word. */
    aboutProvenance: "Yunari, a dashboard theme editor.",
    aboutProductVersion: "Product version",
    aboutSchemaVersion: "Schema version",
    /** The Appearance tab. `palette` is the name the header chip's trigger
        already used for this same choice — the trigger said
        `${palette}: ${value}` — so the surface reads the same after the move
        rather than acquiring a second word for one thing. */
    palette: "Shell palette",
    followSystem: "Follow the system",
    /** What following does, and what turning it off means. Not the refusal
        path: nobody is blocked here, so this is the `hint` (invisible to the
        eye, read by a screen reader and by the row's tooltip). */
    followSystemHint:
      "Use the palette the operating system asks for, and follow it when it changes. Choosing a palette above turns this off.",
    /** The same fact where the browser refused its own storage: the choice is
        real and it will not survive a reload, which is worth saying rather
        than leaving to be discovered. */
    followSystemSessionOnly:
      "This browser is not keeping editor settings, so the choice lasts until the editor is reloaded.",
    /** The editor theme: the palette in force, plus any applied overrides, as a
     *  package. Its own section rather than a second palette picker — choosing
     *  a palette replaces an applied theme, so the two cannot both be "in
     *  force". */
    editorThemeHeading: "Editor theme",
    editorThemeHint:
      "Save the shell palette in force, with any applied overrides, as a package. Choosing a palette above clears an imported theme.",
    editorThemeName: "Theme name",
    editorThemeSave: "Save draft",
    editorThemeExport: "Export",
    editorThemeImport: "Import theme package",
    editorThemeDraftSaved: (name: string): string => `Draft saved: ${name}.`,
    editorThemeExported: (name: string): string => `Exported ${name}.`,
    editorThemeApplied: (name: string): string => `Applied ${name}.`,
    editorThemeNameRequired: "A theme needs a name before it can be saved.",
    editorThemeUnreadableFile: "That file could not be read.",
    /** The Previews tab. One row per stored token, showing the lens ids that
     *  token derives, and the add row's field and action. */
    previewRatiosHeading: "Preview ratios",
    previewRatiosHint:
      "The display menu offers each ratio below, in both orientations where it has two. Fit is always there.",
    previewRatioField: "W:H ratio",
    previewRatioAdd: "Add",
    previewRatioRemove: "Remove preview ratio",
    /** Brings back removed defaults and leaves author-added items alone. */
    restoreDefaults: "Restore defaults",
    /** the refusal rule: a refusal states its reason. `duplicate` is the exact
        token; `equivalent` names both spellings of one rect shape, because the
        entered name is kept rather than reduced. */
    previewRatioDuplicate: "That ratio is already offered in the display menu.",
    previewRatioEquivalent: (entered: string, existing: string): string =>
      `${entered} is the same shape as ${existing}, which is already in the list.`,
    previewRatioInvalid:
      "A preview ratio is two positive numbers with a colon, like 16:9.",
    previewRatiosEmpty:
      "No preview ratios left. The display menu offers Fit only until you add one.",
    previewRatiosSessionOnly:
      "This browser is not keeping editor settings, so the list lasts until the editor is reloaded.",
    /** Custom Add-pane shapes. One row per author preset, and the two fields
     *  that define a new one. */
    pathPresetsHeading: "Custom shapes",
    pathPresetsHint:
      "Each entry appears in the Add pane and inserts a Path with this data. A closed path is filled; an open one is stroked.",
    pathPresetNameField: "Name",
    pathPresetNamePlaceholder: "Star",
    pathPresetDataField: "SVG path data",
    pathPresetDataPlaceholder: "M 0 0 L 10 0 L 5 10 Z",
    pathPresetAdd: "Add shape",
    pathPresetRemove: "Remove custom shape",
    pathPresetRemoveBuiltin: "Remove built-in shape",
    pathPresetEmpty: "No custom shapes yet.",
    pathPresetNameRequired: "A custom shape needs a name.",
    pathPresetDataRequired: "A custom shape needs path data.",
    pathPresetUnreadable: "That path data cannot be read.",
    pathPresetDrawsNothing: "That path data draws nothing.",
    /** The Keyboard tab: the reference with editing. One word for one act —
     *  the arm button's `aria-label` and its tooltip are this string. */
    keyboardRebind: "Change chord",
    keyboardReset: "Reset",
    keyboardResetAll: "Reset all",
    /** What a row says instead of its chord while it is listening. */
    keyboardPrompt: "Press a chord…",
    /** the refusal rule: a refusal states its reason. Each is a whole sentence the row shows
     *  beside the binding it did not make — never a tooltip. */
    keyboardTaken: (action: string): string =>
      `${action} already answers to that chord. Press another.`,
    /** Takes the **printed chord** (`Ctrl+R`, `F5`), not the bare key: the
        browser keeps the chord, and `R` alone reads as a letter it reserves —
        which is false, and mixed casing against a named key like `F5`. */
    keyboardReserved: (chord: string): string =>
      `This browser keeps ${chord} for itself, so nothing here can hear it. Press another.`,
    /** Alt never reaches a stored binding: `ShortcutBinding` carries a
        modifier that means Ctrl/Cmd, so an Alt-qualified press would be stored
        as its bare key — the author presses one chord and the row takes
        another. The refusal is the honest half of that; modelling `alt` is the
        upgrade path if a chord ever needs it. */
    keyboardAltQualified:
      "Alt is not a modifier a chord here can carry, so that press would bind its bare key. Press another.",
    keyboardModifierOnly:
      "A chord needs a key: a modifier on its own cannot be bound.",
    keyboardCannotDefer: (action: string): string =>
      `${action} works while a text field has focus, so its chord needs a modifier.`,
    keyboardUnprintable:
      "That key has no mark this editor can print, so the binding could not be shown here.",
    /** The second half of the same rule, and the one a punctuation key meets:
        `.` prints (`Ctrl+.`) but is not a key the stored table carries, so a
        capture that took it would hold for the session and revert on the next
        reload. The message names that consequence rather than listing the
        vocabulary: what the store keeps is `KEY_SHAPE`'s to state, and a list
        here would be a second owner of it — one that is already wrong, since
        `-`, `?`, `[`, `]`, `{` and `}` are storable while this copy claimed
        punctuation was not. */
    keyboardUnbindable:
      "This key cannot hold a chord here: the editor does not keep it in a stored binding, so it would work now and vanish on the next reload. Press another.",
    /** The storage-less branch, worded like the appearance toggle's: a session
     *  preference is real, and it is honest about not outliving a reload. */
    keyboardSessionOnly:
      "This browser is not keeping editor settings, so a new chord lasts until the editor is reloaded.",
  },
  /** The right column's one shell control. */
  inspectorPanel: {
    collapse: "Collapse inspector",
    expand: "Expand inspector",
  },
  /** Selection inspector field labels. */
  inspectorFields: {
    selection: "Selection",
    /** What the selected object is called in the layer list, as against the id. */
    name: "Name",
    /** Shown when a name is rejected rather than truncated to the published bound. */
    invalidName: "That name cannot be applied to the selection.",
    /** The section the obscure fields collapse into — present and findable, and
        out of the way of the questions an author asks on every edit. */
    advanced: "Advanced",
    x: "X",
    y: "Y",
    /** The Size pair marks its boxes W and H, as the artboard panel's does: the
        full words overflow the row and wrap the second input to its own line. */
    width: "W",
    height: "H",
    rotation: "Rotation",
    /** Row labels for the inspector's paired geometry lines. */
    position: "Position",
    size: "Size",
    invalidValue: "That value cannot be applied to the selection.",
    /** The empty column "says where to choose from",
        which needs the place named — "select an object" said the act and not
        where to do it. The canvas is the surface existing objects are chosen
        on; the Add pane inserts new ones, which is a different act. */
    nothingSelected: "Select an object on the canvas to inspect it.",
    /** Shown instead of any field when the selection is locked. */
    locked: "This object is locked. Unlock it to edit it.",
    /** Crop, on a selected image. The session owns the drag and the refusals;
        these name only the controls that start and end it. */
    crop: "Crop",
    cropApply: "Apply",
    cropCancel: "Cancel",
    /** Panel appearance. Every primitive shape owns a fill, a stroke, a border
        width and a shadow; the corner radius is a rectangle's alone. */
    panelFill: "Fill",
    /** An unfilled path is stroked, so its paint is ink and `Fill` would be the
        wrong word — the author who sets it wants the icon recoloured, not the
        region its centrelines enclose flooded. See `paintPropertyFor`. */
    panelInk: "Ink",
    panelStroke: "Stroke",
    panelBorder: "Border width",
    panelRadius: "Corner radius",
    panelShadow: "Shadow",
    panelShadowBlur: "Shadow blur",
    panelShadowOffset: "Shadow offset",
    /** What one shape owns and no other: its corners or its data. The general
        geometry fields above stay unchanged. */
    shapeSides: "Sides",
    /** A closed Path's straight-line corners. Unlike `panelRadius`, this is not
      a stored property: it is read from, and written to, the path's own data. */
    shapeRadius: "Corner radius",
    shapePath: "Path data",
    /** The frosted-glass treatment and its one parameter. */
    glassEnabled: "Frosted glass",
    glassBlur: "Glass blur",
    glassSampling: "Glass sampling",
    glassSamplingDynamic: "Dynamic",
    glassSamplingStatic: "Static",
    opacity: "Opacity %",
    /** The reading a picture draws its image from: the catalogue's own name for
        the key is the option, so the row names the question and not the answer. */
    imageSensor: "Sensor",
    paint: "Paint",
    notSet: "not set",
    unresolved: "no longer resolves",
    runs: "Runs",
    runToken: "Type token",
    /** A run's own size; the shared `panels.size` names the artboard's instead. */
    runSize: "Size",
    /** What one run says, for a run that is prose. Distinct from the Add pane's
        "Text" button, which inserts an object rather than naming a field. */
    runText: "Run text",
    /** A run summary's accessible name: the run concept, then what it prints,
        which the surface appends because it is data. */
    runTab: (position: number) => `Run ${position}`,
    addRun: "Add run",
    /** A chart's bindings are its series, which is the word the panel already
        uses for the axis. Named once so the chooser and the refusal agree. */
    runSeries: "Add a series",
    runSeriesFull: (family: string) =>
      family === "radar"
        ? "A radar chart draws one spoke per series, up to 12."
        : `A ${family} chart draws one reading, so it takes one series.`,
    removeSeries: (key: string) => `Remove the series reading ${key}`,
    /** Numbered, so three rows do not offer three identical buttons — the same
        ambiguity F1.17 found in the Add pane, where "Line" was two things. */
    removeRun: (position: number) => `Remove run ${position}`,
    /** Shown when a run after the first asks for tracking the object cannot
        carry: Fabric measures spacing once, from the object. The interpolation
        is the run's own description, because tracking is the run's and a token
        carries none. */
    runTrackingNotSeparate: (run: string) =>
      `Tracking on "${run}" is not shown separately — a text object carries one tracking value, from its first run.`,
    runColour: "Color",
    /** The row action that edits the token a run references, named by the
        token it opens so two runs' rows are not two identical buttons. */
    editToken: (name: string) => `Edit ${name}`,
    runSource: "Reads",
    staticText: "Static text",
    /** What the dot before a reading says about this PC. The accessible name
        repeats the state, because colour alone does not reach every author. */
    sensorStatus: {
      reporting: "reporting now",
      bound: "bound but unavailable",
      unknown: "unknown",
    },
    runFormat: "Format",
    /**
     * The token vocabulary, under the field. The formatter's own rule is that
     * an unrecognised token renders literally "so a typo is visible" — which
     * makes it visible **on a display**, where the author is not looking. The
     * alternative to naming them here is a date reading `EEE, Sep d, yyyy` on a
     * wall, which is exactly what this pass drew.
     */
    runFormatTokens:
      "Tokens: YYYY YY · MMMM MMM MM M · dddd ddd · DD D · HH H hh h · mm ss · A a. Words in [square brackets].",
    runZone: "Zone",
    runZoneFollows: "Follow the display",
    valueRun: "Value",
    emptyRun: "(empty)",
    /** Which binding a run names. The canvas paints the reading, so this is
        where the author sees the name a run reads from. */
    runBinding: (key: string) => `Reads ${key}`,
    /** A run names a binding this object does not declare, so nothing can
        resolve it. The author can only fix this by declaring the binding. */
    runUndeclared: (id: string) =>
      `No binding "${id}" is declared here, so this run resolves to nothing.`,
    /** Declared, but no reading has arrived for it — a missing sensor, not a
        mistake in the theme. Distinct from undeclared because it needs no edit. */
    runUnmapped: (key: string) => `No reading has arrived for ${key} yet.`,
    align: "Align",
    left: "Left",
    centre: "Center",
    right: "Right",
    /** Text inside its box, which is the thing the two words above do not say.
        The canvas's own `align-top` / `align-center-y` / `align-bottom` move
        selected *objects*, and both surfaces are reachable from one selection,
        so this one names its own subject rather than borrowing the verb. */
    verticalAlign: "Vertical text align",
    verticalTop: "Top",
    verticalMiddle: "Middle",
    verticalBottom: "Bottom",
    overflow: "Overflow",
    clip: "Clip",
    ellipsis: "Ellipsis",
    overflowVisible: "Visible",
  },
  /** The inline `@` list's own name, so the popup announces what it offers. */
  textMentions: {
    label: "Readings",
  },
  menus: {
    /** The shortcut sheet's two group names. */
    file: "File",
    view: "View",
  },
  /** The header toolbar's own name. The buttons inside name themselves; this
   *  says what the row is — the open theme document's actions. */
  toolbar: {
    label: "Theme document actions",
  },
  /**
   * The shell's three modes, as the header's switch names them.
   * Each names the *surface* rather than the mechanism behind it.
   *
   * **The machine and the mode that manages it are one name: `Host`.** The
   * mode value, the query value and this key are `host`; the persisted display
   * id stays `this-pc`, because it is stored in per-display assignments rather
   * than shown to anyone.
   */
  modes: {
    /** The switch's own name. The three labels inside are the options, so a
     *  group with no name announces "Editor, pressed" with nothing saying what
     *  is being chosen. */
    label: "Shell modes",
    editor: "Editor",
    themes: "Themes",
    /** The third surface: this PC's settings and the editor's own preferences,
     *  one page each. It was called Host while it held host settings only. */
    settings: "Settings",
  },
  /**
   * The Host mode's own surface: the machine and its display.
   *
   * **The words are `packages/host/public/settings.html`'s** — its hints, its
   * device labels, its status line — taken rather than rewritten, because they
   * are the same questions, and the committed page says so. Two things
   * diverge. That page no longer lists themes (A.10): the listing is the store
   * mode's local half, and an assignment is made from a theme's own row. And
   * its questions hint carries a sentence this one does not — which display the
   * answers are for — because this surface has its own display selector and
   * must not claim the page's default (R153).
   */
  hostSettings: {
    displays: {
      heading: "Displays",
      /** The list column's own eyebrow. The page heading already says
       *  "Displays", so the list names what it holds rather than repeating it. */
      listHeading: "All displays",
      /** The startup row's eyebrow, under the add form rather than beside it. */
      autostartHeading: "Startup",
      hint: "Each display shows its own theme. Assign one from the theme's row in Themes.",
      /** The name of the control that picks which display the questions below
       *  speak for. It is a choice and not an assignment. */
      label: "Displays",
      /** A display holding no theme of its own is served the default. The row
       *  names the theme it shows and says where that answer came from, because
       *  a name alone would read as a choice this display made. */
      follows: "Follows Host",
      /** Neither a theme of its own nor a default: nothing falls back to. */
      nothing: "No theme",
      /** The file the host keeps its displays and their credentials in could not
       *  be read. The list is empty because of that, not because none exists,
       *  and every write refuses — so this names the file and the repair. */
      unreadable:
        "display-clients.json could not be read, so this host cannot list or change displays. Repair or remove that file in the host's settings folder.",
      /** The section that edits the selected display's name and glass. */
      presentation: "Display settings",
      name: "Name",
      /** Says the rename is the display's, not the theme's: a row and a theme
       *  can share a word, and only one of them changes here. */
      nameHint: "The name this display is listed under.",
      savedName: "Saved the display's name.",
      shape: "Shape",
      shapeRect: "Rect",
      shapeCircle: "Circle",
      rotation: "Rotation",
      /** What the section says about the two rules they write under. */
      rotationSnapHint:
        "A round display turns by any whole degree; a rectangular one turns in quarter turns. Changing the shape snaps the angle to the new rule.",
      /** The Host has no record to present, and the unpaired default is served
       *  rather than owned: the section says why instead of drawing a control
       *  that cannot write. */
      presentationAbsent:
        "The Host's screen has no shape or rotation to set. Pair a display to choose its glass and mounting angle.",
      savedPresentation: "Saved the display's shape and rotation.",
      /** The stream a panel's device is fed. Mode A is the full-colour frame;
       *  Mode B is the paletted one the vendor app streams, which buys frame
       *  rate at 256 colours. Drawn only for a family that offers both. */
      renderMode: "Rendering mode",
      renderModes: {
        "mode-a": "Mode A (full colour)",
        "mode-b": "Mode B (paletted)",
      },
      renderModeHint:
        "Mode A sends full-colour frames and is the default. Mode B sends paletted frames the way NZXT CAM does: a higher frame rate, with 256 colours.",
      savedRenderMode: "Saved the display's rendering mode.",
      /** The local display the owner adds by choosing a monitor the Host
       *  reports. The route needs both a name and a monitor, so the form offers
       *  both and says nothing when no monitor was found. */
      addHeading: "Add a local display",
      addName: "Name",
      addNameHint: "What this display is called. You can rename it later.",
      addMonitor: "Monitor",
      /** One screen, as the probe describes it: the device name it reports, the
       *  aspect ratio its pixel count describes, that count, and whether it is
       *  the main display. The ratio leads because two screens that read alike
       *  report different counts — 2048×1152 is 16:9 — and a count alone does
       *  not say whether it is the shape the author expected. */
      monitorOption: (
        name: string,
        ratio: string | undefined,
        width: number,
        height: number,
        main: boolean,
      ): string =>
        `${name} - ${ratio === undefined ? "" : `${ratio}, `}${width}x${height}${main ? " (main)" : ""}`,
      noMonitors:
        "The Host reported no monitor, so a local display cannot be added here.",
      add: "Add display",
      adding: "Adding…",
      added: (name: string): string => `Added ${name}.`,
      /** Removing one display. The question names it and says what goes with it:
       *  a removal is also the revocation of a paired display's credential. */
      remove: "Remove",
      removeDisplay: (name: string): string => `Remove ${name}`,
      removeAsk: (name: string): string =>
        `Remove ${name}? It loses its theme assignment and, if it was paired, its credential.`,
      confirmRemove: "Remove display",
      keep: "Keep",
      removed: (name: string): string => `Removed ${name}.`,
      /** The host starts at sign-in so every local display comes back after a
       *  reboot. The route registers the host, not one display. */
      autostart: "Start at sign-in",
      autostartHint:
        "Yunari starts hidden at sign-in, so every local display comes back after a reboot.",
    },
    panels: {
      heading: "USB panels",
      hint: "A panel is a small screen plugged into the Host. Adding one makes it a display, and the Host draws for it.",
      /** Nothing attached: the ordinary case on a machine without a panel. */
      none: "No USB panel is attached to the Host.",
      /** Every attached panel is already a display. */
      allAdded: "Every attached panel is already a display.",
      /** A held device's row names the display driving it, where the owner can
       *  tell it apart from one they could still add. */
      heldBy: (display: string): string => `Already a display: ${display}`,
      /** A held device whose display this surface cannot name. */
      held: "Already a display.",
      add: "Add",
      adding: "Adding…",
      addPanel: (name: string): string => `Add ${name} as a display`,
      added: "Added the panel as a display.",
      /** The hardware record a driver states for a panel, one fact per line. */
      maker: (maker: string): string => `Maker ${maker}`,
      revision: (revision: string): string => `Revision ${revision}`,
      detectedFirmware: (firmware: string): string => `Firmware ${firmware}`,
      supportedFirmware: (versions: readonly string[]): string =>
        versions.length === 0
          ? "No supported firmware is recorded yet."
          : `Supported firmware ${versions.join(", ")}`,
      updated: (date: string): string => `Recorded ${date}`,
      /** The device answers a firmware the driver has not met. The warning a
       *  person needs before asking why a feature does not work: it names the
       *  risk that the protocol may have changed, not just the numbers. */
      mismatch: (detected: string, supported: readonly string[]): string =>
        `Firmware ${detected} is not one this panel is known to take (${supported.join(", ")}). The panel's protocol may have changed, so a control may not work.`,
      /** The controls one display's panel accepts over its own cable. The
       *  section opens a dialog rather than drawing the commands in the page:
       *  a restart is one press that makes the panel drop, and it belongs
       *  behind a door rather than beside the display list. */
      controls: {
        heading: "Panel controls",
        hint: "Send a command to the panel this display drives.",
        open: "Controls",
        /** The three states the host reports for this display's device. */
        connection: {
          connected: "Connected",
          connecting: "Connecting…",
          disconnected: "Disconnected",
        },
        /** What happens by itself while disconnected. The interval is the
         *  host's retry cadence, stated so the owner knows to wait rather than
         *  unplug anything. */
        disconnectedHint: "The host tries this panel again every 15 seconds.",
        /** The owner disconnected it. This is not the retry loop's state, so
         *  the surface must not promise the panel will come back on its own. */
        stoppedHint:
          "Disconnected by hand. It stays off until you reconnect it or Yunari restarts.",
        reconnect: "Reconnect",
        reconnecting: "Reconnecting…",
        reconnectFailed: (reason: string): string =>
          `The panel could not be reconnected: ${reason}`,
        disconnect: "Disconnect",
        disconnecting: "Disconnecting…",
        disconnectFailed: (reason: string): string =>
          `The panel could not be disconnected: ${reason}`,
        dialogTitle: (panel: string): string => `Controls — ${panel}`,
        close: "Close",
        brightness: "Brightness",
        brightnessHint: "A whole percent from 0 to 100.",
        apply: "Apply",
        /** The level is refused here rather than by the host, so a bad value
         *  costs no round trip. The range is the panel's own: a percent. */
        brightnessRange: "Brightness must be a whole percent from 0 to 100.",
        screenOn: "Turn the screen on",
        screenOff: "Turn the screen off",
        /** Stored on the panel and applied when it powers on. The panel has no
         *  read-back, so these open at what this form last sent. */
        settingsHeading: "Stored settings",
        settingsHint: "These live on the panel and apply when it powers on.",
        startMode: "On power-up",
        startModeOptions: ["Default", "Image", "Video"] as const,
        flip: "Upside down",
        sleepDelay: "Sleep after",
        /** The panel's own scale: index 0 is no sleep, 1 to 10 are its steps. */
        sleepDelayOptions: [
          "No sleep",
          "1",
          "2",
          "3",
          "4",
          "5",
          "6",
          "7",
          "8",
          "9",
          "10",
        ] as const,
        applySettings: "Apply settings",
        restart: "Restart",
        confirmRestart: "Confirm restart",
        cancel: "Cancel",
        /** Asked before the press that drops the panel. */
        restartWarning:
          "The panel goes away for about 15 seconds and comes back on its own.",
        status: "Query status",
        hello: "Identify",
        /** The panel's own words, shown only when it answered. A write-only
         *  command has an empty reply, so the host says the command was sent
         *  instead, under a label that does not call that sentence a reply. */
        replyLabel: "Panel reply",
        commandLabel: "Last command",
        sent: "Sent",
        /** The host's or the panel's own words, shown inline: a refusal caused
         *  by a closing port is the reason a person needs, not a generic lead. */
        failed: (reason: string): string =>
          `The panel did not take that: ${reason}`,
      },
    },
    devices: {
      heading: "Devices on the Host",
      hint: "Which hardware the Host reports. These apply to every theme, unless a theme asks for something different.",
      groups: {
        gpu: "Graphics card",
        "system-disk": "System disk",
        "data-disk": "Data disk",
      } as const satisfies Record<AssignableGroup, string>,
      /** What a slot does when nothing has been chosen, in the words a consumer
       *  would use. The empty answer is a rule about the Host and not a device:
       *  naming it after discovery order puts a machine's bookkeeping in the
       *  same list as the model numbers a person bought. */
      automatic: {
        gpu: "Automatic (the first card the Host reports)",
        "system-disk": "Automatic (every drive, combined)",
        "data-disk": "Automatic (every drive, combined)",
      } as const satisfies Record<AssignableGroup, string>,
      /** What a slot's own question is, where one question is not enough for
       *  the whole page: the two disk slots read the same sensor on two drives,
       *  so the legend was the only thing telling them apart. The card slot has
       *  none — one question covers it — so its label is the count's below. */
      // Typed as the partial it is rather than narrowed to the two keys it
      // holds, so a lookup by any slot compiles and answers `undefined` for the
      // card slot — which is what its count-based label is for.
      asked: {
        "system-disk": "Which drive does the Host run from?",
        "data-disk": "Which second drive should dashboards show?",
      } as Partial<Record<AssignableGroup, string>>,
      /** What a slot with no question of its own is labelled. */
      question: "Which device should dashboards use?",
      /** One device is not a question, so the label answers it. */
      onlyOne: (name: string): string =>
        `Only one found — dashboards use ${name}`,
      namesHeading: "Names",
      namesHint:
        "What dashboards call each device. Leave one blank to use the name it reports.",
      namePlaceholder: "Use the reported name",
      empty:
        "No graphics card or disk was reported. Start LibreHardwareMonitor " +
        "with its web server enabled, then reopen Host.",
    },
    display: {
      heading: "Display",
      /** The two section headings on the Units & time page. The page's own name
       *  is neither: one group is the clock and temperature system, the other
       *  is the family grid. */
      clockHeading: "Clock & temperature",
      unitsHeading: "Units",
      hint: "How the Host's readings are shown. A theme decides how a clock reads; this decides which zone it reads and which units temperatures use.",
      timeZone: "Clock time zone",
      ownZone: "Host's own zone",
      measurement: "Temperature units",
      /** The systems by the unit they read in, which is the choice rather than
       *  its name: `metric` and `imperial` say nothing about a thermometer. The
       *  host page adds the unit's own mark and this table cannot — a
       *  pictograph is not copy (`ui-copy.test.ts`), and the mark a reading
       *  prints is the renderer's. */
      metric: "Celsius",
      imperial: "Fahrenheit",
      /** The per-family units a reading can be shown in. Each family's values
       *  are its own, and the empty answer is not offered: an unchosen family
       *  is shown on its default, and the control prints that default. */
      units: {
        clock: {
          label: "Clock speed",
          values: { auto: "Automatic", mhz: "MHz", ghz: "GHz" },
        },
        data: {
          label: "Data size",
          values: { binary: "Binary (GiB)", decimal: "Decimal (GB)" },
        },
        dataScale: {
          label: "Data scale",
          values: { auto: "Automatic", mb: "MB", gb: "GB", tb: "TB" },
        },
        rate: {
          label: "Transfer rate",
          values: { bits: "Bits", bytes: "Bytes" },
        },
        rateScale: {
          label: "Rate scale",
          values: { auto: "Automatic", k: "kb/s", m: "Mb/s", g: "Gb/s" },
        },
        windSpeed: {
          label: "Wind speed",
          values: { kmh: "km/h", mph: "mph", ms: "m/s" },
        },
        pressure: {
          label: "Pressure",
          values: { hpa: "hPa", inhg: "inHg" },
        },
      },
    },
    weather: {
      heading: "Weather",
      hint: "Where the Host's weather comes from. A manual place needs no permission; Windows location fills the gap when none is set.",
      provider: "Backend",
      /** What each backend costs: the three are names a person knows from the
       *  key they bought, not descriptions of an API. */
      providers: {
        "open-meteo": "Open-Meteo (no key)",
        weatherapi: "WeatherAPI (key required)",
        openweathermap: "OpenWeatherMap (key required)",
      },
      label: "Place",
      latitude: "Latitude",
      longitude: "Longitude",
      windowsLocation: "Use Windows location when no place is set",
      pollInterval: "Poll every",
      seconds: "s",
      search: "Find a place",
      searching: "Searching for places…",
      noResults: "No place matched that search.",
      searchFailed: (reason: string): string => `Could not search: ${reason}`,
    },
    /** The custom HTTP sources the Host reads. The page names the source and
     *  never its secret: a source carries a credential id, and no credential
     *  value ever reaches the browser (`credentials-client.ts`). */
    sources: {
      heading: "Custom sources",
      hint: 'Readings from an HTTP endpoint on this network. Each field becomes a key a theme can read, named "custom.source-id.field-id".',
      empty: "No custom sources yet.",
      add: "Add source",
      edit: "Edit",
      remove: "Delete",
      test: "Test",
      testing: "Testing…",
      /** One accessible name per row's command, because three rows of "Edit"
       *  are three buttons a screen reader cannot tell apart. */
      editSource: (name: string): string => `Edit ${name}`,
      testSource: (name: string): string => `Test ${name}`,
      deleteSource: (name: string): string => `Delete ${name}`,
      deleting: "Deleting…",
      deleteFailed: (reason: string): string => `Could not delete: ${reason}`,
      id: "Id",
      /** A source id is embedded in every theme key that reads it
       *  (`custom.<id>.<field>`), so an edit keeps it: a rename would be a new
       *  source plus rebinding, not an in-place change. */
      idFixed:
        "A source's id cannot change: themes read its fields as custom.id.field, so a new id needs a new source and rebinding.",
      name: "Name",
      url: "Address",
      /** What the address is, and what it is not: a key referenced through
       *  `auth` travels in a header or a query the host adds, never in the
       *  address this page prints. */
      urlHint:
        "An http or https address, shown as you typed it. A key is never added to it here.",
      interval: "Poll every",
      timeout: "Timeout",
      seconds: "s",
      fields: "Fields",
      fieldId: "Field id",
      fieldLabel: "Label",
      fieldPointer: "JSON pointer",
      fieldType: "Type",
      fieldUnit: "Unit",
      addField: "Add field",
      removeField: (id: string): string => `Remove field ${id}`,
      types: {
        number: "Number",
        text: "Text",
        boolean: "True/false",
      } satisfies Record<"number" | "text" | "boolean", string>,
      save: "Save",
      cancel: "Cancel",
      health: {
        ok: "Reading",
        error: "Error",
        waiting: "Waiting",
      } satisfies Record<"ok" | "error" | "waiting", string>,
      lastSuccess: (at: string): string => `Last read ${at}`,
      neverRead: "No successful read yet",
      /** The local checks mirror the host's own limits
       *  (`packages/host/src/settings/sources.ts`) so a typo is refused before
       *  a round trip; the route's `400 {field, reason}` stays the authority. */
      invalidId: "Use 1–32 lowercase letters, digits, - or _.",
      invalidUrl:
        "Enter an http or https address with no username or password.",
      invalidInterval: (min: number, max: number): string =>
        `Poll at least ${min} and at most ${max} seconds.`,
      invalidTimeout: (min: number, max: number): string =>
        `Set a timeout of ${min}–${max} seconds.`,
      invalidFieldId: (id: string): string =>
        `The field id ${id === "" ? "(blank)" : `"${id}"`} is not 1–32 lowercase letters, digits, - or _.`,
      duplicateField: (id: string): string =>
        `Two fields share the id "${id}".`,
      tooManyFields: (max: number): string =>
        `A source carries at most ${max} fields.`,
      fieldCount: (count: number): string =>
        `${count} ${count === 1 ? "field" : "fields"}`,
      removeAsk: (name: string): string =>
        `Delete ${name}? Its fields stop resolving on every display.`,
      confirmRemove: "Delete",
      keep: "Cancel",
      /** The offer after a delete: the route answered that no source references
       *  this credential any more. The id is an id, never the value. */
      credentialAsk: (id: string): string =>
        `No other source uses the key ${id}. Remove it from the Host?`,
      removeCredential: "Remove the key",
      keepCredential: "Keep the key",
      credentialRemoved: "The key was removed.",
      credentialFailed: (reason: string): string =>
        `Could not remove the key: ${reason}`,
      saved: "Saved. Displays update on the source's next poll.",
      removed: (name: string): string => `Removed ${name}.`,
      testLine: (
        ok: boolean,
        status: number | undefined,
        elapsedMs: number,
        // `undefined` only for the copy walker, which probes a function with
        // one argument; a surface always passes a list.
        values:
          | readonly { readonly id: string; readonly value: string }[]
          | undefined,
        reason: string | undefined,
      ): string => {
        if (!ok) {
          return `Test failed: ${reason ?? (status === undefined ? "the host refused it" : `HTTP ${status}`)}`;
        }
        const code = status === undefined ? "" : ` (HTTP ${status})`;
        const mapped =
          values === undefined || values.length === 0
            ? "no value mapped"
            : values.map((entry) => `${entry.id} ${entry.value}`).join(", ");
        return `Test passed${code} in ${elapsedMs} ms · ${mapped}`;
      },
    },
    /** The questions the theme on the chosen display raises. Only the ones it
     *  has not answered are drawn, so answering one is what makes it leave. */
    questions: {
      heading: (theme: string): string => `${theme} needs`,
      hint: "This theme reads hardware that has no answer yet. Pick a device, or leave it following the Host's settings.",
      inherit: "Use the Host's settings",
    },
    /** The region's own status line, which is the host page's: its two halves
     *  are the display count and the last write's answer. */
    status: {
      displays: (count: number): string =>
        `${count} ${count === 1 ? "display" : "displays"}`,
      ready: "Changes apply to every display immediately.",
      saving: "Saving…",
      savedDevices: "Saved. Displays update on their next frame.",
      /** The clock's own write, and it reads as the device save's because the
       *  page this absorbs spells one sentence for both — but they are two
       *  writes, so a key named for one cannot answer the other. */
      savedZone: "Saved. Displays update on their next frame.",
      /** The units are read once, when a display loads, so the sentence says
       *  which screens the change has not reached yet — the page's own. */
      savedUnits:
        "Saved. Displays already open keep their old units until they reload.",
      savedAnswers: "Saved. Only this theme is affected.",
      savedWeather:
        "Saved. Weather readings update on the backend's next poll.",
      failed: (reason: string): string => `Could not save: ${reason}`,
    },
  },
  /**
   * How a chord reads. What a key *prints* is deliberately not here: the caps
   * and the marks for unnamed keys are the platform's own and change with
   * neither language nor product, so they live beside the formatter that spells
   * them (`shortcut-manager/display.ts`) rather than in a table of words a
   * translator would change. The rule above is what keeps that honest — `⌘` is
   * a `\p{S}` pictograph, and a copy table that admits one has stopped being
   * one.
   *
   * `alternativeSeparator` is between two chords one action answers to, and is
   * the layer panel's `boundSeparator` idiom one surface over — punctuation,
   * because a word would read as part of a key name.
   *
   * The group names are keyed by the prefix of an action id, which is what
   * makes a new prefix a compile error rather than a heading nobody wrote — and
   * a group word for a prefix no action carries a compile error too, so a
   * heading cannot outlive the actions under it. `help` therefore arrives with
   * the first `help.*` action rather than ahead of it.
   */
  shortcuts: {
    reference: "Keyboard shortcuts",
    close: "Close",
    alternativeSeparator: " · ",
    groups: {
      file: "File",
      edit: "Edit",
      canvas: "Canvas",
      publish: "Publish",
      view: "View",
      help: "Help",
    } satisfies Record<ShortcutPrefix, string>,
  },
  file: {
    newDocument: "New theme",
    /** The finder's one entry in this menu. It sits above *Open recent*
     *  because both are editor-level rather than one theme's. */
    findAssets: "Find assets…",
    /** The reference composition, offered as what it is: a template the
     *  product ships. `New` is the author's own blank document; this is the one
     *  they can open a copy of. */
    newFromTemplate: "New from template",
    /** **Import theme**, a toolbar button. It is the store mode's own action
     *  and what the press does: the theme package is written into the library
     *  and the open document is untouched. The store's `open` action is the
     *  route that opens a document. */
    importPackage: "Import theme",
    /** **Activate**: puts the stored theme on the display that holds no theme
     *  of its own, so the player switches to it. A document that is not stored
     *  is saved first — the display cannot show a theme the host does not
     *  hold. */
    activate: "Activate",
    /** A package with a bumped version, written the same way: the release the
     *  author hands on, not the save that keeps their work. It is also where
     *  the plain package download lives now — there is no separate row. */
    exportTheme: "Export theme",
    openLibrary: "Open",
    /** The newest stored theme that is not the open document, opened by its own
     *  `openById` road so the replacement question and the base stay there. */
    openRecent: "Open recent",
    saveLibrary: "Save",
    /** Writes the open document under a new theme id, leaving the theme it came
     *  from as it is. The editor then continues as the new theme. */
    saveAs: "Save as",
    /** Exports the current selection as a `yunari-widget-package`: the objects,
     *  their bindings, the globals they use and the files they reference. */
    exportWidget: "Export selection as widget",
  },
  /** The chooser `New` opens before the document exists. It asks for a size and
   *  nothing else; the size controls are the artboard panel's own labels, so
   *  only this surface's words are here. The preview lens is read off the
   *  artboard rather than asked. */
  newDocument: {
    chooseSize: "Choose an artboard size",
    /** The authored canvas's outline, distinct from the ratio: a circle is
     *  drawn on a square artboard rather than being one. */
    shape: "Shape",
    create: "Create",
    cancel: "Cancel",
  },
  /**
   * The Themes mode's own words — the store surface, whose region's header row
   * is its own rather than the shell's.
   */
  store: {
    /** The store's two halves, which the region's own `Segmented` names. The
     *  two labels are the surfaces' tab words, and
     *  `label` is the group's name: the two labels inside are the options, so a
     *  group with no name announces "Your themes, pressed" with nothing saying
     *  what is being chosen. The host's own library comes first, because it is
     *  what an author already has. */
    halves: {
      label: "Theme libraries",
      local: "Local library",
      online: "Online store",
    },
    /** The author's own listing, behind a toggle in the online half's row. The
     *  empty sentence is the surface's own: an author with nothing submitted is
     *  not a store with nothing published. */
    mine: {
      label: "Mine",
      empty: "You have no store submissions yet.",
    },
    /** The states a Mine row can carry, as the word beside it. `published` has
     *  no badge word because the public surface already shows it, and `draft`
     *  is not a state this surface explains yet: a badge word the surface cannot
     *  account for is worse than none. `published` is still here because a
     *  landed submission's footer names the state beside its version.
     *
     *  **The two sentences are the modal's, not the cell's**: a badge is a word
     *  and a reason is a sentence, and the item's own surface is the one that
     *  says what the state means. `removedPermanent` is stated beside the
     *  owner's reason because it is the fact a reason alone may not carry. */
    status: {
      pending: "Pending",
      published: "Published",
      unpublished: "Unpublished",
      rejected: "Rejected",
      removed: "Removed",
      pendingReview: "Waiting for the owner's review.",
      removedPermanent:
        "The owner removed this item; it cannot be republished.",
      /** The fallback for a non-2xx the host answered with no sentence of its
       *  own. A refusal is the Worker's words where they exist, so this is
       *  drawn only where they do not (`mine-listing.ts`). */
      changeRefused: (status: number): string =>
        `The store refused the change (${status}).`,
      /** The store accepted the command but the author's rows could not be read
       *  back: the change landed, so silence would leave a stale word on screen. */
      unrefreshed:
        "The change was saved, but your items could not be refreshed.",
    },
    /** The author's own two commands, drawn in the item's modal only: they act
     *  on the author's store row, where the cell's four actions act on the
     *  library copy, so they are not `cell.actions` entries. */
    actions: {
      unpublish: "Unpublish",
      republish: "Republish",
    },
    /** The search well's name and the word it shows while empty, as one string:
     *  a placeholder that could disagree with the name would be a second copy of
     *  one fact. What a query filters and pages is A.4's and A.5's. */
    search: "Search themes",
    /** The five facets, in the order the row draws them. The values each
     *  offers are derived from the items, so the only words here are the ones a
     *  value cannot carry itself. */
    facets: {
      label: "Filter themes",
      author: "Author",
      colourMode: "Color mode",
      sensors: "Sensors",
      shape: "Shape",
      style: "Style",
      /** The Sensors facet's headings: one per family the vocabulary files a
       *  semantic key under, so a person choosing values sees them grouped the
       *  way `describeSemanticKey` groups them rather than in one flat list.
       *
       *  Typed from `SemanticFamily`, so a family added to the vocabulary
       *  without a word fails to compile here rather than printing an identifier
       *  at a person. A key this build does not know has no family and is drawn
       *  under no heading at all, which is the vocabulary's own answer. */
      sensorFamilies: {
        cpu: "CPU",
        ram: "RAM",
        gpu: "GPU",
        vram: "VRAM",
        disk: "Disk",
        network: "Network",
        time: "Time",
        date: "Date",
      } as const satisfies Record<SemanticFamily, string>,
      /** The Shape facet's three headings, in the surface's own order: the
       *  orientation words, the aspect buckets and
       *  the exact pixel sizes. */
      shapeGroups: {
        orientation: "Orientation",
        aspect: "Aspect ratio",
        size: "Pixel size",
      },
      /** What the Shape popover says above its three groups, because choosing
       *  in two of them is not an "either": a theme must match every group it
       *  is asked about, which is R115's rule and the reason the groups are
       *  labelled at all. */
      shapeHint: "A theme must match every group.",
      /** A value facet's search field. One name for all four: the popover they
       *  sit in is already named by the facet, so a sentence repeating it would
       *  print the facet's name twice to a screen reader. */
      search: "Search values",
      searchPlaceholder: "Search values",
      /** A query that matches no value, where the facet does have values. */
      noSearchMatches: "No value matches that search.",
      /** A facet whose values the listing does not carry; the surface says so
       *  rather than drawing a popover that looks like a failed load. */
      empty: "No theme declares a value for this filter.",
      /** The colour facet's own empty sentence: a library of themes with a
       *  picture behind the board has no background colour for the record to
       *  classify, which is why it offers neither mode. */
      colourModeEmpty:
        "No theme declares a background color, so this filter has no values.",
    },
    /** The facet values that are words rather than data: the two colour modes a
     *  person can ask for, the three orientations, and the aspect bucket that is
     *  a word. Everything else a facet offers is the record's own reading — an
     *  author's name, a sensor's `label`, a ratio, a size — and reads as itself.
     *
     *  **`unclassified` is deliberately absent.** It is the absence of an answer
     *  rather than one a person can ask for, so it is reachable under "any" and
     *  under no other value (R117);
     *  a chip for it would be a selection that matches nothing.
     *
     *  Typed from the record's own unions, so a colour mode or an orientation
     *  added there without a word fails to compile here rather than printing an
     *  identifier at a person. */
    colourModes: {
      light: "Light",
      dark: "Dark",
    } as const satisfies Record<Exclude<ColourMode, "unclassified">, string>,
    orientations: {
      landscape: "Landscape",
      portrait: "Portrait",
      square: "Square",
    } as const satisfies Record<Orientation, string>,
    /** The one aspect bucket that is a word rather than a ratio: the bucket a
     *  theme lands in when it is further from every published ratio than the
     *  tolerance, and every exact size is reachable under it. */
    otherShape: "Other",
    /** An exact artboard size as one reading. A multiplication sign rather than
     *  the letter `x`, which is what the surface prints and what keeps a size
     *  from reading as the ratio written the same way. Keyed because the two
     *  numbers are data. */
    size: (width: number, height: number): string => `${width}×${height}`,
    /** **The origin word, and the only one**: the badge a local cell draws and
     *  the first clause of the item's provenance line, so the two surfaces say
     *  one fact in one way.
     *
     *  **It is *From the store* and never *Installed*.** Every local cell is
     *  badged with this word and *Installed* is the **online** half's own footer
     *  verb, where a theme is read against the catalogue rather than against this
     *  machine's copy. The
     *  two halves show one fact two ways; renaming this one to *Installed* is the
     *  change that collapses them. */
    fromStore: "From the store",
    /** Between two readings on one mono line — the cell's author and date, the
     *  caption's version and date. Punctuation rather than a word, because a
     *  word here would read as part of the reading beside it, and it is drawn
     *  only where both readings exist. */
    readingSeparator: " · ",
    /** **The catalogue's two counts are numbers, so they need a noun to be a
     *  reading, and the noun inflects.** The figure is what the eye sees and
     *  the noun follows it as `sr-only` text, with the separating space part of
     *  that text: `Glyph` is `aria-hidden`, so a bare `1,204` is announced as an
     *  isolated number with nothing saying what it counts, and without the space
     *  a reader hears `1,204downloads`. One is a real case — a new item has one
     *  favourite — so each word answers the number it is counted with. The cell
     *  draws downloads and the modal draws both, so the words live here rather
     *  than beside either surface. */
    counts: {
      downloads: (count: number): string =>
        count === 1 ? "download" : "downloads",
      favorites: (count: number): string =>
        count === 1 ? "favorite" : "favorites",
    },
    /** One line per refusal from the catalogue read, **naming the identifier the
     *  catalogue used**: a kind this build does not ship has no display word, and
     *  inventing one would be a word for something nothing declared. An
     *  entry that declared no kind at all is named by nothing, so the sentence
     *  says where it was rather than what it claimed. */
    catalogueRefused: (kind: string | undefined, count: number): string =>
      `${count} ${count === 1 ? "entry" : "entries"} ${kind === undefined ? "in the store" : `of kind ${kind}`} could not be read.`,
    /** The online half's install, whose sentences the client composes where the
     *  host's own words cannot reach: a library item has no package (the
     *  controls never draw for one, so this is a guard's answer), a refusal with
     *  no body, a host that installed the theme but could not re-list it, and
     *  the success the live region announces. The host's own refusal sentence
     *  is passed through unchanged — it knows which part failed
     *  (`install-item.ts`). */
    install: {
      noCatalogueVersion: "This item has no catalogue version to install.",
      unreachable:
        "The Host could not be reached to install that item. Check Yunari is running, then try again.",
      refused: (status: number): string =>
        `The host refused the install (${status}).`,
      notRefreshed:
        "The theme was installed, but the library could not be refreshed.",
      /** A held update: the host read the package and answered with the plugin
       *  it names and the growth that held it. */
      reviewHeading: "Update held for review",
      reviewReasons: "This update asks for something new:",
      reviewApprove: "Install update",
      reviewDismiss: "Dismiss",
      /** The one sentence the live region hears when there is no refusal: a
       *  press that succeeded is otherwise silent to a screen reader, which
       *  cannot see the cell redraw as *Installed*. */
      installed: (name: string): string => `${name} was installed.`,
    },
    /** The library half's submission, whose sentence the client composes only
     *  where the host answers a state and no sentence exists: the wait for the
     *  sign-in, the status a landed submission carries, and the busy label.
     *  **A refusal is never composed here** — the host knows which part of the
     *  submission failed, so its own words are passed through unchanged
     *  (`use-submit.ts`). */
    submit: {
      label: "Publish to theme store",
      busy: "Submitting…",
      /** The host holds the sign-in conversation in its own window; this surface
       *  has no code to name, only the author's part left to do. */
      authorising: "Waiting for you to sign in…",
      /** What the store did with the submission: a new author's first items
       *  wait for the owner, so the sentence names the wait rather than a link
       *  this surface would have to invent. */
      submitted: (status: "pending" | "published"): string =>
        status === "pending"
          ? "Submitted. The owner reviews new authors' items before they are listed."
          : "Submitted and listed.",
      /** What the host published, in the caption's own shape: the version it
       *  bumped from, the one it wrote, and the ladder's word for the change.
       *  **A first release names no `from`** because there is none to name;
       *  `none` is the ladder's answer for an unchanged theme and is never
       *  reached by a submission that can land. */
      version: (version: {
        readonly from: string | null;
        readonly to: string;
        readonly level: VersionLevel;
      }): string =>
        version.level === "initial"
          ? `${version.to} · first release`
          : `${version.from ?? version.to} → ${version.to} · ${version.level}`,
      /** Names the item an answer belongs to. The live region outlives the
       *  modal, so an answer for one item can arrive while another is open. */
      announcement: (name: string, sentence: string): string =>
        `${name}: ${sentence}`,
      /** The poll ran out or the retry still had no session: the one sentence
       *  the client composes because the host answered without one. */
      noSignIn: "The store did not confirm the sign-in; try submitting again.",
      /** Preparing the saved theme for the store failed before the host was
       *  asked. The library copy is unchanged, so the press can be repeated. */
      prepareFailed:
        "This theme's cropped pictures could not be prepared for publishing.",
      cancelled: "Publishing was cancelled; your library is unchanged.",
      /** A browser that blocks the popup left the flow with no window to finish
       *  it in, so the author is told to act on the blocker. */
      blocked: "This browser blocked the sign-in window.",
      /** A landed answer whose state no footer draws: the state is named, so a
       *  host and client that disagree cannot put JSON on screen. */
      unexpectedState: (status: string): string =>
        `The store answered an unexpected state (${status}); try submitting again.`,
    },
    /** The item's own surface. */
    item: {
      close: "Close",
      /** The four commands' short words, **for this surface only**: the panel
       *  foot is four boxes a little over 100px wide, and the cell's long words
       *  (`cell.actions`) do not fit. Keyed by
       *  `CellAction`, so an action added to the union fails to compile. */
      actions: {
        open: "Edit",
        assign: "Assign",
        export: "Export",
        delete: "Delete",
      } satisfies Record<CellAction, string>,
      /** The credit a remixed item carries. The name is the snapshot the
       *  document recorded, so the sentence is stable whether or not the parent
       *  is still in the index. */
      remixedFrom: (name: string): string => `Remixed from ${name}`,
    },
    /** The modal's pill groups, which are the facet's own content under the name
     *  the surface gives it: the row names what a filter narrows by (*Sensors*,
     *  *Colour mode*), and the modal names what the theme reads, how it is shaped
     *  and what style it carries.
     *
     *  **Style is drawn only where the theme declares a tag.** `PillGroup`
     *  refuses to render a heading over nothing, so a library of untagged
     *  themes draws two groups rather than an empty third. The word its proposed
     *  pill carries is the field's own (`panels.tagsProposed`), because the
     *  same pill appears on the modal and in the field alike. */
    pillGroups: {
      reads: "Reads",
      shape: "Shape",
      style: "Style",
    },
    /** The two empties, which are two sentences because they have two answers: a
     *  library with nothing in it is not a filter that matched nothing, and
     *  telling someone with forty themes to go and build one is a lie the
     *  surface avoids by having both. */
    empty: {
      library: "No themes are saved on the Host yet.",
      libraryHint: "Build one in the editor, or import a package.",
      /** **The catalogue's own empty state, and not the library's** (R124):
       *  before the store has anything published this is the normal state, so
       *  the sentence must not tell someone with a full library that it is
       *  empty. */
      catalogue: "The store has nothing yet.",
      catalogueHint: "Themes published to the store will appear here.",
      filter: "No themes match these filters.",
    },
    /** **A read that failed is not one of the empties.** The library and the
     *  catalogue each have an empty sentence for a successful read that held
     *  nothing; neither may be drawn when nobody answered, because saying a
     *  half is empty to someone whose host refused the request is a fabricated
     *  fact. This is the sentence that says the read failed instead. */
    unreadable: {
      local: "Your themes could not be read.",
      online: "The store could not be read.",
    },
    /** The failure's one way forward: read the same listing again. */
    retry: "Try again",
    /** A removal the host refused, in the host's own words where it gave
     *  them: the theme is still in the library, so this is a PC that could not
     *  move one to its recycle bin rather than a lost document. */
    deleteFailed: (reason: string): string =>
      `Could not delete the theme: ${reason}`,
    /** A client that cannot delete is offered no deletion; the cell still
     *  reports the press rather than failing at the moment it is made. */
    deleteUnavailable: "This host cannot delete themes.",
    /** The confirmation a removal asks for: the host's trash is recoverable,
     *  and the sentence is how the author knows where the theme went. */
    deleteConfirm: {
      title: "Delete this theme?",
      note: "The theme will be moved to the Recycle Bin, where you can restore it.",
      cancel: "Cancel",
      confirm: "Delete",
    },
    /** An export that could not be read back or written, in the failure's own
     *  words: nothing was downloaded, so the sentence is the whole outcome. */
    exportFailed: (reason: string): string =>
      `Could not export the theme package: ${reason}`,
    /** The sort well, whose keys are per half because the two share none: the
     *  catalogue knows when an item was published and how often it was taken,
     *  and the host's library knows only what the author wrote. */
    sort: {
      label: "Sort themes",
      local: { name: "Name", updatedAt: "Updated" },
      online: {
        created: "Created",
        updated: "Updated",
        downloads: "Downloads",
        favorites: "Favorites",
      },
    },
    /** One cell of either gallery. The actions are keyed by `CellAction`, so an
     *  action added to the cell without a word for it fails to compile rather
     *  than drawing an icon-only button nobody can name.
     *
     *  **The origin badge's word is not here**: the item's own surface says the
     *  same fact, so it is one key at `store.fromStore` rather than two. */
    cell: {
      /** A theme whose document declares no author. A fact about the theme
       *  rather than a missing reading, which is why it is a word and not the
       *  gap's blank. */
      noAuthor: "No author",
      /** The four actions, as the facts band orders them. Spelled as
       *  the surface does — **Open in editor**, **Assign to display**, **Export
       *  package** and **Delete** — because each names the operation the library
       *  already has rather than the mechanism behind it. */
      actions: {
        open: "Open in editor",
        assign: "Assign to display",
        export: "Export theme package",
        delete: "Delete",
      } satisfies Record<CellAction, string>,
      /** The online half's three answers, keyed by `InstallState` less `none`
       *  — a library item has no catalogue to be installed from, so it draws
       *  the local half's four actions rather than one of these. */
      installStates: {
        installed: "Installed",
        update: "Update",
        install: "Install",
      } satisfies Record<Exclude<InstallState, "none">, string>,
      /** What each kind is called, keyed by its wire identifier. The online
       *  cell draws this badge in its facts band, and the item's own surface
       *  draws the same word. A kind
       *  this build does not know prints its own identifier, which is what a
       *  client older than the kind expects. */
      kinds: { [DASHBOARD_THEME_KIND]: "Theme" } as Readonly<
        Record<string, string>
      >,
    },
    /** The display choice a cell's **Assign to display** opens. Its name is the
     *  action's own word (`cell.actions.assign`), so the two cannot disagree. */
    assign: {
      /** The select's own label. Distinct from the action's word, which names
       *  the dialog: a label repeating the title printed over the control reads
       *  twice (`theme-library-dialog.tsx`). */
      display: "Display",
      /** The key the route gives the theme a display with no choice of its own
       *  falls to. It is offered *beside* the displays and never as one of them
       *  — a theme id is not a display id — and the host's own page calls it
       *  *Default* (`theme-list.js`). */
      default: "Default",
      /** The way out of the choice, for a pointer or a touch screen reader. */
      close: "Close",
      /** The confirming press: choosing a display stages it, and this writes
       *  the assignment. Its two other words are the write's own states, so a
       *  press that is out cannot read as one that has not been made. */
      assignButton: "Assign",
      assigning: "Assigning…",
      assignedButton: "Assigned",
      /** What a landed assignment says where the choice stays on screen. It
       *  names the display, so the confirmation is the assignment rather than
       *  a bare "done" (`assign-display.tsx`). */
      assigned: (where: string): string => `Assigned to ${where}`,
    },
    /** The grid's density slider. Its four levels are named rather than
     *  numeric: the count is derived from the pane's width, so a number would
     *  move on resize while the choice stayed still. */
    density: {
      label: "Density",
      levels: {
        compact: "Compact",
        comfortable: "Comfortable",
        roomy: "Roomy",
        spacious: "Spacious",
      },
    },
  },
  /** The library chooser. Its two groups say which kind of thing a row is: a
   *  template the product offers, or a theme the author made and can delete. */
  library: {
    choose: "Open a theme",
    /** The control's own name. Distinct from `choose`, which titles the
     *  dialog; a label repeating the title printed over the control. */
    themeField: "Theme",
    templates: "Templates",
    yourThemes: "Your themes",
    open: "Open",
    /** The fork of an installed theme: a new document, minted id, credited
     *  parent. Disabled where there is no origin to name. */
    remix: "Remix",
    cancel: "Cancel",
    /** **What the removal confirmation says, in one sentence.** It names the
     *  theme and where it goes because a confirmation that says only "Delete?"
     *  confirms the button rather than the act. The dialog says it twice — as
     *  its accessible name and as its visible lead — so it is one entry: two
     *  literals were one edit from a screen reader and a sighted reader being
     *  told different things. */
    confirmRemoval: (id: string, name: string | undefined): string =>
      `Move this theme to the recycle bin?\n\n${name ?? id} (${id}) will be moved to the recycle bin, where you can get it back.`,
    /** The dialog a refused save raises. Two answers and a way out, because a
     *  refusal must not cost the author their document and must not be a dead
     *  end: reload takes the stored version, overwrite keeps theirs, and
     *  cancelling keeps both. */
    conflict: {
      lead: "This theme was changed somewhere else since you opened it. Your work is still here.",
      reload: "Open the saved version",
      overwrite: "Replace it with mine",
      cancel: "Keep editing",
    },
    /** **Save as**: names the new theme the open document is written under. The
     *  lead says what the act leaves alone, because saving over the open theme
     *  is the other File row and the two must not read alike. */
    saveAs: {
      title: "Save as a new theme",
      lead: "Save this document under a new theme name. The theme it came from stays as it is.",
      name: "Theme name",
      action: "Save as",
    },
    /** The status line's word after a save-as, naming the theme the editor now
     *  continues as. */
    savedAs: (name: string): string => `Saved as ${name}`,
    /** A landed Activate. It says what the host now holds rather than "the
     *  player switched", because the write is to the default assignment: a
     *  display with a theme of its own keeps showing it. */
    activated:
      "Activated: displays with no theme of their own now show this one.",
    /** A refused Activate, carrying the host's own sentence — "No such theme."
     *  or "No such display." — unwrapped. */
    activateFailed: (reason: string): string => `Could not activate: ${reason}`,
    /** Open recent with no candidate: every stored theme is the open one, or
     *  the library is empty. Said rather than left silent, because a menu row
     *  that does nothing is indistinguishable from a broken one. */
    noOtherTheme: "No other saved theme to open.",
  },
  /** The package the picker brings in. Its landing word says what happened — a
   *  package written into the library — because the same line used to report a
   *  document opened, and only one of those two is true now. A refusal carries
   *  the reader's or the host's own reason: what the author acts on is the
   *  reason, not this sentence. */
  themeImport: {
    landed: (id: string): string => `Imported ${id} to the library`,
    refused: (reason: string): string => `Could not import: ${reason}`,
  },
  /** The asset finder. A tab is a category, never a provider (R9), and the
   *  footer names the kind's own action rather than a bare "Import" (R5). */
  assets: {
    title: "Assets",
    /** The `Dialog.Close` the finder renders, as Settings and the sheet do: a
     *  touch screen reader has no Escape key. */
    close: "Close",
    category: {
      font: "Fonts",
      icon: "Icons",
      image: "Images",
      video: "Videos",
      colour: "Colors",
      local: "Wallpaper Engine",
    } as const satisfies Record<BuiltinListingCategory, string>,
    action: {
      font: "Apply to token",
      icon: "Place on canvas",
      image: "Set as background",
      video: "Set as background",
      colour: "Add to presets",
      local: "Open in Wallpaper Engine",
    } as const satisfies Record<BuiltinListingCategory, string>,
    searchPlaceholder: "Search assets…",
    /** Each tab's own field, so the words name what is searched. */
    search: {
      font: "Search fonts…",
      icon: "Search icons…",
      image: "Search photos…",
      video: "Search videos…",
      colour: "Search colors…",
      local: "Search the Host…",
    } as const satisfies Record<BuiltinListingCategory, string>,
    searching: (sources: number): string =>
      `Searching ${sources} ${sources === 1 ? "source" : "sources"}…`,
    /** The pressed action's own word while it is out, so the footer never says
     *  the same "Working…" for a placement and a preset write. */
    busy: {
      font: "Applying…",
      icon: "Placing…",
      image: "Setting…",
      video: "Setting…",
      colour: "Adding…",
      local: "Opening…",
    } as const satisfies Record<BuiltinListingCategory, string>,
    /** The finder's double-click preview (R8): one result, enlarged, with the
     *  same actions the footer offers. A video result carries a poster only —
     *  no source serves a playable URL yet. */
    previewModal: {
      posterOnly: "A video result shows its poster until it is imported.",
      licence: "License",
      source: "Source",
    },
    /** What the footer says when an action succeeds without words of its own. */
    done: {
      font: "Applied to token.",
      icon: "Placed on canvas.",
      image: "Set as background.",
      video: "Set as background.",
      colour: "Added to presets.",
      local: "Opened in Wallpaper Engine.",
    } as const satisfies Record<BuiltinListingCategory, string>,
    endOfResults: "End of results",
    /** The footer's icon button that opens the same preview a double-click does. */
    previewOpen: "Preview",
    nothingToBrowse: "Nothing to browse here yet. Try a word.",
    emptyAfterFailure:
      "This tab's sources returned nothing. Retry, or try another word.",
    /** The body state for a tab whose sources all refused for want of a key.
     *  Retrying cannot install one, so the body names the control that can; the
     *  footer already carries the diagnosis, and this sentence never repeats it. */
    needsKeyBody:
      "Add the key this tab needs in Connections, then search again.",
    working: "Working…",
    retry: "Retry",
    connections: "Connections",
    /** The kind filter the Colours tab draws when its sources disagree about
     *  what they yield. The options derive from the sources' own
     *  `presetKind`, so only `all` is a fixed word. */
    kindFilterLabel: "Filter by kind",
    kindFilter: { all: "All", palette: "Palettes", gradient: "Gradients" },
    results: (count: number, sources: number): string =>
      `${count} ${count === 1 ? "result" : "results"} · ${sources} ${sources === 1 ? "source" : "sources"}`,
    noResults: "No results. Try another word.",
    kindSourcesOff:
      "Every source for this kind is switched off. Turn one on above.",
    clearQuery: "Clear query",
    noSource: "No source serves this category.",
    noSelection: "Choose a result first.",
    /** The shared skeleton's one spoken line; its shapes are hidden, so this is
     *  all a screen reader hears while a body is still loading. */
    skeletonLoading: "Loading assets…",
    sourceFailed: (label: string, message: string): string =>
      `${label} failed: ${message}`,
    needsCredential: (label: string): string =>
      `${label} needs a key this host does not have.`,
    connectionsAction: "Open Connections",
    openFontPicker: "Browse the font catalogue",
    /** The Fonts body's own search and filter row (R5). The old picker's
     *  facet vocabulary and rule sentence die with it in Task 13. */
    fontSearch: "Search trios and font names",
    /** The Fonts footer's two outcomes (R5, R6). The preview column's own
     *  Apply/Add controls moved here, so the label and the write agree. */
    fontApplyTrio: "Apply trio",
    fontAddPresets: "Add to presets",
    fontApplyToken: "Apply to token",
    /** A trio writes all three roles, so it cannot say it wrote one token. */
    fontTrioDone: "Applied to heading, body and mono.",
    fontApplyBusy: "Applying…",
    fontAddBusy: "Adding…",
    fontResults: "Font results",
    fontFilterLabel: "Filter results",
    fontFilter: { all: "All", trio: "Trios", family: "Fonts" },
    fontSortLabel: "Sort",
    fontSort: { name: "A–Z", provider: "Provider" },
    fontSourcesLabel: "Font sources",
    fontEmptyQuery: "Type a font name to find a trio or a family.",
    fontTrioMeta: (families: number): string =>
      `${families} ${families === 1 ? "family" : "families"}`,
    fontFamilyMeta: (cuts: number): string =>
      `${cuts} ${cuts === 1 ? "cut" : "cuts"}`,
    fontLoadMore: "Load more",
    /** The preview panel beside the grid (R6, R7, R9). The sample line is
     *  the author's own words, so its default is copy rather than a value the
     *  panel invents; the scope and change lines read the document's presets
     *  without the panel ever opening one. */
    fontPreview: {
      trioTitle: "Trio preview",
      familyTitle: "Font family",
      /** The star is the on/off channel; each state names the press it makes. */
      favorite: "Add to favorites",
      unfavorite: "Remove from favorites",
      sampleLabel: "Sample text",
      sampleDefault: "Runtime at a glance",
      sampleReset: "Reset",
      glyphs: "Aa Bb Cc Dd Ee Ff Gg 0123456789",
      appliesTo: "Applies to",
      addsMissingRoles: "adds missing roles",
      roleLabel: "Role",
      role: { heading: "Heading", body: "Body", mono: "Mono" },
      roleCount: (count: number): string =>
        `${count} ${count === 1 ? "token" : "tokens"}`,
      scopeCount: (role: string, count: number): string => `${role} × ${count}`,
      willBeCreated: "will be created",
      /** `Yaldevi · 300 → Manrope 700`: the token's own family and weight
       *  before the trio's family and weight after. */
      change: (
        name: string,
        weight: string | number | undefined,
        family: string,
        newWeight: string | number,
      ): string =>
        weight === undefined
          ? `${name} → ${family} ${newWeight}`
          : `${name} · ${weight} → ${family} ${newWeight}`,
      rolelessReason:
        "No token carries a role, so Apply to theme has nothing to rewrite.",
      applyToTheme: "Apply to theme",
      addThreePresets: "Add 3 tokens",
      cuts: "Cuts",
      /** `400 · latin`: the subset is named only when it is what tells two cuts
       *  apart, since weight and style alone can repeat across subsets. */
      cutLabel: (
        weight: string | number,
        italic: boolean,
        subset?: string,
      ): string => {
        const face = italic ? `${weight} italic` : String(weight);
        return subset === undefined ? face : `${face} · ${subset}`;
      },
      newPreset: "New type token",
      /** The detail beside the role chooser. It says what the press does to the
       *  chosen role — the same answer `replacesRole` gives — because one press
       *  reading "adds one" on the row and "replaces" underneath it is two
       *  promises about one write. */
      newPresetSummary: (
        role: string,
        family: string,
        replaces: boolean,
      ): string =>
        `${role} — ${family} · ${replaces ? "replaces its face" : "adds one"}`,
      addAsPreset: "Add as type token",
      /** A chosen role is the token's id, so adding to a role the theme already
       *  has rewrites that token's face rather than creating a second id. Said
       *  beside the Add button when that is what the press will do. */
      replacesRole: (role: string): string =>
        `Replaces the ${role} token's face.`,
      applyToSelected: "Apply to selected token",
      trioNote:
        "Apply rewrites every role token and adds any role the theme does not have. Add 3 tokens leaves the theme as it is.",
      familyNote:
        "Cuts are fetched when you add or apply one. A family you only look at costs nothing.",
    },
    remoteHostNotice: (hosts: string): string =>
      `Search terms go to ${hosts}. Nothing else leaves this computer.`,
    /** An image's second action: the theme's background is one thing an author
     *  wants, a picture on the canvas is another, and both are one press. */
    placeOnCanvas: "Place on canvas",
    /** The asset preview, opened from a card's Preview.
     *  One surface for an image, an SVG and a video; a font has no preview here
     *  because the finder owns a face's specimen. Its kind and In use words are
     *  the card's own, so the two surfaces cannot disagree. */
    preview: {
      close: "Close",
      shape: "Shape",
      attribution: "Attribution",
      noneRecorded: "None recorded",
      /** The caption's verb, without a measurement this build could not read. */
      fit: "fit",
      usedByNothing: "Used by nothing",
      /** The surface says `Used by N objects`; the manager's reachability
       *  answer is a boolean, so the line names the routes rather than a count
       *  nobody measured. */
      usedBySome: "Used by the artboard background, an object or a type token",
      /** The two commands the card's words do not fit: its Replace and Remove
       *  are reused, and these are the one-word forms the 2×2 foot draws. */
      background: "Background",
      place: "Place",
      size: fileSize,
    },
    pager: {
      pages: "Pages",
      previous: "Previous page",
      next: "Next page",
      page: (page: number): string => `Page ${page}`,
    },
    unknownAssetFile: "That asset is not a file type the editor can import.",
    hostUnavailable: "The host is not connected.",
    emptyIcon: "That icon had no shape to place.",
    bytesUnavailable: (name: string): string =>
      `The host did not send "${name}", so nothing was imported.`,
    creditsFull:
      "This theme already carries the last attribution it can hold, so the import would leave it unsavable.",
    /** The Colours tab's row action writes editor-local presets, so it reports
     *  what the library accepted rather than an import's own sentences. */
    presetAdded: (colours: number): string =>
      `Added ${colours} ${colours === 1 ? "color" : "colors"}`,
    gradientAdded: "Added gradient",
    presetAlreadyStored: "Already in presets",
    /** The Wallpaper Engine body. The host's own absence reason is the sentence
     *  the tab draws — "not installed" and "no library" are different problems
     *  for the person reading it. Each card carries one icon action; the
     *  sentences for its running, done and failed states are the tooltip and
     *  the one status line at the modal's bottom. */
    wallpaperEngine: {
      reason: {
        "not-installed": "Wallpaper Engine is not installed on the Host.",
        "unsupported-platform": "Wallpaper Engine is read only on Windows.",
        "no-library": "Wallpaper Engine holds no wallpaper library yet.",
      } satisfies Record<
        "not-installed" | "unsupported-platform" | "no-library",
        string
      >,
      kind: {
        video: "Video",
        scene: "Scene",
      } satisfies Record<"video" | "scene", string>,
      /** The container the host read from a video payload's bytes. */
      container: {
        mp4: "MP4",
        webm: "WebM",
        matroska: "Matroska",
        unknown: "Unknown container",
      } satisfies Record<"mp4" | "webm" | "matroska" | "unknown", string>,
      /** The publish envelope takes only an H.264 MP4, so a clip in another
       *  container cannot become the background and says so on its row. */
      onlyMp4: "Only an H.264 MP4 can become the background",
      size: fileSize,
      duration: clipDuration,
      search: "Search titles",
      filterKind: "Kind",
      filterAll: "All",
      /** The local library's order: three fields, each with both directions.
       *  `updated` is the item directory's last write, which is what a Steam
       *  subscribe or update changes. */
      sortLabel: "Sort by",
      sort: {
        name: "Name",
        updated: "Updated",
        size: "Size",
      } satisfies Record<"name" | "updated" | "size", string>,
      direction: {
        asc: "Ascending",
        desc: "Descending",
      } satisfies Record<"asc" | "desc", string>,
      guide: "Guide",
      refresh: "Refresh library",
      importPackage: "Import a .mpkg video",
      noMatches: "No wallpaper matches these filters.",
      empty: "This library holds no wallpapers Yunari can read.",
      /** One action per kind, and the three states its button can wear. */
      action: {
        video: {
          idle: "Set as background",
          running: "Setting…",
          done: "Background set",
        },
        scene: {
          idle: "Convert to local project",
          running: "Converting…",
          done: "Converted",
        },
      } satisfies Record<
        "video" | "scene",
        {
          readonly idle: string;
          readonly running: string;
          readonly done: string;
        }
      >,
      backgroundSet: (title: string): string =>
        `“${title}” is now the theme's background.`,
      /** R2's success: the project, and where in Wallpaper Engine to find it. */
      projectReady: (name: string): string =>
        `The project “${name}” is ready in Wallpaper Engine's My Projects.`,
      projectReused: (name: string): string =>
        `The project “${name}” already existed in Wallpaper Engine's My Projects, so nothing was changed.`,
      /** R2's failure names the host's reason code, so the author can tell a
       *  missing install from an unreadable scene. */
      projectFailed: (reason: string): string =>
        `The scene could not be converted to a local project (${reason}).`,
      /** A package import closes its own modal on success, so the body's one
       *  status line is where the outcome survives. */
      packageImported:
        "The .mpkg package is imported and set as the theme's background.",
      /** R5's two sections: what a conversion is for, and the manual export that
       *  follows it. The sequence is the engine's own menus, so a renamed item
       *  costs a sentence rather than a broken run. */
      guideSections: {
        convert: {
          heading: "Why convert to a local project",
          body: "Wallpaper Engine exports only a project you can edit locally, not a subscribed scene. Converting unpacks the scene into a project under Wallpaper Engine's My Projects. Open that project in the engine's editor, and remove or disable any dynamic text element there — a clock or weather label would otherwise be rendered into the video.",
        },
        export: {
          heading: "How to export a .mpkg",
          body: "In Wallpaper Engine, select the scene or project, right-click it, then choose Send to Mobile Device, then Export .mpkg, then Keep original aspect ratio, then Original, then Save. Then use Import a .mpkg video here.",
        },
      },
      guideTitle: "Wallpaper Engine guide",
      close: "Close",
    },
  },
  /** The prompt before a document is replaced, which the author reads on the
   *  way to losing their work. */
  replaceDocument: {
    question: "Save changes before opening another theme?",
    save: "Save",
    discard: "Discard",
    cancel: "Cancel",
  },
  /** The cleanup offered before either save: the files nothing holds, which
   *  the author may send to the platform's trash in the same press. The save's
   *  own title is the one it was pressed with (`file.saveLibrary` /
   *  `file.exportTheme`), so it is not repeated here. */
  /** The warning before an export or store submission flattens crops. It is
   *  not a save question: the library copy is untouched either way. */
  outputBake: {
    title: (action: string): string => `${action}: apply crops?`,
    body: (crops: number): string =>
      `${crops} ${crops === 1 ? "cropped picture is" : "cropped pictures are"} ` +
      "flattened in this copy, and source pixels outside each crop are left out. " +
      "Source files no longer used by the theme are left out too.",
    note: "Your library keeps the original picture and the live crop.",
    cancel: "Cancel",
    confirm: "Continue",
  },
  saveCleanup: {
    heading: "Unused files",
    count: (count: number, size: string): string =>
      `${count} ${count === 1 ? "file" : "files"} · ${size}`,
    /** Why nothing holds each file, in one owner keyed by kind. */
    reason: {
      image: "not on the canvas",
      svg: "not on the canvas",
      video: "not the background",
      font: "no type token refers to it",
    } satisfies Record<LocalAssetReference["kind"], string>,
    note: "Nothing on the canvas, the background, or a type token refers to these files. Their attribution goes with them.",
    removeAll: "Remove all unused assets",
    themeTooLarge: (size: string, limit: string): string =>
      `This theme comes to ${size}; a theme may be at most ${limit}. Remove an asset, then save again.`,
    warning:
      "Moves them to the Recycle Bin. The theme itself is saved either way.",
    cancel: "Cancel",
    sizes: (theme: string, unused: string): string =>
      `${theme} theme · ${unused} unused`,
  },
  /** The prompt after the editor stopped with work unsaved. The lead
   *  is the dialog's own visible name, so it names what is at stake — the theme
   *  and the moment the copy was written — rather than asking about "recovery",
   *  which names the mechanism and not the work the author might get back. */
  draftRecovery: {
    lead: (name: string, written: string): string =>
      `${name} was edited and not saved. This browser kept a copy written ${written}.`,
    restore: "Restore",
    discard: "Discard",
  },
  saveState: { unsaved: "Unsaved changes" },
  /** The status bar's own readings. `live` is the one word on the host mark the
   *  strip draws when the LAN is serving this document; the two counts are the
   *  strip's left half, which the status-bar rule makes the readouts it rests on. `objects`
   *  carries the noun because a bare number names nothing, and `selected` needs
   *  none because the word is the same at one and at many. */
  statusBar: {
    live: "live",
    objects: (count: number): string =>
      `${count} ${count === 1 ? "object" : "objects"}`,
    selected: (count: number): string => `${count} selected`,
    /** The Themes mode's own reading: what the chosen half and filters show. */
    themes: (count: number): string =>
      `${count} ${count === 1 ? "theme" : "themes"}`,
  },
  /** The title-bar counts: one per pane's own list, so a pane whose list has
   *  not loaded prints nothing rather than a `0` (the same rule `statusBar`'s
   *  counts take for a scene that has not mounted).
   *
   * `units` is the card library's own word for what it holds — a card is a
   * *unit* an author inserts (`card-library.ts`), and it is the word the Add
   * pane's title bar carries. `tokens` is the Tokens pane's own
   * list, the theme's paints; the reserved `none` is not one of them, because
   * `PaintList` lists every token but that one.
   *
   * **The Composition pane's count is deliberately not here.** Its list is the
   * scene's own objects, which the strip already names, so the pane reads
   * `statusBar.objects` rather than a second spelling of one fact — the
   * duplication the row accepted and named. */
  paneCounts: {
    units: (count: number): string =>
      `${count} ${count === 1 ? "unit" : "units"}`,
    tokens: (count: number): string =>
      `${count} ${count === 1 ? "token" : "tokens"}`,
    /** The Assets pane's list, which is the asset manager's declarations. */
    files: (count: number): string =>
      `${count} ${count === 1 ? "file" : "files"}`,
  },
  /** The publish surface. §145: plain LAN HTTP has no confidentiality, so the
   *  words that turn it on have to say what it is. */
  publish: {
    qrName: (url: string): string => `QR code: ${url}`,
    /** The display the open theme is put on, and the route for a display that
     *  is not listed yet. */
    displayLabel: "Display",
    pairNew: "Pair a new remote display",
    pairUnavailable: "Turn on publishing to pair a display.",
    assignFailed: (reason: string): string => `Could not assign: ${reason}`,
    /** The `?` sheet's row for the header's chord. The chord opens the surface
     *  and moves nothing, so the row names the opening rather than the act the
     *  switch inside the surface performs. */
    open: "Open publishing",
    /** The header control's word. It opens the surface that assigns this host to
     *  a display; the switch inside is what starts or stops publishing. */
    assign: "Assign to a display",
    start: "Publish to a phone",
    stop: "Stop publishing",
    starting: "Opening the LAN…",
    /** The popover's own name, so a screen reader reaching the facts knows what
     *  surface it is on before it reads them. */
    surface: "Publishing",
    address: "Phone address",
    /** The one-time code, printed beside the address because the symbol that
     *  carries it needs a camera and the device may not have one. */
    code: "Pairing code",
    /** The address is the pairing origin because it is the one every device
     *  can reach, and the price is that an IP change breaks it. */
    reserveAddress: "The address above breaks if the Host's IP changes.",
    /** The optional second origin, printed only where the host answers a name:
     *  the one route a DHCP move cannot break. */
    stableName: (name: string, port: number): string =>
      `Also https://${name}:${port}, which survives a change of IP where your device can resolve it.`,
    warning:
      "Phone access is HTTPS. Plain HTTP is the fallback on your own network — trusted networks only, never the internet.",
    fallback: (address: string, port: number): string =>
      `Fallback http://${address}:${port}`,
    copy: "Copy link",
    copied: "Copied",
    /** The live window, counted down in the reader's own clock. The host answers
     *  an instant; a person reads a duration, and a deadline they can watch is
     *  what says a code has run out. */
    expiresIn: (left: string): string => `Pairing code expires in ${left}`,
    expired: "Pairing code expired",
    /** The renewal action beside the countdown: it replaces the window rather
     *  than leaving the owner to restart the host when ten minutes pass. */
    newCode: "New code",
  },
  /** The View toggle and the shortcut sheet's readings rows. Each setting names
   *  itself and its current value; the values
   *  are listed here rather than composed from a number and a unit, so the menu
   *  cannot say `1` and leave the reader to guess FPS from the neighbour.
   *
   *  The two readings answer different questions: one answers for every
   *  sensor the theme names, the other for what this machine reports. Neither is
   *  the fallback for the other, so neither is called a preview of the other.
   *
   *  The words are sentence case.
   */
  view: {
    dataSource: "Readings from",
    preview: "The theme's sensors",
    live: "This machine",
    previewDetail: "every sensor this theme names",
  },
  actions: {
    duplicate: "Duplicate",
    lock: "Lock",
    unlock: "Unlock",
    front: "Bring to front",
    bringForward: "Bring forward",
    sendBackward: "Send backward",
    back: "Send to back",
    group: "Group",
    ungroup: "Ungroup",
    delete: "Delete",
    undo: "Undo",
    redo: "Redo",
    copy: "Copy",
    cut: "Cut",
    paste: "Paste",
    outlineText: "Convert to paths",
    replaceFile: "Replace file…",
    flipHorizontal: "Flip horizontally",
    flipVertical: "Flip vertically",
  },
  /** Why a text object could not be frozen into vector paths. A refusal is
   *  reported whole-object: partial geometry would silently drop a word. */
  outline: {
    empty: "This text has nothing to convert.",
    fill: "A text filled with a gradient or pattern cannot be converted to paths; give it a solid colour first.",
    noFont:
      "This text is set in a face the theme does not declare, so its outlines cannot be read.",
    badFont:
      "A declared font file could not be read, so this text cannot be converted to paths.",
    missingGlyph:
      "A character in this text has no glyph in the face it is set in, so it cannot be converted to paths.",
    locked: "Unlock the object before converting it to paths.",
  },
  /** Why the selection could not be exported as a widget package. Each refusal
   *  refuses the whole file and names what stopped it, so the author can fix
   *  the selection rather than guess which member was left out. */
  widgetExport: {
    nothingSelected: "Select something to export as a widget.",
    locked: (name: string): string =>
      `Unlock "${name}" before exporting the selection as a widget.`,
    missingAsset: (path: string): string =>
      `The selection uses "${path}", but its bytes are missing.`,
    unreadableScene: "The selection could not be read from the scene.",
  },
  /** One label per arrange action; keys mirror `ArrangeAction`. */
  arrangeLabels: {
    "align-left": "Align left",
    "align-center-x": "Center horizontally",
    "align-right": "Align right",
    "align-top": "Align top",
    "align-center-y": "Center vertically",
    "align-bottom": "Align bottom",
    "distribute-x": "Distribute horizontally",
    "distribute-y": "Distribute vertically",
  },
  /** The status line's report of a refusal or a failure. The severity word
   *  leads the message because the line outlives the moment it was written:
   *  whoever reads it later cannot see which mark it was given. */
  diagnostics: {
    label: "Editor message",
    error: "Error",
    warning: "Warning",
  },
  /** The one contextual toolbar on the canvas: the object actions the
   *  selection can run and the arrange actions it is too small to enable. One
   *  word for one surface; the buttons carry the action labels. */
  canvasToolbar: { label: "Actions for the selection" },
  /** The canvas context menu's accessible name. Its entries reuse the action
   * registry's labels and `chartFamilies`, so no entry copy lives here. */
  canvasMenu: { label: "Canvas actions" },
  /** The stage's own name: the region the artboard is drawn in, so a reader
   *  reaching the canvas is told which surface it is before its content. */
  stage: { label: "Editor canvas" },
  /** The floating control over a video background: one command, whose name
   *  states the state it produces rather than the state it shows. */
  backgroundPlayback: {
    label: "Background video",
    play: "Play background video",
    pause: "Pause background video",
  },
  /** The shared control set's refusal copy. A control that refuses a value the
   *  author can repair says why, and those words are user-visible text, so they
   *  belong here rather than as literals inside `components/ui/`.
   *
   *  `atLeast`/`atMost` carry the field's own bound because the author has to
   *  see which number refused them. */
  controls: {
    /** An empty field with no `onClear` to empty it through. */
    valueRequired: "a value is required",
    notANumber: "not a number",
    wholeNumber: "a whole number",
    atLeast: (min: number) => `at least ${min}`,
    atMost: (max: number) => `at most ${max}`,
    /** A discrete field: the values between two members are not drawable. */
    oneOf: (values: readonly number[]) => `one of ${values.join(", ")}`,
  },
  /** The stage camera's control: the display the stage looks through, and the
   *  two framings that are not a display. `label` names what the control is;
   *  the trigger appends the readout it shows, because an accessible name that
   *  omits the visible text does not satisfy WCAG 2.5.3. The trigger keeps
   *  reading the camera's zoom, which predates the display and is a capability
   *  this change does not remove — a display is said by the frame drawn around
   *  the stage and by the menu's tick. */
  display: {
    label: "Display and zoom",
    toSelection: "Zoom to selection",
    actualSize: "Zoom to 100 %",
    /** The cluster's camera controls, beside the readout. `−`/`+` step by
     *  the camera keys' own amount (`ZOOM_STEP`), and `zoomToFit` frames the
     *  whole stage, named to match `Zoom to selection` one line up. */
    zoomOut: "Zoom out",
    zoomIn: "Zoom in",
    zoomToFit: "Zoom to fit",
    /** The stage in the browser's fullscreen, its own command rather than a
     *  camera state: the camera keeps whatever framing it had. */
    fullscreen: "View in full screen",
  },
  /** Chart family labels, shared by the Add pane, the canvas context menu and
   *  the layer row's role. */
  chartFamilies: chartFamilyLabels,
  /**
   * One label per basic shape. The Add pane's shape list, the defaults that
   * build each kind and the inspector's own fields all read this, so a shape is
   * named in exactly one place.
   */
  shapeKinds: {
    rect: "Rectangle",
    ellipse: "Ellipse",
    polygon: "Polygon",
    path: "Path",
  },
  /** One label per custom shape. Each is a `Path` preset, so its name is a
   *  drawing rather than a class: "Horizontal line" says what the tile inserts,
   *  where "Line" would collide with the chart family. */
  pathPresets: pathPresetLabels,
  /**
   * Artboard preset labels, shared by the inspector's controls and the
   * new-document chooser. A ratio labels itself; an orientation and a
   * resolution are words of their own, and `2K` is not the `2k` it is stored
   * as. `square` is the preview groups' 1:1 heading rather than an artboard
   * orientation: a square artboard files as landscape, but its previews are
   * listed as their own group.
   */
  artboardOrientations: {
    landscape: "Landscape",
    square: "1:1",
    portrait: "Portrait",
  },
  artboardResolutions: { "1080p": "1080p", "2k": "2K", "4k": "4K" },
  artboardRatios: {
    "16:9": "16:9",
    "19.5:9": "19.5:9",
    "4:3": "4:3",
    "1:1": "1:1",
  },
  /** A document's outline, distinct from its ratio: a circle is drawn on a
   *  1:1 artboard rather than being one. */
  artboardShapes: { rect: "Rectangle", circle: "Circle" },
  /**
   * The two boxes a background picture is clipped to, spelled once. This is the
   * layer's own `bounds`; the artboard's content fit is a guarantee of the
   * model rather than a choice, so it has no words here.
   */
  backgroundBounds: { theme: "Fill theme", display: "Fill display" },
  /** The two background models: the full-cover picture every theme predates,
   *  and the composition a theme opts into. */
  backgroundModes: { simple: "Simple", advanced: "Advanced" },
  /** The points a background's media may be anchored to. `full` is no
   *  composition at all — the picture covers the box and the fill never shows. */
  backgroundAnchors: {
    full: "Full",
    center: "Center",
    left: "Left edge",
    right: "Right edge",
    top: "Top edge",
    bottom: "Bottom edge",
  },
  /**
   * The four ways a reading may print its unit, keyed by what is stored.
   *
   * Probed before these were written here and the platform has no word for any
   * of them: `Intl.DisplayNames` has six types — language, region, script,
   * currency, calendar, dateTimeField — and asks for `unitDisplay` with a
   * `RangeError`; `Intl.supportedValuesOf("unit")` is the 45 sanctioned *units
   * of measurement* (acre, byte, celsius), not the ways to display one. So the
   * words name the product's own options: `short` and `long` are the platform's
   * `unitDisplay` values, `none` is ours (ECMA-402 rejects it), and `Default`
   * is the absence of the key. §35 settles the rest — product UI copy is not
   * localised, and a theme declares the language its own text is written in.
   *
   * What the table buys is an owner. The chart panel and the run panel each
   * wrote all four, so a rename fixed one and silently missed the other.
   */
  unitDisplayOptions: {
    "": "Default",
    none: "None",
    short: "Short",
    long: "Long",
  },
  /** The Document pane's attribution section. The title, author, licence and
   *  address are the package's data; these three words are the only copy the
   *  editor adds around them. */
  credits: {
    by: (name: string): string => `By ${name}`,
    steam: (id: string): string => `Steam ${id}`,
    /** The platform a wallpaper credit came through. `.mpkg` is Wallpaper
     *  Engine's own format and the WE tab lists that library, so the credit's
     *  `wallpaper` kind is what says the name; neither source carries it as a
     *  field of its own. */
    wallpaperEngine: "Wallpaper Engine",
  },
  /** Panel copy. Panel factories own their DOM contract; this owns the words. */
  panels: {
    layers: "Layers",
    /** The generic word for each kind of layer, the one owner of the six kind
     *  words — `layer-tree.ts` reads these where it once held a private table. */
    layerKinds: layerKindLabels,
    /** A row's role, in words. One function per arm of `LayerRole`. */
    layerRoles,
    /** Layer-tree row controls. The twisty and the rename field carry the
     * layer's name as well, so those two names are unique; the state icons do
     * not, because "Hide" on every row is the same control repeated and the row
     * it sits in is what tells them apart. */
    hide: "Hide",
    show: "Show",
    /** Between two keys one chart or label reads. The trends card reads three,
     * and a space alone would run them together at 340px. Punctuation rather
     * than a letter, so it cannot be mistaken for part of a key.

     * A row bound to nothing prints nothing here rather than a word saying so.
     * A word repeated down a column carries no information and is paid for out
     * of the layer *name*, which is the one thing a layer list has to keep
     * readable — the density §173 asks for, rather than ink that says "no".
     */
    boundSeparator: " · ",
    rename: "Rename",
    collapse: "Collapse",
    expand: "Expand",
    /** Going into a group and coming back out of it.
     *
     *  Both carry the group's name, unlike the two words above. A twisty can
     *  say "Expand" on every row because the row it sits in is the thing it
     *  acts on; three "Enter" buttons in one tree would be the same word
     *  repeated with nothing telling a reader which group each one opens. The
     *  two verbs differ as well as the names, so the row the author is inside
     *  says something different again. */
    enter: "Enter",
    leave: "Leave",
    text: "Text",
    /** A fixed text, whose row must say which of the two elements it is: both
     *  share the `text` layer kind, so the name is the only place the class
     *  shows in the layer list. */
    textBox: "Text box",
    panel: "Panel",
    /** A pasted image and a fresh group arrive without an authored name, so
        the layer row would print their uuid; these are what they are called
        instead. */
    image: "Image",
    group: "Group",
    /** The Add pane's construction lists, each a group. A flat chip list
        would put the word "Line" on two buttons with nothing to tell them
        apart — once for the primitive and once for the chart family.

        `cards` is the unit library, and it sits beside the primitives rather
        than above them: the unit is the fast path for a card, and the primitive
        is the tool for the case nobody anticipated, which is the case this
        product is for. Neither is the fallback for the other, so neither group
        says so. */
    cards: "Card",
    shapes: "Basic Shape",
    customShapes: "Custom Shape",
    charts: "Chart",
    /** The Assets pane's one import path. An author imports a *file* — the
        extension decides whether it becomes a layer, a face, a video or a
        package. */
    importFile: "Import file",
    /** The Finder's door from the Assets pane. Named for what it reaches rather
        than the verb: the pane already shows every declared file, so "find"
        would describe a search of this list rather than the library beyond it. */
    assetFinder: "Asset Finder",
    /** Asked after a picture is declared: both destinations are one press, and
        the kind alone does not say which one the author wants. */
    placeImage: {
      title: "Add image",
      close: "Close",
      place: "Place on canvas",
      background: "Background",
    },
    /** Replace file… accepts only the two kinds a placed object can carry. */
    replaceUnsupported: "Only an image or SVG can replace a placed picture.",
    /** The Assets pane's cards. `kind` is the metadata line's word, a total map
     *  over the manager's kinds so a fifth kind fails to compile here rather
     *  than drawing a card with no kind word. */
    assetCard: {
      kind: {
        image: "Image",
        svg: "SVG",
        video: "Video",
        font: "Font",
      } satisfies Record<LocalAssetReference["kind"], string>,
      inUse: "In use",
      unused: "Unused",
      preview: "Preview",
      replace: "Replace",
      remove: "Remove",
      createTypeToken: "Create type token",
      size: fileSize,
    },
    /** The pane's size meter, under its Import row. The percentage carries the
     *  same state as the colour, so the reading survives without it. */
    assetSizes: {
      theme: (percent: number, limit: string): string =>
        `Theme ${percent}% of ${limit}`,
      unused: (size: string): string => `Unused ${size}`,
    },
    /** The inline form a chosen font expands to: the facts the file cannot
     *  answer for itself, and the one write that binds it to a preset. */
    fontDetails: "Font details",
    licence: "License",
    sourceUrl: "Source URL",
    role: "Role",
    fontStyle: { normal: "Normal", italic: "Italic" },
    /** A face is a package declaration, not a canvas object — said where the
     *  author presses the button that writes one. */
    fontDeclaredNote:
      "A font is declared in the package; it is not placed on the canvas.",
    /** Shown when a chosen file is not a readable image, video or font the
        package accepts. The author's other work is untouched. */
    assetImportFailed: "That file could not be imported.",
    /** Shown when an import declared the file and put it on the canvas. */
    assetPlaced: "Imported and placed on the canvas.",
    /** Shown when an import declared the file and wrote it as the artboard's
        background media — the automatic choice for a video, and the modal's
        background answer for a picture. */
    assetBackgroundSet: "Imported and set as the background.",
    assetDeclaredFont:
      "Imported and declared. A font is not placed on the canvas.",
    /** Shown when the kind's automatic placement had no callback to run — a
        pane mounted without a document can declare the file but place nothing. */
    assetDeclaredOnly: "Imported and declared.",
    /** Shown when a removal is refused because something still points at it. */
    assetReferenced: "That asset is in use and cannot be removed.",
    /** Shown when the declaration the row drew is gone from the manager. */
    assetRemoveFailed: "That file could not be removed.",
    /** The one modal a picked `.mpkg` or video runs automatically. The two
        preparing sentences are different sentences because the work is
        different: a package is read and extracted before its video is
        normalized, a video file is only normalized. */
    importVideo: {
      title: "Import video",
      close: "Close",
      preparingPackage: "Extracting and preparing the video…",
      preparingVideo: "Preparing the video…",
      importing: "Importing the video…",
      /** The export guide's author step, restated where a hand-exported file is
       *  imported: a package can only be checked for what is already in it. */
      dynamicText:
        "A clock or other dynamic text already in the video cannot be removed by Yunari and will loop as-is.",
    },
    /** The surface a video import passes through before the host normalizer:
     *  the author picks the span, and only a cut span is blended at the loop. */
    trimVideo: {
      title: "Trim video",
      hint: "Drag the ends to choose the loop. The last second dissolves into the first.",
      start: "Start",
      end: "End",
      selection: (start: string, end: string) => `${start} – ${end}`,
      output: (length: string) => `Loop is ${length}`,
      useWhole: "Use whole video",
      confirm: "Trim and import",
      tooLong: (limit: string) =>
        `This video is longer than ${limit}. Choose a span to import.`,
      unplayable:
        "This video cannot be played here. Use the whole file, or trim it with another tool.",
    },
    /** Shown when a normalize press produced no answer the pane can read — a
        host refusal arrives in its own words and is never replaced by this. */
    videoNormalizeFailed: "That video could not be normalized.",
    themeSettings: "Theme settings",
    /** The Document pane's two sections. `themeSettings` names the pane's own
     *  heading; these name the groups under it, and the artboard one holds the
     *  size, the paint and the media the board is drawn on. */
    themeMetadata: "Theme metadata",
    artboard: "Artboard",
    /** The Document pane's third section: the attribution the theme's imported
     *  assets arrived with. It is drawn only when the theme credits anything. */
    credits: "Credits",
    language: "Theme language",
    /** The sample's own row label, one word because it shares the 72px label
     * column every other field on this panel uses. */
    sampleLabel: "Sample",
    /** Names the live sample under the language control, which is a status
     * region in its own right and announces itself when the choice changes. */
    languageSample: "Sample in the chosen language",
    backgroundMedia: "Background media",
    releaseVersion: "Release version",
    notSet: "Not set",
    none: "None",
    /** Shown by a numeric field when an edit is refused, whether it could not be
        read as a number or fell outside the field's range. */
    invalidNumber: "That value cannot be applied. Enter a number in range.",
    paintTokens: "Paint tokens",
    /** A palette token's own two paint kinds, as the Paint chooser names them.
     * `linearGradient` is not the `gradient` it is stored as. */
    paintKinds: { solid: "Solid", gradient: "Linear gradient" },
    /** A gradient's angle, and the two fields of each of its stops. The stop
     *  number is one-based, because it is what the author counts. */
    angle: "Angle",
    stopPosition: (stop: number) => `Stop ${stop} position`,
    stopColour: (stop: number) => `Stop ${stop} color`,
    /** The name a freshly added token or preset carries until it is renamed.
     *  It is authored theme data the author goes on to edit, not a message. */
    newColour: "New color",
    newType: "New type",
    /** Each pane's own chooser, named by what it lists rather than by the pane
     * it sits in — the section heading already says Paint tokens or Type
     * tokens. */
    typeToken: "Type token",
    paint: "Paint",
    addColour: "Add color",
    addStop: "Add stop",
    removeStop: "Remove stop",
    deleteColour: "Delete color",
    reassign: "Reassign to",
    /** What the reassignment select says before a target is chosen. The delete
     *  route defaults to *no* target, so this is the only thing the box says
     *  before the author has made the choice — never a token they might miss
     *  and keep by accident. */
    reassignPlaceholder: "Choose a token",
    typeTokens: "Type tokens",
    addType: "Add type",
    deleteType: "Delete type",
    applyFont: "Apply font",
    applyTrio: "Apply trio",
    unitDisplay: "Unit display",
    /** Field labels shared by more than one panel. */
    name: "Name",
    author: "Author",
    description: "Description",
    /** The style-tag field: the vocabulary an author picks from, and the one
     *  path to a word it does not hold. `tagsProposed` composes the pill a
     *  proposal is drawn as — its own reading, `<tag> · proposed` on
     *  a dashed pill, so a reader knows the word is new rather than that the
     *  facet failed to match. Each refusal names the word it refused, because
     *  the author has to see which one.
     *
     *  **`tagRefusedShape` reads its bound off the pattern it is handed**, which
     *  is `TAG_PATTERN`'s own source: a sentence that restated `1–24` is a
     *  second copy of the rule, and the two drift the moment either moves. A
     *  pattern with no `{min,max}` says the rule without a number rather than
     *  inventing one. */
    styleTags: "Style tags",
    tagProposePlaceholder: "Propose a tag",
    tagAdd: "Add tag",
    tagsProposed: (tag: string) => `${tag} · proposed`,
    tagRefusedShape: (tag: string, pattern: string) => {
      const bounds = /\{(\d+),(\d+)\}/.exec(pattern);
      const length = bounds === null ? "" : `${bounds[1]}–${bounds[2]} `;
      return `"${tag}" is not a tag this format takes. Use ${length}lowercase letters, digits or hyphens.`;
    },
    tagRefusedDuplicate: (tag: string) => `"${tag}" is already on this theme.`,
    tagRefusedFull: (max: number) =>
      `A theme carries at most ${max} style tags. Remove one to add another.`,
    /** A paired width/height row has no room for the full words beside both
        boxes, so the row keeps its "Size" label and marks them W and H. */
    widthMark: "W",
    heightMark: "H",
    background: "Background color",
    /** Which background model the theme is authored under. */
    backgroundMode: "Mode",

    /** The background column's own rows: the box its media fills, the zoom over
        its cover fit, the one pair that moves both axes, and the two paint-time
        mirrors. */
    backgroundBounds: "Bounds",
    backgroundScale: "Scale",
    backgroundOffset: "Offset",
    backgroundFlipX: "Flip horizontally",
    backgroundFlipY: "Flip vertically",
    /** Where the picture sits inside its box, and how it fades into the fill. */
    backgroundComposition: "Composition",
    backgroundAnchor: "Anchor",
    backgroundExtent: "Size",
    backgroundFade: "Fade",
    /** The frame a video background shows where it cannot play, and the still
        the glass material samples. */
    backgroundFallbackFrame: "Fallback frame",
    /** A paint's own colour, as against the token it is chosen from. */
    colour: "Color",
    /** The channels the picker's controls announce, as accessible names.
     *  `pickerSaturation` and `pickerValue` are the area's two channels, named
     *  together in its `aria-valuetext`; `pickerHue` and `pickerAlpha` are the
     *  two strips. The announced name is a word rather than the
     *  selector-shaped `data-testid`. */
    pickerSaturation: "Saturation",
    pickerValue: "Value",
    pickerHue: "Hue",
    pickerAlpha: "Alpha",
    /** The saturation × brightness square, announced as one two-channel slider. */
    pickerArea: "Saturation and brightness",
    /** The library row inside the popup: the group's own name, never a
     *  preset's, because the preset names are the library's data. */
    pickerPresets: "Color presets",
    /** The gradient editor's own preset row: the group's name, never a preset's
     *  — the preset names are the library's data, like the colour row's. */
    gradientPresets: "Gradient presets",
    /** The action the platform's `EyeDropper` performs, drawn only when the
     *  browser has one. */
    pickerEyedropper: "Pick a color from the screen",
    /** The field's own name. Distinct from `colourHex`: the field accepts any
     *  colour the parser takes, not only a hex. */
    pickerValueField: "Value",
    /** The library row's one destructive action. */
    presetDelete: "Delete preset",
    /** The hex field inside the picker's popup. Named so the author who types a
     *  colour knows the field takes a hex, not the swatch's other channels. */
    colourHex: "Hex color",
    gradient: "Gradient",
    colourUnpaintable: (value: string) =>
      `Not a color the browser can paint: "${value}". Hex, rgb(), hsl() or a CSS color name.`,
    family: "Family",
    /** The family list's trailing action rows: the two ways into the package
        without leaving the token. */
    importLocalFont: "Import local font…",
    fontFinder: "Font finder…",
    /** The reading for a family the package does not declare, appended to the
        family list as a choice the control will not commit. */
    notInPackage: "(not in package)",
    /** The font form's own label; the panel vocabulary had no style word. */
    style: "Style",
    cancel: "Cancel",
    size: "Size",
    /** The three controls that choose an artboard size. They choose it
        together; the width and height boxes stay because an author who wants a
        size no preset names still types one. */
    ratio: "Ratio",
    orientation: "Orientation",
    resolution: "Resolution",
    /** Shown by all three when the document holds a size no preset names — an
        author's own, or a hand-edited theme's. A reading, not a choice. */
    customSize: "Custom",
    /** The consequence of every size control on this panel, stated where they
        are. Changing the ratio is one click and it never moves anything, so an
        author narrowing a dashboard by hand is told the rule before the click
        rather than after the content has gone. */
    artboardSizeNote:
      "Objects are not moved or resized. Anything outside the artboard is not shown on a display.",
    /** The rule, with the figure the scene can now be asked for. A proportion of
     *  the composition rather than a bare complaint, and the same wording the
     *  display uses when it loses objects the author cannot see. */
    artboardOutside: (rule: string, outside: number, counted: number): string =>
      `${outside} of ${counted} objects are now outside the artboard and will not be shown on a display. ${rule}`,
    weight: "Weight",
    lineHeight: "Line height",
    letterSpacing: "Letter spacing",
    /** The curated face a preset adopts. */
    fontFace: "Font face",
    fontBound: "Bound to a packaged face",
    unbindFont: "Unbind",
  },
} as const;
