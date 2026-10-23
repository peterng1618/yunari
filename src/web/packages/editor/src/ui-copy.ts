/** Typed package-local visible editor copy (§35). Authored theme text,
 * telemetry values and developer errors stay outside this module.
 *
 * Exempt from AGENTS.md's 800-line stop, which is written for source files:
 * this is a flat string table whose bulk is the reason each word is the word,
 * so splitting it by namespace would file the same words across five tables
 * and buy the count nothing but a fifth owner of one convention. */

import {
  type ChartFamily,
  type ColourMode,
  DASHBOARD_THEME_KIND,
  type ListingCategory,
  type Orientation,
  type SemanticFamily,
} from "@yunari/renderer-core";
import type { VersionLevel } from "@yunari/theme-package";
import type { DisplayLensId } from "./display-lens.js";
import type { AssignableGroup } from "./host-settings-mode/client.js";
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

/**
 * One reason per kind, keyed by the kind `renderer-core` is asked with.
 *
 * Three causes, not one sentence: an open path has no interior to sample
 * through, a path's closedness is author data the product cannot know, and a
 * glyph, a photograph or a plotted series is not a panel at all. `Group` is
 * here because the owner admits it and the renderer still refuses it — Fabric
 * draws a group's children directly, so no boundary is left to sample through
 * (`scene-fabric/src/glass.ts`).
 */
const glassRefusals: Readonly<Record<string, string>> = {
  Polyline:
    "A Polyline is an open path, so there is no interior to sample the backdrop through.",
  Line: "A Line is an open path, so there is no interior to sample the backdrop through.",
  Path: "A Path is author-drawn data and the product cannot know whether it is closed.",
  Group:
    "A Group has no render boundary of its own — put frosted glass on the panel inside it.",
  Textbox:
    "Text is not a panel, and there is no surface behind a glyph to frost.",
  Text: "Text is not a panel, and there is no surface behind a glyph to frost.",
  IText:
    "Text is not a panel, and there is no surface behind a glyph to frost.",
  Image: "An image is not a panel, and there is nothing behind it to frost.",
  YunariChart:
    "A chart is not a panel, and there is nothing behind a plotted series to frost.",
  ActiveSelection:
    "Frosted glass applies to one shape at a time — select the shape you want to frost.",
};

/**
 * The kinds `glassRefused` answers in their own terms — the refused ones, not
 * the document's whole vocabulary: `Rect` and `Circle` are frostable and are
 * not here. Exported so the copy walk can probe that function over them: its
 * answer is chosen by the key, so a probe that passes a generic argument reaches
 * only the fallback `glassRefused` composes and the sentences above read as
 * strings with no owner.
 */
export const glassRefusalKinds: readonly string[] = Object.keys(glassRefusals);

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

export const uiCopy = {
  brand: "Yunari",
  /** The rail's four slots. A slot's word is both its tooltip and its
   *  accessible name: the slot is icon-only, so it has no text of its own, and
   *  a glyph stored as a translatable string would be announced as a word and
   *  could not inherit a shell colour. One word per slot, from the one owner
   *  of which slots exist (`rail.tsx`). */
  rail: {
    /** The rail's own name, so a screen reader is told what the group of
     *  slots chooses between before it reads each one. */
    label: "Editor panes",
    slots: {
      composition: "Composition",
      add: "Add",
      tokens: "Tokens",
      /** The artboard, background, metadata and reference panels — one pane,
       *  because they are the document's own settings. */
      document: "Document",
    },
  },
  /** The settings modal the rail's gear opens (§7). A modal is a surface, not
   *  a pane, so its words live here rather than under `rail`: the three tabs
   *  are §7's table, and `close` is the `Dialog.Close` the modal renders so a
   *  touch screen reader — with no Escape key — can still leave it. */
  settings: {
    title: "Settings",
    appearance: "Appearance",
    keyboard: "Keyboard",
    connections: "Connections",
    about: "About",
    close: "Close",
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
    /** §7's About tab: what the editor is, and the facts this build can read.
     *  The provenance is one sentence naming the product; the three fact labels
     *  say which fact each row is, and the release fact's *label* is the
     *  Document pane's own word (`panels.releaseVersion`), reused rather than
     *  respelled so one fact keeps one word (§9). */
    aboutProvenance: "Yunari, a dashboard theme editor.",
    aboutProductVersion: "Product version",
    aboutSchemaVersion: "Schema version",
    /** §7's Appearance tab. `palette` is the name the header chip's trigger
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
    /** §7's Keyboard tab: the reference with editing. One word for one act —
     *  the arm button's `aria-label` and its tooltip are this string (§6). */
    keyboardRebind: "Change chord",
    keyboardReset: "Reset",
    keyboardResetAll: "Reset all",
    /** What a row says instead of its chord while it is listening. */
    keyboardPrompt: "Press a chord…",
    /** §9: a refusal states its reason. Each is a whole sentence the row shows
     *  beside the binding it did not make — never a tooltip (§5.3). */
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
    /** §7.4: the empty column "says where to choose from" (`DESIGN.md:279`),
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
    /** What one shape owns and no other: its corners, its points, its ends or
        its data. The general geometry fields above stay unchanged. */
    shapeSides: "Sides",
    shapePoints: "Points",
    shapeStart: "Start",
    shapeEnd: "End",
    shapePath: "Path data",
    /** The two ends of a swept curve, in degrees. "Angle" is what makes them
        different from the line's own `Start`/`End` endpoints one row up: the
        numbers are positions round a circle rather than points in the box. */
    shapeStartAngle: "Start angle",
    shapeEndAngle: "End angle",
    /** The frosted-glass treatment and its one parameter. */
    glassEnabled: "Frosted glass",
    glassBlur: "Glass blur",
    /**
     * Why one shape cannot be frosted, in that shape's own terms.
     *
     * "Glass applies to panels" teaches an author a rule they still cannot act
     * on; naming the shape they selected tells them what to select instead. The
     * kinds are the ones `renderer-core` is asked with, and membership is
     * decided there — this table only says why an answer of no came back, so a
     * kind it admits never reaches it and a kind added later falls to the
     * sentence below rather than to no explanation at all.
     */
    glassRefused: (kind: string) =>
      glassRefusals[kind] ??
      `${kind} is not a shape frosted glass can be applied to.`,
    opacity: "Opacity %",
    /** A picture layer's two paint-time mirrors. */
    flipX: "Flip horizontally",
    flipY: "Flip vertically",
    paint: "Paint",
    notSet: "not set",
    unresolved: "no longer resolves",
    runs: "Runs",
    runPreset: "Type preset",
    /** What one run says, for a run that is prose. Distinct from the Add pane's
        "Text" button, which inserts an object rather than naming a field. */
    runText: "Run text",
    addRun: "Add run",
    /** Shown when an in-place edit would have to drop the runs it cannot place. */
    multiRunRefused:
      "This text has more than one run, and typing over the whole object would drop the others. Edit each run's text in the run editor.",
    /** A chart's bindings are its series, which is the word the panel already
        uses for the axis. Named once so the chooser and the refusal agree. */
    runSeries: "Add a series",
    runSeriesFull: (family: string) =>
      `A ${family} chart draws one reading, so it takes one series.`,
    removeSeries: (key: string) => `Remove the series reading ${key}`,
    /** Numbered, so three rows do not offer three identical buttons — the same
        ambiguity F1.17 found in the Add pane, where "Line" was two things. */
    removeRun: (position: number) => `Remove run ${position}`,
    /** Shown when a run after the first asks for tracking the object cannot
        carry: Fabric measures spacing once, from the object. The interpolation
        is the run's own preset reference, as the run list above names it. */
    runTrackingNotSeparate: (preset: string) =>
      `Tracking on "${preset}" is not shown separately — a text object carries one tracking value, from its first run.`,
    runColour: "Colour",
    runSource: "Reads",
    staticText: "Static text",
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
    centre: "Centre",
    right: "Right",
    /** Text inside its box, which is the thing the two words above do not say.
        The canvas's own `align-top` / `align-center-y` / `align-bottom` move
        selected *objects*, and both surfaces are reachable from one selection,
        so this one names its own subject rather than borrowing the verb. */
    verticalAlign: "Vertical text align",
    verticalTop: "Top",
    verticalMiddle: "Middle",
    verticalBottom: "Bottom",
    wrap: "Wrap",
    on: "On",
    off: "Off",
    overflow: "Overflow",
    clip: "Clip",
    ellipsis: "Ellipsis",
    overflowVisible: "Visible",
  },
  menus: {
    /** The menubar's own name, so a screen reader reaching the three menus is
     *  told what the group is before it reads each one. */
    label: "Editor menus",
    file: "File",
    edit: "Edit",
    view: "View",
  },
  /**
   * The shell's three modes, as the header's switch names them (DESIGN.md
   * §7.1). Each names the *surface* rather than the mechanism behind it.
   *
   * **The user chose `Editor · Themes · Host` on 2026-10-19** (SDD ruling R100),
   * over the spec's draft names — *theme store*, *theme editor*, *host
   * settings* — and over the drawings' `This PC`, which named the machine
   * rather than a peer of `Themes`. The key `thisPc` and the mode id `"this-pc"`
   * are unchanged: an id is never shown to anyone, so renaming one buys a
   * reader nothing and costs every call site.
   */
  modes: {
    /** The switch's own name. The three labels inside are the options, so a
     *  group with no name announces "Editor, pressed" with nothing saying what
     *  is being chosen. */
    label: "Shell modes",
    editor: "Editor",
    themes: "Themes",
    thisPc: "Host",
    /** Asked before the editor is left with unsaved work. It is the question
     *  the editor's own replacement prompt is given, so it offers the same
     *  three answers — Save, Discard, Cancel — and the author can save rather
     *  than choose between losing the work and staying put. */
    unsaved: "Save changes before leaving the editor?",
  },
  /**
   * The Host mode's own surface: this PC.
   *
   * **The words are `packages/host/public/settings.html`'s** — its hints, its
   * device labels, its status line — taken rather than rewritten, because they
   * are the same questions, and the checked drawing
   * (`docs/design/mockups/current/host-settings.html`) says so. Two things
   * diverge. That page no longer lists themes (A.10): the listing is the store
   * mode's local half, and an assignment is made from a theme's own row. And
   * its questions hint carries a sentence this one does not — which display the
   * answers are for — because this surface has its own display selector and
   * must not claim the page's default (R153).
   */
  hostSettings: {
    displays: {
      heading: "Displays",
      hint: "Each display shows its own theme. Assign one from the theme's row in Themes.",
      /** The name of the control that picks which display the questions below
       *  speak for. It is a choice and not an assignment. */
      label: "Displays",
      /** A display holding no theme of its own is served the default. The row
       *  names the theme it shows and says where that answer came from, because
       *  a name alone would read as a choice this display made. */
      follows: "Follows this PC",
      /** Neither a theme of its own nor a default: nothing falls back to. */
      nothing: "No theme",
    },
    devices: {
      heading: "Devices on this PC",
      hint: "Which hardware this PC reports. These apply to every theme, unless a theme asks for something different.",
      groups: {
        gpu: "Graphics card",
        "system-disk": "System disk",
        "data-disk": "Data disk",
      } as const satisfies Record<AssignableGroup, string>,
      /** What a slot does when nothing has been chosen, in the words a consumer
       *  would use. The empty answer is a rule about this PC and not a device:
       *  naming it after discovery order puts a machine's bookkeeping in the
       *  same list as the model numbers a person bought. */
      automatic: {
        gpu: "Automatic (the first card this PC reports)",
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
        "system-disk": "Which drive does this PC run from?",
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
      hint: "How this PC's readings are shown. A theme decides how a clock reads; this decides which zone it reads and which units temperatures use.",
      timeZone: "Clock time zone",
      ownZone: "This PC's own zone",
      measurement: "Temperature units",
      /** The systems by the unit they read in, which is the choice rather than
       *  its name: `metric` and `imperial` say nothing about a thermometer. The
       *  host page adds the unit's own mark and this table cannot — a
       *  pictograph is not copy (`ui-copy.test.ts`), and the mark a reading
       *  prints is the renderer's. */
      metric: "Celsius",
      imperial: "Fahrenheit",
    },
    /** The questions the theme on the chosen display raises. Only the ones it
     *  has not answered are drawn, so answering one is what makes it leave. */
    questions: {
      heading: (theme: string): string => `${theme} needs`,
      hint: "This theme reads hardware that has no answer yet. Pick a device, or leave it following this PC's settings.",
      inherit: "Use this PC's settings",
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
    /** The finder's one entry in this menu. It sits above *Import package*
     *  because both add something and the finder is the one that fetches. */
    findAssets: "Find assets…",
    /** The reference composition, offered as what it is: a template the
     *  product ships. `New` is the author's own blank document; this is the one
     *  they can open a copy of. */
    newFromStarter: "New from starter",
    /** **Import package**, which is the store mode's own action (`2026-10-12-
     *  theme-store-design.md`, "The store mode") and what the row does: the
     *  package is written into the library and the open document is untouched.
     *  The row used to read *Open package* and open a document, which is the
     *  route A.7 removed — the store's `open` action is that route now. */
    importPackage: "Import package",
    savePackage: "Save package",
    releasePackage: "Release package",
    openLibrary: "Open library",
    saveLibrary: "Save to library",
  },
  /** The chooser `New` opens before the document exists. The first control is
   *  the display a theme is for, and its entries are the display switch's own
   *  names — one vocabulary, one place it is worded. Behind **Custom** sit the
   *  artboard panel's own three labels, so only the two words this surface adds
   *  are here. */
  newDocument: {
    chooseSize: "Choose an artboard size",
    /** The first question. Named as what it decides — where this theme will be
     *  seen — rather than by the aspect it derives. */
    display: "Display",
    custom: "Custom size",
    create: "Create",
    cancel: "Cancel",
  },
  /**
   * The Themes mode's own words — the store surface, whose region's header row
   * is its own rather than the shell's (`2026-10-12-theme-store-design.md`,
   * "The store mode").
   */
  store: {
    /** The store's two halves, which the region's own `Segmented` names. The
     *  two labels are the drawings' tab words (`store-browse.html`), and
     *  `label` is the group's name: the two labels inside are the options, so a
     *  group with no name announces "Your themes, pressed" with nothing saying
     *  what is being chosen. The host's own library comes first, because it is
     *  what an author already has. */
    halves: {
      label: "Theme halves",
      local: "Your themes",
      online: "Store",
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
     *  account for is worse than none (§9). `published` is still here because a
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
    /** The five facets, in the order the row draws them — the spec's "Finding a
     *  theme: the five facets". The values each offers are derived from the
     *  items, so the only words here are the ones a value cannot carry itself. */
    facets: {
      label: "Filter themes",
      author: "Author",
      colourMode: "Colour mode",
      sensors: "Sensors",
      shape: "Shape",
      style: "Style",
      /** The Sensors facet's headings: one per family the vocabulary files a
       *  semantic key under, so a person choosing values sees them grouped the
       *  way `describeSemanticKey` groups them rather than in one flat list
       *  (spec, "Finding a theme: the five facets").
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
      /** The Shape facet's three headings, in the drawing's own order
       *  (`store-facets.html`): the orientation words, the aspect buckets and
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
    },
    /** The facet values that are words rather than data: the two colour modes a
     *  person can ask for, the three orientations, and the aspect bucket that is
     *  a word. Everything else a facet offers is the record's own reading — an
     *  author's name, a sensor's `label`, a ratio, a size — and reads as itself.
     *
     *  **`unclassified` is deliberately absent.** It is the absence of an answer
     *  rather than one a person can ask for, so it is reachable under "any" and
     *  under no other value (spec, "Finding a theme: the five facets", `R117`);
     *  a chip for it would be a selection that matches nothing.
     *
     *  Typed from the record's own unions, so a colour mode or an orientation
     *  added there without a word fails to compile here rather than printing an
     *  identifier at a person. */
    colourModes: {
      light: "Light ground",
      dark: "Dark ground",
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
     *  the letter `x`, which is what the drawing prints and what keeps a size
     *  from reading as the ratio written the same way. Keyed because the two
     *  numbers are data. */
    size: (width: number, height: number): string => `${width}×${height}`,
    /** **The origin word, and the only one**: the badge a local cell draws and
     *  the first clause of the item's provenance line, so the two surfaces say
     *  one fact in one way.
     *
     *  **It is *From the store* and never *Installed*.** The drawing badges every
     *  local cell with this word (`store-themes.html`) and *Installed* is the
     *  **online** half's own footer verb (`store-detail.html`), where a theme is
     *  read against the catalogue rather than against this machine's copy. The
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
     *  inventing one would be a word for something nothing declared (§9). An
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
      refused: (status: number): string =>
        `The host refused the install (${status}).`,
      notRefreshed:
        "The theme was installed, but the library could not be refreshed.",
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
      label: "Submit to the store",
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
      /** A browser that blocks the popup left the flow with no window to finish
       *  it in, so the author is told to act on the blocker. */
      blocked: "This browser blocked the sign-in window.",
      /** A landed answer whose state no footer draws: the state is named, so a
       *  host and client that disagree cannot put JSON on screen. */
      unexpectedState: (status: string): string =>
        `The store answered an unexpected state (${status}); try submitting again.`,
    },
    /** The item's own surface (`2026-10-12-theme-store-design.md`, "The item,
     *  and why `kind` is the seam"). */
    item: {
      close: "Close",
      /** The credit a remixed item carries. The name is the snapshot the
       *  document recorded, so the sentence is stable whether or not the parent
       *  is still in the index. */
      remixedFrom: (name: string): string => `Remixed from ${name}`,
    },
    /** The modal's pill groups, which are the facet's own content under the name
     *  the drawing gives it: the row names what a filter narrows by (*Sensors*,
     *  *Colour mode*), and the modal names what the theme reads, how it is shaped
     *  and what style it carries.
     *
     *  **Style is drawn only where the theme declares a tag.** `PillGroup`
     *  refuses to render a heading over nothing (§9), so a library of untagged
     *  themes draws two groups rather than an empty third. The word its proposed
     *  pill carries is the field's own (`panels.tagsProposed`), because the
     *  drawing draws that pill on the modal and in the field alike. */
    pillGroups: {
      reads: "Reads",
      shape: "Shape",
      style: "Style",
    },
    /** The two empties, which are two sentences because they have two answers: a
     *  library with nothing in it is not a filter that matched nothing, and
     *  telling someone with forty themes to go and build one is a lie the
     *  surface avoids by having both (spec, "The gallery, and paging"). */
    empty: {
      library: "No themes are saved on this PC yet.",
      libraryHint: "Build one in the editor, or import a package.",
      /** **The catalogue's own empty state, and not the library's** (R124):
       *  before the store has anything published this is the normal state, so
       *  the sentence must not tell someone with a full library that it is
       *  empty. */
      catalogue: "The store has nothing yet.",
      catalogueHint: "Themes published to the store will appear here.",
      filter: "No themes match these filters.",
    },
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
    /** One cell of either gallery (`2026-10-12-theme-store-design.md`, "The store
     *  mode"). The actions are keyed by `CellAction`, so an action added to the
     *  cell without a word for it fails to compile rather than drawing an
     *  icon-only button nobody can name.
     *
     *  **The origin badge's word is not here**: the item's own surface says the
     *  same fact, so it is one key at `store.fromStore` rather than two. */
    cell: {
      /** A theme whose document declares no author. A fact about the theme
       *  rather than a missing reading, which is why it is a word and not the
       *  gap's blank. */
      noAuthor: "No author",
      /** The four actions, as the drawing's facts band orders them. Spelled as
       *  the spec does — **Open in editor**, **Assign to display**, **Export
       *  package** and **Delete** — because each names the operation the library
       *  already has rather than the mechanism behind it. */
      actions: {
        open: "Open in editor",
        assign: "Assign to display",
        export: "Export package",
        delete: "Delete",
      } satisfies Record<CellAction, string>,
      /** Why an action this build does not run is disabled. The drawing gives
       *  every cell four actions, so all four are drawn and the two no phase
       *  owns are disabled with this reason rather than answering a press with
       *  nothing (R164). It names no owner and promises no date, because the
       *  only thing true of them is that no phase in the spec's landing order
       *  has one. */
      unavailable: "Not available yet",
      /** The online half's three answers, keyed by `InstallState` less `none`
       *  — a library item has no catalogue to be installed from, so it draws
       *  the local half's four actions rather than one of these. */
      installStates: {
        installed: "Installed",
        update: "Update",
        install: "Install",
      } satisfies Record<Exclude<InstallState, "none">, string>,
      /** What each kind is called, keyed by its wire identifier. The online
       *  cell draws this badge in its facts band (`store-browse.html`), and the
       *  item's own surface draws the same word (`store-detail.html`). A kind
       *  this build does not know prints its own identifier, which is what the
       *  spec requires of a client older than the kind. */
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
    },
    /** The pager (`2026-10-12-theme-store-design.md`, "The gallery, and
     *  paging"): the per-page well, the two steps and the numerals' names.
     *
     *  **A numeral's name composes the concept around it**, the way
     *  `statusBar.objects` composes a count: a bare `6` is announced as a
     *  number and says nothing about what pressing it does. The sizes
     *  themselves are numbers and stay data — `all` is the one entry in the
     *  well that is a word, and the drawing's own word for it. */
    pager: {
      perPage: "Per page",
      all: "All",
      previous: "Previous page",
      next: "Next page",
      page: (page: number): string => `Page ${page}`,
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
    /** The dialog a refused save raises. Two answers and a way out, because a
     *  refusal must not cost the author their document and must not be a dead
     *  end: reload takes the stored version, overwrite keeps theirs, and
     *  cancelling keeps both. */
    conflict: {
      lead: "This theme was changed somewhere else",
      reload: "Open the saved version",
      overwrite: "Replace it with mine",
      cancel: "Keep editing",
    },
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
      local: "Wallpaper Engine",
    } satisfies Record<ListingCategory, string>,
    action: {
      font: "Apply to preset",
      icon: "Place on canvas",
      image: "Set as background",
      video: "Set as background",
      local: "Open in Wallpaper Engine",
    } satisfies Record<ListingCategory, string>,
    searchPlaceholder: "Search assets…",
    results: (count: number, sources: number): string =>
      `${count} ${count === 1 ? "result" : "results"} · ${sources} ${sources === 1 ? "source" : "sources"}`,
    noResults: "No results. Try another word.",
    clearQuery: "Clear query",
    noSource: "No source serves this category.",
    sourceFailed: (label: string, message: string): string =>
      `${label} failed: ${message}`,
    needsCredential: (label: string): string =>
      `${label} needs a key this host does not have.`,
    connectionsAction: "Open Connections",
    openFontPicker: "Browse the font catalogue",
    remoteHostNotice: (hosts: string): string =>
      `Search terms go to ${hosts}. Nothing else leaves this computer.`,
    loadMore: "Load more",
    unknownAssetFile: "That asset is not a file type the editor can import.",
    hostUnavailable: "The host is not connected.",
    emptyIcon: "That icon had no shape to place.",
    bytesUnavailable: (name: string): string =>
      `The host did not send "${name}", so nothing was imported.`,
    creditsFull:
      "This theme already carries the last attribution it can hold, so the import would leave it unsavable.",
    /** The Wallpaper Engine body. A local library is not a grid, so the host's
     *  own absence reason is the sentence the tab draws — "not installed" and
     *  "no library" are different problems for the person reading it. */
    wallpaperEngine: {
      reason: {
        "not-installed": "Wallpaper Engine is not installed on this PC.",
        "unsupported-platform": "Wallpaper Engine is read only on Windows.",
        "no-library": "Wallpaper Engine holds no wallpaper library yet.",
      } satisfies Record<
        "not-installed" | "unsupported-platform" | "no-library",
        string
      >,
      kind: {
        image: "Image",
        video: "Video",
        web: "Web",
        scene: "Scene",
      } satisfies Record<"image" | "video" | "web" | "scene", string>,
      size: (bytes: number): string =>
        bytes < 1024 * 1024
          ? KILOBYTE.format(bytes / 1024)
          : MEGABYTE.format(bytes / (1024 * 1024)),
      import: "Set as background",
      openScene: "Open in Wallpaper Engine",
      search: "Search titles",
      filterKind: "Kind",
      filterAll: "All",
      noMatches: "No wallpaper matches these filters.",
      /** §4.1: an imported image or video carries whatever its author baked in,
       *  so the one sentence an image import needs is that it cannot be undone. */
      imageNotice:
        "A clock or weather label already in this picture cannot be removed, so it should not be there.",
      webUnsupported:
        "A web wallpaper is a page, not a file Yunari can put in a theme.",
      empty: "This library holds no wallpapers Yunari can read.",
      /** A scene's export sheet. The text step is an instruction, not a tip,
       *  and the project notice is said once because it is a consequence of
       *  the unpack the author only needs to hear before choosing to unpack. */
      scene: {
        title: (title: string): string => `Export “${title}”`,
        back: "Back to the library",
        deleteText:
          "Delete the clock and any other dynamic text in Wallpaper Engine's editor before exporting.",
        exportStep: "Export from Wallpaper Engine with these settings:",
        projectNotice:
          "The unpack leaves a project in Wallpaper Engine's own project list.",
        /** §8 step 7: the dialog's default location is not something Yunari
         *  controls, so the sheet names the route back when it misses. */
        elsewhere:
          "If the export saved somewhere else, use Add, then File, to bring it in.",
        formatField: "Format",
        resolutionField: "Resolution",
        frameRateField: "Frame rate",
        clipField: "Clip length",
        blendField: "Blend",
        formatName: {
          png: "PNG",
          mp4: "MP4",
        } satisfies Record<"png" | "mp4", string>,
        resolution: (width: number, height: number): string =>
          `${width} × ${height}`,
        perSecond: (fps: number): string => `${fps} fps`,
        seconds: (seconds: number): string => `${seconds} s`,
        opening: "Opening…",
        launched: (name: string): string =>
          `Wallpaper Engine was started. Open the project “${name}” from its own project list if it is not already selected.`,
        ready: (name: string): string =>
          `The project “${name}” is ready, but Wallpaper Engine's editor did not start. Open it from Wallpaper Engine's own project list.`,
        refused: (reason: string): string =>
          `Wallpaper Engine could not unpack this scene: ${reason}`,
        offer: (name: string): string =>
          `Wallpaper Engine wrote ${name}. Import it as the background?`,
        /** The credits entry's `changes` for a file this sheet imported. */
        changes: "Exported from Wallpaper Engine's scene editor",
      },
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
  /** The prompt after the editor stopped with work unsaved (`vg-040`). The lead
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
   *  strip's left half, which §7.6 makes the readouts it rests on. `objects`
   *  carries the noun because a bare number names nothing, and `selected` needs
   *  none because the word is the same at one and at many. */
  statusBar: {
    live: "live",
    objects: (count: number): string =>
      `${count} ${count === 1 ? "object" : "objects"}`,
    selected: (count: number): string => `${count} selected`,
  },
  /** §7.3's title-bar counts: one per pane's own list, so a pane whose list has
   *  not loaded prints nothing rather than a `0` (the same rule `statusBar`'s
   *  counts take for a scene that has not mounted).
   *
   * `units` is the card library's own word for what it holds — a card is a
   * *unit* an author inserts (`card-library.ts`), and it is the word the Add
   * pane's title bar carries in the drawing. `tokens` is the Tokens pane's own
   * list, the theme's paints; the reserved `none` is not one of them, because
   * `PaintList` lists every token but that one.
   *
   * **The Composition pane's count is deliberately not here.** Its list is the
   * scene's own objects, which §7.6's strip already names, so the pane reads
   * `statusBar.objects` rather than a second spelling of one fact — the
   * duplication the row accepted and named. */
  paneCounts: {
    units: (count: number): string =>
      `${count} ${count === 1 ? "unit" : "units"}`,
    tokens: (count: number): string =>
      `${count} ${count === 1 ? "token" : "tokens"}`,
  },
  /** The publish surface. §145: plain LAN HTTP has no confidentiality, so the
   *  words that turn it on have to say what it is. */
  publish: {
    qrName: (url: string): string => `QR code: ${url}`,
    /** The `?` sheet's row for the header's chord. The chord opens the surface
     *  and moves nothing, so the row names the opening rather than the act the
     *  switch inside the surface performs. */
    open: "Open publishing",
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
    /** The one step that makes an address change invisible, said here because
     *  the card is the only moment the owner is thinking about it (spec §
     *  "Finding the host after its address changes"). */
    reserveAddress:
      "Reserve this address in your router, or give this PC a name, and the display's URL never breaks.",
    warning:
      "Plain HTTP on your own network — trusted networks only, never the internet.",
    copy: "Copy link",
    copied: "Copied",
    /** Which document a display is showing while the author edits it. */
    live: (name: string): string => `Showing ${name}`,
    /** Publishing carries the document and its assets from the theme's own
     *  folder, so a document that has never been saved has nothing to publish
     *  and the author has one step left. */
    unsaved: "Save this theme to the library to publish it",
    expires: (at: string): string => `Pairing expires ${at}`,
  },
  /** The View menu. Each setting names itself and its current value; the values
   *  are listed here rather than composed from a number and a unit, so the menu
   *  cannot say `1` and leave the reader to guess FPS from the neighbour.
   *
   *  The two readings answer different questions (§6): one answers for every
   *  sensor the theme names, the other for what this machine reports. Neither is
   *  the fallback for the other, so neither is called a preview of the other.
   *
   *  A row here is a menu row and a menu row is sentence case (§9), so the two
   *  run-display rows read `Values` and `Tokens`; the mode ids they set stay
   *  lower case (`RunDisplayMode`), and only the words an author reads are
   *  capitalised. */
  view: {
    dataSource: "Readings from",
    chartRefresh: "Chart refresh",
    preview: "The theme's sensors",
    live: "This machine",
    previewDetail: "every sensor this theme names",
    valueRuns: "Value runs",
    tokens: "Tokens",
    values: "Values",
    fps30: "30 FPS",
    fps1: "1 FPS",
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
  },
  /** One label per arrange action; keys mirror `ArrangeAction`. */
  arrangeLabels: {
    "align-left": "Align left",
    "align-center-x": "Centre horizontally",
    "align-right": "Align right",
    "align-top": "Align top",
    "align-center-y": "Centre vertically",
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
   *  reaching the canvas is told which surface it is before the drawing. */
  stage: { label: "Editor canvas" },
  /** The shell's one sentence about the dock, printed under the selection
   *  column while a selection exists — chrome copy, not the selection's own. */
  selectionHint: "Move and lock the selection with the canvas dock.",
  /** The shared control set's refusal copy. A control that refuses a value the
   *  author can repair says why, and those words are user-visible text, so they
   *  belong here rather than as literals inside `components/ui/` (`vg-264`).
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
    /** The whole stage, with no display in it — a choice from the display menu,
     *  not a camera command. `zoomToFit` below is the camera command, and the
     *  two are worded apart so a reader can tell which question they answer. */
    fit: "Fit",
    toSelection: "Zoom to selection",
    actualSize: "100 %",
    /** The cluster's three camera controls, beside the readout. `−`/`+` step by
     *  the camera keys' own amount (`ZOOM_STEP`), and `zoomToFit` frames the
     *  whole stage, named to match `Zoom to selection` one line up. */
    zoomOut: "Zoom out",
    zoomIn: "Zoom in",
    zoomToFit: "Zoom to fit",
    /** One name per lens, keyed by `DisplayLensId` so a lens cannot be added
     *  to the vocabulary without a label to offer it by. Each name is the
     *  aspect it frames — the same word the id is, so a screen nobody has
     *  heard of is still nameable. */
    displays: {
      "16:9": "16:9",
      "19.5:9": "19.5:9",
      "4:3": "4:3",
      "9:16": "9:16",
      "9:19.5": "9:19.5",
      "3:4": "3:4",
    } satisfies Record<DisplayLensId, string>,
  },
  /** Chart family labels, shared by the Add pane, the canvas context menu and
   *  the layer row's role. */
  chartFamilies: chartFamilyLabels,
  /**
   * One label per primitive shape. The Add pane's shape list, the defaults that
   * build each kind and the inspector's own fields all read this, so a shape is
   * named in exactly one place.
   */
  shapeKinds: {
    rect: "Rectangle",
    circle: "Circle",
    ellipse: "Ellipse",
    triangle: "Triangle",
    polygon: "Polygon",
    polyline: "Polyline",
    line: "Line",
    path: "Path",
    arc: "Arc",
    wedge: "Wedge",
  },
  /**
   * What each card in the library is called, in the Add pane and on the copy an
   * insertion leaves in the layer tree. Named for the reading rather than for
   * where the card sits: two CPU cards are two CPU cards, and the id beside the
   * name is what tells them apart.
   */
  cardLibrary: {
    time: "Clock",
    cpu: "CPU",
    gpu: "GPU",
    ram: "RAM",
    vram: "VRAM",
    trends: "Performance trends",
    storage: "Storage",
    network: "Network",
  },
  /**
   * Artboard preset labels, shared by the inspector's controls and the
   * new-document chooser. A ratio labels itself; an orientation and a
   * resolution are words of their own, and `2K` is not the `2k` it is stored
   * as.
   */
  artboardOrientations: { landscape: "Landscape", portrait: "Portrait" },
  artboardResolutions: { "1080p": "1080p", "2k": "2K", "4k": "4K" },
  /**
   * The two boxes a background picture is clipped to, spelled once. This is the
   * layer's own `bounds`; the artboard's content fit is a guarantee of the
   * model rather than a choice, so it has no words here.
   */
  backgroundBounds: { theme: "Fill theme", display: "Fill display" },
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
    shapes: "Shape",
    charts: "Chart",
    /** The Add pane's file path: the declared-asset library the Assets pane
        used to be. `import` and `replace` are the two actions the section can
        take on a local file, so they are named as actions; the select is
        labelled by what it lists rather than by the pane. An author imports a
        *file* — the extension is what decides whether it becomes a layer or is
        only declared — and replaces or removes the *asset* it became. */
    importFile: "Import a file",
    replaceAsset: "Replace asset",
    assetList: "Asset",
    /** Shown when a chosen file is not a readable image, video or font the
        package accepts. The author's other work is untouched. */
    assetImportFailed: "That file could not be imported.",
    /** Shown when an import declared the file and put it on the canvas. */
    assetPlaced: "Imported and placed on the canvas.",
    /** Shown when an import declared the file and did not place it, because a
        video is not a canvas object. The pane says which of the two happened
        rather than leaving the canvas's silence to say it. */
    assetDeclaredVideo:
      "Imported and declared. A video is not placed on the canvas.",
    assetDeclaredFont:
      "Imported and declared. A font is not placed on the canvas.",
    /** Shown when a removal is refused because something still points at it. */
    assetReferenced: "That asset is in use and cannot be removed.",
    removeAsset: "Remove asset",
    /** Bringing a declared video into the publish envelope keeps the whole
        frame: cropping is the background layer's job at render time, where it is
        reversible and has the pixels to pan with. The host answers with a held
        copy; `useNormalizedVideo` is the second press that writes it over the
        master, so the author is never moved off the file they imported unasked. */
    normalizeVideo: "Normalize video",
    normalizingVideo: "Normalizing…",
    useNormalizedVideo: "Use the normalized copy",
    /** Shown when writing the held normalized copy over the master failed. A
        byte swap is not an import, so it names its own failure (N6). */
    useNormalizedFailed: "That video could not be updated.",
    /** Shown when a normalize press produced no answer the pane can read — a
        host refusal arrives in its own words and is never replaced by this. */
    videoNormalizeFailed: "That video could not be normalized.",
    themeSettings: "Theme settings",
    /** The Document pane's two sections. `themeSettings` names the pane's own
     *  heading; these name the groups under it, and the artboard one holds the
     *  size, the paint and the media the board is drawn on. */
    themeMetadata: "Theme metadata",
    artboard: "Artboard",
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
    palette: "Palette",
    /** A palette token's own two paint kinds, as the Paint chooser names them.
     * `linearGradient` is not the `gradient` it is stored as. */
    paintKinds: { solid: "Solid", gradient: "Linear gradient" },
    /** A gradient's angle, and the two fields of each of its stops. The stop
     *  number is one-based, because it is what the author counts. */
    angle: "Angle",
    stopPosition: (stop: number) => `Stop ${stop} position`,
    stopColour: (stop: number) => `Stop ${stop} colour`,
    /** The name a freshly added token or preset carries until it is renamed.
     *  It is authored theme data the author goes on to edit, not a message. */
    newColour: "New colour",
    newType: "New type",
    /** Each pane's own chooser, named by what it lists rather than by the pane
     * it sits in — the section heading already says Palette or Type presets. */
    colourToken: "Colour token",
    typePreset: "Type preset",
    /** What the Tokens pane says the *selection* is set in, as against what its
     *  chooser is browsing. The five cases must each read their own way: a
     *  default that looks like an answer is `vg-094`, a dangling reference is a
     *  third answer that collapses into neither empty one, and a group or
     *  multi-selection is a fourth — one whose own presets are its children's,
     *  which is what `selection-inspector` says for it too. */
    selectionSetTo: (name: string) => `The selection is set to ${name}.`,
    selectionUnresolved: (ref: string) =>
      `The selection is set to ${ref}, which no longer resolves.`,
    selectionChildrenTypes: "The selection's type presets are its children's.",
    selectionNoType: "The selection carries no type preset.",
    selectionEmpty: "Nothing selected.",
    paint: "Paint",
    addColour: "Add colour",
    addStop: "Add stop",
    deleteColour: "Delete colour",
    reassign: "Reassign to",
    typePresets: "Type presets",
    addType: "Add type",
    deleteType: "Delete type",
    previewFont: "Preview font",
    applyFont: "Apply font",
    applyTrio: "Apply trio",
    unitDisplay: "Unit display",
    /** Field labels shared by more than one panel. */
    name: "Name",
    author: "Author",
    description: "Description",
    /** The style-tag field: the vocabulary an author picks from, and the one
     *  path to a word it does not hold (spec, "Style tags are … picked, not
     *  typed"). `tagsProposed` composes the pill a proposal is drawn as — the
     *  drawing's own reading, `<tag> · proposed` on a dashed pill
     *  (`store-detail.html`), so a reader knows the word is new rather than that
     *  the facet failed to match. Each refusal names the word it refused,
     *  because the author has to see which one.
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
    /** The background column's own rows: the box its media fills, the one pair
        that moves both axes, and the two paint-time mirrors. The media always
        covers, so there is no fit or scale to name. */
    backgroundBounds: "Bounds",
    backgroundOffset: "Offset",
    backgroundFlipX: "Flip horizontally",
    backgroundFlipY: "Flip vertically",
    /** A paint's own colour, as against the token it is chosen from. */
    colour: "Colour",
    /** Shown when the browser cannot paint what was typed. Named by the value
     *  itself, because the author has to be able to see which of several they
     *  mistyped. */
    colourPicker: "Pick a colour",
    /** The four tracks of the picker's popup, as accessible names. The
     *  `data-testid` hooks (`picker-saturation` and its three siblings) stay
     *  as they are, so a spec addresses them unchanged; the announced name is a
     *  word rather than that selector-shaped token (`vg-336`). */
    pickerSaturation: "Saturation",
    pickerValue: "Value",
    pickerHue: "Hue",
    pickerAlpha: "Alpha",
    /** The hex field inside the picker's popup. Named so the author who types a
     *  colour knows the field takes a hex, not the swatch's other channels. */
    colourHex: "Hex colour",
    gradient: "Gradient",
    colourUnpaintable: (value: string) =>
      `Not a colour the browser can paint: "${value}". Hex, rgb(), hsl() or a CSS colour name.`,
    family: "Family",
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
    /** The curated face a preset adopts, and the trio whose faces are written
        across the presets. Named "Font face"/"Font trio" so the two adoption
        controls are told apart from the Font picker's own trio chooser
        (`trio`), which is a different control on a different surface. */
    fontFace: "Font face",
    fontTrioAdopt: "Font trio",
    trio: "Trio",
    /** The picker's own search and filter row. */
    fontSearch: "Search fonts",
    /** The three facet kinds by what an author chooses between — `mood`,
     *  `useCase` and `superfamily` are the words a `CatalogQuery` is keyed on,
     *  and none of them is a word an author reads. Keyed by that same field
     *  name, so a fourth kind cannot be added to the query without a word for
     *  it appearing here. */
    fontFacetKinds: {
      mood: "Mood",
      useCase: "Use",
      superfamily: "Superfamily",
    },
    /** One active facet is all a `CatalogQuery` holds, so choosing a second
     *  kind silently drops the first. The author cannot see that from three
     *  selects that each look independent, so the picker says the rule rather
     *  than letting them discover it by clicking. */
    fontFacetRule: "Filters are exclusive: choosing one clears the other two.",
    fontSort: "Sort",
    fontSortName: "Name",
    fontSortFamily: "Family",
    fontFavoritesOnly: "Favourites only",
    fontFavorite: "Add to favourites",
    fontUnfavorite: "Remove from favourites",
    fontTrios: "Trios",
    /** Shown on a face row whose weight is the nearest the family ships, so the
     *  number the row shows is the number the apply will write. */
    fontClamped: "nearest available",
    fontBound: "Bound to a packaged face",
    unbindFont: "Unbind",
    noFontMatches: "No font matches this search.",
    loadingFont: "Loading font…",
  },
} as const;
