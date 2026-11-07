// @vitest-environment jsdom
import type {
  FabricGlobals,
  FabricPalette,
  FabricPaletteEntry,
} from "@yunari/renderer-core";
import { formatColor } from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import type { TypeTokens } from "../type-preset-manager/panel.js";
import { uiCopy } from "../ui-copy.js";
import type { DesignTokenPort } from "./design-token-editor.js";
import {
  blur,
  choose,
  clickHook,
  flush,
  mountRunEditor,
  typeInto,
} from "./runs.test-stage.js";

/**
 * Editing the design token a run references, from the row that names it.
 *
 * The writes go through one fake port shaped exactly like the session's: the
 * same `TokenInspectorActions` the token inspector receives. A case here fails
 * when the row grows a second mutation route rather than when a copy drifts.
 */

const PRESETS: TypeTokens = {
  heading: { family: "Inter", weight: 600 },
  body: { family: "Inter", weight: 400 },
};

/** Colours as the picker spells them, so this fixture carries no literal the
 *  design-token gate has to license. */
const INK = formatColor({ r: 232, g: 236, b: 243, a: 1 });
const BARS = formatColor({ r: 0, g: 0, b: 0, a: 1 });
const NEXT = formatColor({ r: 18, g: 52, b: 86, a: 1 });

const PALETTE: FabricPalette = {
  ink: { name: "Ink", value: { kind: "solid", color: INK } },
  bars: { name: "Bars", value: { kind: "solid", color: BARS } },
};

function stage(tokens: {
  readonly onType: (presets: TypeTokens) => void;
  readonly onPaint: (palette: FabricPalette) => void;
  readonly familiesOf?: () => readonly string[];
  readonly rerender: () => void;
}): DesignTokenPort {
  // The fake document: a write lands here, as `setTypes`/`setPalette` land in
  // the session's own envelope, and the next projection reads it back.
  let presets = PRESETS;
  let palette = PALETTE;
  return {
    actions: {
      onChange: (next) => {
        presets = next;
        tokens.onType(next);
        tokens.rerender();
      },
      onDelete: () => {},
      unbindFace: () => {},
      ...(tokens.familiesOf === undefined
        ? {}
        : { familiesOf: tokens.familiesOf }),
      paints: {
        palette: () => palette,
        onChange: (next) => {
          palette = next;
          tokens.onPaint(next);
          tokens.rerender();
        },
        onSettled: () => {},
        onDelete: undefined,
        usage: undefined,
      },
    },
    typeTokens: () => presets,
    palette: () => palette,
  };
}

const globals = { typeTokens: PRESETS, palette: PALETTE } as FabricGlobals;

describe("editing the type token a run is set in", () => {
  it("opens family and weight at the row and writes through the inspector's actions", async () => {
    const written: TypeTokens[] = [];
    let box: ReturnType<typeof mountRunEditor> | undefined;
    const designTokens = stage({
      onType: (presets) => written.push(presets),
      onPaint: () => {},
      familiesOf: () => ["Inter", "Manrope"],
      rerender: () => box?.render(),
    });
    box = mountRunEditor({
      runs: [{ kind: "literal", text: "Hi", typeToken: "typeTokens.heading" }],
      globals,
      designTokens,
    });

    expect(
      box.host.querySelector("[data-yunari-run-token-edit]"),
    ).not.toBeNull();
    await clickHook(box.host, "data-yunari-run-token-edit");
    await flush();

    const popover = document.querySelector("[data-yunari-token-edit-popover]");
    expect(popover).not.toBeNull();
    expect(
      popover?.querySelector('[data-yunari-token-family=""]'),
    ).not.toBeNull();

    await choose(document.body, "data-yunari-token-family", "Manrope");
    await flush();

    expect(written.at(-1)?.["heading"]).toEqual({
      family: "Manrope",
      weight: 600,
    });
    // The document's own record is the one the row writes; the fake store sees
    // the write the inspector would have made.
    expect(PRESETS["heading"]).toEqual({ family: "Inter", weight: 600 });
    return box.dispose();
  });

  it("names the edit action for the token, not for the row", () => {
    const box = mountRunEditor({
      runs: [{ kind: "literal", text: "Hi", typeToken: "typeTokens.heading" }],
      globals,
      designTokens: stage({
        onType: () => {},
        onPaint: () => {},
        rerender: () => {},
      }),
    });

    expect(
      box
        .pick<HTMLElement>("[data-yunari-run-token-edit]")
        .getAttribute("aria-label"),
    ).toBe(uiCopy.inspectorFields.editToken("[Heading] Inter 600"));
    return box.dispose();
  });
});

describe("editing the paint token a run is set in", () => {
  it("opens the colour picker at the row and settles through the paint port", async () => {
    const written: FabricPalette[] = [];
    let box: ReturnType<typeof mountRunEditor> | undefined;
    const designTokens = stage({
      onType: () => {},
      onPaint: (palette) => written.push(palette),
      rerender: () => box?.render(),
    });
    box = mountRunEditor({
      runs: [
        {
          kind: "literal",
          text: "Hi",
          typeToken: "typeTokens.body",
          style: { color: { ref: "palette.bars" } },
        },
      ],
      globals,
      designTokens,
    });

    await clickHook(box.host, "data-yunari-run-colour-edit");
    await flush();

    expect(
      document.querySelector("[data-yunari-token-edit-popover]"),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="picker-area"]'),
    ).not.toBeNull();

    const hex = document.querySelector<HTMLInputElement>(
      "[data-yunari-palette-color]",
    );
    if (hex === null) throw new Error("the picker's value field is missing");
    await typeInto(hex, NEXT);
    await blur(hex);

    const entry = written.at(-1)?.["bars"] as FabricPaletteEntry | undefined;
    expect(entry?.value).toEqual({ kind: "solid", color: NEXT });
    return box.dispose();
  });

  it("switches the paint kind the same way the token inspector does", async () => {
    const written: FabricPalette[] = [];
    let box: ReturnType<typeof mountRunEditor> | undefined;
    const designTokens = stage({
      onType: () => {},
      onPaint: (palette) => written.push(palette),
      rerender: () => box?.render(),
    });
    box = mountRunEditor({
      runs: [
        {
          kind: "literal",
          text: "Hi",
          typeToken: "typeTokens.body",
          style: { color: { ref: "palette.bars" } },
        },
      ],
      globals,
      designTokens,
    });

    await clickHook(box.host, "data-yunari-run-colour-edit");
    await flush();
    await choose(document.body, "data-yunari-palette-kind", "Linear gradient");
    await flush();

    expect((written.at(-1)?.["bars"] as FabricPaletteEntry).value.kind).toBe(
      "gradient",
    );
    expect(
      document.querySelector("[data-yunari-palette-gradient]"),
    ).not.toBeNull();
    return box.dispose();
  });
});
