import { MAX_ARTBOARD_DIMENSION } from "@yunari/renderer-core";
import { createElement, useId, useState } from "react";
import {
  ARTBOARD_ORIENTATIONS,
  ARTBOARD_RATIOS,
  ARTBOARD_RESOLUTIONS,
  type ArtboardOrientation,
  type ArtboardRatioId,
  type ArtboardResolutionId,
  type ArtboardSize,
  artboardOrientation,
  artboardPresetFor,
  artboardSize,
  nearestArtboardPreset,
} from "./artboard-presets.js";
import { ControlPair } from "./components/ui/control-pair.js";
import {
  type ControlOption,
  ControlSelect,
} from "./components/ui/control-select.js";
import { ACTION_BUTTON, Dialog } from "./components/ui/dialog.js";
import type { ModalSettle } from "./components/ui/modal-host.js";
import { openModal } from "./components/ui/modal-host.js";
import { displayLensGroups, lensMatching } from "./display-lens.js";
import { uiCopy } from "./ui-copy.js";

/** The empty option id, read twice: the display control's **Fit** — no lens —
 *  and the technical selects' "not a preset". Both are the absence of a named
 *  choice rather than a choice with a name. */
const CUSTOM = "";

/** A reading, not a choice: an author cannot ask for a size that is not a preset
 *  and cannot get stuck on one they chose by accident. Same shape as the
 *  artboard panel's `Custom`, so the two controls say the same thing. */
const CUSTOM_READING: ControlOption = {
  id: CUSTOM,
  name: uiCopy.panels.customSize,
  disabled: true,
};

/**
 * The artboard a new document opens at, chosen before the document exists.
 *
 * **What the theme is for, first, and the size beside it.** The display
 * control answers where the theme will be seen; the three selects and the free
 * width and height answer how it is measured. **The two are independent**: a
 * lens used to rewrite the artboard, so an author who had typed a size lost it
 * by glancing at a preview. Both questions are now on screen together, and each
 * answers only itself.
 *
 * It opens on the shape of the document it would replace, when there is one, for
 * the reason it always did: an author who has settled on 19.5:9 portrait and
 * presses **New theme** again has answered the size question already. The
 * preview opens on the catalogue's lens for that shape, or Fit when the
 * author's list holds none — a user-managed list cannot promise every shape a
 * preview, so the opening lens is optional rather than a throw.
 *
 * Every control is a `ControlSelect` or a `ControlPair`, and the modal shell is
 * `Dialog` — the surface is React rather than a hand-built `<dialog>`.
 */
export function NewDocumentChooser({
  current,
  settle,
}: {
  readonly current?: ArtboardSize | undefined;
  readonly settle: ModalSettle<NewDocumentAnswer>;
}): React.JSX.Element {
  /** The preset this dialog opens on, and the size that follows from it. */
  const nearest = nearestArtboardPreset(current);
  const opening = artboardSize(
    nearest.ratio,
    nearest.resolution,
    nearest.orientation,
  );
  const sizeId = `yunari-new-document-size-${useId().replace(/[^\w-]/g, "")}`;

  /** The size the author has settled on, and the display they named. Two values
   *  rather than one, because the display is a choice the technical controls do
   *  not write back: picking a ratio leaves the author's own display alone. */
  const [chosen, adopt] = useState<ArtboardSize>(opening);
  /** The preview, or `undefined` for Fit. `string` rather than a union of ids
   *  because the catalogue is the author's: an id is whatever the stored list
   *  derived, and only the camera resolves it. */
  const [display, setDisplay] = useState<string | undefined>(
    () => lensMatching(nearest)?.id,
  );

  /** The three ids the size is at, or `undefined` for the author's own — the
   *  reading a control shows, not an answer it can commit. */
  const preset = artboardPresetFor(chosen);

  /** The preview and nothing else. The size stays the technical controls'
   *  answer, which is what makes the two questions independent. */
  const pickDisplay = (id: string): void => {
    setDisplay(id === CUSTOM ? undefined : id);
  };

  /** The one writer of the size, read by the three selects, the two free fields
   *  and the readout together, so the answer at confirm time, the number shown
   *  and the presets the controls claim cannot be three different sizes. */
  const derive = (
    which: "ratio" | "orientation" | "resolution",
    id: string,
  ): void => {
    // **Refused, not guessed.** A preset is three answers; an author who typed
    // their own dimensions answered with two free numbers instead, so any one
    // dropdown cannot say what the size is. `artboardPresetFor` returns nothing
    // there and the change is declined — the control snaps back to its reading
    // because its value is derived from `chosen`, which did not move.
    if (preset === undefined) return;
    const next =
      which === "ratio"
        ? {
            ratio: id as ArtboardRatioId,
            orientation: preset.orientation,
            resolution: preset.resolution,
          }
        : which === "orientation"
          ? {
              ratio: preset.ratio,
              orientation: id as ArtboardOrientation,
              resolution: preset.resolution,
            }
          : {
              ratio: preset.ratio,
              orientation: preset.orientation,
              resolution: id as ArtboardResolutionId,
            };
    adopt(artboardSize(next.ratio, next.resolution, next.orientation));
  };

  const answer = (): NewDocumentAnswer => ({ size: chosen, display });

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) settle.dismiss();
      }}
      label={uiCopy.newDocument.chooseSize}
    >
      <p className="editor-shell-dialog-lead">
        {uiCopy.newDocument.chooseSize}
      </p>
      <div className="flex flex-col gap-[var(--space-8)]">
        <ControlSelect
          label={uiCopy.newDocument.display}
          data={{ "data-yunari-new-document-display": "" }}
          value={display ?? CUSTOM}
          options={displayOptions(opening)}
          onChange={pickDisplay}
        />
        {/* The technical question, always on screen: a hidden block is out of
            the accessibility tree, and a size behind a choice is a size the
            author loses by making an unrelated one. */}
        <div
          data-yunari-new-document-technical=""
          className="flex flex-col gap-[var(--space-8)]"
        >
          <ControlSelect
            label={uiCopy.panels.ratio}
            data={{ "data-yunari-new-document-ratio": "" }}
            value={preset?.ratio ?? CUSTOM}
            options={ratioOptions()}
            onChange={(id) => derive("ratio", id)}
          />
          <ControlSelect
            label={uiCopy.panels.orientation}
            data={{ "data-yunari-new-document-orientation": "" }}
            value={preset?.orientation ?? CUSTOM}
            options={orientationOptions()}
            onChange={(id) => derive("orientation", id)}
          />
          <ControlSelect
            label={uiCopy.panels.resolution}
            data={{ "data-yunari-new-document-resolution": "" }}
            value={preset?.resolution ?? CUSTOM}
            options={resolutionOptions()}
            onChange={(id) => derive("resolution", id)}
          />
          {/* The free size the panel already carries, through the panel's own
              pair so the chooser and the panel bound an author's dimensions the
              same way rather than the chooser inventing a second pair. */}
          <ControlPair
            label={uiCopy.panels.size}
            halves={[
              {
                label: uiCopy.panels.widthMark,
                value: chosen.width,
                data: { "data-yunari-new-document-width": "" },
                integer: true,
                min: 1,
                max: MAX_ARTBOARD_DIMENSION,
                onCommit: (width) => adopt({ width, height: chosen.height }),
              },
              {
                label: uiCopy.panels.heightMark,
                value: chosen.height,
                data: { "data-yunari-new-document-height": "" },
                integer: true,
                min: 1,
                max: MAX_ARTBOARD_DIMENSION,
                onCommit: (height) => adopt({ width: chosen.width, height }),
              },
            ]}
          />
        </div>
        {/* The size on screen, live. Four controls that only combine into a
            number are four guesses, and the author would find out the size only
            after committing to it. */}
        <div className="yunari-field">
          <label htmlFor={sizeId}>{uiCopy.panels.size}</label>
          <output
            id={sizeId}
            // `tabular-nums` was `.yunari-dialog .yunari-dialog-size`'s only
            // rule, and the popup is `.editor-shell-dialog` now, so the
            // descendant match is gone: this number is the one that must not
            // jitter as its digits change.
            className="tabular-nums"
            data-yunari-new-document-size=""
          >
            {`${chosen.width} × ${chosen.height}`}
          </output>
        </div>
        <div className="yunari-dialog-actions">
          <button
            type="button"
            className={ACTION_BUTTON}
            data-yunari-new-document-cancel=""
            onClick={settle.dismiss}
          >
            {uiCopy.newDocument.cancel}
          </button>
          <button
            type="button"
            className={ACTION_BUTTON}
            data-yunari-new-document-create=""
            onClick={() => settle.close(answer())}
          >
            {uiCopy.newDocument.create}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** Fit first, then the active catalogue grouped by the display menu's own
 *  grouping — Landscape first for the artboard's own orientation, through the
 *  one predicate. No Custom entry: the technical controls are their own answer
 *  and are always on screen, so one entry cannot stand for both Fit and "not a
 *  preset". A lens is named by its id, the same word the menu prints. */
function displayOptions(opening: ArtboardSize): readonly ControlOption[] {
  const options: ControlOption[] = [{ id: CUSTOM, name: uiCopy.display.fit }];
  for (const group of displayLensGroups(artboardOrientation(opening))) {
    for (const lens of group.lenses) {
      options.push({
        id: lens.id,
        name: lens.id,
        group: uiCopy.artboardOrientations[group.orientation],
      });
    }
  }
  return options;
}

function ratioOptions(): readonly ControlOption[] {
  return [
    ...ARTBOARD_RATIOS.map((entry) => ({
      id: entry.id,
      name: uiCopy.artboardRatios[entry.id],
    })),
    CUSTOM_READING,
  ];
}

function orientationOptions(): readonly ControlOption[] {
  return [
    ...ARTBOARD_ORIENTATIONS.map((id) => ({
      id,
      name: uiCopy.artboardOrientations[id],
    })),
    CUSTOM_READING,
  ];
}

function resolutionOptions(): readonly ControlOption[] {
  return [
    ...ARTBOARD_RESOLUTIONS.map((entry) => ({
      id: entry.id,
      name: uiCopy.artboardResolutions[entry.id],
    })),
    CUSTOM_READING,
  ];
}

/**
 * What the author answered: the artboard to create, and the display to see it
 * through.
 *
 * **Both halves travel together because both were asked.** The display is the
 * first question and was previously written and never read — a 1080 × 2340
 * document opened inside a landscape frame, wasting stage on bars the author had
 * already told us not to want. Carrying only the size made the answer to that
 * question unreachable from here.
 *
 * The display is a **view preference and never document content** (§67), which
 * is why it is a separate field rather than something derived from the size:
 * nothing about `size` names a lens, and a caller that wants one has to ask.
 */
export interface NewDocumentAnswer {
  readonly size: ArtboardSize;
  /** The lens's id from the active catalogue, or `undefined` for Fit — see
   *  `chooseArtboardSize`. An id rather than a `DisplayLens`: the catalogue is
   *  the author's, so the answer names a stored choice and the camera resolves
   *  it. */
  readonly display: string | undefined;
}

/**
 * Asks for the artboard, and resolves the answer — or `undefined` when the
 * author dismissed it, which is how a `New` pressed by accident leaves the open
 * document alone.
 *
 * `current` is the artboard of the document about to be replaced; the dialog
 * opens on the catalogue's lens for that shape, so a settled shape is offered
 * back rather than reset.
 *
 * `display` is `undefined` when the author chose **Fit** (or the catalogue held
 * no lens for the opening shape), and the caller frames the new document with
 * Fit. That is the reading, not a gap: Fit is the author declining to name a
 * display. A document at a display's own shape, by contrast, is offered back
 * with that display already ticked.
 *
 * The size is not a preset: three of the four ways to reach one here are a
 * preset and one is an author's own dimensions, and a type that cannot carry
 * both would have the session guess which the author meant.
 */
export function chooseArtboardSize(
  current?: ArtboardSize,
): Promise<NewDocumentAnswer | undefined> {
  return openModal((settle) =>
    createElement(NewDocumentChooser, { current, settle }),
  );
}
