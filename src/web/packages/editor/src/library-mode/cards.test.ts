/**
 * The card list one listing becomes.
 *
 * **A card is what a person shops for, not what the package is filed as.** A
 * one-member listing is that member's card; a package with several members is
 * one pack card plus a card per member; a collection carries no members of its
 * own and draws one card from its `includes`.
 *
 * The page's row builder (`region.tsx`) owns which listings a page draws. This
 * file owns only how each listing becomes cards, so the grid cannot draw a
 * second, differently-derived set of the same copies.
 */
import {
  type CatalogueOrigin,
  DASHBOARD_THEME_KIND,
  defaultFacetsFor,
} from "@yunari/renderer-core";
import { expect, it } from "vitest";
import type { StoreItem } from "../store-mode/local-source.js";
import { cardsOf, collectionStateOf } from "./cards.js";

/** What the register records for an installed catalogue item. */
function originOf(catalogueId: string): CatalogueOrigin {
  return {
    kind: DASHBOARD_THEME_KIND,
    catalogueId,
    version: "1.0.0",
    installedAt: "2026-10-01T00:00:00.000Z",
  };
}

function listing(overrides: Partial<StoreItem> = {}): StoreItem {
  return {
    id: "living-room",
    kind: DASHBOARD_THEME_KIND,
    name: "Living room",
    members: [
      { id: "living-room", kind: DASHBOARD_THEME_KIND, name: "Living room" },
    ],
    author: undefined,
    version: "1.0.0",
    updatedAt: undefined,
    thumbnailUrl: undefined,
    ground: undefined,
    origin: undefined,
    catalogue: undefined,
    facets: defaultFacetsFor(DASHBOARD_THEME_KIND),
    ...overrides,
  };
}

/** A widget pack with the two units it advertises. */
function pack(overrides: Partial<StoreItem> = {}): StoreItem {
  return listing({
    id: "ops-pack",
    kind: "widget-pack",
    name: "Ops pack",
    members: [
      { id: "clock", kind: "widget", name: "Clock" },
      { id: "fan", kind: "widget", name: "Fan" },
    ],
    ...overrides,
  });
}

it("draws a single-member listing as a member card", () => {
  const cards = cardsOf([listing()]);

  expect(cards, "one listing did not become exactly one card").toHaveLength(1);
  expect(cards[0]?.key, "the card's key is not the listing's").toBe(
    "living-room",
  );
  expect(
    cards[0]?.member?.name,
    "the one-member listing is not drawn as its member",
  ).toBe("Living room");
});

it("draws a multi-member listing as a pack card and one card per member", () => {
  const source = pack();
  const cards = cardsOf([source]);

  expect(
    cards,
    "the pack did not become one pack card plus its two members",
  ).toHaveLength(3);
  const [packCard, ...members] = cards;
  expect(
    packCard?.member,
    "the pack card carries a member, so it cannot expand",
  ).toBeUndefined();
  expect(packCard?.key, "the pack card is not keyed by its listing").toBe(
    "ops-pack",
  );
  expect(packCard?.listing, "the pack card does not carry the listing").toBe(
    source,
  );
  expect(
    members.map((card) => card.member?.name),
    "the pack's member cards are not one per member, in order",
  ).toEqual(["Clock", "Fan"]);
  for (const card of members) {
    expect(card.listing, "a member card lost its listing").toBe(source);
  }
});

it("keys every card of one package uniquely and keeps the listing's key", () => {
  const cards = cardsOf([pack()]);
  const keys = cards.map((card) => card.key);

  expect(new Set(keys).size, "two member cards share a key").toBe(keys.length);
  expect(
    keys.filter((key) => key === "ops-pack"),
    "the listing's own key is not held by exactly its pack card",
  ).toHaveLength(1);
});

it("draws an empty-member listing once, as its own card", () => {
  const collection = listing({
    id: "ops-collection",
    kind: "collection",
    name: "Ops collection",
    members: [],
    includes: [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ],
  });

  const cards = cardsOf([collection]);

  expect(
    cards,
    "a collection with no members did not draw exactly one card",
  ).toHaveLength(1);
  expect(cards[0]?.key).toBe("ops-collection");
  expect(cards[0]?.member).toBeUndefined();
  expect(
    cards[0]?.listing.includes,
    "the card lost the includes its count is read from",
  ).toEqual(collection.includes);
});

it("draws each copy in a mixed listing exactly once", () => {
  const cards = cardsOf([listing(), pack(), listing({ id: "workshop-bench" })]);

  expect(
    cards.map((card) => card.key),
    "a copy was drawn twice or dropped",
  ).toEqual([
    "living-room",
    "ops-pack",
    "ops-pack#0:widget/clock",
    "ops-pack#1:widget/fan",
    "workshop-bench",
  ]);
});

it("states a collection from the includes the register names", () => {
  const includes = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
  ] as const;
  const collection = listing({ kind: "collection", members: [], includes });
  const held = originOf(includes[0]);
  const alsoHeld = originOf(includes[2]);

  expect(
    collectionStateOf(collection, [held, alsoHeld]),
    "a partial collection is not counted over its includes",
  ).toEqual({ installed: 2, total: 4, state: "partial" });
  expect(
    collectionStateOf(collection, [
      held,
      alsoHeld,
      originOf(includes[1]),
      originOf(includes[3]),
    ]),
    "a collection whose every include is held is not installed",
  ).toEqual({ installed: 4, total: 4, state: "installed" });
  expect(
    collectionStateOf(collection, []),
    "a collection with nothing held is not absent",
  ).toEqual({ installed: 0, total: 4, state: "absent" });
});

it("answers no collection state for a listing that installs no includes", () => {
  expect(collectionStateOf(listing(), [])).toBeUndefined();
  expect(
    collectionStateOf(
      listing({ kind: "collection", members: [], includes: [] }),
      [],
    ),
    "an empty include list has a collection state",
  ).toBeUndefined();
});
