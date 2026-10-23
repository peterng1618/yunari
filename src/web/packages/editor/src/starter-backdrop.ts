import type { AssetReference } from "@yunari/renderer-core";
import backdropUrl from "./starter-backdrop.jpg?url";

/**
 * The starter's artboard backdrop: a photograph, declared like any other
 * packaged asset and carried in the theme package.
 *
 * It is a photograph because the gradient it replaced had no horizontal
 * structure at all — measured 0.00 mean luma step between adjacent columns,
 * against 2.14 here — so every frosted panel over it read as an even fill no
 * matter how wide the blur was. `docs/decisions/0011` has the measurements and
 * the rejected alternatives, including the runtime-CDN one that would have
 * tainted the canvas and broken every capture that reads pixels.
 *
 * The bytes reach the document through the same `path -> Uint8Array` map every
 * declared asset already travels in, and the player then resolves them through
 * the host's own asset route, so the surface stays same-origin and untainted.
 */

/** Package-relative path. The bytes are keyed by this and by nothing else. */
export const STARTER_BACKDROP_PATH = "assets/starter-backdrop.jpg";

const STARTER_BACKDROP_ID = "starter-backdrop";

/**
 * 2330x1311: 1.39x the 1672-unit artboard, centre-cropped to its 1.7768 aspect
 * so the `theme`-bounded cover crops nothing further. A 3111px source — the
 * licensed original's native height — is 729 KB for a 0.6% mean channel error.
 */
export const starterBackdrop: AssetReference = {
  id: STARTER_BACKDROP_ID,
  kind: "image",
  path: STARTER_BACKDROP_PATH,
  sha256: "6d4bbd987c0e6a6103eb310b2848e011e50a77be641e3e2cdd1b389d695bf59b",
  sourceUrl:
    "https://unsplash.com/photos/city-skyline-during-orange-sunset-NTTJsPPlQOk",
  license: {
    name: "Unsplash License",
    url: "https://unsplash.com/license",
    attribution:
      "“city skyline during orange sunset” by Ashim D’Silva (@randomlies), via Unsplash",
  },
};

/**
 * The declared bytes, keyed by the declared path.
 *
 * The bundler emits the file beside the bundle rather than inlining it, so
 * this is one extra same-origin request and the JavaScript does not grow by
 * 428 KB. The relative URL `?url` hands back is correct at both mounts the
 * editor is served from — `vite preview` at `/` and the host under `/editor/`
 * — which the editor's `base: "./"` is already there to arrange.
 */
export async function loadStarterBackdrop(): Promise<
  Readonly<Record<string, Uint8Array>>
> {
  const response = await fetch(backdropUrl);
  if (!response.ok) {
    throw new Error(
      `The starter backdrop could not be read (${response.status} ${backdropUrl}).`,
    );
  }
  return {
    [STARTER_BACKDROP_PATH]: new Uint8Array(await response.arrayBuffer()),
  };
}
