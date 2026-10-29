// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  requestNormalizedVideo,
  VIDEO_NORMALIZE_PATH,
} from "./video-normalizer.js";

function serving(answer: unknown, status = 200) {
  const fetcher = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(answer), { status }),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestNormalizedVideo", () => {
  it("posts a File as a raw octet-stream body", async () => {
    const fetcher = serving({
      ok: true,
      bytesBase64: btoa("normalized"),
      reencoded: false,
    });
    const file = new File([new Uint8Array([1, 2, 3])], "loop.mp4", {
      type: "video/mp4",
    });

    const outcome = await requestNormalizedVideo(file);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(Array.from(outcome.bytes)).toEqual(
      Array.from(new TextEncoder().encode("normalized")),
    );
    expect(outcome.reencoded).toBe(false);

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(VIDEO_NORMALIZE_PATH);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "content-type": "application/octet-stream",
    });
    expect(init?.body).toBe(file);
  });

  it("posts Uint8Array bytes as a raw octet-stream body", async () => {
    const fetcher = serving({
      ok: true,
      bytesBase64: btoa("normalized"),
      reencoded: true,
    });
    const bytes = new Uint8Array([4, 5, 6]);

    const outcome = await requestNormalizedVideo(bytes);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(Array.from(outcome.bytes)).toEqual(
      Array.from(new TextEncoder().encode("normalized")),
    );
    expect(outcome.reencoded).toBe(true);

    const [, init] = fetcher.mock.calls[0] ?? [];
    expect(init?.headers).toEqual({
      "content-type": "application/octet-stream",
    });
    expect(init?.body).toBe(bytes);
  });

  it("names the trim span in the query, not the body", async () => {
    const fetcher = serving({
      ok: true,
      bytesBase64: btoa("normalized"),
      reencoded: true,
    });
    const bytes = new Uint8Array([4, 5, 6]);

    await requestNormalizedVideo(bytes, { startMs: 1_500, endMs: 12_000 });

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(`${VIDEO_NORMALIZE_PATH}?startMs=1500&endMs=12000`);
    expect(init?.body).toBe(bytes);
  });

  it("answers the host's refusal sentence", async () => {
    serving({ ok: false, message: "That video is too large." });

    expect(await requestNormalizedVideo(new Uint8Array([1]))).toEqual({
      ok: false,
      message: "That video is too large.",
    });
  });
});
