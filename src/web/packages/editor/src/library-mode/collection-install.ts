import type { InstalledExtension } from "@yunari/extension-api";
import type {
  CatalogueOrigin,
  CollectionPlan,
  CollectionPlanMember,
} from "@yunari/renderer-core";
import type { HeldUpdate } from "../components/held-update.js";
import {
  type InstallOutcome,
  installItem,
} from "../store-mode/install-item.js";
import type { StoreItem } from "../store-mode/local-source.js";
import { uiCopy } from "../ui-copy.js";

/**
 * A collection's install sheet, as pure rules plus the one press it makes.
 *
 * **A collection is data.** It installs the listings it names and asks for no
 * consent of its own; every code member's own authority is what the sheet
 * shows, and every grant it makes is that member's. The host re-runs its own
 * pre-flight, so the plan read here is the sheet's reading and never the
 * install's permission.
 */

/** What a person chose in the sheet: the ids to install, and the required
 *  members a direct caller left out. */
export interface CollectionChoice {
  readonly chosen: ReadonlySet<string>;
  readonly missingRequired: readonly string[];
}

/** One plan's choice, held to the members the plan actually contains. An id the
 *  plan does not name is dropped: the host refuses an unknown chosen id, so a
 *  sheet that posted one would turn a stale row into a failed install. */
export function choiceOf(
  plan: CollectionPlan,
  chosen: ReadonlySet<string>,
): CollectionChoice {
  const known = new Set(plan.members.map((member) => member.id));
  const kept = new Set([...chosen].filter((id) => known.has(id)));
  return {
    chosen: kept,
    missingRequired: plan.members
      .filter((member) => !member.optional && !kept.has(member.id))
      .map((member) => member.id),
  };
}

/** Every member chosen: the sheet's default, because a collection is installed
 *  for what it contains. */
export function choicesOf(plan: CollectionPlan): CollectionChoice {
  return choiceOf(plan, new Set(plan.members.map((member) => member.id)));
}

/** One row toggled. **A required member is locked**, so the toggle leaves it
 *  chosen: the sheet draws it checked and disabled, and this is the same rule
 *  for a caller that never drew a control. */
export function toggleChoice(
  plan: CollectionPlan,
  chosen: ReadonlySet<string>,
  id: string,
): CollectionChoice {
  const member = plan.members.find((candidate) => candidate.id === id);
  if (member === undefined || !member.optional) return choiceOf(plan, chosen);

  const next = new Set(chosen);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return choiceOf(plan, next);
}

/** What an update adds and what it dropped, read from this PC's register rather
 *  than the plan's memory.
 *
 * `installed` is the union of two readings: origin rows that name this
 * collection, and rows whose catalogue id is one of the includes — the second
 * is how a member installed by hand still counts as present. A dropped member
 * is a row recorded for this collection that its current includes no longer
 * name; this module never removes one. An unavailable include is excluded
 * from `missing`: the blocked state already names it, and an update list must
 * not promise an install that cannot be made. */
export function updateDiff(
  plan: CollectionPlan,
  origins: readonly CatalogueOrigin[],
  collectionId: string,
): {
  readonly missing: readonly string[];
  readonly dropped: readonly string[];
} {
  const includes = new Set([
    ...plan.members.map((member) => member.id),
    ...plan.missing.map((member) => member.id),
  ]);
  // **An unavailable member is not "missing from this PC"**: it is already
  // named and blocking above, and repeating it under an update heading would
  // promise an install the press cannot make.
  const unavailable = new Set(plan.missing.map((member) => member.id));
  const installed = new Set<string>();
  for (const origin of origins) {
    if (
      origin.collections?.includes(collectionId) === true ||
      includes.has(origin.catalogueId)
    ) {
      installed.add(origin.catalogueId);
    }
  }

  return {
    missing: [...includes].filter(
      (id) => !installed.has(id) && !unavailable.has(id),
    ),
    dropped: [...installed].filter((id) => !includes.has(id)),
  };
}

/** How a re-read plan differs from the one on screen: the ids to say out loud,
 *  grouped by what happened to them. An include that became unavailable is
 *  `updated` because its version moved to no version at all. */
export interface PlanChange {
  readonly changed: boolean;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly updated: readonly string[];
}

function versionsOf(plan: CollectionPlan): ReadonlyMap<string, string> {
  const versions = new Map<string, string>();
  for (const member of plan.members) versions.set(member.id, member.version);
  // A missing member is part of the selection, and its absence is a change: a
  // plan that lost an include must not install the set the sheet still shows.
  for (const member of plan.missing) versions.set(member.id, "unavailable");
  return versions;
}

export function planChange(
  open: CollectionPlan,
  fresh: CollectionPlan,
): PlanChange {
  const before = versionsOf(open);
  const after = versionsOf(fresh);
  const added = [...after.keys()].filter((id) => !before.has(id));
  const removed = [...before.keys()].filter((id) => !after.has(id));
  const updated = [...after.entries()]
    .filter(([id, version]) => before.has(id) && before.get(id) !== version)
    .map(([id]) => id);
  return {
    changed: added.length + removed.length + updated.length > 0,
    added,
    removed,
    updated,
  };
}

/** Posts a collection install with the chosen ids. The host's own route and its
 *  own pre-flight; absent `items` would mean every include, and this press
 *  always states what the person chose. */
export async function installCollection(
  item: StoreItem,
  items: readonly string[],
  options: {
    readonly fetch?: typeof fetch;
    /** The approval press for an update the host held. */
    readonly approveUpdate?: boolean;
  } = {},
): Promise<InstallOutcome> {
  return installItem(item, {
    items,
    ...(options.approveUpdate === true ? { approveUpdate: true } : {}),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}

/** The two extension routes consent is granted through. The fingerprint comes
 *  from the installed row, never from the plan: the plan describes what the
 *  store offers, and this PC's listing describes what it now holds. */
export interface CollectionConsentGateway {
  list(): Promise<readonly InstalledExtension[]>;
  grant(key: string, fingerprint: string): Promise<{ readonly ok: boolean }>;
}

/** Who was granted its own consent, and who was not. Names are the consent
 *  block's own, so the sheet and the live region say the same thing. */
export interface CollectionConsentResult {
  readonly granted: readonly string[];
  readonly notGranted: readonly string[];
}

/**
 * Grants each code member the consent its own package declared, after a write.
 *
 * **One press per plugin key**, because two includes can name one plugin. A
 * planned key this PC's listing does not name is reported as not granted — not
 * granted blind, and not silently skipped; a refused grant is reported the same
 * way. A listing that could not be read leaves every code member ungranted for
 * the same reason.
 */
export async function grantCollectionConsent(
  plan: CollectionPlan,
  gateway: CollectionConsentGateway,
  /** The ids this press wrote. Absent means the whole plan, which is the
   *  single-call default the tests and a whole-plan grant share. */
  written?: ReadonlySet<string>,
): Promise<CollectionConsentResult> {
  const byKey = new Map<string, CollectionPlanMember>();
  for (const member of plan.members) {
    if (member.consent === undefined) continue;
    // **A member this press did not write is not granted**: consent follows
    // the write, never the plan's full membership.
    if (written !== undefined && !written.has(member.id)) continue;
    if (!byKey.has(member.consent.key)) byKey.set(member.consent.key, member);
  }
  if (byKey.size === 0) return { granted: [], notGranted: [] };

  let listing: readonly InstalledExtension[];
  try {
    listing = await gateway.list();
  } catch {
    listing = [];
  }
  const installed = new Map(listing.map((row) => [row.key, row]));

  const granted: string[] = [];
  const notGranted: string[] = [];
  for (const [key, member] of byKey) {
    const name = member.consent?.name ?? member.name;
    const row = installed.get(key);
    if (row === undefined) {
      notGranted.push(name);
      continue;
    }
    const answer = await gateway
      .grant(row.key, row.fingerprint)
      .catch(() => undefined);
    if (answer?.ok === true) granted.push(name);
    else notGranted.push(name);
  }

  return { granted, notGranted };
}

/** What one Install press answers. */
export type CollectionPressOutcome =
  | { readonly kind: "installed"; readonly consent: CollectionConsentResult }
  /** The plan moved before anything was written: this is the new sheet. */
  | {
      readonly kind: "replanned";
      readonly plan: CollectionPlan;
      readonly change: PlanChange;
    }
  /** The host refused the press. `members` is present for a part-way failure:
   *  the sheet names the members it could not write. `held` is the update the
   *  host read and refused to write, which the sheet renders for approval. */
  | {
      readonly kind: "refused";
      readonly message: string;
      readonly members?: readonly {
        readonly id: string;
        readonly ok: boolean;
      }[];
      readonly held?: HeldUpdate;
    };

export interface CollectionPressDeps {
  readonly readPlan: (item: StoreItem) => Promise<CollectionPlan>;
  /** The chosen press, or its approval re-post. `approveUpdate` is the flag the
   *  host reads for a held member's growth. */
  readonly install: (
    item: StoreItem,
    items: readonly string[],
    approveUpdate: boolean,
  ) => Promise<InstallOutcome>;
  readonly consent: CollectionConsentGateway;
  /** Whether this press approves an update the host held. */
  readonly approveUpdate?: boolean;
}

/** The press the sheet hands the region's install hook. The two callbacks are
 *  how a re-read plan replaces the sheet and how a write reports the consent it
 *  did or did not obtain. `approveUpdate` re-posts the same chosen set after a
 *  hold, and is never set by the first press. */
export interface CollectionInstallPress {
  (
    item: StoreItem,
    items: readonly string[],
    openPlan: CollectionPlan,
    onPlanReplaced: (plan: CollectionPlan, change: PlanChange) => void,
    onInstalled: (consent: CollectionConsentResult) => void,
    approveUpdate?: boolean,
  ): void;
}

/**
 * The press, in the order the invariants demand.
 *
 * 1. Re-read the plan; a moved plan replaces the sheet and installs nothing.
 * 2. Refuse a set that leaves out a required member or names an unavailable
 *    one. The sheet locks required rows and disables the press, so this only
 *    answers a stale plan or a direct call.
 * 3. Install the chosen ids.
 * 4. **Only a write grants consent.** A refusal returns before the gateway is
 *    touched, so a failed install can never look like a granted plugin.
 */
export async function pressCollection(
  item: StoreItem,
  items: readonly string[],
  openPlan: CollectionPlan,
  deps: CollectionPressDeps,
): Promise<CollectionPressOutcome> {
  let fresh: CollectionPlan;
  try {
    fresh = await deps.readPlan(item);
  } catch (failure: unknown) {
    return {
      kind: "refused",
      message: failure instanceof Error ? failure.message : String(failure),
    };
  }

  const change = planChange(openPlan, fresh);
  if (change.changed) return { kind: "replanned", plan: fresh, change };

  const choice = choiceOf(fresh, new Set(items));
  if (fresh.missing.length > 0) {
    return {
      kind: "refused",
      message: uiCopy.store.collectionSheet.unavailableBlocks(
        fresh.missing.map((member) => member.id),
      ),
    };
  }
  if (choice.missingRequired.length > 0) {
    return {
      kind: "refused",
      message: uiCopy.store.collectionSheet.requiredMissing(
        choice.missingRequired,
      ),
    };
  }

  const outcome = await deps.install(
    item,
    [...choice.chosen],
    deps.approveUpdate === true,
  );
  if (!outcome.ok) {
    return {
      kind: "refused",
      message:
        "held" in outcome
          ? uiCopy.store.install.reviewHeading
          : outcome.message,
      ...("members" in outcome && outcome.members !== undefined
        ? { members: outcome.members }
        : {}),
      ...("held" in outcome ? { held: outcome.held } : {}),
    };
  }

  // **Only a member this press wrote is granted.** The host answers `ok` for a
  // collection whose members were all already registered, and each such member
  // carries a reason; granting those would be a consent write behind an
  // Install or Update press that wrote nothing for them. An answer with no
  // per-member outcomes cannot say what was written, so it grants nothing and
  // reports the chosen code members as not granted rather than staying silent.
  if (outcome.members === undefined) {
    // One plugin can supply several members, so the names are deduped by the
    // consent key the grant itself is keyed by: a person reads each plugin once.
    const notGranted = new Map<string, string>();
    for (const member of fresh.members) {
      if (member.consent !== undefined && choice.chosen.has(member.id)) {
        notGranted.set(member.consent.key, member.consent.name);
      }
    }
    return {
      kind: "installed",
      consent: { granted: [], notGranted: [...notGranted.values()] },
    };
  }
  const written = new Set(
    outcome.members
      .filter((member) => member.ok && member.reason === undefined)
      .map((member) => member.id),
  );

  return {
    kind: "installed",
    consent: await grantCollectionConsent(fresh, deps.consent, written),
  };
}
