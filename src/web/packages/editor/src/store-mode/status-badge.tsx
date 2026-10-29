import type { CatalogueStatus } from "@yunari/renderer-core";
import type * as React from "react";
import { uiCopy } from "../ui-copy.js";

/**
 * The state of one of the author's own store rows, as the word after its name.
 *
 * **Two of the six states have no word.** `published` needs none because the
 * public listing is its badge, and `draft` is not a state this surface explains
 * yet — a word nothing accounts for is worse than none.
 *
 * **The word is the signal rather than a colour**, so the badge reads aloud and
 * to a person who cannot tell two tints apart; the element carries the
 * state itself in `data-yunari-store-status` for the surfaces that read it.
 */
const BADGED: Readonly<
  Record<"pending" | "unpublished" | "rejected" | "removed", string>
> = {
  pending: uiCopy.store.status.pending,
  unpublished: uiCopy.store.status.unpublished,
  rejected: uiCopy.store.status.rejected,
  removed: uiCopy.store.status.removed,
};

export function StoreStatusBadge(props: {
  readonly status: CatalogueStatus | undefined;
}): React.JSX.Element | null {
  const status = props.status;
  if (status === undefined || status === "published" || status === "draft") {
    return null;
  }
  return (
    <span
      data-yunari-store-status={status}
      className="flex-none rounded-full border border-edge px-[var(--space-8)] py-[var(--space-4)] text-2xs font-medium text-muted"
    >
      {BADGED[status]}
    </span>
  );
}
