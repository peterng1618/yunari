import { describe, expect, it } from "vitest";
import { videoContainerOf, videoContentTypeOf } from "./container.js";

const encoder = new TextEncoder();

/** An MP4's `ftyp` box begins at byte 4, after its size. */
function ftyp(): Uint8Array {
  const bytes = new Uint8Array(16);
  bytes.set(encoder.encode("ftyp"), 4);
  return bytes;
}

/** EBML's magic, then the DocType the header names. */
function ebml(docType: string): Uint8Array {
  const tail = encoder.encode(docType);
  const bytes = new Uint8Array(4 + tail.length);
  bytes.set([0x1a, 0x45, 0xdf, 0xa3], 0);
  bytes.set(tail, 4);
  return bytes;
}

describe("videoContainerOf", () => {
  it("reads an MP4 from its ftyp box", () => {
    expect(videoContainerOf(ftyp())).toBe("mp4");
  });

  it("separates WebM from other Matroska by the DocType", () => {
    expect(videoContainerOf(ebml("webm"))).toBe("webm");
    expect(videoContainerOf(ebml("matroska"))).toBe("matroska");
  });

  it("does not guess a container it cannot read", () => {
    expect(videoContainerOf(new Uint8Array())).toBe("unknown");
    expect(videoContainerOf(encoder.encode("not a video"))).toBe("unknown");
  });
});

describe("videoContentTypeOf", () => {
  it("names each container's registered media type", () => {
    expect(videoContentTypeOf("mp4")).toBe("video/mp4");
    expect(videoContentTypeOf("webm")).toBe("video/webm");
    expect(videoContentTypeOf("matroska")).toBe("video/x-matroska");
    expect(videoContentTypeOf("unknown")).toBe("application/octet-stream");
  });
});
