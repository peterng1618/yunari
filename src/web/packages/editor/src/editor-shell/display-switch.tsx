import { Menu } from "@base-ui/react/menu";
import { type ReactNode, useCallback, useSyncExternalStore } from "react";
import {
  type DisplayLens,
  displayLensGroups,
  previewCatalogueKey,
  subscribeLenses,
} from "../display-lens.js";
import { uiCopy } from "../ui-copy.js";
import type { ViewportManager } from "../viewport-manager/index.js";
import { ZOOM_STEP } from "../viewport-manager/navigation.js";
import { ControlTooltip } from "./controls/tooltip.js";
import {
  FIT_GLYPH,
  Glyph,
  MINUS_GLYPH,
  PLUS_GLYPH,
  PREVIEW_GLYPH,
} from "./icons.js";

/**
 * One subscription for both camera facts, read as **primitives** so an
 * unchanged camera yields a stable snapshot. Returning an object here would
 * re-render the control forever, which is why the zoom alone was a number
 * before the display arrived.
 */
function useZoom(viewport: ViewportManager): number {
  const subscribe = useCallback(
    (listener: () => void) => viewport.onChange(listener),
    [viewport],
  );
  return useSyncExternalStore(subscribe, () => viewport.zoom());
}

function useDisplay(viewport: ViewportManager): string | undefined {
  const subscribe = useCallback(
    (listener: () => void) => viewport.onChange(listener),
    [viewport],
  );
  return useSyncExternalStore(subscribe, () => viewport.display());
}

function useIsFitted(viewport: ViewportManager): boolean {
  const subscribe = useCallback(
    (listener: () => void) => viewport.onChange(listener),
    [viewport],
  );
  return useSyncExternalStore(subscribe, () => viewport.isFitted());
}

/** The catalogue is module state the settings tab writes; reading its revision
 *  subscribes this control, and the groups are then read from the same live
 *  list. A snapshot of the revision rather than the lenses keeps the identity
 *  stable, which is what `useSyncExternalStore` requires. */
function usePreviewCatalogue(): void {
  useSyncExternalStore(subscribeLenses, previewCatalogueKey);
}

/** The radio value for a camera that is not looking through a display. No item
 *  carries it, so the menu ticks nothing rather than ticking the nearest thing:
 *  a fit or 100 % clears the display and is not a lens, and reporting it as one
 *  is the control asserting a framing the camera is not in. */
const NEITHER = "neither";

/** The browser owns what is fullscreen; React keeps no copy of it. Esc exits,
 *  which is why the control is one-way rather than a toggle whose name would
 *  have to change under it. **The stage is the element**, not the document: the
 *  author asked for the canvas at full size, not the editor's chrome around it.
 *  A preview rendered without a stage does nothing rather than falling back to
 *  the whole page. */
function viewFullscreen(): void {
  document
    .querySelector<HTMLElement>(".editor-shell-stage")
    ?.requestFullscreen?.()
    .catch(() => {
      // A browser policy or a refusal leaves the stage where it was; the
      // control is a request, not a state this app can assert.
    });
}

export function DisplaySwitch({
  viewport,
  playback,
}: {
  readonly viewport: ViewportManager;
  /** The backdrop's playback group, drawn as the cluster's leading control
   *  when the document's background is a video. Passing it here rather than
   *  floating a second cluster over the stage keeps one view bar: the author
   *  reads and changes how the stage is shown in one place. */
  readonly playback?: ReactNode;
}): React.JSX.Element {
  const zoom = useZoom(viewport);
  const display = useDisplay(viewport);
  const isFitted = useIsFitted(viewport);
  usePreviewCatalogue();
  const groups = displayLensGroups();
  const percent = `${Math.round(zoom * 100)}%`;

  return (
    // The top-right corner, as one floating cluster. The readout is the
    // cluster's control and its own treatment lives on the cluster, so a reader
    // of the cluster's computed style (`shell-appearance.spec.ts`) sees the
    // surface the author sees. The chooser stays a portal, so the cluster holds
    // only what is drawn until it is opened.
    <div className="editor-shell-zoom editor-glass">
      {playback}
      {/* The camera commands, in this order — − / value / +, and fit —
          as siblings of the readout rather than replacements for it: the
          readout is still the display chooser's trigger, and the three act on
          the camera the way the `+/−/Shift+1` keys already do. */}
      <ViewButton
        label={uiCopy.display.zoomOut}
        onClick={() => viewport.zoomBy(1 / ZOOM_STEP)}
      >
        <Glyph icon={MINUS_GLYPH} size={15} />
      </ViewButton>
      <Menu.Root>
        <Menu.Trigger
          className="editor-shell-view-readout"
          // The name carries the concept *and* the readout, because the readout
          // is also the visible text: WCAG 2.5.3 asks an accessible name to
          // contain what is on screen, and "Display and zoom" over a button that
          // says "51%" contains none of it. Naming it the other way round —
          // dropping the label and letting "51%" stand alone — would leave a
          // control no voice user could ask for by what it is.
          aria-label={`${uiCopy.display.label}: ${percent}`}
          data-yunari-zoom=""
        >
          {/* The zoom, always — never the display's name.
           *
           * The control *is* the zoom readout still: it is where the author reads
           * the camera's scale, and two browser tests pin that as a capability
           * this plan does not remove. The display it is looking through is said
           * by the frame drawn around the stage, which is a shape rather than a
           * word, and by the checkmark in this menu. Putting the name here
           * instead would have made the percentage disappear whenever a display
           * was chosen — which is the default. */}
          {percent}
        </Menu.Trigger>
        <Menu.Portal keepMounted>
          <Menu.Positioner className="editor-shell-positioner">
            <Menu.Popup className="editor-shell-menu-popup">
              {/* The catalogue's lenses are one radio group because they are
                one fact: which window the stage looks through. The camera
                commands below are not choices from it — a fit or 100 % clears
                the lens, so they cannot sit unselected while a lens stays
                ticked. The tick is read off the camera, not off the display
                alone: a cleared lens with a manual zoom ticks nothing. */}
              <Menu.RadioGroup
                value={display ?? NEITHER}
                onValueChange={(value: string) =>
                  viewport.showDisplay(value === NEITHER ? undefined : value)
                }
              >
                {/* Three labelled groups rather than six bare ratios: the
                  author has to see whether a preview is the way up their theme
                  is, and a portrait theme is usually not looking for a
                  landscape preview. Landscape leads, however the artboard is
                  shaped, so the list does not move under a document change. */}
                {groups.map((group) => (
                  <Menu.Group key={group.kind}>
                    <Menu.GroupLabel className="editor-shell-menu-label">
                      {uiCopy.artboardOrientations[group.kind]}
                    </Menu.GroupLabel>
                    {group.lenses.map(lensItem)}
                  </Menu.Group>
                ))}
              </Menu.RadioGroup>
              <Menu.Item
                aria-label={uiCopy.display.zoomToFit}
                onClick={() => viewport.zoomToFit()}
              >
                {uiCopy.display.zoomToFit}
              </Menu.Item>
              <Menu.Item
                aria-label={uiCopy.display.toSelection}
                onClick={() => viewport.zoomToSelection()}
              >
                {uiCopy.display.toSelection}
              </Menu.Item>
              <Menu.Item
                aria-label={uiCopy.display.actualSize}
                onClick={() => viewport.reset()}
              >
                {uiCopy.display.actualSize}
              </Menu.Item>
              <Menu.Item
                aria-label={uiCopy.display.fullscreen}
                onClick={viewFullscreen}
              >
                {uiCopy.display.fullscreen}
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <ViewButton
        label={uiCopy.display.zoomIn}
        onClick={() => viewport.zoomBy(ZOOM_STEP)}
      >
        <Glyph icon={PLUS_GLYPH} size={15} />
      </ViewButton>
      {/* The state is the camera's own `isFitted()`, the same fact the display
          menu's Fit tick reads: one fact, two readings, so a lens chosen and
          then moved off the fit cannot be marked as fitted here and unmarked
          there. It is carried by `data-fitted` rather than `aria-pressed`
          because Fit is one-way — pressing it fits, and no second press un-fits
          — so the toggle pattern would announce a state the control cannot
          change. */}
      <ViewButton
        label={uiCopy.display.zoomToFit}
        fitted={isFitted}
        onClick={() => viewport.zoomToFit()}
      >
        <Glyph icon={FIT_GLYPH} size={15} />
      </ViewButton>
      <ViewButton label={uiCopy.display.fullscreen} onClick={viewFullscreen}>
        <Glyph icon={PREVIEW_GLYPH} size={15} />
      </ViewButton>
    </div>
  );
}

/** One of the cluster's icon controls. The control set's `ControlTooltip` is
 *  the one owner of the name/tooltip pairing, as it is for the dock's actions.
 *
 *  `fitted` is omitted rather than `false` on the two stepping commands: it is
 *  the fitted camera's mark, and they hold no such state. */
function ViewButton({
  label,
  fitted,
  onClick,
  children,
}: {
  readonly label: string;
  readonly fitted?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <ControlTooltip label={label}>
      <button
        type="button"
        className="editor-shell-view-step"
        aria-label={label}
        data-fitted={fitted}
        onClick={onClick}
      >
        {children}
      </button>
    </ControlTooltip>
  );
}

/** One preview, named by the aspect it frames. **The id is the name**: the
 *  catalogue is the author's, so a lens the vocabulary has never held still has
 *  a name — the ratio it is — and there is no second table to drift from it. */
function lensItem(lens: DisplayLens): React.JSX.Element {
  return (
    <Menu.RadioItem
      key={lens.id}
      value={lens.id}
      closeOnClick
      aria-label={lens.id}
    >
      <Menu.RadioItemIndicator className="editor-shell-menu-tick" keepMounted>
        {"•"}
      </Menu.RadioItemIndicator>
      {lens.id}
    </Menu.RadioItem>
  );
}
