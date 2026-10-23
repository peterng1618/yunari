import type * as React from "react";
import { Fragment, useId } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { ChartEdits } from "../chart-manager/chart-fields.js";
import {
  ChartContentFields,
  ChartPaintFields,
} from "../chart-manager/chart-fields.js";
import { ControlNumber } from "../components/ui/control-number.js";
import { ControlPair } from "../components/ui/control-pair.js";
import { ControlSegmented } from "../components/ui/control-segmented.js";
import { ControlSelect } from "../components/ui/control-select.js";
import { ControlSlider } from "../components/ui/control-slider.js";
import { ControlSwatch } from "../components/ui/control-swatch.js";
import { ControlText } from "../components/ui/control-text.js";
import { ControlToggle } from "../components/ui/control-toggle.js";
import { InspectorSection } from "../components/ui/inspector-section.js";
import { uiCopy } from "../ui-copy.js";
import { CROP_ASPECTS } from "./crop.js";
import { FontFaceField } from "./font-face-field.js";
import { rendersExtra } from "./per-kind-column.js";
import { RunEditor } from "./runs.js";
import type {
  ColumnSectionView,
  CropEdits,
  FieldView,
  FontFaceEdits,
  RunEdits,
  SelectionEdits,
  SelectionView,
} from "./view.js";

/**
 * The column's sections, as React.
 *
 * The sections come from the view and are rendered in the order it carries them:
 * this component sorts nothing, groups nothing and decides nothing about
 * emptiness. `perKindColumn` owns which questions a selection is asked and
 * `SETTINGS_SECTIONS` decides their order, so a column that re-ordered here
 * would be a second owner of Review Focus 2's rule.
 *
 * A section renders the whole of what it holds: its `fields`, its `extras` and
 * its reveal, if the view gives it one. There is nothing imperative left to
 * mount into it, so the column is the only writer of the section's panel.
 *
 * Every row is a plan-1 control carrying the field's own `data-*` hooks on its
 * focus target, so the locator a suite reads and the control a person operates
 * are the same element. Each edit goes through `SelectionEdits` with the
 * revision the view was projected from, so a control whose draft outlived its
 * selection is refused rather than writing an old value into a new object.
 *
 * The revision is also part of every row's key, and that is what discards a
 * draft when the selection moves: a row keyed by field id alone would be
 * reconciled onto the *next* object with the previous object's draft still in
 * its state, and the blur that followed a selection change would write it
 * there. The revision only moves when the described object changes, so a
 * re-publish of the same object keeps the row — and the caret — in place.
 */

/** A stored fraction, shown as a percentage. The multiply can land a hair off
 *  (`1.4 × 100` is not exactly 140), so the display is rounded rather than
 *  printing the noise; the commit divides back, so the boundary gets the
 *  fraction the model stores. */
function shownNumber(percent: boolean | undefined, value: number): number {
  return percent === true ? Math.round(value * 100 * 1e6) / 1e6 : value;
}

function committedNumber(percent: boolean | undefined, value: number): number {
  return percent === true ? value / 100 : value;
}

/** The revision guard makes every write carry the view it was projected from. */
function fieldControl(
  field: FieldView,
  edits: SelectionEdits,
  revision: number,
): React.JSX.Element {
  const commit = (value: string | number | boolean): void => {
    edits.commit(revision, field.id, value);
  };
  // A refusal rides with every control that can carry one; a kind that cannot
  // is guarded rather than cast, so the union stays honest as arms are added.
  const refused = field.refused !== undefined ? { refused: field.refused } : {};

  switch (field.control) {
    case "text":
      return (
        <ControlText
          label={field.label}
          data={field.data}
          value={field.value}
          onCommit={(value) => commit(value)}
          {...(field.multiline === undefined
            ? {}
            : { multiline: field.multiline })}
          {...(field.rows === undefined ? {} : { rows: field.rows })}
          {...refused}
        />
      );
    case "pair":
      return (
        <ControlPair
          label={field.label}
          halves={field.halves.map((half) => ({
            label: half.label,
            value: shownNumber(half.percent, half.value),
            data: half.data,
            // The number is already the percentage; the suffix is what says so.
            ...(half.percent === true ? { unit: "%" } : {}),
            ...(half.integer === undefined ? {} : { integer: half.integer }),
            onCommit: (value: number) =>
              edits.commit(
                revision,
                half.id,
                committedNumber(half.percent, value),
              ),
          }))}
        />
      );
    case "number":
      return (
        <ControlNumber
          label={field.label}
          data={field.data}
          value={shownNumber(field.percent, field.value)}
          onCommit={(value) => commit(committedNumber(field.percent, value))}
          {...(field.min === undefined ? {} : { min: field.min })}
          {...(field.max === undefined ? {} : { max: field.max })}
          {...((field.unit ?? (field.percent === true ? "%" : undefined)) ===
          undefined
            ? {}
            : { unit: field.unit ?? "%" })}
          {...(field.integer === undefined ? {} : { integer: field.integer })}
          {...refused}
        />
      );
    case "toggle":
      return (
        <ControlToggle
          label={field.label}
          data={field.data}
          checked={field.checked}
          onChange={(value) => commit(value)}
          {...refused}
        />
      );
    case "select":
      return (
        <ControlSelect
          label={field.label}
          data={field.data}
          value={field.value}
          options={field.options}
          onChange={(value) => commit(value)}
          {...refused}
        />
      );
    case "segmented":
      return (
        <ControlSegmented
          label={field.label}
          data={field.data}
          value={field.value}
          options={field.options}
          onChange={(value) => commit(value)}
          {...refused}
        />
      );
    case "swatch":
      // The swatch well: the list is the only way to change the value, and the
      // picture is the resolved colour the projection handed over — never a
      // second resolver here.
      return (
        <ControlSwatch
          label={field.label}
          data={field.data}
          value={field.value}
          options={field.options}
          swatch={
            <span
              aria-hidden
              className="block size-[10px] rounded-sm border border-edge"
              style={{ background: field.colour }}
            />
          }
          onChange={(value) => commit(value)}
          {...refused}
        />
      );
    case "slider":
      return (
        <ControlSlider
          label={field.label}
          data={field.data}
          value={field.value}
          min={field.min}
          max={field.max}
          {...(field.integer === undefined ? {} : { integer: field.integer })}
          // The gesture writes the document as it moves, so the canvas shows
          // what the author is choosing and not only the well (§5). The preview
          // records nothing, so the release is the gesture's one undo boundary,
          // and Escape puts the value the press started from back through the
          // same writer. `field.value` is the *start* value here rather than the
          // last previewed one, because a preview does not re-publish the column.
          onPreview={(value) => edits.preview(revision, field.id, value)}
          onCancel={(start) => edits.cancelPreview(revision, field.id, start)}
          onCommit={(value) => commit(value)}
          {...refused}
        />
      );
  }
}

/**
 * The crop row: start a session, or — while one is open — lock a ratio and
 * apply or abandon it. The session is `crop-manager`'s and React holds only its
 * state, so the buttons drive `CropEdits` and the drag stays Fabric's.
 *
 * The buttons carry the same `data-yunari-crop*` hooks the imperative row did,
 * because the suites read them by hook rather than by their visible word.
 */
function CropRow(props: {
  readonly view: { readonly active: boolean; readonly canStart: boolean };
  readonly edits: CropEdits;
}): React.JSX.Element | null {
  const { view, edits } = props;
  if (view.active) {
    return (
      <div className="flex flex-wrap items-center gap-[var(--space-6)]">
        {CROP_ASPECTS.map(([label, ratio]) => (
          <button
            key={label}
            type="button"
            data-yunari-crop-aspect={label}
            className="rounded-md border border-edge bg-panel-2 px-[var(--space-6)] text-xs text-text"
            onClick={() => edits.setAspect(ratio)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          data-yunari-crop-apply=""
          className="rounded-md border border-edge bg-panel-2 px-[var(--space-6)] text-xs text-text"
          onClick={() => edits.apply()}
        >
          {uiCopy.inspectorFields.cropApply}
        </button>
        <button
          type="button"
          data-yunari-crop-cancel=""
          className="rounded-md border border-edge bg-panel-2 px-[var(--space-6)] text-xs text-text"
          onClick={() => edits.cancel()}
        >
          {uiCopy.inspectorFields.cropCancel}
        </button>
      </div>
    );
  }

  if (!view.canStart) return null;
  return (
    <div className="flex items-center gap-[var(--space-6)]">
      <button
        type="button"
        data-yunari-crop=""
        className="rounded-md border border-edge bg-panel-2 px-[var(--space-6)] text-xs text-text"
        onClick={() => edits.begin()}
      >
        {uiCopy.inspectorFields.crop}
      </button>
    </div>
  );
}

function Section(props: {
  readonly section: ColumnSectionView;
  readonly edits: SelectionEdits;
  readonly runs: RunEdits;
  readonly chart: ChartEdits;
  readonly crop: CropEdits;
  readonly font: FontFaceEdits;
  /** Opens the finder on Fonts; absent in a column built without one. */
  readonly onOpenFontPicker?: () => void;
  readonly revision: number;
  readonly idPrefix: string;
  /** The section's place in the column: the first one sits under the subject
      block, whose own hairline is the boundary between them (`vg-466`). */
  readonly index: number;
}): React.JSX.Element {
  const {
    section,
    edits,
    runs,
    chart,
    crop,
    font,
    onOpenFontPicker,
    revision,
    idPrefix,
    index,
  } = props;

  return (
    <InspectorSection
      id={section.id}
      idPrefix={idPrefix}
      title={section.title}
      defaultOpen={section.defaultOpen}
      count={section.count}
      first={index === 0}
    >
      {section.fields.map((field) => (
        <Fragment key={`${revision}:${field.id}`}>
          {fieldControl(field, edits, revision)}
        </Fragment>
      ))}
      {section.extras.filter(rendersExtra).map((extra) => {
        switch (extra.kind) {
          case "runs":
            return (
              <RunEditor
                key={`${revision}:runs`}
                runs={extra.runs}
                edits={runs}
              />
            );
          case "chartContent":
            // A chart's own questions, rendered by the owner that answers
            // them. The writes go through `ChartEdits`, not `SelectionEdits`:
            // a chart's commit rules are the chart's.
            return (
              <ChartContentFields
                key={`${revision}:chartContent`}
                view={extra.content}
                edits={chart}
              />
            );
          case "chartPaint":
            return (
              <ChartPaintFields
                key={`${revision}:chartPaint`}
                view={extra.paint}
                edits={chart}
              />
            );
          case "crop":
            return (
              <CropRow
                key={`${revision}:crop`}
                view={extra.crop}
                edits={crop}
              />
            );
          case "fontFace":
            // The text object's face, browsed through the catalogue control the
            // ruling gave this field (`vg-268`).
            return (
              <FontFaceField
                key={`${revision}:fontFace`}
                view={extra.font}
                edits={font}
                {...(onOpenFontPicker === undefined
                  ? {}
                  : { onOpenFontPicker })}
              />
            );
          default:
            return null;
        }
      })}
    </InspectorSection>
  );
}

export function SelectionColumn(props: {
  readonly view: SelectionView;
  readonly edits: SelectionEdits;
  readonly runs: RunEdits;
  readonly chart: ChartEdits;
  readonly crop: CropEdits;
  readonly font: FontFaceEdits;
  readonly onOpenFontPicker?: () => void;
}): React.JSX.Element {
  const { view, edits, runs, chart, crop, font, onOpenFontPicker } = props;
  // A column is one selection's, and two columns can be mounted at once (the
  // accessibility audit mounts two). `${id}-header` is document-global, so the
  // aria pair is scoped to this instance or the second column's `aria-controls`
  // resolves to the first column's panel.
  const idPrefix = useId();

  return (
    <>
      {view.sections.map((section, index) => (
        <Section
          key={section.id}
          index={index}
          section={section}
          edits={edits}
          runs={runs}
          chart={chart}
          crop={crop}
          font={font}
          {...(onOpenFontPicker === undefined ? {} : { onOpenFontPicker })}
          revision={view.targetRevision}
          idPrefix={idPrefix}
        />
      ))}
    </>
  );
}

/**
 * The column's React root. `index.ts` publishes the projected view here, with the
 * write ports the column's rows reach.
 *
 * A publish is flushed synchronously, the same contract the subject's root keeps:
 * a caller that reads the column straight after a selection change sees it.
 */
export function createSelectionColumnRoot(host: HTMLElement): {
  readonly publish: (
    view: SelectionView,
    edits: SelectionEdits,
    runs: RunEdits,
    chart: ChartEdits,
    crop: CropEdits,
    font: FontFaceEdits,
    onOpenFontPicker?: () => void,
  ) => void;
  readonly destroy: () => void;
} {
  const root: Root = createRoot(host);

  return {
    publish(view, edits, runs, chart, crop, font, onOpenFontPicker) {
      flushSync(() => {
        root.render(
          <SelectionColumn
            view={view}
            edits={edits}
            runs={runs}
            chart={chart}
            crop={crop}
            font={font}
            {...(onOpenFontPicker === undefined ? {} : { onOpenFontPicker })}
          />,
        );
      });
    },
    destroy() {
      root.unmount();
    },
  };
}
