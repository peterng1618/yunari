import type { CollectionDraft } from "@yunari/theme-package";

export type {
  CollectionDraft,
  CollectionDraftResult,
} from "@yunari/theme-package";
export {
  collectionManifest,
  parseCollectionDraft,
  readCollectionDraft,
} from "@yunari/theme-package";

/**
 * Whether the draft names the listing the submission itself creates.
 *
 * The draft's own validation lives with the format in `@yunari/theme-package`;
 * only this check needs a second input, because only the caller knows which
 * listing it is publishing.
 */
export function selfIncludeRefusal(
  draft: CollectionDraft,
  listingId: string,
): string | undefined {
  return draft.includes.some((include) => include.id === listingId)
    ? "A collection cannot include itself."
    : undefined;
}
