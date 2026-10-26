import { describe, expect, it } from "vitest";
import {
  creditsEntryOf,
  fetchAuthorName,
  fetchExport,
  fetchItemAsset,
  fetchWallpaperEngine,
  findExports,
  prepareMobilePackage,
  startProject,
  type WallpaperEngineItem,
} from "./client.js";

const item = {
  workshopId: "201",
  title: "Rain on glass",
  kind: "video",
  previewUrl: "/api/wallpaper-engine/item/201/preview",
  filesize: 4_194_304,
  tags: ["Rain"],
  stillAtRest: undefined,
  hasText: undefined,
  attribution: {
    steamId: "76561198000000000",
    workshopUrl: "https://steamcommunity.com/sharedfiles/filedetails/?id=201",
  },
} satisfies WallpaperEngineItem;

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

describe("fetchWallpaperEngine", () => {
  it("reads the listing route", async () => {
    const { fetcher, calls } = stub(
      () =>
        new Response(
          JSON.stringify({
            available: true,
            install: "D:/Steam/steamapps/common/wallpaper_engine",
            items: [item],
            skipped: 2,
          }),
          { status: 200 },
        ),
    );

    expect(await fetchWallpaperEngine({ fetch: fetcher })).toEqual({
      available: true,
      items: [item],
      skipped: 2,
    });
    expect(calls[0]?.url).toBe("/api/wallpaper-engine");
  });

  it("answers not-installed for a body that is not the listing", async () => {
    const { fetcher } = stub(
      () => new Response(JSON.stringify({ items: "nope" }), { status: 200 }),
    );

    expect(await fetchWallpaperEngine({ fetch: fetcher })).toEqual({
      available: false,
      reason: "not-installed",
    });
  });

  it("answers not-installed rather than throwing when the host is unreachable", async () => {
    const fetcher = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;

    expect(await fetchWallpaperEngine({ fetch: fetcher })).toEqual({
      available: false,
      reason: "not-installed",
    });
  });

  it("skips a malformed item rather than fabricating one", async () => {
    const { fetcher } = stub(
      () =>
        new Response(
          JSON.stringify({
            available: true,
            items: [item, { workshopId: 7 }, { ...item, kind: "gif" }],
            skipped: 0,
          }),
          { status: 200 },
        ),
    );

    expect(await fetchWallpaperEngine({ fetch: fetcher })).toEqual({
      available: true,
      items: [item],
      skipped: 0,
    });
  });

  it("keeps every kind the listing can still carry", async () => {
    const kinds = ["image", "video", "web", "scene"];
    const { fetcher } = stub(
      () =>
        new Response(
          JSON.stringify({
            available: true,
            items: kinds.map((kind) => ({ ...item, kind })),
            skipped: 0,
          }),
          { status: 200 },
        ),
    );

    const answer = await fetchWallpaperEngine({ fetch: fetcher });

    expect(answer.available && answer.items.map((row) => row.kind)).toEqual(
      kinds,
    );
  });
});

describe("fetchItemAsset", () => {
  it("names the file by the item's title plus the payload extension", async () => {
    const { fetcher, calls } = stub(
      () =>
        new Response("mp4-bytes", {
          status: 200,
          headers: { "content-type": "video/mp4" },
        }),
    );

    const file = await fetchItemAsset(item, { fetch: fetcher });

    expect(calls[0]?.url).toBe("/api/wallpaper-engine/item/201/asset");
    expect(file?.name).toBe("Rain on glass.mp4");
    expect(file?.type).toBe("video/mp4");
    expect(new TextDecoder().decode(await file?.arrayBuffer())).toBe(
      "mp4-bytes",
    );
  });

  it("prefers the filename the host served", async () => {
    const { fetcher } = stub(
      () =>
        new Response("png-bytes", {
          status: 200,
          headers: {
            "content-type": "image/png",
            "x-yunari-filename": "glass.png",
          },
        }),
    );

    expect((await fetchItemAsset(item, { fetch: fetcher }))?.name).toBe(
      "glass.png",
    );
  });

  it("answers undefined for an item the host cannot serve", async () => {
    const { fetcher } = stub(() => new Response("", { status: 404 }));

    expect(await fetchItemAsset(item, { fetch: fetcher })).toBeUndefined();
  });
});

describe("startProject", () => {
  it("POSTs the item's project route and reads the unpack answer", async () => {
    const { fetcher, calls } = stub(
      () =>
        new Response(
          JSON.stringify({
            ok: true,
            name: "Rain on glass",
            reused: false,
            launched: true,
          }),
          { status: 200 },
        ),
    );

    expect(await startProject(item.workshopId, { fetch: fetcher })).toEqual({
      ok: true,
      name: "Rain on glass",
      reused: false,
    });
    expect(calls[0]?.url).toBe("/api/wallpaper-engine/item/201/project");
    expect(calls[0]?.init?.method).toBe("POST");
  });

  it("answers the host's refusal rather than throwing", async () => {
    const { fetcher } = stub(
      () =>
        new Response(JSON.stringify({ ok: false, reason: "no-install" }), {
          status: 200,
        }),
    );

    expect(await startProject(item.workshopId, { fetch: fetcher })).toEqual({
      ok: false,
      reason: "no-install",
    });
  });

  it("answers a refusal for a response that is not the answer shape", async () => {
    const { fetcher } = stub(() => new Response("<html>", { status: 403 }));

    expect(await startProject(item.workshopId, { fetch: fetcher })).toEqual({
      ok: false,
      reason: "refused",
    });
  });
});

describe("prepareMobilePackage", () => {
  it("POSTs the package bytes and names the video by the package title", async () => {
    const { fetcher, calls } = stub(
      () =>
        new Response(
          JSON.stringify({
            ok: true,
            videoBase64: btoa("mp4-bytes"),
            reencoded: true,
            title: "Rain scene",
            workshopId: "201",
          }),
          { status: 200 },
        ),
    );
    const pkg = new File([new Uint8Array([1, 2, 3])], "export.mpkg");

    const answer = await prepareMobilePackage(pkg, { fetch: fetcher });

    expect(calls[0]?.url).toBe("/api/wallpaper-engine/mpkg");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toEqual({
      "content-type": "application/octet-stream",
    });
    expect(calls[0]?.init?.body).toBe(pkg);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.title).toBe("Rain scene");
    expect(answer.workshopId).toBe("201");
    expect(answer.reencoded).toBe(true);
    expect(answer.file.name).toBe("Rain scene.mp4");
    expect(answer.file.type).toBe("video/mp4");
    expect(new TextDecoder().decode(await answer.file.arrayBuffer())).toBe(
      "mp4-bytes",
    );
  });

  it("names the video by the source's stem when the package carries no title", async () => {
    const { fetcher } = stub(
      () =>
        new Response(
          JSON.stringify({
            ok: true,
            videoBase64: btoa("mp4-bytes"),
            reencoded: false,
          }),
          { status: 200 },
        ),
    );

    const answer = await prepareMobilePackage(
      new File([new Uint8Array([1])], "rain.mpkg"),
      { fetch: fetcher },
    );

    expect(answer.ok && answer.file.name).toBe("rain.mp4");
  });

  it("maps the host's refusal to its sentence", async () => {
    const { fetcher } = stub(
      () =>
        new Response(
          JSON.stringify({ ok: false, message: "No video in this package." }),
          { status: 200 },
        ),
    );

    expect(
      await prepareMobilePackage(new File([new Uint8Array([1])], "rain.mpkg"), {
        fetch: fetcher,
      }),
    ).toEqual({ ok: false, message: "No video in this package." });
  });

  it("answers the host's own sentence for a non-OK response", async () => {
    const { fetcher } = stub(
      () =>
        new Response("That package is too large to import.", { status: 413 }),
    );

    expect(
      await prepareMobilePackage(new File([new Uint8Array([1])], "rain.mpkg"), {
        fetch: fetcher,
      }),
    ).toEqual({
      ok: false,
      message: "That package is too large to import.",
    });
  });

  it("answers a refusal for a response that is not the answer shape", async () => {
    const { fetcher } = stub(() => new Response("", { status: 500 }));

    expect(
      await prepareMobilePackage(new File([new Uint8Array([1])], "rain.mpkg"), {
        fetch: fetcher,
      }),
    ).toEqual({ ok: false, message: "That file could not be imported." });
  });
});

describe("fetchAuthorName", () => {
  it("reads the author route and answers the name", async () => {
    const { fetcher, calls } = stub(
      () => new Response(JSON.stringify({ name: "Ada" }), { status: 200 }),
    );

    expect(await fetchAuthorName("76561198000000001", { fetch: fetcher })).toBe(
      "Ada",
    );
    expect(calls[0]?.url).toBe(
      "/api/wallpaper-engine/author/76561198000000001",
    );
  });

  it("answers nothing for a non-OK response", async () => {
    const { fetcher } = stub(() => new Response("", { status: 403 }));

    expect(
      await fetchAuthorName("76561198000000001", { fetch: fetcher }),
    ).toBeUndefined();
  });

  it("answers nothing for a malformed body", async () => {
    const { fetcher } = stub(
      () => new Response(JSON.stringify({ name: 7 }), { status: 200 }),
    );

    expect(
      await fetchAuthorName("76561198000000001", { fetch: fetcher }),
    ).toBeUndefined();
  });
});

describe("findExports", () => {
  it("asks since the given epoch and reads the files it can use", async () => {
    const { fetcher, calls } = stub(
      () =>
        new Response(
          JSON.stringify({
            files: [
              {
                name: "shot.png",
                format: "png",
                modified: 1_700_000_000_000,
                size: 2_048,
              },
              { name: 7 },
            ],
          }),
          { status: 200 },
        ),
    );

    expect(await findExports(1_700_000_000_000, { fetch: fetcher })).toEqual([
      {
        name: "shot.png",
        format: "png",
        modified: 1_700_000_000_000,
        size: 2_048,
      },
    ]);
    expect(calls[0]?.url).toBe(
      "/api/wallpaper-engine/exports?since=1700000000000",
    );
  });

  it("answers nothing for a host that refused, and never asks with no epoch", async () => {
    const refused = stub(() => new Response("", { status: 400 }));
    expect(
      await findExports(1_700_000_000_000, { fetch: refused.fetcher }),
    ).toEqual([]);

    const never = stub(() => new Response("", { status: 200 }));
    expect(await findExports(Number.NaN, { fetch: never.fetcher })).toEqual([]);
    expect(never.calls).toHaveLength(0);
  });
});

describe("fetchExport", () => {
  it("builds a File named by the host's header", async () => {
    const { fetcher, calls } = stub(
      () =>
        new Response("png-bytes", {
          status: 200,
          headers: {
            "content-type": "image/png",
            "x-yunari-filename": "shot.png",
          },
        }),
    );

    const file = await fetchExport("shot.png", { fetch: fetcher });

    expect(calls[0]?.url).toBe("/api/wallpaper-engine/export?name=shot.png");
    expect(file?.name).toBe("shot.png");
    expect(file?.type).toBe("image/png");
    expect(new TextDecoder().decode(await file?.arrayBuffer())).toBe(
      "png-bytes",
    );
  });

  it("keeps the requested name when the host serves no header", async () => {
    const { fetcher } = stub(
      () =>
        new Response("mp4-bytes", {
          status: 200,
          headers: { "content-type": "video/mp4" },
        }),
    );

    expect((await fetchExport("loop.mp4", { fetch: fetcher }))?.name).toBe(
      "loop.mp4",
    );
  });

  it("answers undefined for an export the host cannot serve", async () => {
    const { fetcher } = stub(() => new Response("", { status: 404 }));

    expect(await fetchExport("gone.png", { fetch: fetcher })).toBeUndefined();
  });
});

describe("creditsEntryOf", () => {
  it("carries the workshop entry, the author and no licence claim", () => {
    expect(creditsEntryOf(item)).toEqual({
      kind: "wallpaper",
      title: "Rain on glass",
      author: { steamId: "76561198000000000" },
      source: {
        workshopId: "201",
        url: "https://steamcommunity.com/sharedfiles/filedetails/?id=201",
      },
      license: "unknown",
      changes: "Copied unchanged",
    });
  });

  it("omits attribution the listing did not carry, keeping only the id", () => {
    expect(creditsEntryOf({ ...item, attribution: undefined })).toEqual({
      kind: "wallpaper",
      title: "Rain on glass",
      source: { workshopId: "201" },
      license: "unknown",
      changes: "Copied unchanged",
    });
  });

  it("keeps the workshop id when the cache row has no link", () => {
    expect(
      creditsEntryOf({
        ...item,
        attribution: { steamId: "76561198000000000" },
      }),
    ).toEqual({
      kind: "wallpaper",
      title: "Rain on glass",
      author: { steamId: "76561198000000000" },
      source: { workshopId: "201" },
      license: "unknown",
      changes: "Copied unchanged",
    });
  });
});
