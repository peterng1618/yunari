import {
  formatColor,
  fromHsv,
  type Hsva,
  parseColor,
  type Rgba,
  toHsv,
} from "@yunari/renderer-core";
import { useRef, useState } from "react";
import { type ColourChannel, withChannel } from "./colour-picker-model.js";

export interface ColourPickerApi {
  readonly hsva: Hsva;
  readonly text: string;
  readonly invalid: boolean;
  readonly eyedropper: boolean;
  setChannel(channel: ColourChannel, value: number): void;
  commit(): void;
  commitText(input: string): void;
  choosePreset(hex: string): void;
  pickFromScreen(): Promise<void>;
  reset(): void;
}

export interface ColourPickerOptions {
  readonly value: string;
  readonly onValueChange: (next: string) => void;
  readonly onValueCommit: (next: string) => void;
}

/** The state a refusal has to survive in: `text` is what the field renders. */
interface PickerState {
  readonly authored: string;
  readonly hsva: Hsva;
  readonly text: string;
  readonly invalid: boolean;
}

/** The opaque black a picker seeds with; hue and saturation are meaningless at 0. */
const BLACK: Hsva = { h: 0, s: 0, v: 0, a: 1 };

/**
 * `authored` is the value prop the state was derived from. An unparseable one
 * keeps its text and reports itself refused rather than pretending to be black.
 * ponytail: no recovery beyond the field; the theme schema owns colour validity.
 */
function derive(value: string): PickerState {
  const rgba = parseColor(value);
  if (rgba === undefined) {
    return { authored: value, hsva: BLACK, text: value, invalid: true };
  }
  return {
    authored: value,
    hsva: toHsv(rgba),
    text: formatColor(rgba),
    invalid: false,
  };
}

/** Declared locally: the DOM lib this workspace typechecks against has no EyeDropper. */
interface ScreenEyeDropper {
  open(): Promise<{ readonly sRGBHex: string }>;
}
type ScreenEyeDropperConstructor = new () => ScreenEyeDropper;

function eyeDropperConstructor(): ScreenEyeDropperConstructor | undefined {
  if (typeof window === "undefined" || !("EyeDropper" in window)) {
    return undefined;
  }
  return (window as { EyeDropper?: ScreenEyeDropperConstructor }).EyeDropper;
}

/**
 * The picker's one state owner: live changes during a gesture, one settled
 * commit when it ends. `text` is hook state because `ControlText` clears its own
 * draft before committing, so a rejected draft has nowhere else to live.
 */
export function useColourPicker(options: ColourPickerOptions): ColourPickerApi {
  const { value, onValueChange, onValueCommit } = options;
  const [state, setState] = useState<PickerState>(() => derive(value));
  // Handlers read and write through this mirror, so two moves inside one event
  // cannot both read the same stale render's state.
  const stateRef = useRef(state);
  // `commit()` must settle on what was last *emitted*, never on a refused draft.
  const latest = useRef<string | undefined>(
    state.invalid ? undefined : state.text,
  );

  let current = state;
  if (current.authored !== value) {
    // A refusal is the person's draft: an outside write must not replace it —
    // and it leaves `latest` alone, so no settle can emit the refused text.
    current = current.invalid ? { ...current, authored: value } : derive(value);
    stateRef.current = current;
    if (!current.invalid) latest.current = current.text;
    setState(current);
  }

  const apply = (next: PickerState): void => {
    stateRef.current = next;
    setState(next);
  };

  /** A parsed colour, emitted live and settled — the preset and text paths. */
  const settle = (rgba: Rgba): void => {
    const hsva = toHsv(rgba);
    const text = formatColor(rgba);
    latest.current = text;
    apply({ ...stateRef.current, hsva, text, invalid: false });
    onValueChange(text);
    onValueCommit(text);
  };

  const setChannel = (channel: ColourChannel, channelValue: number): void => {
    const prev = stateRef.current;
    const hsva = withChannel(prev.hsva, channel, channelValue);
    // A refused value comes back as the same object: say nothing, emit nothing.
    if (hsva === prev.hsva) return;
    const text = formatColor(fromHsv(hsva));
    latest.current = text;
    apply({ ...prev, hsva, text, invalid: false });
    onValueChange(text);
  };

  const choosePreset = (hex: string): void => {
    const rgba = parseColor(hex);
    // An unparseable preset is not a colour; it is not fabricated into one.
    if (rgba === undefined) return;
    settle(rgba);
  };

  const commitText = (input: string): void => {
    const rgba = parseColor(input);
    if (rgba === undefined) {
      apply({ ...stateRef.current, text: input, invalid: true });
      return;
    }
    settle(rgba);
  };

  const commit = (): void => {
    // Nothing emitted yet, or a draft is being refused: there is nothing to settle.
    if (latest.current === undefined || stateRef.current.invalid) return;
    onValueCommit(latest.current);
  };

  const reset = (): void => {
    const next = derive(stateRef.current.authored);
    latest.current = next.invalid ? undefined : next.text;
    apply(next);
  };

  const eyedropper = eyeDropperConstructor() !== undefined;

  const pickFromScreen = async (): Promise<void> => {
    const Constructor = eyeDropperConstructor();
    if (Constructor === undefined) return;
    try {
      const picked = await new Constructor().open();
      choosePreset(picked.sRGBHex);
    } catch {
      // Dismissing the eyedropper rejects its promise; a cancel is not a failure.
    }
  };

  return {
    hsva: current.hsva,
    text: current.text,
    invalid: current.invalid,
    eyedropper,
    setChannel,
    commit,
    commitText,
    choosePreset,
    pickFromScreen,
    reset,
  };
}
