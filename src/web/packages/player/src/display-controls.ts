import { uiCopy } from "./ui-copy.js";

/**
 * The controls a reader operates: fullscreen, keep-awake and a dimmer.
 *
 * Three controls and no settings modal — the user ruled the modal away on
 * 2026-10-18 (`vg-576`). They overlay: the bar and the dimmer are both
 * `position:fixed`, so the composition's box is the same with the bar up, with
 * it gone, and with the dimmer at any setting. A control in a chrome band would
 * take its room from the artboard and re-fit the scene, which moves the whole
 * picture (`vg-028`, measured; `chrome.ts`'s module comment carries the
 * numbers). Their styles are in `index.html`, beside the column that places the
 * bands, so this file is a script with no colours in it.
 *
 * **Two of the three can be refused, and saying so is the point.** The host
 * serves https beside http on the same port, from a certificate it issues
 * itself (`vg-580`), so the display is a secure context
 * at the https origin once that root is installed — and at the http origin, or
 * before the root is installed, the two APIs are gated on things a phone at
 * `http://<lan-ip>:<port>` does not have: the Screen Wake Lock API on a secure
 * context, and arbitrary-element fullscreen on a client that implemented it at
 * all — iPhone Safari never has, and Task 25.6's standalone mode is that
 * client's honest path instead. **`localhost` IS a secure context**, so a run on
 * the host machine sees the wake lock present and proves nothing about the phone
 * it is for. Each control is feature-detected at runtime, and one that cannot do
 * its job says why when it is pressed rather than sitting there doing nothing.
 *
 * The dimmer is an overlay over the rendered picture and is named as that. A
 * browser cannot set a device's panel brightness, and a control that claimed to
 * would be lying to the reader standing in front of it.
 *
 * Nothing here is persisted. A display's own dim setting is this page's, and a
 * reload is allowed to forget it; what a display *is* configured with belongs
 * to the host's per-display settings (`vg-574`), not to this file.
 */

/** How long the bar stays up after a tap or a keypress. Three seconds is the
 *  design presented to the user on 2026-10-17; keyboard focus holds it open
 *  past that (`hide`). */
const VISIBLE_MS = 3_000;

/** The dimmer's ceiling. Not 1: a display dimmed to nothing is a display
 *  showing nothing, and a reader who cannot see the control cannot undo it. */
const MAX_DIM = 0.85;

/** What `mountDisplayControls` hands back, so the display's own teardown can
 *  take the bar, the listeners and any wake lock this page is holding. */
export type DisplayControls = {
  dispose(): void;
};

/**
 * Puts the controls on the display and returns their teardown.
 *
 * Mounted with the rest of the display's chrome, once the scene exists — a
 * theme that never loaded gets the failure page, which has no display to
 * control.
 */
export function mountDisplayControls(): DisplayControls {
  const shade = document.createElement("div");
  shade.dataset["yunariDimmer"] = "";
  // No dimming until the reader asks for some, written by the same owner as
  // every later value (the slider's own handler).
  shade.style.opacity = "0";

  const bar = document.createElement("div");
  bar.dataset["yunariControls"] = "";
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", uiCopy.controls.group);
  // Hidden until a tap reveals it. Set here rather than in the stylesheet so
  // the shown and the hidden state are written by one owner (`reveal`, `hide`),
  // and the sheet carries only how the change looks.
  bar.style.opacity = "0";
  bar.style.pointerEvents = "none";

  const row = document.createElement("div");

  const say = document.createElement("p");
  say.dataset["yunariControlsSay"] = "";
  // A refusal is a sentence the reader asked for by pressing a control, so it
  // is announced and not only drawn.
  say.setAttribute("aria-live", "polite");

  const fullscreen = control(
    "yunariFullscreen",
    uiCopy.controls.fullscreen.label,
  );
  const awake = control("yunariKeepAwake", uiCopy.controls.keepAwake.label);

  const dim = document.createElement("input");
  dim.type = "range";
  dim.min = "0";
  dim.max = "100";
  dim.step = "5";
  // The track is the light level, not the overlay: right is brighter, which is
  // what a dimmer's own knob does and what a slider beside a picture is read as.
  // The overlay is the inverse of it, so the resting position is full light.
  dim.value = "100";
  dim.dataset["yunariDim"] = "";
  dim.setAttribute("aria-label", uiCopy.controls.dim.label);
  dim.addEventListener("input", () => {
    shade.style.opacity = String((1 - Number(dim.value) / 100) * MAX_DIM);
  });

  row.append(fullscreen, awake, dim);
  bar.append(row, say);
  document.body.append(shade, bar);

  let disposed = false;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  // ---- the bar's own lifetime ------------------------------------------

  function clearHide(): void {
    if (hideTimer === undefined) return;
    clearTimeout(hideTimer);
    hideTimer = undefined;
  }

  function armHide(): void {
    clearHide();
    hideTimer = setTimeout(() => {
      hideTimer = undefined;
      hide();
    }, VISIBLE_MS);
  }

  function hide(): void {
    // A keyboard reader is holding the bar open, and hiding it here would take
    // the control they are on out from under them.
    if (bar.contains(document.activeElement)) {
      armHide();
      return;
    }
    bar.style.opacity = "0";
    bar.style.pointerEvents = "none";
    say.textContent = "";
  }

  function reveal(): void {
    if (!live()) return;
    bar.style.opacity = "1";
    bar.style.pointerEvents = "auto";
    armHide();
  }

  /** Says why a control could not do its job, in the bar the reader is already
   *  looking at. Not a strip: `chrome.ts` owns those, and the availability
   *  notice's own three-state lifetime is not this module's to fight. */
  function explain(text: string): void {
    say.textContent = text;
    reveal();
  }

  /** Whether this bar is still on a display at all.
   *
   *  The load-failure page replaces the whole document without a teardown
   *  (`load-failure.ts`), so a bar that has left the document is one nothing is
   *  showing, and this is where its listeners go. */
  function live(): boolean {
    if (disposed) return false;
    if (bar.isConnected) return true;
    dispose();
    return false;
  }

  // ---- fullscreen ------------------------------------------------------

  /** An arbitrary element, which is the capability that is actually missing:
   *  iPhone Safari has no `Element.requestFullscreen` at all, while
   *  `document.fullscreenEnabled` is the permission half. */
  const canFullscreen =
    typeof document.documentElement.requestFullscreen === "function";
  // `aria-description` and not `aria-disabled`: this control is still operable,
  // and pressing it is how a reader gets the sentence. Marking it disabled
  // would say it does nothing, which is the one thing it must not be.
  if (!canFullscreen) {
    fullscreen.dataset["yunariUnavailable"] = "";
    fullscreen.setAttribute(
      "aria-description",
      uiCopy.controls.fullscreen.unavailable,
    );
  }

  /** `?? null` and not `=== null`: a client without the API leaves this
   *  property undefined rather than null, and the control has to read the same
   *  either way. */
  function inFullscreen(): boolean {
    return (document.fullscreenElement ?? null) !== null;
  }

  function paintFullscreen(): void {
    fullscreen.setAttribute("aria-pressed", inFullscreen() ? "true" : "false");
  }

  fullscreen.addEventListener("click", () => {
    if (!canFullscreen) {
      explain(uiCopy.controls.fullscreen.unavailable);
      return;
    }
    // One control toggles both ways: the reader is looking at the display, not
    // at a menu that could offer "enter" and "leave" separately.
    const entering = !inFullscreen();
    const moved = entering
      ? document.documentElement.requestFullscreen()
      : document.exitFullscreen();
    // A refusal (a policy, a gesture that did not survive the handler) leaves
    // the display exactly as it was, and the reader is told that rather than
    // left pressing a control that appears to do nothing.
    void moved.catch(() => explain(uiCopy.controls.fullscreen.refused));
  });
  document.addEventListener("fullscreenchange", paintFullscreen);

  // ---- keep-awake ------------------------------------------------------

  // Read off `navigator` rather than taken from the types: `lib.dom` declares
  // `Navigator.wakeLock` as always present, and the origin this display is
  // actually served from is the one place it is not.
  const wakeLock = (navigator as unknown as { readonly wakeLock?: WakeLock })
    .wakeLock;
  const canWake =
    wakeLock !== undefined && typeof wakeLock.request === "function";
  // Operable and explained, for the reason the fullscreen control is.
  if (!canWake) {
    awake.dataset["yunariUnavailable"] = "";
    awake.setAttribute(
      "aria-description",
      uiCopy.controls.keepAwake.unavailable,
    );
  }

  /** What the reader asked for. */
  let wantAwake = false;
  /** The lock this display actually holds — the only thing the control is
   *  allowed to report. */
  let held: WakeLockSentinel | undefined;

  function paintAwake(): void {
    if (!canWake) return;
    // **The lock this display holds, never the one it asked for.** `aria-pressed`
    // is read from `held` and not from `wantAwake`: a reader told "pressed" while
    // the browser holds nothing is being told something untrue, and that is the
    // case this control exists to be able to report — the page being hidden, or
    // the request simply refused.
    const holding = held !== undefined;
    awake.setAttribute("aria-pressed", holding ? "true" : "false");
    // Wanted and not held is the ordinary state this API produces, and it is
    // drawn apart from "off" so the reader can tell the two apart.
    if (wantAwake && !holding) awake.dataset["yunariWaiting"] = "";
    else delete awake.dataset["yunariWaiting"];
  }

  /** Requests the lock if the reader wants one and the page is on screen.
   *
   *  **A re-acquiring loop rather than a switch**, because that is what the API
   *  is: it releases the lock whenever the page is hidden, and re-requesting is
   *  the caller's own job. Every path that could leave this display without a
   *  lock the reader asked for comes back through here. */
  async function acquire(): Promise<void> {
    if (!wantAwake || held !== undefined || !canWake) {
      paintAwake();
      return;
    }
    if (document.visibilityState !== "visible") {
      paintAwake();
      return;
    }
    try {
      const lock = await wakeLock.request("screen");
      // Turned off, or hidden, while the request was in flight: the lock that
      // resolved is one nothing wants, and holding it would keep a phone awake
      // for a control the reader has already put back.
      if (!wantAwake || document.visibilityState !== "visible") {
        void lock.release();
        paintAwake();
        return;
      }
      held = lock;
      lock.addEventListener("release", () => {
        // The ordinary path, not an error: the browser released the lock when
        // the page was hidden, or the reader's own screen-off ended it.
        if (held === lock) held = undefined;
        paintAwake();
        void acquire();
      });
    } catch {
      // Refused — a browser policy, a battery saver, no user activation. No
      // lock, and the reader is told so: `paintAwake` alone would leave an
      // amber control with no sentence, which reads as "on" to assistive tech
      // and as nothing at all to anyone else.
      held = undefined;
      explain(uiCopy.controls.keepAwake.refused);
    }
    paintAwake();
  }

  awake.addEventListener("click", () => {
    if (!canWake) {
      explain(uiCopy.controls.keepAwake.unavailable);
      return;
    }
    wantAwake = !wantAwake;
    if (wantAwake) {
      void acquire();
    } else {
      const lock = held;
      held = undefined;
      if (lock !== undefined) void lock.release();
    }
    paintAwake();
  });

  function onVisibility(): void {
    // Back on screen and still wanted: this is the whole re-acquisition. A
    // hidden page is left alone — the request would be refused and the state
    // would flap.
    if (document.visibilityState === "visible") void acquire();
  }
  document.addEventListener("visibilitychange", onVisibility);

  // ---- the tap ---------------------------------------------------------

  // Captured rather than bubbled: the tap lands on the composition, and the
  // canvas is a live Fabric surface whose own handlers are not this module's to
  // depend on.
  window.addEventListener("pointerdown", reveal, {
    passive: true,
    capture: true,
  });
  // `opacity` and not `display`, so a keyboard can still reach a hidden bar:
  // the first control to take focus reveals it, and `hide` will not take it
  // away again while focus is inside.
  bar.addEventListener("focusin", reveal);
  bar.addEventListener("focusout", armHide);

  paintFullscreen();
  paintAwake();

  function dispose(): void {
    disposed = true;
    clearHide();
    window.removeEventListener("pointerdown", reveal, { capture: true });
    document.removeEventListener("fullscreenchange", paintFullscreen);
    document.removeEventListener("visibilitychange", onVisibility);
    // A discarded page must not keep a phone awake, and nothing else releases
    // this lock for us.
    const lock = held;
    held = undefined;
    wantAwake = false;
    if (lock !== undefined) void lock.release();
    shade.remove();
    bar.remove();
  }

  return { dispose };
}

function control(name: string, label: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.dataset[name] = "";
  element.textContent = label;
  return element;
}
