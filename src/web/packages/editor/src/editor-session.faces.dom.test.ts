// @vitest-environment jsdom

/**
 * The session's font ports. `facesOf`, `familiesOf`, `openFontFinder` and
 * `importLocalFont` are composed by `EditorSession` from the real
 * `AssetManager`'s declarations — no stub — and the panel is doubled so the
 * ports can be called directly rather than through a popup.
 */

import type {
  FabricThemeEnvelope,
  FontAssetReference,
} from "@yunari/renderer-core";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

type FaceEntries = readonly {
  readonly assetId: string;
  readonly weight: string | number;
  readonly style: string;
}[];

/** The ports the panel would have been handed. */
const inspectorPort = vi.hoisted(() => ({
  onChange: undefined as
    | ((presets: Record<string, unknown>) => void)
    | undefined,
  facesOf: undefined as ((family: string) => FaceEntries) | undefined,
  familiesOf: undefined as (() => readonly string[]) | undefined,
  importLocalFont: undefined as (() => void) | undefined,
  openFontFinder: undefined as (() => void) | undefined,
}));

vi.mock("./panes/tokens/token-inspector.js", () => ({
  createTokenInspectorPanel: (
    host: HTMLElement,
    actions: {
      readonly onChange: (presets: Record<string, unknown>) => void;
      readonly facesOf?: (family: string) => FaceEntries;
      readonly familiesOf?: () => readonly string[];
      readonly importLocalFont?: () => void;
      readonly openFontFinder?: () => void;
    },
  ) => {
    inspectorPort.onChange = actions.onChange;
    inspectorPort.facesOf = actions.facesOf;
    inspectorPort.familiesOf = actions.familiesOf;
    inspectorPort.importLocalFont = actions.importLocalFont;
    inspectorPort.openFontFinder = actions.openFontFinder;
    const root = document.createElement("section");
    host.append(root);
    return { root, render: () => {}, destroy: () => root.remove() };
  },
}));

import type { FontMetadata } from "./asset-manager/font-metadata.js";
import { AssetManager } from "./asset-manager/index.js";
import { EditorDocument } from "./editor-document.js";
import { EditorSession } from "./editor-session.js";
import type { CuratedFontFace } from "./font-catalog.js";
import { idleCrop } from "./selection-inspector/idle-crop.test-stage.js";

// Base UI's dialog needs the three browser APIs jsdom has none of — the same
// three `save-cleanup-dialog.dom.test.tsx` supplies, for the same reason.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as never;
Element.prototype.getAnimations ??= (): never[] => [];
window.PointerEvent ??= MouseEvent as never;

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const ROLES = {
  heading: { family: "Inter", weight: 700 },
  body: { family: "Inter", weight: 400 },
  mono: { family: "JetBrains Mono", weight: 400 },
} as const;

const envelope: FabricThemeEnvelope = {
  schemaVersion: "2.0.0",
  fabricVersion: "7.4.0",
  id: "theme",
  metadata: { themeLanguage: "en" },
  artboard: { width: 100, height: 100 },
  scene: { version: "7.4.0", objects: [] },
  globals: { typeTokens: ROLES },
};

/** One packaged family, one face per subset: the 400 arrives twice. */
const FACE = {
  role: "body",
  family: "Manrope",
  format: "woff2",
  sourceUrl: "https://example.test/manrope",
  license: { name: "OFL" },
  subset: "latin",
} as const;

const FACES: readonly CuratedFontFace[] = [
  {
    ...FACE,
    id: "manrope-vietnamese-400",
    weight: 400,
    style: "normal",
    subset: "vietnamese",
  },
  {
    ...FACE,
    id: "manrope-latin-700",
    weight: 700,
    style: "normal",
  },
  {
    ...FACE,
    id: "manrope-latin-400",
    weight: 400,
    style: "normal",
  },
  {
    ...FACE,
    id: "manrope-latin-700-italic",
    weight: 700,
    style: "italic",
  },
];

function createSession(
  assetManager: AssetManager,
  extras: {
    readonly onFindFontPicker?: () => void;
    readonly saveState?: () => void;
    readonly envelope?: FabricThemeEnvelope;
  } = {},
): EditorSession {
  const {
    saveState = vi.fn(),
    envelope: documentEnvelope = envelope,
    ...sessionExtras
  } = extras;
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
        historyManager: { attachGlobals: () => {}, saveState },
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

describe("EditorSession weight list", () => {
  it("offers one entry per weight and style from its declarations", async () => {
    const assetManager = new AssetManager();
    for (const face of FACES) {
      await assetManager.adoptFont(face, new Uint8Array([1]));
    }
    const session = createSession(assetManager);

    const faces = inspectorPort.facesOf?.("Manrope") ?? [];

    expect(
      faces.map((face) =>
        face.style === "italic" ? `${face.weight} italic` : String(face.weight),
      ),
    ).toEqual(["400", "700", "700 italic"]);
    // The two 400 subsets collapse to the lexicographically first asset id, not
    // the first declared.
    expect(faces.find((face) => face.weight === 400)?.assetId).toBe(
      "manrope-latin-400",
    );

    session.destroy();
  });

  it("matches the family case-insensitively, as the family list does", async () => {
    // `familiesOf` deduplicates case-insensitively, so `inter` and `Inter` are
    // one family. A token kept as `manrope` must still see the declared
    // `Manrope` faces, or its weight row goes read-only for a case difference.
    const assetManager = new AssetManager();
    for (const face of FACES) {
      await assetManager.adoptFont(face, new Uint8Array([1]));
    }
    const session = createSession(assetManager);

    // An upper-case spelling of the declared `Manrope`: both sides of the
    // comparison have to be lowered, not just the declaration.
    expect(
      (inspectorPort.facesOf?.("MANROPE") ?? []).map((face) => face.assetId),
    ).toEqual([
      "manrope-latin-400",
      "manrope-latin-700",
      "manrope-latin-700-italic",
    ]);

    session.destroy();
  });

  it("records one history entry for a chosen weight and its face", async () => {
    // The panel writes both halves in one `onChange`; the session half is one
    // `setTypes`, so history records the choice once rather than an
    // intermediate weight without a face.
    const assetManager = new AssetManager();
    for (const face of FACES) {
      await assetManager.adoptFont(face, new Uint8Array([1]));
    }
    const saveState = vi.fn();
    const tokens = { ...ROLES, heading: { family: "Manrope", weight: 400 } };
    const session = createSession(assetManager, {
      saveState,
      envelope: { ...envelope, globals: { typeTokens: tokens } },
    });
    saveState.mockClear();

    const face = (inspectorPort.facesOf?.("Manrope") ?? []).find(
      (candidate) => candidate.assetId === "manrope-latin-700",
    );
    if (face === undefined) throw new Error("the family declares no 700 face");
    inspectorPort.onChange?.({
      ...tokens,
      heading: {
        family: "Manrope",
        weight: face.weight,
        face: { assetId: face.assetId },
      },
    });

    expect(saveState).toHaveBeenCalledTimes(1);
    expect(session.envelope.globals?.typeTokens?.["heading"]).toEqual({
      family: "Manrope",
      weight: 700,
      face: { assetId: "manrope-latin-700" },
    });

    session.destroy();
  });
});

describe("EditorSession family list", () => {
  it("deduplicates and sorts the declared families case-insensitively", async () => {
    const assetManager = new AssetManager();
    for (const face of [
      { ...FACES[0]!, id: "zeta-400", family: "Zeta", subset: "latin" },
      { ...FACES[0]!, id: "alpha-400", family: "alpha", subset: "latin" },
      { ...FACES[0]!, id: "alpha-700", family: "Alpha", subset: "latin" },
      { ...FACES[1]!, id: "manrope-400", family: "Manrope" },
    ]) {
      await assetManager.adoptFont(face, new Uint8Array([1]));
    }
    const session = createSession(assetManager);

    // One entry per family — the second spelling of "alpha" is the same family —
    // in case-insensitive order rather than declaration order.
    expect(inspectorPort.familiesOf?.()).toEqual(["alpha", "Manrope", "Zeta"]);

    session.destroy();
  });

  it("opens the font finder through the session's own port", () => {
    const onFindFontPicker = vi.fn();
    const session = createSession(new AssetManager(), { onFindFontPicker });

    inspectorPort.openFontFinder?.();

    expect(onFindFontPicker).toHaveBeenCalledTimes(1);
    session.destroy();
  });
});

/** The hidden picker the import row appends. */
function fontPicker(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    "input[data-yunari-token-font-import]",
  );
  if (input === null) throw new Error("the import row opened no picker");
  return input;
}

async function flush(): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** Picks a file as the OS picker reports one. The picker is removed whatever
 *  the answer, so a second press starts from an empty pick. */
async function pick(filename: string): Promise<void> {
  inspectorPort.importLocalFont?.();
  const input = fontPicker();
  const file = new File([new Uint8Array([1])], filename, {
    type: "font/woff2",
  });
  Object.defineProperty(input, "files", { value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
  expect(input.isConnected).toBe(false);
}

function dialog(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[role="dialog"]');
  if (found === null) throw new Error("the import dialog did not open");
  return found;
}

async function press(selector: string): Promise<void> {
  await act(async () => {
    dialog()
      .querySelector(selector)
      ?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
      );
  });
  await flush();
}

const unroled = (
  session: EditorSession,
): readonly (readonly [string, unknown])[] =>
  Object.entries(session.envelope.globals?.typeTokens ?? {}).filter(
    ([id]) => !(id in ROLES),
  );

/**
 * jsdom has no `FontFace`, so the browser's parse is the asset manager's test.
 * What these cases are about is the token and credit path the commit takes.
 */
function stubImportFont(): void {
  vi.spyOn(AssetManager.prototype, "importFont").mockImplementation(
    async function (
      this: AssetManager,
      file: File,
      metadata: FontMetadata,
    ): Promise<FontAssetReference> {
      const declared = await this.adoptFont(
        {
          id: file.name.replace(/\.[^.]+$/, ""),
          role: "body",
          family: metadata.family,
          weight: metadata.weight,
          style: metadata.style,
          format: "woff2",
          subset: "latin",
          sourceUrl: "local:import",
          license: { name: metadata.licence },
        },
        new Uint8Array([1]),
      );
      return declared as FontAssetReference;
    },
  );
}

describe("the session's font import", () => {
  it("opens nothing and removes the picker when the OS picker is dismissed", async () => {
    const assetManager = new AssetManager();
    const session = createSession(assetManager);
    stubImportFont();

    inspectorPort.importLocalFont?.();
    const input = fontPicker();
    // The picker offers the manager's own font formats — no `font/*`, which
    // would offer `.ttc` and every other face the importer refuses.
    expect(input.accept).toBe(".woff2,.woff,.ttf,.otf");
    // A dismissed picker reports a change with no file rather than none at all.
    // jsdom reports a listener's exception as a window error instead of throwing
    // through `dispatchEvent`, so the throw is collected rather than missed.
    const failures: unknown[] = [];
    const onError = (event: Event): void => {
      failures.push(event);
    };
    window.addEventListener("error", onError);
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    window.removeEventListener("error", onError);
    await flush();

    expect(failures).toHaveLength(0);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(input.isConnected).toBe(false);
    expect(assetManager.declarations).toHaveLength(0);

    session.destroy();
  });

  it("removes the picker when the browser cancels it", async () => {
    const assetManager = new AssetManager();
    const session = createSession(assetManager);

    inspectorPort.importLocalFont?.();
    const input = fontPicker();
    await act(async () => {
      input.dispatchEvent(new Event("cancel"));
    });

    expect(input.isConnected).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(assetManager.declarations).toHaveLength(0);

    session.destroy();
  });

  it("commits one unroled token and leaves the three roles untouched", async () => {
    const assetManager = new AssetManager();
    const session = createSession(assetManager);
    stubImportFont();
    const tokens = vi.spyOn(
      EditorDocument.prototype,
      "addTypeTokenFromLocalFont",
    );
    const credit = vi.spyOn(EditorDocument.prototype, "addCredit");
    const rolesBefore = JSON.stringify(ROLES);

    await pick("Manrope-Bold.woff2");

    // The form is the Assets pane's, minus the role select this import may never
    // use.
    expect(dialog().querySelector("[data-yunari-font-role]")).toBeNull();
    await press("[data-yunari-font-create]");

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(tokens).toHaveBeenCalledTimes(1);
    expect(tokens).toHaveBeenCalledWith(expect.anything(), null);
    expect(credit).toHaveBeenCalledTimes(1);

    const tokensAfter = session.envelope.globals?.typeTokens ?? {};
    expect(
      JSON.stringify({
        heading: tokensAfter["heading"],
        body: tokensAfter["body"],
        mono: tokensAfter["mono"],
      }),
    ).toBe(rolesBefore);

    const added = unroled(session);
    expect(added).toHaveLength(1);
    expect(added[0]?.[1]).toEqual({
      family: "Manrope",
      weight: 700,
      face: { assetId: "Manrope-Bold" },
    });

    session.destroy();
  });

  it("reuses the token when the same family and weight is imported again", async () => {
    const assetManager = new AssetManager();
    const session = createSession(assetManager);
    stubImportFont();
    const tokens = vi.spyOn(
      EditorDocument.prototype,
      "addTypeTokenFromLocalFont",
    );

    await pick("Manrope-Bold.woff2");
    await press("[data-yunari-font-create]");
    await pick("Manrope-Bold.woff2");
    await press("[data-yunari-font-create]");

    expect(tokens).toHaveBeenCalledTimes(2);
    // One token for that face: the adopt path answers the existing id.
    expect(
      unroled(session).filter(
        ([, token]) => (token as { family?: string }).family === "Manrope",
      ),
    ).toHaveLength(1);
    expect(unroled(session)).toHaveLength(1);

    session.destroy();
  });

  it("declares the file and creates no token or credit on Cancel", async () => {
    const assetManager = new AssetManager();
    const session = createSession(assetManager);
    stubImportFont();
    const tokens = vi.spyOn(
      EditorDocument.prototype,
      "addTypeTokenFromLocalFont",
    );
    const credit = vi.spyOn(EditorDocument.prototype, "addCredit");

    await pick("Manrope-Bold.woff2");
    await press("[data-yunari-font-cancel]");

    // The file is declared — that is what the Assets pane's Cancel means — but
    // no token and no credit are written.
    expect(
      assetManager.declarations.filter((asset) => asset.kind === "font"),
    ).toHaveLength(1);
    expect(tokens).not.toHaveBeenCalled();
    expect(credit).not.toHaveBeenCalled();
    expect(unroled(session)).toHaveLength(0);

    session.destroy();
  });
});
