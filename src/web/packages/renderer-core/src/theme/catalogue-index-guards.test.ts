import { describe, expect, it } from "vitest";
import { isCatalogueId, isCatalogueStatus } from "./catalogue-index.js";

describe("isCatalogueId", () => {
  it("accepts a lowercase UUID", () =>
    expect(isCatalogueId("3f2a1c9e-8b7d-4c6a-9e0f-1a2b3c4d5e6f")).toBe(true));
  it.each([
    "aurora",
    "3F2A1C9E-8B7D-4C6A-9E0F-1A2B3C4D5E6F",
    "3f2a1c9e-8b7d-4c6a-9e0f",
  ])("refuses %s", (id) => expect(isCatalogueId(id)).toBe(false));
});

describe("isCatalogueStatus", () => {
  it("accepts the six wire states and refuses anything else", () => {
    for (const status of [
      "draft",
      "pending",
      "published",
      "unpublished",
      "rejected",
      "removed",
    ]) {
      expect(isCatalogueStatus(status), status).toBe(true);
    }

    for (const other of [
      "shadow-banned",
      "Published",
      "",
      3,
      undefined,
      null,
    ]) {
      expect(isCatalogueStatus(other), String(other)).toBe(false);
    }
  });
});
