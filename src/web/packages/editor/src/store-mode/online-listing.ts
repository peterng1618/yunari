import type { CatalogueRefusal } from "@yunari/renderer-core";
import { useEffect, useState } from "react";
import { withInstalledVersions } from "./install-state.js";
import type { StoreItem } from "./local-source.js";
import { onlineThemeSource } from "./online-source.js";

/**
 * The online half's own reading: one catalogue read, the join against the
 * library, and what that read skipped.
 *
 * It lives here rather than in the region because the region is a surface and
 * this is a fact: `region.tsx` is at its line stop, and the half's reading is
 * the piece that can move without touching what the surface draws.
 *
 * **A failed read leaves the listing unset, never `[]`.** `undefined` is what
 * the body reads as "not arrived", where an empty array would claim the store
 * has nothing. `failed` is the separate fact that it will not arrive unless
 * `retry` reads again: the surface states that rather than drawing an empty
 * catalogue over it, and `retry` is the same read this hook opened with.
 */
export function useOnlineListing(local: readonly StoreItem[] | undefined): {
  readonly items: readonly StoreItem[] | undefined;
  readonly refused: readonly CatalogueRefusal[];
  readonly failed: boolean;
  readonly retry: () => void;
} {
  // One source for the life of the region, as the local half's is: a source
  // rebuilt per render would reach the origin again on every keystroke.
  const [source] = useState(() => onlineThemeSource());
  const [listing, setListing] = useState<
    | {
        readonly items: readonly StoreItem[];
        readonly refused: readonly CatalogueRefusal[];
      }
    | undefined
  >(undefined);
  const [failed, setFailed] = useState(false);
  // A retry is a new read of the same source: the counter is what re-runs the
  // effect, and the listing is cleared first so no frame shows the failed
  // read's leftover rows.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setFailed(false);
    setListing(undefined);
    source.list().then(
      (items) => {
        if (live) setListing({ items, refused: source.refused() });
      },
      () => {
        // A failed read is not a fact about the catalogue, so the listing stays
        // unset; `failed` is the fact that the surface states.
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [source, attempt]);

  // The join reads the library on every render rather than being baked into the
  // state: the two reads settle in either order, and a joined copy held in state
  // would keep the first answer after the library moved.
  return {
    items:
      listing === undefined
        ? undefined
        : withInstalledVersions(listing.items, local),
    refused: listing?.refused ?? [],
    failed,
    retry: () => setAttempt((current) => current + 1),
  };
}
