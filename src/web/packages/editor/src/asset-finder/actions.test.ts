// @vitest-environment jsdom
import type { AssetPage, AssetResult } from "@yunari/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { AssetManager } from "../asset-manager/index.js";
import type { EditorDocument } from "../editor-document.js";
import { createPresetLibrary } from "../preset-library/index.js";
import { installReadableFile } from "../readable-file.fixture.js";
import { applyPreset, creditOf, importFinderResult } from "./actions.js";

installReadableFile();

const svg = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"></svg>',
);

const lucide: AssetResult = {
  id: "house",
  name: "house",
  kind: "icon",
  preview: "",
  subtitle: undefined,
  licence: "ISC",
  sourceUrl: "https://lucide.dev/icons/house",
};

const page: AssetPage = {
  source: "lucide",
  results: [lucide],
  totalPages: 1,
  failure: undefined,
};

function documentStub(canAddCredit = true): {
  document: EditorDocument;
  addCredit: ReturnType<typeof vi.fn>;
} {
  const addCredit = vi.fn();
  return {
    document: {
      addCredit,
      canAddCredit: () => canAddCredit,
    } as unknown as EditorDocument,
    addCredit,
  };
}

describe("importFinderResult", () => {
  it("declares the bytes, records the credit and runs the kind's own action", async () => {
    const manager = new AssetManager();
    const { document, addCredit } = documentStub();
    const place = vi.fn();

    const outcome = await importFinderResult({
      page,
      result: lucide,
      bytes: svg,
      filename: "house.svg",
      manager,
      document,
      place,
    });

    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome).toEqual({ ok: true });
    expect(manager.declarations.map((entry) => entry.path)).toEqual([
      "assets/house.svg",
    ]);
    expect(addCredit).toHaveBeenCalledWith({
      kind: "icon",
      title: "house",
      license: "ISC",
      changes: "Imported unchanged",
      source: { url: "https://lucide.dev/icons/house" },
    });
    expect(place).toHaveBeenCalledWith(manager.declarations[0]?.id ?? "");
  });

  it("refuses a file the manager cannot read and adds no entry", async () => {
    const manager = new AssetManager();
    const { document, addCredit } = documentStub();
    const place = vi.fn();

    const outcome = await importFinderResult({
      page,
      result: lucide,
      bytes: svg,
      filename: "house.bin",
      manager,
      document,
      place,
    });

    expect(outcome.ok).toBe(false);
    expect(addCredit).not.toHaveBeenCalled();
    expect(place).not.toHaveBeenCalled();
  });

  it("refuses the import that would pass the credits cap, before it declares bytes", async () => {
    const manager = new AssetManager();
    const { document, addCredit } = documentStub(false);
    const place = vi.fn();
    const declare = vi.spyOn(manager, "import");

    const outcome = await importFinderResult({
      page,
      result: lucide,
      bytes: svg,
      filename: "house.svg",
      manager,
      document,
      place,
    });

    expect(outcome).toMatchObject({ ok: false });
    // A 257th entry would make every later save refuse, and nothing in the
    // product can remove one, so the row is refused rather than orphaned.
    expect(declare).not.toHaveBeenCalled();
    expect(addCredit).not.toHaveBeenCalled();
    expect(place).not.toHaveBeenCalled();
  });

  it("credits an image's photographer, but never an icon's style", () => {
    expect(
      creditOf({ ...lucide, kind: "image", subtitle: "Jane Doe" }),
    ).toMatchObject({ author: { name: "Jane Doe" } });
    // Font Awesome's subtitle is `solid`, a style, not a person.
    expect(creditOf({ ...lucide, subtitle: "solid" })).not.toHaveProperty(
      "author",
    );
  });

  it("composes the credit from the result, never from the filename", () => {
    expect(creditOf(lucide)).toEqual({
      kind: "icon",
      title: "house",
      license: "ISC",
      changes: "Imported unchanged",
      source: { url: "https://lucide.dev/icons/house" },
    });
  });
});

describe("applyPreset", () => {
  const palette = {
    ...lucide,
    name: "Cloud Dancer",
    preset: { kind: "palette", colours: ["#112233", "#445566"] },
  } as const;

  it("adds one colour preset per swatch, named by the palette", () => {
    const library = createPresetLibrary(undefined);

    const outcome = applyPreset(palette, library);

    expect(outcome).toEqual({ ok: true, message: "Added 2 colours" });
    expect(library.getSnapshot().colours.at(-2)?.name).toBe("Cloud Dancer 1");
    expect(library.getSnapshot().colours.at(-1)?.name).toBe("Cloud Dancer 2");
  });

  it("says already stored and adds nothing on a repeat", () => {
    const library = createPresetLibrary(undefined);
    applyPreset(palette, library);
    const before = library.getSnapshot().colours.length;

    expect(applyPreset(palette, library)).toEqual({
      ok: true,
      message: "Already in presets",
    });
    expect(library.getSnapshot().colours.length).toBe(before);
  });

  it("stores a gradient once with its angle and stops", () => {
    const library = createPresetLibrary(undefined);
    const gradient = {
      ...lucide,
      name: "Warm Flame",
      preset: {
        kind: "gradient",
        angle: 45,
        stops: [
          { offset: 0, color: "#ff0000" },
          { offset: 1, color: "#0000ff" },
        ],
      },
    } as const;

    expect(applyPreset(gradient, library)).toEqual({
      ok: true,
      message: "Added gradient",
    });
    expect(library.getSnapshot().gradients.at(-1)).toEqual({
      id: expect.any(String),
      name: "Warm Flame",
      angle: 45,
      stops: [
        { offset: 0, color: "#ff0000" },
        { offset: 1, color: "#0000ff" },
      ],
    });
    expect(applyPreset(gradient, library)).toEqual({
      ok: true,
      message: "Already in presets",
    });
  });

  it("reports only the colours the library did not already hold", () => {
    const library = createPresetLibrary(undefined);
    library.addColours([{ name: "Kept", value: "#112233" }]);
    const before = library.getSnapshot().colours.length;

    expect(applyPreset(palette, library)).toEqual({
      ok: true,
      message: "Added 1 colour",
    });
    expect(library.getSnapshot().colours.length).toBe(before + 1);
  });
});
