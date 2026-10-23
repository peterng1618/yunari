import type { AssetPage, AssetResult } from "@yunari/renderer-core";
import { expect, it } from "vitest";
import { interleave } from "./interleave.js";

const row = (id: string): AssetResult => ({
  id,
  name: id,
  kind: "icon",
  preview: "",
  subtitle: undefined,
  licence: "MIT",
  sourceUrl: "",
});

const page = (source: string, ids: readonly string[]): AssetPage => ({
  source,
  results: ids.map(row),
  totalPages: 1,
  failure: undefined,
});

/**
 * Two sources' pages become one grid by alternating their rows, and whatever
 * the reader has already seen keeps its place: a later page appends.
 */
it("alternates each page's rows and appends them after the previous ones", () => {
  const previous = [row("a:0")];
  const ordered = interleave(
    [page("a", ["a:1", "a:3", "a:5"]), page("b", ["b:2", "b:4"])],
    previous,
  );

  expect(ordered.map((result) => result.id)).toEqual([
    "a:0",
    "a:1",
    "b:2",
    "a:3",
    "b:4",
    "a:5",
  ]);
});

it("keeps the previous rows untouched when no page answers", () => {
  const previous = [row("a:0"), row("b:1")];
  expect(interleave([], previous)).toEqual(previous);
});

it("keeps every row of an uneven pair of pages", () => {
  const ordered = interleave(
    [page("a", ["a:1"]), page("b", ["b:2", "b:3", "b:4"])],
    [],
  );
  expect(ordered.map((result) => result.id)).toEqual([
    "a:1",
    "b:2",
    "b:3",
    "b:4",
  ]);
});
