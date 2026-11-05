import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FabricThemeEnvelope } from "@yunari/renderer-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backgroundVideoOf,
  createThemeMedia,
  panelVideoMediaName,
  panelVideoPlacement,
  stillMediaName,
  type ThemeMediaOptions,
} from "./theme-media.js";

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);
/** An ISO media header is all the writer checks for. */
const MP4 = Uint8Array.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00,
]);

const VIDEO_ASSET = {
  id: "bg",
  path: "assets/4K loop.mp4",
  kind: "video",
};

function envelopeWith(
  background: unknown,
  assets: readonly unknown[] = [VIDEO_ASSET],
): FabricThemeEnvelope {
  return {
    id: "theme",
    artboard: { width: 100, height: 100 },
    assets,
    background,
  } as unknown as FabricThemeEnvelope;
}

const BACKGROUND = { media: { assetId: "bg", fallbackFrame: 12 } };

describe("backgroundVideoOf", () => {
  it("answers the video background and its declared frame", () => {
    expect(backgroundVideoOf(envelopeWith(BACKGROUND))?.frame).toBe(12);
  });

  it("defaults the frame to the first one", () => {
    expect(
      backgroundVideoOf(envelopeWith({ media: { assetId: "bg" } }))?.frame,
    ).toBe(0);
  });

  it("answers nothing for an image background or no background", () => {
    expect(
      backgroundVideoOf(
        envelopeWith({ media: { assetId: "bg" } }, [
          { id: "bg", path: "assets/bg.png", kind: "image" },
        ]),
      ),
    ).toBeUndefined();
    expect(backgroundVideoOf(envelopeWith(undefined))).toBeUndefined();
  });
});

describe("media names", () => {
  it("name the theme, the video asset and the frame", () => {
    expect(stillMediaName("theme", envelopeWith(BACKGROUND))).toBe(
      "theme~4K_loop~f12.png",
    );
  });

  it("change with the frame and the asset", () => {
    const otherFrame = envelopeWith({
      media: { assetId: "bg", fallbackFrame: 13 },
    });
    const otherAsset = envelopeWith(BACKGROUND, [
      { id: "bg", path: "assets/second.mp4", kind: "video" },
    ]);

    expect(stillMediaName("theme", otherFrame)).not.toBe(
      stillMediaName("theme", envelopeWith(BACKGROUND)),
    );
    expect(stillMediaName("theme", otherAsset)).not.toBe(
      stillMediaName("theme", envelopeWith(BACKGROUND)),
    );
  });

  it("name a panel clip by its pixel size and baked geometry", () => {
    expect(
      panelVideoMediaName("theme", envelopeWith(BACKGROUND), 320, 320),
    ).toBe("theme~4K_loop~320x320-o0_0-s1.mp4");
  });

  it("change the clip name when the authored pan or zoom changes", () => {
    const panel = (media: unknown) =>
      panelVideoMediaName(
        "theme",
        envelopeWith({
          media: { assetId: "bg", fallbackFrame: 12, ...(media as object) },
        }),
        320,
        320,
      );

    expect(panel({ offsetX: 0.25 })).not.toBe(panel({}));
    expect(panel({ scale: 2 })).not.toBe(panel({}));
  });

  it("keep the suffix and stay distinct for a long asset name", () => {
    const long = (tail: string) =>
      envelopeWith(BACKGROUND, [
        {
          id: "bg",
          path: `assets/${"a".repeat(160)}-${tail}.mp4`,
          kind: "video",
        },
      ]);

    const first = stillMediaName("theme", long("first"));
    const second = stillMediaName("theme", long("second"));

    expect(first).toMatch(/f12\.png$/u);
    expect(second).toMatch(/f12\.png$/u);
    expect(first).not.toBe(second);
  });

  it("answer nothing without a video background", () => {
    const image = envelopeWith({ media: { assetId: "bg" } }, [
      { id: "bg", path: "assets/bg.png", kind: "image" },
    ]);
    expect(stillMediaName("theme", image)).toBeUndefined();
    expect(panelVideoMediaName("theme", image, 320, 320)).toBeUndefined();
  });

  it("invalidate the clip when the composition changes", () => {
    const plain = envelopeWith(BACKGROUND);
    const composed = envelopeWith({
      mode: "advanced",
      media: {
        assetId: "bg",
        fallbackFrame: 12,
        composition: { anchor: "left", extent: 0.65 },
      },
    });

    expect(panelVideoMediaName("theme", composed, 320, 320)).not.toBe(
      panelVideoMediaName("theme", plain, 320, 320),
    );
  });
});

describe("panelVideoPlacement", () => {
  const palette = {
    palette: {
      ink: { name: "Ink", value: { kind: "solid", color: "#101418" } },
    },
  };

  it("maps the media's composition and resolved fill", () => {
    const envelope = {
      id: "theme",
      artboard: { width: 100, height: 100 },
      assets: [VIDEO_ASSET],
      globals: palette,
      background: {
        mode: "advanced",
        fill: { ref: "palette.ink" },
        media: {
          assetId: "bg",
          bounds: "display",
          composition: { anchor: "left", extent: 0.65, fade: 0.12 },
        },
      },
    } as unknown as FabricThemeEnvelope;

    expect(panelVideoPlacement(envelope)).toEqual({
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      composition: { anchor: "left", extent: 0.65, fade: 0.12 },
      fill: { kind: "solid", color: "#101418" },
    });
  });

  it("uses the colour as the fill when no fill is authored", () => {
    const envelope = {
      id: "theme",
      artboard: { width: 100, height: 100 },
      assets: [VIDEO_ASSET],
      globals: palette,
      background: {
        mode: "advanced",
        color: { ref: "palette.ink" },
        media: {
          assetId: "bg",
          bounds: "display",
          composition: { anchor: "top", extent: 0.5 },
        },
      },
    } as unknown as FabricThemeEnvelope;

    expect(panelVideoPlacement(envelope).fill).toEqual({
      kind: "solid",
      color: "#101418",
    });
  });

  it("answers the pan alone when no composition is authored", () => {
    const envelope = envelopeWith({
      media: { assetId: "bg", offsetX: 0.25, offsetY: -0.1 },
    });

    expect(panelVideoPlacement(envelope)).toEqual({
      offsetX: 0.25,
      offsetY: -0.1,
      scale: 1,
    });
  });
});

describe("createThemeMedia", () => {
  let directory: string;
  let reports: string[];

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-media-"));
    reports = [];
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  function media(options: {
    extract?: ReturnType<typeof vi.fn>;
    transcode?: ReturnType<typeof vi.fn>;
  }) {
    return createThemeMedia({
      directory,
      readAsset: async () => ({ bytes: new Uint8Array([9, 9, 9]) }),
      extract: (options.extract ??
        (async () => ({
          ok: true as const,
          bytes: PNG,
        }))) as NonNullable<ThemeMediaOptions["extract"]>,
      transcode: (options.transcode ??
        (async () => ({
          ok: true as const,
          bytes: MP4,
        }))) as NonNullable<ThemeMediaOptions["transcode"]>,
      onError: (message) => reports.push(message),
    });
  }

  it("generates a still once and serves the cached one after that", async () => {
    const extract = vi.fn(async () => ({ ok: true as const, bytes: PNG }));
    const service = media({ extract });
    const envelope = envelopeWith(BACKGROUND);

    const first = await service.still("theme", envelope);
    const second = await service.still("theme", envelope);

    expect(first?.name).toBe("theme~4K_loop~f12.png");
    expect(second?.bytes).toEqual(PNG);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledWith(
      new Uint8Array([9, 9, 9]),
      12,
      undefined,
    );
  });

  it("generates a new still when the declared frame changes", async () => {
    const extract = vi.fn(async () => ({ ok: true as const, bytes: PNG }));
    const service = media({ extract });

    const before = await service.still("theme", envelopeWith(BACKGROUND));
    const after = await service.still(
      "theme",
      envelopeWith({ media: { assetId: "bg", fallbackFrame: 13 } }),
    );

    expect(before?.name).not.toBe(after?.name);
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it("shares one generation between simultaneous asks", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const extract = vi.fn(async () => {
      await gate;
      return { ok: true as const, bytes: PNG };
    });
    const service = media({ extract });
    const envelope = envelopeWith(BACKGROUND);

    const asks = [
      service.still("theme", envelope),
      service.still("theme", envelope),
    ];
    release?.();
    await Promise.all(asks);

    expect(extract).toHaveBeenCalledTimes(1);
  });

  it("generates a clip per panel box", async () => {
    const transcode = vi.fn(async () => ({ ok: true as const, bytes: MP4 }));
    const service = media({ transcode });
    const envelope = envelopeWith(BACKGROUND);

    const phone = await service.panelVideo("theme", envelope, {
      width: 320,
      height: 320,
    });
    // A square artboard on a tall viewport is the artboard's own screen rect,
    // not the whole viewport, so the clip is square too.
    const panel = await service.panelVideo("theme", envelope, {
      width: 464,
      height: 1920,
    });

    expect(phone?.name).toBe("theme~4K_loop~320x320-o0_0-s1.mp4");
    expect(panel?.name).toBe("theme~4K_loop~464x464-o0_0-s1.mp4");
    expect(transcode).toHaveBeenCalledTimes(2);
    expect(transcode).toHaveBeenLastCalledWith(
      new Uint8Array([9, 9, 9]),
      expect.objectContaining({ width: 464, height: 464 }),
      undefined,
    );
  });

  it("encodes a composed page clip at the media's box, not the whole layer", async () => {
    const transcode = vi.fn(async () => ({ ok: true as const, bytes: MP4 }));
    const service = media({ transcode });

    await service.panelVideo(
      "theme",
      envelopeWith({
        mode: "advanced",
        media: {
          assetId: "bg",
          bounds: "display",
          composition: { anchor: "left", extent: 0.5 },
        },
      }),
      { width: 640, height: 360 },
    );

    // The page lays this clip down inside the media's band as-is, so its pixels
    // are the band's cover of the source. Encoding the whole 640×360 layer here
    // would make the page crop the source a second time.
    expect(transcode).toHaveBeenCalledWith(
      new Uint8Array([9, 9, 9]),
      { width: 320, height: 360, offsetX: 0, offsetY: 0, scale: 1 },
      undefined,
    );
  });

  it("bakes the theme's authored pan and zoom into the clip", async () => {
    const transcode = vi.fn(async () => ({ ok: true as const, bytes: MP4 }));
    const service = media({ transcode });

    await service.panelVideo(
      "theme",
      envelopeWith({
        media: { assetId: "bg", offsetX: 0.25, offsetY: -0.5, scale: 2 },
      }),
      { width: 320, height: 320 },
    );

    expect(transcode).toHaveBeenCalledWith(
      new Uint8Array([9, 9, 9]),
      {
        width: 320,
        height: 320,
        offsetX: 0.25,
        offsetY: -0.5,
        scale: 2,
      },
      undefined,
    );
  });

  it("reports a refused generation and leaves no entry", async () => {
    const service = media({
      extract: vi.fn(async () => ({ ok: false as const, message: "no frame" })),
    });

    const answer = await service.still("theme", envelopeWith(BACKGROUND));

    expect(answer).toBeUndefined();
    expect(reports).toEqual(["no frame"]);
    expect(await fs.readdir(directory)).not.toContain("theme~4K_loop~f12.png");
  });

  it("forgets only the theme's own entries", async () => {
    const service = media({});
    await service.still("theme", envelopeWith(BACKGROUND));
    await service.still("other", envelopeWith(BACKGROUND));

    await service.forget("theme");

    expect(await fs.readdir(directory)).toEqual(["other~4K_loop~f12.png"]);
  });
});
