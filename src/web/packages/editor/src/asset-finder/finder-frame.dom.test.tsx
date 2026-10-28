// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { ConnectionsButton } from "./finder-controls.js";
import { FinderFrame } from "./finder-frame.js";

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

function frame(element: ReactElement): ReactElement {
  return (
    <FinderFrame
      open
      onOpenChange={() => {}}
      label="Assets"
      closeLabel="Close"
      tabs={[
        { id: "icon", label: "Icons" },
        { id: "colour", label: "Colours" },
      ]}
      active="icon"
      onTabChange={() => {}}
      query=""
      searchPlaceholder="Search icons…"
      onQueryChange={() => {}}
      status="3 results"
      actions={<button type="button">Place</button>}
    >
      {element}
    </FinderFrame>
  );
}

it("draws the four regions in order and keeps one status line", () => {
  mount(frame(<div data-testid="content" />));
  const drawn = document.querySelector<HTMLElement>(
    "[data-yunari-asset-frame]",
  );
  const tabs = [...(drawn?.querySelectorAll("[data-yunari-asset-tab]") ?? [])];
  expect(tabs.map((tab) => tab.getAttribute("data-yunari-asset-tab"))).toEqual([
    "icon",
    "colour",
  ]);
  expect(drawn?.querySelector("[data-yunari-asset-search]")).not.toBeNull();
  expect(drawn?.querySelector("[data-yunari-asset-content]")).not.toBeNull();
  expect(drawn?.querySelector("[data-yunari-asset-status]")?.textContent).toBe(
    "3 results",
  );
  expect(
    drawn?.querySelector("[data-yunari-asset-actions]")?.textContent,
  ).toContain("Place");
  // One status line: the count lives in the footer, not beside the grid.
  expect(document.querySelectorAll("[data-yunari-asset-status]")).toHaveLength(
    1,
  );
});

it("shows no Connections control when every keyed source is working", () => {
  mount(
    <FinderFrame
      open
      onOpenChange={() => {}}
      label="Assets"
      closeLabel="Close"
      tabs={[{ id: "icon", label: "Icons" }]}
      active="icon"
      onTabChange={() => {}}
      tools={<ConnectionsButton needs={false} onOpen={(): void => {}} />}
    >
      <div />
    </FinderFrame>,
  );
  expect(document.querySelector('[aria-label="Connections"]')).toBeNull();
});

it("shows Connections when a keyed source is in trouble", () => {
  mount(
    <FinderFrame
      open
      onOpenChange={() => {}}
      label="Assets"
      closeLabel="Close"
      tabs={[{ id: "icon", label: "Icons" }]}
      active="icon"
      onTabChange={() => {}}
      tools={<ConnectionsButton needs onOpen={(): void => {}} />}
    >
      <div />
    </FinderFrame>,
  );
  expect(document.querySelector('[aria-label="Connections"]')).not.toBeNull();
});

it("draws no footer when there is neither a status nor an action", () => {
  mount(
    <FinderFrame
      open
      onOpenChange={() => {}}
      label="Assets"
      closeLabel="Close"
      tabs={[{ id: "font", label: "Fonts" }]}
      active="font"
      onTabChange={() => {}}
    >
      <div />
    </FinderFrame>,
  );
  expect(document.querySelector("[data-yunari-asset-footer]")).toBeNull();
  expect(document.querySelector("[data-yunari-asset-frame]")).not.toBeNull();
});
