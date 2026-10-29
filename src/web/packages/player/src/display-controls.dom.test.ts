// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DisplayControls,
  mountDisplayControls,
} from "./display-controls.js";
import { uiCopy } from "./ui-copy.js";

/**
 * The controls a reader operates on a phone display: fullscreen, keep-awake and
 * a dimmer (`vg-568`, `vg-576`).
 *
 * jsdom has none of the three APIs and applies none of the injected stylesheet,
 * so what is pinned here is the *decisions*: when the bar is up, what a control
 * reports, and what a reader is told when the client or the origin cannot
 * honour it. The composition's geometry under the bar and the real capabilities
 * of a real browser are the browser proof's (`tests/e2e/host-player.spec.ts`),
 * not this file's.
 */

const BAR = "[data-yunari-controls]";
const SHADE = "[data-yunari-dimmer]";
const SAY = "[data-yunari-controls-say]";
const FULLSCREEN = "[data-yunari-fullscreen]";
const AWAKE = "[data-yunari-keep-awake]";
const DIM = "[data-yunari-dim]";

let controls: DisplayControls | undefined;

function bar(): HTMLElement {
  return document.querySelector<HTMLElement>(BAR) as HTMLElement;
}

function part<T extends HTMLElement>(selector: string): T {
  return document.querySelector<T>(selector) as T;
}

function tap(): void {
  window.dispatchEvent(new Event("pointerdown"));
}

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  controls?.dispose();
  controls = undefined;
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "wakeLock");
  Reflect.deleteProperty(document, "fullscreenElement");
  Reflect.deleteProperty(document, "exitFullscreen");
  Reflect.deleteProperty(document.documentElement, "requestFullscreen");
  Reflect.deleteProperty(document, "visibilityState");
});

describe("the bar the reader reveals", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("shows nothing until the display is tapped, and hides itself after three seconds", () => {
    controls = mountDisplayControls();
    expect(bar().style.opacity).toBe("0");

    tap();
    expect(bar().style.opacity).toBe("1");

    vi.advanceTimersByTime(2_999);
    expect(bar().style.opacity).toBe("1");

    vi.advanceTimersByTime(1);
    expect(bar().style.opacity).toBe("0");
  });

  it("holds itself open while a keyboard reader is on it", () => {
    // The three-second hide is the design presented rather than a ruling, and
    // taking the control out from under a reader who reached it by Tab is the
    // case it must not do.
    controls = mountDisplayControls();
    tap();
    part<HTMLButtonElement>(FULLSCREEN).focus();

    vi.advanceTimersByTime(3_000);
    expect(bar().style.opacity).toBe("1");
    expect(document.activeElement).toBe(part(FULLSCREEN));

    part<HTMLButtonElement>(FULLSCREEN).blur();
    vi.advanceTimersByTime(3_000);
    expect(bar().style.opacity).toBe("0");
  });

  it("takes the bar away with the page", () => {
    controls = mountDisplayControls();
    controls.dispose();

    expect(document.querySelector(BAR)).toBeNull();
    expect(document.querySelector(SHADE)).toBeNull();
  });
});

describe("the fullscreen control", () => {
  /** A client that has the API — every desktop browser, and Android Chrome.
   *  It is defined on `documentElement` rather than stubbed as a module
   *  export, because `typeof requestFullscreen === "function"` on the element
   *  is the feature detection the module actually performs. */
  function withFullscreen(): { current: () => Element | null } {
    let element: Element | null = null;
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: () => {
        element = document.documentElement;
        document.dispatchEvent(new Event("fullscreenchange"));
        return Promise.resolve();
      },
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: () => {
        element = null;
        document.dispatchEvent(new Event("fullscreenchange"));
        return Promise.resolve();
      },
    });
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => element,
    });
    return { current: () => element };
  }

  it("enters and leaves on one control where the client supports it", async () => {
    const screen = withFullscreen();
    controls = mountDisplayControls();
    const button = part<HTMLButtonElement>(FULLSCREEN);
    expect(button.dataset["yunariUnavailable"]).toBeUndefined();

    button.click();
    await Promise.resolve();
    expect(screen.current()).toBe(document.documentElement);
    expect(button.getAttribute("aria-pressed")).toBe("true");

    button.click();
    await Promise.resolve();
    expect(screen.current()).toBeNull();
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("says why not where the client has no arbitrary-element fullscreen", () => {
    // iPhone Safari's shape: no `Element.requestFullscreen` at all. The
    // control is drawn as unavailable and explains itself when pressed, and the
    // sentence names the path that client does have (Task 25.6's standalone
    // mode) rather than leaving the reader with a control that does nothing.
    controls = mountDisplayControls();
    const button = part<HTMLButtonElement>(FULLSCREEN);
    expect(button.dataset["yunariUnavailable"]).toBeDefined();
    expect(button.getAttribute("aria-description")).toBe(
      uiCopy.controls.fullscreen.unavailable,
    );

    tap();
    button.click();

    expect(part(SAY).textContent).toBe(uiCopy.controls.fullscreen.unavailable);
    expect(uiCopy.controls.fullscreen.unavailable).toMatch(/home screen/);
  });

  it("tells the reader when the request itself was refused", async () => {
    withFullscreen();
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: () => Promise.reject(new Error("not allowed")),
    });
    controls = mountDisplayControls();

    part<HTMLButtonElement>(FULLSCREEN).click();
    await Promise.resolve();
    await Promise.resolve();

    expect(part(SAY).textContent).toBe(uiCopy.controls.fullscreen.refused);
  });
});

/** A `WakeLockSentinel` whose release this test fires by hand — the browser
 *  releases the lock when the page is hidden, and that is the ordinary path. */
type FakeSentinel = {
  readonly released: boolean;
  readonly release: () => Promise<void>;
  readonly addEventListener: (type: string, listener: () => void) => void;
  readonly fireRelease: () => void;
};

function fakeWakeLock(options: { readonly refuse?: boolean } = {}): {
  readonly request: ReturnType<typeof vi.fn>;
  readonly sentinels: FakeSentinel[];
} {
  const sentinels: FakeSentinel[] = [];
  const request = vi.fn(async () => {
    if (options.refuse === true) throw new Error("refused");
    const listeners: (() => void)[] = [];
    const state = { released: false };
    const sentinel: FakeSentinel = {
      get released() {
        return state.released;
      },
      release: async () => {
        state.released = true;
      },
      addEventListener: (_type, listener) => {
        listeners.push(listener);
      },
      fireRelease: () => {
        for (const listener of listeners) listener();
      },
    };
    sentinels.push(sentinel);
    return sentinel;
  });
  Object.defineProperty(navigator, "wakeLock", {
    configurable: true,
    value: { request },
  });
  return { request, sentinels };
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("the keep-awake control", () => {
  it("holds a lock, reports the lock it holds, and re-acquires across a hide and a show", async () => {
    const lock = fakeWakeLock();
    controls = mountDisplayControls();
    const button = part<HTMLButtonElement>(AWAKE);

    button.click();
    await vi.waitFor(() => expect(lock.request).toHaveBeenCalledTimes(1));
    expect(lock.request).toHaveBeenCalledWith("screen");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.dataset["yunariWaiting"]).toBeUndefined();

    // The API releases the lock whenever the page is hidden, and this is that
    // release. What must not survive it is a control claiming a lock it lost.
    setVisibility("hidden");
    lock.sentinels[0]?.fireRelease();
    expect(button.dataset["yunariWaiting"]).toBeDefined();
    // Holding nothing, and saying so: `aria-pressed` follows the lock, not the
    // reader's intent, which is what the whole control is about.
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(lock.request).toHaveBeenCalledTimes(1);

    // Back on screen and still wanted: the re-acquisition is the whole control.
    setVisibility("visible");
    await vi.waitFor(() => expect(lock.request).toHaveBeenCalledTimes(2));
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.dataset["yunariWaiting"]).toBeUndefined();
  });

  it("reports nothing held, and says why, when the browser refused the request", async () => {
    // **The API exists and the client said no.** Reachable on a secure origin —
    // headless Chromium answers `NotAllowedError` — and the case where the
    // control used to tell assistive tech something untrue: it read
    // `aria-pressed` from the reader's intent rather than from the lock it held,
    // so a reader was given "Awake, pressed" over an unlabelled amber.
    const lock = fakeWakeLock({ refuse: true });
    controls = mountDisplayControls();
    const button = part<HTMLButtonElement>(AWAKE);

    button.click();
    await vi.waitFor(() => expect(lock.request).toHaveBeenCalledTimes(1));

    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.dataset["yunariWaiting"]).toBeDefined();
    expect(part(SAY).textContent).toBe(uiCopy.controls.keepAwake.refused);
    expect(uiCopy.controls.keepAwake.refused).toMatch(/not being held/);
  });

  it("releases the lock when the reader turns it off, and when the page goes", async () => {
    const lock = fakeWakeLock();
    const handle = mountDisplayControls();
    const button = part<HTMLButtonElement>(AWAKE);

    button.click();
    await vi.waitFor(() => expect(lock.request).toHaveBeenCalledTimes(1));
    button.click();
    expect(lock.sentinels[0]?.released).toBe(true);
    expect(button.getAttribute("aria-pressed")).toBe("false");

    button.click();
    await vi.waitFor(() => expect(lock.request).toHaveBeenCalledTimes(2));
    handle.dispose();
    expect(lock.sentinels[1]?.released).toBe(true);
  });

  it("says why not where the origin has no wake lock, and names the origin", () => {
    // The shape a phone gets when it opens the address the console prints:
    // plain http on a LAN port, where `navigator.wakeLock` is absent. The host
    // serves https beside it on that port (`vg-580`),
    // and this is the other half of what the copy has to say. jsdom has no such
    // API either, which is why this is the default state in this file.
    controls = mountDisplayControls();
    const button = part<HTMLButtonElement>(AWAKE);
    expect(button.dataset["yunariUnavailable"]).toBeDefined();
    // Told, and still operable: `aria-disabled` here would say the control does
    // nothing, and explaining itself is what it does.
    expect(button.getAttribute("aria-disabled")).toBeNull();
    expect(button.getAttribute("aria-description")).toBe(
      uiCopy.controls.keepAwake.unavailable,
    );

    tap();
    button.click();

    expect(part(SAY).textContent).toBe(uiCopy.controls.keepAwake.unavailable);
    expect(uiCopy.controls.keepAwake.unavailable).toMatch(/secure origin/);
  });
});

describe("the dimmer", () => {
  it("dims the rendered picture with an overlay, and is named as that", () => {
    controls = mountDisplayControls();
    const shade = part<HTMLElement>(SHADE);
    const slider = part<HTMLInputElement>(DIM);

    expect(shade.style.opacity).toBe("0");

    // The track is the light level, so the resting position is the bright end
    // and dragging towards the near end is what shades the picture. The mapping
    // used to run the other way, and a reader who pushed the slider right got a
    // darker screen.
    expect(slider.value, "the resting position is full light").toBe("100");

    slider.value = "50";
    slider.dispatchEvent(new Event("input"));
    expect(Number(shade.style.opacity)).toBeCloseTo(0.425, 3);

    slider.value = "0";
    slider.dispatchEvent(new Event("input"));
    expect(
      Number(shade.style.opacity),
      "the near end is the dimmest",
    ).toBeCloseTo(0.85, 3);

    slider.value = "100";
    slider.dispatchEvent(new Event("input"));
    expect(Number(shade.style.opacity), "the far end is no overlay").toBe(0);

    // Never the device's own brightness: a browser cannot set that, and the
    // label says which one this is.
    expect(uiCopy.controls.dim.label).toMatch(/overlay/);
    expect(uiCopy.controls.dim.label).toMatch(
      /not the screen's own brightness/,
    );
  });

  it("persists nothing: every control here is this page's runtime state", async () => {
    const lock = fakeWakeLock();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    controls = mountDisplayControls();

    tap();
    part<HTMLButtonElement>(AWAKE).click();
    await vi.waitFor(() => expect(lock.request).toHaveBeenCalledTimes(1));
    const slider = part<HTMLInputElement>(DIM);
    slider.value = "60";
    slider.dispatchEvent(new Event("input"));

    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});
