import { describe, expect, it } from "vitest";
import { fetchAuthorName } from "./author.js";

const ID = "76561198000000001";

/** A fetch that answers one body, and counts the requests it was asked for. */
function answering(
  body: string,
  init?: ResponseInit,
): {
  readonly fetchImpl: typeof fetch;
  readonly calls: () => number;
} {
  let calls = 0;
  return {
    fetchImpl: (() => {
      calls += 1;
      return Promise.resolve(new Response(body, init));
    }) as typeof fetch,
    calls: () => calls,
  };
}

describe("the Steam author lookup", () => {
  it("answers the persona name out of the profile XML", async () => {
    const { fetchImpl } = answering(
      "<profile><steamID>Ada</steamID></profile>",
    );

    expect(await fetchAuthorName(ID, { fetchImpl })).toBe("Ada");
  });

  it("decodes the XML entities a name may carry", async () => {
    const { fetchImpl } = answering(
      "<profile><steamID>Ada &amp; Eve &lt;3</steamID></profile>",
    );

    expect(await fetchAuthorName(ID, { fetchImpl })).toBe("Ada & Eve <3");
  });

  it("answers nothing for a non-OK response", async () => {
    const { fetchImpl } = answering("<steamID>Ada</steamID>", { status: 500 });

    expect(await fetchAuthorName(ID, { fetchImpl })).toBeUndefined();
  });

  it("answers nothing when the request is aborted", async () => {
    const fetchImpl = (() =>
      Promise.reject(
        new DOMException("aborted", "AbortError"),
      )) as typeof fetch;

    expect(await fetchAuthorName(ID, { fetchImpl })).toBeUndefined();
  });

  it("answers nothing for a body carrying no steamID", async () => {
    const { fetchImpl } = answering("<profile></profile>");

    expect(await fetchAuthorName(ID, { fetchImpl })).toBeUndefined();
  });

  it("asks for no profile when the id is not 17 digits", async () => {
    const { fetchImpl, calls } = answering("<steamID>Ada</steamID>");

    expect(await fetchAuthorName("123", { fetchImpl })).toBeUndefined();
    expect(calls()).toBe(0);
  });
});
