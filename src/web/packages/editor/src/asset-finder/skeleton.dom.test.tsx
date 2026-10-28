// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { uiCopy } from "../ui-copy.js";
import { FinderSkeleton } from "./skeleton.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(async () => {
  const mounted = root;
  root = undefined;
  await act(async () => {
    mounted?.unmount();
  });
  host?.remove();
  host = undefined;
  document.body.replaceChildren();
});

function mount(element: ReactElement): HTMLDivElement {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(element);
  });
  return host;
}

function focusables(region: HTMLElement): readonly Element[] {
  return [
    ...region.querySelectorAll(
      "button, input, select, textarea, a, summary, [tabindex], [contenteditable]",
    ),
  ];
}

it("draws card-shaped placeholders and says it is loading once", () => {
  const rendered = mount(<FinderSkeleton count={4} />);
  const region = rendered.querySelector<HTMLElement>(
    "[data-yunari-skeleton-grid]",
  );
  expect(
    region?.querySelectorAll("[data-yunari-skeleton-card]"),
  ).toHaveLength(4);
  expect(region?.querySelectorAll("[data-yunari-skeleton-line]")).toHaveLength(
    8,
  );
  const firstCard = region?.querySelector<HTMLElement>(
    "[data-yunari-skeleton-card]",
  );
  expect(firstCard?.firstElementChild?.className).toContain("aspect-[4/3]");
  expect(region?.getAttribute("aria-busy")).toBe("true");
  expect(region?.querySelectorAll(".sr-only")).toHaveLength(1);
  expect(region?.textContent).toBe(uiCopy.assets.skeletonLoading);
  expect(focusables(region ?? rendered)).toEqual([]);
});

it("pulses each shape and stops when the user prefers reduced motion", () => {
  const rendered = mount(<FinderSkeleton count={2} />);
  const shapes = [...rendered.querySelectorAll<HTMLElement>(".animate-pulse")];
  // One preview and two lines per card.
  expect(shapes).toHaveLength(6);
  for (const shape of shapes) {
    expect(shape.className).toContain("animate-pulse");
    expect(shape.className).toContain("motion-reduce:animate-none");
  }
});
