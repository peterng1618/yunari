import { Popover } from "@base-ui/react/popover";
import { RadioGroup } from "@base-ui/react/radio-group";
import { formatColor, fromHsv } from "@yunari/renderer-core";
import { useRef, useState } from "react";
import { Glyph, PIPETTE_GLYPH } from "../../editor-shell/icons.js";
import { presetLibrary } from "../../preset-library/index.js";
import { usePresetLibrary } from "../../preset-library/use-preset-library.js";
import { uiCopy } from "../../ui-copy.js";
import {
  areaFromPoint,
  areaPoint,
  areaValueText,
  CHANNEL_RANGES,
  type ColourChannel,
  channelValue,
  steppedValue,
} from "./colour-picker-model.js";
import { ControlChoiceRow } from "./control-choice-row.js";
import { ControlIconButton } from "./control-icon-button.js";
import { ControlText } from "./control-text.js";
import { ControlRow, ControlWell, useControlIds } from "./control-well.js";
import {
  PresetContextMenu,
  type PresetMenuTarget,
} from "./preset-context-menu.js";
import { useColourPicker } from "./use-colour-picker.js";

/** A checkerboard in theme tokens, so a translucent paint reads as translucent. */
const CHECKERBOARD =
  "repeating-conic-gradient(var(--panel-2) 0% 25%, var(--stage) 0% 50%)";

/** One key press moves a channel by the model's step for it. */
function channelKeys(
  value: number,
  channel: ColourChannel,
  event: {
    readonly key: string;
    readonly shiftKey: boolean;
  },
): number | undefined {
  const range = CHANNEL_RANGES[channel];
  return steppedValue(
    value,
    range.min,
    range.max,
    range.step,
    event.key,
    event.shiftKey,
  );
}

/**
 * One channel strip: a painted gradient, a pointer read along it, and the
 * keyboard model `steppedValue` owns. It is paint plus wiring — the value
 * itself lives in `useColourPicker`, and the range in `CHANNEL_RANGES`, so the
 * announced bounds and the readable bounds cannot drift.
 */
function ChannelTrack({
  testId,
  label,
  channel,
  value,
  background,
  onValue,
  onCommit,
}: {
  readonly testId: string;
  readonly label: string;
  readonly channel: ColourChannel;
  readonly value: number;
  readonly background: string;
  readonly onValue: (next: number) => void;
  readonly onCommit: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const range = CHANNEL_RANGES[channel];

  const pick = (clientX: number): void => {
    const box = ref.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0) return;
    const ratio = (clientX - box.left) / box.width;
    if (!Number.isFinite(ratio)) return;
    onValue(
      range.min + Math.min(1, Math.max(0, ratio)) * (range.max - range.min),
    );
  };

  return (
    <div
      ref={ref}
      data-testid={testId}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      aria-valuenow={Math.round(value)}
      className="relative h-3 w-full touch-none rounded-sm border border-edge focus-visible:outline-2 focus-visible:outline-accent"
      style={{ background }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        pick(event.clientX);
      }}
      onPointerMove={(event) => {
        if (event.buttons !== 0) pick(event.clientX);
      }}
      onPointerUp={onCommit}
      onPointerCancel={onCommit}
      onKeyDown={(event) => {
        const next = channelKeys(value, channel, event);
        if (next === undefined) return;
        // A slider that lets an arrow through scrolls the panel behind it.
        event.preventDefault();
        onValue(next);
        onCommit();
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-text"
        style={{
          left: `${((value - range.min) / (range.max - range.min)) * 100}%`,
        }}
      />
    </div>
  );
}

/**
 * The palette's colour picker: one trigger in a §5 well, and a popover holding
 * the area, the two channel strips, the value field, the preset library row and
 * the eyedropper.
 *
 * Everything but the paint is composed from the control set; the live/settled
 * state machine is `useColourPicker`'s (decision 0100), and the preset menu is
 * the canvas menu's controlled pattern. `<input type="color">` still cannot do
 * this: a theme paint carries alpha, and a native input has no alpha channel.
 */
export function ColourPicker({
  value,
  label,
  onValueChange,
  onValueCommit,
}: {
  readonly value: string;
  readonly label: string;
  readonly onValueChange: (next: string) => void;
  readonly onValueCommit: (next: string) => void;
}): React.JSX.Element {
  const api = useColourPicker({ value, onValueChange, onValueCommit });
  const presets = usePresetLibrary();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<PresetMenuTarget | undefined>(undefined);
  const ids = useControlIds(undefined);
  const trigger = useRef<HTMLButtonElement>(null);
  const area = useRef<HTMLDivElement>(null);

  const point = areaPoint(api.hsva);
  const saturation = channelValue("saturation", api.hsva);
  const brightness = channelValue("value", api.hsva);
  const hue = channelValue("hue", api.hsva);
  const alpha = channelValue("alpha", api.hsva);

  const pickArea = (clientX: number, clientY: number): void => {
    const box = area.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0 || box.height === 0) return;
    const x = (clientX - box.left) / box.width;
    const y = (clientY - box.top) / box.height;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const next = areaFromPoint(x, y);
    api.setChannel("saturation", next.s * 100);
    api.setChannel("value", next.v * 100);
  };

  const areaKeys = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const key = event.key;
    const horizontal =
      key === "ArrowLeft" ||
      key === "ArrowRight" ||
      key === "Home" ||
      key === "End" ||
      key === "PageUp" ||
      key === "PageDown"
        ? steppedValue(saturation, 0, 100, 1, key, event.shiftKey)
        : undefined;
    const vertical =
      key === "ArrowUp" ||
      key === "ArrowDown" ||
      key === "Home" ||
      key === "End" ||
      key === "PageUp" ||
      key === "PageDown"
        ? steppedValue(brightness, 0, 100, 1, key, event.shiftKey)
        : undefined;
    if (horizontal === undefined && vertical === undefined) return;
    event.preventDefault();
    if (horizontal !== undefined) api.setChannel("saturation", horizontal);
    if (vertical !== undefined) api.setChannel("value", vertical);
    api.commit();
  };

  const openMenu = (
    preset: { readonly id: string; readonly name: string },
    x: number,
    y: number,
  ): void => {
    setMenu({ kind: "colour", id: preset.id, name: preset.name, x, y });
  };

  return (
    <>
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          // The preset menu portals to `body`, so a press on its row is outside
          // this popup's DOM. Without this guard deleting a preset would close
          // the picker out from under the author mid-edit.
          if (!next && menu !== undefined) return;
          setOpen(next);
          // Escape and an outside press both land here; the trigger is where a
          // keyboard author came from, so it is where they go back to.
          if (!next) trigger.current?.focus();
        }}
      >
        <ControlRow ids={ids} label={label} labelFor={ids.control}>
          <ControlWell>
            <Popover.Trigger
              ref={trigger}
              id={ids.control}
              type="button"
              data-testid="picker-trigger"
              data-yunari-palette-picker=""
              aria-label={label}
              className="flex h-full w-full min-w-0 items-center gap-[var(--space-6)] bg-transparent text-left"
            >
              <span
                aria-hidden
                className="relative size-3.5 flex-none overflow-hidden rounded-sm border border-edge"
                style={{
                  backgroundImage: CHECKERBOARD,
                  backgroundSize: "0.5rem 0.5rem",
                }}
              >
                <span
                  className="absolute inset-0"
                  style={{ background: value }}
                />
              </span>
              <span
                data-yunari-value=""
                className="truncate font-mono text-xs text-text"
              >
                {/* The colour, not the document's spelling of it: an authored
                    `rgb()` reads as the hex the field commits (Review Focus 1). */}
                {api.text}
              </span>
            </Popover.Trigger>
          </ControlWell>
        </ControlRow>
        <Popover.Portal>
          <Popover.Positioner sideOffset={6} align="start" className="z-50">
            <Popover.Popup
              data-testid="colour-picker"
              className="w-64 space-y-3 rounded-md border border-edge bg-panel p-3 text-text shadow-lg"
            >
              <div
                ref={area}
                data-testid="picker-area"
                role="slider"
                tabIndex={0}
                aria-label={uiCopy.panels.pickerArea}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(saturation)}
                aria-valuetext={areaValueText(api.hsva, api.text)}
                className="relative h-32 w-full touch-none rounded-sm border border-edge focus-visible:outline-2 focus-visible:outline-accent"
                style={{
                  background: `linear-gradient(to top, hsl(0 0% 0%), transparent), linear-gradient(to right, hsl(0 0% 100%), hsl(${hue} 100% 50%))`,
                }}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  pickArea(event.clientX, event.clientY);
                }}
                onPointerMove={(event) => {
                  if (event.buttons !== 0) {
                    pickArea(event.clientX, event.clientY);
                  }
                }}
                onPointerUp={(event) => {
                  pickArea(event.clientX, event.clientY);
                  api.commit();
                }}
                onPointerCancel={() => api.commit()}
                onKeyDown={areaKeys}
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-text"
                  style={{ left: `${point.x}%`, top: `${point.y}%` }}
                />
              </div>
              <ChannelTrack
                testId="picker-hue"
                label={uiCopy.panels.pickerHue}
                channel="hue"
                value={hue}
                background="linear-gradient(to right, hsl(0 100% 50%), hsl(60 100% 50%), hsl(120 100% 50%), hsl(180 100% 50%), hsl(240 100% 50%), hsl(300 100% 50%), hsl(360 100% 50%))"
                onValue={(next) => api.setChannel("hue", next)}
                onCommit={() => api.commit()}
              />
              <ChannelTrack
                testId="picker-alpha"
                label={uiCopy.panels.pickerAlpha}
                channel="alpha"
                value={alpha}
                background={`linear-gradient(to right, transparent, ${formatColor(
                  fromHsv({ ...api.hsva, a: 1 }),
                )}), ${CHECKERBOARD} 0 0 / 0.5rem 0.5rem`}
                onValue={(next) => api.setChannel("alpha", next)}
                onCommit={() => api.commit()}
              />
              <ControlText
                label={uiCopy.panels.pickerValueField}
                data={{
                  "data-testid": "picker-hex",
                  "data-yunari-palette-color": "",
                }}
                value={api.text}
                {...(api.invalid
                  ? { invalid: uiCopy.panels.colourUnpaintable(api.text) }
                  : {})}
                onCommit={(next) => api.commitText(next)}
              />
              <RadioGroup
                value={api.text}
                onValueChange={(next) => api.choosePreset(next)}
                aria-label={uiCopy.panels.pickerPresets}
                className="space-y-1"
              >
                {presets.colours.map((preset) => (
                  <span
                    key={preset.id}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      openMenu(preset, event.clientX, event.clientY);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Delete") {
                        event.preventDefault();
                        presetLibrary.deletePreset("colour", preset.id);
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
                      value={preset.value}
                      data={{
                        "data-testid": `picker-preset-${preset.id}`,
                        "data-yunari-value": "",
                      }}
                      swatch={
                        <span
                          aria-hidden
                          data-yunari-value=""
                          className="size-4 flex-none rounded-sm border border-edge"
                          style={{
                            backgroundImage: `${CHECKERBOARD}`,
                            backgroundSize: "0.5rem 0.5rem",
                          }}
                        >
                          <span
                            className="block size-full rounded-sm"
                            style={{ background: preset.value }}
                          />
                        </span>
                      }
                    />
                  </span>
                ))}
              </RadioGroup>
              {api.eyedropper ? (
                <ControlIconButton
                  label={uiCopy.panels.pickerEyedropper}
                  data={{ "data-testid": "picker-eyedropper" }}
                  onClick={() => {
                    void api.pickFromScreen();
                  }}
                >
                  <Glyph icon={PIPETTE_GLYPH} size={14} />
                </ControlIconButton>
              ) : null}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <PresetContextMenu
        target={menu}
        onClose={() => setMenu(undefined)}
        onDelete={(target) => {
          presetLibrary.deletePreset(target.kind, target.id);
          setMenu(undefined);
        }}
      />
    </>
  );
}
