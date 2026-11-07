// @vitest-environment jsdom
import type {
  FabricGlobals,
  FabricPalette,
  FabricPaletteEntry,
} from "@yunari/renderer-core";
import { formatColor } from "@yunari/renderer-core";
import { act } from "react";
import { describe, expect, it } from "vitest";
import type { TokenRef } from "../editor-shell/shell-stores.js";
import type { FaceChoice } from "../panes/tokens/token-inspector.js";
import type { TypeTokens } from "../type-preset-manager/panel.js";
import { uiCopy } from "../ui-copy.js";
import type { DesignTokenPort } from "./design-token-editor.js";
import {
  blur,
  choose,
  click,
  clickHook,
  flush,
  mountRunEditor,
  optionsOf,
  pointerDown,
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
  readonly create?: (
    kind: TokenRef["kind"],
    apply: (ref: TokenRef) => boolean,
  ) => TokenRef | undefined;
  readonly reveal?: (ref: TokenRef) => void;
  readonly familiesOf?: () => readonly string[];
  readonly facesOf?: () => readonly FaceChoice[];
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
      ...(tokens.facesOf === undefined ? {} : { facesOf: tokens.facesOf }),
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
    create:
      tokens.create ??
      ((_kind, apply) => {
        const ref: TokenRef = { kind: "preset", id: "unused" };
        return apply(ref) ? ref : undefined;
      }),
    reveal: tokens.reveal ?? (() => {}),
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
      facesOf: () => [
        { assetId: "inter-400", weight: 400, style: "normal" },
        { assetId: "inter-700", weight: 700, style: "normal" },
      ],
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
    expect(popover?.getAttribute("aria-label")).toBe("[Heading] Inter 600");
    expect(
      popover?.querySelector('[data-yunari-token-family=""]'),
    ).not.toBeNull();

    await choose(document.body, "data-yunari-token-family", "Manrope");
    await flush();
    await choose(document.body, "data-yunari-token-weight", "700");
    await flush();

    expect(written.at(-1)?.["heading"]).toEqual(
      expect.objectContaining({ family: "Manrope", weight: 700 }),
    );
    // The write is the whole map the inspector hands the document; the token
    // beside the edited one keeps its face rather than being replaced by it.
    expect(written.at(-1)?.["body"]).toEqual({
      family: "Inter",
      weight: 400,
    });
    return box.dispose();
  });

  it("names the edit action for the token, not for the row", () => {
    const box = mountRunEditor({
      runs: [{ kind: "literal", text: "Hi", typeToken: "typeTokens.heading" }],
      globals,
      designTokens: stage({
        onType: () => {},
        onPaint: () => {},
        create: () => ({ kind: "preset", id: "type" }),
        reveal: () => {},
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

describe("dismissing the row's edit popover", () => {
  function open(box: ReturnType<typeof mountRunEditor>): HTMLElement {
    return box.pick<HTMLElement>("[data-yunari-run-token-edit]");
  }

  it("closes on Escape and returns focus to the row's button", async () => {
    const box = mountRunEditor({
      runs: [{ kind: "literal", text: "Hi", typeToken: "typeTokens.heading" }],
      globals,
      designTokens: stage({
        onType: () => {},
        onPaint: () => {},
        familiesOf: () => ["Inter"],
        rerender: () => {},
      }),
    });
    const trigger = open(box);
    await clickHook(box.host, "data-yunari-run-token-edit");
    await flush();
    expect(
      document.querySelector("[data-yunari-token-edit-popover]"),
    ).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    await flush();

    expect(
      document.querySelector("[data-yunari-token-edit-popover]"),
    ).toBeNull();
    expect(document.activeElement).toBe(trigger);
    return box.dispose();
  });

  it("closes on a press outside and leaves focus on the row's button", async () => {
    const box = mountRunEditor({
      runs: [{ kind: "literal", text: "Hi", typeToken: "typeTokens.heading" }],
      globals,
      designTokens: stage({
        onType: () => {},
        onPaint: () => {},
        familiesOf: () => ["Inter"],
        rerender: () => {},
      }),
    });
    const trigger = open(box);
    await clickHook(box.host, "data-yunari-run-token-edit");
    await flush();

    await pointerDown(document.body);
    await click(document.body);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    await flush();

    expect(
      document.querySelector("[data-yunari-token-edit-popover]"),
    ).toBeNull();
    expect(document.activeElement).toBe(trigger);
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

describe("adding a design token from a run's token list", () => {
  it("ends the list with the add entry, creates the token, applies it and reveals it", async () => {
    const revealed: TokenRef[] = [];
    let created: TokenRef["kind"] | undefined;
    let box: ReturnType<typeof mountRunEditor> | undefined;
    const designTokens = stage({
      onType: () => {},
      onPaint: () => {},
      create: (kind, apply) => {
        created = kind;
        const ref: TokenRef = { kind, id: "type" };
        return apply(ref) ? ref : undefined;
      },
      reveal: (ref) => revealed.push(ref),
      rerender: () => box?.render(),
    });
    box = mountRunEditor({
      runs: [{ kind: "literal", text: "Hi", typeToken: "typeTokens.heading" }],
      globals,
      designTokens,
    });

    expect(await optionsOf(box.host, 'data-yunari-run-preset="0"')).toEqual([
      "[Heading] Inter 600",
      "[Body] Inter 400",
      uiCopy.inspectorFields.addNewToken,
    ]);

    await choose(
      box.host,
      'data-yunari-run-preset="0"',
      uiCopy.inspectorFields.addNewToken,
    );

    expect(created).toBe("preset");
    expect(box.runs()[0]?.typeToken).toBe("typeTokens.type");
    expect(revealed.at(-1)).toEqual({ kind: "preset", id: "type" });
    return box.dispose();
  });

  it("does the same from the colour list, with a paint token", async () => {
    const revealed: TokenRef[] = [];
    let box: ReturnType<typeof mountRunEditor> | undefined;
    const designTokens = stage({
      onType: () => {},
      onPaint: () => {},
      create: (kind, apply) => {
        const ref: TokenRef = { kind, id: "colour" };
        return apply(ref) ? ref : undefined;
      },
      reveal: (ref) => revealed.push(ref),
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

    await choose(
      box.host,
      'data-yunari-run-colour="0"',
      uiCopy.inspectorFields.addNewToken,
    );

    expect(box.runs()[0]?.style?.["color"]).toEqual({
      ref: "palette.colour",
    });
    expect(revealed.at(-1)).toEqual({ kind: "paint", id: "colour" });
    return box.dispose();
  });

  it("does not reveal a token the run refused to take", async () => {
    const revealed: TokenRef[] = [];
    let box: ReturnType<typeof mountRunEditor> | undefined;
    const designTokens = stage({
      onType: () => {},
      onPaint: () => {},
      // The session writes the token, then reports the run's write refused:
      // nothing was applied, so nothing is revealed.
      create: (kind, apply) => {
        apply({ kind, id: "type" });
        return undefined;
      },
      reveal: (ref) => revealed.push(ref),
      rerender: () => box?.render(),
    });
    box = mountRunEditor({
      runs: [{ kind: "literal", text: "Hi", typeToken: "typeTokens.heading" }],
      globals,
      designTokens,
    });

    await choose(
      box.host,
      'data-yunari-run-preset="0"',
      uiCopy.inspectorFields.addNewToken,
    );

    expect(revealed).toEqual([]);
    return box.dispose();
  });

  it("draws neither the edit action nor the add entry without a token port", async () => {
    const box = mountRunEditor({
      runs: [
        {
          kind: "literal",
          text: "Hi",
          typeToken: "typeTokens.heading",
          style: { color: { ref: "palette.bars" } },
        },
      ],
      globals,
    });

    expect(box.host.querySelector("[data-yunari-run-token-edit]")).toBeNull();
    expect(box.host.querySelector("[data-yunari-run-colour-edit]")).toBeNull();
    expect(await optionsOf(box.host, 'data-yunari-run-preset="0"')).toEqual([
      "[Heading] Inter 600",
      "[Body] Inter 400",
    ]);
    expect(await optionsOf(box.host, 'data-yunari-run-colour="0"')).toEqual(
      expect.arrayContaining(["Ink", "Bars"]),
    );
    expect(
      await optionsOf(box.host, 'data-yunari-run-colour="0"'),
    ).not.toContain(uiCopy.inspectorFields.addNewToken);
    return box.dispose();
  });
});
