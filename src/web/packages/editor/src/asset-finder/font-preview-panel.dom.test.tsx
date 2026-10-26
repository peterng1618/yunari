// @vitest-environment jsdom
import type { AssetResult, FontCut, FontTrioInfo } from "@yunari/renderer-core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { TypePresets } from "../type-preset-manager/panel.js";
import { uiCopy } from "../ui-copy.js";
import {
  FontPreviewPanel,
  type FontResult,
  type FontRole,
} from "./font-preview-panel.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function cut(family: string, weight: number): FontCut {
  const slug = family.toLowerCase().replace(/\s+/g, "-");
  return {
    id: `cut:${slug}-${weight}`,
    source: "curated-fonts",
    family,
    weight,
    style: "normal",
    subset: "latin",
    format: "woff2",
    previewUrl: `https://cdn.example/${slug}-${weight}.woff2`,
    licence: "OFL-1.1",
    sourceUrl: `https://cdn.example/${slug}-${weight}.woff2`,
  };
}

const heading = cut("Manrope", 700);
const body = cut("IBM Plex Sans", 400);
const mono = cut("IBM Plex Mono", 400);

const trioCard: FontTrioInfo = {
  id: "trio:manrope",
  name: "Manrope · IBM Plex Sans",
  description: "A geometric sans over a technical body.",
  roles: { heading, body, mono },
};

const trio: AssetResult & { font: { cuts: FontCut[]; trio: FontTrioInfo } } = {
  id: "curated-fonts:trio:manrope",
  name: "Manrope · IBM Plex Sans",
  kind: "font",
  preview: "",
  subtitle: "A geometric sans over a technical body.",
  licence: "OFL-1.1",
  sourceUrl: heading.sourceUrl ?? "",
  font: { cuts: [heading, body, mono], trio: trioCard },
};

const family: AssetResult & { font: { cuts: FontCut[] } } = {
  id: "google-fonts:cut:manrope-400",
  name: "Manrope",
  kind: "font",
  preview: "",
  subtitle: "sans · 2 cuts",
  licence: "OFL-1.1",
  sourceUrl: heading.sourceUrl ?? "",
  font: { cuts: [cut("Manrope", 400), cut("Manrope", 700)] },
};

const starter: TypePresets = {
  clock108: {
    name: "Clock 108",
    value: { family: "Yaldevi", size: 108, weight: 300, trioRole: "heading" },
  },
  clock72: {
    name: "Clock 72",
    value: { family: "Yaldevi", size: 72, weight: 600, trioRole: "heading" },
  },
  body16: {
    name: "Body 16",
    value: {
      family: "Libre Franklin",
      size: 16,
      weight: 400,
      trioRole: "body",
    },
  },
  mono14: {
    name: "Mono 14",
    value: {
      family: "Spline Sans Mono",
      size: 14,
      weight: 400,
      trioRole: "mono",
    },
  },
};

const roleless: TypePresets = {
  plain: { name: "Plain", value: { family: "Segoe UI", size: 14 } },
};

let root: HTMLDivElement | undefined;
let container: Root | undefined;

afterEach(() => {
  container?.unmount();
  root?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "fonts");
});

function mount(element: React.ReactElement): void {
  root = document.createElement("div");
  document.body.append(root);
  container = createRoot(root);
  act(() => {
    container?.render(element);
  });
}

function rerender(element: React.ReactElement): void {
  act(() => {
    container?.render(element);
  });
}

/** jsdom has neither `FontFace` nor `document.fonts`, so a panel test that
 *  wants to see faces received and freed supplies both. */
function stubFonts(load: () => Promise<unknown> = async () => undefined) {
  const fonts = { add: vi.fn(), delete: vi.fn() };
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: fonts,
  });
  class FakeFontFace {
    readonly load = vi.fn(load);
    constructor(
      readonly family: string,
      readonly source: string,
      readonly descriptors: FontFaceDescriptors,
    ) {}
  }
  vi.stubGlobal("FontFace", FakeFontFace);
  return fonts;
}

function panel(props: {
  readonly selected: FontResult;
  readonly presets?: TypePresets;
  readonly onApplyTrio?: (value: FontTrioInfo) => void;
  readonly onAddTrioPresets?: (value: FontTrioInfo) => void;
  readonly onAddPreset?: (value: FontCut, role: FontRole) => void;
  readonly onApplyToSelected?: (value: FontCut) => void;
}): React.ReactElement {
  return (
    <FontPreviewPanel
      selected={props.selected}
      presets={props.presets ?? starter}
      onApplyTrio={props.onApplyTrio}
      onAddTrioPresets={props.onAddTrioPresets}
      onAddPreset={props.onAddPreset}
      onApplyToSelected={props.onApplyToSelected}
    />
  );
}

function specimenRoles(): readonly HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>(
      "[data-yunari-font-specimen-role]",
    ),
  ];
}

function button(selector: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(selector);
  if (found === null) throw new Error(`no ${selector}.`);
  return found;
}

it("renders heading, body and mono in the trio card", () => {
  mount(panel({ selected: trio }));

  expect(
    document.querySelector('[data-yunari-font-preview="trio"]'),
  ).not.toBeNull();
  expect(
    specimenRoles().map((node) =>
      node.getAttribute("data-yunari-font-specimen-role"),
    ),
  ).toEqual(["heading", "body", "mono"]);
  for (const node of specimenRoles()) {
    expect(node.textContent).toBe(uiCopy.assets.fontPreview.sampleDefault);
  }
  // No Apply button is drawn without its callback, so no reason explains one.
  expect(document.querySelector("[data-yunari-font-apply-reason]")).toBeNull();
});

it("edits the sample line and re-renders the card", () => {
  mount(panel({ selected: trio }));
  const input = document.querySelector<HTMLInputElement>(
    "[data-yunari-font-preview-sample]",
  );
  if (input === null) throw new Error("no sample input.");
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(input, "Ship it today");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  for (const node of specimenRoles()) {
    expect(node.textContent).toBe("Ship it today");
  }
});

it("names the apply scope and each before→after row", () => {
  const onApplyTrio = vi.fn();
  const onAddTrioPresets = vi.fn();
  mount(panel({ selected: trio, onApplyTrio, onAddTrioPresets }));

  expect(document.querySelector("[data-yunari-font-scope]")?.textContent).toBe(
    "Heading × 2 · Body × 1 · Mono × 1",
  );
  expect(
    document.querySelector('[data-yunari-font-change="heading"]')?.textContent,
  ).toBe("Clock 108 · 300 → Manrope 700");
  expect(
    document.querySelector('[data-yunari-font-change="body"]')?.textContent,
  ).toBe("Body 16 · 400 → IBM Plex Sans 400");
  expect(
    document.querySelector('[data-yunari-font-change="mono"]')?.textContent,
  ).toBe("Mono 14 · 400 → IBM Plex Mono 400");

  act(() => {
    button("[data-yunari-font-add-presets]").click();
  });
  act(() => {
    button("[data-yunari-font-trio-apply]").click();
  });
  expect(onAddTrioPresets).toHaveBeenCalledWith(trioCard);
  expect(onApplyTrio).toHaveBeenCalledWith(trioCard);
});

it("disables Apply to theme with a reason when no preset carries a role", () => {
  mount(
    panel({
      selected: trio,
      presets: roleless,
      onApplyTrio: () => {},
    }),
  );

  expect(button("[data-yunari-font-trio-apply]").disabled).toBe(true);
  expect(document.body.textContent).toContain(
    uiCopy.assets.fontPreview.rolelessReason,
  );
  expect(document.body.textContent).toContain(
    uiCopy.assets.fontPreview.willBeCreated,
  );
});

it("draws a family's cuts and a role choice defaulting to Body", () => {
  const onAddPreset = vi.fn();
  const onApplyToSelected = vi.fn();
  mount(panel({ selected: family, onAddPreset, onApplyToSelected }));

  const chips = [
    ...document.querySelectorAll<HTMLButtonElement>("[data-yunari-font-cut]"),
  ];
  expect(chips).toHaveLength(2);
  const role = document.querySelector<HTMLSelectElement>(
    "[data-yunari-font-role]",
  );
  expect(role?.value).toBe("body");

  act(() => {
    chips[1]?.click();
  });
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(role, "heading");
    role?.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(role?.value).toBe("heading");
  expect(document.body.textContent).toContain("Heading — Manrope · adds one");
  act(() => {
    button("[data-yunari-font-add-preset]").click();
  });
  act(() => {
    button("[data-yunari-font-apply]").click();
  });
  expect(onAddPreset).toHaveBeenCalledWith(family.font.cuts[1], "heading");
  expect(onApplyToSelected).toHaveBeenCalledWith(family.font.cuts[1]);
  expect(chips[1]?.getAttribute("aria-pressed")).toBe("true");
});

it("applies the face the family's id names, not the first cut listed", () => {
  // A family lists every weight × subset. Position 0 is often a subset with no
  // Latin glyphs, and adopting it left the author's text in the browser
  // fallback; the row's id names the lead face the host chose.
  const listed = family.font.cuts[0]!;
  const lead = family.font.cuts[1]!;
  const reordered = {
    ...family,
    // Search namespaces the row (`<source>:<entry id>`), so the id it carries
    // is the cut's own id behind the source prefix.
    id: `google-fonts:${lead.id}`,
    font: { cuts: [listed, lead] },
  };
  const onApplyToSelected = vi.fn();
  mount(panel({ selected: reordered, onApplyToSelected }));

  act(() => {
    button("[data-yunari-font-apply]").click();
  });

  expect(onApplyToSelected).toHaveBeenCalledWith(lead);
});

it("names the subset when cuts share a weight, rather than drawing three 400s", () => {
  // Water Brush publishes 400 in three subsets: labelled by weight alone the
  // chips read as a mistake, and the subset is the only difference there is.
  const subset = (name: string) => ({
    ...cut("Water Brush", 400),
    id: `cut:water-brush-${name}`,
    subset: name,
  });
  const shared = {
    ...family,
    font: {
      cuts: [subset("vietnamese"), subset("latin-ext"), subset("latin")],
    },
  };
  mount(panel({ selected: shared, onApplyToSelected: () => {} }));

  expect(
    [...document.querySelectorAll<HTMLElement>("[data-yunari-font-cut]")].map(
      (chip) => chip.textContent,
    ),
  ).toEqual(["400 · vietnamese", "400 · latin-ext", "400 · latin"]);
  // The chips are controls, not specimens: a face illegible at 10px must not
  // take the label with it.
  for (const chip of document.querySelectorAll<HTMLElement>(
    "[data-yunari-font-cut]",
  )) {
    expect(chip.style.fontFamily).toBe("");
  }
});

it("releases every face it added when the panel unmounts", () => {
  const fonts = stubFonts();

  mount(panel({ selected: trio }));
  expect(fonts.add).toHaveBeenCalledTimes(3);

  act(() => {
    container?.unmount();
  });
  expect(fonts.delete).toHaveBeenCalledTimes(3);
});

it("releases the previous selection's faces when the selection moves", () => {
  const fonts = stubFonts();

  mount(panel({ selected: trio }));
  expect(fonts.add).toHaveBeenCalledTimes(3);

  rerender(panel({ selected: family }));
  const released = fonts.delete.mock.calls.map((call) => call[0]);
  expect(released).toEqual(
    fonts.add.mock.calls.slice(0, 3).map((call) => call[0]),
  );
  expect(fonts.add).toHaveBeenCalledTimes(5);
});

it("keeps the card drawn when a specimen will not load", async () => {
  stubFonts(async () => {
    throw new Error("the provider is down");
  });

  mount(panel({ selected: trio }));
  await act(async () => {
    await Promise.resolve();
  });

  expect(specimenRoles()).toHaveLength(3);
  for (const node of specimenRoles()) {
    expect(node.textContent).toBe(uiCopy.assets.fontPreview.sampleDefault);
  }
});
