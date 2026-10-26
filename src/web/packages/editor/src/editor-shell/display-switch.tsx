import { Menu } from "@base-ui/react/menu";
import {
  type ReactNode,
  useCallback,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  type ArtboardOrientation,
  type ArtboardSize,
  artboardOrientation,
} from "../artboard-presets.js";
import { useControlTooltip } from "../components/ui/control-icon-button.js";
import {
  type DisplayLens,
  displayLensGroups,
  previewCatalogueKey,
  subscribeLenses,
} from "../display-lens.js";
import { uiCopy } from "../ui-copy.js";
import type { ViewportManager } from "../viewport-manager/index.js";
import { ZOOM_STEP } from "../viewport-manager/navigation.js";
import { FIT_GLYPH, Glyph, MINUS_GLYPH, PLUS_GLYPH } from "./icons.js";

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

/** Which group of previews leads — the artboard's own orientation, read
 *  through the one predicate, as a primitive for the reason the three above
 *  are: an object here would re-render the control on every camera change.
 *
 *  The camera's change event is also how a new **artboard** announces itself:
 *  `setArtboard` refits, and a refit notifies. So this is a document fact
 *  arriving on the camera's channel, which is worth knowing before someone
 *  looks for a second subscription to add. */
function useArtboardOrientation(
  viewport: ViewportManager,
  artboard: () => ArtboardSize,
): ArtboardOrientation {
  const subscribe = useCallback(
    (listener: () => void) => viewport.onChange(listener),
    [viewport],
  );
  return useSyncExternalStore(subscribe, () => artboardOrientation(artboard()));
}

/** The catalogue is module state the settings tab writes; reading its revision
 *  subscribes this control, and the groups are then read from the same live
 *  list. A snapshot of the revision rather than the lenses keeps the identity
 *  stable, which is what `useSyncExternalStore` requires. */
function usePreviewCatalogue(): void {
  useSyncExternalStore(subscribeLenses, previewCatalogueKey);
}

/** The radio value standing for Fit — the whole stage, with no display in it. */
const NO_DISPLAY = "";

/** The radio value for a camera that is neither looking through a display nor
 *  fitted. No item carries it, so the menu ticks nothing rather than ticking
 *  the nearest thing: 100 % clears the display and is not a fit, and reporting
 *  it as Fit is the control asserting a framing the camera is not in. */
const NEITHER = "neither";

export function DisplaySwitch({
  viewport,
  artboard,
}: {
  readonly viewport: ViewportManager;
  /** The document's own size, so the group of previews that suits it leads. */
  readonly artboard: () => ArtboardSize;
}): React.JSX.Element {
  const zoom = useZoom(viewport);
  const display = useDisplay(viewport);
  const isFitted = useIsFitted(viewport);
  const orientation = useArtboardOrientation(viewport, artboard);
  usePreviewCatalogue();
  const groups = displayLensGroups(orientation);
  const percent = `${Math.round(zoom * 100)}%`;

  return (
    // §7.5's top-right corner, as one floating cluster. The readout is the
    // cluster's control and its own treatment lives on the cluster, so a reader
    // of the cluster's computed style (`shell-appearance.spec.ts`) sees the
    // surface the author sees. The chooser stays a portal, so the cluster holds
    // only what is drawn until it is opened.
    <div className="editor-shell-zoom editor-glass">
      {/* §7.5's camera commands, in DESIGN.md's order — − / value / +, and fit —
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
              {/* Fit and the catalogue's lenses are one radio group because
                they are one fact: what the stage looks through. Split into
                checkable and plain items, `Fit` could sit unselected while a
                lens stayed ticked — a menu holding two answers to one question.

                The tick is read off the camera, not off the display alone:
                `display()` answers "which window", and Fit is a camera
                position rather than a window, so a cleared lens with a manual
                zoom is neither and says nothing. */}
              <Menu.RadioGroup
                value={display ?? (isFitted ? NO_DISPLAY : NEITHER)}
                onValueChange={(value: string) =>
                  viewport.showDisplay(value === NO_DISPLAY ? undefined : value)
                }
              >
                <Menu.RadioItem
                  value={NO_DISPLAY}
                  closeOnClick
                  aria-label={uiCopy.display.fit}
                >
                  {/* `keepMounted` is what makes the gutter exist at all: the
                    indicator defaults to unmounted when its item is not the
                    checked one, so without it every label but the ticked one's
                    sits a gutter-width to the left. */}
                  <Menu.RadioItemIndicator
                    className="editor-shell-menu-tick"
                    keepMounted
                  >
                    {"•"}
                  </Menu.RadioItemIndicator>
                  {uiCopy.display.fit}
                </Menu.RadioItem>
                {/* Two labelled groups rather than six bare ratios: the author
                  has to see which of them is the way up their theme is before
                  they can tell any of them apart, and a portrait theme is
                  usually not looking for a landscape preview. */}
                {groups.map((group) => (
                  <Menu.Group key={group.orientation}>
                    <Menu.GroupLabel className="editor-shell-menu-label">
                      {uiCopy.artboardOrientations[group.orientation]}
                    </Menu.GroupLabel>
                    {group.lenses.map(lensItem)}
                  </Menu.Group>
                ))}
              </Menu.RadioGroup>
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
    </div>
  );
}

/** One of the cluster's icon controls. The tooltip is a DOM control, so React
 *  owns the button and the control set's `useControlTooltip` owns the popup —
 *  the split `canvas-dock.tsx` uses, for the same reason: the selection
 *  inspector builds the same popup without ever seeing React.
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
  const ref = useRef<HTMLButtonElement>(null);
  useControlTooltip(ref, label);
  return (
    <button
      ref={ref}
      type="button"
      className="editor-shell-view-step"
      aria-label={label}
      data-fitted={fitted}
      onClick={onClick}
    >
      {children}
    </button>
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
