import { type BarInput, buildBarOption } from "../charts/bar.js";
import { resolveChartPaint } from "../charts/chart-paint.js";
import type { ChartOptionByFamily } from "../charts/engine-option.js";
import { buildGaugeOption } from "../charts/gauge.js";
import {
  buildLineOption,
  type LineSettings,
  type SeriesInput,
} from "../charts/line.js";
import { buildPieOption, type PieSliceInput } from "../charts/pie.js";
import { buildPolarBarOption } from "../charts/polar-bar.js";
import { buildRadarOption, type RadarInput } from "../charts/radar.js";
import { chartPaintFieldsFor } from "../charts/settings-fields.js";
import {
  describeSemanticKey,
  type SemanticKeyDescriptor,
} from "../data/semantic-keys.js";
import type { SampleSource } from "../data/source.js";
import type {
  Artboard,
  AssetKind,
  Background,
  Binding,
  ChartContent,
  ChartFamily,
  Globals,
  StyleMap,
  StyleValue,
  TextContent,
  TextRun,
  TypeToken,
} from "../theme/document.js";
import { defaultTypeSize } from "../theme/type-size.js";
import type { Sample, SensorStatus } from "../types.js";
import { formatInstant } from "./datetime/format.js";
import {
  convertForDisplay,
  type MeasurementSystem,
  type UnitOverrides,
  type UnitPreferences,
} from "./measurement.js";

/**
 * Pure authored state + telemetry → render plan. All renderer-independent
 * decisions live here; DOM/Fabric layers only apply the result. Non-ok data
 * becomes gaps, never fabricated zeroes (§83).
 */

export const MISSING_VALUE_TEXT = "—";

export type ResolvedStyle = Readonly<Record<string, unknown>>;

/** Parent-local geometry in artboard units (§57). */
export interface PlanBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

export interface PlanTextSegment {
  readonly text: string;
  readonly style: ResolvedStyle;
  /** Present only for a non-ok value segment. */
  readonly status?: SensorStatus;
  /** Pre-redacted diagnostic (§101). */
  readonly message?: string;
}

export interface PlanTextLayout {
  /**
   * Derived from the element's Fabric class (`instanceof Textbox`) where the
   * class is known; never read from authored content. `renderer-core` stays
   * Fabric-free, so the scene builder owns the conversion.
   */
  readonly wrap: boolean;
  readonly overflow: "clip" | "ellipsis" | "visible";
  readonly align: "left" | "center" | "right";
  readonly verticalAlign: "top" | "middle" | "bottom";
  /** Computed wrapped-line capacity when font metrics are knowable. */
  readonly maxLines?: number;
}

/** Authored chart state paired with this frame's derived engine option. */
export type PlanChart = {
  [F in ChartFamily]: Extract<ChartContent, { readonly family: F }> & {
    readonly kind: "chart";
    readonly option: ChartOptionByFamily[F];
  };
}[ChartFamily];

export type PlanContent =
  | { readonly kind: "group" }
  | {
      readonly kind: "shape";
      readonly shape: "rectangle" | "ellipse" | "line";
      readonly cornerRadius: number;
    }
  | {
      readonly kind: "text";
      /** Authored runs survive Fabric serialization for v2 live text updates. */
      readonly authored: TextContent;
      readonly segments: readonly PlanTextSegment[];
      readonly layout: PlanTextLayout;
    }
  | PlanChart
  | {
      readonly kind: "image";
      readonly src: string | undefined;
      /** Asset declaration, needed where vector/raster handling differs. */
      readonly assetKind: AssetKind | undefined;
      readonly fit: "contain" | "cover" | "stretch";
      readonly monochrome?: string;
    }
  | {
      readonly kind: "video";
      readonly src: string | undefined;
      readonly loop: boolean;
      readonly muted: boolean;
    };

export interface PlanNode {
  readonly id: string;
  readonly box: PlanBox;
  readonly visible: boolean;
  readonly style: ResolvedStyle;
  readonly content: PlanContent;
  readonly children: readonly PlanNode[];
}

/** Runtime frame diagnostics, not document-validation errors. */
export interface PlanIssue {
  readonly code: "unmapped-key" | "unresolved-global" | "unsupported-unit";
  readonly nodeId: string;
  readonly detail: string;
}

export interface ScenePlan {
  readonly artboard: {
    readonly width: number;
    readonly height: number;
    readonly contentFit: "contain" | "cover";
    readonly background: unknown;
  };
  readonly nodes: readonly PlanNode[];
  readonly issues: readonly PlanIssue[];
}

/** The runtime inputs a plan is derived from. A document is never one of them. */
export interface PlanInputs {
  readonly source: SampleSource;
  /** Epoch milliseconds supplied by the caller; this module never reads the clock. */
  readonly nowMs: number;
  readonly animate?: boolean;
  /** Long unit names keyed by short symbol; absent entries fall back to short. */
  readonly longUnits?: Readonly<Record<string, string>>;
  /** The consumer's measurement preference; metric shows what was measured. */
  readonly measurement?: MeasurementSystem;
  /** The consumer's full display choices; `measurement` above still wins. */
  readonly units?: UnitPreferences;
  /**
   * The descriptors that supplied the bound keys, when the caller has them.
   * A custom source's `unitKind` lives only on its provider's descriptor, so
   * conversion reads it here rather than from the generic `custom.*` shape.
   */
  readonly descriptors?: readonly SemanticKeyDescriptor[];
  /**
   * The artboard height, when the caller knows it. A run that authors no
   * `fontSize` takes the role default it implies; absent means the caller has
   * not measured it, and no default is invented.
   */
  readonly artboardHeight?: number;
  /**
   * The language the theme's text is written in. A runtime input like
   * `longUnits`, never persisted scene state: the theme's own `metadata` owns it.
   */
  readonly themeLanguage?: string;
}

/** Runtime inputs required to derive one authored chart's display option. */
export type ChartPlanContext = Pick<
  PlanInputs,
  "source" | "nowMs" | "animate"
> & {
  /**
   * The smaller edge of the canvas ECharts draws into, in backing pixels, when
   * the caller knows it.
   *
   * A gap measured in pixels — the clearance a round cap needs — cannot become
   * an angle without the radius, and the adapters draw at `radius: "100%"` of
   * the backing canvas, which is the scene box times the chart's render scale.
   * The option's thickness is in those same backing pixels, so the scale cannot
   * be dropped here. Absent means the caller has not measured it, and an adapter
   * skips the term rather than guessing a size.
   */
  readonly drawnEdgePx?: number;
};

/**
 * The artboard's geometry with the background layer's colour resolved through
 * `globals`, the way a node's style is.
 *
 * **The one owner of artboard paint resolution.** The player's
 * `hosted-plan.ts` is the other builder of a `ScenePlan`, from a hosted
 * envelope whose scene Fabric revives, and the block written twice is how one
 * builder came to pass a palette reference through unresolved, which paints
 * nothing at all. Keep both on this.
 *
 * The background is its own envelope section, so its colour arrives beside the
 * artboard rather than inside it. `scene-fabric` accepts the resolved forms
 * only: a CSS string or a `{ kind: "solid" | "gradient" }` object, never a
 * reference.
 */
export function planArtboard(
  artboard: Artboard,
  background: Background | undefined,
  globals: Globals,
  issues: PlanIssue[],
): ScenePlan["artboard"] {
  return {
    width: artboard.width,
    height: artboard.height,
    contentFit: artboard.contentFit ?? "contain",
    background: resolveStyleValue(
      background?.color,
      globals,
      "background",
      issues,
    ),
  };
}

export function resolveTextSegments(
  nodeId: string,
  runs: readonly TextRun[],
  bindings: readonly Binding[],
  context: Pick<
    PlanInputs,
    | "source"
    | "longUnits"
    | "measurement"
    | "units"
    | "artboardHeight"
    | "themeLanguage"
    | "descriptors"
  >,
  globals: Globals,
  issues: PlanIssue[],
): PlanTextSegment[] {
  return runs.map((run) => {
    const authored = resolveStyleMap(run.style, globals, nodeId, issues);
    const style = {
      ...defaultRunTypeSize(run, context.artboardHeight, authored),
      ...resolveTypeToken(run.typeToken, globals, nodeId, issues),
      ...authored,
    };

    if (run.kind === "literal") {
      return { text: run.text, style };
    }

    const binding = bindings.find(
      (candidate) => candidate.id === run.bindingId,
    );

    if (binding === undefined) {
      issues.push({
        code: "unmapped-key",
        nodeId,
        detail: `Text run references binding "${run.bindingId}", which this node does not declare.`,
      });
      return { text: MISSING_VALUE_TEXT, style };
    }

    const sample = context.source.latest(binding.semanticKey);

    if (sample === undefined) {
      issues.push({
        code: "unmapped-key",
        nodeId,
        detail: `No sensor is mapped to "${binding.semanticKey}".`,
      });
      return { text: MISSING_VALUE_TEXT, style };
    }

    return formatValueSegment(
      sample,
      binding,
      run,
      style,
      nodeId,
      context,
      issues,
    );
  });
}

function formatValueSegment(
  sample: Sample,
  binding: Binding,
  run: Extract<TextRun, { kind: "value" }>,
  style: ResolvedStyle,
  nodeId: string,
  context: Pick<
    PlanInputs,
    "longUnits" | "measurement" | "units" | "themeLanguage" | "descriptors"
  >,
  issues: PlanIssue[],
): PlanTextSegment {
  if (sample.status !== "ok") {
    return {
      text: MISSING_VALUE_TEXT,
      style,
      status: sample.status,
      ...(sample.message === undefined ? {} : { message: sample.message }),
    };
  }

  const authoredPrecision = run.precision ?? binding.precision;
  const unitDisplay = run.unitDisplay ?? binding.unitDisplay ?? "short";

  let text: string;
  let shown = sample.unit;

  if (typeof sample.value === "number" && Number.isFinite(sample.value)) {
    const scaled = sample.value * (binding.scale ?? 1) + (binding.offset ?? 0);
    // The consumer's unit preferences convert what is displayed, after the
    // binding's own scale and offset and before formatting, so a converted
    // value is never fed back through a scale.
    const overrides = bindingUnitOverrides(binding);
    const converted = convertForDisplay(
      binding.semanticKey,
      scaled,
      sample.unit,
      unitPreferencesFor(context),
      overrides,
      descriptorFor(context, binding.semanticKey),
    );
    if (converted.unsupportedUnit === true && overrides?.unit !== undefined) {
      issues.push({
        code: "unsupported-unit",
        nodeId,
        detail: `Unit "${overrides.unit}" is not displayable for "${binding.semanticKey}".`,
      });
    }
    // An authored precision wins; otherwise the chosen unit supplies its own.
    const precision = authoredPrecision ?? converted.precision;
    text = formatNumber(converted.value, precision, context.themeLanguage);
    shown = converted.unit;
  } else if (sample.textValue !== undefined) {
    text = formatTextReading(binding, sample.textValue, context.themeLanguage);
  } else if (sample.booleanValue !== undefined) {
    text = sample.booleanValue ? "on" : "off";
  } else {
    return { text: MISSING_VALUE_TEXT, style, status: "error" };
  }

  const unit = formatUnit(shown, unitDisplay, context.longUnits);

  return { text: unit === "" ? text : `${text}${unit}`, style };
}

/**
 * `units` carries the whole preference set; the older `measurement` field, kept
 * for callers that only choose temperature, wins when both are present.
 */
function unitPreferencesFor(
  context: Pick<PlanInputs, "measurement" | "units">,
): UnitPreferences {
  return context.measurement === undefined
    ? (context.units ?? {})
    : { ...context.units, measurement: context.measurement };
}

/**
 * The descriptor that owns a key: the one the caller supplied, else the
 * vocabulary's. A supplied list carries built-ins too, and the catalogue
 * merges built-ins first, so an exact match is the canonical descriptor.
 */
function descriptorFor(
  context: Pick<PlanInputs, "descriptors">,
  key: string,
): SemanticKeyDescriptor | undefined {
  return (
    context.descriptors?.find((descriptor) => descriptor.key === key) ??
    describeSemanticKey(key)
  );
}

/** The author's per-binding unit request, or `undefined` when none was made. */
function bindingUnitOverrides(binding: Binding): UnitOverrides | undefined {
  if (binding.unit === undefined && binding.autoScale === undefined) {
    return undefined;
  }

  return {
    ...(binding.unit === undefined ? {} : { unit: binding.unit }),
    ...(binding.autoScale === undefined
      ? {}
      : { autoScale: binding.autoScale }),
  };
}

/**
 * A time/date reading arrives as an instant, so the author's format and zone
 * decide how it reads; any other text is shown exactly as the provider sent it.
 * A value no formatter can read is shown raw rather than blanked.
 */
function formatTextReading(
  binding: Binding,
  value: string,
  themeLanguage: string | undefined,
): string {
  const instant = describeSemanticKey(binding.semanticKey)?.instant;

  if (instant === undefined) {
    return value;
  }

  return (
    formatInstant(
      value,
      binding.format ?? instant.defaultFormat,
      binding.timeZone,
      themeLanguage,
    ) ?? value
  );
}

/** Explicit precision preserves trailing zeroes; default uses at most one decimal. */
export function formatNumber(
  value: number,
  precision: number | undefined,
  themeLanguage?: string,
): string {
  // `Intl` distinguishes negative zero and prints it; `toFixed`, which this
  // used, did not. A reading of `-0` on a dashboard is a rounding artefact
  // dressed as a measurement, and it is exactly the case a sensor hits.
  const measured = value === 0 ? 0 : value;

  if (precision !== undefined) {
    const digits = Math.min(Math.max(Math.trunc(precision), 0), 6);
    return numberFormat(themeLanguage, digits, digits).format(measured);
  }

  // At most one decimal, and none where the value has none: `toFixed(1)` used
  // to decide that itself, and a reading ending `.0` is a place of width an
  // authored text box then has to be laid out around.
  const rounded = Math.round(measured * 10) / 10;
  return numberFormat(
    themeLanguage,
    0,
    Number.isInteger(rounded) ? 0 : 1,
  ).format(rounded === 0 ? 0 : rounded);
}

// Built once per language per digit pair: this runs per text run per refresh,
// and constructing a formatter is expensive.
const numberFormatters = new Map<string, Intl.NumberFormat>();

/**
 * The reading in the theme's own number format.
 *
 * Grouping is off on purpose. The separator is what a reader recognises — a
 * German reads `17,6` where the default wrote `17.6` — while grouping changes
 * how wide every four-digit reading is, and a dashboard lays its text out in
 * boxes an author sized by hand. A locale's number format is not ours to
 * second-guess in the one respect that moves the layout.
 */
function numberFormat(
  themeLanguage: string | undefined,
  minimumFractionDigits: number,
  maximumFractionDigits: number,
): Intl.NumberFormat {
  if (themeLanguage === undefined) {
    return new Intl.NumberFormat(undefined, {
      useGrouping: false,
      minimumFractionDigits,
      maximumFractionDigits,
    });
  }
  const key = `${themeLanguage}\u0000${minimumFractionDigits}\u0000${maximumFractionDigits}`;
  const cached = numberFormatters.get(key);
  if (cached !== undefined) return cached;

  let created: Intl.NumberFormat;
  try {
    created = new Intl.NumberFormat(themeLanguage, {
      useGrouping: false,
      minimumFractionDigits,
      maximumFractionDigits,
    });
  } catch {
    // A tag the runtime dropped since validation reads as the runtime's own
    // rather than failing a paint. Validation is what refuses an unusable tag.
    created = new Intl.NumberFormat(undefined, {
      useGrouping: false,
      minimumFractionDigits,
      maximumFractionDigits,
    });
  }
  numberFormatters.set(key, created);
  return created;
}

export function formatUnit(
  unit: string | undefined,
  display: "none" | "short" | "long",
  longUnits: Readonly<Record<string, string>> | undefined,
): string {
  if (display === "none" || unit === undefined || unit === "") {
    return "";
  }

  if (display === "long") {
    const long = longUnits?.[unit];
    return long === undefined ? spaced(unit) : ` ${long}`;
  }

  return spaced(unit);
}

/** Percent/degree attach directly; word-like units get a leading space. */
function spaced(unit: string): string {
  return /^[%°]/.test(unit) ? unit : ` ${unit}`;
}

/**
 * The diagnostics a chart's authored content earns, whatever its family: a
 * binding no sensor answers, and a paint naming a global the document lacks.
 *
 * Separate from the family switch so a caller that draws a line itself — the
 * player does, from cached points — still asks for them; skipping the switch
 * must not skip the report.
 */
export function collectChartIssues(
  nodeId: string,
  content: ChartContent,
  bindings: readonly Binding[],
  source: SampleSource,
  issues: PlanIssue[],
  palette?: import("../theme/fabric-envelope.js").FabricPalette,
): void {
  // Adapters handle absent samples; report unmapped semantic keys separately.
  for (const binding of bindings) {
    if (source.latest(binding.semanticKey) === undefined) {
      issues.push({
        code: "unmapped-key",
        nodeId,
        detail: `No sensor is mapped to "${binding.semanticKey}".`,
      });
    }
  }
  reportUnresolvedChartPaint(nodeId, content, palette, issues);
}

export function buildChartPlan(
  nodeId: string,
  content: ChartContent,
  bindings: readonly Binding[],
  context: ChartPlanContext,
  issues: PlanIssue[],
  palette?: import("../theme/fabric-envelope.js").FabricPalette,
): PlanChart {
  const animate = context.animate ?? true;

  collectChartIssues(
    nodeId,
    content,
    bindings,
    context.source,
    issues,
    palette,
  );

  switch (content.family) {
    case "gauge": {
      const binding = bindings[0];
      const sample =
        binding === undefined
          ? undefined
          : context.source.latest(binding.semanticKey);

      return {
        kind: "chart",
        family: "gauge",
        settings: content.settings,
        option: buildGaugeOption(
          content.settings,
          applyTransform(sample, binding),
          animate,
          palette,
          context.drawnEdgePx,
        ),
      };
    }

    case "line": {
      const series = buildLinePoints(
        bindings,
        content.settings,
        context.source,
      );

      return {
        kind: "chart",
        family: "line",
        settings: content.settings,
        option: buildLineOption(
          content.settings,
          series,
          context.nowMs,
          animate,
          palette,
        ),
      };
    }

    case "bar": {
      const inputs: BarInput[] = bindings.map((binding) => ({
        sensorId: binding.semanticKey,
        sample: applyTransform(
          context.source.latest(binding.semanticKey),
          binding,
        ),
      }));

      return {
        kind: "chart",
        family: "bar",
        settings: content.settings,
        option: buildBarOption(content.settings, inputs, animate, palette),
      };
    }

    case "pie": {
      const slices: PieSliceInput[] = bindings.map((binding) => ({
        sensorId: binding.semanticKey,
        sample: applyTransform(
          context.source.latest(binding.semanticKey),
          binding,
        ),
      }));

      return {
        kind: "chart",
        family: "pie",
        settings: content.settings,
        option: buildPieOption(content.settings, slices, animate, palette),
      };
    }

    case "radar": {
      const spokes: RadarInput[] = bindings.map((binding) => ({
        sensorId: binding.semanticKey,
        sample: applyTransform(
          context.source.latest(binding.semanticKey),
          binding,
        ),
      }));

      return {
        kind: "chart",
        family: "radar",
        settings: content.settings,
        option: buildRadarOption(content.settings, spokes, animate, palette),
      };
    }

    case "polarBar": {
      const bars: BarInput[] = bindings.map((binding) => ({
        sensorId: binding.semanticKey,
        sample: applyTransform(
          context.source.latest(binding.semanticKey),
          binding,
        ),
      }));

      return {
        kind: "chart",
        family: "polarBar",
        settings: content.settings,
        option: buildPolarBarOption(content.settings, bars, animate, palette),
      };
    }
  }
}

/**
 * A paint reference the document does not define draws no ink, which on the
 * display is indistinguishable from no reading. Reported under the code
 * `resolveStyleValue` already uses, so the two absences stay two facts.
 */
function reportUnresolvedChartPaint(
  nodeId: string,
  content: ChartContent,
  palette: import("../theme/fabric-envelope.js").FabricPalette | undefined,
  issues: PlanIssue[],
): void {
  const settings = content.settings as unknown as Record<string, unknown>;
  for (const field of chartPaintFieldsFor(content.family)) {
    const declared = settings[field.property];
    const paints =
      field.multiple === true && Array.isArray(declared)
        ? declared
        : declared === undefined
          ? []
          : [declared];
    for (const paint of paints) {
      if (paint === undefined || resolveChartPaint(paint as never, palette))
        continue;
      const ref = (paint as { readonly ref?: string }).ref;
      issues.push({
        code: "unresolved-global",
        nodeId,
        detail: `Chart paint "${ref ?? field.property}" is not defined in this document.`,
      });
    }
  }
}

/**
 * The line branch's history read, transformed per binding.
 *
 * The axis is placed by the newest reading, so the source is asked for
 * the chart's own window; it returns the sample before that window as well, so
 * the line still reaches its left edge (`vg-571`).
 */
export function buildLinePoints(
  bindings: readonly Binding[],
  settings: LineSettings,
  source: SampleSource,
): readonly SeriesInput[] {
  return bindings.map((binding) => ({
    sensorId: binding.semanticKey,
    samples: source
      .history(binding.semanticKey, settings.windowSeconds)
      .map((sample) => transformSample(sample, binding)),
  }));
}

/** Apply authored scale/offset only to ok numeric samples. */
function applyTransform(
  sample: Sample | undefined,
  binding: Binding | undefined,
): Sample | undefined {
  if (sample === undefined || binding === undefined) {
    return sample;
  }

  return transformSample(sample, binding);
}

function transformSample(sample: Sample, binding: Binding): Sample {
  const scale = binding.scale ?? 1;
  const offset = binding.offset ?? 0;

  if (scale === 1 && offset === 0) {
    return sample;
  }

  if (sample.status !== "ok" || typeof sample.value !== "number") {
    return sample;
  }

  return { ...sample, value: sample.value * scale + offset };
}

function resolveStyleMap(
  style: StyleMap | undefined,
  globals: Globals,
  nodeId: string,
  issues: PlanIssue[],
): ResolvedStyle {
  if (style === undefined) {
    return {};
  }

  const resolved: Record<string, unknown> = {};

  for (const [property, value] of Object.entries(style)) {
    const literal = resolveStyleValue(value, globals, nodeId, issues);
    if (literal !== undefined) {
      resolved[property] = literal;
    }
  }

  return resolved;
}

/** Missing references report an issue and resolve to undefined; never substitute. */
export function resolveStyleValue(
  value: StyleValue | undefined,
  globals: Globals,
  nodeId: string,
  issues: PlanIssue[],
): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (!("ref" in value) || value.ref === undefined) {
    return value.value;
  }

  const [group, ...rest] = value.ref.split(".");
  const entryId = rest.join(".");
  const entry =
    group === undefined
      ? undefined
      : globals[group as keyof Globals]?.[entryId];

  if (entry === undefined) {
    issues.push({
      code: "unresolved-global",
      nodeId,
      detail: `Global "${value.ref}" is not defined in this document.`,
    });
    return undefined;
  }

  const palette = "value" in entry ? entry.value : undefined;
  return isSolidPalettePaint(palette) ? palette.color : palette;
}

/**
 * The role default for a run that authored no size, so the editor and the
 * player derive the same number from the artboard.
 *
 * The role comes from the token's id, not its contents: an unroled id — or no
 * token at all — takes the body ratio. An authored size is left alone, and a
 * caller that has not measured the artboard gets no default rather than a
 * guessed one.
 */
function defaultRunTypeSize(
  run: TextRun,
  artboardHeight: number | undefined,
  authored: ResolvedStyle,
): ResolvedStyle {
  if (artboardHeight === undefined || authored["fontSize"] !== undefined) {
    return {};
  }
  const id = run.typeToken?.slice("typeTokens.".length) ?? "body";
  return { fontSize: defaultTypeSize(id, artboardHeight) };
}

/** Tokens are resolved per run so label, value and unit never inherit one text-object token. */
function resolveTypeToken(
  ref: TextRun["typeToken"],
  globals: Globals,
  nodeId: string,
  issues: PlanIssue[],
): ResolvedStyle {
  if (ref === undefined) return {};
  const id = ref.slice("typeTokens.".length);
  const value = globals.typeTokens?.[id];
  if (!isTypeToken(value)) {
    issues.push({
      code: "unresolved-global",
      nodeId,
      detail: `Type token "${ref}" is not defined or invalid.`,
    });
    return {};
  }
  return {
    fontFamily: value.family,
    ...(value.weight === undefined ? {} : { fontWeight: value.weight }),
  };
}

function isTypeToken(value: unknown): value is TypeToken {
  if (typeof value !== "object" || value === null) return false;
  const token = value as Record<string, unknown>;
  return (
    typeof token["family"] === "string" &&
    token["family"].length > 0 &&
    (token["weight"] === undefined ||
      typeof token["weight"] === "string" ||
      typeof token["weight"] === "number")
  );
}

function isSolidPalettePaint(
  value: unknown,
): value is { readonly kind: "solid"; readonly color: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)["kind"] === "solid" &&
    typeof (value as Record<string, unknown>)["color"] === "string"
  );
}
