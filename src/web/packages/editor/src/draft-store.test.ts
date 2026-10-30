import type { FabricThemeEnvelope } from "@yunari/renderer-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bindDraftAutosave,
  DRAFT_STORAGE_KEY,
  type Draft,
  type DraftAutosave,
  type DraftSource,
  DraftStore,
  startDraftAutosave,
} from "./draft-store.js";

/**
 * The draft's two halves, neither of which a browser is needed for.
 *
 * **Reading is total.** Every way a stored value can be wrong — unparseable, a
 * shape this build never wrote, a storage that refuses to be read — answers
 * "no draft", because the alternative is an editor that will not boot over a
 * value the author cannot see or edit. **Writing is dirty-only.** A draft over
 * work the author already saved is a recovery prompt on every boot, which is
 * the prompt they learn to dismiss.
 */

/** The document the draft holds. The store never reads inside `content`, so
 *  this only has to be a snapshot-shaped envelope. */
const ENVELOPE: FabricThemeEnvelope = {
  schemaVersion: "2.0.0",
  fabricVersion: "7.4.0",
  id: "ops-board",
  artboard: { width: 1920, height: 1080 },
  metadata: { name: "Ops board", themeLanguage: "en" },
  scene: { version: "7.4.0", objects: [] },
};

const DRAFT: Draft = {
  name: "Ops board",
  savedAt: "2026-10-14T09:31:00.000Z",
  content: ENVELOPE,
};

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const entries = new Map(Object.entries(initial));
  return {
    get length(): number {
      return entries.size;
    },
    key: (index: number): string | null => [...entries.keys()][index] ?? null,
    getItem: (key: string): string | null => entries.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      entries.set(key, value);
    },
    removeItem: (key: string): void => {
      entries.delete(key);
    },
    clear: (): void => {
      entries.clear();
    },
  };
}

/** The private window: the accessor exists and every call on it throws. */
function refusingStorage(): Storage {
  const refuse = (): never => {
    throw new Error("storage is blocked");
  };
  return {
    length: 0,
    key: refuse,
    getItem: refuse,
    setItem: refuse,
    removeItem: refuse,
    clear: refuse,
  };
}

describe("the draft store", () => {
  it("reads nothing from a browser that never kept a draft", () => {
    expect(new DraftStore(memoryStorage()).read()).toBeUndefined();
  });

  it("reads back what it wrote", () => {
    const store = new DraftStore(memoryStorage());
    store.write(DRAFT);

    expect(store.read()).toEqual(DRAFT);
  });

  it("reads an unparseable value as no draft", () => {
    const storage = memoryStorage({ [DRAFT_STORAGE_KEY]: "{not json" });

    expect(new DraftStore(storage).read()).toBeUndefined();
  });

  it("reads a value of the wrong shape as no draft", () => {
    // The shapes a hand-edited or half-written key can hold, and the one a
    // build that stored something else would leave behind.
    const wrong = [
      "null",
      "[]",
      "{}",
      '{"name":"Ops board"}',
      '{"name":"Ops board","savedAt":"2026-10-14T09:31:00.000Z"}',
      '{"name":1,"savedAt":"2026-10-14T09:31:00.000Z","content":{}}',
      '{"name":"Ops board","savedAt":1,"content":{}}',
      '{"name":"Ops board","savedAt":"2026-10-14T09:31:00.000Z","content":null}',
    ];

    for (const value of wrong) {
      const storage = memoryStorage({ [DRAFT_STORAGE_KEY]: value });
      expect(new DraftStore(storage).read(), value).toBeUndefined();
    }
  });

  it("clears the draft it wrote", () => {
    const store = new DraftStore(memoryStorage());
    store.write(DRAFT);
    store.clear();

    expect(store.read()).toBeUndefined();
  });

  it("holds nothing where the browser has no storage at all", () => {
    const store = new DraftStore(undefined);
    store.write(DRAFT);

    expect(store.read()).toBeUndefined();
    expect(() => store.clear()).not.toThrow();
  });

  it("is no draft rather than an error where the browser refuses storage", () => {
    const store = new DraftStore(refusingStorage());

    expect(store.read()).toBeUndefined();
    expect(() => store.write(DRAFT)).not.toThrow();
    expect(() => store.clear()).not.toThrow();
  });
});

describe("the draft's autosave", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The open document as the autosave asks it. The dirty comparison itself is
   *  the session's; what a case moves here is only its answer. */
  function documentOver(isDirty: () => boolean): DraftSource {
    return { isDirty, draft: () => DRAFT };
  }

  function autosaveOver(
    store: DraftStore,
    document: () => DraftSource | undefined,
  ): DraftAutosave {
    return startDraftAutosave({ store, document });
  }

  it("writes a dirty document on the interval, and nothing while none is open", () => {
    vi.useFakeTimers();
    const store = new DraftStore(memoryStorage());
    let open = false;
    const doc = documentOver(() => true);
    const autosave = autosaveOver(store, () => (open ? doc : undefined));

    vi.advanceTimersByTime(30_000);
    expect(store.read(), "no document, no draft").toBeUndefined();

    open = true;
    vi.advanceTimersByTime(30_000);
    expect(store.read(), "a dirty document is written").toEqual(DRAFT);

    autosave.stop();
  });

  it("writes nothing for a clean document, and clears what a dirty one left", () => {
    vi.useFakeTimers();
    const store = new DraftStore(memoryStorage());
    let dirty = true;
    const doc = documentOver(() => dirty);
    const autosave = autosaveOver(store, () => doc);

    vi.advanceTimersByTime(30_000);
    expect(store.read(), "the edit is kept").toEqual(DRAFT);

    // The author undoes back to what was saved. The draft holds an edit they
    // have taken back, and the next boot would offer it as unsaved work.
    dirty = false;
    vi.advanceTimersByTime(30_000);
    expect(store.read(), "a clean document leaves no draft").toBeUndefined();

    autosave.stop();
  });

  it("leaves a draft alone when the document was clean from its first tick", () => {
    vi.useFakeTimers();
    const store = new DraftStore(memoryStorage());
    // A draft is pending while a document mounts clean: the failed-restore
    // fallback, where the mount a draft asked for threw and the boot opened
    // something else. That document never superseded the draft — it was born
    // clean and never adopted it — and the draft is the only copy of the work.
    store.write(DRAFT);
    const doc = documentOver(() => false);
    const autosave = autosaveOver(store, () => doc);

    vi.advanceTimersByTime(120_000);

    expect(
      store.read(),
      "a document that was never dirty does not clear the draft",
    ).toEqual(DRAFT);

    autosave.stop();
  });

  it("holds a pending draft until the fallback document's own draft is written", () => {
    vi.useFakeTimers();
    const store = new DraftStore(memoryStorage());
    /** The document the boot opened after the draft it could not render — a
     *  different document, so which one the slot holds is readable. */
    const FALLBACK: Draft = {
      name: "Untitled",
      savedAt: "2026-10-16T00:00:00.000Z",
      content: { ...ENVELOPE, id: "untitled" },
    };
    let dirty = false;
    const fallback = {
      isDirty: () => dirty,
      draft: () => FALLBACK,
    };
    const autosave = autosaveOver(store, () => fallback);
    // The refused restore: the build could not open this draft, so the boot
    // opened the document it would have, and the draft is still the slot's.
    store.write(DRAFT);

    // The fallback's own ticks leave it alone, because it never adopted the
    // draft — the transition rule `vg-040`'s R2 put on the clear.
    vi.advanceTimersByTime(30_000);
    expect(store.read(), "untouched while the fallback is clean").toEqual(
      DRAFT,
    );

    // **The first edit is what supersedes it**, and this is the moment the
    // boot's report named: one slot, so the document the author is working in
    // takes it and the draft the build cannot render is gone (`vg-512`).
    dirty = true;
    vi.advanceTimersByTime(30_000);
    expect(store.read(), "the fallback document's own draft").toEqual(FALLBACK);
    expect(
      store.read(),
      "and not the one that could not be opened",
    ).not.toEqual(DRAFT);

    autosave.stop();
  });

  it("does not clear the outgoing draft on the tick after a switch", () => {
    vi.useFakeTimers();
    const store = new DraftStore(memoryStorage());
    let current = documentOver(() => true);
    const autosave = autosaveOver(store, () => current);

    vi.advanceTimersByTime(30_000);
    expect(store.read(), "the outgoing document's edit").toEqual(DRAFT);

    // A document replaced under the autosave: the incoming one is clean, and
    // its cleanliness says nothing about the draft the outgoing one left.
    current = documentOver(() => false);
    vi.advanceTimersByTime(30_000);
    expect(store.read(), "the outgoing draft survives the switch").toEqual(
      DRAFT,
    );

    // The ordinary clear still runs for the incoming document: its own edit,
    // then its own undo.
    let incomingDirty = false;
    current = documentOver(() => incomingDirty);
    vi.advanceTimersByTime(30_000);
    incomingDirty = true;
    vi.advanceTimersByTime(30_000);
    expect(store.read(), "the incoming document's own draft").toEqual(DRAFT);
    incomingDirty = false;
    vi.advanceTimersByTime(30_000);
    expect(store.read(), "and its own clean tick clears it").toBeUndefined();

    autosave.stop();
  });

  it("writes on the way out, and resumes when the page comes back", () => {
    vi.useFakeTimers();
    const store = new DraftStore(memoryStorage());
    const doc = documentOver(() => true);
    const autosave = autosaveOver(store, () => doc);
    const page = new EventTarget();
    bindDraftAutosave(autosave, page);

    // Leaving: the timer's last tick can be half a minute behind the edit.
    page.dispatchEvent(new Event("pagehide"));
    expect(store.read(), "the page-leave write").toEqual(DRAFT);

    // Away: nothing is written, and a frozen page's interval must not be
    // running behind the editor's back.
    store.clear();
    vi.advanceTimersByTime(120_000);
    expect(store.read(), "stopped while the page was away").toBeUndefined();

    // Back from the back/forward cache: the same session, still live, and it
    // has to be writing drafts again.
    page.dispatchEvent(new Event("pageshow"));
    vi.advanceTimersByTime(30_000);
    expect(store.read(), "writing again after the round trip").toEqual(DRAFT);

    autosave.stop();
  });

  it("stops writing when the editor goes away", () => {
    vi.useFakeTimers();
    const store = new DraftStore(memoryStorage());
    const doc = documentOver(() => true);
    const autosave = autosaveOver(store, () => doc);

    autosave.stop();
    vi.advanceTimersByTime(120_000);

    expect(store.read()).toBeUndefined();
  });
});
