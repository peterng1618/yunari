// @vitest-environment jsdom
import type {
  AssetPage,
  AssetResult,
  FontCut,
  FontTrioInfo,
} from "@yunari/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { uiCopy } from "../ui-copy.js";
import {
  type FontActions,
  type FontFilterState,
  type FontPreviewState,
  fontActionsOf,
  fontDoneMessage,
  fontRows,
} from "./fonts.js";
import type { FinderRow } from "./tab-data.js";

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

const trio: FontTrioInfo = {
  id: "trio:inter",
  name: "Inter",
  description: "A trio.",
  roles: {
    heading: cut("Inter", 700),
    body: cut("Poppins", 400),
    mono: cut("Fira Code", 400),
  },
};

const page: AssetPage = {
  source: "curated-fonts",
  results: [],
  totalPages: undefined,
  failure: undefined,
};

function row(result: AssetResult): FinderRow {
  return { page, result };
}

const trioRow = (name: string): FinderRow =>
  row({
    id: `curated-fonts:trio:${name}`,
    name,
    kind: "font",
    preview: "",
    subtitle: "",
    licence: "OFL-1.1",
    sourceUrl: "",
    font: { cuts: [cut(name, 700)], trio: { ...trio, name } },
  });

const familyRow = (name: string): FinderRow =>
  row({
    id: `curated-fonts:cut:${name}`,
    name,
    kind: "font",
    preview: "",
    subtitle: "",
    licence: "OFL-1.1",
    sourceUrl: "",
    font: { cuts: [cut(name, 400)] },
  });

const all: FontFilterState = { kind: "all", sort: "name" };
const preview: FontPreviewState = {
  sample: "",
  cutId: undefined,
  role: "body",
};

const actions: FontActions = {
  onApplyTrio: vi.fn(),
  onAddTrioPresets: vi.fn(),
  onAddPreset: vi.fn(),
  onApplyToSelected: vi.fn(),
};

describe("fontRows", () => {
  it("keeps only trios, then sorts by name when asked", () => {
    const rows = [trioRow("Zeta"), familyRow("Alpha")];

    expect(
      fontRows(rows, { kind: "trio", sort: "name" }).map(
        (entry) => entry.result.name,
      ),
    ).toEqual(["Zeta"]);
    expect(
      fontRows(rows, { kind: "family", sort: "name" }).map(
        (entry) => entry.result.name,
      ),
    ).toEqual(["Alpha"]);
    expect(fontRows(rows, all).map((entry) => entry.result.name)).toEqual([
      "Alpha",
      "Zeta",
    ]);
  });

  it("keeps the providers' own order when the sort says provider", () => {
    const rows = [trioRow("Zeta"), familyRow("Alpha")];

    expect(
      fontRows(rows, { kind: "all", sort: "provider" }).map(
        (entry) => entry.result.name,
      ),
    ).toEqual(["Zeta", "Alpha"]);
  });
});

describe("fontDoneMessage", () => {
  it("names the three roles a trio wrote, and the token a face wrote", () => {
    expect(fontDoneMessage("apply-trio")).toBe(uiCopy.assets.fontTrioDone);
    expect(fontDoneMessage("apply-cut")).toBe(uiCopy.assets.done.font);
    expect(fontDoneMessage("add-trio")).toBe(uiCopy.assets.done.colour);
    expect(fontDoneMessage("add-cut")).toBe(uiCopy.assets.done.colour);
  });
});

describe("fontActionsOf", () => {
  it("declares the trio's two outcomes and a family's two", () => {
    expect(
      fontActionsOf(trioRow("Inter"), all, preview, actions).map(
        (action) => action.label,
      ),
    ).toEqual(["Apply trio", "Add to presets"]);
    expect(
      fontActionsOf(familyRow("Inter"), all, preview, actions).map(
        (action) => action.label,
      ),
    ).toEqual(["Apply to token", "Add to presets"]);
  });

  it("runs the trio's callbacks and the family's chosen cut", () => {
    const onApplyTrio = vi.fn();
    const onApplyToSelected = vi.fn();
    const own = { ...actions, onApplyTrio, onApplyToSelected };

    fontActionsOf(trioRow("Inter"), all, preview, own)[0]?.run();
    expect(onApplyTrio).toHaveBeenCalledWith(
      expect.objectContaining({ id: trio.id }),
    );

    const family = familyRow("Inter");
    fontActionsOf(family, all, preview, own)[0]?.run();
    expect(onApplyToSelected).toHaveBeenCalledWith(
      family.result.font?.cuts[0],
      family.result.font?.cuts,
    );
  });

  it("drops an outcome the session cannot perform", () => {
    expect(fontActionsOf(trioRow("Inter"), all, preview, {})).toEqual([]);
    expect(
      fontActionsOf(familyRow("Inter"), all, preview, {
        onAddPreset: vi.fn(),
      }).map((action) => action.id),
    ).toEqual(["apply-cut", "add-cut"]);
  });
});
