import type { InstalledExtension } from "@yunari/extension-api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceContext } from "../assets/source.js";
import {
  type HostLookup,
  PINNED_ADDRESSES,
  type PinnedRequestInit,
} from "../providers/custom/fetch-source.js";
import {
  type DeclarativeAssetSource,
  declarativeAssetSources,
  readDeclarativeAssetSource,
} from "./declarative-contributions.js";
import { DeclarativeAssetSourceAdapter } from "./declarative-sources.js";

const pinned = vi.hoisted(() => ({
  createPinnedFetch: vi.fn(),
  fetchImpl: vi.fn(),
}));

vi.mock("../providers/custom/pinned-fetch.js", () => ({
  createPinnedFetch: pinned.createPinnedFetch,
}));

beforeEach(() => {
  pinned.createPinnedFetch.mockReset();
  pinned.fetchImpl.mockReset();
  pinned.createPinnedFetch.mockImplementation(() => pinned.fetchImpl);
});

const resolve: HostLookup = async () => [
  { address: "93.184.216.34", family: 4 },
];

function installed(
  overrides: Partial<InstalledExtension> = {},
): InstalledExtension {
  return {
    key: "local/acme",
    name: "Acme",
    version: "1.0.0",
    execution: "declarative",
    capabilities: ["asset:provide"],
    contributions: {},
    consent: "not-required",
    fingerprint: "a".repeat(64),
    ...overrides,
  };
}

function declarativeSource(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    id: "acme",
    label: "Acme",
    category: "image",
    body: "grid",
    host: "api.acme.test",
    request: {
      url: "https://api.acme.test/search?q={query}&page={page}",
      pageParam: "page",
      firstPage: 1,
      totalPath: "/total",
    },
    result: {
      itemsPath: "/items",
      id: "/id",
      name: "/name",
      preview: "/thumb",
      sourceUrl: "/sourceUrl",
    },
    ...overrides,
  };
}

function readSource(value: unknown): DeclarativeAssetSource {
  const read = readDeclarativeAssetSource(value);
  if (!read.ok) throw new Error(read.message);
  return read.source;
}

function context(): SourceContext {
  return {
    credential: () => undefined,
    signal: new AbortController().signal,
    fetch: globalThis.fetch,
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function adapter(
  contribution: Readonly<Record<string, unknown>>,
  fetchImpl: typeof fetch,
): DeclarativeAssetSourceAdapter {
  return new DeclarativeAssetSourceAdapter({
    plugin: installed(),
    contribution: readSource(contribution),
    fetchImpl,
    resolve,
  });
}

const ITEM = {
  id: "r1",
  name: "Glass",
  thumb: "https://cdn.acme.test/r1.png",
  sourceUrl: "https://api.acme.test/items/r1",
};

describe("readDeclarativeAssetSource", () => {
  it("refuses a plain-http source and a userinfo URL", () => {
    expect(
      readDeclarativeAssetSource(
        declarativeSource({ request: { url: "http://api.acme.test" } }),
      ),
    ).toEqual({
      ok: false,
      message: "Declarative asset sources must use https.",
    });
    expect(
      readDeclarativeAssetSource(
        declarativeSource({
          request: { url: "https://user:pass@api.acme.test" },
        }),
      ),
    ).toEqual({
      ok: false,
      message: "A declarative asset source URL may not carry user information.",
    });
  });

  it("refuses a host credential or request.auth", () => {
    expect(
      readDeclarativeAssetSource(
        declarativeSource({
          requires: "acme-key",
          request: { url: "https://api.acme.test/search" },
        }),
      ),
    ).toEqual({
      ok: false,
      message:
        'The declarative asset source "acme" may not use a host credential; fetch with its own endpoint instead.',
    });

    expect(
      readDeclarativeAssetSource(
        declarativeSource({
          request: {
            url: "https://api.acme.test/search",
            auth: { kind: "header", name: "x-api-key" },
          },
        }),
      ),
    ).toEqual({
      ok: false,
      message:
        'The declarative asset source "acme" may not declare request.auth.',
    });
  });

  it("defaults firstPage to 1 and fills missing placeholders", () => {
    const source = readSource(
      declarativeSource({ request: { url: "https://api.acme.test/search" } }),
    );
    expect(source.request.firstPage).toBeUndefined();
    expect(source.request.url).toBe("https://api.acme.test/search");
  });
});

describe("DeclarativeAssetSourceAdapter.search", () => {
  it("maps an item and follows the page parameter", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ total: 3, items: [ITEM] }),
    ) as unknown as typeof fetch;
    const source = adapter(declarativeSource(), fetchImpl);

    expect(await source.search("glass", 2, context())).toEqual({
      results: [
        {
          id: "r1",
          name: "Glass",
          preview: "https://cdn.acme.test/r1.png",
          kind: "unknown",
          subtitle: undefined,
          licence: "unknown",
          sourceUrl: "https://api.acme.test/items/r1",
        },
      ],
      totalPages: 3,
    });

    const [url] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.acme.test/search?q=glass&page=2");
  });

  it("appends the query and page when the template omits them", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ items: [ITEM] }),
    ) as unknown as typeof fetch;
    const source = adapter(
      declarativeSource({
        request: { url: "https://api.acme.test/search", pageParam: "page" },
      }),
      fetchImpl,
    );

    await source.search("glass", 3, context());

    const [url] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.acme.test/search?q=glass&page=3");
  });

  it("refuses an item without a usable id or name", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ total: 1, items: [{ id: "", name: "Glass" }] }),
    ) as unknown as typeof fetch;
    const source = adapter(declarativeSource(), fetchImpl);

    await expect(source.search("glass", 1, context())).rejects.toThrow(
      "The declarative asset source returned an unusable asset.",
    );
  });

  it("refuses a page whose items path is not an array", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ total: 1, items: { id: "r1" } }),
    ) as unknown as typeof fetch;
    const source = adapter(declarativeSource(), fetchImpl);

    await expect(source.search("glass", 1, context())).rejects.toThrow(
      "The declarative asset source returned an unusable search page.",
    );
  });

  it("defaults totalPages to undefined when the count is missing or behind", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ total: 1, items: [ITEM] }),
    ) as unknown as typeof fetch;
    const source = adapter(declarativeSource(), fetchImpl);

    expect((await source.search("glass", 2, context())).totalPages).toBe(
      undefined,
    );

    const absent = vi.fn(async () =>
      jsonResponse({ items: [ITEM] }),
    ) as unknown as typeof fetch;
    const other = adapter(
      declarativeSource({ request: { url: "https://api.acme.test/search" } }),
      absent,
    );
    expect((await other.search("glass", 1, context())).totalPages).toBe(
      undefined,
    );
  });

  it("refuses a totalPages that is not an integer in range", async () => {
    for (const total of [3.5, 10_001]) {
      const fetchImpl = vi.fn(async () =>
        jsonResponse({ total, items: [ITEM] }),
      ) as unknown as typeof fetch;
      const source = adapter(declarativeSource(), fetchImpl);

      expect((await source.search("glass", 1, context())).totalPages).toBe(
        undefined,
      );
    }
  });

  it("is configurable so the finder can toggle it", () => {
    const source = adapter(
      declarativeSource(),
      vi.fn() as unknown as typeof fetch,
    );
    expect(source.configurable).toBe(true);
  });

  it("pins every request through the default fetch", async () => {
    pinned.fetchImpl.mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect((init as PinnedRequestInit)[PINNED_ADDRESSES]).toEqual([
          { address: "93.184.216.34", family: 4 },
        ]);
        return String(input).endsWith("/items/r1")
          ? new Response(new Uint8Array([1]), {
              status: 200,
              headers: { "content-type": "image/png" },
            })
          : jsonResponse({ total: 1, items: [ITEM] });
      },
    );

    const source = new DeclarativeAssetSourceAdapter({
      plugin: installed(),
      contribution: readSource(declarativeSource()),
      resolve,
    });

    await source.search("glass", 1, context());
    await source.bytesOf("r1", context());

    expect(pinned.createPinnedFetch).toHaveBeenCalledWith({ lookup: resolve });
    expect(pinned.fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("DeclarativeAssetSourceAdapter.bytesOf", () => {
  it("fetches the remembered sourceUrl with its content type and a filename", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/items/r1")
        ? new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "content-type": "image/png" },
          })
        : jsonResponse({ total: 1, items: [ITEM] }),
    ) as unknown as typeof fetch;
    const source = adapter(declarativeSource(), fetchImpl);

    await source.search("glass", 1, context());
    const bytes = await source.bytesOf("r1", context());

    expect(bytes?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(bytes?.contentType).toBe("image/png");
    expect(bytes?.filename).toBe("r1");
  });

  it("returns undefined for an id the last search did not yield", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ total: 1, items: [ITEM] }),
    ) as unknown as typeof fetch;
    const source = adapter(declarativeSource(), fetchImpl);

    expect(await source.bytesOf("r1", context())).toBeUndefined();
    expect(vi.mocked(fetchImpl)).not.toHaveBeenCalled();
  });

  it("refuses a sourceUrl outside the declared hosts", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        total: 1,
        items: [{ ...ITEM, sourceUrl: "https://evil.test/r1" }],
      }),
    ) as unknown as typeof fetch;
    const source = adapter(declarativeSource(), fetchImpl);

    await source.search("glass", 1, context());
    expect(await source.bytesOf("r1", context())).toBeUndefined();
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });

  it("refuses an artwork host that resolves to a private address", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const artworkResolve: HostLookup = async (host) =>
      host === "cdn.acme.test"
        ? [{ address: "127.0.0.1", family: 4 }]
        : [{ address: "93.184.216.34", family: 4 }];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/items/r1")
        ? new Response(new Uint8Array([1]), {
            status: 200,
            headers: { "content-type": "image/png" },
          })
        : jsonResponse({
            total: 1,
            items: [{ ...ITEM, sourceUrl: "https://cdn.acme.test/r1" }],
          }),
    ) as unknown as typeof fetch;
    const source = new DeclarativeAssetSourceAdapter({
      plugin: installed(),
      contribution: readSource(declarativeSource({ host: "cdn.acme.test" })),
      fetchImpl,
      resolve: artworkResolve,
    });

    await source.search("glass", 1, context());
    expect(await source.bytesOf("r1", context())).toBeUndefined();
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });

  it("refuses a remembered sourceUrl that is not https", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        total: 1,
        items: [{ ...ITEM, sourceUrl: "http://api.acme.test/r1" }],
      }),
    ) as unknown as typeof fetch;
    const source = adapter(declarativeSource(), fetchImpl);

    await source.search("glass", 1, context());
    expect(await source.bytesOf("r1", context())).toBeUndefined();
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });

  it("falls back to a safe filename for a non-ASCII path", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/items/r1")
        ? new Response(new Uint8Array([1]), {
            status: 200,
            headers: { "content-type": "image/png" },
          })
        : jsonResponse({
            total: 1,
            items: [{ ...ITEM, sourceUrl: "https://api.acme.test/%E4%B8%AD" }],
          }),
    ) as unknown as typeof fetch;
    const source = adapter(declarativeSource(), fetchImpl);

    await source.search("glass", 1, context());
    const bytes = await source.bytesOf("r1", context());

    expect(bytes?.filename).toBe("asset");
  });

  it("stops an artwork past the 32 MiB cap", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 33) {
          controller.close();
          return;
        }
        sent += 1;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/items/r1")
        ? new Response(body, {
            status: 200,
            headers: { "content-type": "image/png" },
          })
        : jsonResponse({ total: 1, items: [ITEM] }),
    ) as unknown as typeof fetch;
    const source = adapter(declarativeSource(), fetchImpl);

    await source.search("glass", 1, context());
    expect(await source.bytesOf("r1", context())).toBeUndefined();
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });
});

describe("declarativeAssetSources", () => {
  function extensionWith(
    key: string,
    rows: readonly Readonly<Record<string, unknown>>[],
    consent: InstalledExtension["consent"] = "not-required",
  ): InstalledExtension {
    return installed({
      key,
      consent,
      contributions: { assetSources: rows },
    });
  }

  it("skips an extension whose consent is missing", () => {
    expect(
      declarativeAssetSources([
        extensionWith("local/acme", [declarativeSource()], "missing"),
      ]),
    ).toEqual([]);
  });

  it("caps an extension at 20 sources", () => {
    const rows = Array.from({ length: 21 }, (_, index) =>
      declarativeSource({ id: `acme-${index}` }),
    );

    const sources = declarativeAssetSources([
      extensionWith("local/acme", rows),
    ]);

    expect(sources).toHaveLength(20);
  });

  it("skips a malformed row and a duplicate id with a logged reason", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const sources = declarativeAssetSources([
      extensionWith("local/acme", [
        declarativeSource({ id: "acme" }),
        declarativeSource({ id: "broken", body: "font-picker" }),
      ]),
      extensionWith("local/other", [declarativeSource({ id: "acme" })]),
    ]);

    expect(sources.map((source) => source.id)).toEqual(["acme"]);
    expect(warn).toHaveBeenCalledTimes(2);

    warn.mockRestore();
  });
});
