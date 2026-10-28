// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { FinderState } from "./finder-state.js";

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

function mount(element: ReactElement): void {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(element);
  });
}

it("renders a sentence and its action", () => {
  const onClick = vi.fn();
  mount(
    <FinderState
      message="No results."
      action={{ label: "Clear search", onClick }}
    />,
  );
  expect(document.querySelector("[data-yunari-asset-state]")?.textContent).toBe(
    "No results.Clear search",
  );
  act(() => {
    document
      .querySelector<HTMLButtonElement>("[data-yunari-asset-state-action]")
      ?.click();
  });
  expect(onClick).toHaveBeenCalledOnce();
});

it("renders a sentence alone when there is nothing to do", () => {
  mount(<FinderState message="That source did not answer." />);
  expect(document.querySelector("[data-yunari-asset-state]")?.textContent).toBe(
    "That source did not answer.",
  );
  expect(
    document.querySelector("[data-yunari-asset-state-action]"),
  ).toBeNull();
});
