// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { FinderCardModel } from "./finder-card.js";
import { FinderGrid, moveInGrid } from "./finder-grid.js";

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
  vi.unstubAllGlobals();
});

function mount(element: ReactElement): void {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(element);
  });
}

function rerender(element: ReactElement): void {
  act(() => {
    root?.render(element);
  });
}

const model = (id: string, previewable = false): FinderCardModel => ({
  id,
  name: id,
  meta: "",
  licence: undefined,
  sourceId: "test",
  sourceLabel: "Test",
  preview: null,
  previewable,
});

const cards = [model("a"), model("b"), model("c", true)];

function grid(
  overrides: Partial<Parameters<typeof FinderGrid>[0]> = {},
): ReactElement {
  return (
    <FinderGrid
      label="Icons"
      cards={cards}
      selectedId={undefined}
      onSelect={() => {}}
      onPreview={() => {}}
      onApply={() => {}}
      onNeedMore={() => {}}
      canLoadMore={false}
      appending={false}
      {...overrides}
    />
  );
}

it("moves by one, by a row, and to either end, clamped", () => {
  expect(moveInGrid("ArrowRight", 1, 4, 10)).toBe(2);
  expect(moveInGrid("ArrowLeft", 1, 4, 10)).toBe(0);
  expect(moveInGrid("ArrowDown", 1, 4, 10)).toBe(5);
  expect(moveInGrid("ArrowUp", 1, 4, 10)).toBe(0);
  expect(moveInGrid("Home", 6, 4, 10)).toBe(0);
  expect(moveInGrid("End", 6, 4, 10)).toBe(9);
  expect(moveInGrid("ArrowRight", 9, 4, 10)).toBe(9);
  expect(moveInGrid("ArrowUp", 0, 4, 10)).toBe(0);
  expect(moveInGrid("Enter", 3, 4, 10)).toBe(3);
});

it("renders one listbox and one tab stop, and four skeletons while appending", () => {
  mount(grid());
  expect(document.querySelectorAll("[role=listbox]")).toHaveLength(1);
  expect(
    [...document.querySelectorAll("[data-yunari-finder-card]")].filter(
      (card) => card.getAttribute("tabindex") === "0",
    ),
  ).toHaveLength(1);
  expect(document.querySelectorAll("[data-yunari-skeleton-card]")).toHaveLength(
    0,
  );

  rerender(grid({ appending: true }));
  expect(document.querySelectorAll("[data-yunari-skeleton-card]")).toHaveLength(
    4,
  );
});

it("asks for more when the sentinel intersects", () => {
  const onNeedMore = vi.fn();
  class Observer {
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(): void {
      this.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    }
    disconnect(): void {}
    unobserve(): void {}
  }
  vi.stubGlobal("IntersectionObserver", Observer);

  mount(grid({ canLoadMore: true, onNeedMore }));
  expect(onNeedMore).toHaveBeenCalledOnce();
});

it("moves focus with the arrow keys and applies on Enter", () => {
  const onApply = vi.fn();
  mount(grid({ onApply }));

  const first = document.querySelector<HTMLElement>(
    '[data-yunari-finder-card="a"]',
  );
  act(() => {
    first?.focus();
    first?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
  });
  expect(document.activeElement?.getAttribute("data-yunari-finder-card")).toBe(
    "b",
  );

  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
  expect(onApply).toHaveBeenCalledWith(cards[1]);
});
