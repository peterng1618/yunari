import {
  type Binding,
  type ChartContent,
  type ChartFamily,
  chartPaintFieldsFor,
  defaultAnimationSettings,
  defaultBarSettings,
  defaultGaugeSettings,
  defaultLineSettings,
  defaultPieSettings,
  defaultPolarBarSettings,
  defaultRadarSettings,
  type FabricPalette,
  paletteTokenOptions,
  readSetting,
  SEMANTIC_KEYS,
  type SemanticKeyDescriptor,
  type SettingsFieldDescriptor,
  settingsFieldsFor,
} from "@yunari/renderer-core";
import { isSettingVisible } from "../editor-shell/controls/settings-field.js";
import { uiCopy } from "../ui-copy.js";
import type {
  ChartAspectView,
  ChartContentFieldsView,
  ChartOptionView,
  ChartPaintFieldsView,
  ChartPaintRowView,
  ChartSeriesFieldsView,
  ChartSeriesRowView,
  ChartSettingView,
} from "./chart-fields.js";

/**
 * A chart's own fields, as the values the React column renders.
 *
 * The chart manager owns the chart — which one is selected, its settings, its
 * bindings — and this module owns only the reading that turns those into
 * controls' inputs. It builds no DOM and writes nothing: `chart-fields.tsx`
 * renders these values through plan 1's control set and calls back into the
 * manager's `ChartEdits`.
 *
 * Ids and datasets are what they were when the panel rendered these controls
 * into a Data tab, so every spec, screenshot and driver selector that addressed
 * `yunari-chart-setting-*`, `yunari-chart-binding-*` and
 * `yunari-chart-paint-*` still addresses the same control.
 */

/** Everything the controls read, gathered by the owner so the column restates
    none of it: the family and settings off the object, the bindings off the
    envelope, and the ratio read off the object's own shape. */
export interface ChartFieldTarget {
  readonly id: string;
  readonly content: ChartContent;
  readonly bindings: readonly Binding[];
  readonly aspect?: number;
  /**
   * The smaller edge of the chart's own drawn box, in artboard units — what the
   * renderer sizes the chart's canvas from, and the ceiling a pixel measure in
   * its settings is read against. Absent when the object measures nothing, which
   * leaves those fields typed rather than bounded by a guess (`vg-469`).
   */
  readonly drawnEdge?: number;
}

/**
 * The family's own defaults, plus the block a nested write materialises: the
 * value a setting draws with when the author has not set it.
 *
 * Read from the objects that own them (`default*Settings`) rather than restated
 * here or in the descriptor table, which deliberately declares no defaults. A
 * slider is why the surface needs one at all: a typed box shows an empty
 * placeholder, and a track has to start somewhere — and the honest somewhere is
 * the number the renderer is drawing with.
 */
function defaultsOf(family: ChartFamily): unknown {
  const families: Readonly<Record<ChartFamily, unknown>> = {
    gauge: defaultGaugeSettings,
    line: defaultLineSettings,
    bar: defaultBarSettings,
    pie: defaultPieSettings,
    radar: defaultRadarSettings,
    polarBar: defaultPolarBarSettings,
  };
  return {
    animation: defaultAnimationSettings,
    ...(families[family] as object),
  };
}

/** The authored value, when the author wrote a finite number: absent is absent,
    never a zero nobody typed. */
function authoredNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * The ceiling a slider takes, or nothing when the field has no ceiling this
 * surface can read.
 *
 * Both bounds where the descriptor declares them; the chart's own drawn box for
 * a pixel measure, halved for a radius; and nothing at all when the field's only
 * bound is its floor — `windowSeconds`, `maxPoints` and `total.value` are
 * bounded by the sample store and by the chart's data, so a track would offer a
 * range nothing honours.
 */
function ceilingOf(
  field: SettingsFieldDescriptor,
  drawnEdge: number | undefined,
): { readonly min: number; readonly max: number } | undefined {
  const min = field.min ?? 0;
  if (field.max !== undefined) return { min, max: field.max };
  if (field.bound === undefined || drawnEdge === undefined) return undefined;
  return {
    min,
    max: field.bound === "halfDrawnBox" ? Math.floor(drawnEdge / 2) : drawnEdge,
  };
}

/**
 * How many readings a family draws, per `buildChartPlan`: a line series, a bar
 * and a slice are one binding each, and a gauge reads `bindings[0]` and nothing
 * else. So the gauge's second binding would be a control that accepts an edit
 * and applies none.
 */
const MAX_BINDINGS: Readonly<Record<ChartFamily, number>> = {
  gauge: 1,
  line: Number.POSITIVE_INFINITY,
  bar: Number.POSITIVE_INFINITY,
  pie: Number.POSITIVE_INFINITY,
  // More spokes than twelve collapse the polygon at theme sizes (§D1).
  radar: 12,
  polarBar: Number.POSITIVE_INFINITY,
};

/** The ratios the line-chart control group offers, widest last. It lives here
    because this is the group that offers them; `index.ts` reads it to decide
    which one a chart is at, rather than listing the three a second time. */
export const ASPECT_RATIOS: readonly number[] = [2, 3, 4];

/** The unit-display choices, from the one table that owns those words. */
const UNIT_OPTIONS: readonly ChartOptionView[] = Object.entries(
  uiCopy.unitDisplayOptions,
).map(([id, name]) => ({ id, name }));

function semanticKeyOptions(
  descriptors: readonly SemanticKeyDescriptor[],
): readonly ChartOptionView[] {
  return descriptors.map((descriptor) => ({
    id: descriptor.key,
    name: descriptor.label,
  }));
}

/**
 * The ratio group, for the one family that has one.
 *
 * Read off the object rather than remembered from the last click, so a chart the
 * author dragged is described by its own shape. A ratio the chart is not at
 * leaves the group with nothing pressed rather than lighting up a neighbour.
 */
function aspectView(target: ChartFieldTarget): ChartAspectView {
  return {
    id: "yunari-chart-aspect",
    label: "Aspect ratio",
    value: target.aspect === undefined ? "" : String(target.aspect),
    options: ASPECT_RATIOS.map((ratio) => ({
      id: String(ratio),
      name: `${ratio}:1`,
    })),
  };
}

function seriesRow(
  binding: Binding,
  moreThanOne: boolean,
  descriptors: readonly SemanticKeyDescriptor[],
): ChartSeriesRowView {
  // The series' own key is offered even when no descriptor declares it: a
  // document can name one the catalogue no longer has, and a picker that
  // dropped it would show the series as reading nothing.
  const keys = new Set([
    binding.semanticKey,
    ...descriptors.map((descriptor) => descriptor.key),
  ]);
  return {
    binding,
    keyOptions: [...keys].map((key) => ({
      id: key,
      name:
        descriptors.find((descriptor) => descriptor.key === key)?.label ?? key,
    })),
    removable: moreThanOne,
  };
}

function seriesFields(
  target: ChartFieldTarget,
  descriptors: readonly SemanticKeyDescriptor[],
): ChartSeriesFieldsView {
  const { bindings, content } = target;
  const full = bindings.length >= MAX_BINDINGS[content.family];
  return {
    id: "yunari-chart-series",
    label: uiCopy.inspectorFields.runSeries,
    // The prompt is the chooser's own first entry, as it was when this was a
    // `<select>`: the value is consumed by the click that makes it, so the
    // control always shows what it is for rather than the series it just added.
    options: [
      { id: "", name: uiCopy.inspectorFields.runSeries },
      ...semanticKeyOptions(descriptors),
    ],
    refused: full,
    ...(full
      ? { full: uiCopy.inspectorFields.runSeriesFull(content.family) }
      : {}),
    unitOptions: UNIT_OPTIONS,
    rows: bindings.map((binding) =>
      seriesRow(binding, bindings.length > 1, descriptors),
    ),
  };
}

/**
 * The family's settings, one row per descriptor the author can see here.
 *
 * A `visibleWhen` that does not match is not a question in this state, so it
 * renders nothing — unlike a refused field, which renders and says why.
 *
 * **A bounded number is a slider, and its bound comes from its owner.** The ten
 * descriptors that carry both bounds hand those over; a pixel measure is
 * bounded by the chart's own drawn box (half of it for a radius), read off the
 * object the renderer sizes its canvas from rather than chosen here; and a
 * field with a minimum and no ceiling this table can name — `windowSeconds`,
 * `maxPoints`, `total.value` — keeps its typed box, because a track would offer
 * a range the store or the data does not honour (`vg-469`).
 */
function settingRows(
  content: ChartContent,
  drawnEdge: number | undefined,
): readonly ChartSettingView[] {
  const rows: ChartSettingView[] = [];

  for (const field of settingsFieldsFor(content.family)) {
    if (!isSettingVisible(field, content.settings)) continue;
    // A nested setting commits through its own `path`: a flat
    // `{...settings, [property]: value}` writes a key the validator accepts and
    // the renderer never reads, so the author's choice survives the click and
    // dies on reopen.
    const path = field.path ?? [field.property];
    const value = readSetting(content.settings, path);
    const id = `yunari-chart-setting-${field.property}`;

    if (field.kind === "number") {
      // A discrete number is a track over its own list: its ends are the list's,
      // and the values between two members are not commits any adapter draws.
      if (field.values !== undefined) {
        const values = field.values;
        rows.push({
          id,
          key: field.property,
          label: field.label,
          hint: field.hint,
          path,
          control: "slider",
          value:
            authoredNumber(value) ??
            authoredNumber(readSetting(defaultsOf(content.family), path)) ??
            values.at(-1) ??
            1,
          min: values[0] ?? 1,
          max: values.at(-1) ?? 1,
          values,
          ...(field.decimals === undefined ? {} : { decimals: field.decimals }),
          ...(field.suffix === undefined ? {} : { suffix: field.suffix }),
          clearable: false,
        });
        continue;
      }
      const bound = ceilingOf(field, drawnEdge);
      if (bound !== undefined) {
        rows.push({
          id,
          key: field.property,
          label: field.label,
          hint: field.hint,
          path,
          control: "slider",
          // What the renderer draws: the authored number where there is one,
          // and the family's own default where the key is absent — a track has
          // no empty state, and showing a floor it did not choose would be the
          // field believing itself rather than the picture (`vg-109`).
          value:
            authoredNumber(value) ??
            authoredNumber(readSetting(defaultsOf(content.family), path)) ??
            bound.min,
          min: bound.min,
          max: bound.max,
          ...(field.decimals === undefined ? {} : { decimals: field.decimals }),
          ...(field.suffix === undefined ? {} : { suffix: field.suffix }),
          clearable: field.optional === true,
        });
        continue;
      }
      rows.push({
        id,
        key: field.property,
        label: field.label,
        hint: field.hint,
        path,
        control: "number",
        // Absent is an empty box, never a zero: "empty lets the data choose it"
        // is what the descriptor's `optional` promises.
        value: authoredNumber(value),
        ...(field.min === undefined ? {} : { min: field.min }),
        ...(field.max === undefined ? {} : { max: field.max }),
        clearable: field.optional === true,
      });
      continue;
    }

    if (field.kind === "boolean") {
      rows.push({
        id,
        key: field.property,
        label: field.label,
        hint: field.hint,
        path,
        control: "toggle",
        value: value === true,
      });
      continue;
    }

    rows.push({
      id,
      key: field.property,
      label: field.label,
      hint: field.hint,
      path,
      control: "select",
      value: typeof value === "string" ? value : "",
      options: (field.options ?? []).map(optionView),
      clearable: field.optional === true,
    });
  }

  return rows;
}

function optionView(option: {
  readonly value: string;
  readonly label: string;
}): ChartOptionView {
  return { id: option.value, name: option.label };
}

/** What the chart shows: its family's settings, and the series it reads. */
export function chartContentView(
  target: ChartFieldTarget,
  descriptors: readonly SemanticKeyDescriptor[] = SEMANTIC_KEYS,
): ChartContentFieldsView {
  return {
    chartId: target.id,
    content: target.content,
    ...(target.content.family === "line" ? { aspect: aspectView(target) } : {}),
    series: seriesFields(target, descriptors),
    rows: settingRows(target.content, target.drawnEdge),
  };
}

/** One paint reference as a control: its label, its token, and the tokens it
    may name. A `multiple` field names its slices `palette.0`, `palette.1`, so
    the key carries the index — one control per slice, each with its own label. */
function paintRow(
  property: string,
  label: string,
  index: number | undefined,
  value: unknown,
  options: readonly ChartOptionView[],
): ChartPaintRowView {
  const key = index === undefined ? property : `${property}.${index}`;
  const ref = isPaletteReference(value) ? value.ref : "";
  return {
    id: `yunari-chart-paint-${key.replaceAll(".", "-")}`,
    key,
    label: index === undefined ? label : `${label} ${index + 1}`,
    property,
    ...(index === undefined ? {} : { index }),
    ref,
    options,
    // A reference that is not a palette token has no valid choice to change it
    // to, and so has a palette that offers none: the row shows where the paint
    // is rather than accepting an edit that would write a token choice nobody
    // made.
    refused: ref === "" || options.length === 0,
  };
}

/** What ink: the family's own paint fields, one control per reference. */
export function chartPaintView(
  target: ChartFieldTarget,
  palette: FabricPalette | undefined,
): ChartPaintFieldsView {
  const { content } = target;
  const options: readonly ChartOptionView[] = paletteTokenOptions(palette);
  const settings = content.settings as unknown as Record<string, unknown>;
  const rows: ChartPaintRowView[] = [];

  for (const field of chartPaintFieldsFor(content.family)) {
    const value = settings[field.property];
    if (field.multiple === true && Array.isArray(value)) {
      value.forEach((paint, index) => {
        rows.push(paintRow(field.property, field.label, index, paint, options));
      });
      continue;
    }
    if (!Array.isArray(value) && value !== undefined) {
      rows.push(
        paintRow(field.property, field.label, undefined, value, options),
      );
    }
  }

  return { chartId: target.id, content, rows };
}

function isPaletteReference(value: unknown): value is { readonly ref: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)["ref"] === "string"
  );
}
