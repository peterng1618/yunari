import type {
  FabricPalette,
  FabricPaletteEntry,
  PalettePaint,
} from "@yunari/renderer-core";
import { useState } from "react";
import { ColourPicker } from "../../components/ui/colour-picker.js";
import { ControlSelect } from "../../components/ui/control-select.js";
import { ControlText } from "../../components/ui/control-text.js";
import { GradientEditor } from "../../components/ui/gradient-editor.js";
import { newTokenPaint } from "../../new-fabric-theme-globals.js";
import type { PaletteTokenUse } from "../../palette-manager/panel.js";
import { uiCopy } from "../../ui-copy.js";

/**
 * A selected paint token's own properties, in the right column.
 *
 * **The fields moved here, unchanged.** They were the Tokens pane's inline field
 * set until the spec made the pane lists-only; their `data-yunari-palette-*`
 * selectors and their behaviour are the same, so every surface that addressed
 * them still does.
 *
 * **The users list is a property, not a pane footer.** It reads the same
 * `usage` getter the rows' figures read, per draw, so the objects a token is
 * linked to and the count beside it cannot disagree about the scene.
 *
 * **The heading is the token's own name.** A paint has no role word to title the
 * section with the way a preset has "Type preset", and inventing a "Paint token"
 * title would be a second name for a thing the name field already states.
 */
export interface PaintFieldsProps {
  readonly id: string;
  readonly entry: FabricPaletteEntry;
  readonly palette: FabricPalette;
  /** The objects each token is linked to, or `undefined` when there is no scene
   *  to read. A function, not a record: the scene changes under the inspector,
   *  so the list is re-read on every draw. */
  readonly usage:
    | (() => Readonly<Record<string, readonly PaletteTokenUse[]>>)
    | undefined;
  readonly onChange: (palette: FabricPalette) => void;
  /** The settled boundary of one commit: a colour gesture's end, or a discrete
   *  edit — the rename, the kind switch. Without the latter they are
   *  unundoable, and a later undo's globals restore silently reverts them. */
  readonly onSettled?: (() => void) | undefined;
  readonly onDelete: ((id: string, replacement: string) => void) | undefined;
}

export function PaintFields(props: PaintFieldsProps): React.JSX.Element {
  const { id, entry, palette, usage, onChange, onSettled, onDelete } = props;
  const uses = usage?.();
  const commit = (next: FabricPaletteEntry): void => {
    onChange({ ...palette, [id]: next });
  };

  return (
    <div
      data-yunari-palette-fields=""
      className="flex flex-col gap-[var(--space-8)]"
    >
      <h2 className="text-xs font-semibold tracking-[0.11em] text-muted uppercase">
        {entry.name}
      </h2>
      <ControlText
        label={uiCopy.panels.name}
        data={{ "data-yunari-palette-name": "" }}
        value={entry.name}
        onCommit={(next) => {
          const trimmed = next.trim();
          if (trimmed === "") return;
          commit({ ...entry, name: trimmed });
          onSettled?.();
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
          onSettled?.();
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
        <GradientFields
          entry={entry}
          value={entry.value}
          commit={commit}
          onSettled={onSettled}
        />
      )}
      <DeletionControls palette={palette} selected={id} onDelete={onDelete} />
      {uses === undefined ? null : (
        <>
          <h3 className="text-xs text-muted">{uiCopy.panels.layers}</h3>
          <ul
            data-yunari-palette-users=""
            className="flex flex-col gap-[var(--space-4)] text-xs text-text"
          >
            {(uses[id] ?? []).map((use) => (
              <li key={use.objectId}>{use.name}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** A solid token's colour: one trigger, and the picker's own popover holding
 *  the area, the channels, the one exact-value field and the presets.
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

/** A gradient token: the one visual editor, which owns its own angle and stop
 *  wells, the track being both the preview and the manipulator. */
function GradientFields(props: {
  readonly entry: FabricPaletteEntry;
  readonly value: Extract<PalettePaint, { readonly kind: "gradient" }>;
  readonly commit: (entry: FabricPaletteEntry) => void;
  readonly onSettled?: (() => void) | undefined;
}): React.JSX.Element {
  const { entry, value, commit, onSettled } = props;
  return (
    <div data-yunari-palette-gradient="" className="w-full">
      <GradientEditor
        stops={value.stops}
        angle={value.angle}
        label={uiCopy.panels.gradient}
        onCommit={onSettled}
        onChange={({ stops, angle }) => {
          commit({ ...entry, value: { ...value, stops, angle } });
        }}
      />
    </div>
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
