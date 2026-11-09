// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  DEFAULT_PREVIEW_RATIO_TOKENS,
  setActivePreviewRatios,
} from "../display-lens.js";
import { uiCopy } from "../ui-copy.js";
import type { ViewportManager } from "../viewport-manager/index.js";
import { ZOOM_STEP } from "../viewport-manager/navigation.js";
import { DisplaySwitch } from "./display-switch.js";

/**
 * Every root this file renders, unmounted after each test.
 *
 * Base UI portals the popup to `document.body` and `keepMounted` keeps it
 * there, so a root left mounted leaves its menu in the document and the next
 * test's `querySelector` finds *that* one first — which reads as a control
 * ignoring the choice it was given.
 */
const mounted: Root[] = [];
afterEach(async () => {
  while (mounted.length > 0) {
    const root = mounted.pop();
    if (root !== undefined) await act(async () => root.unmount());
  }
  // The catalogue is module state: a test that narrows it would otherwise hand
  // the next test a menu holding one lens.
  setActivePreviewRatios(DEFAULT_PREVIEW_RATIO_TOKENS);
});

function setup(display: string | undefined = "19.5:9") {
  const showDisplay = vi.fn();
  const zoomBy = vi.fn();
  const zoomToFit = vi.fn();
  const toggleFit = vi.fn();
  const zoomToSelection = vi.fn();
  const reset = vi.fn();
  const listeners = new Set<() => void>();
  let zoom = 0.5;
  // The camera's own fit predicate, held separately from the lens because it is:
  // `reset` clears the lens and leaves the camera at 1:1, which is a camera
  // state no display describes.
  let isFitted = false;
  // A stub with every ViewportManager member and no `as never`: the cast would
  // erase a missing member, which is exactly the defect to catch.
  const viewport = {
    zoom: () => zoom,
    zoomToPoint: vi.fn(),
    zoomBy,
    zoomToFit,
    toggleFit,
    zoomToSelection,
    reset,
    panBy: vi.fn(),
    artboardScreenRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    display: () => display,
    showDisplay,
    displayShape: () => undefined,
    displayScreenRect: () => undefined,
    isFitted: () => isFitted,
    resize: vi.fn(),
    onChange: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy: vi.fn(),
  } satisfies ViewportManager;

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted.push(root);
  return {
    host,
    viewport,
    showDisplay,
    zoomBy,
    zoomToFit,
    toggleFit,
    zoomToSelection,
    reset,
    render: (playback?: ReactNode) =>
      act(async () =>
        root.render(<DisplaySwitch viewport={viewport} playback={playback} />),
      ),
    setZoom(value: number): Promise<void> {
      return act(async () => {
        zoom = value;
        for (const listener of listeners) listener();
      });
    },
    setDisplay(value: string | undefined): Promise<void> {
      return act(async () => {
        display = value;
        for (const listener of listeners) listener();
      });
    },
    setFitted(value: boolean): Promise<void> {
      return act(async () => {
        isFitted = value;
        for (const listener of listeners) listener();
      });
    },
  };
}

/** Base UI portals the popup to `body`, so the item is not under `host`;
 *  `keepMounted` keeps it in the document while the menu is closed. */
async function choose(label: string): Promise<void> {
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)
      ?.click(),
  );
}

/** The recut, measured where it is observable: the stage now shows one view
 *  cluster, and the percentage readout sits **inside** it rather than **being**
 *  it. That is not cosmetic — `shell-appearance.spec.ts` reads the cluster's
 *  `boxShadow` and `backgroundImage` per palette, and jsdom has no cascade, so
 *  the class has to land on the element that carries the treatment.
 *
 *  The cluster's camera commands are `Zoom to fit`, `Zoom to selection`,
 *  `Zoom to 100 %` and fullscreen, beside the readout rather than inside the
 *  lens radio group: a fit is not a lens, and the group holds only windows. */
it("keeps every choice reachable, inside one view cluster", async () => {
  const { host, render, showDisplay, zoomToSelection, reset } = setup();
  await render();
  expect(
    host.querySelectorAll(".editor-shell-zoom").length,
    "one view cluster, not a bare readout",
  ).toBe(1);
  expect(
    host
      .querySelector(".editor-shell-zoom")
      ?.querySelector("[data-yunari-zoom]"),
    "and the readout sits inside it",
  ).not.toBeNull();

  for (const label of [
    "19.5:9",
    "16:9",
    "4:3",
    "1:1",
    "Circle",
    "9:19.5",
    "9:16",
    "3:4",
    uiCopy.display.zoomToFit,
    uiCopy.display.toSelection,
    uiCopy.display.actualSize,
    uiCopy.display.fullscreen,
  ]) {
    expect(
      document.querySelector(`[aria-label="${label}"]`),
      `${label} is offered`,
    ).not.toBeNull();
  }
  expect(
    host.querySelector("[data-yunari-zoom]")?.textContent,
    "and the percentage readout",
  ).toMatch(/^\d+%$/);

  await choose("9:19.5");
  expect(showDisplay).toHaveBeenLastCalledWith("9:19.5");
  await choose(uiCopy.display.toSelection);
  expect(zoomToSelection).toHaveBeenCalled();
  await choose(uiCopy.display.actualSize);
  expect(reset).toHaveBeenCalled();
});

/** The camera commands the top-right row names, beside the readout and not
 *  instead of it. `−` and `+` step by the keys' own `ZOOM_STEP` — read from its
 *  one owner rather than restated, because two literals would be two answers to
 *  "what is one step" and the mouse and the keyboard would drift apart. */
it("offers the camera's −, +, fit and fullscreen beside the readout, stepping by the keys' amount", async () => {
  const { host, render, zoomBy, toggleFit } = setup();
  await render();

  const click = (label: string): Promise<void> =>
    act(async () => {
      host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)?.click();
    });

  await click(uiCopy.display.zoomOut);
  expect(zoomBy).toHaveBeenLastCalledWith(1 / ZOOM_STEP);
  await click(uiCopy.display.zoomIn);
  expect(zoomBy).toHaveBeenLastCalledWith(ZOOM_STEP);
  await click(uiCopy.display.zoomToFit);
  expect(toggleFit).toHaveBeenCalled();

  // Siblings of the readout, which keeps the display chooser and the scale: the
  // cluster is one row of controls, not a control that replaced the readout.
  const cluster = host.querySelector(".editor-shell-zoom");
  for (const label of [
    uiCopy.display.zoomOut,
    uiCopy.display.zoomIn,
    uiCopy.display.zoomToFit,
    uiCopy.display.fullscreen,
  ]) {
    expect(
      cluster?.querySelector(`[aria-label="${label}"]`),
      `${label} is in the cluster`,
    ).not.toBeNull();
  }
  expect(
    cluster?.querySelector("[data-yunari-zoom]"),
    "and the readout is still there",
  ).not.toBeNull();
});

it("asks the browser for fullscreen on the stage, from the cluster and the menu", async () => {
  const request = vi.fn().mockResolvedValue(undefined);
  const stage = document.createElement("main");
  stage.className = "editor-shell-stage";
  document.body.append(stage);
  Object.defineProperty(stage, "requestFullscreen", {
    configurable: true,
    value: request,
  });
  try {
    const { render } = setup();
    await render();

    await choose(uiCopy.display.fullscreen);
    expect(request).toHaveBeenCalledTimes(1);
    const cluster = document.querySelector(".editor-shell-zoom");
    await act(async () => {
      cluster
        ?.querySelector<HTMLButtonElement>(
          `[aria-label="${uiCopy.display.fullscreen}"]`,
        )
        ?.click();
    });
    expect(
      request,
      "fullscreen is the canvas, not the editor chrome",
    ).toHaveBeenCalledTimes(2);
  } finally {
    stage.remove();
  }
});

/** The browser is the state, and Esc is a way out of it this app never sees
 *  as a click: the control reads `fullscreenElement` and listens for the
 *  change rather than remembering what its own last press asked for. */
it("reflects the live fullscreen state and leaves it on a second press", async () => {
  const request = vi.fn().mockResolvedValue(undefined);
  const exit = vi.fn().mockResolvedValue(undefined);
  const stage = document.createElement("main");
  stage.className = "editor-shell-stage";
  document.body.append(stage);
  let fullscreen: Element | null = null;
  Object.defineProperty(stage, "requestFullscreen", {
    configurable: true,
    value: request,
  });
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: exit,
  });
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreen,
  });
  try {
    const { host, render } = setup();
    await render();

    const clusterButton = (): HTMLButtonElement | null =>
      host.querySelector<HTMLButtonElement>(
        `[aria-label="${uiCopy.display.fullscreen}"]`,
      );
    const menuItem = (): Element | null =>
      document.querySelector(
        `[role="menuitemcheckbox"][aria-label="${uiCopy.display.fullscreen}"]`,
      );

    expect(clusterButton()?.getAttribute("aria-pressed")).toBe("false");
    expect(menuItem()?.getAttribute("aria-checked")).toBe("false");

    await act(async () =>
      menuItem()?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(request, "the menu's item enters fullscreen").toHaveBeenCalledTimes(
      1,
    );

    fullscreen = stage;
    await act(async () =>
      document.dispatchEvent(new Event("fullscreenchange")),
    );
    expect(
      clusterButton()?.getAttribute("aria-pressed"),
      "the cluster says the stage is fullscreen",
    ).toBe("true");
    expect(
      menuItem()?.getAttribute("aria-checked"),
      "and so does the menu's tick",
    ).toBe("true");

    await act(async () => clusterButton()?.click());
    expect(exit, "a second press leaves fullscreen").toHaveBeenCalledTimes(1);
    expect(request, "it does not ask to enter again").toHaveBeenCalledTimes(1);

    fullscreen = null;
    await act(async () =>
      document.dispatchEvent(new Event("fullscreenchange")),
    );
    expect(clusterButton()?.getAttribute("aria-pressed")).toBe("false");
  } finally {
    stage.remove();
    Reflect.deleteProperty(document, "exitFullscreen");
    Reflect.deleteProperty(document, "fullscreenElement");
  }
});

/** Fit says whether the camera is fitted, off the same `isFitted()` the camera
 *  owns. A lens chosen and then moved off the fit is the state this separates:
 *  the lens is still chosen, and the camera is not where a fit would put it.
 *
 *  The mark is `data-fitted`, not `aria-pressed`: the press toggles back to the
 *  previous camera, but the control's lit state is "the camera is a fit", and
 *  `aria-pressed` would announce a two-position switch whose off state is not
 *  "unpressed fit" but whatever camera the author had before. */
it("marks fit from the camera, so a lens that is not fitted is not marked", async () => {
  const { host, render, setFitted } = setup("16:9");
  await render();

  const mark = (): string | null | undefined =>
    host
      .querySelector(`[aria-label="${uiCopy.display.zoomToFit}"]`)
      ?.getAttribute("data-fitted");

  await setFitted(true);
  expect(mark(), "a fitted camera marks fit").toBe("true");
  await setFitted(false);
  expect(mark(), "and a camera moved off it does not").toBe("false");
  expect(
    host
      .querySelector(`[aria-label="${uiCopy.display.zoomToFit}"]`)
      ?.getAttribute("aria-pressed"),
    "and no aria-pressed is announced: the mark is the fitted camera",
  ).toBeNull();
});

it("keeps reading the camera's zoom, because that readout is not this task's to remove", async () => {
  const { host, render, setZoom, setDisplay } = setup("19.5:9");
  await render();
  // Not the display's name, under any choice: two browser tests pin this
  // control as the place the author reads the camera's scale, and a display is
  // chosen by default — so a name here would remove that capability on open.
  expect(host.querySelector("[data-yunari-zoom]")?.textContent).toBe("50%");

  await setZoom(2);
  expect(host.querySelector("[data-yunari-zoom]")?.textContent).toBe("200%");

  // A display is the lens, not the zoom: choosing one re-frames the camera
  // (measured in the viewport's own tests and in the browser), which is the
  // camera's business and not this label's.
  await setDisplay(undefined);
  expect(host.querySelector("[data-yunari-zoom]")?.textContent).toBe("200%");
});

it("offers every display and the camera commands, each one click away", async () => {
  const { render, showDisplay, zoomToSelection, reset } = setup();
  await render();

  for (const label of [
    "19.5:9",
    "16:9",
    "4:3",
    "1:1",
    "Circle",
    "9:19.5",
    "9:16",
    "3:4",
  ]) {
    expect(
      document.querySelector(`[aria-label="${label}"]`),
      `${label} is offered`,
    ).not.toBeNull();
  }

  await choose("9:19.5");
  // The id, not a boolean: an id the camera cannot resolve is a display that
  // silently did nothing, and `showDisplay` throws on an unknown one.
  expect(showDisplay).toHaveBeenCalledWith("9:19.5");

  await choose(uiCopy.display.toSelection);
  expect(zoomToSelection).toHaveBeenCalled();
  await choose(uiCopy.display.actualSize);
  expect(reset).toHaveBeenCalled();
});

it("marks the chosen display in the menu, so the trigger and the menu agree", async () => {
  const { render, setDisplay } = setup("16:9");
  await render();

  const checked = (label: string): boolean =>
    document
      .querySelector(`[aria-label="${label}"]`)
      ?.getAttribute("aria-checked") === "true";

  expect(checked("16:9"), "the chosen display is marked").toBe(true);
  expect(checked("19.5:9"), "and the others are not").toBe(false);

  await setDisplay(undefined);
  expect(checked("16:9"), "a cleared lens ticks nothing").toBe(false);
  expect(
    document.querySelector('[role="menuitemradio"][aria-checked="true"]'),
  ).toBeNull();
});

/** A lens is a window, and the tick is a claim about which one. A camera at
 *  100 % — no display, no fit — must not tick the nearest lens on its way
 *  through the list. */
it("ticks nothing when the camera is not looking through a lens", async () => {
  const { render, setDisplay } = setup();
  await render();

  const checked = (label: string): boolean =>
    document
      .querySelector(`[aria-label="${label}"]`)
      ?.getAttribute("aria-checked") === "true";

  await setDisplay(undefined);
  for (const label of ["19.5:9", "9:19.5", "16:9", "4:3"]) {
    expect(checked(label), `${label} is not it either`).toBe(false);
  }

  // A display still ticks under a lens even once the camera has moved within
  // it: the window is still the window, which is the fact this menu holds.
  await setDisplay("9:19.5");
  expect(checked("9:19.5")).toBe(true);
});

/** The gutter the label offset is measured against. Base UI unmounts an
 *  unchecked indicator unless `keepMounted` is set, so without it the
 *  indicator exists on exactly one item and every other label sits a gutter
 *  to the left. Asserted on the DOM here because jsdom has no layout; the
 *  measured pixel offset is in `tests/e2e/editor-display.spec.ts`. */
it("gives every item its tick slot, ticked or not, so the labels cannot shift", async () => {
  const { render, setDisplay } = setup("16:9");
  await render();

  const tickCount = (label: string): number =>
    document
      .querySelector(`[aria-label="${label}"]`)
      ?.querySelectorAll(".editor-shell-menu-tick").length ?? 0;

  expect(tickCount("16:9"), "the ticked item").toBe(1);
  expect(tickCount("19.5:9"), "an unticked one has the slot too").toBe(1);
  expect(tickCount("1:1")).toBe(1);

  // The slot survives the tick moving, which is the whole claim.
  await setDisplay(undefined);
  expect(tickCount("16:9")).toBe(1);
  expect(tickCount("19.5:9")).toBe(1);
});

/** The previews are three labelled groups in a fixed order — landscape widest
 *  first, then 1:1 and Circle, then portrait near square first — so the list
 *  does not reorder itself under the document being edited. */
it("groups the previews landscape, 1:1, portrait, whichever way up the artboard is", async () => {
  const { render } = setup("16:9");
  await render();

  expect(groupLabels(), "the three headings, in order").toEqual([
    "Landscape",
    "1:1",
    "Portrait",
  ]);
  expect(menuLabels(), "and the lenses in their groups").toEqual([
    "19.5:9",
    "16:9",
    "4:3",
    "1:1",
    "Circle",
    "3:4",
    "9:16",
    "9:19.5",
  ]);
});

/** The menu is one catalogue, not a second copy of the defaults: a lens added
 *  by the settings tab is offered, a lens removed is gone, and an empty list
 *  offers the camera commands and nothing else — no group heading over no
 *  lenses. */
it("offers the active catalogue, and no lens when it is empty", async () => {
  setActivePreviewRatios(["Circle", "1:1"]);
  const { render } = setup("1:1");
  await render();

  expect(menuLabels(), "the active catalogue, 1:1 first").toEqual([
    "1:1",
    "Circle",
  ]);
  expect(groupLabels(), "one 1:1 group for the square and the disc").toEqual([
    "1:1",
  ]);

  await act(async () => setActivePreviewRatios([]));
  expect(menuLabels(), "an empty catalogue leaves no lens").toEqual([]);
  expect(groupLabels(), "and no empty group is headed").toEqual([]);
});

/** Every radio item's accessible name, in menu order. */
function menuLabels(): string[] {
  return [...document.querySelectorAll('[role="menuitemradio"]')].map(
    (item) => item.getAttribute("aria-label") ?? "",
  );
}

/** The menu's group headings, in the order they are painted. */
function groupLabels(): string[] {
  return [...document.querySelectorAll(".editor-shell-menu-label")].map(
    (label) => label.textContent ?? "",
  );
}

it("leads the view cluster with the backdrop's playback group", async () => {
  const { host, render } = setup();
  await render(<span data-testid="playback" />);

  const cluster = host.querySelector(".editor-shell-zoom");
  const playback = cluster?.querySelector('[data-testid="playback"]');
  expect(
    playback,
    "the playback group is outside the view cluster",
  ).not.toBeNull();
  // It leads the camera controls: no control comes before it in the cluster.
  expect(cluster?.firstElementChild).toBe(playback);
});
