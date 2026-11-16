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

/** A collection's install state, as the card's action and the state filter both
 *  read it. */
export type CollectionInstallState = "installed" | "partial" | "absent";

export interface CollectionState {
  /** How many of the collection's includes the register names. */
  readonly installed: number;
  /** How many listings the collection installs. */
  readonly total: number;
  readonly state: CollectionInstallState;
}

/**
 * **A collection's state is counted over its required includes, which is the
 * only place it exists.** The host records membership on each member's origin
 * row, so a collection never has an origin of its own and `installStateOf` —
 * which reads a copy's own origin — cannot answer for it. A **declined optional
 * include is not part of the count**: the spec reads "On this PC" when every
 * required include is installed, so an unticked optional can never leave the
 * collection permanently `partial`. Every required include in the register is
 * `installed`, none is `absent`, and anything between is `partial`.
 *
 * `undefined` when the listing installs no required listing, so a plain theme
 * keeps `installStateOf` as its owner.
 */
export function collectionStateOf(
  listing: StoreItem,
  origins: readonly CatalogueOrigin[],
): CollectionState | undefined {
  const includes = listing.includes;
  if (includes === undefined) return undefined;
  const required = includes.filter((include) => include.optional !== true);
  if (required.length === 0) return undefined;

  const held = new Set(origins.map((origin) => origin.catalogueId));
  let installed = 0;
  for (const include of required) {
    if (held.has(include.id)) installed += 1;
  }

  const total = required.length;
  return {
    installed,
    total,
    state:
      installed === 0
        ? "absent"
        : installed === total
          ? "installed"
          : "partial",
  };
}
