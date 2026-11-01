// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mountBackgroundMedia } from "./background-media.js";

/**
 * A hardware panel is served a derived background instead of the theme video:
 * one poster frame when its device plays the clip itself, or a clip scaled to
 * the panel. Loading a 4K source for one glass still starved the shared
 * renderer (2026-11-02).
 */

const ARTBOARD = { width: 400, height: 200 } as const;
const LOOP = { id: "loop", kind: "video", path: "assets/loop.webm" } as const;
const HERO = { id: "hero", kind: "image", path: "assets/hero.png" } as const;

function stubImageSize(): () => void {
  const restores = (
    [
      ["complete", true],
      ["naturalWidth", 400],
      ["naturalHeight", 200],
    ] as const
  ).map(([key, value]) => {
    const before = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      key,
    );
    Object.defineProperty(HTMLImageElement.prototype, key, {
      configurable: true,
      get: () => value,
    });
    return () => {
      if (before === undefined)
        Reflect.deleteProperty(HTMLImageElement.prototype, key);
      else Object.defineProperty(HTMLImageElement.prototype, key, before);
    };
  });
  return () => {
    for (const restore of restores.reverse()) restore();
  };
}

describe("a panel background poster", () => {
  it("mounts the poster instead of the video for a video background", () => {
    const restore = stubImageSize();
    try {
      const host = document.createElement("div");
      const handle = mountBackgroundMedia({
        host,
        background: { media: { assetId: "loop", bounds: "theme" } },
        artboard: ARTBOARD,
        assets: [LOOP],
        resolveAsset: () => ({ url: "blob:loop" }),
        backgroundSource: { url: "/api/themes/theme/poster", kind: "image" },
      });

      expect(host.querySelector("video"), "no video is fetched").toBeNull();
      const image = host.querySelector("img");
      expect(image?.getAttribute("src")).toBe("/api/themes/theme/poster");

      const calls: unknown[][] = [];
      const device = { left: 0, top: 0, width: 400, height: 200 };
      const painted = handle.backdrop()?.paint(
        {
          save: () => undefined,
          restore: () => undefined,
          translate: () => undefined,
          scale: () => undefined,
          drawImage: (...args: unknown[]) => calls.push(args),
        } as unknown as CanvasRenderingContext2D,
        device,
        device,
        "static",
      );
      expect(painted).toBe(true);
      expect(calls[0]?.[0], "the glass samples the poster").toBe(image);
      handle.destroy();
    } finally {
      restore();
    }
  });

  it("mounts a panel-sized clip for a still panel", () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(async () => undefined);
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => undefined);
    try {
      const host = document.createElement("div");
      const handle = mountBackgroundMedia({
        host,
        background: { media: { assetId: "loop", bounds: "theme" } },
        artboard: ARTBOARD,
        assets: [LOOP],
        resolveAsset: () => ({ url: "blob:loop" }),
        backgroundSource: {
          url: "/api/themes/theme/panel-video?width=400&height=200",
          kind: "video",
        },
      });

      expect(host.querySelector("img")).toBeNull();
      expect(host.querySelector("video")?.getAttribute("src")).toBe(
        "/api/themes/theme/panel-video?width=400&height=200",
      );
      handle.destroy();
    } finally {
      play.mockRestore();
      pause.mockRestore();
    }
  });

  it("falls back to the video when the poster will not load", () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(async () => undefined);
    try {
      const host = document.createElement("div");
      const handle = mountBackgroundMedia({
        host,
        background: { media: { assetId: "loop", bounds: "theme" } },
        artboard: ARTBOARD,
        assets: [LOOP],
        resolveAsset: () => ({ url: "blob:loop" }),
        backgroundSource: { url: "/api/themes/theme/poster", kind: "image" },
      });

      host.querySelector("img")?.dispatchEvent(new Event("error"));

      const video = host.querySelector("video");
      expect(video, "the video is the fallback").not.toBeNull();
      expect(video?.getAttribute("src")).toBe("blob:loop");
      expect(host.querySelector("img")).toBeNull();
      handle.destroy();
    } finally {
      play.mockRestore();
    }
  });

  it("does not replace an image background's own picture", () => {
    const restore = stubImageSize();
    try {
      const host = document.createElement("div");
      const handle = mountBackgroundMedia({
        host,
        background: { media: { assetId: "hero", bounds: "theme" } },
        artboard: ARTBOARD,
        assets: [HERO],
        resolveAsset: () => ({ url: "blob:hero" }),
        backgroundSource: { url: "/api/themes/theme/poster", kind: "image" },
      });

      expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:hero");
      handle.destroy();
    } finally {
      restore();
    }
  });
});
