/**
 * The author's favourite font trios, which the host keeps in its settings folder
 * (`host/src/settings/font-favorites.ts`) rather than in the document: a
 * favourite is a statement about this PC, not authored theme content.
 *
 * A host that keeps no store answers 404, and that reads as **no favourites**
 * rather than as a failure — the editor still works standalone, and a picker
 * that cannot reach a favourites store still browses the whole catalogue.
 */
export interface FavoritesClient {
  list(): Promise<readonly string[]>;
  save(ids: readonly string[]): Promise<readonly string[]>;
}

export function createFavoritesClient(options?: {
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
}): FavoritesClient {
  const fetcher = options?.fetch ?? globalThis.fetch.bind(globalThis);
  const url = `${options?.baseUrl ?? ""}/api/font-favorites`;

  return {
    async list(): Promise<readonly string[]> {
      try {
        const response = await fetcher(url);
        if (!response.ok) return [];
        const data = (await response.json()) as {
          readonly favorites?: readonly string[];
        };
        return Array.isArray(data.favorites) ? data.favorites : [];
      } catch {
        // An unreachable host is not an empty favourites list the author chose;
        // it is a store this session cannot read. The picker shows the same
        // thing for both and never fails on either.
        return [];
      }
    },

    async save(ids: readonly string[]): Promise<readonly string[]> {
      const response = await fetcher(url, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ favorites: [...ids] }),
      });
      if (!response.ok) {
        throw new Error(`Could not save favorites (${response.status}).`);
      }
      // The host answers what it stored rather than an echo, because the store
      // drops an id it cannot keep — the client's answer is the stored list.
      const data = (await response.json()) as {
        readonly favorites?: readonly string[];
      };
      return Array.isArray(data.favorites) ? data.favorites : [];
    },
  };
}
