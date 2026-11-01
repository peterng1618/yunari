import type { ListingCategory } from "@yunari/renderer-core";
import { useEffect, useState } from "react";
import type { FontActions } from "./fonts.js";

/** The author's favourite trio ids, read from the host when the Fonts tab is
 *  first drawn and written back through the same client. A closed finder
 *  starts from the host's answer again. */
export function useFontFavorites(props: {
  readonly open: boolean;
  readonly active: ListingCategory | undefined;
  readonly font: FontActions | undefined;
}): {
  readonly favorites: readonly string[] | undefined;
  readonly toggleFavorite: (trioId: string) => void;
} {
  /** `undefined` until the read settles; a host that keeps no store reads as
   *  no favourites rather than as a failure. */
  const [favorites, setFavorites] = useState<readonly string[] | undefined>(
    undefined,
  );

  const { open, active } = props;
  const noFont = props.font === undefined;
  useEffect(() => {
    if (!open) {
      setFavorites(undefined);
      return undefined;
    }
    if (active !== "font" || favorites !== undefined) return undefined;
    const list = props.font?.listFavorites;
    if (list === undefined) {
      setFavorites([]);
      return undefined;
    }
    let live = true;
    void list().then((stored) => {
      if (live) setFavorites(stored);
    });
    return () => {
      live = false;
    };
    // `font` is read for its port only; its callbacks are rebuilt by the shell.
  }, [open, active, favorites === undefined, noFont]);

  const toggleFavorite = (trioId: string): void => {
    const current = favorites ?? [];
    const next = current.includes(trioId)
      ? current.filter((id) => id !== trioId)
      : [...current, trioId];
    setFavorites(next);
    const save = props.font?.saveFavorites;
    if (save === undefined) return;
    void save(next)
      .then(setFavorites)
      // A failed write leaves the host's list where it was; the star follows it.
      .catch(() => {
        setFavorites(current);
      });
  };

  return { favorites, toggleFavorite };
}
