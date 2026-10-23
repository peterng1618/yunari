import type { SceneFacts } from "./classify.js";
import type { LibraryItem } from "./library.js";
import type { ItemPayload } from "./resolve.js";

/**
 * The JSON the browser receives (§5.2): what the list needs and nothing more.
 * The payload's absolute path stays in the host — the browser addresses an
 * item by its `workshopId`.
 */

export interface StoredAttribution {
  readonly steamId?: string;
  readonly workshopUrl?: string;
}

export interface StoredItem {
  readonly workshopId: string;
  readonly title: string;
  readonly kind: ItemPayload["kind"];
  readonly previewUrl?: string;
  readonly filesize: number;
  readonly tags: readonly string[];
  readonly properties: unknown;
  /** Scene items only; absent when unclassified. */
  readonly stillAtRest?: boolean;
  /** Scene items only: the text-removal step. */
  readonly hasText?: boolean;
  readonly attribution?: StoredAttribution;
}

export function toStoredItem(
  item: LibraryItem,
  payload: ItemPayload,
  facts?: SceneFacts,
): StoredItem {
  const attribution =
    item.authorSteamId === undefined && item.workshopUrl === undefined
      ? undefined
      : {
          ...(item.authorSteamId === undefined
            ? {}
            : { steamId: item.authorSteamId }),
          ...(item.workshopUrl === undefined
            ? {}
            : { workshopUrl: item.workshopUrl }),
        };

  return {
    workshopId: item.workshopId,
    title: item.title,
    kind: payload.kind,
    ...(item.preview === undefined
      ? {}
      : {
          previewUrl: `/api/wallpaper-engine/item/${encodeURIComponent(item.workshopId)}/preview`,
        }),
    filesize: item.filesize,
    tags: item.tags,
    properties: item.properties,
    ...(facts === undefined
      ? {}
      : { stillAtRest: facts.atRest, hasText: facts.hasText }),
    ...(attribution === undefined ? {} : { attribution }),
  };
}
