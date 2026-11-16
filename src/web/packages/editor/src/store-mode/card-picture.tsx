import type * as React from "react";
import { useState } from "react";
import type { StoreItem } from "./local-source.js";

/**
 * The picture box, and the theme's own ground behind it.
 *
 * **The box's shape is the theme's own ratio, and the row's tracks make the
 * heights agree** — every card in a row gets a width proportional to its ratio,
 * so width ÷ ratio is the same for all of them. The picture is contained, so
 * nothing is cropped and nothing is letterboxed.
 *
 * **A theme with no picture draws its ground, not a broken image.** The host
 * answers `404` at a theme's thumbnail address when it has stored none
 * (`server.ts`), so the address being present says nothing about the picture
 * being there: the box carries the ground from the first paint, and the `<img>`
 * that fails is dropped rather than left showing a browser's broken mark. With
 * no address at all the box is the ground alone.
 *
 * **What failed is the address and the theme's own time, not the box.** The host
 * builds the address from the theme's id (`theme-library-client.ts`), so it is
 * the same one across a re-listing and the address alone cannot say a picture
 * arrived; `updatedAt` is what a save changes. Keying on both means a cell whose
 * picture is replaced — a save that stores a thumbnail, a listing refreshed —
 * draws the new picture instead of the neutral box the old one left behind,
 * while a re-listing that changed nothing does not ask for a picture it already
 * knows is missing. A latched flag would be a cell that never shows a picture
 * again for as long as it is mounted.
 *
 * The image is `alt=""` because the cell names the theme beside it: a picture
 * repeating the name is read twice.
 */
export function Picture(props: {
  readonly item: StoreItem;
  readonly ratio: number;
}): React.JSX.Element {
  const { item } = props;
  const picture =
    item.thumbnailUrl === undefined
      ? undefined
      : {
          url: item.thumbnailUrl,
          key: `${item.thumbnailUrl} ${item.updatedAt ?? ""}`,
        };
  const [broken, setBroken] = useState<string | undefined>(undefined);
  const showPicture = picture !== undefined && picture.key !== broken;

  return (
    <span
      data-yunari-store-picture=""
      aria-hidden
      className="relative block w-full overflow-hidden"
      style={{
        aspectRatio: props.ratio,
        ...(item.ground === undefined ? {} : { background: item.ground }),
      }}
    >
      {picture !== undefined && showPicture ? (
        <img
          src={picture.url}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-contain"
          onError={() => setBroken(picture.key)}
        />
      ) : null}
    </span>
  );
}
