/** The sizes a gallery may show per page, in the order the well lists them.
 *
 *  `"all"` is a size like any other rather than a separate flag: a viewer who
 *  asks for it has chosen a page that holds everything, which is what the
 *  pager's own arithmetic needs to hear — a `null` or an `undefined` would be a
 *  second "no paging" state for the same fact. */
export const pageSizes = [12, 24, 48, "all"] as const;

export type PageSize = (typeof pageSizes)[number];

/** Its own size, and what a viewer who has never chosen reads. */
export const DEFAULT_PAGE_SIZE: PageSize = 12;

/** Browser-local, like the shell's palette choice: never serialized into a
 *  theme envelope, never authored document state. The key is namespaced the way
 *  `editor-shell/palette.ts` namespaces its own, so the two preferences cannot
 *  collide and a viewer's choice is one entry in the shell's storage. */
const storageKey = "yunari.editor.store-page-size";

/** One viewer's page size. */
export interface PageSizePreference {
  read(): PageSize;
  write(size: PageSize): void;
  clear(): void;
}

/** The stored string as a size, or `undefined` for anything else — the empty
 *  string, a size this build no longer offers, a value another tab wrote. */
function storedPageSize(stored: string | null): PageSize | undefined {
  return pageSizes.find((size) => String(size) === stored);
}

/**
 * The page-size preference over `storage`, or over nothing at all.
 *
 * **The read answers the default rather than throwing**, which is the one place
 * this differs from `palette.ts`'s trio: a palette has no "missing" state a
 * viewer would notice, while a page size has a sensible one — so an absent
 * `Storage`, a value this build cannot read and a `Storage` that refuses every
 * call (a browser in a blocked third-party context) all read 12. A write that
 * cannot land is dropped for the same reason: a preference that does not
 * persist is not an error a surface has to render.
 */
export function createPageSizePreference(
  storage?: Storage,
): PageSizePreference {
  return {
    read: () => {
      try {
        return (
          storedPageSize(storage?.getItem(storageKey) ?? null) ??
          DEFAULT_PAGE_SIZE
        );
      } catch {
        return DEFAULT_PAGE_SIZE;
      }
    },
    write: (size) => {
      try {
        storage?.setItem(storageKey, String(size));
      } catch {
        // A storage that refuses is a preference that does not persist.
      }
    },
    clear: () => {
      try {
        storage?.removeItem(storageKey);
      } catch {
        // As `write`: the key may already be gone, and that is the state.
      }
    },
  };
}
