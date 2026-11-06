import {
  accessGrowth,
  type ConsentBinding,
} from "@yunari/extension-api";

/**
 * Whether an already-installed plugin may move to a new version without its
 * owner looking at the change.
 *
 * Consent is a statement about what a plugin may reach, not about which bytes
 * the store served. A version that asks for nothing new keeps the grant; one
 * that adds a capability, contribution, device or execution profile does not,
 * and neither does a version the store now attributes to another publisher.
 */
export interface UpdateDecision {
  readonly action: "auto" | "hold";
  readonly reasons: readonly string[];
}

export function decideUpdate(
  previous: ConsentBinding,
  next: ConsentBinding,
  publisherChanged: boolean,
): UpdateDecision {
  const reasons = [...accessGrowth(previous, next)];
  // `accessGrowth` already names a publisher move when the keys differ; the
  // caller's flag covers a listing that changed publisher under one key.
  if (publisherChanged && !reasons.includes("publisher"))
    reasons.push("publisher");
  return reasons.length === 0
    ? { action: "auto", reasons: [] }
    : { action: "hold", reasons };
}
