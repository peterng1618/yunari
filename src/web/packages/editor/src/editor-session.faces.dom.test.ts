// @vitest-environment jsdom

/**
 * The session's own weight list. `facesOf` is composed by `EditorSession` from
 * the real `AssetManager`'s declarations — no stub — and the panel is doubled so
 * the port can be called directly rather than through a popup.
 */
import type { FabricThemeEnvelope } from "@yunari/renderer-core";
import { describe, expect, it, vi } from "vitest";

type FaceEntries = readonly {
  readonly assetId: string;
  readonly weight: string | number;
  readonly style: string;
}[];

const inspectorPort = vi.hoisted(() => ({
  facesOf: undefined as ((family: string) => FaceEntries) | undefined,
}));

vi.mock("./panes/tokens/token-inspector.js", () => ({
  createTokenInspectorPanel: (
    host: HTMLElement,
    actions: { readonly facesOf?: (family: string) => FaceEntries },
  ) => {
    inspectorPort.facesOf = actions.facesOf;
    const root = document.createElement("section");
    host.append(root);
    return { root, render: () => {}, destroy: () => root.remove() };
  },
}));

import { AssetManager } from "./asset-manager/index.js";
import { EditorSession } from "./editor-session.js";
import type { CuratedFontFace } from "./font-catalog.js";
import { idleCrop } from "./selection-inspector/idle-crop.test-stage.js";

const envelope: FabricThemeEnvelope = {
  schemaVersion: "2.0.0",
  fabricVersion: "7.4.0",
  id: "theme",
  metadata: { themeLanguage: "en" },
  artboard: { width: 100, height: 100 },
  scene: { version: "7.4.0", objects: [] },
};

/** One packaged family, one face per subset: the 400 arrives twice. */
const FACE = {
  role: "body",
  family: "Manrope",
  format: "woff2",
  sourceUrl: "https://example.test/manrope",
  license: { name: "OFL" },
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
    subset: "latin",
  },
  {
    ...FACE,
    id: "manrope-latin-400",
    weight: 400,
    style: "normal",
    subset: "latin",
  },
  {
    ...FACE,
    id: "manrope-latin-700-italic",
    weight: 700,
    style: "italic",
    subset: "latin",
  },
];

describe("EditorSession weight list", () => {
  it("offers one entry per weight and style from its declarations", async () => {
    const assetManager = new AssetManager();
    for (const face of FACES) {
      await assetManager.adoptFont(face, new Uint8Array([1]));
    }

    const session = new EditorSession({
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
        snapshot: vi.fn((input) => ({ ...envelope, ...input })),
        setBackground: vi.fn(),
        setBackgroundMedia: vi.fn(),
        setGlobals: vi.fn(),
        refreshGlass: vi.fn(),
      } as never,
      source: {} as never,
      envelope,
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
    });

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
});
