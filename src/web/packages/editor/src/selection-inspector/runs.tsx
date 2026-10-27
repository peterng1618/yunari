import { Tabs } from "@base-ui/react/tabs";
import type {
  Binding,
  FabricGlobals,
  SampleSource,
  TextRun,
} from "@yunari/renderer-core";
import {
  defaultTypeSize,
  describeSemanticKey,
  formatInstant,
  groupDescriptorsByFamily,
  instantIn,
  knownTimeZones,
  paletteTokenOptions,
  SEMANTIC_KEYS,
  type SemanticKeyDescriptor,
} from "@yunari/renderer-core";
import type * as React from "react";
import { useState } from "react";
import { ControlNumber } from "../components/ui/control-number.js";
import { ControlSegmented } from "../components/ui/control-segmented.js";
import { ControlSelect } from "../components/ui/control-select.js";
import { ControlSwatch } from "../components/ui/control-swatch.js";
import { ControlText } from "../components/ui/control-text.js";
import {
  ControlRow,
  ControlWell,
  useControlIds,
} from "../components/ui/control-well.js";
import { Glyph, PLUS_GLYPH } from "../editor-shell/icons.js";
import {
  FONT_FINDER_ID,
  fontActionOptions,
  IMPORT_LOCAL_FONT_ID,
} from "../type-token-manager/font-actions.js";
import { orderedTokens, tokenName } from "../type-token-manager/name.js";
import { uiCopy } from "../ui-copy.js";
import {
  authoredContentOf,
  type ObjectWithText,
  textRunsOf,
} from "./authored-text.js";
import { runIdentity } from "./run-identity.js";
import type { RunEdits, RunOptionView, RunRowView, RunsView } from "./view.js";

/**
 * Styled runs of a text object (§89): a value, its unit and its label may each
 * carry a different preset and colour. The model already represents this — a
 * run has its own `typeToken` and `style` map — so this is the authoring
 * surface, not a format change.
 *
 * React renders a projected `RunsView` and writes through `RunEdits`; it holds
 * no Fabric object and rebuilds no DOM. The reads that used to walk the object
 * on every render are `projectRuns` below, which returns the same plain value
 * whatever the object is.
 */

/** The read context `projectRuns` needs; the write half is `RunEdits`. */
interface RunsProjection {
  readonly globals: FabricGlobals | undefined;
  readonly locale: string | undefined;
  /**
   * The height of the artboard this object is drawn on. A run that authors no
   * size takes the role default, which is a share of this figure — the same one
   * the canvas paints from.
   */
  readonly artboardHeight: number;
  readonly nodeBindings: ((nodeId: string) => readonly Binding[]) | undefined;
  readonly sampleSource: (() => SampleSource) | undefined;
  /**
   * Whether the selected object is a `Textbox`, the class that owns width,
   * overflow, vertical alignment and ellipsis. Passed in because this module
   * sees the authored content, not the live Fabric class.
   */
  readonly wraps: boolean;
  /**
   * What a palette reference resolves to, for a swatch. Passed in rather than
   * imported so this module does not reach back into `appearance.ts`, which
   * reads `textRunsOf` from here.
   */
  readonly swatchValue: (ref: string) => string | undefined;
  /**
   * The readings the picker offers: the host's catalogue where one was
   * supplied, the built-in table otherwise. A plain array because the caller
   * has already pulled it for this projection, which is also what makes a
   * refreshed catalogue visible on the next render.
   */
  readonly descriptors?: readonly SemanticKeyDescriptor[];
}

/** A run's description for a list: what it is, and what it says. */
function describeRun(run: TextRun): string {
  if (run.kind === "value") {
    return `${uiCopy.inspectorFields.valueRun} (${run.bindingId})`;
  }

  const text = run.text.trim();
  return text.length === 0
    ? uiCopy.inspectorFields.emptyRun
    : text.length > 24
      ? `${text.slice(0, 24)}…`
      : text;
}

/**
 * The palette tokens a run's colour may reference, each under its stored
 * reference and the name its author gave it.
 *
 * The name, not the id, for the reason `tokenOptions` gives: the palette panel,
 * `panel.ts` and `chart-manager` all print the authored name, and printing `cpu`
 * here put the same tokens in the run editor under a second vocabulary.
 */
function paletteOptions(globals: FabricGlobals | undefined): readonly {
  readonly id: string;
  readonly name: string;
  readonly ref: string;
}[] {
  return paletteTokenOptions(globals?.palette, (id) => id !== "none").map(
    (option) => ({ id: option.id, name: option.name, ref: option.id }),
  );
}

/**
 * The type tokens a run may reference, each under its stored reference and the
 * computed name the Tokens pane and the token inspector also print.
 *
 * The order is `orderedTokens`' — the three roles first, then the unroled by
 * computed name — because a second ordering here is a second answer to the same
 * question.
 */
function tokenOptions(
  globals: FabricGlobals | undefined,
): readonly RunOptionView[] {
  return orderedTokens({ typeTokens: globals?.typeTokens ?? {} }).map(
    ({ id, token }) => ({
      id: `typeTokens.${id}`,
      name: tokenName(id, token),
    }),
  );
}

/**
 * The runs whose tracking the object cannot carry separately.
 *
 * Fabric measures spacing once, from the object, so only the first run's style
 * reaches the screen. A later run asking for the *same* value loses nothing, so
 * it is not a gap — matching the model rather than "any letterSpacing" is what
 * keeps this from warning about a run that is already painted as asked. The
 * note names the run, because tracking is the run's own value now and a token
 * carries none.
 */
function presetGaps(runs: readonly TextRun[]): readonly string[] {
  const spacingOf = (run: TextRun): number =>
    styleNumber(run, "letterSpacing") ?? 0;
  const first = runs[0];
  const painted = first === undefined ? 0 : spacingOf(first);
  const gaps: string[] = [];
  // Deduped by the run, not by the note: two later runs may say the same text
  // and are still two runs the object cannot carry separately.
  const seen = new Set<TextRun>();
  for (const run of runs.slice(1)) {
    if (seen.has(run) || spacingOf(run) === painted) continue;
    seen.add(run);
    gaps.push(uiCopy.inspectorFields.runTrackingNotSeparate(describeRun(run)));
  }
  return gaps;
}

/**
 * A numeric literal a run authored under one style key, or undefined when it
 * authored none. A reference or a non-finite value is not a number the row can
 * show, so it reads as absent rather than as `NaN`.
 */
function styleNumber(
  run: TextRun,
  key: "fontSize" | "lineHeight" | "letterSpacing",
): number | undefined {
  const authored = run.style?.[key];
  if (authored === undefined || !("value" in authored)) return undefined;
  const value = authored.value;
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** The type token's id, which is what carries the role. No token — or one that
 *  is not a reference — takes the body ratio, as the renderer's own reader does. */
function tokenIdOf(ref: string): string {
  return ref.startsWith("typeTokens.")
    ? ref.slice("typeTokens.".length)
    : "body";
}

/**
 * What a value run is bound to, and whether anything is arriving.
 *
 * The canvas paints the reading, so a run that names nothing and a run whose
 * sensor is missing look the same on it — both show the em dash. Three states
 * have to stay apart here, because two of them need a different fix: a run that
 * names a binding this object does not declare, a run that is declared and has
 * no reading yet, and a run that is simply working.
 */
function bindingStateOf(
  run: Extract<TextRun, { kind: "value" }>,
  bound: Binding | undefined,
  source: (() => SampleSource) | undefined,
): { readonly note: string; readonly problem?: "undeclared" | "unmapped" } {
  if (bound === undefined) {
    return {
      note: uiCopy.inspectorFields.runUndeclared(run.bindingId),
      problem: "undeclared",
    };
  }

  if (source?.().latest(bound.semanticKey) === undefined) {
    return {
      note: uiCopy.inspectorFields.runUnmapped(bound.semanticKey),
      problem: "unmapped",
    };
  }

  return { note: uiCopy.inspectorFields.runBinding(bound.semanticKey) };
}

/**
 * The run editor's inputs, projected from the object.
 *
 * `undefined` when the object carries no authored text at all: a run editor with
 * nothing in it is an empty box, not a control, so the section does not hold one
 * and its count does not count one.
 */
export function projectRuns(
  object: ObjectWithText,
  nodeId: string,
  context: RunsProjection,
): RunsView | undefined {
  const content = authoredContentOf(object);
  if (content === undefined) return undefined;

  const runs = textRunsOf(object);
  const presets = tokenOptions(context.globals);
  const palettes = paletteOptions(context.globals);
  const bindable = nodeId.length > 0;
  const bindings = bindable ? (context.nodeBindings?.(nodeId) ?? []) : [];

  const pinnedZones: string[] = [];
  const rows = runs.map((run, index) => {
    const bound =
      run.kind === "value"
        ? bindings.find((binding) => binding.id === run.bindingId)
        : undefined;
    const colour =
      (run.style?.["color"] as { readonly ref?: string } | undefined)?.ref ??
      palettes[0]?.ref ??
      "";
    const row: {
      id: string;
      index: number;
      kind: "literal" | "value";
      label: string;
      text: string;
      typeToken: string;
      colour: string;
      size: number;
      lineHeight: number | undefined;
      tracking: number | undefined;
      bindingId: string;
      sourceKey: string;
      unitDisplay: string;
      bindingNote?: string;
      bindingProblem?: "undeclared" | "unmapped";
      format?: string;
      formatDefault?: string;
      zone?: string;
    } = {
      // The row's identity is the run's own object, minted on first sight and
      // carried across the writes that replace one — never a spelling of the
      // run's fields, which two runs can share (`run-identity.ts`, `vg-249`).
      id: runIdentity(run),
      index,
      kind: run.kind,
      label: describeRun(run),
      text: run.kind === "literal" ? run.text : "",
      typeToken: run.typeToken ?? presets[0]?.id ?? "",
      colour,
      // The run's own values, never the token's: size, leading and tracking
      // left the token with the type-token split. A run that authored no size
      // shows the role default the canvas would paint it at.
      size:
        styleNumber(run, "fontSize") ??
        defaultTypeSize(tokenIdOf(run.typeToken ?? ""), context.artboardHeight),
      lineHeight: styleNumber(run, "lineHeight"),
      tracking: styleNumber(run, "letterSpacing"),
      // The binding the run names, as the note's own hook carried it before the
      // column was React (`run.bindingId`, not the row's ordinal): the ordinal
      // is `index` and rides `data-yunari-run`.
      bindingId: run.kind === "value" ? run.bindingId : "",
      sourceKey: bound?.semanticKey ?? "",
      unitDisplay: run.kind === "value" ? (run.unitDisplay ?? "") : "",
    };

    if (bindable) {
      if (run.kind === "value") {
        const state = bindingStateOf(run, bound, context.sampleSource);
        row.bindingNote = state.note;
        if (state.problem !== undefined) row.bindingProblem = state.problem;
      }
      const instant = describeSemanticKey(bound?.semanticKey ?? "")?.instant;
      if (bound !== undefined && instant !== undefined) {
        row.format = bound.format ?? "";
        row.formatDefault = instant.defaultFormat ?? "";
        row.zone = bound.timeZone ?? "";
        const pinned = bound.timeZone;
        if (
          pinned !== undefined &&
          pinned.length > 0 &&
          !pinnedZones.includes(pinned)
        ) {
          pinnedZones.push(pinned);
        }
      }
    }

    return row;
  });

  const zones = knownTimeZones();
  const withPinned = [
    ...pinnedZones.filter((zone) => !zones.includes(zone)),
    ...zones,
  ];
  // Grouped rather than flat: a discovered key sits under the heading of its
  // own family instead of at the end of the list, and consecutive entries
  // sharing a group render as one run.
  const known = new Set<string>();
  const sources = [
    ...groupDescriptorsByFamily(context.descriptors ?? SEMANTIC_KEYS),
  ].flatMap(([group, descriptors]) =>
    descriptors.map((descriptor) => {
      known.add(descriptor.key);
      return {
        id: descriptor.key,
        name: descriptor.label,
        group,
      };
    }),
  );
  // A theme may name a key this host no longer lists. Dropping it would show
  // the run as reading nothing and offer no way back to the key it holds, so a
  // declared binding the catalogue does not know stays, ungrouped, under its
  // own spelling — the rule a chart's series options follow.
  const retained = [...new Set(bindings.map((binding) => binding.semanticKey))]
    .filter((key) => !known.has(key))
    .map((key) => ({ id: key, name: key }));

  const swatchValues: Record<string, string> = {};
  for (const option of palettes) {
    const value = context.swatchValue(option.ref);
    if (value !== undefined) swatchValues[option.ref] = value;
  }

  return {
    nodeId,
    runs: rows,
    wraps: context.wraps,
    layout: {
      align: typeof content["align"] === "string" ? content["align"] : "left",
      verticalAlign:
        typeof content["verticalAlign"] === "string"
          ? content["verticalAlign"]
          : "top",
      overflow:
        typeof content["overflow"] === "string" ? content["overflow"] : "clip",
    },
    presets,
    palettes: palettes.map(({ id, name }) => ({ id, name })),
    swatchValues,
    unitOptions: Object.entries(uiCopy.unitDisplayOptions).map(
      ([id, name]) => ({
        id,
        name,
      }),
    ),
    sources: [
      { id: "", name: uiCopy.inspectorFields.staticText },
      ...sources,
      ...retained,
    ],
    zones: withPinned,
    bindable,
    removable: runs.length > 1,
    locale: context.locale,
    notes: presetGaps(runs),
  };
}

const ALIGN_OPTIONS = [
  { id: "left", name: uiCopy.inspectorFields.left },
  { id: "center", name: uiCopy.inspectorFields.centre },
  { id: "right", name: uiCopy.inspectorFields.right },
];

const VERTICAL_OPTIONS = [
  { id: "top", name: uiCopy.inspectorFields.verticalTop },
  { id: "middle", name: uiCopy.inspectorFields.verticalMiddle },
  { id: "bottom", name: uiCopy.inspectorFields.verticalBottom },
];

const OVERFLOW_OPTIONS = [
  { id: "clip", name: uiCopy.inspectorFields.clip },
  { id: "ellipsis", name: uiCopy.inspectorFields.ellipsis },
  { id: "visible", name: uiCopy.inspectorFields.overflowVisible },
];

const ZONE_FOLLOWS = { id: "", name: uiCopy.inspectorFields.runZoneFollows };

/** The zone list as options: "follow the display" first, then every pinned zone. */
function zoneOptions(view: RunsView): readonly RunOptionView[] {
  return [
    ZONE_FOLLOWS,
    ...view.zones.map((zone) => ({ id: zone, name: zone })),
  ];
}

/**
 * The reading a format pattern produces now, from the same preview source the
 * editor's own preview reads. Live as the author types, because a token that
 * renders itself is visible only here and on a wall display where they are not.
 */
function previewOf(
  semanticKey: string,
  pattern: string,
  zone: string | undefined,
  locale: string | undefined,
): string {
  const instant = describeSemanticKey(semanticKey)?.instant;
  const shown = pattern === "" ? (instant?.defaultFormat ?? "") : pattern;
  // An unpinned zone is the display's own, which the formatter spells as no
  // zone at all; "" is a valid option id and not a valid IANA name.
  const pinned = zone === undefined || zone === "" ? undefined : zone;
  return (
    formatInstant(instantIn(Date.now()), shown, pinned, locale) ??
    uiCopy.inspectorFields.unresolved
  );
}

/**
 * The format field with its live preview and its token vocabulary.
 *
 * Bespoke rather than `ControlText` because the preview must follow the draft as
 * it is typed, and a committed-only control has no draft to read. The well is
 * still `ControlWell`, so the row is the same shape as every other.
 */
function RunFormatField(props: {
  readonly index: number;
  readonly format: string;
  readonly formatDefault: string;
  readonly semanticKey: string;
  readonly zone: string | undefined;
  readonly locale: string | undefined;
  readonly onCommit: (format: string) => void;
}): React.JSX.Element {
  const { index, format, formatDefault, semanticKey, zone, locale } = props;
  const ids = useControlIds(`yunari-run-format-${index}`);
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? format;

  const commit = (): void => {
    const next = draft ?? format;
    setDraft(null);
    if (next !== format) props.onCommit(next);
  };

  return (
    <>
      <ControlRow
        ids={ids}
        label={uiCopy.inspectorFields.runFormat}
        labelFor={ids.control}
      >
        <ControlWell>
          <input
            id={ids.control}
            type="text"
            data-yunari-run-format={String(index)}
            maxLength={64}
            placeholder={formatDefault}
            className="h-full w-full bg-transparent text-sm text-text outline-none"
            value={shown}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              }
              if (event.key === "Escape" && draft !== null) {
                event.preventDefault();
                setDraft(null);
              }
            }}
            onBlur={commit}
          />
        </ControlWell>
      </ControlRow>
      <span
        className="yunari-run-preview text-xs text-muted"
        data-yunari-run-format-preview={String(index)}
      >
        {previewOf(semanticKey, shown, zone, locale)}
      </span>
      <p
        className="yunari-run-note text-xs text-faint"
        data-yunari-run-format-hint={String(index)}
      >
        {uiCopy.inspectorFields.runFormatTokens}
      </p>
    </>
  );
}

/** One run: its text, its preset, its colour, and what it reads. */
function RunRow(props: {
  readonly row: RunRowView;
  readonly view: RunsView;
  readonly edits: RunEdits;
  /**
   * Called before the write, so the editor can stop following the last run:
   * removing the selected last one must leave the *first* remaining run
   * selected, not whatever is last now.
   */
  readonly onRemove: (index: number) => void;
}): React.JSX.Element {
  const { row, view, edits, onRemove } = props;
  const index = row.index;

  /**
   * Picking a token writes that run; picking an action row runs it instead.
   * Neither action writes the run's reference by itself — the import points the
   * run only once its commit names the token it produced, and the finder writes
   * its own target.
   */
  const chooseToken = (ref: string): void => {
    if (ref === IMPORT_LOCAL_FONT_ID) {
      edits.importLocalFont?.((tokenId) =>
        edits.setRunPreset(index, `typeTokens.${tokenId}`),
      );
      return;
    }
    if (ref === FONT_FINDER_ID) {
      edits.openFontFinder?.();
      return;
    }
    edits.setRunPreset(index, ref);
  };

  return (
    // A row group, not a `<section>`: the inspector's section rule sets
    // `display: block` on every section in the panel and would flatten the gap.
    <div
      data-yunari-run={String(index)}
      className="flex flex-col gap-[var(--space-6)]"
    >
      <p className="yunari-run-label text-xs text-muted">{row.label}</p>

      {row.kind === "literal" ? (
        <ControlText
          label={uiCopy.inspectorFields.runText}
          data={{ "data-yunari-run-text": String(index) }}
          value={row.text}
          onCommit={(text) => edits.setRunText(index, text)}
        />
      ) : null}

      <ControlSelect
        label={uiCopy.inspectorFields.runToken}
        data={{ "data-yunari-run-preset": String(index) }}
        value={row.typeToken}
        options={[...view.presets, ...fontActionOptions(edits)]}
        onChange={chooseToken}
      />

      {/* The run's own type values, in the order a reader sets them. Clearing a
          row removes the key: size returns to the role default, and leading and
          tracking return to no value, because neither has a role fallback. */}
      <ControlNumber
        label={uiCopy.inspectorFields.runSize}
        data={{ "data-yunari-run-size": String(index) }}
        value={row.size}
        min={1}
        onCommit={(value) => edits.setRunSize(index, value)}
        onClear={() => edits.setRunSize(index, undefined)}
      />

      <ControlNumber
        label={uiCopy.panels.lineHeight}
        data={{ "data-yunari-run-line-height": String(index) }}
        value={row.lineHeight}
        // The writer rounds to two decimals, so 0.01 is the smallest multiplier
        // it can store; the control refuses a smaller draft rather than dropping
        // it, and the writer refuses it again.
        min={0.01}
        onCommit={(value) => edits.setRunLineHeight(index, value)}
        onClear={() => edits.setRunLineHeight(index, undefined)}
      />

      <ControlNumber
        label={uiCopy.panels.letterSpacing}
        data={{ "data-yunari-run-letter-spacing": String(index) }}
        value={row.tracking}
        onCommit={(value) => edits.setRunTracking(index, value)}
        onClear={() => edits.setRunTracking(index, undefined)}
      />

      <ControlSwatch
        label={uiCopy.inspectorFields.runColour}
        data={{ "data-yunari-run-colour": String(index) }}
        value={row.colour}
        options={view.palettes}
        swatch={
          <span
            aria-hidden
            className="block size-[10px] rounded-sm border border-edge"
            style={{ background: colourValueOf(view, row.colour) }}
          />
        }
        onChange={(ref) => edits.setRunColour(index, ref)}
      />

      {view.bindable ? (
        <ControlSelect
          label={uiCopy.inspectorFields.runSource}
          data={{ "data-yunari-run-source": String(index) }}
          value={row.sourceKey}
          options={view.sources}
          onChange={(key) => edits.setSource(index, key)}
        />
      ) : null}

      {view.bindable && row.kind === "value" ? (
        <>
          <p
            className="yunari-run-note text-xs text-muted"
            data-yunari-run-binding={row.bindingId}
            {...(row.bindingProblem === undefined
              ? {}
              : { "data-yunari-run-problem": row.bindingProblem })}
          >
            {row.bindingNote}
          </p>
          <ControlSelect
            label={uiCopy.panels.unitDisplay}
            data={{ "data-yunari-run-unit-display": String(index) }}
            value={row.unitDisplay}
            options={view.unitOptions}
            onChange={(value) => edits.setUnitDisplay(index, value)}
          />
        </>
      ) : null}

      {row.format !== undefined &&
      row.formatDefault !== undefined &&
      row.zone !== undefined ? (
        <>
          <RunFormatField
            index={index}
            format={row.format}
            formatDefault={row.formatDefault}
            semanticKey={row.sourceKey}
            zone={row.zone}
            locale={view.locale}
            onCommit={(format) => edits.setFormat(index, format)}
          />
          <ControlSelect
            label={uiCopy.inspectorFields.runZone}
            data={{ "data-yunari-run-zone": String(index) }}
            value={row.zone}
            options={zoneOptions(view)}
            onChange={(zone) => edits.setZone(index, zone)}
          />
        </>
      ) : null}

      {view.removable ? (
        <button
          type="button"
          data-yunari-run-remove={String(index)}
          className="self-start text-xs text-muted"
          onClick={() => onRemove(index)}
        >
          {uiCopy.inspectorFields.removeRun(index + 1)}
        </button>
      ) : null}
    </div>
  );
}

/** The resolved colour a swatch shows, or `transparent` when it no longer resolves. */
function colourValueOf(view: RunsView, ref: string): string {
  return view.swatchValues[ref] ?? "transparent";
}

/**
 * The run editor: the layout controls, a numbered tab per run, the selected
 * run's fields, and the add button.
 *
 * The caret rule the imperative editor needed a focus-restoring pair for is
 * React's own here: a row keys on its runtime identity and the values are
 * props, so a re-publish updates the focused input rather than replacing it,
 * and a checkbox never regains focus it was not holding. See `index.ts`.
 */
export function RunEditor(props: {
  readonly runs: RunsView;
  readonly edits: RunEdits;
}): React.JSX.Element {
  const { runs: view, edits } = props;
  // Which tab is showing is React's own: not authored, never in the view, the
  // envelope or history. Keyed by the row's runtime identity so removing a
  // different run does not move the selection off the run being edited.
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  // `+` appends a run whose identity is only minted when the re-published view
  // arrives, so the selection follows the last run rather than guessing its id.
  const [followLast, setFollowLast] = useState(false);
  const selected = followLast
    ? view.runs.at(-1)
    : (view.runs.find((row) => row.id === selectedId) ?? view.runs[0]);

  const remove = (index: number): void => {
    setFollowLast(false);
    // The selected id names the run being removed, so it must not survive as a
    // fallback: a stale one would restore a tab that was selected before `+`.
    setSelectedId(undefined);
    edits.removeRun(index);
  };

  return (
    <div data-yunari-runs="" className="flex flex-col gap-[var(--space-6)]">
      <h3 className="m-0 text-xs font-semibold text-muted">
        {uiCopy.inspectorFields.runs}
      </h3>

      <ControlSegmented
        label={uiCopy.inspectorFields.align}
        data={{ "data-yunari-text-align": "" }}
        value={view.layout.align}
        options={ALIGN_OPTIONS}
        onChange={(align: string) => edits.writeLayout({ align })}
      />
      {/* Overflow and vertical placement are the box's contract: a point text
          has no authored height to clip or place inside, so the two controls
          that write them would accept an edit nothing paints. */}
      {view.wraps ? (
        <>
          <ControlSegmented
            label={uiCopy.inspectorFields.verticalAlign}
            data={{ "data-yunari-text-vertical-align": "" }}
            value={view.layout.verticalAlign}
            options={VERTICAL_OPTIONS}
            onChange={(verticalAlign: string) =>
              edits.writeLayout({ verticalAlign })
            }
          />
          <ControlSegmented
            label={uiCopy.inspectorFields.overflow}
            data={{ "data-yunari-text-overflow": "" }}
            value={view.layout.overflow}
            options={OVERFLOW_OPTIONS}
            onChange={(overflow: string) => edits.writeLayout({ overflow })}
          />
        </>
      ) : null}
      <Tabs.Root
        value={selected?.id ?? null}
        onValueChange={(value) => {
          if (typeof value !== "string") return;
          setFollowLast(false);
          setSelectedId(value);
        }}
        className="flex flex-col gap-[var(--space-6)]"
      >
        {/* The add action sits after the tablist rather than inside it: a
            tablist owns tabs, and a reader should not meet a foreign button in
            the middle of the strip. The row wraps, so the + follows the last
            tab on the same line. */}
        <div className="flex flex-wrap items-center gap-[var(--space-4)]">
          <Tabs.List
            activateOnFocus
            className="flex flex-wrap items-center gap-[var(--space-4)]"
          >
            {view.runs.map((row, at) => (
              <Tabs.Tab
                key={row.id}
                value={row.id}
                data-yunari-run-tab={String(at + 1)}
                aria-label={uiCopy.inspectorFields.runTab(at + 1)}
                className="rounded-t-[var(--radius-sm)] px-[var(--space-12)] py-[var(--space-8)] text-sm text-muted data-[selected]:bg-[var(--panel-2)] data-[selected]:text-text"
              >
                {at + 1}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          <button
            type="button"
            data-yunari-run-add=""
            aria-label={uiCopy.inspectorFields.addRun}
            className="text-xs text-muted"
            onClick={() => {
              if (edits.addRun()) setFollowLast(true);
            }}
          >
            <Glyph icon={PLUS_GLYPH} size={12} />
          </button>
        </div>

        {selected === undefined ? null : (
          <Tabs.Panel
            value={selected.id}
            className="flex flex-col gap-[var(--space-6)]"
          >
            {/* Keyed by identity, so moving to another tab remounts the fields:
                a draft belongs to the run it was typed into. */}
            <RunRow
              key={selected.id}
              row={selected}
              view={view}
              edits={edits}
              onRemove={remove}
            />
          </Tabs.Panel>
        )}
      </Tabs.Root>

      {view.notes.map((note) => (
        <p
          key={note}
          className="yunari-run-note text-xs text-muted"
          data-yunari-run-note=""
        >
          {note}
        </p>
      ))}
    </div>
  );
}
