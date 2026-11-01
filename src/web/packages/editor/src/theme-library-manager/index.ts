import type {
  FabricThemeEnvelope,
  ThemeMetadata,
  ThemeRemix,
} from "@yunari/renderer-core";
import {
  type ThemeCredits,
  type ThemeCreditsEntry,
  themeIdFromName,
} from "@yunari/theme-package";
import type { AssetManager } from "../asset-manager/index.js";
import type { CleanupAnswer } from "../editor-document.js";
import type { ErrorManager } from "../error-manager/index.js";
import {
  createThemeLibraryClient,
  DEFAULT_DISPLAY_KEY,
  ThemeConflictError,
  type ThemeLibraryClient,
} from "../theme-library-client.js";
import {
  promptThemeConflict,
  promptThemeSaveAs,
  promptThemeSelection,
} from "../theme-library-dialog.js";
import { uiCopy } from "../ui-copy.js";

/**
 * The stored document a session descends from, and what that document declared.
 *
 * A save names the first to say which version it was built from; the second is
 * what lets it leave an asset the stored folder already holds out of the
 * request, because a declared `sha256` that has not moved is proof the bytes
 * have not either. Keeping them in one value is the point — a base without its
 * hashes would upload the whole theme every time, which is what this exists to
 * stop.
 */
interface LibraryBase {
  readonly id: string;
  readonly hashes: ReadonlyMap<string, string>;
}

/** The base of a document, paired with the hashes that document declares. */
function libraryBase(
  id: string | undefined,
  declarations: readonly { readonly path: string; readonly sha256?: string }[],
): LibraryBase | undefined {
  if (id === undefined) {
    return undefined;
  }
  return {
    id,
    hashes: new Map(
      declarations.flatMap((declared) =>
        declared.sha256 === undefined
          ? []
          : [[declared.path, declared.sha256] as const],
      ),
    ),
  };
}

/**
 * The document a remix opens as: a new document that credits its parent.
 *
 * Four fields are **deleted, not blanked**: a version, its timestamps and its
 * author describe the stored parent, and a remix is a first version of its own.
 * `exactOptionalPropertyTypes` is why this is a delete — an `undefined` on an
 * optional key is a value, and the format distinguishes "declares none" from
 * "declares undefined".
 */
function remixedEnvelope(
  stored: FabricThemeEnvelope,
  remixOf: ThemeRemix,
): FabricThemeEnvelope {
  const kept: Record<string, unknown> = { ...(stored.metadata ?? {}) };
  for (const key of ["version", "createdAt", "updatedAt", "author"]) {
    delete kept[key];
  }
  return {
    ...stored,
    id: crypto.randomUUID(),
    metadata: {
      ...(kept as ThemeMetadata),
      name: `${remixOf.name} (remix)`,
      remixOf,
    },
  };
}

/**
 * The document a duplicate opens as: a new document with no credit and its own
 * name.
 *
 * The same fields are **deleted, not blanked**, for the same reason: they
 * describe the stored copy, and a duplicate is a first version of its own. The
 * credit goes too: a source without a host origin may itself be a saved remix,
 * and a duplicate carries no credit.
 */
function duplicatedEnvelope(stored: FabricThemeEnvelope): FabricThemeEnvelope {
  const kept: Record<string, unknown> = { ...(stored.metadata ?? {}) };
  for (const key of [
    "version",
    "createdAt",
    "updatedAt",
    "author",
    "remixOf",
  ]) {
    delete kept[key];
  }
  return {
    ...stored,
    id: crypto.randomUUID(),
    ...(stored.metadata === undefined
      ? {}
      : { metadata: kept as ThemeMetadata }),
  };
}

/**
 * What the manager needs of the document it saves, which is the session's.
 *
 * A port rather than the session itself: the manager must not know how a
 * document is composed, only how to hand one to the host's library and take the
 * answer back.
 */
interface ThemeLibraryManagerOptions {
  /** The document as the author last left it. */
  readonly snapshot: () => FabricThemeEnvelope;
  /** The document's own declared bytes, which is what a save sends. */
  readonly assets: AssetManager;
  /** The attribution member this document carries, or nothing. It travels with
   *  every save because the stored folder is written whole: a save that sent no
   *  credits would drop the ones the theme already had. */
  readonly credits?: () => ThemeCredits | undefined;
  /** The picture a save ships, or the one this document arrived with: a
   *  capture that fails must cost the preview, not the theme. */
  readonly picture: () => Promise<Uint8Array | undefined>;
  /** What the library now holds, so the unsaved marker can clear. */
  readonly markSaved: (
    theme: FabricThemeEnvelope,
    assets: Readonly<Record<string, Uint8Array>>,
  ) => void;
  /** Told the document may have moved, which the unsaved marker reads. */
  readonly announceChange: () => void;
  /** Re-identifies the open document as the theme a **Save as** just wrote —
   *  its id and its new name — so the next Save updates that theme and the
   *  identity chip shows the name the author gave it. */
  readonly adoptIdentity: (id: string, name: string) => void;
  readonly errors: ErrorManager;
  /** Asks before the open document is replaced; `false` stops the open. */
  readonly confirmReplacement: () => Promise<boolean>;
  /** The document's cleanup question, asked before this save writes anything.
   *  A refusal carries the host's own sentence, which must reach the author
   *  unwrapped. */
  readonly confirmCleanup: () => Promise<CleanupAnswer>;
  /** A save that happened, in the editor's own words. */
  readonly onSaved: (message?: string) => void;
  /** Builds a document from the reference composition, as a template. */
  readonly onNewFromStarter: () => Promise<void>;
  /** The stored document this one was opened from, when it was opened from
   *  the library. Every save made from here is checked against it. */
  readonly base?: string;
  /** The host to talk to. Built per call when this session has none, so a
   *  test — or a caller with no host — needs no client. */
  readonly client?: ThemeLibraryClient;
  readonly onError?: (message: string) => void;
  /** Hands an opened document to whoever builds the session that shows it.
   *  Opening a theme builds a new session, so the base has to travel with it
   *  or the session replacing this one would save with no idea what it is
   *  based on. */
  readonly onOpenTheme?: (
    envelope: FabricThemeEnvelope,
    assets: Readonly<Record<string, Uint8Array>>,
    base?: string,
    credits?: readonly ThemeCreditsEntry[],
  ) => Promise<void>;
}

/** The base a name with no id-shaped characters falls back to. The host's import
 *  path makes the same choice, so a theme saved here and an imported package
 *  with the same nameless title land under the same kind of id. */
const NAMELESS_THEME_ID = "theme";

/**
 * A name as a free library id: `themeIdFromName`'s host rule, suffixed the way
 * an import suffixes a taken id. A save-as never overwrites — the old theme is
 * the author's other work — so a taken slug has to move aside rather than raise
 * the replace question.
 */
function freeThemeId(name: string, taken: ReadonlySet<string>): string {
  const base = themeIdFromName(name) || NAMELESS_THEME_ID;
  let candidate = base;
  let suffix = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

/**
 * Saves a document into the host's library, reads one back, and
 * holds the base every such save is checked against.
 *
 * The base is the reason this is an owner and not a helper: it is the claim
 * that this document is the one stored, and it is cleared by whoever replaces
 * the document rather than by the save that follows. A base that outlived its
 * document would make the next save look stale when it is not.
 */
export class ThemeLibraryManager {
  #base: LibraryBase | undefined;
  readonly #options: ThemeLibraryManagerOptions;

  constructor(options: ThemeLibraryManagerOptions) {
    this.#options = options;
    this.#base = libraryBase(options.base, options.assets.declarations);
  }

  /** Whether this document descends from one the library holds. A document
   *  with no stored base has no folder, and a published document's assets are
   *  served from the theme's own folder. */
  isStored(): boolean {
    return this.#base !== undefined;
  }

  /** The document is being replaced by one that descends from nothing: a new
   *  document, the starter, or a package the author brought in. */
  forget(): void {
    this.#base = undefined;
  }

  /** Saves into the library, or says in the editor's own words that it did not
   *  happen — the document is untouched either way. */
  async save(): Promise<void> {
    const options = this.#options;
    // Before the `try` whose catch owns "Could not save to library: …": a
    // refused trash already is the host's sentence, and wrapping it would ask
    // the author to read the same refusal twice.
    const cleanup = await options.confirmCleanup();
    if (!cleanup.proceed) {
      if (cleanup.message !== undefined) options.onError?.(cleanup.message);
      return;
    }
    const current = options.snapshot();
    const client = this.#client();
    try {
      // The library is a folder, so the theme goes as its document and its
      // declared bytes. Building an archive here would compress data the host
      // is about to write uncompressed and inflate again on the next read.
      await this.#write(client, current, false);
      options.onSaved("Saved to library");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // The editor's own words for a save that did not happen, whether it was
      // refused or merely failed — the document is untouched either way, and
      // `markSaved` was not reached, so the author still has it.
      options.onError?.(`Could not save to library: ${msg}`);
      if (error instanceof ThemeConflictError) {
        await this.#resolveConflict(current, client);
      }
    }
  }

  /**
   * Puts one stored theme on the display that holds no theme of its own — the
   * host's default assignment, which is what the player falls back to.
   *
   * **The write is the client's own `assign`**, the route the store's Assign
   * control already uses; this manager only names the theme and reports the
   * answer. A refusal is the host's own sentence — "No such theme." — and is
   * printed rather than replaced with a sentence about activation, because the
   * host is the one that knows which half of the request failed.
   *
   * A theme with no stored document is not activatable: the caller saves
   * first, and a save that did not land never reaches here.
   */
  async activate(id: string): Promise<void> {
    const options = this.#options;
    try {
      await this.#client().assign(DEFAULT_DISPLAY_KEY, id);
      options.onSaved(uiCopy.library.activated);
    } catch (error) {
      options.onError?.(
        uiCopy.library.activateFailed(
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }

  /** Opens a stored theme, or the reference composition as a template. */
  async open(): Promise<void> {
    const options = this.#options;
    if (!(await options.confirmReplacement())) return;
    const client = this.#client();
    try {
      // The client goes in so a delete raised from this dialog reaches the host
      // this session is already talking to, rather than one the dialog builds.
      const choice = await promptThemeSelection(
        await client.list(),
        undefined,
        {
          client,
        },
      );
      if (choice === undefined) return;
      // A template is not a stored theme: it is not in the host's library, so
      // there is nothing to fetch and nothing the author could have deleted.
      // The editor already holds it, which is why it is offered at all.
      if (choice.kind === "template") {
        this.#base = undefined;
        await options.onNewFromStarter();
        return;
      }
      if (choice.kind === "duplicate") {
        await this.#openDuplicate(client, choice.id);
        return;
      }
      if (choice.kind === "remix") {
        await this.#openRemix(client, choice.id, choice.remixOf);
        return;
      }
      await this.#openStored(client, choice.id);
    } catch (error) {
      options.onError?.(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Opens one theme the library already holds, named rather than chosen.
   *
   * **The store's own route**: the cell's **Open in editor**. A surface that has
   * already read the theme's name has no chooser
   * to draw, and it replaces the open document just as the chooser's own answer
   * does — which is why the question and the base's bookkeeping are here rather
   * than only on the road through `open()`.
   *
   * **`onAccepted` runs between the question and the read**, so the caller's own
   * step — the store leaving its mode — happens only for an open that will
   * happen, and a cancelled question moves nothing.
   */
  async openById(id: string, onAccepted?: () => void): Promise<void> {
    const options = this.#options;
    if (!(await options.confirmReplacement())) return;
    onAccepted?.();
    try {
      await this.#openStored(this.#client(), id);
    } catch (error) {
      options.onError?.(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Writes the open document under a **new** theme, named by the author, and
   * continues as that theme.
   *
   * **The theme it came from is never touched.** No base travels and the target
   * id is a fresh slug, so the write is a first save rather than a gated
   * replacement; a slug the library already holds moves to `-2`, `-3` and so on
   * instead of raising the replace question, because the old theme is other work
   * the author is keeping. The cleanup question is not asked either: this is not
   * a replacement, and files it trashed would be gone from the document the
   * author still has.
   *
   * Once the host has taken the write, `adoptIdentity` re-points the document at
   * the new id and name, and the base moves with it, so the next **Save**
   * updates this theme and the identity chip reads its name.
   */
  async saveAs(): Promise<void> {
    const options = this.#options;
    const current = options.snapshot();
    const name = await promptThemeSaveAs(current.metadata?.name ?? current.id);
    if (name === undefined) return;
    const client = this.#client();
    try {
      // Read before the write so a taken slug is avoided rather than raced: the
      // host answers a first save onto a stored id with a conflict, and treating
      // that as "replace it?" would be the one question this row must not ask.
      const taken = new Set((await client.list()).map((entry) => entry.id));
      const id = freeThemeId(name, taken);
      const renamed: FabricThemeEnvelope = {
        ...current,
        id,
        metadata: { ...(current.metadata ?? {}), name },
      };
      await this.#commit(
        client,
        id,
        renamed,
        false,
        // A first save: the new id has no stored document, so there is no base
        // to claim and every declared byte has to travel.
        undefined,
        () => options.adoptIdentity(id, name),
      );
      options.onSaved(uiCopy.library.savedAs(name));
    } catch (error) {
      options.onError?.(
        `Could not save to library: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Opens the most recently saved theme that is not the one this document
   * already is.
   *
   * **The read is the listing's**, so a template is never a candidate: it is not
   * stored, has no modified time and is not in the library the listing draws.
   * **The open is `openById`'s**, so the dirty-document question and the base
   * bookkeeping stay in their owner rather than being re-spelled here.
   */
  async openRecent(): Promise<void> {
    const options = this.#options;
    const current = options.snapshot().id;
    let entries: readonly {
      readonly id: string;
      readonly updatedAt?: string;
    }[];
    try {
      entries = await this.#client().list();
    } catch (error) {
      options.onError?.(error instanceof Error ? error.message : String(error));
      return;
    }
    // The document's id is the library folder it was opened from; a base is a
    // content hash and the listing carries none, so the id is the comparable
    // fact. Newest is the listing's own modified time, with the id as a stable
    // tie-break for two themes written in the same tick.
    const newest = entries
      .filter((entry) => entry.id !== current)
      .sort(
        (a, b) =>
          (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") ||
          a.id.localeCompare(b.id),
      )[0];
    if (newest === undefined) {
      options.onError?.(uiCopy.library.noOtherTheme);
      return;
    }
    await this.openById(newest.id);
  }

  /** Reads one stored theme and hands it to whoever builds the session that
   *  shows it. **The base travels with the document**: the session replacing
   *  this one saves against what the library holds, and a base dropped on the
   *  way would make that save ungated (`vg-642`). */
  async #openStored(client: ThemeLibraryClient, id: string): Promise<void> {
    const options = this.#options;
    const opened = await client.open(id);
    if (options.onOpenTheme !== undefined) {
      this.#base = libraryBase(opened.base, opened.envelope.assets ?? []);
      await options.onOpenTheme(
        opened.envelope,
        opened.assets,
        opened.base,
        opened.credits?.entries,
      );
    }
  }

  /**
   * Reads an installed theme and mounts it as a new document that credits its
   * parent.
   *
   * **No base**: a remix descends from nothing the library holds — its id is
   * fresh — so the first save must be a first save rather than a gated write
   * against the theme it copied.
   */
  async #openRemix(
    client: ThemeLibraryClient,
    id: string,
    remixOf: ThemeRemix,
  ): Promise<void> {
    const options = this.#options;
    const opened = await client.open(id);
    await options.onOpenTheme?.(
      remixedEnvelope(opened.envelope, remixOf),
      opened.assets,
      undefined,
      opened.credits?.entries,
    );
    // Cleared only once the document has been handed over: a handover that
    // fails leaves the open document where it was, still gated by its base
    // (`vg-642`).
    this.#base = undefined;
  }

  /**
   * Reads an origin-less theme and mounts it as a new document that names no
   * parent.
   *
   * **No base**, for the same reason a remix has none: the copy's id is fresh,
   * so its first save must not be a gated write against the theme it copied.
   */
  async #openDuplicate(client: ThemeLibraryClient, id: string): Promise<void> {
    const options = this.#options;
    const opened = await client.open(id);
    await options.onOpenTheme?.(
      duplicatedEnvelope(opened.envelope),
      opened.assets,
      undefined,
      opened.credits?.entries,
    );
    this.#base = undefined;
  }

  /**
   * The save itself, so a deliberate overwrite after a refusal takes the same
   * road the refused save did — the same declared bytes, the same picture, and
   * the same move of the base onto what was just written.
   */
  async #write(
    client: ThemeLibraryClient,
    current: FabricThemeEnvelope,
    overwrite: boolean,
  ): Promise<void> {
    await this.#commit(client, current.id, current, overwrite, this.#base);
  }

  /**
   * One write to one id, then the things that follow a landed save: the base
   * moves onto what the host answered, the picture is refreshed, and the
   * document is told it is saved.
   *
   * `base` is passed rather than read, because a **Save as** targets an id the
   * library has never held: it must claim no base and carry every declared byte.
   * `adopt` runs between the host's answer and the saved marker, which is what
   * makes that save-as leave a clean document rather than a dirty one — the
   * document has become the theme that was written, so the marker is taken
   * against the same id and name.
   */
  async #commit(
    client: ThemeLibraryClient,
    id: string,
    envelope: FabricThemeEnvelope,
    overwrite: boolean,
    base: LibraryBase | undefined,
    adopt?: () => void,
  ): Promise<void> {
    const options = this.#options;
    const credits = options.credits?.();
    this.#base = libraryBase(
      await client.save(
        id,
        {
          envelope,
          assets: this.#payload(base, overwrite),
          ...(credits === undefined ? {} : { credits }),
          ...(base === undefined ? {} : { base: base.id }),
        },
        { overwrite },
      ),
      options.assets.declarations,
    );

    adopt?.();

    const png = await options.picture();
    if (png !== undefined && client.saveThumbnail !== undefined) {
      try {
        await client.saveThumbnail(id, png);
      } catch (error) {
        options.errors.warn(
          "theme-library",
          `Saved, but the library picture failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    options.markSaved(envelope, options.assets.assets);
    // The document did not move, but whether it is saved just changed, and the
    // marker reads that question rather than watching the scene.
    options.announceChange();
  }

  /**
   * The bytes this save has to carry, which is only the ones the stored folder
   * does not already hold.
   *
   * An asset the author has not touched since they opened the theme is left
   * out, and the host takes it from the folder it is replacing — a 438 KB
   * backdrop that has not moved does not go over the wire again. It may do that
   * only because this save went out with the base the editor opened with, and
   * the host's guard has already said the stored document is that one.
   *
   * A save with no base is a first save, and a deliberate overwrite stands the
   * guard down, so both carry the whole theme: there is nothing to reconstruct
   * from, and on the second road what is on disk is not the document this save
   * came from.
   */
  #payload(
    base: LibraryBase | undefined,
    overwrite: boolean,
  ): Readonly<Record<string, Uint8Array>> {
    const all = this.#options.assets.assets;
    if (base === undefined || overwrite) {
      return all;
    }
    const payload: Record<string, Uint8Array> = {};
    for (const declared of this.#options.assets.declarations) {
      const sha256 = declared.sha256;
      if (sha256 !== undefined && base.hashes.get(declared.path) === sha256) {
        continue;
      }
      // A declaration with no bytes is a document that is already broken; the
      // host refuses a theme that names an asset nobody can produce, which is
      // the honest answer, and sending an empty file would not be.
      const bytes = all[declared.path];
      if (bytes !== undefined) {
        payload[declared.path] = bytes;
      }
    }
    return payload;
  }

  /**
   * What an author wants done about a save the host refused. Nothing is thrown
   * away on either road, and the third answer keeps both: reloading takes the
   * stored document, overwriting sends the author's own with the guard stood
   * down for this one save, and dismissing it leaves the document exactly as it
   * was so they can copy anything out of it first.
   */
  async #resolveConflict(
    current: FabricThemeEnvelope,
    client: ThemeLibraryClient,
  ): Promise<void> {
    const options = this.#options;
    const choice = await promptThemeConflict();
    if (choice === "reload") {
      const opened = await client.open(current.id);
      this.#base = libraryBase(opened.base, opened.envelope.assets ?? []);
      await options.onOpenTheme?.(
        opened.envelope,
        opened.assets,
        opened.base,
        opened.credits?.entries,
      );
      return;
    }
    if (choice !== "overwrite") {
      return;
    }
    try {
      await this.#write(client, current, true);
      options.onSaved("Saved to library");
    } catch (error) {
      options.onError?.(
        `Could not save to library: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  #client(): ThemeLibraryClient {
    return this.#options.client ?? createThemeLibraryClient();
  }
}
