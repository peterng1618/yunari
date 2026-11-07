import { Tooltip } from "@base-ui/react/tooltip";
import {
  cloneElement,
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useState,
} from "react";

/**
 * The editor's one tooltip.
 *
 * Every caller is React, so the popup is React's: the trigger is handed to
 * Base UI's `Tooltip.Trigger`, which donates the behaviour this surface needs —
 * a popup portalled out of the trigger's stacking context (the surrounding
 * dialog's portal node inside a dialog, `document.body` otherwise), opened by
 * hover after a delay or by focus at once, dismissed by leaving, blurring,
 * Escape or a press elsewhere, and positioned with floating-ui so it is
 * measured at its final width before it is placed.
 *
 * **The layer lives on the positioner.** Base UI's positioner is the positioned,
 * body-level element; the popup inside it is a static child, so a `z-index`
 * declared on the popup would never apply. The class that raises the tooltip
 * above every dialog is `editor-shell-tooltip-positioner`.
 *
 * **The width is the popup's own.** `max-content` is declared here rather than
 * left to the content: a popup that sizes against the space from its static
 * position shrinks after it moves, and a reason that wraps to three lines then
 * lands on its own trigger, whose `pointerleave` dismisses it — a hover that
 * only ever opened on focus.
 */

/** Above the trigger, as the dock's `Positioner(side="top", sideOffset={8})`
    had it. */
const SIDE_OFFSET = 8;
/** Kept off the viewport edge, so a long reason in a side panel stays readable. */
const EDGE_MARGIN = 8;
/** Wide enough for a sentence about a shape, narrow enough not to cross the
    inspector. A popup with no bound measures to the width of the page. */
export const TOOLTIP_MAX_WIDTH = 280;
/**
 * Hover waits, focus does not: a delay is what stops a pointer crossing the
 * dock from flashing every label, and a keyboard user has already committed to
 * a control by focusing it.
 *
 * The wait is measured, not chosen: crossing the dock's 296px row of 26px
 * controls in the 0.4–1.6s a hand takes dwells at most 195ms on any one
 * control, and 220ms clears that floor with room for the run-to-run spread. The
 * rows this tooltip also hangs on are full width (`control-well.tsx` and
 * `setting-field.tsx` span a pane), so a pointer crosses one slower than it
 * crosses a 26px square — that is why the margin. A deliberate hover rests in
 * ~110ms and the shortest one driven held 400ms, so the label is up well inside
 * it, where 600ms showed no label at all.
 */
const HOVER_DELAY_MS = 220;

/** The close of the open tooltip, if any. Two at once would put two
    `.editor-shell-tooltip` elements in the document, which is a strict-mode
    violation for every locator that names the class. */
let openTooltip: (() => void) | undefined;

/**
 * One control's words, and the chord that runs the same thing when it has one.
 *
 * `children` is the trigger element itself: Base UI merges its own event and
 * ref props onto it, so the caller keeps its button, its handlers and its
 * `aria-label`. `aria-describedby` is merged rather than replaced — a control
 * that already describes itself by a refusal note keeps that description while
 * the tooltip is open.
 */
export function ControlTooltip({
  label,
  shortcut,
  children,
}: {
  readonly label: string;
  /** The chord this control's action answers to, when it has one. Omitted —
   *  not `undefined` — by every caller with no chord, because
   *  `exactOptionalPropertyTypes` is on.
   *
   *  Two forms of one chord, because the chip is a picture of a key and a
   *  screen reader reads the picture: `printed` is the platform's own mark
   *  (`⌘Z`) and shows, `spoken` is what it is called (`Command Z`) and is the
   *  chip's `aria-label`. A single string would have to be one or the other,
   *  and a tooltip that shows "Command Z" is not the tooltip the shell layout
   *  asked for. */
  readonly shortcut?:
    | { readonly printed: string; readonly spoken: string }
    | undefined;
  readonly children: ReactElement;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  // The popup's id is the description's target, so the trigger names the same
  // node the popup draws rather than a second, invisible copy.
  const popupId = `yunari-tooltip-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const close = useCallback((): void => setOpen(false), []);
  useEffect(
    () => () => {
      if (openTooltip === close) openTooltip = undefined;
    },
    [close],
  );

  const onOpenChange = useCallback(
    (next: boolean): void => {
      if (next) {
        openTooltip?.();
        openTooltip = close;
      } else if (openTooltip === close) {
        openTooltip = undefined;
      }
      setOpen(next);
    },
    [close],
  );

  const described = (children.props as { "aria-describedby"?: string })[
    "aria-describedby"
  ];
  const trigger = cloneElement(children, {
    "aria-describedby":
      [described, open ? popupId : undefined].filter(Boolean).join(" ") ||
      undefined,
  } as never);

  return (
    <Tooltip.Root open={open} onOpenChange={onOpenChange}>
      <Tooltip.Trigger delay={HOVER_DELAY_MS} render={trigger} />
      <Tooltip.Portal>
        <Tooltip.Positioner
          className="editor-shell-tooltip-positioner"
          side="top"
          sideOffset={SIDE_OFFSET}
          collisionPadding={EDGE_MARGIN}
        >
          <Tooltip.Popup
            id={popupId}
            role="tooltip"
            className="editor-shell-tooltip"
            style={{ width: "max-content", maxWidth: `${TOOLTIP_MAX_WIDTH}px` }}
          >
            <span>{label}</span>
            {/* One owner for what a popup contains: the words, and the key that
                runs the same thing. The chip is a `kbd` so a stylesheet can
                mark it without a class of its own, and so its text is what a
                reader selecting the popup copies — a chord is typed, not
                read. */}
            {shortcut === undefined ? null : (
              <kbd
                className="editor-shell-tooltip-key"
                aria-label={shortcut.spoken}
              >
                {shortcut.printed}
              </kbd>
            )}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
