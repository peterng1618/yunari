// @vitest-environment jsdom

import type { AssetSourceListing } from "@yunari/renderer-core";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { FinderFilters, FinderSourceChips } from "./finder-toolbar.js";

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

const props = {
  active: "local",
  local: true,
  fontFilter: { kind: "all", sort: "name" },
  onFontFilterChange: () => {},
  localKind: "all",
  onLocalKindChange: () => {},
  localSort: "name",
  onLocalSortChange: () => {},
  localDirection: "asc",
  onLocalDirectionChange: () => {},
  kinds: [],
  presetFilter: "all",
  onPresetFilterChange: () => {},
} as const;

const sortButton = (sort: string): HTMLButtonElement =>
  document.querySelector<HTMLButtonElement>(
    `[data-yunari-wallpaper-engine-sort="${sort}"]`,
  )!;

it("shows the order on the pressed sort and toggles it on a second press", () => {
  const onDirection = vi.fn();
  mount(<FinderFilters {...props} onLocalDirectionChange={onDirection} />);

  // The active button carries the arrow and the words a screen reader needs;
  // the other two say only their field.
  expect(sortButton("name").querySelector("svg")).not.toBeNull();
  // The arrow sits in a non-shrinking box: the sort buttons sharing the row's
  // width used to shrink it to zero on the longer labels.
  expect(
    sortButton("name").querySelector("svg")?.parentElement?.classList,
  ).toContain("flex-none");
  // And the label does not wrap into a second line for its share of the row.
  expect(sortButton("name").classList).toContain("whitespace-nowrap");
  expect(sortButton("name").getAttribute("aria-label")).toBe("Name, Ascending");
  expect(sortButton("size").querySelector("svg")).toBeNull();
  expect(sortButton("size").getAttribute("aria-label")).toBeNull();
  // The order is not a second row of its own any more.
  expect(
    document.querySelector("[data-yunari-wallpaper-engine-direction]"),
  ).toBeNull();

  act(() => {
    sortButton("name").click();
  });
  expect(onDirection).toHaveBeenCalledWith("desc");
});

it("chooses a new field without touching the order", () => {
  const onSort = vi.fn();
  const onDirection = vi.fn();
  mount(
    <FinderFilters
      {...props}
      onLocalSortChange={onSort}
      onLocalDirectionChange={onDirection}
    />,
  );

  act(() => {
    sortButton("size").click();
  });
  expect(onSort).toHaveBeenCalledWith("size");
  expect(onDirection).not.toHaveBeenCalled();
});

it("keeps a built-in source's chip in the on ink although it cannot be turned off", () => {
  const curated: AssetSourceListing = {
    id: "curated-fonts",
    label: "Curated fonts",
    category: "font",
    body: "font-picker",
    requires: null,
    configurable: false,
    presetKind: null,
    host: null,
  };
  mount(
    <FinderSourceChips
      sources={[curated]}
      disabled={new Set()}
      failures={new Map()}
      onToggle={() => {}}
    />,
  );

  const chip = document.querySelector<HTMLButtonElement>(
    '[data-yunari-asset-chip="curated-fonts"]',
  );
  expect(chip?.disabled).toBe(true);
  expect(chip?.classList).toContain("text-accent");
  expect(chip?.classList).not.toContain("text-faint");
});
