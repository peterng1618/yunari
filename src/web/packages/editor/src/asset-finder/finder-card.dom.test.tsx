// @vitest-environment jsdom
import type { AssetResult, FontCut } from "@yunari/renderer-core";
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

const cut = (family: string, weight: number): FontCut => ({
  id: `cut:${family.toLowerCase()}-${weight}`,
  source: "curated-fonts",
  family,
  weight,
  style: "normal",
  subset: "latin",
  format: "woff2",
  previewUrl: `https://cdn.example/${family}.woff2`,
  licence: "OFL-1.1",
  sourceUrl: `https://cdn.example/${family}.woff2`,
});

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

it("states a photo's own licence, which an icon library's uniform one need not", () => {
  mount(
    <FinderCard
      model={cardModelOf(imageResult, "Unsplash")}
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

  expect(
    document.querySelector("[data-yunari-asset-licence]")?.textContent,
  ).toBe("Unsplash");
  // One library's licence is the source's, not each icon's: it stays off the
  // card and off a hundred identical tiles.
  expect(cardModelOf(iconResult, "Lucide").licence).toBeUndefined();
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

it("names each trio row by that row's family, centred", () => {
  const trioResult: AssetResult = {
    id: "curated-fonts:trio:inter",
    name: "Inter / Poppins / Fira Code",
    kind: "font",
    preview: "",
    subtitle: "",
    licence: "OFL-1.1",
    sourceUrl: "",
    font: {
      cuts: [],
      trio: {
        id: "trio:inter",
        name: "Inter",
        description: "",
        roles: {
          heading: cut("Inter", 700),
          body: cut("Poppins", 400),
          mono: cut("Fira Code", 400),
        },
      },
    },
  };

  mount(
    <FinderCard
      model={cardModelOf(trioResult, "Curated fonts")}
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

  const rows = [
    ...document.querySelectorAll<HTMLElement>(
      '[data-yunari-asset-preview="font"] > span',
    ),
  ];
  expect(rows.map((row) => row.textContent)).toEqual([
    "Inter",
    "Poppins",
    "Fira Code",
  ]);
  expect(rows.every((row) => row.className.includes("text-center"))).toBe(true);
});
