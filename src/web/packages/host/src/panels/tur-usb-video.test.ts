import { describe, expect, it } from "vitest";
import {
  clipFps,
  encodePanelH264,
  H264_BLOCK_BYTES,
  panelH264Args,
} from "./tur-usb-video.js";

const GEOMETRY = { width: 464, height: 1920 };

describe("panelH264Args", () => {
  it("crops the landscape box before turning onto the wire frame", () => {
    const args = panelH264Args("in.mp4", "out.h264", GEOMETRY);
    const filter = args[args.indexOf("-vf") + 1];

    // The panel accepts its portrait geometry only, so the composition is
    // fitted to the landscape glass, cropped there, and turned last.
    expect(filter).toContain("crop=1920:464:");
    expect(filter?.endsWith(",transpose=1")).toBe(true);
  });

  it("pans the theme's authored offsets inside the crop", () => {
    const args = panelH264Args("in.mp4", "out.h264", GEOMETRY, {
      offsetX: 0.25,
      offsetY: -0.35,
    });
    const filter = args[args.indexOf("-vf") + 1] ?? "";

    // The device draws the picture, so the owner's pan has to be in the
    // conversion or the panel shows a centred cover instead.
    expect(filter).toContain("-1920*0.25");
    expect(filter).toContain("-464*-0.35");
  });

  it("centres the crop when the theme asks for no offset", () => {
    const args = panelH264Args("in.mp4", "out.h264", GEOMETRY);
    const filter = args[args.indexOf("-vf") + 1] ?? "";

    expect(filter).toContain("-1920*0");
    expect(filter).toContain("-464*0");
  });

  it("encodes with the vendor's exact arguments", () => {
    const args = panelH264Args("in.mp4", "out.h264", GEOMETRY);

    // L-Connect's TransferH264: no frame rate, no bitrate, no profile — the
    // panel takes the stream's own pacing.
    expect(args[args.indexOf("-x264opts") + 1]).toBe("bframes=0");
    expect(args[args.indexOf("-threads") + 1]).toBe("4");
    expect(args[args.indexOf("-preset") + 1]).toBe("ultrafast");
    expect(args).not.toContain("-b:v");
    expect(args).not.toContain("-maxrate");
    expect(args).not.toContain("-r");
    expect(args[args.indexOf("-f") + 1]).toBe("h264");
    expect(args).not.toContain("-movflags");
  });

  it("uses the vendor's block size only as a fallback", () => {
    expect(H264_BLOCK_BYTES).toBe(202_752);
  });
});

describe("clipFps", () => {
  it("reads the input's rate from ffmpeg's report", () => {
    expect(
      clipFps(
        "Stream #0:0: Video: h264 (High), yuv420p, 1920x1080, 23.98 fps, 24 tbr",
      ),
    ).toBe(24);
  });

  it("reports no rate when ffmpeg names none", () => {
    expect(clipFps("Input #0, mov,mp4,m4a")).toBe(0);
  });
});

describe("encodePanelH264", () => {
  it("refuses bytes the hash file does not describe", async () => {
    await expect(
      encodePanelH264(Uint8Array.of(0), GEOMETRY, {
        ffmpegPath: "C:/not/verified.exe",
        verifyForTest: () => ({
          ok: false,
          message: "The bundled ffmpeg does not match its recorded hash.",
        }),
      }),
    ).rejects.toThrow("does not match its recorded hash");
  });
});
