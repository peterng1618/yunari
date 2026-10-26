import { Slider } from "@base-ui/react/slider";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { ControlNumber } from "./control-number.js";
import {
  type ControlProps,
  ControlRow,
  describedBy,
  isBlocked,
  useControlIds,
} from "./control-well.js";

/**
 * A bounded number: a 3px track with an accent fill, a 10px thumb, and a well
 * showing the value (DESIGN.md §5).
 *
 * A gesture has one undo boundary, so preview and history are separate calls:
 * `onPreview` fires while the gesture is moving and writes nothing, one changed
 * value reaches `onCommit` when the gesture ends, and Escape ends it with
 * `onCancel` and no commit at all. Base UI's commit does not fire when the
 * value did not change, so a press that moves nothing adds nothing.
 *
 * **The gesture's own value is this control's state.** A controlled slider
 * renders from `value`, and every caller here implements `onCommit` alone —
 * `SelectionEdits` has no preview route — so with nothing feeding the moving
 * value back the thumb could not move until the gesture ended and the value
 * landed, which is what the author saw as a slider that updates half a second
 * late (vg-449). `onPreview` stays for a caller that also wants a live preview
 * elsewhere; the pointer no longer depends on one being supplied.
 *
 * **The well is the slider's other edit route, and it is not a second one.** It
 * is a `ControlNumber` in its inline form, so the draft, the validation and the
 * commit rule stay in the one control that owns them (the reasoning
 * `control-pair.tsx` states for its halves) — a readout beside a track would put
 * a second copy of §5's rules three lines away from the first. It is named by
 * the row's own label rather than printing that label a second time, and it is
 * 40px wide because the track takes the rest of the row — the narrowest well
 * whose own input still measures §5's 24×24.
 *
 * A wheel over the control moves it by **the slider's own step**, read back off
 * the range input, so the gesture and the drag cannot step differently. The
 * listener is native and non-passive — React attaches `wheel` passively, so a
 * `preventDefault` through its own prop is a no-op and the panel would scroll
 * under the gesture, which is the reasoning `viewport-manager/navigation.ts`
 * already states for the canvas.
 */
export function ControlSlider(
  props: ControlProps & {
    readonly value: number;
    readonly min: number;
    readonly max: number;
    /** The owner says the value is whole; the well refuses a fraction the way
     *  every other number field does, and the track already steps by 1. */
    readonly integer?: boolean;
    /**
     * The only commits this setting accepts, when it is discrete.
     *
     * The track still runs over whole steps, but **over list indices**, not over
     * the values: a divisor of 100 splits into slices of 1, 2, 4, 5, … and a
     * track spanning 1–100 would offer every value between them — each one a
     * commit no adapter can draw. Index-to-value is this control's whole part in
     * it; the list itself belongs to the setting's owner.
     */
    readonly values?: readonly number[];
    /** How many decimals the well shows; the stored value keeps its precision. */
    readonly decimals?: number;
    /** What the number is a share of, written beside the well and spoken by the
     *  track — a bare `2.5` beside a width in degrees reads as degrees too. */
    readonly suffix?: string;
    /** The owner can take the key away again — an absent optional setting. The
     *  track has no empty state, so the well is where that act lives. */
    readonly onClear?: () => void;
    /**
     * `value` is a fallback the owner supplied, not one the document holds: an
     * optional setting with nothing authored.
     *
     * The track has to sit somewhere and the platform and ARIA forbid it
     * reporting an absence, so the owner hands it what a first edit would write —
     * and **the well reads the document alone**, rendering empty until something
     * is stored. An unauthored `0` and an authored one are different documents
     * and must not read alike (`vg-497`); the well's empty draft is the route
     * back, as it is for every other optional field (`0049`).
     */
    readonly unauthored?: boolean;
    readonly onPreview?: (value: number) => void;
    /**
     * The gesture abandoned: it takes the value the press started from, because
     * §5's cancellation *restores the start value* and the prop cannot carry it
     * — a re-publish mid-gesture moves `value` onto the previewed number. The
     * owner writes it back through the funnel and records nothing.
     */
    readonly onCancel?: (start: number) => void;
    readonly onCommit: (value: number) => void;
  },
): React.JSX.Element {
  const {
    label,
    id,
    disabled,
    refused,
    hint,
    density,
    data,
    value,
    min,
    max,
    integer,
    values,
    decimals,
    suffix,
    onClear,
    unauthored,
    onPreview,
    onCancel,
    onCommit,
  } = props;
  const ids = useControlIds(id);
  const blocked = isBlocked({ disabled, refused });
  /**
   * The stored value sits outside the range this control was handed — another
   * owner's measure moved the bound and left the value where it was, so the
   * track cannot draw what the document holds.
   *
   * **The track is the wrong half, not the well.** The well is a field reading
   * the document's own value; the thumb is a projection whose range has moved
   * out from under it. Neither of the two ways of making the track agree is
   * open: the platform clamps an `input[type=range]` to its own `min`/`max`,
   * and ARIA will not let a slider report a value outside them either. So the
   * control states which of the two is real rather than drawing the bound in
   * silence. The value is not rewritten — the author typed it, and it is
   * another owner's measure that moved the range — and the track stays
   * operable, because dragging it down is the repair.
   */
  const outOfRange =
    value > max
      ? `stored ${value}, above the ${max} this track can reach`
      : value < min
        ? `stored ${value}, below the ${min} this track can reach`
        : undefined;
  const rangeNoteId = `${ids.control}-range`;
  // A press in flight, and whether Escape ended it. The release that follows a
  // cancel must add no history, so the flag is consumed by the commit rather
  // than cleared by it; a keyboard step is never part of a pointer gesture and
  // clears it, which is what stops a stale cancel from eating a later commit.
  const pressing = useRef(false);
  const cancelled = useRef(false);
  // What the press started from, for `onCancel`. Read at the press rather than
  // from `value` when Escape arrives: a preview writes the document, and a
  // re-publish between them would have moved the prop onto the previewed number.
  const started = useRef(value);
  // What the pointer is holding, until the committed value arrives. The two are
  // cleared together at the end of the gesture, so a refusal — which writes
  // nothing — cannot strand the thumb on a value the document never took.
  const [dragging, setDragging] = useState<number | null>(null);
  const shown = dragging ?? value;
  // A discrete setting's track is its list's index space. A value the list does
  // not carry — a hand-edited document — leaves the thumb at the continuous end
  // rather than inventing a member; the well still shows the document's number.
  const selected = values === undefined ? -1 : values.indexOf(value);
  const trackMin = values === undefined ? min : 0;
  const trackMax = values === undefined ? max : values.length - 1;
  const trackShown =
    values === undefined
      ? shown
      : (dragging ?? (selected === -1 ? trackMax : selected));
  const shownValue =
    values === undefined ? shown : (values[trackShown] ?? value);
  // What a screen reader hears. A discrete track speaks its member, which the
  // thumb's numeric value cannot; a measured one speaks the number with the
  // unit it is measured in.
  const spoken =
    values === undefined
      ? `${
          decimals === undefined
            ? String(shownValue)
            : shownValue.toFixed(decimals)
        }${suffix ?? ""}`
      : String(shownValue);
  /** What a track position commits: the value itself, or its list member. */
  const valueAt = (position: number): number =>
    values === undefined ? position : (values[position] ?? value);
  // The well reads the document, so a value the document does not hold leaves it
  // empty — the track's fallback is not something the author wrote (`vg-497`).
  // The gesture is the one exception: while a drag is in flight the moving value
  // is this control's own state (`vg-449`), and a blank field beside a moving
  // thumb would read as a broken control rather than as an empty document.
  const wellEmpty = unauthored === true && dragging === null;
  // Base UI's slider is not the accessible element: the nested `input[type=range]`
  // is, and most aria props land on the thumb `div` beside it. So the refusal
  // state is written onto the input directly, or a screen reader never hears it.
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const node = input.current;
    if (node === null) return;
    if (refused === undefined) node.removeAttribute("aria-disabled");
    else node.setAttribute("aria-disabled", "true");
  }, [refused]);

  // `data` belongs to the focus target (control-well.tsx), and the focus target
  // is the nested `input[type=range]` — not `Slider.Root`, which is a wrapper.
  // Base UI exposes no prop that reaches the input, so the attributes are
  // mirrored onto it here.
  useEffect(() => {
    const node = input.current;
    if (node === null) return;
    const entries = Object.entries(data ?? {});
    for (const [key, value] of entries) node.setAttribute(key, value);
    return () => {
      for (const [key] of entries) node.removeAttribute(key);
    };
  }, [data]);

  // What a wheel tick has moved the value to, until the document answers. A
  // burst of ticks arrives faster than React re-renders, so each tick reads the
  // previous tick's result rather than the value this control was rendered
  // with — otherwise five steps would write the same number five times.
  const ticked = useRef<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const hooks = wellData(data);

  useEffect(() => {
    const node = root.current;
    if (node === null) return;
    const onWheel = (event: WheelEvent): void => {
      if (blocked) return;
      event.preventDefault();
      // **A value outside this control's range makes the wheel a no-op.** That
      // state belongs to another owner's measure, not to the author's gesture:
      // a panel carrying a border of 100 and then resized to a drawn edge of 40
      // has `max` 40 and a value of 100, and clamping inside the handler would
      // turn one tick *up* into a commit of 40 — a gesture that should raise the
      // value lowering it, with a history entry for an edit nobody made. Which
      // of the two is right is not this control's to decide, so it decides
      // neither.
      if (values === undefined) {
        if (value < min || value > max) return;
      } else if (selected === -1) {
        // A value the list does not carry is in the same state: a gesture that
        // moved the thumb would commit a neighbour the document never named.
        return;
      }
      // The step the drag uses, read off the element that carries it. A step of
      // `any` reports 0, and a wheel cannot move by nothing.
      const step = stepOf(input.current);
      const from = ticked.current ?? trackShown;
      const next = Math.min(
        Math.max(from + (event.deltaY < 0 ? step : -step), trackMin),
        trackMax,
      );
      if (next === from) return;
      ticked.current = next;
      cancelled.current = false;
      setDragging(next);
      const committed = valueAt(next);
      onPreview?.(committed);
      onCommit(committed);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [
    blocked,
    value,
    min,
    max,
    values,
    selected,
    trackShown,
    trackMin,
    trackMax,
    valueAt,
    onPreview,
    onCommit,
  ]);

  // The hold is only honest while the document catches up: any answer that
  // moves the value retires it, so a tick that was refused cannot strand the
  // thumb on a number the document never took.
  useEffect(() => {
    ticked.current = null;
    setDragging(null);
  }, [value]);

  return (
    <ControlRow
      ids={ids}
      label={label}
      refused={refused}
      hint={hint}
      density={density}
    >
      <Slider.Root
        ref={root}
        value={trackShown}
        min={trackMin}
        max={trackMax}
        {...(values === undefined ? {} : { step: 1 })}
        disabled={disabled}
        aria-disabled={refused === undefined ? undefined : true}
        onPointerDown={() => {
          pressing.current = true;
          cancelled.current = false;
          started.current = value;
        }}
        onPointerUp={() => {
          pressing.current = false;
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !pressing.current) return;
          event.preventDefault();
          pressing.current = false;
          cancelled.current = true;
          setDragging(null);
          onCancel?.(started.current);
        }}
        onValueChange={(next, details) => {
          if (blocked) {
            // The primitive's own refusal: the change is never applied, so
            // nothing is previewed and nothing can be committed.
            details.cancel();
            return;
          }
          if (details.reason === "keyboard") cancelled.current = false;
          setDragging(next);
          onPreview?.(valueAt(next));
        }}
        onValueCommitted={(next) => {
          pressing.current = false;
          setDragging(null);
          if (cancelled.current) {
            cancelled.current = false;
            return;
          }
          if (blocked) return;
          onCommit(valueAt(next));
        }}
        className="flex w-full flex-wrap items-center gap-x-[var(--space-6)] gap-y-[var(--space-4)]"
      >
        <Slider.Control className="relative flex h-[26px] flex-1 items-center">
          <Slider.Track className="h-[3px] w-full rounded-sm bg-edge">
            <Slider.Indicator className="rounded-sm bg-accent" />
          </Slider.Track>
          {/* Two parts, because one cannot do it: the fill half is the accent
              and the rest half is `--edge`, and in graphite and light those sit
              far enough apart that no single colour clears §5's 3:1 against
              both. The interior answers to the fill, the ring to the rest, and
              the parity gate measures each against the half it has to beat. */}
          <Slider.Thumb
            inputRef={input}
            aria-labelledby={ids.label}
            // The track's number is an index; a screen reader has to hear the
            // setting's own value, which is the list member at that index.
            {...(values === undefined && suffix === undefined
              ? {}
              : { "aria-valuetext": spoken })}
            // The hint and the refusal are the two notes the row owns, and the
            // range input is the element a screen reader reaches: a hint that
            // stayed on the wrapper would reach nobody (§5.3 keeps a refusal out
            // of a tooltip for the same reason). The out-of-range note joins
            // them because it is a statement about *this* element's value, and
            // the thumb is the element that cannot report it.
            aria-describedby={describedBy(
              hint === undefined ? undefined : ids.hint,
              refused === undefined ? undefined : ids.reason,
              outOfRange === undefined ? undefined : rangeNoteId,
            )}
            className="size-[10px] rounded-sm border border-panel bg-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          />
        </Slider.Control>
        {/* The row wraps, so a refused draft's own words take a line under the
            track instead of being squeezed into the fixed width the well is.
            That width is 40px and not the 36px the readout used, because **the
            well's own input is a target** and `hitTargetClasses` cannot widen a
            replaced element: `well − 2(--space-6) − 2(1px border)` is the input's
            box, which §5 asks to be 24×24 — a floor of 38px, with a pixel either
            side of the box the design-language case samples at ±11. The narrow
            well gave a 22px field, which that case hit-tests and fails; `vg-469`'s
            item 10 is what put a field where a readout used to be. */}
        <ControlNumber
          inline
          {...(id === undefined ? {} : { id })}
          labelledById={ids.label}
          label={label}
          {...(hooks === undefined ? {} : { data: hooks })}
          wellClassName="w-[40px] flex-none"
          value={wellEmpty ? undefined : shownValue}
          min={min}
          max={max}
          {...(values === undefined ? {} : { oneOf: values })}
          {...(integer === undefined ? {} : { integer })}
          {...(decimals === undefined ? {} : { decimals })}
          {...(suffix === undefined ? {} : { unit: suffix })}
          {...(density === undefined ? {} : { density })}
          {...(onClear === undefined ? {} : { onClear })}
          // The well is the half that reads the document, so it is described by
          // the same note: the number it shows is the one the track cannot
          // reach, and the words saying so belong to both halves.
          {...(outOfRange === undefined ? {} : { describedById: rangeNoteId })}
          onCommit={onCommit}
        />
        {/* Last in the root, not between the track and the well: the root wraps,
            and a full-width child placed earlier would push the well onto a line
            of its own. */}
        {outOfRange === undefined ? null : (
          <p
            id={rangeNoteId}
            data-yunari-slider-out-of-range=""
            className="w-full text-xs text-muted"
          >
            {outOfRange}
          </p>
        )}
      </Slider.Root>
    </ControlRow>
  );
}

/**
 * The well's own hooks: the slider's name the track, and the well is the same
 * control's typed route, so each takes the same name with `-well` appended.
 *
 * Two elements under one name would be a strict-mode violation for every suite
 * that reads the track's value, and the field has to stay addressable by both
 * routes — one hook naming both is a locator that cannot say which one it means.
 */
function wellData(
  data: Readonly<Record<`data-${string}`, string>> | undefined,
): Readonly<Record<`data-${string}`, string>> | undefined {
  const entries = Object.entries(data ?? {});
  return entries.length === 0
    ? undefined
    : Object.fromEntries(entries.map(([key, value]) => [`${key}-well`, value]));
}

/**
 * The step the drag moves by, read off the range input Base UI renders.
 *
 * Read rather than declared: a step held here beside the slider's own could
 * disagree with it, and the wheel would then step differently from every other
 * way of moving the value. The default step (no `step` attribute) is 1, which
 * is what this control has always used; `any` parses to nothing and cannot move
 * a value.
 */
function stepOf(node: HTMLInputElement | null): number {
  const raw = node === null ? null : node.getAttribute("step");
  const step = raw === null ? 1 : Number(raw);
  return Number.isFinite(step) && step > 0 ? step : 1;
}
