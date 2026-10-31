// @vitest-environment jsdom

/**
 * The manager's key, and the prompt that asks before a document is replaced.
 *
 * **jsdom is here for the prompt, and jsdom is why this journey is new.** It
 * implements neither `<dialog>`'s `showModal` nor its top layer, so the
 * hand-built prompt could not be driven outside a browser at all — the reason
 * `editor-session.dom.test.ts` mocks it. The React `Dialog` needs no browser API
 * the shims below do not already supply, so the three answers, the dismissal and
 * the focus return are assertable here.
 */

import { readThemePackage } from "@yunari/theme-package";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { uiCopy } from "../ui-copy.js";
import {
  confirmDocumentReplacement,
  documentKey,
  PersistenceManager,
} from "./index.js";

// Base UI's modal needs the three browser APIs jsdom has none of, the same three
// `theme-library-dialog.dom.test.ts` supplies, for the same reason.
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

beforeAll(() => {
  const matches = Element.prototype.matches;
  Element.prototype.matches = Object.assign(function (
    this: Element,
    selector: string,
  ): boolean {
    if (selector === ":modal" || selector === ":popover-open") return false;
    return matches.call(this, selector);
  }, matches);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const baseline = {
  schemaVersion: "2.0.0",
  fabricVersion: "7.4.0",
  id: "theme",
  artboard: { width: 1, height: 1 },
  metadata: { themeLanguage: "en" },
  globals: {
    typeTokens: {
      heading: { family: "system-ui, sans-serif", weight: "600" },
      body: { family: "system-ui, sans-serif", weight: "400" },
      mono: { family: "monospace", weight: "400" },
    },
  },
  scene: { version: "7.4.0", objects: [] },
} as const;

/** A document that declares one asset, as `AssetManager` writes it. */
const withAsset = (sha256: string, path = "assets/logo.png") => ({
  ...baseline,
  assets: [declared(path, sha256)],
});
const declared = (path: string, sha256: string) => ({
  id: path.replace("assets/", "").replace(".png", ""),
  kind: "image" as const,
  path,
  sha256,
});
const logo = new Uint8Array([1, 2, 3, 4]);

describe("PersistenceManager", () => {
  it("detects authored scene, envelope, and asset-byte changes", () => {
    const persistence = new PersistenceManager(baseline, {});

    expect(persistence.isDirty(baseline, {})).toBe(false);
    expect(
      persistence.isDirty(
        {
          ...baseline,
          scene: {
            ...baseline.scene,
            objects: [{ type: "Rect", id: "panel" }],
          },
        },
        {},
      ),
    ).toBe(true);
    expect(
      persistence.isDirty(
        {
          ...baseline,
          metadata: { name: "Renamed theme" },
        },
        {},
      ),
    ).toBe(true);
    expect(
      persistence.isDirty(baseline, { "assets/logo.png": new Uint8Array([1]) }),
    ).toBe(true);
  });

  it("saves empty-asset themes as valid .yunari-theme packages", async () => {
    let downloaded: { name: string; bytes: Uint8Array } | undefined;
    const manager = new PersistenceManager(
      baseline,
      {},
      {
        downloader: (name, bytes) => {
          downloaded = { name, bytes };
        },
      },
    );

    const changedEnvelope = {
      ...baseline,
      id: "living-room",
      metadata: { name: "Living Room", themeLanguage: "en" },
    };

    await manager.save(changedEnvelope, {});
    expect(downloaded?.name).toBe("living-room.yunari-theme");
    expect(readThemePackage(downloaded!.bytes)).toMatchObject({
      ok: true,
      envelope: changedEnvelope,
    });
    expect(manager.isDirty(changedEnvelope, {})).toBe(false);
  });

  it("ships the credits member beside the theme", async () => {
    let downloaded: Uint8Array | undefined;
    const manager = new PersistenceManager(
      baseline,
      {},
      {
        downloader: (_name, bytes) => {
          downloaded = bytes;
        },
      },
    );
    const credits = {
      format: "yunari-theme-credits" as const,
      version: 1 as const,
      entries: [
        {
          kind: "icon",
          title: "house",
          license: "ISC",
          changes: "Imported unchanged",
          source: { url: "https://lucide.dev/icons/house" },
        },
      ],
    };

    await manager.save(baseline, {}, undefined, credits);

    const read = readThemePackage(downloaded!);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.credits).toEqual(credits);
  });

  it("ships the picture in the downloaded package, and does not track it", async () => {
    let downloaded: { name: string; bytes: Uint8Array } | undefined;
    const manager = new PersistenceManager(
      baseline,
      {},
      {
        downloader: (name, bytes) => {
          downloaded = { name, bytes };
        },
      },
    );
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1,
    ]);

    await manager.save(baseline, {}, png);
    const read = readThemePackage(downloaded!.bytes);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.thumbnail).toEqual(png);

    // A picture is a rendering of one machine, not authored state.
    expect(manager.isDirty(baseline, {})).toBe(false);
  });

  it("marks theme as clean after remote save", () => {
    const manager = new PersistenceManager(baseline, {});
    const changed = { ...baseline, id: "changed" };
    expect(manager.isDirty(changed, {})).toBe(true);
    manager.markSaved(changed, {});
    expect(manager.isDirty(changed, {})).toBe(false);
  });

  it("reads a document with nothing saved behind it as unsaved, until a save gives it a baseline", () => {
    // A restored draft (`vg-040`): the work exists in the editor and in the
    // draft, so it is unsaved even though the document has not moved since it
    // mounted. The first save is what makes it clean.
    const manager = new PersistenceManager(baseline, {}, { unsaved: true });
    expect(manager.isDirty(baseline, {})).toBe(true);

    manager.markSaved(baseline, {});
    expect(manager.isDirty(baseline, {})).toBe(false);
  });

  it("detects a one-byte change in an asset's content", () => {
    const manager = new PersistenceManager(withAsset("a".repeat(64)), {
      "assets/logo.png": logo,
    });

    expect(
      manager.isDirty(withAsset("b".repeat(64)), {
        "assets/logo.png": new Uint8Array([1, 2, 3, 5]),
      }),
    ).toBe(true);
  });

  it("is not made dirty by asset bytes arriving after it was built", () => {
    // The Starter's one declared asset is a backdrop whose bytes land after the
    // manager is constructed. Enumerating the loaded map made the key a function
    // of how much had loaded, so an untouched theme asked to save work nobody did
    // — the prompt vg-026 was filed about.
    const document = withAsset("a".repeat(64));
    const before = documentKey(document, {});
    const after = documentKey(document, {
      "assets/logo.png": new Uint8Array([1, 2, 3, 5]),
    });
    expect(before).toBe(after);

    const manager = new PersistenceManager(document, {});
    expect(
      manager.isDirty(document, {
        "assets/logo.png": new Uint8Array([1, 2, 3, 5]),
      }),
    ).toBe(false);
  });

  it("still moves the key when the bytes disagree with the declared digest", () => {
    // The union keeps undeclared bytes visible, and a declared path keeps its
    // digest, so replacing an asset is caught by the digest the envelope carries.
    const document = withAsset("a".repeat(64));
    const manager = new PersistenceManager(document, {
      "assets/logo.png": new Uint8Array([1, 2, 3, 5]),
    });
    expect(
      manager.isDirty(
        { ...document, assets: [declared("assets/logo.png", "b".repeat(64))] },
        { "assets/logo.png": new Uint8Array([1, 2, 3, 5]) },
      ),
    ).toBe(true);
  });

  it("detects a rename, an added asset and a removed one", () => {
    const manager = new PersistenceManager(withAsset("a".repeat(64)), {
      "assets/logo.png": logo,
    });
    const renamed = "assets/mark.png";

    expect(
      manager.isDirty(withAsset("a".repeat(64), renamed), {
        [renamed]: logo,
      }),
    ).toBe(true);
    expect(
      manager.isDirty(
        {
          ...withAsset("a".repeat(64)),
          assets: [
            ...withAsset("a".repeat(64)).assets,
            declared(renamed, "c".repeat(64)),
          ],
        },
        { "assets/logo.png": logo, [renamed]: new Uint8Array([9]) },
      ),
    ).toBe(true);
    // Bytes without the document are a cache, not an edit. Dropping them used
    // to read as dirty, which meant a theme whose asset finished loading after
    // the manager was built — the Starter, whose one declared asset is a
    // backdrop — asked about work nobody had done the moment it opened. The
    // declaration is what the document says; the bytes are what has arrived.
    expect(manager.isDirty(withAsset("a".repeat(64)), {})).toBe(false);
    // Removing the asset itself still moves the key, because that drops the
    // declaration as well as the bytes.
    expect(
      manager.isDirty({ ...withAsset("a".repeat(64)), assets: [] }, {}),
    ).toBe(true);
  });

  /**
   * The complaint the cost fix could have caused: a key that is too eager fires
   * the guard on a document nobody touched. Two assets and the same map built in
   * a different key order is the case that catches it — the author did nothing,
   * and a key walking `Object.entries` without sorting would call that a change.
   */
  it("does not fire on an unchanged document, whatever order the map is in", () => {
    const first = declared("assets/logo.png", "a".repeat(64));
    const second = declared("assets/mark.png", "c".repeat(64));
    const document = { ...withAsset("a".repeat(64)), assets: [first, second] };
    const logoBytes = logo;
    const markBytes = new Uint8Array([7, 7]);

    const manager = new PersistenceManager(document, {
      "assets/logo.png": logoBytes,
      "assets/mark.png": markBytes,
    });

    expect(
      manager.isDirty(document, {
        "assets/mark.png": markBytes,
        "assets/logo.png": logoBytes,
      }),
    ).toBe(false);
  });

  /**
   * The cost, asserted rather than measured: a 24 MB asset's key was an 86 MB
   * string, retained until the next collection. A key that answers "is this the
   * same document" cannot be larger than the document's own declarations.
   */
  it("keeps the key proportional to the declarations, not the bytes", () => {
    const document = withAsset("a".repeat(64));
    const megabytes = 24;
    const big = new Uint8Array(megabytes * 1024 * 1024).fill(7);

    expect(
      documentKey(document, { "assets/logo.png": big }).length,
    ).toBeLessThan(1024);
    expect(
      documentKey(document, { "assets/logo.png": big }).length -
        documentKey(document, { "assets/logo.png": logo }).length,
    ).toBeLessThan(64);
  });
});

describe("confirmDocumentReplacement", () => {
  /** Opens the prompt the way the session opens it. The first commit is
   *  flushed, so the dialog is in the document when this returns. */
  function open(): Promise<"save" | "discard" | "cancel"> {
    let pending: Promise<"save" | "discard" | "cancel"> | undefined;
    act(() => {
      pending = confirmDocumentReplacement();
    });
    if (pending === undefined) throw new Error("no promise returned");
    return pending;
  }

  function prompt(): HTMLElement {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (dialog === null) throw new Error("no dialog opened");
    return dialog;
  }

  function answers(): readonly HTMLButtonElement[] {
    return [...prompt().querySelectorAll<HTMLButtonElement>("button")];
  }

  function answer(text: string): HTMLButtonElement {
    const button = answers().find((entry) => entry.textContent === text);
    if (button === undefined) throw new Error(`no ${text} answer`);
    return button;
  }

  async function press(text: string): Promise<void> {
    await act(async () => {
      answer(text).click();
    });
  }

  it("carries the question, and every answer's own word", () => {
    const pending = open();
    void pending.catch(() => {});
    const dialog = prompt();

    // Named, so a screen reader is on the question before it hears an answer.
    expect(dialog.getAttribute("aria-label")).toBe(
      uiCopy.replaceDocument.question,
    );
    expect(dialog.textContent).toContain(uiCopy.replaceDocument.question);
    expect(answers().map((button) => button.textContent)).toEqual([
      uiCopy.replaceDocument.save,
      uiCopy.replaceDocument.cancel,
      // Discard last, and Cancel beside it: the two destructive-adjacent acts
      // are ordered so a slip toward the edge lands on the one that keeps the
      // work, which the imperative dialog also did deliberately.
      uiCopy.replaceDocument.discard,
    ]);
    for (const button of answers()) expect(button.type).toBe("button");
  });

  it.each([
    ["save", "save"],
    ["cancel", "cancel"],
    ["discard", "discard"],
  ] as const)(
    "answers %s when the author presses it",
    async (word, expected) => {
      const pending = open();
      await press(uiCopy.replaceDocument[word]);
      await expect(pending).resolves.toBe(expected);
      // The surface leaves with the answer, so a stray second press cannot
      // re-answer a question the session has already acted on.
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    },
  );

  it("answers Cancel when Escape dismisses it, and loses nothing", async () => {
    const pending = open();
    await act(async () => {
      prompt().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    // Cancel is the only answer that costs no work: a dismissal must not be
    // read as a Discard by the session that awaits this.
    await expect(pending).resolves.toBe("cancel");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("returns focus to the control that asked", async () => {
    const invoker = document.createElement("button");
    invoker.textContent = "New theme";
    document.body.append(invoker);
    invoker.focus();
    expect(document.activeElement).toBe(invoker);

    const pending = open();
    await press(uiCopy.replaceDocument.cancel);
    await pending;

    // The author is back where they pressed, not at the top of the document.
    // Focus lands on the way out rather than through a later effect, so this
    // reads it synchronously after the answer.
    expect(document.activeElement).toBe(invoker);
  });
});
