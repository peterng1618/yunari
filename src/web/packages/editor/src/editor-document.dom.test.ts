// @vitest-environment jsdom
import type {
  FabricThemeEnvelopeInput,
  FontCut,
  FontTrioInfo,
} from "@yunari/renderer-core";
import type { ThemeCreditsEntry } from "@yunari/theme-package";
import { describe, expect, it, vi } from "vitest";
import { AssetManager } from "./asset-manager/index.js";
import { EditorDocument } from "./editor-document.js";
import type { EditorShell } from "./editor-shell.js";
import type { HistoryGlobalsPort } from "./history-manager/index.js";
import { createNewFabricTheme } from "./new-fabric-theme.js";
import type { TypePresets } from "./type-preset-manager/index.js";

/** The host's byte route, mocked: no document test reaches a real host. */
const assetBytesMock = vi.hoisted(() => vi.fn());
vi.mock("./asset-finder/client.js", () => ({ assetBytes: assetBytesMock }));

/**
 * The document's credits collection: what an import adds, what the package it
 * opened seeded, and the one rule that makes it a collection rather than a log.
 *
 * The shell and the consumers are stubs because nothing here fans out: these
 * two methods own a list and the save path reads it.
 */
function documentWith(credits?: readonly ThemeCreditsEntry[]): EditorDocument {
  return new EditorDocument({
    source: {
      shell: {
        snapshot: (value: unknown) => value,
        editor: {
          errorManager: { report: () => {} },
          historyManager: { attachGlobals: () => {} },
        },
      } as unknown as EditorShell,
      envelope: createNewFabricTheme() as unknown as FabricThemeEnvelopeInput,
      assetManager: new AssetManager(),
      ...(credits === undefined ? {} : { credits }),
      onNew: async () => {},
      onNewFromStarter: async () => {},
      onSaved: () => {},
    },
    consumers: {} as never,
  });
}

const entry = (title: string, url: string): ThemeCreditsEntry => ({
  kind: "icon",
  title,
  license: "ISC",
  changes: "Imported unchanged",
  source: { url },
});

describe("EditorDocument credits", () => {
  it("adds each import's attribution, in arrival order", () => {
    const document = documentWith();
    expect(document.credits()).toEqual([]);

    document.addCredit(entry("house", "https://lucide.dev/icons/house"));
    document.addCredit(entry("star", "https://lucide.dev/icons/star"));

    expect(document.credits().map((credit) => credit.title)).toEqual([
      "house",
      "star",
    ]);
  });

  it("replaces the credit for the same source item rather than listing it twice", () => {
    const document = documentWith();
    document.addCredit(entry("house", "https://lucide.dev/icons/house"));
    document.addCredit({
      ...entry("house", "https://lucide.dev/icons/house"),
      license: "ISC v2",
    });

    expect(document.credits()).toHaveLength(1);
    expect(document.credits()[0]?.license).toBe("ISC v2");
  });

  it("keeps two assets' credits apart, and replaces one asset's own", () => {
    // Pruning names an asset id, so a credit that survived a re-import under
    // another asset's identity would be removed for the wrong asset.
    const document = documentWith();
    const assetA: ThemeCreditsEntry = {
      ...entry("house", "https://lucide.dev/icons/house"),
      assetId: "asset-a",
    };
    const assetB: ThemeCreditsEntry = { ...assetA, assetId: "asset-b" };
    document.addCredit(assetA);
    document.addCredit(assetB);
    expect(document.credits().map((credit) => credit.assetId)).toEqual([
      "asset-a",
      "asset-b",
    ]);

    document.addCredit({ ...assetB, license: "ISC v2" });
    expect(document.credits()).toEqual([
      assetA,
      { ...assetB, license: "ISC v2" },
    ]);
  });

  it("refuses the entry past the package's own cap, but not a repeat", () => {
    const document = documentWith();
    const first = entry("icon-0", "https://lucide.dev/icons/icon-0");
    document.addCredit(first);
    for (let index = 1; index < 256; index += 1) {
      document.addCredit(
        entry(`icon-${index}`, `https://lucide.dev/icons/${index}`),
      );
    }

    // The writer refuses a 257th entry, so the collection stops one short.
    expect(document.canAddCredit(entry("one-more", "https://x.test/1"))).toBe(
      false,
    );
    // An item already credited is a replacement, which never grows the list.
    expect(document.canAddCredit(first)).toBe(true);
  });

  it("seeds the collection from the package it opened", () => {
    const seeded = entry("house", "https://lucide.dev/icons/house");
    const document = documentWith([seeded]);

    expect(document.credits()).toEqual([seeded]);
  });
});

describe("EditorDocument globals commits", () => {
  it("records the discrete globals commits and leaves the live palette samples alone", () => {
    // A live colour gesture publishes per sample and records once at its settle
    // callback, so saving inside `setPalette` would make every sample an entry.
    // The discrete commits have no gesture to settle: they are an entry the
    // moment they are written, or they are unundoable and a later undo reverts
    // them silently.
    const saveState = vi.fn();
    const document = new EditorDocument({
      source: {
        shell: {
          snapshot: (value: unknown) => value,
          setGlobals: vi.fn(),
          setBackground: vi.fn(),
          editor: {
            errorManager: { report: () => {} },
            historyManager: { attachGlobals: () => {}, saveState },
            canvas: { getObjects: () => [] },
          },
        } as unknown as EditorShell,
        envelope: createNewFabricTheme() as unknown as FabricThemeEnvelopeInput,
        assetManager: new AssetManager(),
        onNew: async () => {},
        onNewFromStarter: async () => {},
        onSaved: () => {},
      },
      consumers: {
        palette: () => ({ render: () => {} }),
        types: () => ({ render: () => {} }),
        runtime: () => ({ setGlobals: () => {} }),
        charts: () => ({
          setGlobals: () => {},
          reassignPaletteReferences: () => {},
        }),
        newObjects: () => ({ setGlobals: () => {} }),
        selection: () => ({ setGlobals: () => {} }),
      } as never,
    });

    document.setPalette({
      accent: {
        name: "Accent",
        value: { kind: "solid", color: "rgb(200 0 0)" },
      },
    } as never);
    expect(
      saveState,
      "a live palette sample waits for its settle",
    ).not.toHaveBeenCalled();

    document.setTypes({});
    expect(saveState).toHaveBeenCalledTimes(1);

    document.deleteType("type", "other");
    expect(saveState).toHaveBeenCalledTimes(2);

    document.deletePalette("accent", "none");
    expect(saveState).toHaveBeenCalledTimes(3);
    document.destroy();
  });
});

describe("EditorDocument undo", () => {
  it("re-renders the types panel when an undo restores the globals", () => {
    let port: HistoryGlobalsPort | undefined;
    const typesRender = vi.fn();
    const setGlobals = vi.fn();
    const document = new EditorDocument({
      source: {
        shell: {
          snapshot: (value: unknown) => value,
          setGlobals,
          editor: {
            errorManager: { report: () => {} },
            historyManager: {
              attachGlobals: (attached: HistoryGlobalsPort) => {
                port = attached;
              },
            },
          },
        } as unknown as EditorShell,
        envelope: createNewFabricTheme() as unknown as FabricThemeEnvelopeInput,
        assetManager: new AssetManager(),
        onNew: async () => {},
        onNewFromStarter: async () => {},
        onSaved: () => {},
      },
      consumers: {
        palette: () => ({ render: () => {} }),
        types: () => ({ render: typesRender }),
        runtime: () => ({ setGlobals }),
        charts: () => ({ setGlobals }),
        newObjects: () => ({ setGlobals }),
        selection: () => ({ setGlobals }),
      } as never,
    });
    if (port === undefined) throw new Error("no globals port was attached");

    // A type-preset edit records an entry, so undo restores the whole bag: the
    // envelope would hold the old presets while the pane still drew the new.
    const presets = { heading: { name: "Heading", value: {} } } as never;
    port.write({ typePresets: presets });

    expect(typesRender).toHaveBeenCalledWith(presets);
    document.destroy();
  });
});

/** A document whose only state is its type presets, with stubs for the fan-out
 *  `setTypes` performs. */
function presetDocument(presets: TypePresets): {
  readonly document: EditorDocument;
  readonly onError: ReturnType<typeof vi.fn>;
} {
  const onError = vi.fn();
  const document = new EditorDocument({
    source: {
      shell: {
        snapshot: (value: unknown) => value,
        setGlobals: vi.fn(),
        editor: {
          errorManager: { report: () => {} },
          historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
        },
      } as unknown as EditorShell,
      envelope: {
        ...createNewFabricTheme(),
        globals: { typePresets: presets },
      } as unknown as FabricThemeEnvelopeInput,
      assetManager: new AssetManager(),
      onNew: async () => {},
      onNewFromStarter: async () => {},
      onSaved: () => {},
      onError,
    },
    consumers: {
      palette: () => ({ render: () => {} }),
      types: () => ({ render: () => {} }),
      runtime: () => ({ setGlobals: () => {} }),
      charts: () => ({ setGlobals: () => {} }),
      newObjects: () => ({ setGlobals: () => {} }),
      selection: () => ({ setGlobals: () => {} }),
    } as never,
  });
  return { document, onError };
}

function cutFor(
  role: "heading" | "body" | "mono",
  family: string,
  weight: number,
): FontCut {
  const url = `https://example.test/${role}.woff2`;
  return {
    id: `cut:${role}-${weight}`,
    source: "google-fonts",
    family,
    weight,
    style: "normal",
    subset: "latin",
    format: "woff2",
    previewUrl: url,
    licence: "OFL",
    sourceUrl: url,
  };
}

const trio: FontTrioInfo = {
  id: "fixture",
  name: "Fixture",
  description: "",
  roles: {
    heading: cutFor("heading", "Manrope", 700),
    body: cutFor("body", "Inter", 400),
    mono: cutFor("mono", "Fira Code", 400),
  },
};

function presetsOf(document: EditorDocument): TypePresets {
  return document.snapshot().globals?.typePresets as TypePresets;
}

describe("EditorDocument preset actions", () => {
  it("apply rewrites role presets, keeps size and creates a missing role", async () => {
    const authored: TypePresets = {
      heading: {
        name: "Heading",
        value: { family: "Segoe UI", size: 32, trioRole: "heading" },
      },
      body: {
        name: "Body",
        value: { family: "Segoe UI", size: 14, trioRole: "body" },
      },
      custom: { name: "Custom", value: { family: "Georgia", size: 19 } },
    };
    const { document } = presetDocument(authored);
    assetBytesMock.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      filename: "face.woff2",
    });

    await document.applyFontTrio(trio);

    const written = presetsOf(document);
    // An authored size survives the rewrite; a missing role is created at the
    // starter size, and an untagged preset is not touched.
    expect(written.heading?.value).toMatchObject({
      family: "Manrope",
      weight: 700,
      size: 32,
      face: { assetId: "google-fonts-cut-heading-700" },
    });
    expect(written.body?.value).toMatchObject({
      family: "Inter",
      weight: 400,
      size: 14,
    });
    expect(written.custom).toEqual(authored.custom);
    expect(written.mono).toEqual({
      name: "Mono — Fira Code",
      value: {
        family: "Fira Code",
        size: 14,
        weight: 400,
        face: { assetId: "google-fonts-cut-mono-400" },
        trioRole: "mono",
      },
    });
    // Bytes are addressed by the cut's source and id, never the trio's.
    expect(assetBytesMock).toHaveBeenCalledWith(
      "google-fonts",
      "cut:heading-700",
    );
    document.destroy();
  });

  it("add three creates Heading — X, Body — Y and Mono — Z without touching existing", async () => {
    const existing: TypePresets = {
      heading: {
        name: "Heading",
        value: { family: "Segoe UI", size: 32, trioRole: "heading" },
      },
      custom: { name: "Custom", value: { family: "Georgia", size: 19 } },
    };
    const { document } = presetDocument(existing);
    assetBytesMock.mockResolvedValue({
      bytes: new Uint8Array([1]),
      filename: "face.woff2",
    });

    await document.addTypePresetsFromTrio(trio);

    const written = presetsOf(document);
    expect(written.heading).toEqual(existing.heading);
    expect(written.custom).toEqual(existing.custom);
    expect(written["heading-2"]).toEqual({
      name: "Heading — Manrope",
      value: {
        family: "Manrope",
        size: 46,
        weight: 700,
        face: { assetId: "google-fonts-cut-heading-700" },
        trioRole: "heading",
      },
    });
    expect(written.body?.name).toBe("Body — Inter");
    expect(written.mono?.name).toBe("Mono — Fira Code");
    document.destroy();
  });

  it("a single cut creates a role-first preset", async () => {
    const { document } = presetDocument({});
    assetBytesMock.mockResolvedValue({
      bytes: new Uint8Array([1]),
      filename: "code.woff2",
    });

    const id = await document.addTypePresetFromCut(
      cutFor("mono", "Fira Code", 400),
      "mono",
    );

    expect(id).toBe("mono");
    expect(presetsOf(document).mono).toEqual({
      name: "Mono — Fira Code",
      value: {
        family: "Fira Code",
        size: 14,
        weight: 400,
        face: { assetId: "google-fonts-cut-mono-400" },
        trioRole: "mono",
      },
    });
    expect(assetBytesMock).toHaveBeenCalledWith("google-fonts", "cut:mono-400");
    document.destroy();
  });

  it("a cut with no role takes the Body name and size but no role tag", async () => {
    const { document } = presetDocument({});
    assetBytesMock.mockResolvedValue({
      bytes: new Uint8Array([1]),
      filename: "body.woff2",
    });

    const id = await document.addTypePresetFromCut(
      cutFor("body", "Inter", 400),
      null,
    );

    expect(id).toBe("body");
    const value = presetsOf(document).body?.value;
    expect(presetsOf(document).body?.name).toBe("Body — Inter");
    expect(value).toMatchObject({ family: "Inter", size: 24, weight: 400 });
    expect(value === undefined ? true : "trioRole" in value).toBe(false);
    document.destroy();
  });

  it("a failed host bytes read writes nothing and reports the failure", async () => {
    const authored: TypePresets = {
      body: {
        name: "Body",
        value: { family: "Segoe UI", size: 14, trioRole: "body" },
      },
    };
    const { document, onError } = presetDocument(authored);
    const before = document.snapshot();
    // The heading read succeeds; the body read is the one the host drops. No
    // adoption may survive that, because a half-applied trio is a theme the
    // author never chose.
    assetBytesMock
      .mockResolvedValueOnce({
        bytes: new Uint8Array([1]),
        filename: "h.woff2",
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue({ bytes: new Uint8Array([2]), filename: "m.woff2" });

    await document.runFontAction(() => document.applyFontTrio(trio));

    expect(onError).toHaveBeenCalledWith(expect.stringContaining("Inter"));
    expect(presetsOf(document)).toEqual(authored);
    expect(document.snapshot().assets).toEqual(before.assets);
    document.destroy();
  });

  it("unbinding leaves family and weight editable", async () => {
    const { document } = presetDocument({
      heading: {
        name: "Heading",
        value: {
          family: "Manrope",
          size: 46,
          weight: 700,
          face: { assetId: "face-id" },
          trioRole: "heading",
        },
      },
    });

    document.unbindPresetFace("heading");

    const value = presetsOf(document).heading?.value;
    expect(value === undefined ? true : "face" in value).toBe(false);
    expect(value).toMatchObject({ family: "Manrope", weight: 700 });
    document.destroy();
  });

  it("sets and clears a preset's role", () => {
    const { document } = presetDocument({
      custom: { name: "Custom", value: { family: "Georgia", size: 19 } },
    });

    document.setPresetRole("custom", "heading");
    expect(presetsOf(document).custom?.value.trioRole).toBe("heading");

    document.setPresetRole("custom", null);
    const value = presetsOf(document).custom?.value;
    expect(value === undefined ? true : "trioRole" in value).toBe(false);
    document.destroy();
  });
});
