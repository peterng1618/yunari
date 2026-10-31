import {
  type Binding,
  type ChartContent,
  removeSetting,
  type SettingsFieldDescriptor,
  writeSetting,
} from "@yunari/renderer-core";
import type * as React from "react";
import { ControlNumber } from "../components/ui/control-number.js";
import { ControlSegmented } from "../components/ui/control-segmented.js";
import { ControlSelect } from "../components/ui/control-select.js";
import { ControlSlider } from "../components/ui/control-slider.js";
import { SettingField } from "../selection-inspector/setting-field.js";
import { uiCopy } from "../ui-copy.js";

/**
 * A chart's own controls, as React.
 *
 * The chart manager owns the chart — which one is selected, its settings, its
 * bindings — and `panel.ts` projects that into the values below. This module
 * turns those values into plan-1 controls and turns a control's edit back into
 * one `ChartEdits` call; it resolves no chart of its own, writes no settings and
 * redraws nothing. That is the whole boundary: a chart's questions render here,
 * the answers are the manager's.
 *
 * **These are not `SelectionEdits` fields on purpose.** A chart's writes are its
 * own rules — the series ceiling, the nested setting path, the per-series paint
 * array — and routing them through the inspector's generic dispatcher would put
 * a second owner of them beside `chart-manager`. The `data-*` hooks are the ones
 * a chart's specs, screenshots and drivers already address.
 */

/**
 * A binding's precision range, as the document format states it.
 *
 * Written here rather than exported from the validator because the range has two
 * owners already and neither can import the other: the published JSON schema
 * (`schema/theme-document.schema.json`) and `fabric-envelope-validate.ts` each
 * state 0–6, and a constant in one of them would leave the third spelling
 * beside it. What the field must not do is invent a range of its own, and it
 * does not — these are the schema's numbers.
 */
const MIN_PRECISION = 0;
const MAX_PRECISION = 6;

/**
 * What the track shows when the binding carries no precision.
 *
 * The renderer's rule for an absent precision is "at most one decimal" —
 * per-value, and not a member of this integer range — so the track shows the
 * range's own floor. It is the same fallback the chart settings state for an
 * optional number with no family default (`chart-manager/panel.ts`'s
 * `settingRows`).
 *
 * **The floor is the track's, and the well reads the document.** The field beside
 * the track renders empty while the binding carries no precision, so the state
 * the author is in is tellable from the one they left: dragging `0 → 2 → 0` to
 * put the number back writes `precision: 0` and switches the chart from "at most
 * one decimal" to whole numbers, and the `0` that lands in the field is what says
 * so. The empty draft is still the route back to absent (`vg-497`).
 */
const PRECISION_FLOOR = MIN_PRECISION;

/** One entry in a chart control's list: the stored value, and its name. */
export interface ChartOptionView {
  readonly id: string;
  readonly name: string;
}

/** The kind of control one descriptor asked for, and the value it holds. */
export type ChartSettingView =
  | {
      readonly descriptor: SettingsFieldDescriptor;
      readonly id: string;
      /** The descriptor's own `property`, which is the `data-*` hook's value. */
      readonly key: string;
      readonly label: string;
      /** What the setting does, in the author's language — the row's tooltip
       *  and the note the control describes itself by. Never its label again. */
      readonly hint: string;
      /** Where inside the settings object this row writes. */
      readonly path: readonly string[];
      readonly control: "number";
      readonly value: number | undefined;
      readonly min?: number;
      readonly max?: number;
      /** `descriptor.optional`: the empty box is a removal, not a zero. */
      readonly clearable: boolean;
    }
  | {
      readonly descriptor: SettingsFieldDescriptor;
      readonly id: string;
      readonly key: string;
      readonly label: string;
      readonly hint: string;
      readonly path: readonly string[];
      readonly control: "slider";
      /**
       * Always a number, where the number arm's may be absent: a track has no
       * empty state, so an unauthored setting shows the family's own default
       * rather than nothing. The setting rows keep that fallback in the well too
       * — a series' precision does not, because its fallback is not what the
       * renderer draws (`vg-497`).
       */
      readonly value: number;
      readonly min: number;
      readonly max: number;
      /** The only commits this track may make, when the setting is discrete. */
      readonly values?: readonly number[];
      /** `descriptor.decimals`: display precision, not the stored value's. */
      readonly decimals?: number;
      /** `descriptor.integer`: the track steps by 1 and the well refuses a
       *  fraction. */
      readonly integer?: true;
      /** `descriptor.suffix`: what the number is a share of, written beside it. */
      readonly suffix?: string;
      /** `descriptor.optional`: the well's empty draft is a removal, which is
       *  the one way back to "the renderer decides". */
      readonly clearable: boolean;
    }
  | {
      readonly descriptor: SettingsFieldDescriptor;
      readonly id: string;
      readonly key: string;
      readonly label: string;
      readonly hint: string;
      readonly path: readonly string[];
      readonly control: "toggle";
      readonly value: boolean;
    }
  | {
      readonly descriptor: SettingsFieldDescriptor;
      readonly id: string;
      readonly key: string;
      readonly label: string;
      readonly hint: string;
      readonly path: readonly string[];
      readonly control: "select";
      readonly value: string;
      readonly options: readonly ChartOptionView[];
      readonly clearable: boolean;
    };

/** The line-chart ratio group: which of them is applied, and the whole list. */
export interface ChartAspectView {
  readonly id: string;
  readonly label: string;
  /** The applied ratio as a string, or `""` when the chart is at none of them. */
  readonly value: string;
  readonly options: readonly ChartOptionView[];
}

/**
 * One series, and the binding it **is**.
 *
 * The binding crosses whole rather than field by field: it is the object the
 * manager writes back, it is plain data, and reconstructing it here would be a
 * second spelling of its shape. Its `id` is also the row's React key, which is
 * why this list needs none of the content-derived identity `projectRuns` has to
 * invent — a binding is minted with an id, and `carriedPaintFor` already treats
 * that id as the identity of a series.
 */
export interface ChartSeriesRowView {
  readonly binding: Binding;
  /** Every key this series may read, its own included even when it is unknown. */
  readonly keyOptions: readonly ChartOptionView[];
  /** False on the last series: a chart with nothing bound draws no data. */
  readonly removable: boolean;
}

/** The series question: the chooser, the ceiling, and one row per series. */
export interface ChartSeriesFieldsView {
  readonly id: string;
  readonly label: string;
  /** The keys a series may be declared with; the first entry is the prompt. */
  readonly options: readonly ChartOptionView[];
  /** At the family's ceiling, so the chooser offers nothing. */
  readonly refused: boolean;
  readonly full?: string;
  readonly unitOptions: readonly ChartOptionView[];
  readonly rows: readonly ChartSeriesRowView[];
}

/** Everything the Content section's chart half renders. */
export interface ChartContentFieldsView {
  readonly chartId: string;
  /** The chart's own content, so a nested commit knows the object it started from. */
  readonly content: ChartContent;
  readonly aspect?: ChartAspectView;
  readonly series: ChartSeriesFieldsView;
  readonly rows: readonly ChartSettingView[];
}

/** One paint reference: the token it names now, and the tokens it may name. */
export interface ChartPaintRowView {
  readonly id: string;
  /** The `data-yunari-chart-paint` value: `track`, or `palette.0` for a slice. */
  readonly key: string;
  readonly label: string;
  /** The settings key this row writes, without the repeated index. */
  readonly property: string;
  /** The slot inside a repeated paint array; absent for a single reference. */
  readonly index?: number;
  /** The referenced token, or `""` when the chart names one that is not a token. */
  readonly ref: string;
  readonly options: readonly ChartOptionView[];
  /** No reference to change, or no token to change it to. */
  readonly refused: boolean;
}

/** Everything the Paint section's chart half renders. */
export interface ChartPaintFieldsView {
  readonly chartId: string;
  readonly content: ChartContent;
  readonly rows: readonly ChartPaintRowView[];
}

/**
 * The writes the chart owner accepts, keyed by the chart's own id.
 *
 * Keyed rather than bound: a control's draft can outlive the selection it was
 * rendered for, and the owner resolves the chart by id at call time — so a
 * commit for a chart that is gone writes nothing rather than landing on whatever
 * is selected now.
 */
export interface ChartEdits {
  readonly onSettings: (
    chartId: string,
    settings: ChartContent["settings"],
  ) => void;
  readonly onBinding: (chartId: string, binding: Binding) => void;
  readonly onAspect: (chartId: string, ratio: number) => void;
  readonly onAddBinding: (chartId: string, semanticKey: string) => void;
  readonly onRemoveBinding: (chartId: string, bindingId: string) => void;
}

/**
 * One committed setting, at the path its descriptor declares.
 *
 * `undefined` is the absent state, not a value: the field is one the settings
 * interface declares optional, so the key goes and the renderer decides again.
 */
function commitSetting(
  settings: ChartContent["settings"],
  path: readonly string[],
  value: unknown,
): ChartContent["settings"] {
  return value === undefined
    ? removeSetting(settings, path)
    : writeSetting(settings, path, value);
}

/** A binding with one field written, or the key removed when there is no value. */
function bindingWith<K extends keyof Binding>(
  binding: Binding,
  key: K,
  value: Binding[K] | undefined,
): Binding {
  if (value === undefined) {
    const { [key]: _removed, ...rest } = binding;
    return rest as Binding;
  }
  return { ...binding, [key]: value } as Binding;
}

/** The settings a paint row writes: one reference, or one slot of the array. */
function paintSettings(
  settings: ChartContent["settings"],
  row: ChartPaintRowView,
  ref: string,
): ChartContent["settings"] {
  const record = settings as unknown as Record<string, unknown>;
  if (row.index === undefined) {
    return {
      ...record,
      [row.property]: { ref },
    } as unknown as ChartContent["settings"];
  }
  const current = record[row.property];
  const list = Array.isArray(current) ? current : [];
  return {
    ...record,
    [row.property]: list.map((entry, index) =>
      index === row.index ? { ref } : entry,
    ),
  } as unknown as ChartContent["settings"];
}

/** One series: its reading, and the optional ways that reading is shown. */
function ChartSeriesRow(props: {
  readonly chartId: string;
  readonly row: ChartSeriesRowView;
  readonly series: ChartSeriesFieldsView;
  readonly edits: ChartEdits;
}): React.JSX.Element {
  const { chartId, row, series, edits } = props;
  const binding = row.binding;
  const set = <K extends keyof Binding>(
    key: K,
    value: Binding[K] | undefined,
  ): void => edits.onBinding(chartId, bindingWith(binding, key, value));
  const field = (property: string): string => `${binding.id}.${property}`;

  return (
    <div
      data-yunari-chart-series={binding.id}
      className="flex flex-col gap-[var(--space-6)]"
    >
      <ControlSelect
        label={`Binding: ${binding.id}`}
        id={`yunari-chart-binding-${binding.id}`}
        data={{ "data-yunari-binding": binding.id }}
        value={binding.semanticKey}
        options={row.keyOptions}
        onChange={(key) => set("semanticKey", key)}
      />

      {row.removable ? (
        <button
          type="button"
          data-yunari-chart-binding-remove={binding.id}
          className="self-start text-xs text-muted"
          onClick={() => edits.onRemoveBinding(chartId, binding.id)}
        >
          {uiCopy.inspectorFields.removeSeries(binding.semanticKey)}
        </button>
      ) : null}

      {/* The pair, like every other bounded number in this manager: the range is
          the document format's own — `schema/theme-document.schema.json` and
          `fabric-envelope-validate.ts` both state 0–6 for a binding's precision
          — and seven whole steps is a range an author drags, which is what
          separates it from the artboard's 16384 validity ceiling (`vg-493`). */}
      <ControlSlider
        label="Precision"
        id={`yunari-chart-binding-${binding.id}-precision`}
        data={{ "data-yunari-binding-field": field("precision") }}
        value={binding.precision ?? PRECISION_FLOOR}
        unauthored={binding.precision === undefined}
        min={MIN_PRECISION}
        max={MAX_PRECISION}
        integer
        onCommit={(value) => set("precision", value)}
        onClear={() => set("precision", undefined)}
      />
      <ControlSelect
        label={uiCopy.panels.unitDisplay}
        id={`yunari-chart-binding-${binding.id}-unit-display`}
        data={{ "data-yunari-binding-field": field("unitDisplay") }}
        value={binding.unitDisplay ?? ""}
        options={series.unitOptions}
        onChange={(value) =>
          set(
            "unitDisplay",
            value === "" ? undefined : (value as Binding["unitDisplay"]),
          )
        }
      />
      <ControlNumber
        label="Scale"
        id={`yunari-chart-binding-${binding.id}-scale`}
        data={{ "data-yunari-binding-field": field("scale") }}
        value={binding.scale}
        onCommit={(value) => set("scale", value)}
        onClear={() => set("scale", undefined)}
      />
      <ControlNumber
        label="Offset"
        id={`yunari-chart-binding-${binding.id}-offset`}
        data={{ "data-yunari-binding-field": field("offset") }}
        value={binding.offset}
        onCommit={(value) => set("offset", value)}
        onClear={() => set("offset", undefined)}
      />
    </div>
  );
}

/** The chart's own settings, and the series it reads. */
export function ChartContentFields(props: {
  readonly view: ChartContentFieldsView;
  readonly edits: ChartEdits;
}): React.JSX.Element {
  const { view, edits } = props;
  const settings = view.content.settings;
  const write = (path: readonly string[], value: unknown): void =>
    edits.onSettings(view.chartId, commitSetting(settings, path, value));

  return (
    <div
      data-yunari-chart-fields="content"
      className="flex flex-col gap-[var(--space-6)]"
    >
      {view.aspect === undefined ? null : (
        <ControlSegmented
          label={view.aspect.label}
          id={view.aspect.id}
          data={{ "data-yunari-chart-aspect": "" }}
          value={view.aspect.value}
          options={view.aspect.options}
          onChange={(option) => {
            const ratio = Number(option);
            if (Number.isFinite(ratio)) edits.onAspect(view.chartId, ratio);
          }}
        />
      )}

      <ControlSelect
        label={view.series.label}
        id={view.series.id}
        data={{ "data-yunari-chart-binding-add": "" }}
        // A constant value, so the chooser is consumed by the click that makes
        // it: a control that held its choice would declare the same series again
        // on the next render.
        value=""
        options={view.series.options}
        disabled={view.series.refused}
        onChange={(key) => {
          if (key !== "") edits.onAddBinding(view.chartId, key);
        }}
      />

      {view.series.full === undefined ? null : (
        <p className="yunari-run-note" data-yunari-chart-binding-full="">
          {view.series.full}
        </p>
      )}

      {view.series.rows.map((row) => (
        <ChartSeriesRow
          key={row.binding.id}
          chartId={view.chartId}
          row={row}
          series={view.series}
          edits={edits}
        />
      ))}

      {view.rows.map((row) => (
        <SettingField
          key={row.id}
          descriptor={row.descriptor}
          id={row.id}
          value={row.value}
          {...(row.control === "slider"
            ? {
                bounds: {
                  min: row.min,
                  max: row.max,
                  ...(row.values === undefined ? {} : { values: row.values }),
                  ...(row.decimals === undefined
                    ? {}
                    : { decimals: row.decimals }),
                  ...(row.integer === undefined
                    ? {}
                    : { integer: row.integer }),
                  ...(row.suffix === undefined ? {} : { suffix: row.suffix }),
                },
              }
            : {})}
          onChange={(next) => write(row.path, next)}
        />
      ))}
    </div>
  );
}

/** What ink: one picker per paint reference the family declares. */
export function ChartPaintFields(props: {
  readonly view: ChartPaintFieldsView;
  readonly edits: ChartEdits;
}): React.JSX.Element {
  const { view, edits } = props;
  const settings = view.content.settings;

  return (
    <div
      data-yunari-chart-fields="paint"
      className="flex flex-col gap-[var(--space-6)]"
    >
      {view.rows.map((row) => (
        <ControlSelect
          key={row.key}
          label={row.label}
          id={row.id}
          data={{ "data-yunari-chart-paint": row.key }}
          value={row.ref}
          options={row.options}
          disabled={row.refused}
          onChange={(ref) =>
            edits.onSettings(view.chartId, paintSettings(settings, row, ref))
          }
        />
      ))}
    </div>
  );
}
