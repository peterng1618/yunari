import { describe, expect, it } from "vitest";
import {
  clipSeconds,
  encodePanelH264,
  H264_BLOCK_BYTES,
  panelH264Args,
} from "./tur-usb-video.js";

const GEOMETRY = { width: 464, height: 1920 };
const NO_PAN = { offsetX: 0, offsetY: 0 };

/** The `-vf` argument, which is where the picture's composition is decided. */
function filterOf(args: readonly string[]): string {
  return args[args.indexOf("-vf") + 1] ?? "";
}

/** The composed graph, which replaces `-vf` when the background is advanced. */
function complexOf(args: readonly string[]): string {
  return args[args.indexOf("-filter_complex") + 1] ?? "";
}

describe("panelH264Args", () => {
  it("crops the box the mount puts the layer in, then turns it", () => {
    // The attached 9.2" is upright with a 90° record: the composition is laid
    // out landscape, cropped there, and turned onto the portrait wire last.
    const quarterTurn = filterOf(
      panelH264Args("in.mp4", "out.h264", GEOMETRY, NO_PAN, "cw"),
    );
    expect(quarterTurn).toContain("crop=1920:464:");
    expect(quarterTurn.endsWith(",transpose=1")).toBe(true);

    const counterTurn = filterOf(
      panelH264Args("in.mp4", "out.h264", GEOMETRY, NO_PAN, "ccw"),
    );
    expect(counterTurn).toContain("crop=1920:464:");
    expect(counterTurn.endsWith(",transpose=2")).toBe(true);

    // Upright keeps the wire's own portrait box, and 180 is the same box
    // turned over.
    const upright = filterOf(
      panelH264Args("in.mp4", "out.h264", GEOMETRY, NO_PAN, "none"),
    );
    expect(upright).toContain("crop=464:1920:");
    expect(upright).not.toContain("transpose");

    const upsideDown = filterOf(
      panelH264Args("in.mp4", "out.h264", GEOMETRY, NO_PAN, "half"),
    );
    expect(upsideDown).toContain("crop=464:1920:");
    expect(upsideDown.endsWith(",hflip,vflip")).toBe(true);
  });

  it("pans the theme's authored offsets inside the crop", () => {
    const filter = filterOf(
      panelH264Args(
        "in.mp4",
        "out.h264",
        GEOMETRY,
        { offsetX: 0.25, offsetY: -0.35 },
        "cw",
      ),
    );

    // The device draws the picture, so the owner's pan has to be in the
    // conversion or the panel shows a centred cover instead.
    expect(filter).toContain("-1920*0.25");
    expect(filter).toContain("-464*-0.35");
  });

  it("centres the crop when the theme asks for no offset", () => {
    const filter = filterOf(
      panelH264Args("in.mp4", "out.h264", GEOMETRY, NO_PAN, "cw"),
    );

    expect(filter).toContain("-1920*0");
    expect(filter).toContain("-464*0");
  });

  it("applies the theme's authored zoom on the plain path too", () => {
    const filter = filterOf(
      panelH264Args(
        "in.mp4",
        "out.h264",
        GEOMETRY,
        { offsetX: 0, offsetY: 0, scale: 1.4 },
        "cw",
      ),
    );

    // The device draws the picture, so the owner's zoom has to be in the
    // conversion or the panel shows an unscaled cover instead.
    expect(filter).toContain("*1.4");
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

  it("bakes the advanced composition into the turned box", () => {
    const args = panelH264Args(
      "in.mp4",
      "out.h264",
      GEOMETRY,
      {
        offsetX: 0,
        offsetY: 0,
        composition: { anchor: "left", extent: 0.65, fade: 0.12 },
        fill: { kind: "solid", color: "#101418" },
      },
      "cw",
    );
    const filter = complexOf(args);

    // A 90° mount lays the layer out in 1920×464 first; a left band keeping
    // 65% of it is 1248px wide, and the turn comes after the composite.
    expect(filter).toContain("crop=");
    expect(filter).toContain("color=c=0x101418");
    expect(filter).toContain("scale=1248:464");
    expect(filter.endsWith("[turned]transpose=1[out]")).toBe(true);
    expect(args).toContain("-filter_complex");
    expect(args[args.indexOf("-map") + 1]).toBe("[out]");
    expect(args).not.toContain("-vf");
  });

  it("intersects a centred band's two masks instead of replacing one", () => {
    const filter = complexOf(
      panelH264Args(
        "in.mp4",
        "out.h264",
        GEOMETRY,
        {
          offsetX: 0,
          offsetY: 0,
          composition: { anchor: "center", fade: 0.2 },
        },
        "none",
        { width: 1920, height: 1080, durationMs: 2_000 },
      ),
    );

    expect(filter.match(/gradients=/g)).toHaveLength(2);
    expect(filter).toContain("blend=all_mode=multiply");
    // `alphamerge` replaces alpha; one merge keeps both ramps.
    expect(filter.match(/alphamerge/g)).toHaveLength(1);
  });

  it("holds an authored gradient and the eased mask still", () => {
    const filter = complexOf(
      panelH264Args(
        "in.mp4",
        "out.h264",
        GEOMETRY,
        {
          offsetX: 0,
          offsetY: 0,
          composition: { anchor: "left", extent: 0.5, fade: 0.3 },
          fill: {
            kind: "gradient",
            angle: 90,
            stops: [
              { offset: 0, color: "#000000" },
              { offset: 1, color: "#ffffff" },
            ],
          },
        },
        "none",
      ),
    );

    // The fill and the mask are both `gradients` sources, and both turn by
    // default; every one of them has to be pinned still.
    const sources = filter.match(/gradients=/g) ?? [];
    expect(sources).toHaveLength(2);
    expect(filter.match(/loop=loop=-1:size=1:start=0/g)).toHaveLength(2);
  });

  it("bounds the composed stream by the source's own length", () => {
    const args = panelH264Args(
      "in.mp4",
      "out.h264",
      GEOMETRY,
      {
        offsetX: 0,
        offsetY: 0,
        composition: { anchor: "left", extent: 0.5 },
      },
      "none",
      { width: 1920, height: 1080, durationMs: 2_500 },
    );

    expect(args[args.indexOf("-t") + 1]).toBe("2.5");
  });

  it("keeps the plain -vf path when there is no composition", () => {
    const args = panelH264Args(
      "in.mp4",
      "out.h264",
      GEOMETRY,
      { offsetX: 0.25, offsetY: 0 },
      "cw",
    );

    expect(args).toContain("-vf");
    expect(args).not.toContain("-filter_complex");
    expect(filterOf(args)).not.toContain("gradients=");
  });

  it("uses the vendor's block size only as a fallback", () => {
    expect(H264_BLOCK_BYTES).toBe(202_752);
  });
});

describe("clipSeconds", () => {
  it("reads the input's length from ffmpeg's report", () => {
    expect(
      clipSeconds(
        "Input #0, mov,mp4,m4a, from 'in.mp4':\n  Duration: 00:01:02.50, start: 0.000000, bitrate: 19986 kb/s",
      ),
    ).toBe(62.5);
  });

  it("reports no length when ffmpeg names none", () => {
    expect(clipSeconds("Stream #0:0: Video: h264")).toBe(0);
    expect(clipSeconds("Duration: 00:00:00.00, start: 0")).toBe(0);
  });
});

describe("encodePanelH264", () => {
  it("refuses an angle that is not a quarter turn", async () => {
    await expect(
      encodePanelH264(Uint8Array.of(0), GEOMETRY, { rotation: 45 }),
    ).rejects.toThrow("quarter turns only");
  });

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
