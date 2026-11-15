import { describe, expect, it } from "vitest";
import {
  CATALOGUE_ORIGIN,
  catalogueIndexUrl,
  catalogueItemUrl,
  cataloguePackageUrl,
  catalogueThumbnailUrl,
} from "./catalogue-location.js";

const ID = "yunari/office-wall";

describe("the catalogue's addresses", () => {
  it("builds the Worker's public addresses from one origin", () => {
    expect(catalogueIndexUrl()).toBe(`${CATALOGUE_ORIGIN}/index.json`);
    expect(catalogueItemUrl(ID)).toBe(
      `${CATALOGUE_ORIGIN}/catalogue/${ID}/item.json`,
    );
    expect(cataloguePackageUrl(ID, "1.0.0")).toBe(
      `${CATALOGUE_ORIGIN}/catalogue/${ID}/1.0.0.zip`,
    );
    expect(catalogueThumbnailUrl(`catalogue/${ID}/thumbnail.png`)).toBe(
      `${CATALOGUE_ORIGIN}/catalogue/${ID}/thumbnail.png`,
    );
  });

  it("reads an item from the configured store's origin when one is given", () => {
    expect(catalogueItemUrl(ID, "https://store.example")).toBe(
      `https://store.example/catalogue/${ID}/item.json`,
    );
  });
});
