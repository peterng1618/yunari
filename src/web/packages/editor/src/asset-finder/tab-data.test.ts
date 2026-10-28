import type { AssetPage, AssetResult } from "@yunari/renderer-core";
import { expect, it } from "vitest";
import {
  appendAnswer,
  EMPTY_TAB,
  hasMore,
  nextPages,
  resetForQuestion,
  retryPages,
  rowsOf,
} from "./tab-data.js";

const result = (id: string): AssetResult => ({
  id,
  name: id,
  kind: "icon",
  preview: "",
  subtitle: undefined,
  licence: "MIT",
  sourceUrl: "",
});

const page = (
  source: string,
  ids: readonly string[],
  totalPages: number | undefined,
): AssetPage => ({
  source,
  results: ids.map(result),
  totalPages,
  failure: undefined,
});

it("asks page one of every enabled source, then only those with more", () => {
  expect(nextPages(EMPTY_TAB, ["a", "b"])).toEqual({ a: 1, b: 1 });

  const after = appendAnswer(
    EMPTY_TAB,
    [page("a", ["a:1"], 2), page("b", ["b:1"], undefined)],
    { a: 1, b: 1 },
  );

  expect(nextPages(after, ["a", "b"])).toEqual({ a: 2 });
  expect(hasMore(after, ["a", "b"])).toBe(true);
});

it("appends without reordering and never draws an id twice", () => {
  const first = appendAnswer(
    EMPTY_TAB,
    [page("a", ["a:1"], 2), page("b", ["b:1"], 2)],
    { a: 1, b: 1 },
  );
  const second = appendAnswer(
    first,
    [page("a", ["a:1", "a:2"], 2), page("b", ["b:2"], 2)],
    { a: 2, b: 2 },
  );

  // A repeated row still takes its slot in the second page's alternation, so
  // the truly new A row lands after B's.
  expect(rowsOf(second, ["a", "b"]).map((row) => row.result.id)).toEqual([
    "a:1",
    "b:1",
    "b:2",
    "a:2",
  ]);
});

it("keeps rows when a page fails and retries only the failed source", () => {
  const first = appendAnswer(EMPTY_TAB, [page("a", ["a:1"], 2)], { a: 1 });
  const failed = appendAnswer(
    first,
    [
      {
        source: "a",
        results: [],
        totalPages: undefined,
        failure: { reason: "failed", message: "down" },
      },
    ],
    { a: 2 },
  );

  expect(rowsOf(failed, ["a"]).map((row) => row.result.id)).toEqual(["a:1"]);
  expect(nextPages(failed, ["a"])).toEqual({});
  expect(retryPages(failed, ["a"])).toEqual({ a: 2 });
  const failure = failed.failures.get("a")?.failure;
  expect(failure?.reason === "failed" ? failure.message : undefined).toBe(
    "down",
  );
});

it("drops a source's rows and place when the question resets", () => {
  const first = appendAnswer(EMPTY_TAB, [page("a", ["a:1"], 5)], { a: 1 });
  const reset = resetForQuestion("blue");

  expect(reset.query).toBe("blue");
  expect(reset.rows).toEqual([]);
  expect(reset.asked.size).toBe(0);
  expect(reset.totals.size).toBe(0);
  expect(reset.failures.size).toBe(0);
  expect(rowsOf(first, ["a"])).toHaveLength(1);
});

it("hides a disabled source's rows without losing them", () => {
  const data = appendAnswer(
    EMPTY_TAB,
    [page("a", ["a:1"], 1), page("b", ["b:1"], 1)],
    { a: 1, b: 1 },
  );

  expect(rowsOf(data, ["b"]).map((row) => row.page.source)).toEqual(["b"]);
  expect(rowsOf(data, ["a", "b"])).toHaveLength(2);
});
