// @vitest-environment jsdom
import type { AssetResult, FontCut, FontTrioInfo } from "@yunari/renderer-core";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TypeTokens } from "../type-preset-manager/panel.js";
import { uiCopy } from "../ui-copy.js";
import { assetBytesUrl } from "./client.js";
import {
  FontPreviewPanel,
  type FontResult,
  familyCutsOf,
} from "./font-preview-panel.js";
import type { FontPreviewState } from "./fonts.js";

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

const starter: TypeTokens = {
  heading: { family: "Yaldevi", weight: 300 },
  body: { family: "Libre Franklin", weight: 400 },
  mono: { family: "Spline Sans Mono", weight: 400 },
};

const roleless: TypeTokens = {
  plain: { family: "Segoe UI" },
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
  const faces: FakeFontFace[] = [];
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
    ) {
      faces.push(this);
    }
  }
  vi.stubGlobal("FontFace", FakeFontFace);
  return { fonts, faces };
}

const resting: FontPreviewState = {
  sample: uiCopy.assets.fontPreview.sampleDefault,
  cutId: undefined,
  role: "body",
};

function panel(props: {
  readonly selected: FontResult;
  readonly presets?: TypeTokens;
  readonly state?: FontPreviewState;
  readonly onChange?: (next: FontPreviewState) => void;
  readonly favorite?: { readonly on: boolean; readonly toggle: () => void };
}): React.ReactElement {
  return (
    <FontPreviewPanel
      selected={props.selected}
      presets={props.presets ?? starter}
      state={props.state ?? resting}
      {...(props.favorite === undefined ? {} : { favorite: props.favorite })}
      onChange={props.onChange ?? (() => {})}
    />
  );
}

/** The panel reports every change; this holds what it reported, so a case can
 *  type and see the card follow. */
function Editable(props: {
  readonly selected: FontResult;
  readonly presets?: TypeTokens;
}): React.ReactElement {
  const [state, setState] = useState(resting);
  return (
    <FontPreviewPanel
      selected={props.selected}
      presets={props.presets ?? starter}
      state={state}
      onChange={setState}
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
  mount(<Editable selected={trio} />);
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

it("draws the trio's favourite toggle and reports its press", () => {
  const toggle = vi.fn();
  mount(panel({ selected: trio, favorite: { on: true, toggle } }));

  const button = document.querySelector<HTMLButtonElement>(
    "[data-yunari-font-favorite]",
  );
  expect(button?.getAttribute("aria-pressed")).toBe("true");
  expect(button?.getAttribute("aria-label")).toBe(
    uiCopy.assets.fontPreview.unfavorite,
  );
  act(() => {
    button?.click();
  });
  expect(toggle).toHaveBeenCalledOnce();
});

it("draws no favourite toggle for a family or without a host store", () => {
  mount(panel({ selected: family }));
  expect(document.querySelector("[data-yunari-font-favorite]")).toBeNull();
});

it("draws no favourite toggle without a host favourites port", () => {
  mount(panel({ selected: trio }));
  expect(document.querySelector("[data-yunari-font-favorite]")).toBeNull();
});

it("names the apply scope and each before→after row", () => {
  mount(panel({ selected: trio }));

  expect(document.querySelector("[data-yunari-font-scope]")?.textContent).toBe(
    "Heading × 1 · Body × 1 · Mono × 1",
  );
  expect(
    document.querySelector('[data-yunari-font-change="heading"]')?.textContent,
  ).toBe("Yaldevi · 300 → Manrope 700");
  expect(
    document.querySelector('[data-yunari-font-change="body"]')?.textContent,
  ).toBe("Libre Franklin · 400 → IBM Plex Sans 400");
  expect(
    document.querySelector('[data-yunari-font-change="mono"]')?.textContent,
  ).toBe("Spline Sans Mono · 400 → IBM Plex Mono 400");
});

it("says why Apply has nothing to rewrite when no preset carries a role", () => {
  mount(panel({ selected: trio, presets: roleless }));

  // The Apply action is the footer's now; the column still names the reason.
  expect(document.body.textContent).toContain(
    uiCopy.assets.fontPreview.rolelessReason,
  );
  expect(document.body.textContent).toContain(
    uiCopy.assets.fontPreview.willBeCreated,
  );
});

it("draws a family's cuts and a role choice defaulting to Body", () => {
  mount(<Editable selected={family} />);

  const chips = [
    ...document.querySelectorAll<HTMLButtonElement>("[data-yunari-font-cut]"),
  ];
  expect(chips).toHaveLength(2);
  const role = document.querySelector<HTMLSelectElement>(
    "[data-yunari-font-role]",
  );
  expect(role?.value).toBe("body");
  // The starter token it would rewrite is named: the press replaces a face
  // rather than adding a second token.
  expect(document.body.textContent).toContain(
    uiCopy.assets.fontPreview.replacesRole(uiCopy.assets.fontPreview.role.body),
  );

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
  expect(document.body.textContent).toContain(
    uiCopy.assets.fontPreview.replacesRole(
      uiCopy.assets.fontPreview.role.heading,
    ),
  );
  expect(document.body.textContent).toContain(
    "Heading — Manrope · replaces its face",
  );
  expect(chips[1]?.getAttribute("aria-pressed")).toBe("true");
});

it("draws no role-replacement hint when the theme has no such role", () => {
  // Nothing is replaced: the press creates the role, which is the other honest
  // answer and must not be dressed as a rewrite.
  mount(panel({ selected: family, presets: roleless }));

  expect(document.querySelector("[data-yunari-font-role-replaces]")).toBeNull();
});

it("gates the hint on the chosen role, not on any role existing", () => {
  // Only `heading` exists here: a condition keyed on "the theme has some role"
  // would draw the hint under Body too and promise a rewrite that cannot happen.
  const headingOnly: TypeTokens = {
    heading: { family: "Yaldevi", weight: 300 },
  };
  mount(<Editable selected={family} presets={headingOnly} />);

  expect(document.querySelector("[data-yunari-font-role-replaces]")).toBeNull();
  expect(document.body.textContent).toContain("Body — Manrope · adds one");

  const role = document.querySelector<HTMLSelectElement>(
    "[data-yunari-font-role]",
  );
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(role, "heading");
    role?.dispatchEvent(new Event("change", { bubbles: true }));
  });

  expect(
    document.querySelector("[data-yunari-font-role-replaces]"),
  ).not.toBeNull();
  expect(document.body.textContent).toContain(
    "Heading — Manrope · replaces its face",
  );
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
  mount(panel({ selected: shared }));

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

describe("familyCutsOf", () => {
  const lead = cut("Manrope", 400);
  const bold = cut("Manrope", 700);
  const vietnamese = {
    ...cut("Manrope", 400),
    id: "cut:manrope-vietnamese",
    subset: "vietnamese",
  };
  const selected = (cuts: readonly FontCut[]): FontResult => ({
    ...family,
    id: `google-fonts:${lead.id}`,
    font: { cuts: [...cuts] },
  });

  it("returns every cut when the chosen face is the lead's", () => {
    expect(familyCutsOf(selected([lead, bold, vietnamese]), lead)).toEqual([
      lead,
      bold,
      vietnamese,
    ]);
  });

  it("returns every cut when the chosen face is another subset's", () => {
    expect(
      familyCutsOf(selected([lead, bold, vietnamese]), vietnamese),
    ).toEqual([lead, bold, vietnamese]);
  });

  it("appends the chosen face when the result's own list omits it", () => {
    expect(familyCutsOf(selected([lead, bold]), vietnamese)).toEqual([
      lead,
      bold,
      vietnamese,
    ]);
  });
});

it("releases every face it added when the panel unmounts", () => {
  const { fonts } = stubFonts();

  mount(panel({ selected: trio }));
  expect(fonts.add).toHaveBeenCalledTimes(3);

  act(() => {
    container?.unmount();
  });
  expect(fonts.delete).toHaveBeenCalledTimes(3);
});

it("releases the previous selection's faces when the selection moves", () => {
  const { fonts } = stubFonts();

  mount(panel({ selected: trio }));
  expect(fonts.add).toHaveBeenCalledTimes(3);

  rerender(panel({ selected: family }));
  const released = fonts.delete.mock.calls.map((call) => call[0]);
  expect(released).toEqual(
    fonts.add.mock.calls.slice(0, 3).map((call) => call[0]),
  );
  expect(fonts.add).toHaveBeenCalledTimes(5);
});

it("draws a specimen from the host route Apply reads its bytes from", () => {
  // The fixtures' `previewUrl` is a remote CDN a browser may not reach. Every
  // specimen reads the host's own asset route instead, which serves the bytes
  // Apply writes — so the face drawn is the face the document will carry.
  const { faces } = stubFonts();
  mount(panel({ selected: trio }));

  expect(faces.map((face) => face.source)).toEqual(
    [heading, body, mono].map(
      (cut) => `url("${assetBytesUrl(cut.source, cut.id)}")`,
    ),
  );
  for (const face of faces) {
    expect(face.source).toContain("/api/assets/bytes?source=");
    expect(face.source).not.toContain("cdn.example");
  }
});

it("carries the cut's own source and id into the specimen route", () => {
  const { faces } = stubFonts();
  const provider: FontCut = {
    ...cut("Not Curated", 400),
    id: "cut:not-curated-400",
    source: "google-fonts",
  };

  mount(
    panel({
      selected: {
        ...family,
        id: `google-fonts:${provider.id}`,
        font: { cuts: [provider] },
      },
    }),
  );

  expect(faces.map((face) => face.source)).toEqual([
    `url("${assetBytesUrl("google-fonts", "cut:not-curated-400")}")`,
  ]);
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
