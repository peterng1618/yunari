// @vitest-environment jsdom
import type { FabricThemeEnvelopeInput } from "@yunari/renderer-core";
import type { ThemeCreditsEntry } from "@yunari/theme-package";
import { describe, expect, it, vi } from "vitest";
import { AssetManager } from "./asset-manager/index.js";
import { EditorDocument } from "./editor-document.js";
import type { EditorShell } from "./editor-shell.js";
import type { HistoryGlobalsPort } from "./history-manager/index.js";
import { createNewFabricTheme } from "./new-fabric-theme.js";

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
    expect(document.credits()).toEqual([assetA, { ...assetB, license: "ISC v2" }]);
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
