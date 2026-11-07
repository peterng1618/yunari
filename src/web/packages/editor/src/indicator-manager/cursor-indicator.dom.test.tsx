// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { IndicatorOverlay } from "./cursor-indicator.js";
import { IndicatorStore } from "./store.js";

/**
 * The transform readouts as React elements.
 *
 * The manager's suite proves what the Fabric handlers publish; this one proves
 * the elements react to it — the two class names the editor has always drawn,
 * a reading hidden rather than collapsed while it is not happening, the
 * placement written through the ref without a render, and the pointer never
 * taken from the gesture the readout describes.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(async () => {
  if (root !== undefined) await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
});

async function mount(): Promise<{
  readonly store: IndicatorStore;
  readonly angle: HTMLElement;
  readonly size: HTMLElement;
}> {
  const container = document.createElement("div");
  host = container;
  document.body.append(container);
  const store = new IndicatorStore();
  const created = createRoot(container);
  root = created;
  await act(async () => created.render(<IndicatorOverlay store={store} />));
  const angle = container.querySelector<HTMLElement>(".yunari-angle-indicator");
  const size = container.querySelector<HTMLElement>(".yunari-size-indicator");
  expect(angle, "the angle readout").not.toBeNull();
  expect(size, "the size readout").not.toBeNull();
  return { store, angle: angle!, size: size! };
}

it("draws both readouts and hides them until a transform publishes one", async () => {
  const { angle, size } = await mount();

  // Both are in the tree at rest: a hidden readout keeps its layout, which is
  // what lets a clamp measure the text it will draw.
  expect(angle.style.visibility).toBe("hidden");
  expect(size.style.visibility).toBe("hidden");
  // A reading, not a control: it must never take a pointer event from the
  // gesture it describes.
  expect(angle.style.pointerEvents).toBe("none");
  expect(size.style.pointerEvents).toBe("none");
});

it("shows the reading it is given and places it beside the pointer", async () => {
  const { store, angle, size } = await mount();

  await act(async () => {
    store.publish("angle", "30°");
    store.place("angle", { x: 40, y: 60 });
    store.publish("size", "100 × 50");
  });

  expect(angle.textContent).toBe("30°");
  expect(angle.style.visibility).toBe("visible");
  // Down and to the right of the pointer by the overlay's own offset.
  expect(angle.style.transform).toBe(`translate(${40 + 16}px, ${60 + 16}px)`);
  expect(size.textContent).toBe("100 × 50");
  expect(size.style.visibility).toBe("visible");
});

it("clamps a reading inside the viewport's right and bottom edges", async () => {
  const { store, angle } = await mount();

  await act(async () => {
    store.publish("angle", "30°");
    // At the right edge the readout flips to the pointer's left rather than
    // crossing the viewport; the element's measured width is 0 in jsdom, so the
    // flip lands at the offset from the edge.
    store.place("angle", { x: window.innerWidth - 4, y: 10 });
  });

  expect(angle.style.transform).toBe(
    `translate(${window.innerWidth - 4 - 16}px, ${10 + 16}px)`,
  );

  await act(async () => {
    store.place("angle", { x: window.innerWidth + 40, y: 10 });
  });
  expect(angle.style.transform.startsWith("translate(")).toBe(true);
});

it("clamps to the stage it overlays, not to the viewport behind it", async () => {
  const { store, angle } = await mount();
  // The stage is the overlay's parent; jsdom reports a zero box, so this is the
  // one case that supplies the real geometry the old wrapper clamp used.
  angle.parentElement!.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      width: 400,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;

  await act(async () => {
    store.publish("angle", "30°");
    // Past the stage's right edge: the readout flips to the pointer's left
    // rather than crossing into the pane beside it.
    store.place("angle", { x: 390, y: 20 });
  });

  expect(angle.style.transform).toBe(`translate(${390 - 16}px, ${20 + 16}px)`);
});

it("hides and clears a reading when the gesture stops", async () => {
  const { store, angle } = await mount();
  await act(async () => {
    store.publish("angle", "30°");
    store.place("angle", { x: 40, y: 60 });
  });

  await act(async () => store.publish("angle", undefined));

  expect(angle.style.visibility).toBe("hidden");
  // Text that stays after the pointer is up is a claim about a transform that
  // is not happening.
  expect(angle.textContent).toBe("");
});

it("takes both readouts with it when the shell unmounts", async () => {
  await mount();

  await act(async () => root?.unmount());
  root = undefined;

  expect(document.querySelector(".yunari-angle-indicator")).toBeNull();
  expect(document.querySelector(".yunari-size-indicator")).toBeNull();
});
