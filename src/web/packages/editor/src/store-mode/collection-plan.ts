import type { CollectionPlan } from "@yunari/renderer-core";
import { uiCopy } from "../ui-copy.js";
import type { StoreItem } from "./local-source.js";

/**
 * The one client reader of a collection's verified member plan.
 *
 * The host answers the same pre-flight an install runs, so the detail surface
 * can name the members, their publishers and each code member's consent before
 * anything is written. It is read only when a collection's modal opens; a grid
 * render never asks for one.
 *
 * The request carries the catalogue's facts and no chosen ids: absent `items`
 * means every include, which is the plan a detail surface shows. An install
 * that lets a person untick a member is the collection sheet's, and it posts
 * the chosen set.
 */
const PLAN_PATH = "/api/store/collection/plan";

export interface CollectionPlanReadOptions {
  readonly fetch?: typeof fetch;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the plan, or rejects with a sentence a person can act on. A response
 * that is not the plan shape is refused rather than read optimistically: the
 * surface maps over `members` and `missing`, so a malformed answer would crash
 * a modal instead of stating a failure.
 */
export async function readCollectionPlan(
  item: StoreItem,
  options: CollectionPlanReadOptions = {},
): Promise<CollectionPlan> {
  const catalogue = item.catalogue;
  const version = item.version;
  if (
    catalogue === undefined ||
    version === undefined ||
    version === "" ||
    catalogue.sha256 === undefined ||
    catalogue.bytes === undefined
  ) {
    throw new Error(uiCopy.store.detail.plan.unavailable);
  }

  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const response = await fetcher(PLAN_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      packageUrl: catalogue.packageUrl,
      catalogueId: catalogue.id,
      kind: item.kind,
      version,
      sha256: catalogue.sha256,
      bytes: catalogue.bytes,
      ...(catalogue.publisher === undefined
        ? {}
        : { publisher: catalogue.publisher }),
    }),
  });

  if (!response.ok) {
    const reason = await response.text().catch(() => "");
    throw new Error(
      reason.trim() === ""
        ? uiCopy.store.install.refused(response.status)
        : reason,
    );
  }

  const body: unknown = await response.json();
  if (
    !isRecord(body) ||
    !isRecord(body["plan"]) ||
    !Array.isArray(body["plan"]["members"]) ||
    !Array.isArray(body["plan"]["missing"])
  ) {
    throw new Error(uiCopy.store.detail.plan.unusable);
  }
  return body["plan"] as unknown as CollectionPlan;
}
