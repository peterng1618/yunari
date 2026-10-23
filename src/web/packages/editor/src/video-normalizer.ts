import { uiCopy } from "./ui-copy.js";

/** Where the host brings a video into the publish envelope. Named once. */
export const VIDEO_NORMALIZE_PATH = "/api/themes/normalize-video";

export type NormalizeOutcome =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      /** False when the file already conformed and the host copied it. */
      readonly reencoded: boolean;
    }
  | { readonly ok: false; readonly message: string };

/**
 * Posts one video to the host, which owns the encoder and the envelope rules
 * (`POST /api/themes/normalize-video`). Every refusal is the host's own
 * sentence — it names which rule the video broke — and only a transport failure
 * with no sentence at all falls back to the pane's words.
 */
export async function requestNormalizedVideo(
  bytes: Uint8Array,
): Promise<NormalizeOutcome> {
  let response: Response;
  try {
    response = await fetch(VIDEO_NORMALIZE_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // No `fit`: the host's `contain` path keeps the source's own shape.
      body: JSON.stringify({ bytesBase64: base64Of(bytes) }),
    });
  } catch {
    return { ok: false, message: uiCopy.panels.videoNormalizeFailed };
  }

  if (!response.ok) {
    const reason = await response.text().catch(() => "");
    return {
      ok: false,
      message:
        reason.trim() === ""
          ? uiCopy.panels.videoNormalizeFailed
          : reason.trim(),
    };
  }

  const answer = (await response.json().catch(() => undefined)) as
    | {
        readonly ok?: unknown;
        readonly bytesBase64?: unknown;
        readonly reencoded?: unknown;
        readonly message?: unknown;
      }
    | undefined;
  if (answer?.ok === true && typeof answer.bytesBase64 === "string")
    return {
      ok: true,
      bytes: bytesFromBase64(answer.bytesBase64),
      reencoded: answer.reencoded === true,
    };
  return {
    ok: false,
    message:
      typeof answer?.message === "string" && answer.message.trim() !== ""
        ? answer.message
        : uiCopy.panels.videoNormalizeFailed,
  };
}

/** `btoa` over the bytes, chunked so a large video cannot overflow the stack. */
export function base64Of(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export function bytesFromBase64(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}
