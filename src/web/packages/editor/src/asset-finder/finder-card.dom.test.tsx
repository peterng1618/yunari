// @vitest-environment jsdom
import type { AssetResult } from "@yunari/renderer-core";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { cardModelOf, FinderCard } from "./finder-card.js";

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

const paletteResult: AssetResult = {
  id: "colorhunt:abc",
  name: "Midnight",
  kind: "palette",
  preview: "",
  subtitle: "50 likes",
  licence: "unknown",
  sourceUrl: "https://colorhunt.co/palette/abc",
  preset: {
    kind: "palette",
    colours: [
      "rgb(17, 34, 51)",
      "rgb(68, 85, 102)",
      "rgb(119, 136, 153)",
      "rgb(170, 187, 204)",
    ],
  },
};

const imageResult: AssetResult = {
  id: "unsplash:photo",
  name: "A photo",
  kind: "image",
  preview: "https://images.unsplash.com/photo-small",
  subtitle: "by Ada",
  licence: "Unsplash",
  sourceUrl: "https://unsplash.com/photos/photo",
};

const iconResult: AssetResult = {
  id: "lucide:house",
  name: "house",
  kind: "icon",
  preview: "data:image/svg+xml;base64,PHN2Zy8+",
  subtitle: "lucide",
  licence: "ISC",
  sourceUrl: "https://lucide.dev/icons/house",
};

it("draws a palette as vertical flex bars in catalogue order", () => {
  mount(
    <FinderCard
      model={cardModelOf(paletteResult, "ColorSwoop")}
      selected={false}
      busy={false}
      failed={false}
      done={false}
      tabStop
      onSelect={() => {}}
      onKeyDown={() => {}}
      focus={() => {}}
    />,
  );
  const bars = document.querySelectorAll("[data-yunari-swatch]");
  expect(bars).toHaveLength(4);
  expect([...bars].map((bar) => (bar as HTMLElement).style.background)).toEqual(
    [
      "rgb(17, 34, 51)",
      "rgb(68, 85, 102)",
      "rgb(119, 136, 153)",
      "rgb(170, 187, 204)",
    ],
  );
  expect(bars[0]?.parentElement?.className).toContain("flex");
  expect(bars[0]?.parentElement?.className).not.toContain("grid");
});

it("crops an image and marks the card selected", () => {
  mount(
    <FinderCard
      model={cardModelOf(imageResult, "Unsplash")}
      selected
      busy={false}
      failed={false}
      done={false}
      tabStop
      onSelect={() => {}}
      onPreview={() => {}}
      onKeyDown={() => {}}
      focus={() => {}}
    />,
  );
  const image = document.querySelector("img");
  expect(image?.className).toContain("object-cover");
  expect(image?.getAttribute("loading")).toBe("lazy");
  expect(
    document.querySelector("[data-yunari-finder-card-check]"),
  ).not.toBeNull();
  expect(
    document
      .querySelector("[data-yunari-finder-card]")
      ?.getAttribute("aria-selected"),
  ).toBe("true");
});

it("shows busy and failed marks without stealing the press", () => {
  const onSelect = vi.fn();
  mount(
    <FinderCard
      model={cardModelOf(iconResult, "Lucide")}
      selected={false}
      busy
      failed
      done={false}
      tabStop
      onSelect={onSelect}
      onKeyDown={() => {}}
      focus={() => {}}
    />,
  );
  expect(
    document.querySelector("[data-yunari-finder-card-busy]"),
  ).not.toBeNull();
  expect(
    document.querySelector("[data-yunari-finder-card-failed]"),
  ).not.toBeNull();
  const card = document.querySelector<HTMLElement>("[data-yunari-finder-card]");
  act(() => {
    card?.click();
  });
  expect(onSelect).toHaveBeenCalledOnce();
});

it("does not open a preview for a kind with no picture to enlarge", () => {
  const onPreview = vi.fn();
  mount(
    <FinderCard
      model={cardModelOf(iconResult, "Lucide")}
      selected={false}
      busy={false}
      failed={false}
      done={false}
      tabStop
      onSelect={() => {}}
      onPreview={onPreview}
      onKeyDown={() => {}}
      focus={() => {}}
    />,
  );
  const card = document.querySelector<HTMLElement>("[data-yunari-finder-card]");
  act(() => {
    card?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  });
  expect(onPreview).not.toHaveBeenCalled();
});

it("opens the preview for an image on a double press", () => {
  const onPreview = vi.fn();
  mount(
    <FinderCard
      model={cardModelOf(imageResult, "Unsplash")}
      selected={false}
      busy={false}
      failed={false}
      done={false}
      tabStop
      onSelect={() => {}}
      onPreview={onPreview}
      onKeyDown={() => {}}
      focus={() => {}}
    />,
  );
  const card = document.querySelector<HTMLElement>("[data-yunari-finder-card]");
  act(() => {
    card?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  });
  expect(onPreview).toHaveBeenCalledOnce();
});
