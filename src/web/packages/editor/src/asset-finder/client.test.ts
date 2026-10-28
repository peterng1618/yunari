import type {
  AssetSearchAnswer,
  AssetSearchRequest,
  AssetSourceListing,
} from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import {
  assetBytes,
  familyCuts,
  listSources,
  searchAssets,
  trashAssets,
} from "./client.js";

const listing: AssetSourceListing = {
  id: "lucide",
  label: "Lucide",
  category: "icon",
  body: "grid",
  requires: null,
  configurable: true,
  presetKind: null,
  host: null,
};

const request: AssetSearchRequest = {
  query: "house",
  enabled: ["lucide"],
  pages: {},
};

function stub(
  responder: (url: string, init: RequestInit | undefined) => Response,
) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];

  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return responder(url, init);
  }) as typeof fetch;

  return { fetcher, calls };
}

describe("listSources", () => {
  it("reads the sources route", async () => {
    const { fetcher, calls } = stub(
      () =>
        new Response(JSON.stringify({ sources: [listing] }), { status: 200 }),
    );

    expect(await listSources({ fetch: fetcher })).toEqual({
      ok: true,
      sources: [listing],
    });
    expect(calls[0]?.url).toBe("/api/assets/sources");
  });

  it("tells a host that does not serve sources apart from one that is absent", async () => {
    // A 503 disables the finder; an empty listing is a host with no sources,
    // and the modal says a different sentence for each.
    const { fetcher } = stub(() => new Response("", { status: 503 }));

    expect(await listSources({ fetch: fetcher })).toEqual({ ok: false });
  });

  it("answers failed rather than throwing when the host is unreachable", async () => {
    const fetcher = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;

    expect(await listSources({ fetch: fetcher })).toEqual({ ok: false });
  });
});

describe("searchAssets", () => {
  it("posts the request to the search route", async () => {
    const answer: AssetSearchAnswer = { pages: [] };
    const { fetcher, calls } = stub(
      () => new Response(JSON.stringify(answer), { status: 200 }),
    );

    expect(await searchAssets(request, { fetch: fetcher })).toEqual(answer);

    expect(calls[0]?.url).toBe("/api/assets/search");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(JSON.stringify(request));
  });

  it("turns a transport failure into a failed page per asked source", async () => {
    const fetcher = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;

    const answer = await searchAssets(
      { ...request, enabled: ["lucide", "unsplash"] },
      { fetch: fetcher },
    );

    expect(answer.pages.map((page) => page.source)).toEqual([
      "lucide",
      "unsplash",
    ]);
    expect(answer.pages[0]?.failure?.reason).toBe("failed");
  });

  it("turns a refused search into failed pages carrying the status", async () => {
    const { fetcher } = stub(() => new Response("nope", { status: 500 }));

    const answer = await searchAssets(request, { fetch: fetcher });

    const failure = answer.pages[0]?.failure;
    expect(failure?.reason).toBe("failed");
    expect(failure?.reason === "failed" ? failure.message : "").toContain(
      "500",
    );
  });
});

describe("assetBytes", () => {
  it("names the source and the asset, and reads the filename header", async () => {
    const { fetcher, calls } = stub(
      () =>
        new Response("<svg></svg>", {
          status: 200,
          headers: { "x-yunari-filename": "house.svg" },
        }),
    );

    const answer = await assetBytes("lucide", "house", { fetch: fetcher });

    expect(calls[0]?.url).toBe("/api/assets/bytes?source=lucide&id=house");
    expect(answer?.filename).toBe("house.svg");
    expect(new TextDecoder().decode(answer?.bytes)).toBe("<svg></svg>");
  });

  it("answers undefined for an asset the source does not have", async () => {
    const { fetcher } = stub(() => new Response("", { status: 404 }));

    expect(
      await assetBytes("lucide", "missing", { fetch: fetcher }),
    ).toBeUndefined();
  });
});

describe("familyCuts", () => {
  it("names the source and the family, and answers its cuts", async () => {
    const cuts = [{ id: "cut:fira-code-400", family: "Fira Code" }];
    const { fetcher, calls } = stub(
      () => new Response(JSON.stringify({ cuts }), { status: 200 }),
    );

    expect(
      await familyCuts("curated-fonts", "Fira Code", { fetch: fetcher }),
    ).toEqual(cuts);
    expect(calls[0]?.url).toBe(
      "/api/assets/family-cuts?source=curated-fonts&family=Fira%20Code",
    );
  });

  it("answers undefined when the host cannot enumerate, so import falls back", async () => {
    const { fetcher } = stub(() => new Response("", { status: 404 }));

    expect(
      await familyCuts("lucide", "Inter", { fetch: fetcher }),
    ).toBeUndefined();
  });
});

describe("trashAssets", () => {
  it("posts the files as base64 to the trash route", async () => {
    const { fetcher, calls } = stub(
      () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const answer = await trashAssets(
      [{ name: "old.woff2", bytes: new TextEncoder().encode("woff") }],
      { fetch: fetcher },
    );

    expect(answer).toEqual({ ok: true });
    expect(calls[0]?.url).toBe("/api/assets/trash");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({ files: [{ name: "old.woff2", bytes: btoa("woff") }] }),
    );
  });

  it("carries the host's refusal sentence, which a save must print", async () => {
    const { fetcher } = stub(
      () => new Response("This PC has no trash command.", { status: 500 }),
    );

    expect(
      await trashAssets([{ name: "old.woff2", bytes: new Uint8Array() }], {
        fetch: fetcher,
      }),
    ).toEqual({ ok: false, message: "This PC has no trash command." });
  });

  it("answers a transport failure rather than throwing", async () => {
    const fetcher = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;

    expect(
      await trashAssets([{ name: "old.woff2", bytes: new Uint8Array() }], {
        fetch: fetcher,
      }),
    ).toEqual({ ok: false, message: "fetch failed" });
  });
});
