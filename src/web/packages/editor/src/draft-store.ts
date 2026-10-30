import type { FabricThemeEnvelope } from "@yunari/renderer-core";

/**
 * The unsaved document, as the browser kept it (`vg-040`).
 *
 * One slot, not one per theme. A draft is a crash-recovery artefact and the
 * author has one editor, so a per-theme map would be a store nobody reads
 * twice. `savedAt` is ISO-8601 UTC, the same convention the library's own
 * `ThemeLibraryEntry.updatedAt` keeps, and `content` is the document's own
 * snapshot — authored theme JSON, never asset bytes.
 */
export interface Draft {
  /** The document's name, read through `documentNameOf`, so the prompt that
   *  offers it names the theme the same way the status line does. */
  readonly name: string;
  readonly savedAt: string;
  readonly content: FabricThemeEnvelope;
}

/** Beside the shell's own two browser-local keys — `yunari.editor.shell-palette`
 *  and `yunari.editor.shortcut-overrides` — and browser-local for the same
 *  reason: it is this machine's memory of an unfinished edit, not theme data. */
export const DRAFT_STORAGE_KEY = "yunari.editor.draft";

/** How often a dirty document is copied, and so the most a crash can cost. */
const DRAFT_INTERVAL_MS = 30_000;

/**
 * The draft, over a `Storage` the caller has already decided about.
 *
 * `readStorage()`'s guard is a decision about this page — a private window
 * throws on the accessor itself — so the store takes that answer rather than
 * asking again, and a store built over `undefined` is the browser with no
 * storage to offer. That is also what makes the module testable without one.
 *
 * Every call is guarded again: a storage that hands out its accessor and then
 * refuses to read or write (quota, private mode) is a browser with no draft,
 * which is not an error the author can act on.
 */
export class DraftStore {
  readonly #storage: Storage | undefined;

  constructor(storage: Storage | undefined) {
    this.#storage = storage;
  }

  /** The draft, or nothing. A value that cannot be parsed, or that is not the
   *  shape this build writes, is a draft that is not there — never a throw at
   *  boot, where the author has no surface to fix it from. */
  read(): Draft | undefined {
    let raw: string | null;
    try {
      raw = this.#storage?.getItem(DRAFT_STORAGE_KEY) ?? null;
    } catch {
      return undefined;
    }
    if (raw === null) return undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isDraft(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  write(draft: Draft): void {
    try {
      this.#storage?.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      // The editor keeps working without a draft. Saying so would report a
      // failure the author has no answer for.
    }
  }

  clear(): void {
    try {
      this.#storage?.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      // As `write`: a storage that refuses a removal leaves a draft, not a
      // broken editor.
    }
  }
}

/** The open document, as the autosave asks it. */
export interface DraftSource {
  /** The document's own comparison — `EditorSession.isDirty()` — pulled, never
   *  a second one. A document reads clean the moment it matches what was last
   *  saved, and nothing here re-derives that. */
  isDirty(): boolean;
  /** The document as the draft holds it: its authored snapshot, the name it is
   *  read under, and the moment. Read only when it is dirty, because the
   *  snapshot walks the scene. */
  draft(): Draft;
}

export interface DraftAutosave {
  /** Writes now, if the document is dirty. The page-leave path, where the
   *  timer's last tick can be half a minute behind the edit that mattered. */
  writeNow(): void;
  /** Arms the interval. Idempotent, because `pageshow` fires on the first load
   *  as well as on a return from the back/forward cache and a second interval
   *  would double the writes. */
  start(): void;
  /** Stops the timer, beside `chartRefresh.dispose()` at the same teardown. */
  stop(): void;
}

/**
 * Keeps the draft level with the open document, on an interval.
 *
 * **The gate is the document's own, and this is the only place it is read.** A
 * draft over work the author already saved makes the recovery prompt fire on
 * every boot over nothing, and a prompt learned to dismiss is the same as no
 * prompt — the failure the unload warning already names in its own words
 * (`editor-main.ts`).
 *
 * **A document that becomes clean clears the draft, and one that merely is
 * clean does not.** A save is the common way to become clean, not the only one:
 * an author who undoes back to what was saved has no unsaved work, and a draft
 * left holding the edit they took back would be offered to them at the next
 * boot as work "edited and not saved" — which would by then be false, and
 * restoring it would resurrect the edit they chose to discard.
 *
 * **But being clean is not the same as superseding the draft**, which is why
 * the trigger is the *transition* out of dirty rather than the state. A document
 * can be born clean while a draft is pending — the failed-restore fallback,
 * where the mount the draft asked for threw and the boot opened something else
 * — and that document never adopted the draft, so the clear would delete work it
 * never superseded. It is the same pull of `isDirty()`, read across two ticks
 * instead of one.
 *
 * **The rule guards the clear, not the slot.** One draft is the brief's own
 * decision, so the first edit of that fallback document turns `dirty` true and
 * the next tick writes *its* draft over the pending one — and an edit undone
 * before that tick clears it. The pending draft therefore survives the refused
 * restore and the fallback's own first tick, and not the author touching the
 * document in front of them. Leaving it in place instead would leave the
 * document being edited undrafted, which is the worse of the two.
 *
 * **That is the slot's whole answer to a draft this build cannot render**
 * (`vg-512`): one slot, last writer wins, because a second slot or a pinned one
 * trades the document the author is working in for a document this build cannot
 * open. What the slot owes instead is the *announcement* — which is the boot's,
 * not this store's (`editor-main.ts`), on the shell's diagnostic line, where it
 * stands until the first committed edit: the moment the fallback document
 * supersedes the pending draft. Nothing here is silent and nothing here is
 * overstated; the two claims corrected in `vg-040`'s R3 are what this paragraph
 * replaces.
 */
export function startDraftAutosave(input: {
  readonly store: DraftStore;
  /** The open document, or nothing while none is mounted. */
  readonly document: () => DraftSource | undefined;
}): DraftAutosave {
  let timer: ReturnType<typeof setInterval> | undefined;
  /** The document's own answer, as this autosave last read it. */
  let dirty = false;
  /** The source those two were read from, so a different document is not
   *  compared against this one's answer. */
  let open: DraftSource | undefined;

  const writeNow = (): void => {
    const document = input.document();
    if (document === undefined) return;
    if (open === undefined) {
      // The first document this autosave sees writes on this tick, as it did
      // before the switch gate existed.
      open = document;
    } else if (document !== open) {
      // A switch replaces the document under one autosave. The flag remembers
      // the document that left, so comparing the incoming one against it would
      // either clear the outgoing draft on a clean incoming document or write
      // the incoming draft into a slot the outgoing one still owns. Adopt the
      // new document's answer and leave this tick's slot alone.
      open = document;
      dirty = document.isDirty();
      return;
    }
    const next = document.isDirty();
    if (next) input.store.write(document.draft());
    else if (dirty) input.store.clear();
    dirty = next;
  };

  const autosave: DraftAutosave = {
    writeNow,
    start: () => {
      timer ??= setInterval(writeNow, DRAFT_INTERVAL_MS);
    },
    stop: () => {
      if (timer === undefined) return;
      clearInterval(timer);
      timer = undefined;
    },
  };
  autosave.start();
  return autosave;
}

/**
 * Binds the autosave to the page's own lifetime.
 *
 * `pagehide` is the last event a page gets before it is unloaded or frozen into
 * the back/forward cache, and it is where the draft is written again: the
 * timer's last tick can be half a minute behind the edit that mattered. It is
 * **not** the event a backgrounded tab fires — that is `visibilitychange` — so
 * a tab switch does not stop the timer, only the page going away does.
 *
 * **`pageshow` is what makes the round trip resume.** A page restored from the
 * back/forward cache comes back with its state intact and no reload, so without
 * this the timer stopped at `pagehide` would never write again for the rest of
 * the session, silently. `start` is idempotent, which is what makes the initial
 * `pageshow` — it fires on the first load too — a no-op.
 */
export function bindDraftAutosave(
  autosave: DraftAutosave,
  target: EventTarget = window,
): void {
  target.addEventListener("pagehide", () => {
    autosave.writeNow();
    autosave.stop();
  });
  target.addEventListener("pageshow", () => {
    autosave.start();
  });
}

/** The three fields, and nothing about what is inside them: the envelope's own
 *  compatibility is the renderer's assertion, taken where the document mounts. */
function isDraft(value: unknown): value is Draft {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const draft = value as Record<string, unknown>;
  return (
    typeof draft["name"] === "string" &&
    typeof draft["savedAt"] === "string" &&
    typeof draft["content"] === "object" &&
    draft["content"] !== null
  );
}
