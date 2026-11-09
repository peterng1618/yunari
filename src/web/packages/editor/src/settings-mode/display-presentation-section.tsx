import {
  type DisplayRenderMode,
  type DisplayShape,
  snapRotation,
} from "@yunari/renderer-core";
import type * as React from "react";
import { ControlSegmented } from "../components/ui/control-segmented.js";
import { ControlSlider } from "../components/ui/control-slider.js";
import { ControlText } from "../components/ui/control-text.js";
import type { ThemedDisplay } from "../theme-library-client.js";
import { uiCopy } from "../ui-copy.js";
import { Group } from "./section-group.js";

/** The pair a presentation write carries: the store decides them together,
 *  because the shape is what decides the rule the angle has to satisfy.
 *
 *  Narrower than renderer-core's `DisplayPresentation`, whose `rotation` is
 *  optional because a scene may have no record: every answer the host gives
 *  here carries a number. */
export interface DisplayPresentation {
  readonly shape: DisplayShape;
  readonly rotation: number;
}

/** A circle's free angle snapped into the rect rule the store will enforce:
 *  `Math.round(rotation / 90) * 90 mod 360`, so 37 reads upright and 350 wraps
 *  to 0 rather than to a 360 the record refuses. The rule itself is
 *  renderer-core's. */
function snapQuarterTurn(rotation: number): number {
  return snapRotation("rect", rotation);
}

/**
 * The chosen display's name, glass and mounting angle, and the writes that
 * store them.
 *
 * **The words speak for the chosen display**, so the controls edit only the
 * record the rows above selected. The Host is the machine rather than a record —
 * the host adds its row rather than finding it — so it says why instead of
 * drawing controls that could not write. The host lists no `default` row: it is
 * a theme key, so there is nothing here to present.
 *
 * The row is replaced from the host's answer, never optimistically: the store
 * decides the shape and angle together, and a snapped angle it refused must not
 * stand on the row as though it had been stored. A rename answers the stored
 * name for the same reason, and the id stays where it was: assignments are keyed
 * by the id minted at creation.
 */
export function DisplayPresentationSection(props: {
  readonly display: ThemedDisplay | undefined;
  readonly write: (run: () => Promise<string>) => void;
  readonly save: (
    id: string,
    next: DisplayPresentation,
  ) => Promise<DisplayPresentation>;
  readonly onSaved: (id: string, saved: DisplayPresentation) => void;
  /** Writes the stream a panel display is fed. Only a family that offers more
   *  than one draws the control. */
  readonly saveRenderMode: (
    id: string,
    next: DisplayRenderMode,
  ) => Promise<DisplayRenderMode>;
  readonly onRenderModeSaved: (id: string, saved: DisplayRenderMode) => void;
  readonly rename: (id: string, label: string) => Promise<string>;
  readonly onRenamed: (id: string, label: string) => void;
}): React.JSX.Element {
  const editable =
    props.display !== undefined && props.display.id !== "this-pc"
      ? props.display
      : undefined;

  const savePresentation = (
    display: ThemedDisplay,
    next: DisplayPresentation,
  ): void => {
    props.write(async () => {
      const saved = await props.save(display.id, next);
      props.onSaved(display.id, saved);
      return uiCopy.hostSettings.displays.savedPresentation;
    });
  };

  /** A shape change and the angle it snaps to are one write, because the new
   *  shape is what decides the rule the angle has to satisfy. */
  const changeShape = (display: ThemedDisplay, shape: DisplayShape): void => {
    savePresentation(display, {
      shape,
      rotation:
        shape === "rect" ? snapQuarterTurn(display.rotation) : display.rotation,
    });
  };

  const changeRenderMode = (
    display: ThemedDisplay,
    renderMode: DisplayRenderMode,
  ): void => {
    props.write(async () => {
      const saved = await props.saveRenderMode(display.id, renderMode);
      props.onRenderModeSaved(display.id, saved);
      return uiCopy.hostSettings.displays.savedRenderMode;
    });
  };

  const rename = (display: ThemedDisplay, label: string): void => {
    const next = label.trim();
    // An empty field is a keystroke, not a name: the store refuses it and the
    // row would keep the old one, so nothing is sent.
    if (next === "" || next === display.label) return;
    props.write(async () => {
      const saved = await props.rename(display.id, next);
      props.onRenamed(display.id, saved);
      return uiCopy.hostSettings.displays.savedName;
    });
  };

  return (
    <Group
      testId="presentation"
      name={uiCopy.hostSettings.displays.presentation}
    >
      {/* No selection at all — the read is still out, empty, or failed — draws
          no body: the absence sentence is about `this-pc`, and stating it with
          no display read would be a claim nobody made. */}
      {props.display === undefined ? null : editable === undefined ? (
        <p className="text-xs text-muted">
          {uiCopy.hostSettings.displays.presentationAbsent}
        </p>
      ) : (
        <>
          <ControlText
            id="yunari-host-display-name"
            label={uiCopy.hostSettings.displays.name}
            hint={uiCopy.hostSettings.displays.nameHint}
            density="settings"
            data={{ "data-yunari-host-display-name": "" }}
            value={editable.label}
            onCommit={(label) => rename(editable, label)}
          />
          {/* The snap sentence travels with the rotation control's own hint
              below; inside the body, because it is about controls a display
              without a record does not have. */}
          <ControlSegmented
            id="yunari-host-display-shape"
            label={uiCopy.hostSettings.displays.shape}
            // The settings surface's row height, as the name field above takes
            // it: a section whose rows are 32px and 26px reads as two sections.
            density="settings"
            data={{ "data-yunari-host-display-shape": "" }}
            value={editable.shape}
            options={[
              { id: "rect", name: uiCopy.hostSettings.displays.shapeRect },
              { id: "circle", name: uiCopy.hostSettings.displays.shapeCircle },
            ]}
            onChange={(shape) => changeShape(editable, shape)}
          />
          {/* A rect display's track is its four quarter turns; a circle's is
              every whole degree. Both commit through the value well, which
              applies the same rule the store will. */}
          <ControlSlider
            id="yunari-host-display-rotation"
            label={uiCopy.hostSettings.displays.rotation}
            hint={uiCopy.hostSettings.displays.rotationSnapHint}
            density="settings"
            data={{ "data-yunari-host-display-rotation": "" }}
            value={editable.rotation}
            // A degree mark is a unit, not copy (`ui-copy.test.ts` keeps
            // pictographs out of the table): the number alone would read as a
            // bare count.
            suffix="°"
            {...(editable.shape === "rect"
              ? { min: 0, max: 270, values: [0, 90, 180, 270] }
              : { min: 0, max: 359, integer: true })}
            onCommit={(rotation) =>
              savePresentation(editable, {
                shape: editable.shape,
                rotation,
              })
            }
          />
          {/* Only a family that offers two streams draws the choice; a panel
              with one would get a control whose second option does nothing. */}
          {editable.panel !== undefined &&
          editable.panel.renderModes.length > 1 ? (
            <ControlSegmented
              id="yunari-host-display-render-mode"
              label={uiCopy.hostSettings.displays.renderMode}
              hint={uiCopy.hostSettings.displays.renderModeHint}
              density="settings"
              data={{ "data-yunari-host-display-render-mode": "" }}
              value={editable.panel.renderMode}
              options={editable.panel.renderModes.map((mode) => ({
                id: mode,
                name: uiCopy.hostSettings.displays.renderModes[mode],
              }))}
              onChange={(mode) => changeRenderMode(editable, mode)}
            />
          ) : null}
        </>
      )}
    </Group>
  );
}
