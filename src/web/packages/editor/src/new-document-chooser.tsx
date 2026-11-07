import {
  type Artboard,
  type ArtboardShape,
  MAX_ARTBOARD_DIMENSION,
} from "@yunari/renderer-core";
import {
  ARTBOARD_ORIENTATIONS,
  ARTBOARD_RATIOS,
  ARTBOARD_RESOLUTIONS,
  type ArtboardOrientation,
  type ArtboardRatioId,
  type ArtboardResolutionId,
  type ArtboardSize,
  artboardPresetFor,
  artboardSize,
  nearestArtboardPreset,
} from "@yunari/theme-kit";
import { createElement, useId, useState } from "react";
import { ControlPair } from "./components/ui/control-pair.js";
import {
  type ControlOption,
  ControlSelect,
} from "./components/ui/control-select.js";
import { ACTION_BUTTON, Dialog } from "./components/ui/dialog.js";
import type { ModalSettle } from "./components/ui/modal-host.js";
import { openModal } from "./components/ui/modal-host.js";
import { uiCopy } from "./ui-copy.js";

/** The empty option id: the technical selects' "not a preset". It is the
 *  absence of a named choice rather than a choice with a name. */
const CUSTOM = "";

/** A reading, not a choice: an author cannot ask for a size that is not a preset
 *  and cannot get stuck on one they chose by accident. Same shape as the
 *  artboard panel's `Custom`, so the two controls say the same thing. */
const CUSTOM_READING: ControlOption = {
  id: CUSTOM,
  name: uiCopy.panels.customSize,
  disabled: true,
};

/** What the chooser settles on: the artboard, and nothing about the preview. */
export interface NewDocumentAnswer {
  readonly size: ArtboardSize;
  readonly shape: ArtboardShape;
}

/**
 * The artboard a new document opens at, chosen before the document exists.
 *
 * **The size, and nothing else.** The display a theme is previewed through is
 * read from the artboard it creates: the camera opens on the catalogue lens
 * nearest that aspect, so the author is not asked a question the size already
 * answers.
 *
 * It opens on the shape of the document it would replace, when there is one, for
 * the reason it always did: an author who has settled on 19.5:9 portrait and
 * presses **New theme** again has answered the size question already.
 *
 * Every control is a `ControlSelect` or a `ControlPair`, and the modal shell is
 * `Dialog` — the surface is React rather than a hand-built `<dialog>`.
 */
export function NewDocumentChooser({
  current,
  settle,
}: {
  readonly current?: Artboard | undefined;
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

  /** The size the author has settled on. */
  const [chosen, adopt] = useState<ArtboardSize>(opening);
  /** The authored canvas's outline, read from the document it would replace.
   *  Absent there means rect, the same reading the envelope uses. */
  const [shape, setShape] = useState<ArtboardShape>(current?.shape ?? "rect");

  /** The three ids the size is at, or `undefined` for the author's own — the
   *  reading a control shows, not an answer it can commit. */
  const preset = artboardPresetFor(chosen);

  /** A circle is drawn on a square, so switching to one narrows the current
   *  size to its shorter edge. Switching back keeps that square: it is the
   *  author's last answer, not a size they abandoned. */
  const pickShape = (id: string): void => {
    const next = id as ArtboardShape;
    setShape(next);
    if (next === "circle") {
      const side = Math.min(chosen.width, chosen.height);
      adopt({ width: side, height: side });
    }
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
    //
    // A circle has one technical choice: it is square by definition, so the
    // resolution is all the author can say and the ratio and orientation it
    // implies are fixed rather than read off a preset they may not be on.
    if (shape === "circle") {
      if (which !== "resolution") return;
      adopt(artboardSize("1:1", id as ArtboardResolutionId, "landscape"));
      return;
    }
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

  const answer = (): NewDocumentAnswer => ({ size: chosen, shape });

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
        {/* The size, always on screen: a hidden block is out of the
            accessibility tree, and a size behind a choice is a size the
            author loses by making an unrelated one. */}
        <div
          data-yunari-new-document-technical=""
          className="flex flex-col gap-[var(--space-8)]"
        >
          <ControlSelect
            label={uiCopy.newDocument.shape}
            data={{ "data-yunari-new-document-shape": "" }}
            value={shape}
            options={shapeOptions()}
            onChange={pickShape}
          />
          {/* A circle is square whichever way up it is asked, so the two
              controls that would say otherwise have nothing to answer. */}
          {shape === "rect" && (
            <>
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
            </>
          )}
          <ControlSelect
            label={uiCopy.panels.resolution}
            data={{ "data-yunari-new-document-resolution": "" }}
            value={preset?.resolution ?? CUSTOM}
            options={resolutionOptions()}
            onChange={(id) => derive("resolution", id)}
          />
          {/* The free size the panel already carries, through the panel's own
              pair so the chooser and the panel bound an author's dimensions the
              same way rather than the chooser inventing a second pair. A circle
              is the exception the pair itself does not know: it is drawn on a
              square, so an edge typed while Shape is Circle writes both, and
              the answer is never a circle the validator refuses. */}
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
                onCommit: (width) =>
                  adopt({
                    width,
                    height: shape === "circle" ? width : chosen.height,
                  }),
              },
              {
                label: uiCopy.panels.heightMark,
                value: chosen.height,
                data: { "data-yunari-new-document-height": "" },
                integer: true,
                min: 1,
                max: MAX_ARTBOARD_DIMENSION,
                onCommit: (height) =>
                  adopt({
                    width: shape === "circle" ? height : chosen.width,
                    height,
                  }),
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

function shapeOptions(): readonly ControlOption[] {
  return (["rect", "circle"] as const).map((id) => ({
    id,
    name: uiCopy.artboardShapes[id],
  }));
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
 * What the author answered: the artboard to create.
 *
 * The lens is not part of it. The camera reads the lens off the artboard it is
 * given — the catalogue lens nearest that aspect — so the preview is a
 * consequence of the size rather than a second question. The lens stays a
 * **view preference and never document content** (§67): it is nowhere in this
 * answer or the theme it creates.
 *
 * The size is not a preset: three of the three preset controls reach one
 * answer, and one path is an author's own dimensions, and a type that cannot
 * carry both would have the session guess which the author meant.
 */
export function chooseArtboardSize(
  current?: Artboard,
): Promise<NewDocumentAnswer | undefined> {
  return openModal((settle) =>
    createElement(NewDocumentChooser, { current, settle }),
  );
}
