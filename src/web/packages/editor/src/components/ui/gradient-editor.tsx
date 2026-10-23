import { RadioGroup } from "@base-ui/react/radio-group";
import { colorAt } from "@yunari/renderer-core";
import { useRef, useState } from "react";
import { Glyph, MINUS_GLYPH, PLUS_GLYPH } from "../../editor-shell/icons.js";
import { presetLibrary } from "../../preset-library/index.js";
import { usePresetLibrary } from "../../preset-library/use-preset-library.js";
import { uiCopy } from "../../ui-copy.js";
import { ColourPicker } from "./colour-picker.js";
import { steppedValue } from "./colour-picker-model.js";
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
  const [menu, setMenu] = useState<PresetMenuTarget | undefined>(undefined);
  const track = useRef<HTMLDivElement | null>(null);

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

  /** The pointer's position as a 0–1 fraction of the track. */
  const ratioAt = (clientX: number): number | undefined => {
    const box = track.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0) return undefined;
    const ratio = (clientX - box.left) / box.width;
    if (!Number.isFinite(ratio)) return undefined;
    return Math.min(1, Math.max(0, ratio));
  };

  const addAt = (offset: number): void => {
    const next = [...stops, { offset, color: colorAt(stops, offset) }];
    setSelected(next.length - 1);
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
            className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border-2 border-text outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
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
              event.currentTarget.setPointerCapture(event.pointerId);
              setSelected(index);
              const offset = ratioAt(event.clientX);
              if (offset !== undefined)
                put(index, { offset, color: stop.color });
            }}
            onPointerMove={(event) => {
              if (event.buttons === 0) return;
              const offset = ratioAt(event.clientX);
              if (offset !== undefined)
                put(index, { offset, color: stop.color });
            }}
            onPointerUp={() => onCommit?.()}
            onPointerCancel={() => onCommit?.()}
            onKeyDown={(event) => {
              if (event.key === "Delete") {
                event.preventDefault();
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
              // A slider that lets an arrow through scrolls the panel behind it.
              event.preventDefault();
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
          className="space-y-1"
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
                  presetLibrary.deletePreset("gradient", preset.id);
                  return;
                }
                if (
                  (event.key === "F10" && event.shiftKey) ||
                  event.key === "ContextMenu"
                ) {
                  event.preventDefault();
                  const box = event.currentTarget.getBoundingClientRect();
                  openMenu(preset, box.left, box.top);
                }
              }}
            >
              <ControlChoiceRow
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
                    className="size-4 flex-none rounded-sm border border-edge"
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
