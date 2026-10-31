import type { FabricThemeEnvelope } from "@yunari/renderer-core";
import type { ThemeCredits, ThemeCreditsEntry } from "@yunari/theme-package";
import { describe, expect, it, vi } from "vitest";
import {
  AssetManager,
  type LocalAssetReference,
} from "../asset-manager/index.js";
import type { CleanupAnswer } from "../editor-document.js";
import type { ErrorManager } from "../error-manager/index.js";
import {
  ThemeConflictError,
  type ThemeLibraryClient,
} from "../theme-library-client.js";
import { ThemeLibraryManager } from "./index.js";

/** Both dialogs are React components with no node implementation, and both are
 *  answers rather than behaviour: what the author picked is the only difference
 *  between two roads through this manager. */
const selectionMock = vi.hoisted(() => vi.fn());
const conflictMock = vi.hoisted(() => vi.fn());
vi.mock("../theme-library-dialog.js", () => ({
  promptThemeSelection: () => selectionMock(),
  promptThemeConflict: () => conflictMock(),
}));

const envelope: FabricThemeEnvelope = {
  schemaVersion: "2.0.0",
  fabricVersion: "7.4.0",
  id: "living-room",
  artboard: { width: 1920, height: 1080 },
  scene: { version: "7.4.0", objects: [] },
};

/** An installed theme as the library stored it: it declares everything the
 *  remix has to drop, including a credit of its own — a saved remix has no
 *  host origin record, so the chooser offers it Duplicate. */
const storedInstalled: FabricThemeEnvelope = {
  ...envelope,
  metadata: {
    name: "Primary",
    author: "Ada",
    version: "1.2.0",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
    themeLanguage: "en",
    remixOf: {
      catalogueId: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f2a3b4c5d",
      name: "Ancestor",
      version: "1.0.0",
    },
  },
};

const PARENT = {
  catalogueId: "5f0c4f30-0f8c-4e4f-9c1f-1f0f0f0f0f0f",
  name: "Primary",
  version: "1.2.0",
} as const;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PNG = new Uint8Array([137, 80, 78, 71]);
const OTHER = new Uint8Array([137, 80, 78, 72]);
const CREDITS: ThemeCredits = {
  format: "yunari-theme-credits",
  version: 1,
  entries: [
    {
      kind: "icon",
      title: "Badge",
      license: "ISC v2",
      changes: "Imported unchanged",
    },
  ],
};

function declaration(id: string, sha256: string): LocalAssetReference {
  return { id, kind: "image", path: `assets/${id}.png`, sha256 };
}

/** A manager holding these declarations, as the shell hands one over once it
 *  has revived the document's scene. */
function assetsWith(
  declarations: readonly LocalAssetReference[],
  bytes: Readonly<Record<string, Uint8Array>>,
): AssetManager {
  const assets = new AssetManager();
  assets.load({ assets: declarations }, bytes);
  return assets;
}

/** What a request body carries, kept in one place so a test asserts on the save
 *  rather than on a transcription of it. */
interface SaveCall {
  readonly id: string;
  readonly base: string | undefined;
  readonly assets: Readonly<Record<string, Uint8Array>>;
  readonly overwrite: boolean;
}

function savedCalls(save: ReturnType<typeof vi.fn>): SaveCall[] {
  return save.mock.calls.map(([id, content, options]) => ({
    id: id as string,
    base: (content as { readonly base?: string }).base,
    assets: (
      content as { readonly assets: Readonly<Record<string, Uint8Array>> }
    ).assets,
    overwrite: (options as { readonly overwrite: boolean }).overwrite,
  }));
}

function harness(options: {
  readonly assets?: AssetManager;
  readonly base?: string;
  readonly picture?: () => Promise<Uint8Array | undefined>;
  readonly client?: Partial<ThemeLibraryClient>;
  /** The answer to the replacement question. `true` unless a case is about the
   *  refusal, which is the one road that reads nothing. */
  readonly confirm?: () => Promise<boolean>;
  /** The document's cleanup question, which this manager asks before writing.
   *  Nothing unused by default, so an existing case is not about it. */
  readonly cleanup?: () => Promise<CleanupAnswer>;
  readonly credits?: () => ThemeCredits | undefined;
}) {
  const save = vi.fn(async () => "base-after-save");
  const open = vi.fn(async () => ({
    envelope,
    assets: {},
    base: "base-from-open",
  }));
  const saveThumbnail = vi.fn(async () => {});
  // Spies rather than inert stubs: the manager calls neither, and a test that
  // means to forbid a call can read that off them rather than trusting a
  // default that would resolve either way.
  const assign = vi.fn(async () => undefined);
  const listDisplays = vi.fn(async () => ({ default: null, displays: [] }));
  const markSaved = vi.fn();
  const announceChange = vi.fn();
  const warn = vi.fn();
  const onSaved = vi.fn();
  const onError = vi.fn();
  const onNewFromStarter = vi.fn(async () => {});
  const onOpenTheme = vi.fn<
    (
      envelope: FabricThemeEnvelope,
      assets: Readonly<Record<string, Uint8Array>>,
      base?: string,
      credits?: readonly ThemeCreditsEntry[],
    ) => Promise<void>
  >(async () => {});
  const errors: ErrorManager = { error: vi.fn(), warn };
  // Built before the manager so the harness can hand back the very client it
  // wired: the defaults above are not what the manager received once an
  // override lands, and asserting on one of them would pass for the wrong
  // reason.
  const client: ThemeLibraryClient = {
    list: async () => [],
    open,
    save,
    saveThumbnail,
    assign,
    listDisplays,
    ...options.client,
  };
  const manager = new ThemeLibraryManager({
    snapshot: () => envelope,
    assets: options.assets ?? assetsWith([], {}),
    ...(options.credits === undefined ? {} : { credits: options.credits }),
    picture: options.picture ?? (async () => undefined),
    markSaved,
    announceChange,
    errors,
    confirmReplacement: options.confirm ?? (async () => true),
    confirmCleanup: options.cleanup ?? (async () => ({ proceed: true })),
    onSaved,
    onNewFromStarter,
    client,
    onError,
    onOpenTheme,
    ...(options.base === undefined ? {} : { base: options.base }),
  });
  return {
    manager,
    client,
    save,
    saveThumbnail,
    markSaved,
    announceChange,
    warn,
    onSaved,
    onError,
    onNewFromStarter,
    onOpenTheme,
  };
}

describe("ThemeLibraryManager", () => {
  it("holds the stored base only while the document descends from one", () => {
    // The base is the claim that this document is the one stored. A document
    // opened from a package, or created here, descends from nothing and must
    // not save as though it were the stored theme.
    expect(harness({ base: "stored-base" }).manager.isStored()).toBe(true);
    expect(harness({}).manager.isStored()).toBe(false);

    const { manager } = harness({ base: "stored-base" });
    manager.forget();
    expect(manager.isStored()).toBe(false);
  });

  it("sends only the bytes the stored folder does not already hold", async () => {
    // The whole reason a base carries its hashes: a declared `sha256` that has
    // not moved is proof the bytes have not either, so a backdrop the author
    // never touched is not uploaded again.
    const assets = assetsWith([declaration("kept", "digest-kept")], {
      "assets/kept.png": PNG,
    });
    const { manager, save } = harness({ assets, base: "stored-base" });
    // The author swaps an asset while the document is open, which is the only
    // thing that can move a declaration's digest.
    assets.load(
      { assets: [declaration("swapped", "digest-new")] },
      {
        "assets/swapped.png": OTHER,
      },
    );

    await manager.save();

    expect(savedCalls(save)).toEqual([
      {
        id: "living-room",
        base: "stored-base",
        assets: { "assets/swapped.png": OTHER },
        overwrite: false,
      },
    ]);
  });

  it("carries the whole theme when there is no stored document to build on", async () => {
    const assets = assetsWith([declaration("backdrop", "digest-backdrop")], {
      "assets/backdrop.png": PNG,
    });
    const { manager, save } = harness({ assets });

    await manager.save();

    expect(savedCalls(save)).toEqual([
      {
        id: "living-room",
        base: undefined,
        assets: { "assets/backdrop.png": PNG },
        overwrite: false,
      },
    ]);
  });

  it("says a refused save did not happen, in the editor's own words, and keeps the document", async () => {
    const { manager, onError, markSaved, onSaved, announceChange } = harness({
      assets: assetsWith([declaration("backdrop", "digest")], {
        "assets/backdrop.png": PNG,
      }),
      base: "stored-base",
      client: {
        list: async () => [],
        open: async () => ({ envelope, assets: {} }),
        save: async () => {
          throw new ThemeConflictError("the stored theme moved on");
        },
      },
    });
    conflictMock.mockResolvedValue(undefined);

    await manager.save();

    expect(onError).toHaveBeenCalledWith(
      "Could not save to library: the stored theme moved on",
    );
    // Nothing was written, so nothing reads as saved and the document is still
    // the author's.
    expect(markSaved).not.toHaveBeenCalled();
    expect(announceChange).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("saves nothing when the cleanup question is cancelled", async () => {
    const { manager, save, markSaved, onSaved, onError } = harness({
      assets: assetsWith([declaration("backdrop", "digest")], {
        "assets/backdrop.png": PNG,
      }),
      cleanup: async () => ({ proceed: false }),
    });

    await manager.save();

    expect(save).not.toHaveBeenCalled();
    expect(markSaved).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    // A cancel carries no message: nothing was refused, the author said no.
    expect(onError).not.toHaveBeenCalled();
  });

  it("prints a refused trash unwrapped and writes nothing", async () => {
    const { manager, save, markSaved, onError } = harness({
      assets: assetsWith([declaration("backdrop", "digest")], {
        "assets/backdrop.png": PNG,
      }),
      cleanup: async () => ({
        proceed: false,
        message: "The Recycle Bin is not available on this machine.",
      }),
    });

    await manager.save();

    expect(save).not.toHaveBeenCalled();
    expect(markSaved).not.toHaveBeenCalled();
    // The host's sentence, not "Could not save to library: …" around it.
    expect(onError).toHaveBeenCalledWith(
      "The Recycle Bin is not available on this machine.",
    );
  });

  it("overwrites deliberately when that is the answer about a refused save", async () => {
    // The second road takes the same road the refused one did — the same
    // declared bytes, and the same move of the base onto what was written —
    // with the host's guard stood down for this one save.
    const save = vi
      .fn(async () => "base-after-overwrite")
      .mockRejectedValueOnce(new ThemeConflictError("stale"));
    const assets = assetsWith([declaration("backdrop", "digest")], {
      "assets/backdrop.png": PNG,
    });
    const { manager, onSaved, markSaved } = harness({
      assets,
      base: "stored-base",
      client: {
        list: async () => [],
        open: async () => ({ envelope, assets: {} }),
        save,
      },
    });
    conflictMock.mockResolvedValue("overwrite");

    await manager.save();

    expect(savedCalls(save)).toEqual([
      {
        id: "living-room",
        base: "stored-base",
        assets: {},
        overwrite: false,
      },
      {
        id: "living-room",
        base: "stored-base",
        assets: { "assets/backdrop.png": PNG },
        overwrite: true,
      },
    ]);
    expect(markSaved).toHaveBeenCalledWith(envelope, {
      "assets/backdrop.png": PNG,
    });
    expect(onSaved).toHaveBeenCalledWith("Saved to library");
  });

  it("reloads the stored document when that is the answer, and hands it on with its base", async () => {
    const save = vi
      .fn(async () => "base-after-save")
      .mockRejectedValueOnce(new ThemeConflictError("stale"));
    const open = vi.fn(async () => ({
      envelope,
      assets: { "assets/backdrop.png": PNG },
      base: "base-from-reload",
    }));
    const { manager, onOpenTheme } = harness({
      base: "stored-base",
      client: { list: async () => [], open, save },
    });
    conflictMock.mockResolvedValue("reload");

    await manager.save();

    expect(open).toHaveBeenCalledWith("living-room");
    expect(onOpenTheme).toHaveBeenCalledWith(
      envelope,
      { "assets/backdrop.png": PNG },
      "base-from-reload",
      undefined,
    );
  });

  it("opens a template as a new document rather than claiming it is stored", async () => {
    const { manager, onNewFromStarter, onOpenTheme } = harness({
      base: "stored-base",
    });
    selectionMock.mockResolvedValue({ kind: "template", id: "starter" });

    await manager.open();

    expect(onNewFromStarter).toHaveBeenCalled();
    expect(onOpenTheme).not.toHaveBeenCalled();
    expect(manager.isStored()).toBe(false);
  });

  it("opens a stored theme under the base its own read came from", async () => {
    const open = vi.fn(async () => ({
      envelope,
      assets: { "assets/backdrop.png": PNG },
      base: "base-from-open",
    }));
    const { manager, onOpenTheme } = harness({
      client: { list: async () => [], open, save: async () => "base" },
    });
    selectionMock.mockResolvedValue({ kind: "theme", id: "living-room" });

    await manager.open();

    expect(onOpenTheme).toHaveBeenCalledWith(
      envelope,
      { "assets/backdrop.png": PNG },
      "base-from-open",
      undefined,
    );
    expect(manager.isStored()).toBe(true);
  });

  it("opens a remix as a new document under a fresh id, crediting its parent", async () => {
    // A remix forks: the copy descends from nothing the library holds, so it
    // mounts with no base, and the parent is recorded at the fork rather than
    // left to be guessed from whatever the author does next.
    const open = vi.fn(async () => ({
      envelope: storedInstalled,
      assets: { "assets/backdrop.png": PNG },
      base: "base-from-open",
    }));
    const { manager, onOpenTheme } = harness({
      base: "stored-base",
      client: { list: async () => [], open, save: async () => "base" },
    });
    selectionMock.mockResolvedValue({
      kind: "remix",
      id: "living-room",
      remixOf: PARENT,
    });

    await manager.open();

    expect(open).toHaveBeenCalledWith("living-room");
    expect(onOpenTheme).toHaveBeenCalledOnce();
    const [remixed, assets, base] = onOpenTheme.mock.calls[0]!;
    expect(remixed.id).toMatch(UUID);
    expect(remixed.id).not.toBe("living-room");
    expect(remixed.metadata?.remixOf).toEqual(PARENT);
    expect(remixed.metadata?.name).toBe("Primary (remix)");
    // Provenance belongs to the parent; the fork is a first version of its own.
    expect(remixed.metadata).not.toHaveProperty("version");
    expect(remixed.metadata).not.toHaveProperty("author");
    expect(remixed.metadata).not.toHaveProperty("createdAt");
    expect(remixed.metadata).not.toHaveProperty("updatedAt");
    // Its language is not provenance, so it travels with the document.
    expect(remixed.metadata?.themeLanguage).toBe("en");
    expect(assets).toEqual({ "assets/backdrop.png": PNG });
    expect(base).toBeUndefined();
    expect(manager.isStored()).toBe(false);
  });

  it("keeps the base when handing a remix over fails, so the open document stays gated", async () => {
    // The base belongs to the document on screen. Clearing it before the new
    // document is mounted would leave a failed handover ungated — the document
    // was never replaced, so its next save must still be checked against what
    // the library holds (`vg-642`).
    const open = vi.fn(async () => ({
      envelope: storedInstalled,
      assets: {},
      base: "base-from-open",
    }));
    const { manager, onError, onOpenTheme } = harness({
      base: "stored-base",
      client: { list: async () => [], open, save: async () => "base" },
    });
    onOpenTheme.mockRejectedValueOnce(new Error("mount failed"));
    selectionMock.mockResolvedValue({
      kind: "remix",
      id: "living-room",
      remixOf: PARENT,
    });

    await manager.open();

    expect(onError).toHaveBeenCalledWith("mount failed");
    expect(manager.isStored()).toBe(true);
  });

  it("opens a duplicate as a new document under a fresh id, with no credit", async () => {
    // A duplicate is a copy, not a fork with provenance: the host knows no
    // catalogue parent, so the document names none and keeps its own name.
    const open = vi.fn(async () => ({
      envelope: storedInstalled,
      assets: { "assets/backdrop.png": PNG },
      base: "base-from-open",
    }));
    const { manager, onOpenTheme } = harness({
      base: "stored-base",
      client: { list: async () => [], open, save: async () => "base" },
    });
    selectionMock.mockResolvedValue({
      kind: "duplicate",
      id: "living-room",
    });

    await manager.open();

    expect(open).toHaveBeenCalledWith("living-room");
    expect(onOpenTheme).toHaveBeenCalledOnce();
    const [duplicated, assets, base] = onOpenTheme.mock.calls[0]!;
    expect(duplicated.id).toMatch(UUID);
    expect(duplicated.id).not.toBe("living-room");
    expect(duplicated.metadata?.name).toBe("Primary");
    expect(duplicated.metadata).not.toHaveProperty("remixOf");
    // Provenance belongs to the stored copy; the duplicate is a first version.
    expect(duplicated.metadata).not.toHaveProperty("version");
    expect(duplicated.metadata).not.toHaveProperty("author");
    expect(duplicated.metadata).not.toHaveProperty("createdAt");
    expect(duplicated.metadata).not.toHaveProperty("updatedAt");
    // Its language is not provenance, so it travels with the document.
    expect(duplicated.metadata?.themeLanguage).toBe("en");
    expect(assets).toEqual({ "assets/backdrop.png": PNG });
    expect(base).toBeUndefined();
    expect(manager.isStored()).toBe(false);
  });

  it("opens one stored theme by id, under the base its own read came from", async () => {
    // The store's own route: the theme is already named, so there is no chooser
    // to draw — and the base still travels with the document, or the save that
    // follows the open is ungated and replaces what the library holds (`vg-642`).
    const open = vi.fn(async () => ({
      envelope,
      assets: { "assets/backdrop.png": PNG },
      base: "base-from-open",
    }));
    const { manager, onOpenTheme } = harness({
      client: { list: async () => [], open, save: async () => "base" },
    });

    await manager.openById("living-room");

    expect(open).toHaveBeenCalledWith("living-room");
    expect(selectionMock).not.toHaveBeenCalled();
    expect(onOpenTheme).toHaveBeenCalledWith(
      envelope,
      { "assets/backdrop.png": PNG },
      "base-from-open",
      undefined,
    );
    expect(manager.isStored()).toBe(true);
  });

  it("hands an opened theme's credits to the session that mounts it", async () => {
    const open = vi.fn(async () => ({
      envelope,
      assets: {},
      base: "base",
      credits: CREDITS,
    }));
    const { manager, onOpenTheme } = harness({ client: { open } });

    await manager.openById("living-room");

    expect(onOpenTheme).toHaveBeenCalledWith(
      envelope,
      {},
      "base",
      CREDITS.entries,
    );
  });

  it("sends the credits it holds with every library save", async () => {
    const { manager, save } = harness({
      base: "stored-base",
      credits: () => CREDITS,
    });

    await manager.save();

    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(
      "living-room",
      expect.objectContaining({ credits: CREDITS }),
      expect.anything(),
    );
  });

  it("asks before replacing the open document, and a refusal reads nothing", async () => {
    // Opening a library theme over the open document replaces it, so the
    // question the picker used to be asked in front of is this route's — and a
    // document that is not replaced is not read either.
    const open = vi.fn(async () => ({ envelope, assets: {}, base: "base" }));
    const { manager, onOpenTheme } = harness({
      confirm: async () => false,
      client: { list: async () => [], open, save: async () => "base" },
    });

    await manager.openById("living-room");

    expect(open).not.toHaveBeenCalled();
    expect(onOpenTheme).not.toHaveBeenCalled();
  });

  it("reports the accepted replacement between the question and the read", async () => {
    // The store leaves its own mode on this callback (A.7d, F2), so its two
    // halves are the claim: a cancelled question must move no surface, and an
    // agreed one has to move it before the document is read — a mount that
    // happens first measures a body that is still `hidden`.
    const order: string[] = [];
    const open = vi.fn(async () => {
      order.push("read");
      return { envelope, assets: {}, base: "base-from-open" };
    });
    const client = { list: async () => [], open, save: async () => "base" };

    const refused = harness({ confirm: async () => false, client });
    await refused.manager.openById("living-room", () => order.push("accepted"));
    expect(order).toEqual([]);

    const agreed = harness({ confirm: async () => true, client });
    await agreed.manager.openById("living-room", () => order.push("accepted"));
    expect(order).toEqual(["accepted", "read"]);
  });

  it("stores the picture beside the document, and a picture that fails does not fail the save", async () => {
    const test = harness({ picture: async () => PNG });
    test.saveThumbnail.mockRejectedValueOnce(new Error("no room"));

    await test.manager.save();

    expect(test.saveThumbnail).toHaveBeenCalledWith("living-room", PNG);
    expect(test.warn).toHaveBeenCalledWith(
      "theme-library",
      "Saved, but the library picture failed: no room",
    );
    // The picture is a preview of the theme, so losing it costs the preview and
    // not the theme.
    expect(test.onSaved).toHaveBeenCalledWith("Saved to library");
    expect(test.onError).not.toHaveBeenCalled();
  });

  it("hands back the client it wired, overrides included", () => {
    // The handle a case asserts on has to be the one the manager received. A
    // default spy returned beside an overridden client would let
    // `expect(result.assign).not.toHaveBeenCalled()` pass while the manager held
    // a different function entirely.
    const custom = vi.fn(async () => undefined);
    const { client } = harness({ client: { assign: custom } });

    expect(client.assign).toBe(custom);
  });
});
