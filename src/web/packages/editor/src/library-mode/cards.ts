import type { CatalogueOrigin, MemberRecord } from "@yunari/renderer-core";
import type { StoreItem } from "../store-mode/local-source.js";

/**
 * How one listing becomes the cards a person shops for.
 *
 * **A card is a member, unless the listing has several.** A listing with one
 * member is that member's card, keyed by the listing so the listing's own
 * identity stays the card's. A listing with several members is one pack card —
 * the package's picture, name and member count — plus one card per member,
 * keyed so a refresh cannot confuse two of them. A collection installs
 * `includes` rather than members of its own, so it draws its one card and no
 * member cards.
 *
 * The grid reads this list rather than deriving cards itself, so a pack and its
 * members cannot disagree about what the package contains.
 */
export interface StoreCard {
  /** Stable across a re-listing: the listing id for the package's own card, and
   *  the listing plus the member's own id for a member's card. */
  readonly key: string;
  readonly listing: StoreItem;
  /** The member this card draws, or `undefined` for a pack card. */
  readonly member: MemberRecord | undefined;
}

/** One member card's key. The index keeps two members that share an id — one
 *  plugin can contribute the same id under two groups — from sharing a key. */
function memberCardKey(
  listing: StoreItem,
  index: number,
  member: MemberRecord,
): string {
  return `${listing.id}#${index}:${member.kind}/${member.id}`;
}

export function cardsOf(items: readonly StoreItem[]): readonly StoreCard[] {
  return items.flatMap((listing): StoreCard[] => {
    const members = listing.members;
    const only = members[0];
    if (members.length === 1 && only !== undefined) {
      return [{ key: listing.id, listing, member: only }];
    }
    return [
      { key: listing.id, listing, member: undefined },
      ...members.map(
        (member, index): StoreCard => ({
          key: memberCardKey(listing, index, member),
          listing,
          member,
        }),
      ),
    ];
  });
}

/** The catalogue ids the register names, as one membership test for the cards
 *  drawn from it. The same read feeds the update diff later, so a card never
 *  asks the host a second question to draw its count. */
export function installedCatalogueIds(
  origins: readonly CatalogueOrigin[],
): ReadonlySet<string> {
  return new Set(origins.map((origin) => origin.catalogueId));
}

/** How many of a collection's includes this PC holds. */
export interface InstalledIncludes {
  readonly installed: number;
  readonly total: number;
}

/**
 * A collection's partial install, counted over `includes` — the members it
 * actually installs — and never over `members`, which a collection leaves
 * empty. `undefined` when the listing installs no included listing at all, so a
 * plain theme draws no count.
 */
export function installedIncludesOf(
  listing: StoreItem,
  installed: ReadonlySet<string>,
): InstalledIncludes | undefined {
  const includes = listing.includes;
  if (includes === undefined || includes.length === 0) return undefined;

  let count = 0;
  for (const id of includes) {
    if (installed.has(id)) count += 1;
  }
  return { installed: count, total: includes.length };
}
