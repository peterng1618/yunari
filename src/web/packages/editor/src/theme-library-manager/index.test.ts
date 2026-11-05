import type { FabricThemeEnvelope } from "@yunari/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { ThemeConflictError } from "../theme-library-client.js";
import { uiCopy } from "../ui-copy.js";
import {
  assetsWith,
  CREDITS,
  declaration,
  envelope,
  harness,
  listed,
  OTHER,
  PARENT,
  PNG,
  savedCalls,
  storedInstalled,
  UUID,
} from "./index.fixtures.js";

/** Both dialogs are React components with no node implementation, and both are
 *  answers rather than behaviour: what the author picked is the only difference
 *  between two roads through this manager. */
const selectionMock = vi.hoisted(() => vi.fn());
const conflictMock = vi.hoisted(() => vi.fn());
const saveAsMock = vi.hoisted(() => vi.fn());
vi.mock("../theme-library-dialog.js", () => ({
  promptThemeSelection: () => selectionMock(),
  promptThemeConflict: () => conflictMock(),
  promptThemeSaveAs: () => saveAsMock(),
}));

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

  it("carries the whole theme after the store removes the theme it was based on", async () => {
    // Deleting the open theme from the store leaves the document holding a base
    // whose folder is gone. Keeping it would send an asset digest the host can
    // no longer reconstruct, so the next save must be a first save: every
    // declared byte, and no base to claim.
    const assets = assetsWith([declaration("backdrop", "digest")], {
      "assets/backdrop.png": PNG,
    });
    const { manager, save } = harness({ assets, base: "living-room" });

    manager.themeRemoved("another-theme");
    expect(manager.isStored(), "another theme's removal leaves it alone").toBe(
      true,
    );

    manager.themeRemoved("living-room");
    expect(manager.isStored()).toBe(false);

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
      backgroundMedia: { badge: { bounds: "display" as const } },
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
    const [remixed, assets, base, , backgroundMedia] =
      onOpenTheme.mock.calls[0]!;
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
    expect(backgroundMedia).toEqual({ badge: { bounds: "display" } });
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
      backgroundMedia: { badge: { bounds: "theme" as const } },
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
    const [duplicated, assets, base, , backgroundMedia] =
      onOpenTheme.mock.calls[0]!;
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
    expect(backgroundMedia).toEqual({ badge: { bounds: "theme" } });
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
      undefined,
    );
    expect(manager.isStored()).toBe(true);
  });

  it("hands an opened theme's credits to the session that mounts it", async () => {
    const backgroundMedia = { badge: { bounds: "theme" as const } };
    const open = vi.fn(async () => ({
      envelope,
      assets: {},
      base: "base",
      credits: CREDITS,
      backgroundMedia,
    }));
    const { manager, onOpenTheme } = harness({ client: { open } });

    await manager.openById("living-room");

    expect(onOpenTheme).toHaveBeenCalledWith(
      envelope,
      {},
      "base",
      CREDITS.entries,
      backgroundMedia,
    );
  });

  it("sends the document's background working data with every library save", async () => {
    const backgroundMedia = { badge: { bounds: "display" as const } };
    const { manager, save } = harness({ base: "stored-base", backgroundMedia });

    await manager.save();

    expect(save.mock.calls[0]?.[1]).toMatchObject({ backgroundMedia });
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

  describe("Save as", () => {
    it("writes a new id, rebases, and leaves the theme it came from untouched", async () => {
      let current: FabricThemeEnvelope = envelope;
      saveAsMock.mockReset();
      saveAsMock.mockResolvedValue("Living room copy");
      // An asset the old theme's folder already holds: a save-as still has to
      // send it, because the new id's folder is empty and the host's check for a
      // first save is "exactly the declaration".
      const assets = assetsWith([declaration("kept", "digest-kept")], {
        "assets/kept.png": PNG,
      });
      const { manager, save, adoptIdentity, markSaved } = harness({
        assets,
        base: "stored-base",
        backgroundMedia: { kept: { bounds: "display" } },
        // The document the manager re-identifies is the one its snapshot reads
        // next, which is what makes the rebase observable rather than a claim.
        snapshot: () => current,
        adoptIdentity: (id, name) => {
          current = { ...current, id, metadata: { ...current.metadata, name } };
        },
        client: { list: async () => [listed("living-room", "2026-01-01")] },
      });

      await manager.saveAs();

      // The harness's save is a no-argument spy, so its call tuple has to be
      // read as the manager's own argument list.
      const calls = save.mock.calls as unknown as readonly [
        string,
        {
          readonly envelope: FabricThemeEnvelope;
          readonly assets: Readonly<Record<string, Uint8Array>>;
          readonly base?: string;
          readonly backgroundMedia?: Readonly<
            Record<string, { readonly bounds: string }>
          >;
        },
      ][];
      const [id, content] = calls[0]!;
      // The name's slug, not the open theme's id; the old theme is never a
      // target, which is the difference between Save as and Save.
      expect(id).toBe("living-room-copy");
      expect(content.envelope.id).toBe("living-room-copy");
      expect(content.envelope.metadata?.name).toBe("Living room copy");
      // A first save: no base, so the host takes it as a new theme, and every
      // declared byte travels even though the old folder already holds it.
      expect(content.base).toBeUndefined();
      expect(content.assets).toEqual({ "assets/kept.png": PNG });
      expect(content.backgroundMedia).toEqual({ kept: { bounds: "display" } });
      expect(adoptIdentity).toHaveBeenCalledWith(
        "living-room-copy",
        "Living room copy",
      );
      expect(markSaved).toHaveBeenCalledWith(content.envelope, {
        "assets/kept.png": PNG,
      });
      expect(manager.isStored()).toBe(true);
      // The next Save is the new theme's.
      await manager.save();
      expect(calls[1]?.[0]).toBe("living-room-copy");
      expect(
        calls.some(([target]) => target === "living-room"),
        "save-as wrote over the theme it came from",
      ).toBe(false);
    });

    it("moves a taken slug aside instead of asking to replace it", async () => {
      saveAsMock.mockReset();
      saveAsMock.mockResolvedValue("Kitchen");
      const { manager, save } = harness({
        client: {
          list: async () => [
            listed("kitchen", "2026-01-01"),
            listed("kitchen-2", "2026-01-02"),
          ],
        },
      });

      await manager.saveAs();

      const calls = save.mock.calls as unknown as readonly [string][];
      expect(calls[0]?.[0]).toBe("kitchen-3");
    });

    it("writes nothing when the name question is dismissed", async () => {
      saveAsMock.mockReset();
      saveAsMock.mockResolvedValue(undefined);
      const { manager, save, adoptIdentity, markSaved, onSaved } = harness({});

      await manager.saveAs();

      expect(save).not.toHaveBeenCalled();
      expect(adoptIdentity).not.toHaveBeenCalled();
      expect(markSaved).not.toHaveBeenCalled();
      expect(onSaved).not.toHaveBeenCalled();
    });

    it("speaks the host's refusal and changes nothing", async () => {
      saveAsMock.mockReset();
      saveAsMock.mockResolvedValue("Kitchen");
      const { manager, adoptIdentity, markSaved, onError } = harness({
        client: {
          list: async () => [],
          save: async () => {
            throw new Error("no room on this PC.");
          },
        },
      });

      await manager.saveAs();

      expect(onError).toHaveBeenCalledWith(
        "Could not save to library: no room on this PC.",
      );
      // The document is still the one it was: no new identity and no saved mark.
      expect(adoptIdentity).not.toHaveBeenCalled();
      expect(markSaved).not.toHaveBeenCalled();
      expect(manager.isStored()).toBe(false);
    });
  });

  describe("Open recent", () => {
    it("opens the newest stored theme that is not the open document", async () => {
      const open = vi.fn(async () => ({
        envelope,
        assets: {},
        base: "base-from-open",
      }));
      const { manager, onOpenTheme } = harness({
        snapshot: () => ({ ...envelope, id: "current" }),
        client: {
          list: async () => [
            listed("older", "2026-01-01T00:00:00.000Z"),
            listed("current", "2026-03-01T00:00:00.000Z"),
            listed("newest", "2026-02-01T00:00:00.000Z"),
          ],
          open,
          save: async () => "base",
        },
      });

      await manager.openRecent();

      // `current` is the newest by time, but it is the document already open.
      expect(open).toHaveBeenCalledWith("newest");
      // The open travels through `openById`, so the base arrives with it.
      expect(onOpenTheme).toHaveBeenCalledWith(
        envelope,
        {},
        "base-from-open",
        undefined,
        undefined,
      );
    });

    it("asks before replacing a dirty document, and a refusal reads nothing", async () => {
      const open = vi.fn(async () => ({ envelope, assets: {}, base: "base" }));
      const { manager, onOpenTheme } = harness({
        confirm: async () => false,
        client: {
          list: async () => [listed("other", "2026-01-01T00:00:00.000Z")],
          open,
          save: async () => "base",
        },
      });

      await manager.openRecent();

      expect(open).not.toHaveBeenCalled();
      expect(onOpenTheme).not.toHaveBeenCalled();
    });

    it("says there is nothing to open rather than doing nothing", async () => {
      const { manager, onError } = harness({
        client: { list: async () => [] },
      });

      await manager.openRecent();

      expect(onError).toHaveBeenCalledWith(uiCopy.library.noOtherTheme);
    });

    it("does not count the open document as recent", async () => {
      const { manager, onError } = harness({
        client: {
          list: async () => [listed("living-room", "2026-01-01T00:00:00.000Z")],
        },
      });

      await manager.openRecent();

      expect(onError).toHaveBeenCalledWith(uiCopy.library.noOtherTheme);
    });
  });
});
