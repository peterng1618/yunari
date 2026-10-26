import { RadioGroup } from "@base-ui/react/radio-group";
import { colorAt } from "@yunari/renderer-core";
import { useRef, useState } from "react";
import { Glyph, MINUS_GLYPH, PLUS_GLYPH } from "../../editor-shell/icons.js";
import { presetLibrary } from "../../preset-library/index.js";
import { usePresetLibrary } from "../../preset-library/use-preset-library.js";
import { uiCopy } from "../../ui-copy.js";
import { ColourPicker } from "./colour-picker.js";
import { ratioAlong, steppedValue } from "./colour-picker-model.js";
import { ControlChoiceRow } from "./control-choice-row.js";
import { ControlIconButton } from "./control-icon-button.js";
import { ControlNumber } from "./control-number.js";
import { gradientCss } from "./gradient-css.js";
import {
  PresetContextMenu,
  type PresetMenuTarget,
} from "./preset-context-menu.js";

/** One authored stop: where it sits along the gradient, and what colour it is. */
interface GradientStop {
  readonly offset: number;
  readonly color: string;
}

/** A press selects; the pointer has to travel this far before it is a drag, so
 *  a click on a mark's own centre writes nothing. */
const DRAG_THRESHOLD = 2;

/** The pointer gesture under way on one mark, if any. */
interface Drag {
  readonly index: number;
  readonly startX: number;
  moved: boolean;
}

/** A stop's offset as the percentage its well shows, at two decimals — an
 *  exact fraction the author can read back, not a rounded projection. */
function percentOf(offset: number): number {
  return Math.round(offset * 100 * 100) / 100;
}

/**
 * The gradient editor: one track that is the preview *and* the manipulator.
 *
 * The palette's gradients carry an angle and any number of stops; the track
 * paints the gradient those stops describe, and each stop is a mark on it. A
 * mark drags, takes the keyboard model every bounded control here shares, and
 * selects the stop the two wells below edit — so one picker and one number
 * field edit whichever stop is under the selection rather than one of each per
 * stop. The whole gesture is live: `onChange` per sample, `onCommit` once at
 * the boundary, so a drag is one history entry rather than one per move.
 *
 * The preset row is the library's gradients, not this document's: choosing one
 * replaces the angle and the stops, and its own menu deletes it from the
 * library the way the colour picker's row does.
 */
export function GradientEditor({
  stops,
  angle,
  label,
  onChange,
  onCommit,
}: {
  readonly stops: readonly GradientStop[];
  readonly angle: number;
  readonly label: string;
  readonly onChange: (next: { stops: GradientStop[]; angle: number }) => void;
  readonly onCommit?: (() => void) | undefined;
}): React.JSX.Element {
  const presets = usePresetLibrary();
  const [selected, setSelected] = useState(0);
  // The popover belongs to the stop under the selection: a press that does not
  // travel opens it, so the stop and the picker that edits it are one gesture.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menu, setMenu] = useState<PresetMenuTarget | undefined>(undefined);
  const track = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);

  // Derived rather than stored, so a shorter stop list clamps the selection
  // without an effect and there is one answer rather than two.
  const active = Math.max(0, Math.min(selected, stops.length - 1));
  const current = stops[active];

  /** One stop replaced; the array stays the author's order, not a sorted copy,
   *  because the index is the stop's identity for the selection and the marks. */
  const put = (index: number, stop: GradientStop): void => {
    if (stops[index] === undefined) return;
    onChange({
      angle,
      stops: stops.map((candidate, at) => (at === index ? stop : candidate)),
    });
  };

  /** The pointer's position as a 0–1 fraction of the track, measured against
   *  the padding box the marks are positioned in. */
  const ratioAt = (clientX: number): number | undefined =>
    track.current === null ? undefined : ratioAlong(track.current, clientX);

  const endDrag = (opensPicker: boolean): void => {
    const gesture = drag.current;
    drag.current = null;
    if (gesture?.moved === true) {
      // A drag adjusted the stop; opening a popover under the pointer would
      // cover the track the author is aiming along.
      onCommit?.();
      return;
    }
    // A press that never travelled is a selection, not an edit — and the
    // selection is what the picker edits, so it is also how the picker opens.
    if (opensPicker && gesture !== undefined) setPickerOpen(true);
  };

  const addAt = (offset: number): void => {
    // **Inserted in the position its offset sorts to, never appended.** The
    // document's validator requires the stops' offsets to ascend, and a stop
    // pressed between two existing ones — or added at the midpoint while the
    // last stop is selected — appended a lower offset after a higher one and
    // produced a theme the editor then refused to save.
    const at = stops.findIndex((stop) => stop.offset > offset);
    const index = at === -1 ? stops.length : at;
    const next = [...stops];
    next.splice(index, 0, { offset, color: colorAt(stops, offset) });
    setSelected(index);
    onChange({ angle, stops: next });
    onCommit?.();
  };

  /** The add control's midpoint: between the selected stop and the next one,
   *  or between it and the end when it is the last. */
  const addMidpoint = (): void => {
    const from = current?.offset ?? 0;
    const higher = stops
      .map((stop) => stop.offset)
      .filter((offset) => offset > from);
    const to = higher.length === 0 ? 1 : Math.min(...higher);
    addAt((from + to) / 2);
  };

  const removeAt = (index: number): void => {
    // Two stops is the floor a gradient can describe a sweep with.
    if (stops.length <= 2 || stops[index] === undefined) return;
    const next = stops.filter((_, at) => at !== index);
    setSelected(Math.max(0, Math.min(index, next.length - 1)));
    onChange({ angle, stops: next });
    onCommit?.();
  };

  const applyPreset = (id: string): void => {
    const preset = presets.gradients.find((candidate) => candidate.id === id);
    if (preset === undefined) return;
    onChange({
      stops: preset.stops.map((stop) => ({ ...stop })),
      angle: preset.angle,
    });
    onCommit?.();
  };

  const openMenu = (
    preset: { readonly id: string; readonly name: string },
    x: number,
    y: number,
  ): void => {
    setMenu({ kind: "gradient", id: preset.id, name: preset.name, x, y });
  };

  return (
    <div className="space-y-2">
      <div
        ref={track}
        data-testid="gradient-track"
        role="group"
        aria-label={label}
        className="relative h-6 w-full touch-none rounded-sm border border-edge"
        style={{ background: gradientCss(stops, angle) }}
        onClick={(event) => {
          // A press on a mark is the mark's own gesture; only the bare track
          // inserts a stop, at the colour the gradient already has there.
          if (event.target !== event.currentTarget) return;
          const offset = ratioAt(event.clientX);
          if (offset !== undefined) addAt(offset);
        }}
      >
        {stops.map((stop, index) => (
          <div
            key={index}
            data-testid={`gradient-stop-${index}`}
            role="slider"
            tabIndex={0}
            aria-label={uiCopy.panels.stopPosition(index + 1)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(stop.offset * 100)}
            aria-valuetext={`${Math.round(stop.offset * 100)}% ${stop.color}`}
            // The stop the wells and the picker edit. A bordered dot among
            // bordered dots gives no answer without it, and it is the marker
            // every chosen control in the set uses: the accent boundary.
            data-selected={active === index ? "" : undefined}
            className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border-2 border-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent data-[selected]:border-accent"
            style={{
              left: `${stop.offset * 100}%`,
              background: stop.color,
              // §4's boundary role, not a shadow: the 1px spread separates the
              // dot from the track beneath it, which is separation rather than
              // altitude (`--elev-*` are offset-and-blur depths).
              boxShadow: "0 0 0 1px var(--edge)",
            }}
            onClick={() => setSelected(index)}
            onFocus={() => setSelected(index)}
            onPointerDown={(event) => {
              // The primary button owns the gesture; a secondary press is a
              // menu candidate and must not move or select the stop.
              if (event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              setSelected(index);
              drag.current = {
                index,
                startX: event.clientX,
                moved: false,
              };
            }}
            onPointerMove={(event) => {
              const gesture = drag.current;
              if (gesture === null || gesture.index !== index) return;
              if (event.buttons === 0) return;
              if (
                !gesture.moved &&
                Math.abs(event.clientX - gesture.startX) < DRAG_THRESHOLD
              )
                return;
              gesture.moved = true;
              const offset = ratioAt(event.clientX);
              if (offset !== undefined)
                put(index, { offset, color: stop.color });
            }}
            onPointerUp={() => endDrag(true)}
            onPointerCancel={() => endDrag(false)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                // The pointer's press-without-travel, for a keyboard author:
                // the stop opens the picker that edits it.
                event.preventDefault();
                event.stopPropagation();
                setSelected(index);
                setPickerOpen(true);
                return;
              }
              if (event.key === "Delete") {
                event.preventDefault();
                // The shortcut dispatcher is a `window` bubble listener and
                // does not read `defaultPrevented`, so preventing alone left
                // Delete deleting the selected object too.
                event.stopPropagation();
                removeAt(index);
                return;
              }
              const next = steppedValue(
                percentOf(stop.offset),
                0,
                100,
                1,
                event.key,
                event.shiftKey,
              );
              if (next === undefined) return;
              // A slider that lets an arrow through scrolls the panel behind it
              // and nudges the selected object.
              event.preventDefault();
              event.stopPropagation();
              put(index, { offset: next / 100, color: stop.color });
              onCommit?.();
            }}
          />
        ))}
      </div>
      <div className="flex items-center gap-[var(--space-4)]">
        <ControlIconButton
          label={uiCopy.panels.addStop}
          data={{ "data-testid": "gradient-add" }}
          onClick={addMidpoint}
        >
          <Glyph icon={PLUS_GLYPH} size={14} />
        </ControlIconButton>
        <ControlIconButton
          label={uiCopy.panels.removeStop}
          data={{ "data-testid": "gradient-remove" }}
          destructive={true}
          onClick={() => removeAt(active)}
        >
          <Glyph icon={MINUS_GLYPH} size={14} />
        </ControlIconButton>
      </div>
      {current === undefined ? null : (
        <>
          <ControlNumber
            label={uiCopy.panels.stopPosition(active + 1)}
            data={{ "data-testid": "gradient-offset" }}
            value={percentOf(current.offset)}
            unit="%"
            min={0}
            max={100}
            onCommit={(percent) => {
              put(active, { offset: percent / 100, color: current.color });
              onCommit?.();
            }}
          />
          <ColourPicker
            key={active}
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            label={uiCopy.panels.stopColour(active + 1)}
            value={current.color}
            onValueChange={(color) =>
              put(active, { offset: current.offset, color })
            }
            onValueCommit={(color) => {
              put(active, { offset: current.offset, color });
              onCommit?.();
            }}
          />
        </>
      )}
      <ControlNumber
        label={uiCopy.panels.angle}
        data={{ "data-testid": "gradient-angle" }}
        value={angle}
        unit="deg"
        onCommit={(next) => {
          onChange({ angle: next, stops: [...stops] });
          onCommit?.();
        }}
      />
      {presets.gradients.length === 0 ? null : (
        <RadioGroup
          value=""
          onValueChange={(id) => applyPreset(id)}
          aria-label={uiCopy.panels.gradientPresets}
          className="flex flex-wrap gap-[var(--space-4)]"
        >
          {presets.gradients.map((preset) => (
            <span
              key={preset.id}
              onContextMenu={(event) => {
                event.preventDefault();
                openMenu(preset, event.clientX, event.clientY);
              }}
              onKeyDown={(event) => {
                if (event.key === "Delete") {
                  event.preventDefault();
                  // Like the stop's own keys: the dispatcher would otherwise
                  // delete the selected canvas object in the same press.
                  event.stopPropagation();
                  presetLibrary.deletePreset("gradient", preset.id);
                  return;
                }
                if (
                  (event.key === "F10" && event.shiftKey) ||
                  event.key === "ContextMenu"
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  const box = event.currentTarget.getBoundingClientRect();
                  openMenu(preset, box.left, box.top);
                }
              }}
            >
              <ControlChoiceRow
                shape="chip"
                label={preset.name}
                value={preset.id}
                data={{
                  "data-testid": `gradient-preset-${preset.id}`,
                  "data-yunari-value": "",
                }}
                swatch={
                  <span
                    aria-hidden
                    data-yunari-value=""
                    className="block size-full"
                    style={{
                      background: gradientCss(preset.stops, preset.angle),
                    }}
                  />
                }
              />
            </span>
          ))}
        </RadioGroup>
      )}
      <PresetContextMenu
        target={menu}
        onClose={() => setMenu(undefined)}
        onDelete={(target) => {
          presetLibrary.deletePreset(target.kind, target.id);
          setMenu(undefined);
        }}
      />
    </div>
  );
}
