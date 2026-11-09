/**
 * The editor's own list of themes it has had open, newest first.
 *
 * It is not theme data and not part of undo: a library listing answers "what is
 * saved", while this answers "what did I have open", which is the fact **Open
 * recent** draws. It is editor-local and per browser, like the preset library.
 */

export interface RecentTheme {
  readonly id: string;
  readonly name: string;
}

export interface ThemeRecentsStore {
  getSnapshot(): readonly RecentTheme[];
  subscribe(listener: () => void): () => void;
  /** One successful open: the theme moves to the head, named as it was when it
   *  opened, and the sixth entry falls off. */
  record(id: string, name: string): void;
  reload(): void;
}

const STORAGE_KEY = "yunari.editor.recent-themes";
const VERSION = 1;
/** The menu lists five; a longer list is one nobody reads. */
const LIMIT = 5;
const NONE: readonly RecentTheme[] = [];

export function createThemeRecents(
  storage: Storage | undefined,
): ThemeRecentsStore {
  let recents = read(storage);
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => recents,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    record: (id, name) => {
      if (recents[0]?.id === id && recents[0].name === name) return;
      const rest = recents.filter((entry) => entry.id !== id);
      recents = [{ id, name }, ...rest].slice(0, LIMIT);
      write(storage, recents);
      notify();
    },
    reload: () => {
      recents = read(storage);
      notify();
    },
  };
}

/** The editor's own list. Storage is optional so a host that refuses it still
 *  renders — the menu then just has nothing to list. */
export const themeRecents = createThemeRecents(browserStorage());

function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** A malformed entry is dropped rather than replaced: the key's presence says
 *  the author has opened themes, even if one row no longer parses. */
function read(storage: Storage | undefined): readonly RecentTheme[] {
  if (storage === undefined) return NONE;

  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return NONE;
  }
  if (raw === null) return NONE;

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NONE;
  }
  if (!isRecord(payload) || payload.version !== VERSION) return NONE;
  if (!Array.isArray(payload.entries)) return NONE;

  return payload.entries
    .flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const { id, name } = entry;
      if (typeof id !== "string" || id === "") return [];
      if (typeof name !== "string") return [];
      return [{ id, name }];
    })
    .slice(0, LIMIT);
}

function write(
  storage: Storage | undefined,
  recents: readonly RecentTheme[],
): void {
  if (storage === undefined) return;
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: VERSION, entries: recents }),
    );
  } catch {
    // A full or refused store leaves the list in memory for this session.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
