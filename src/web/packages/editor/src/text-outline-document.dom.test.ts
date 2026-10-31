// @vitest-environment jsdom

import type { FabricThemeEnvelopeInput } from "@yunari/renderer-core";
import { Group, Textbox } from "fabric/es";
import { describe, expect, it, vi } from "vitest";

// A deterministic glyph: the conversion's layout is Fabric's, and this only
// needs outlines that parse.
vi.mock("fontkit", () => ({
  create: () => ({
    unitsPerEm: 1000,
    hasGlyphForCodePoint: () => true,
    glyphForCodePoint: () => ({
      path: { transform: () => ({ toSVG: () => "M0 0L10 0L10 10Z" }) },
    }),
  }),
}));

import type { AssetManager } from "./asset-manager/index.js";
import { EditorDocument } from "./editor-document.js";
import type { EditorShell } from "./editor-shell.js";
import { createNewFabricTheme } from "./new-fabric-theme.js";
import { uiCopy } from "./ui-copy.js";

const FACE = {
  id: "inter-400",
  kind: "font" as const,
  path: "assets/inter-400.woff2",
  family: "Inter",
  weight: 400,
  style: "normal" as const,
  format: "woff2" as const,
};

function documentWith(font = true) {
  const text = new Textbox("AB", {
    id: "title",
    left: 40,
    top: 30,
    fontSize: 100,
    fontFamily: "Inter",
    fontWeight: 400,
    fill: "#ffffff",
  });
  const objects: unknown[] = [text];
  let active: unknown = text;
  const canvas = {
    getObjects: () => objects,
    getActiveObject: () => active,
    discardActiveObject: () => {
      active = undefined;
    },
    remove: (object: unknown) => {
      const at = objects.indexOf(object);
      if (at >= 0) objects.splice(at, 1);
    },
    insertAt: (index: number, object: unknown) => {
      objects.splice(index, 0, object);
    },
    setActiveObject: (object: unknown) => {
      active = object;
    },
    requestRenderAll: () => undefined,
  };
  const saveState = vi.fn();
  const warn = vi.fn();
  const assets = {
    declarations: font ? [FACE] : [],
    assets: font ? { [FACE.path]: new Uint8Array([1]) } : {},
    mutationCount: 0,
  } as unknown as AssetManager;
  const envelope = {
    ...createNewFabricTheme(),
    bindings: { title: [] },
  } as unknown as FabricThemeEnvelopeInput;
  const document = new EditorDocument({
    source: {
      shell: {
        snapshot: (value: unknown) => value,
        editor: {
          canvas,
          errorManager: { warn },
          historyManager: { attachGlobals: () => undefined, saveState },
        },
      } as unknown as EditorShell,
      envelope,
      assetManager: assets,
      onNew: async () => undefined,
      onNewFromStarter: async () => undefined,
      onSaved: () => undefined,
    },
    consumers: {
      runtime: () => ({ setBindings: () => undefined }),
      charts: () => ({ setBindings: () => undefined }),
    } as never,
  });
  return { document, objects, saveState, warn };
}

describe("EditorDocument.outlineText", () => {
  it("swaps the text for a path group and drops its binding", () => {
    const { document, objects, saveState, warn } = documentWith();
    document.outlineText();

    expect(warn).not.toHaveBeenCalled();
    expect(objects).toHaveLength(1);
    const group = objects[0] as Group;
    expect(group).toBeInstanceOf(Group);
    expect(group.get("id")).toBe("title");
    expect(group.getObjects()).toHaveLength(2);
    expect(document.envelope.bindings).toBeUndefined();
    expect(saveState).toHaveBeenCalledTimes(1);
  });

  it("reports a refusal and leaves the scene alone", () => {
    const { document, objects, saveState, warn } = documentWith(false);
    document.outlineText();

    expect(objects).toHaveLength(1);
    expect(objects[0]).toBeInstanceOf(Textbox);
    expect(warn).toHaveBeenCalledWith("outline", uiCopy.outline.noFont);
    expect(saveState).not.toHaveBeenCalled();
  });
});
