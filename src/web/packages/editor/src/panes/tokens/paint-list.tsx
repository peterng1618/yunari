import type {
  FabricPalette,
  FabricPaletteEntry,
  PalettePaint,
} from "@yunari/renderer-core";
import { Fragment, useState } from "react";
import { ColourPicker } from "../../components/ui/colour-picker.js";
import { ControlNumber } from "../../components/ui/control-number.js";
import { ControlSelect } from "../../components/ui/control-select.js";
import { ControlSlider } from "../../components/ui/control-slider.js";
import { ControlText } from "../../components/ui/control-text.js";
import { plainButtonClasses } from "../../components/ui/control-well.js";
import { gradientCss } from "../../components/ui/gradient-css.js";
import { GradientEditor } from "../../components/ui/gradient-editor.js";
import { newTokenPaint } from "../../new-fabric-theme-globals.js";
import type { PaletteTokenUse } from "../../palette-manager/panel.js";
import { paletteTokenIds } from "../../palette-manager/token-list.js";
import { uiCopy } from "../../ui-copy.js";

/**
 * The Tokens pane's paint library: every token as a swatch well with its name and
 * its usage figure, the chooser that names it, a new-paint row, and the chosen
 * token's own fields.
 *
 * **The membership is not re-derived here.** The list is `paletteTokenIds`,
 * which the pane's title-bar count also reads, so the rows drawn and the number
 * beside the title are one list rather than two that must agree; the figure
 * beside a token is the caller's `usage` walk, read per draw. The count the
 * author reads and the set a deletion moves therefore come from one owner
 * (`paletteTokenUsage`), which is what stops a token being reported unused while
 * an object is painted with it.
 *
 * **`none` is not listed.** It is the reserved transparent token, with a fixed
 * value and no paint kind of its own, so a row for it would be a control that
 * opens a field set refusing every edit. It stays a reassignment target, which
 * is the one thing an author has it for — "stop painting this" is a real answer
 * to the question the delete asks.
 *
 * **Two routes to one selection, not two selections.** The well rows and the
 * chooser both move the same `selected`, so the list can be browsed by pointer
 * while the chooser keeps the control set's keyboard model.
 */
export interface PaintListProps {
  readonly palette: FabricPalette;
  /** The objects each token is linked to, or `undefined` when the pane has no
   *  scene to read. A function, not a record: the scene changes under the pane,
   *  so the figure is re-read on every draw rather than frozen at construction. */
  readonly usage:
    | (() => Readonly<Record<string, readonly PaletteTokenUse[]>>)
    | undefined;
  readonly onChange: (palette: FabricPalette) => void;
  /** The settled boundary of one colour gesture: called once when the picker
   *  commits, so a drag is one history entry rather than one per sample. */
  readonly onSettled?: (() => void) | undefined;
  readonly onDelete: ((id: string, replacement: string) => void) | undefined;
}

export function PaintList(props: PaintListProps): React.JSX.Element {
  const { palette, usage, onChange, onSettled, onDelete } = props;
  // Read once per draw, so the figure beside a token and the set a deletion
  // moves are one walk of one scene.
  const uses = usage?.();
  // The pane's own list, from the module the bridge's count also reads, so the
  // rows drawn and the number in the title bar cannot disagree (§7.3).
  const ids = paletteTokenIds(palette);
  const [picked, setPicked] = useState<string | undefined>(ids[0]);
  // Derived, not stored: when the picked token leaves the palette the pane falls
  // back to the first declared one, which is what `draw` did imperatively.
  const selected =
    picked !== undefined && palette[picked] !== undefined ? picked : ids[0];
  const entry = selected === undefined ? undefined : palette[selected];

  const commit = (next: FabricPaletteEntry): void => {
    if (selected === undefined) return;
    onChange({ ...palette, [selected]: next });
  };

  const add = (): void => {
    const id = nextId(palette);
    onChange({
      ...palette,
      [id]: {
        name: uiCopy.panels.newColour,
        value: { kind: "solid", color: newTokenPaint },
      },
    });
    setPicked(id);
  };

  return (
    <div className="flex flex-col gap-[var(--space-8)]">
      <ControlSelect
        label={uiCopy.panels.colourToken}
        data={{ "data-yunari-palette-token": "" }}
        value={selected ?? ""}
        options={ids.map((id) => ({ id, name: palette[id]?.name ?? id }))}
        onChange={(id) => setPicked(id)}
      />
      <ul className="flex flex-col gap-[var(--space-4)]">
        {ids.map((id) => {
          const token = palette[id];
          if (token === undefined) return null;
          return (
            <li key={id}>
              <button
                type="button"
                data-yunari-palette-token-row={id}
                aria-pressed={id === selected}
                onClick={() => setPicked(id)}
                className={`flex min-h-[26px] w-full items-center gap-[var(--space-6)] rounded-md border ${
                  id === selected
                    ? "border-muted bg-panel"
                    : "border-edge bg-panel-2"
                } px-[var(--space-6)] text-left text-sm text-text hover:border-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent`}
              >
                <span
                  aria-hidden={true}
                  className="size-[14px] flex-none rounded-sm border border-edge"
                  style={{ background: paintCss(token.value) }}
                />
                <span className="truncate">{token.name}</span>
                <span
                  data-yunari-palette-usage=""
                  className="ml-auto flex-none text-xs text-muted tabular-nums"
                >
                  {figureFor(id, uses)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        data-yunari-palette-add=""
        onClick={add}
        className={plainButtonClasses}
      >
        {uiCopy.panels.addColour}
      </button>
      {selected === undefined || entry === undefined ? null : (
        /* Keyed by the token **and the paint kind**: a colour or an angle changes
           a value, so the field set stands and the picker keeps its trigger; a
           kind switch changes the shape of the fields, so the set is rebuilt.
           That is the imperative `built`/`shape` rule in its React form — the
           rebuild used to destroy the picker's trigger and the popover then
           measured a detached node. */
        <TokenFields
          key={`${selected}|${entry.value.kind}`}
          entry={entry}
          palette={palette}
          selected={selected}
          commit={commit}
          onSettled={onSettled}
          onDelete={onDelete}
        />
      )}
      {uses === undefined ? null : (
        <>
          <h3 className="text-xs text-muted">{uiCopy.panels.layers}</h3>
          <ul
            data-yunari-palette-users=""
            className="flex flex-col gap-[var(--space-4)] text-xs text-text"
          >
            {(uses[selected ?? ""] ?? []).map((use) => (
              <li key={use.objectId}>{use.name}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** The chosen token's own fields: its name, its paint kind, its value, and the
 *  reassignment-on-delete row. */
function TokenFields(props: {
  readonly entry: FabricPaletteEntry;
  readonly palette: FabricPalette;
  readonly selected: string;
  readonly commit: (entry: FabricPaletteEntry) => void;
  readonly onSettled?: (() => void) | undefined;
  readonly onDelete: ((id: string, replacement: string) => void) | undefined;
}): React.JSX.Element {
  const { entry, palette, selected, commit, onSettled, onDelete } = props;
  return (
    <div
      data-yunari-palette-fields=""
      className="flex flex-col gap-[var(--space-8)]"
    >
      <ControlText
        label={uiCopy.panels.name}
        data={{ "data-yunari-palette-name": "" }}
        value={entry.name}
        onCommit={(next) => {
          const trimmed = next.trim();
          if (trimmed === "") return;
          commit({ ...entry, name: trimmed });
        }}
      />
      <ControlSelect
        label={uiCopy.panels.paint}
        data={{ "data-yunari-palette-kind": "" }}
        value={entry.value.kind}
        options={(["solid", "gradient"] as const).map((kind) => ({
          id: kind,
          name: uiCopy.panels.paintKinds[kind],
        }))}
        onChange={(kind) => {
          const wanted = kind === "gradient" ? "gradient" : "solid";
          if (entry.value.kind === wanted) return;
          commit({ ...entry, value: seedPaint(entry.value) });
        }}
      />
      {entry.value.kind === "solid" ? (
        <SolidFields
          entry={entry}
          value={entry.value}
          commit={commit}
          onSettled={onSettled}
        />
      ) : (
        <GradientFields entry={entry} value={entry.value} commit={commit} />
      )}
      <DeletionControls
        palette={palette}
        selected={selected}
        onDelete={onDelete}
      />
    </div>
  );
}

/** A solid token's colour: one trigger, and the picker's own popover holding the
 *  area, the channels, the one exact-value field and the presets.
 *
 * The pane used to carry a second field and a swatch beside the picker. Two
 * controls for one value meant two draft states, two refusals and two routes to
 * the same token. */
function SolidFields(props: {
  readonly entry: FabricPaletteEntry;
  readonly value: Extract<PalettePaint, { readonly kind: "solid" }>;
  readonly commit: (entry: FabricPaletteEntry) => void;
  readonly onSettled?: (() => void) | undefined;
}): React.JSX.Element {
  const { entry, value, commit, onSettled } = props;
  const put = (color: string): void => {
    commit({ ...entry, value: { kind: "solid", color } });
  };
  return (
    <ColourPicker
      label={uiCopy.panels.colour}
      value={value.color}
      onValueChange={put}
      onValueCommit={(color) => {
        put(color);
        onSettled?.();
      }}
    />
  );
}

/** A gradient token: its angle, the visual editor, and the numeric fields beside
 *  it — a drag cannot land on 0.37 exactly. */
function GradientFields(props: {
  readonly entry: FabricPaletteEntry;
  readonly value: Extract<PalettePaint, { readonly kind: "gradient" }>;
  readonly commit: (entry: FabricPaletteEntry) => void;
}): React.JSX.Element {
  const { entry, value, commit } = props;
  /** One stop replaced, refused when the result stops ascending — the same
   *  monotonicity rule the imperative fields applied before either commit. */
  const update = (
    index: number,
    next: { readonly offset: number; readonly color: string },
  ): void => {
    const stops = value.stops.map((stop, at) => (at === index ? next : stop));
    if (stops.some((stop, at) => at > 0 && stop.offset < stops[at - 1]!.offset))
      return;
    commit({ ...entry, value: { ...value, stops } });
  };
  const last = value.stops.at(-1);
  return (
    <>
      <ControlNumber
        label={uiCopy.panels.angle}
        data={{ "data-yunari-palette-angle": "" }}
        value={value.angle}
        onCommit={(angle) => {
          if (!Number.isFinite(angle)) return;
          commit({ ...entry, value: { ...value, angle } });
        }}
      />
      <div data-yunari-palette-gradient="" className="w-full">
        <GradientEditor
          stops={value.stops}
          angle={value.angle}
          label={uiCopy.panels.gradient}
          onChange={({ stops, angle }) => {
            commit({ ...entry, value: { ...value, stops, angle } });
          }}
        />
      </div>
      {value.stops.map((stop, index) => (
        <Fragment key={index}>
          {/* A bounded number, so DESIGN.md §5's vocabulary gives it a track
              (`vg-493`). The step is the offset's own: 0 and 1 are the two ends
              of a fraction, and the control set's default step of 1 would leave
              the track holding nothing between them. */}
          <ControlSlider
            label={uiCopy.panels.stopPosition(index + 1)}
            data={{ "data-yunari-palette-stop-offset": "" }}
            value={stop.offset}
            min={0}
            max={1}
            step={0.01}
            onCommit={(offset) => update(index, { offset, color: stop.color })}
          />
          <ControlText
            label={uiCopy.panels.stopColour(index + 1)}
            data={{ "data-yunari-palette-stop-color": "" }}
            value={stop.color}
            onCommit={(color) => {
              const typed = color.trim();
              if (typed === "") return;
              update(index, { offset: stop.offset, color: typed });
            }}
          />
        </Fragment>
      ))}
      {last === undefined ? null : (
        <button
          type="button"
          data-yunari-palette-add-stop=""
          className={plainButtonClasses}
          onClick={() => {
            commit({
              ...entry,
              value: {
                ...value,
                stops: [...value.stops, { offset: 1, color: last.color }],
              },
            });
          }}
        >
          {uiCopy.panels.addStop}
        </button>
      )}
    </>
  );
}

/** The reassignment-on-delete row: the token this one's references move to, and
 *  the deletion itself. Deleting goes through `reassignPaletteToken` — no
 *  surface walks the scene for references a second time. */
function DeletionControls(props: {
  readonly palette: FabricPalette;
  readonly selected: string;
  readonly onDelete: ((id: string, replacement: string) => void) | undefined;
}): React.JSX.Element | null {
  const { palette, selected, onDelete } = props;
  const [picked, setPicked] = useState<string | undefined>(undefined);
  if (onDelete === undefined) return null;
  const options = Object.entries(palette)
    .filter(([id]) => id !== selected)
    .map(([id, entry]) => ({ id, name: entry.name }));
  const replacement =
    picked !== undefined && picked !== selected && palette[picked] !== undefined
      ? picked
      : options[0]?.id;
  return (
    <>
      <ControlSelect
        label={uiCopy.panels.reassign}
        data={{ "data-yunari-palette-replacement": "" }}
        value={replacement ?? ""}
        options={options}
        onChange={setPicked}
      />
      <button
        type="button"
        data-yunari-palette-delete=""
        disabled={replacement === undefined}
        onClick={() => {
          if (replacement !== undefined) onDelete(selected, replacement);
        }}
        className="self-start rounded-md border border-edge bg-panel-2 px-[var(--space-6)] py-[var(--space-4)] text-sm text-hot hover:border-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:text-faint"
      >
        {uiCopy.panels.deleteColour}
      </button>
    </>
  );
}

/** The figure beside a token. A missing reading is stated, never a default: with
 *  no scene to read the pane says so rather than fabricating a zero (§97). */
function figureFor(
  id: string,
  uses: Readonly<Record<string, readonly PaletteTokenUse[]>> | undefined,
): string {
  if (uses === undefined) return uiCopy.panels.notSet;
  return String((uses[id] ?? []).length);
}

/** The paint as a CSS background: the colour itself, or the sweep a gradient
 *  describes — the same `GradientEditor` draws on its own track. */
function paintCss(value: PalettePaint): string {
  if (value.kind === "solid") return value.color;
  return gradientCss(value.stops, value.angle);
}

/**
 * The same paint in the other shape, carrying the colour it already had.
 *
 * Switching kind used to invent one: a gradient opened on white and black, so
 * choosing "Linear gradient" over a 30% alpha panel replaced it, in one
 * dropdown choice, with an opaque sweep of two colours nobody asked for — and
 * undo was the way back. Seeding both stops from the colour being replaced
 * loses nothing, and going back to a solid takes the gradient's first stop,
 * because that is the one colour a gradient can still name.
 */
function seedPaint(value: PalettePaint): PalettePaint {
  if (value.kind === "solid") {
    return {
      kind: "gradient",
      angle: 0,
      stops: [
        { offset: 0, color: value.color },
        { offset: 1, color: value.color },
      ],
    };
  }
  return {
    kind: "solid",
    color: value.stops[0]?.color ?? newTokenPaint,
  };
}

/** The first free `colour`, `colour-2`, … — the ids are stable keys references
 *  are written against, so a new token never reuses a deleted one's name. */
function nextId(palette: FabricPalette): string {
  for (let suffix = 1; ; suffix += 1) {
    const id = suffix === 1 ? "colour" : `colour-${suffix}`;
    if (palette[id] === undefined) return id;
  }
}
