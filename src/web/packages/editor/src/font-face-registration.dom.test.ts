// @vitest-environment jsdom

import type { FontAssetLoadOptions } from "@yunari/scene-fabric";
import type { FabricObject } from "fabric/es";
import { describe, expect, it, vi } from "vitest";
import { AssetManager } from "./asset-manager/index.js";
import type { CuratedFontFace } from "./font-catalog.js";
import { watchDeclaredFontFaces } from "./font-face-registration.js";

const WOFF2 = new Uint8Array([1, 2, 3, 4]);

function face(family: string): CuratedFontFace {
  return {
    id: family.toLowerCase().replace(/\s+/g, "-"),
    role: "heading",
    family,
    weight: 400,
    style: "normal",
    format: "woff2",
    subset: "latin",
    sourceUrl: `https://cdn.example/${family}.woff2`,
    license: { name: "OFL-1.1" },
  };
}

function textIn(family: string): FabricObject & { initDimensions: () => void } {
  const initDimensions = vi.fn();
  return {
    get: (key: string) => (key === "fontFamily" ? family : undefined),
    initDimensions,
  } as unknown as FabricObject & { initDimensions: () => void };
}

function harness(objects: readonly FabricObject[]) {
  const manager = new AssetManager();
  const requestRenderAll = vi.fn();
  const onError = vi.fn();
  const releases: (() => void)[] = [];
  const load = vi.fn<(options: FontAssetLoadOptions) => Promise<() => void>>(
    async () => {
      const release = vi.fn();
      releases.push(release);
      return release;
    },
  );
  const stop = watchDeclaredFontFaces({
    manager,
    canvas: { getObjects: () => objects, requestRenderAll },
    onError,
    load,
  });
  return { manager, requestRenderAll, onError, load, releases, stop };
}

describe("watchDeclaredFontFaces", () => {
  it("registers a face adopted after the mount and remeasures text set in it", async () => {
    const heading = textIn("Bebas Neue");
    const body = textIn("Nunito");
    const { manager, requestRenderAll, load, stop } = harness([heading, body]);

    await manager.adoptFont(face("Bebas Neue"), WOFF2);

    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    expect(load.mock.calls[0]?.[0]).toMatchObject({
      assets: [{ path: "assets/bebas-neue.woff2", family: "Bebas Neue" }],
      bytes: { "assets/bebas-neue.woff2": WOFF2 },
    });
    expect(heading.initDimensions).toHaveBeenCalledTimes(1);
    expect(body.initDimensions).not.toHaveBeenCalled();
    expect(requestRenderAll).toHaveBeenCalledTimes(1);
    stop();
  });

  it("waits for a bare import's amend, and never registers one path twice", async () => {
    const { manager, load, stop } = harness([]);
    const file = Object.assign(
      new File([WOFF2 as unknown as BlobPart], "local.woff2", {
        type: "font/woff2",
      }),
      {
        arrayBuffer: async () => WOFF2.buffer.slice(0),
      },
    );

    const imported = await manager.import(file);
    await Promise.resolve();
    expect(load).not.toHaveBeenCalled();

    manager.amendFont(imported.id, {
      family: "Local Face",
      weight: 400,
      style: "normal",
      licence: "OFL-1.1",
    });
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));

    manager.amendFont(imported.id, {
      family: "Local Face Two",
      weight: 400,
      style: "normal",
      licence: "OFL-1.1",
    });
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    stop();
  });

  it("releases every face it registered when it stops", async () => {
    const { manager, releases, load, stop } = harness([]);

    await manager.adoptFont(face("Bebas Neue"), WOFF2);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    stop();

    await vi.waitFor(() => expect(releases[0]).toHaveBeenCalledTimes(1));
  });
});
