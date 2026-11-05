import type { LiveSourceStatus, SampleSource } from "@yunari/renderer-core";
import { availabilityNoticeText } from "./availability-notice.js";
import { uiCopy } from "./ui-copy.js";

/**
 * The display's own chrome: what a reader is told, and where it sits.
 *
 * One owner, so several strips cannot position themselves independently. A
 * strip that positions itself ad hoc (`top:0` or `bottom:0`) covers the
 * artboard whenever the artboard fills the viewport's height — which is the
 * landscape phone the editor frames by default, and any display whose artboard
 * matches its own aspect. Measured on the built player at 844x390: the crop
 * strip and the scaffold banner together cover the top and bottom 28.8px of a
 * 390px artboard, 14.8% of the authored composition.
 *
 * The bands are the strips' anchors (`index.html` is the column that places
 * them), but nothing is laid out in them: an empty band is zero tall, so a
 * display with nothing to say gets the whole viewport. Nothing here measures
 * anything: the browser lays the column out, and the scene's own
 * `ResizeObserver` (`main.ts`) refits to the box that is left. Nothing here
 * decides what a strip says either — the words and the colours are
 * `ui-copy.ts`'s.
 *
 * **Every strip overlays.** Taking room re-fits the scene, and a re-fit moves
 * the whole picture: measured on the built player at 1920×1080, a 29px strip
 * takes the artboard from 1051 to 1022 and moves the ink 16–25px, right when
 * the notice arrives and left when it leaves. A transport strip flashes on any
 * reconnect and the theme chooser hides and returns with the display controls,
 * so either in flow would move a dashboard nobody touched. A turned strip rides
 * the composition's edge (`setChromeFrame`) and the composition stays put.
 */

export type ChromeSide = "top" | "bottom";

/** Where the composition sits on the display, in viewport pixels. */
export interface ChromeFrame {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** Whole degrees clockwise, the composition's own angle. */
  readonly rotation: number;
}

/** The composition's frame, as the scene last fitted it. */
let frame: ChromeFrame | undefined;

/**
 * The box a strip rides: the composition's, so a turned display turns its
 * strips with it.
 *
 * **The screen has no edge at the composition's angle.** A quarter-turned board
 * is a narrow column on a landscape display, and a strip pinned to the screen's
 * top edge crossed it at right angles — the defect a reader reported. The scene
 * reports the frame after every fit, so a resize or a mounting angle reaches
 * the strips already up rather than only the next one raised.
 *
 * `undefined` is a scene that has not fitted yet (or a collapsed viewport); an
 * upright frame is the display's own edge, which is where a strip belongs.
 */
export function setChromeFrame(next: ChromeFrame | undefined): void {
  frame = next;
  for (const strip of document.querySelectorAll<HTMLElement>(
    "[data-yunari-chrome-strip]",
  )) {
    placeOverlay(
      strip,
      strip.dataset["yunariChromeSide"] === "bottom" ? "bottom" : "top",
    );
  }
}

/** Puts an overlay strip on the frame. Read right to left: a bottom strip goes
 *  up by its own height first, so its bottom edge — not its top — lands on the
 *  composition's.
 *
 *  **An upright composition keeps the display's edge.** Up there the screen is
 *  the frame a strip belongs to: it spans the display even where the board is
 *  letterboxed, which is the shape the built phone was measured against
 *  (`host-chrome.spec.ts`). A turned one has no screen edge at its angle, so it
 *  rides the board. */
function placeOverlay(strip: HTMLElement, side: ChromeSide): void {
  if (frame === undefined || frame.rotation % 360 === 0) {
    strip.style.position = "fixed";
    strip.style.left = "0";
    strip.style.right = "0";
    strip.style.top = side === "top" ? "0" : "";
    strip.style.bottom = side === "bottom" ? "0" : "";
    strip.style.width = "";
    strip.style.transform = "";
    return;
  }
  strip.style.position = "fixed";
  strip.style.left = `${frame.left}px`;
  strip.style.top = `${frame.top}px`;
  strip.style.right = "";
  strip.style.bottom = "";
  strip.style.width = `${frame.width}px`;
  // The width is the composition's, so the inset padding has to sit inside it.
  strip.style.boxSizing = "border-box";
  // The board plate's pivot: the composition's own top-left corner.
  strip.style.transformOrigin = "0 0";
  strip.style.transform =
    side === "top"
      ? `rotate(${frame.rotation}deg)`
      : `rotate(${frame.rotation}deg) translateY(${frame.height}px) translateY(-100%)`;
}

/** The band a strip belongs in.
 *
 *  Throws rather than creating one: the document declares both bands so the
 *  column is right before any script runs, and a document without them is one
 *  this renderer cannot draw into. That is the contract `main.ts` already has
 *  for `#artboard`. */
export function chromeBand(side: ChromeSide): HTMLElement {
  const band = document.querySelector<HTMLElement>(
    `[data-yunari-chrome="${side}"]`,
  );
  if (band === null) {
    throw new Error(`The display has no ${side} chrome band.`);
  }
  return band;
}

/**
 * Shows one strip, replacing the last one with the same id.
 *
 * Every caller here is re-said rather than said once: the availability strip is
 * rebuilt on every refresh cadence and the transport strip changes as the
 * connection moves. Replacing by id is what keeps one kind of notice one strip,
 * rather than each writer finding the old element, removing it and reusing it
 * in place.
 *
 * A strip is either a line of `text` or `children` a reader operates. The
 * theme chooser needs the second form, and it comes through here so the inset,
 * the font and the strip marker stay one construction rather than a second
 * hand-written copy of them.
 */
export function putStrip(
  input: {
    readonly side: ChromeSide;
    readonly id: string;
    readonly background: string;
    readonly color: string;
  } & ({ readonly text: string } | { readonly children: readonly Node[] }),
): HTMLElement {
  removeStrip(input.id);

  const strip = document.createElement("div");
  strip.id = input.id;
  strip.dataset["yunariChromeStrip"] = "";
  if ("text" in input) strip.textContent = input.text;
  else strip.append(...input.children);
  // Fixed to the display's edge rather than laid out in the band, so raising or
  // clearing the strip cannot re-fit the scene (see the module comment). The
  // `z-index` is what puts it over the artboard — the top band precedes
  // `#artboard` in `index.html`, and Fabric's wrapper is positioned, so without
  // one the canvas would paint over the strip.
  strip.style.cssText =
    `${stripInset(input.side)};text-align:center;` +
    `position:fixed;left:0;right:0;z-index:1;${input.side}:0;` +
    `background:${input.background};color:${input.color};` +
    "font:12px/1.4 ui-monospace,monospace;letter-spacing:0.02em";

  strip.dataset["yunariChromeSide"] = input.side;
  placeOverlay(strip, input.side);

  chromeBand(input.side).append(strip);
  return strip;
}

export function removeStrip(id: string): void {
  document.getElementById(id)?.remove();
}

/** How long the availability warning is up before it clears itself. Five
 *  seconds leaves time to read it without holding the strip up. It
 *  clears for every cause — an unplaceable sensor included — because a strip
 *  nobody can dismiss must never be the reason a theme cannot be used. The
 *  strip overlays, so clearing it is not a re-fit. */
const AVAILABILITY_VISIBLE_MS = 5_000;

/**
 * Whether the warning is up, and whether this failure has already been told.
 *
 * Module state rather than a caller's, because the caller is a repaint loop
 * running at the frame rate: it re-says the same warning every frame, so a
 * timer armed on each call would be pushed back forever and a strip rebuilt on
 * each call would flicker. `dismissed` is what makes "told once per failure"
 * survive that loop; the condition clearing is what ends it, so a sensor that
 * recovers and fails again is told again. Runtime chrome only, never persisted.
 */
type AvailabilityNoticeState = "idle" | "up" | "dismissed";

let availabilityNotice: AvailabilityNoticeState = "idle";
let availabilityTimer: ReturnType<typeof setTimeout> | undefined;

function clearAvailabilityTimer(): void {
  if (availabilityTimer === undefined) return;
  clearTimeout(availabilityTimer);
  availabilityTimer = undefined;
}

/**
 * Names the sensors this display cannot read, and why. Section 97 requires an
 * unavailable sensor to explain itself; without this the consumer sees empty
 * charts and no reason for them.
 *
 * Called on every refresh cadence, so it is idempotent by state rather than by
 * argument: the warning goes up once, clears itself five seconds later, and
 * stays down while the same sensors stay unreadable — a warning that came back
 * every frame is one nobody reads. The wording is `availabilityNoticeText`'s,
 * which groups by cause so a reason shared by several sensors is said once.
 */
export function showAvailabilityNotice(
  source: SampleSource,
  semanticKeys: readonly string[],
): void {
  const text = availabilityNoticeText(
    semanticKeys.map((key) => source.latest(key)),
  );

  if (text === undefined) {
    // Every requested sensor answers again: the warning is no longer owed, the
    // strip that may still be up is stale, and the next failure is a new one.
    clearAvailabilityTimer();
    availabilityNotice = "idle";
    removeStrip("yunari-availability");
    return;
  }

  // Up, or already told for this failure. Either way this cadence has nothing
  // to add — rebuilding here is what would keep the timer from ever firing.
  if (availabilityNotice !== "idle") return;

  const strip = putStrip({
    side: "top",
    id: "yunari-availability",
    text,
    background: "#3a2a00",
    color: "#ffce6a",
  });
  strip.dataset["yunariAvailability"] = "";
  availabilityNotice = "up";
  availabilityTimer = setTimeout(() => {
    availabilityTimer = undefined;
    availabilityNotice = "dismissed";
    removeStrip("yunari-availability");
  }, AVAILABILITY_VISIBLE_MS);
}

/** Shows non-live connection states; a healthy live display needs no badge. */
export function showConnectionState(
  status: LiveSourceStatus,
  keyCount: number,
  detail?: string,
): void {
  if (status === "live") {
    removeStrip("yunari-connection");
    return;
  }

  const refused = status === "refused";
  putStrip({
    side: "bottom",
    id: "yunari-connection",
    text: refused
      ? uiCopy.connection.refused(detail)
      : status === "connecting"
        ? uiCopy.connection.connecting(keyCount)
        : uiCopy.connection.reconnecting,
    background: refused ? "#4a0000" : "#003a4a",
    color: refused ? "#ff9a9a" : "#7fdce9",
  });
}

/**
 * The strip's own inset from the display's edge — on the strip, never on the
 * band.
 *
 * `index.html` sets `viewport-fit=cover` so the artboard reaches a notched
 * phone's edges, which puts the system's own bar over the top of the screen; a
 * strip under it is a strip nobody reads. Padding on the **band** would reserve
 * the notch's height on a display with nothing to say, which is the one thing
 * this layout must not do; the failure page already takes the same care for the
 * same reason (`load-failure.ts:113-116`).
 */
function stripInset(side: ChromeSide): string {
  const top = side === "top" ? "env(safe-area-inset-top)" : "0px";
  const bottom = side === "bottom" ? "env(safe-area-inset-bottom)" : "0px";
  return `padding: calc(6px + ${top}) 12px calc(6px + ${bottom})`;
}
