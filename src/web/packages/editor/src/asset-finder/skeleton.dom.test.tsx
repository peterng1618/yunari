// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { uiCopy } from "../ui-copy.js";
import { CardGridSkeleton, TextSkeleton } from "./skeleton.js";

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
  return [...region.querySelectorAll("button, input, a, [tabindex]")];
}

it("draws card-shaped placeholders with one hidden sentence and no focusable element", () => {
  const rendered = mount(<CardGridSkeleton count={6} />);
  const region = rendered.querySelector<HTMLElement>(
    "[data-yunari-skeleton-grid]",
  );
  expect(region?.getAttribute("aria-busy")).toBe("true");
  expect(region?.querySelectorAll("[data-yunari-skeleton-card]")).toHaveLength(
    6,
  );

  // The shapes are decorative; exactly one sentence is read, and it is hidden.
  expect(region?.querySelectorAll(".sr-only")).toHaveLength(1);
  expect(region?.textContent).toBe(uiCopy.assets.skeletonLoading);
  expect(focusables(region ?? rendered)).toEqual([]);
});

it("pulses each card and stops when the user prefers reduced motion", () => {
  const rendered = mount(<CardGridSkeleton count={2} />);
  const cards = [
    ...rendered.querySelectorAll<HTMLElement>("[data-yunari-skeleton-card]"),
  ];
  expect(cards).toHaveLength(2);
  for (const card of cards) {
    expect(card.className).toContain("animate-pulse");
    expect(card.className).toContain("motion-reduce:animate-none");
    expect(card.getAttribute("aria-hidden")).toBe("true");
  }
});

it("draws a text skeleton with one hidden sentence and no focusable element", () => {
  const rendered = mount(<TextSkeleton />);
  const region = rendered.querySelector<HTMLElement>(
    "[data-yunari-skeleton-text]",
  );
  expect(region?.getAttribute("aria-busy")).toBe("true");
  expect(region?.querySelectorAll("[data-yunari-skeleton-line]")).toHaveLength(
    3,
  );
  expect(region?.querySelectorAll(".sr-only")).toHaveLength(1);
  expect(region?.textContent).toBe(uiCopy.assets.skeletonLoading);
  expect(focusables(region ?? rendered)).toEqual([]);

  for (const line of region?.querySelectorAll<HTMLElement>(
    "[data-yunari-skeleton-line]",
  ) ?? []) {
    expect(line.className).toContain("animate-pulse");
    expect(line.className).toContain("motion-reduce:animate-none");
  }
});
