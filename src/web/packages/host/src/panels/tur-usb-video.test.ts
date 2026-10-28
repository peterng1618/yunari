import { describe, expect, it } from "vitest";
import {
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

  it("encodes without B-frames, which the panel's decoder stalls on", () => {
    const args = panelH264Args("in.mp4", "out.h264", GEOMETRY);

    expect(args[args.indexOf("-x264opts") + 1]).toContain("bframes=0");
    expect(args[args.indexOf("-f") + 1]).toBe("h264");
    expect(args).not.toContain("-movflags");
  });

  it("uses the vendor's block size", () => {
    expect(H264_BLOCK_BYTES).toBe(202_752);
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
