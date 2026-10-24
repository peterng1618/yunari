import { describe, expect, it } from "vitest";
import { matchStoreGame, normalizeGameName } from "./name-match.js";

function game(id: number, name: string): { id: number; name: string } {
  return { id, name };
}

describe("normalizeGameName", () => {
  it("folds case, strips symbols and punctuation, and collapses whitespace", () => {
    expect(normalizeGameName("  DOOM®: Eternal™  ")).toBe("doom eternal");
    expect(normalizeGameName("Half-Life 2")).toBe("half life 2");
    expect(normalizeGameName("Sid Meier's Civilization© VI")).toBe(
      "sid meiers civilization vi",
    );
  });

  it("drops a leading article", () => {
    expect(normalizeGameName("The Witcher 3: Wild Hunt")).toBe(
      "witcher 3 wild hunt",
    );
    expect(normalizeGameName("A Plague Tale")).toBe("plague tale");
    expect(normalizeGameName("An Example Game")).toBe("example game");
  });

  it("drops edition qualifiers from the end of the title", () => {
    expect(normalizeGameName("Doom - Deluxe Edition")).toBe("doom");
    expect(normalizeGameName("DOOM GOTY")).toBe("doom");
    expect(normalizeGameName("Doom: Definitive Edition")).toBe("doom");
    expect(normalizeGameName("Doom Game of the Year Edition")).toBe("doom");
  });

  it("drops a bare qualifier word, with or without edition", () => {
    expect(normalizeGameName("Doom Remastered")).toBe("doom");
    expect(normalizeGameName("Doom - Director's Cut")).toBe("doom");
    expect(normalizeGameName("BioShock Ultimate")).toBe("bioshock");
    expect(normalizeGameName("BioShock: Complete Edition")).toBe("bioshock");
    expect(normalizeGameName("Doom Remastered Edition")).toBe("doom");
  });

  it("keeps a word that is not a qualifier", () => {
    expect(normalizeGameName("Doom Eternal")).toBe("doom eternal");
  });

  it("folds a Latin diacritic", () => {
    expect(normalizeGameName("Pokémon")).toBe("pokemon");
  });

  it("keeps kana voicing and Cyrillic phonemic marks", () => {
    expect(normalizeGameName("が")).not.toBe(normalizeGameName("か"));
    expect(normalizeGameName("Мой")).not.toBe(normalizeGameName("Мои"));
    expect(normalizeGameName("逆転裁判")).toBe("逆転裁判");
  });

  it("does not collapse a qualifier-only title to empty", () => {
    expect(normalizeGameName("Ultimate Edition")).toBe("ultimate edition");
    expect(normalizeGameName("Remastered")).toBe("remastered");
  });
});

describe("matchStoreGame", () => {
  it("accepts one candidate whose base title is equal", () => {
    expect(
      matchStoreGame("Doom — Deluxe Edition", [
        game(1, "DOOM"),
        game(2, "Doom Eternal"),
      ]),
    ).toEqual(game(1, "DOOM"));
  });

  it("accepts a candidate whose token set is equal in another order", () => {
    expect(
      matchStoreGame("Grand Theft Auto: San Andreas", [
        game(5, "San Andreas — Grand Theft Auto"),
      ]),
    ).toEqual(game(5, "San Andreas — Grand Theft Auto"));
  });

  it("accepts a bare or suffixed qualifier on either side", () => {
    expect(matchStoreGame("Doom - Director's Cut", [game(8, "DOOM")])).toEqual(
      game(8, "DOOM"),
    );
    expect(matchStoreGame("BioShock Ultimate", [game(7, "BioShock")])).toEqual(
      game(7, "BioShock"),
    );
  });

  it("refuses Doom against Doom Eternal", () => {
    expect(matchStoreGame("Doom", [game(2, "Doom Eternal")])).toBeUndefined();
  });

  it("has no prefix or substring rule: Half-Life is not Half-Life 2", () => {
    expect(
      matchStoreGame("Half-Life", [game(3, "Half-Life 2")]),
    ).toBeUndefined();
  });

  it("refuses when two distinct candidates survive", () => {
    expect(
      matchStoreGame("Doom", [game(1, "DOOM"), game(4, "Doom™")]),
    ).toBeUndefined();
  });

  it("treats repeated candidates for one app id as one survivor", () => {
    expect(matchStoreGame("Doom", [game(1, "DOOM"), game(1, "Doom")])).toEqual(
      game(1, "DOOM"),
    );
  });

  it("refuses an empty local name", () => {
    expect(matchStoreGame("   ", [game(1, "DOOM")])).toBeUndefined();
  });

  it("never matches a qualifier-only title", () => {
    expect(
      matchStoreGame("Ultimate Edition", [game(1, "Ultimate Edition")]),
    ).toBeUndefined();
    expect(matchStoreGame("Doom", [game(2, "Remastered")])).toBeUndefined();
  });

  it("refuses non-Latin titles differing only by a phonemic mark", () => {
    expect(matchStoreGame("が", [game(1, "か")])).toBeUndefined();
    expect(matchStoreGame("Мой", [game(2, "Мои")])).toBeUndefined();
  });

  it("accepts a Latin title differing only by a diacritic", () => {
    expect(matchStoreGame("Pokémon", [game(3, "Pokemon")])).toEqual(
      game(3, "Pokemon"),
    );
  });
});
