// @vitest-environment jsdom

/**
 * The finder's apply target. `fontPickerBody()` hands `FontsBody` its
 * `onApplyToSelected` from whichever store names a type token — the
 * inspector's token first, the shell's canvas projection otherwise. The body
 * element is built directly, so its props are what the panel would receive;
 * the button's own drawing is `font-preview-panel.dom.test.tsx`'s case.
 */

import type { FabricThemeEnvelope, FontCut } from "@yunari/renderer-core";
import { isValidElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssetManager } from "./asset-manager/index.js";
import { EditorDocument } from "./editor-document.js";
import { EditorSession } from "./editor-session.js";
import {
  type PresetSelection,
  SelectionStore,
  TokenSelectionStore,
} from "./editor-shell/shell-stores.js";
import { idleCrop } from "./selection-inspector/idle-crop.test-stage.js";
import { fontAssetId } from "./type-preset-apply.js";

// Base UI's panels need the three browser APIs jsdom has none of.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as never;
Element.prototype.getAnimations ??= (): never[] => [];
window.PointerEvent ??= MouseEvent as never;

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const ROLES = {
  heading: { family: "Inter", weight: 700 },
  body: { family: "Inter", weight: 400 },
  mono: { family: "JetBrains Mono", weight: 400 },
} as const;

const PALETTE = {
  accent: {
    name: "Accent",
    value: { kind: "solid" as const, color: "#00b8d9" },
  },
};

const envelope: FabricThemeEnvelope = {
  schemaVersion: "2.0.0",
  fabricVersion: "7.4.0",
  id: "theme",
  metadata: { themeLanguage: "en" },
  artboard: { width: 100, height: 100 },
  scene: { version: "7.4.0", objects: [] },
  globals: {
    typeTokens: { ...ROLES, caption: { family: "Inter", weight: 400 } },
    palette: PALETTE,
  },
};

const CUT: FontCut = {
  id: "manrope-latin-400",
  source: "google",
  family: "Manrope",
  weight: 400,
  style: "normal",
  subset: "latin",
  format: "woff2",
  previewUrl: "",
  licence: "OFL",
};

/** The canvas projection, mutable so a case can move the selection between
 *  draws. */
function canvasSelection(
  initial?: string,
): PresetSelection & { pick(id?: string): void } {
  let presetId = initial;
  // One object per selection: `useSyncExternalStore` compares identity, and a
  // fresh snapshot per read is an infinite re-render.
  let snapshot = selectionSnapshot(presetId);
  return {
    subscribe: () => () => {},
    get: () => snapshot,
    pick: (id) => {
      presetId = id;
      snapshot = selectionSnapshot(presetId);
    },
  };
}

function selectionSnapshot(presetId: string | undefined) {
  return {
    selectedCount: presetId === undefined ? 0 : 1,
    activeKind:
      presetId === undefined ? ("none" as const) : ("object" as const),
    selectionPresetId: presetId,
  };
}

function createSession(
  assetManager: AssetManager,
  extras: {
    readonly tokenSelection?: TokenSelectionStore;
    readonly selection?: PresetSelection;
    readonly documentEnvelope?: FabricThemeEnvelope;
  } = {},
): EditorSession {
  const { documentEnvelope = envelope, ...sessionExtras } = extras;
  return new EditorSession({
    assetManager,
    shell: {
      editor: {
        canvas: {
          on: vi.fn(),
          off: vi.fn(),
          getActiveObject: () => undefined,
          getObjects: () => [],
          requestRenderAll: vi.fn(),
          fire: vi.fn(),
        },
        clipboardManager: { setImageImporter: vi.fn(), setBindings: vi.fn() },
        textManager: {
          addText: vi.fn(),
          setAuthoringView: vi.fn(),
          setRepaint: vi.fn(),
        },
        cropManager: idleCrop(),
        historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
        errorManager: { warn: vi.fn(), error: vi.fn() },
      },
      scene: {},
      snapshot: vi.fn((input) => ({ ...documentEnvelope, ...input })),
      setBackground: vi.fn(),
      setBackgroundMedia: vi.fn(),
      setGlobals: vi.fn(),
      refreshGlass: vi.fn(),
    } as never,
    source: {} as never,
    envelope: documentEnvelope,
    panelHosts: {
      add: document.body,
      assets: document.body,
      document: document.body,
      tokens: document.body,
      selection: document.body,
    },
    onNew: vi.fn(),
    onNewFromStarter: vi.fn(),
    onSaved: vi.fn(),
    ...sessionExtras,
  });
}

type FinderBodyProps = {
  readonly onApplyToSelected?: (
    cut: FontCut,
    family: readonly FontCut[],
  ) => void;
};

/** The props the finder's Fonts body is drawn with, read at this instant. */
function bodyProps(session: EditorSession): FinderBodyProps {
  const element = session.actionFacade().fontPickerBody?.();
  if (!isValidElement<FinderBodyProps>(element))
    throw new Error("the session drew no font body");
  return element.props;
}

async function flush(): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("the finder's apply target", () => {
  it("takes the selected preset token and applies to that id", () => {
    const tokenSelection = new TokenSelectionStore(new SelectionStore());
    const session = createSession(new AssetManager(), { tokenSelection });
    const apply = vi
      .spyOn(EditorDocument.prototype, "applyCutToPreset")
      .mockResolvedValue();

    tokenSelection.set({ kind: "preset", id: "caption" });
    const props = bodyProps(session);
    expect(props.onApplyToSelected).toBeTypeOf("function");

    props.onApplyToSelected?.(CUT, [CUT]);

    expect(apply).toHaveBeenCalledWith("caption", CUT, [CUT]);
    session.destroy();
  });

  it("reads the target live and falls back to the canvas selection", () => {
    // The two stores are exclusive, and nothing is stored between draws: a
    // token that was selected when the body was built must not survive the
    // store being cleared.
    const tokenSelection = new TokenSelectionStore(new SelectionStore());
    const selection = canvasSelection();
    const session = createSession(new AssetManager(), {
      tokenSelection,
      selection,
    });
    const apply = vi
      .spyOn(EditorDocument.prototype, "applyCutToPreset")
      .mockResolvedValue();

    tokenSelection.set({ kind: "preset", id: "caption" });
    expect(bodyProps(session).onApplyToSelected).toBeTypeOf("function");

    tokenSelection.clear();
    selection.pick("body");
    bodyProps(session).onApplyToSelected?.(CUT, [CUT]);
    expect(apply).toHaveBeenLastCalledWith("body", CUT, [CUT]);

    session.destroy();
  });

  it("does not take a paint token, falling through to the canvas selection", () => {
    const tokenSelection = new TokenSelectionStore(new SelectionStore());
    const selection = canvasSelection();
    const session = createSession(new AssetManager(), {
      tokenSelection,
      selection,
    });

    tokenSelection.set({ kind: "paint", id: "accent" });
    // A paint is no type target: with no canvas selection there is no action.
    expect(bodyProps(session).onApplyToSelected).toBeUndefined();

    selection.pick("caption");
    const props = bodyProps(session);
    const apply = vi
      .spyOn(EditorDocument.prototype, "applyCutToPreset")
      .mockResolvedValue();
    props.onApplyToSelected?.(CUT, [CUT]);
    expect(apply).toHaveBeenCalledWith("caption", CUT, [CUT]);

    session.destroy();
  });

  // Reds on: dropping the token-store read (heading is never written) or a
  // write that carries another token along (the untouched list changes).
  it("rewrites the named role token and no other", async () => {
    const assetManager = new AssetManager();
    // Declared up front so the write adopts no bytes and asks no host.
    await assetManager.adoptFont(
      {
        id: fontAssetId(CUT),
        role: "body",
        family: CUT.family,
        weight: 400,
        style: "normal",
        format: "woff2",
        subset: "latin",
        sourceUrl: "local:test",
        license: { name: "OFL" },
      },
      new Uint8Array([1]),
    );
    const tokenSelection = new TokenSelectionStore(new SelectionStore());
    const session = createSession(assetManager, { tokenSelection });
    const untouched = JSON.stringify({
      body: ROLES.body,
      mono: ROLES.mono,
      caption: envelope.globals?.typeTokens?.["caption"],
    });

    tokenSelection.set({ kind: "preset", id: "heading" });
    bodyProps(session).onApplyToSelected?.(CUT, [CUT]);
    await flush();

    expect(session.envelope.globals?.typeTokens?.["heading"]).toEqual({
      family: "Manrope",
      weight: 400,
      face: { assetId: fontAssetId(CUT) },
    });
    const tokens = session.envelope.globals?.typeTokens ?? {};
    expect(
      JSON.stringify({
        body: tokens["body"],
        mono: tokens["mono"],
        caption: tokens["caption"],
      }),
    ).toBe(untouched);

    session.destroy();
  });
});
