/**
 * The id of the theme a save last made authoritative, and the revision every
 * display polls.
 *
 * The stored envelope is deliberately not held here: the theme store owns the
 * saved document, and a second copy in memory would be a second answer to what
 * a theme is. This store only answers the two questions a display asks — which
 * theme moved, and how many times — so a page that shows that theme reloads and
 * every other page stays still.
 *
 * The revision is the whole subscription mechanism: a display polls one small
 * number and re-reads only when it moves.
 */

interface PublishedTheme {
  readonly id: string;
  /** Bumped by every publish and by every clear. A display polls this. */
  readonly revision: number;
}

export interface PublishedStore {
  read(): PublishedTheme | undefined;
  /** Records the theme a save just stored, and moves the revision. */
  publish(id: string): number;
  /** Forgets the theme, so no display reloads for it, and moves the revision. */
  clear(): number;
  revision(): number;
}

export function createPublishedStore(): PublishedStore {
  let current: PublishedTheme | undefined;
  let revision = 0;

  return {
    read: () => current,
    publish(id) {
      revision += 1;
      current = { id, revision };
      return revision;
    },
    clear() {
      revision += 1;
      current = undefined;
      return revision;
    },
    revision: () => revision,
  };
}
