# 0098 — A scene image reference resolves to a picture or is refused

- **Date:** 2026-11-03
- **Status:** accepted
- **Paths:** `src/web/packages/renderer-core/src/theme/fabric-envelope-validate.ts`,
  `src/web/packages/theme-kit/src/authoring.ts`,
  `src/web/packages/mcp/src/tools/compose.ts`

## Problem

`add_image` accepted any declared asset except a font, including a video.
`validate_theme` returned `ok: true`, and the player then painted an empty black
rectangle: a scene image resolves its `yunariAsset` reference to a URL that
`FabricImage` decodes, and a video URL is not an image. Validation is the last
gate before a document is stored and served, so passing a document the renderer
cannot paint is the failure this note fixes.

## Rung 1 — internal owner

Searched: `addImage`, `addImageObject`, `yunariAsset`, `objectAssetReference`,
`isFabricAssetReference`, `sceneAssetReferences`, `validateFabricThemeEnvelope`,
`validateAssets`, `backgroundPaintReferences`.

Found: `fabric-envelope-validate.ts` is the loader and already validates a
background media reference's kind (image, svg or video) against the declared
assets. It never inspected `yunariAsset` on scene objects. `theme-kit`'s
`addImageObject` accepted `AssetKind` (image, svg, gif, video, font), and the MCP
`addImage` refused only `font`. `scene-fabric` already states the real contract:
`isFabricAssetReference` accepts exactly `kind: "image" | "svg"`, and
`resolveObjectAsset` ignores anything else.

## Rung 2 — installed dependencies

Searched: `scene-fabric/src/object-asset.ts`, `scene-fabric/src/persist.ts`,
Fabric's `Image`/`FabricImage` revival path as used by `reviveScene`.

Found: a scene image is revived from `src` alone; `yunariAsset` is only a lookup
key, and `isFabricAssetReference` is the authored contract. A video reference is
not resolved, so the object keeps no source and draws empty. Fabric's `Image`
has no video element and no frame clock, so there is no integration inside the
installed dependency that could paint one.

## Rung 3 — native platform

Searched: none needed; the decision is which declared asset kinds may become an
`Image` object. The browser can paint a video through `<video>` or a canvas
frame, but that is a different scene object, not an `Image`.

## Rung 4 — public solutions

Searched: repository existing renderer/media paths (`background-media`,
`video-frame`, `scene-fabric/background-media.ts`) for how video is already
painted.

Found: video is the background's media, decoded by the background renderer.
Reusing that path for an arbitrary image box would be a new scene object family,
not a validation fix. No external library is involved.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Paint the video's first frame into the Image box | A picture, but not the video | Frame sampling, caching, invalidation, a second media owner | Rejected: a new mechanism for a misuse |
| Accept it and their black box | none | Silent broken documents | Rejected |
| Refuse a non-picture reference at `add_image` and in the validator | Uses the existing `image`/`svg` contract | None | Accepted |
| Accept it but let the editor replace it later | none | The stored document is already wrong | Rejected |

## Rung 6 — smallest probe

`fabric-envelope-validate.test.ts` now validates a scene image reference to a
declared image (`ok: true`) and to the same asset with `kind: "video"`
(`invalid-enum` at `/scene/objects/0/yunariAsset/kind`).
`tools.defaults.test.ts` declares a video asset and asserts `addImage` answers
an error naming the background as the correct write. The full gate passed:
`npm run gate` exit 0, 517 files / 7853 tests, plus the Worker suite.

## Decision

`addImageObject`'s `kind` is narrowed to `"image" | "svg"`, the union
`scene-fabric` already enforces when it resolves and persists a reference. The
MCP `addImage` tool refuses any other kind with a sentence that names the
correct write for a video (the background). The loader validates every
`yunariAsset` it finds, including nested group children: the kind must be image
or svg and the id must name a declared asset of that kind. Rejected options
would have added a video-frame scene family or left a validated document the
renderer cannot draw.

Skipped: rendering a video inside an image object. Add it only if the product
asks for a video placed as a box, with its own scene object and playback
ownership.
