import type { InstalledExtension } from "@yunari/extension-api";
import {
  type CatalogueOrigin,
  type CollectionPlan,
  type CollectionPlanMember,
  DASHBOARD_THEME_KIND,
  defaultFacetsFor,
} from "@yunari/renderer-core";
import { describe, expect, it, vi } from "vitest";
import type { InstallOutcome } from "../store-mode/install-item.js";
import type { StoreItem } from "../store-mode/local-source.js";
import { uiCopy } from "../ui-copy.js";
import {
  type CollectionConsentGateway,
  choiceOf,
  choicesOf,
  grantCollectionConsent,
  installCollection,
  planChange,
  pressCollection,
  toggleChoice,
  updateDiff,
} from "./collection-install.js";

const COLLECTION_ID = "ops-collection";
const CONSENT = {
  key: "acme/hwinfo",
  name: "HWiNFO bridge",
  execution: "trusted-worker",
  capabilities: ["sensor:provide", "usb:device"],
  devices: ["1c2d:3e4f"],
} as const;

function member(
  overrides: Partial<CollectionPlanMember> & Pick<CollectionPlanMember, "id">,
): CollectionPlanMember {
  return {
    kind: DASHBOARD_THEME_KIND,
    name: overrides.id,
    version: "1.0.0",
    bytes: 1024,
    publisher: "huyng",
    optional: false,
    ...overrides,
  };
}

/** Two required listings and one optional plugin: enough to tell a locked
 *  member from an unticked one, and to have code consent in the same plan. */
const PLAN: CollectionPlan = {
  members: [
    member({ id: "wall-theme", name: "Office wall" }),
    member({
      id: "clock-widget",
      kind: "widget-pack",
      name: "Clock",
      optional: true,
    }),
    member({
      id: "hwinfo-plugin",
      kind: "plugin",
      name: "HWiNFO bridge",
      optional: true,
      consent: CONSENT,
    }),
  ],
  missing: [],
  totalBytes: 3072,
};

function collectionItem(): StoreItem {
  return {
    id: COLLECTION_ID,
    kind: "collection",
    name: "Ops collection",
    members: [],
    includes: ["wall-theme", "clock-widget", "hwinfo-plugin"].map((id) => ({
      id,
      optional: false,
    })),
    author: "huyng",
    version: "1.0.0",
    updatedAt: undefined,
    thumbnailUrl: undefined,
    ground: undefined,
    origin: undefined,
    catalogue: {
      id: COLLECTION_ID,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
      downloads: 0,
      favorites: 0,
      packageUrl: "https://store.test/ops-collection.yunari",
      installedVersion: undefined,
      sha256: "a".repeat(64),
      bytes: 4096,
      publisher: "huyng",
    },
    facets: defaultFacetsFor("collection"),
  };
}

function origin(
  catalogueId: string,
  overrides: Partial<CatalogueOrigin> = {},
): CatalogueOrigin {
  return {
    kind: "widget-pack",
    catalogueId,
    version: "1.0.0",
    installedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function extension(row: {
  readonly key: string;
  readonly fingerprint: string;
  readonly consent?: InstalledExtension["consent"];
}): InstalledExtension {
  return {
    key: row.key,
    name: row.key,
    publisher: "acme",
    version: "2.1.0",
    execution: "trusted-worker",
    capabilities: [],
    contributions: {},
    devices: [],
    consent: row.consent ?? "missing",
    fingerprint: row.fingerprint,
  };
}

describe("choicesOf", () => {
  it("chooses every member by default and locks required ones", () => {
    const choice = choicesOf(PLAN);

    expect([...choice.chosen].sort()).toEqual([
      "clock-widget",
      "hwinfo-plugin",
      "wall-theme",
    ]);
    expect(choice.missingRequired).toEqual([]);
  });

  it("keeps a required member chosen when it is unticked", () => {
    const unticked = toggleChoice(PLAN, choicesOf(PLAN).chosen, "wall-theme");

    expect(unticked.chosen.has("wall-theme")).toBe(true);
    expect(unticked.missingRequired).toEqual([]);
  });

  it("drops an optional member and never invents an unknown id", () => {
    const unticked = toggleChoice(
      PLAN,
      choicesOf(PLAN).chosen,
      "hwinfo-plugin",
    );
    expect(unticked.chosen.has("hwinfo-plugin")).toBe(false);

    const withUnknown = choiceOf(PLAN, new Set(["wall-theme", "ghost"]));
    expect([...withUnknown.chosen]).toEqual(["wall-theme"]);
  });

  it("reports a required member a direct caller left out", () => {
    const choice = choiceOf(PLAN, new Set(["clock-widget"]));

    expect(choice.missingRequired).toEqual(["wall-theme"]);
  });
});

describe("updateDiff", () => {
  it("diffs missing and dropped members against the origin records", () => {
    const origins = [
      // Recorded as this collection's member.
      origin("wall-theme", { collections: [COLLECTION_ID] }),
      // Installed by hand, but its catalogue id is one of the includes.
      origin("clock-widget"),
      // Recorded as this collection's member and no longer included.
      origin("old-widget", { collections: [COLLECTION_ID] }),
    ];

    const diff = updateDiff(PLAN, origins, COLLECTION_ID);

    expect(diff.missing).toEqual(["hwinfo-plugin"]);
    expect(diff.dropped).toEqual(["old-widget"]);
  });

  it("does not repeat an unavailable include as missing", () => {
    const plan: CollectionPlan = {
      ...PLAN,
      missing: [{ id: "gone-theme", reason: "unpublished" }],
    };

    const diff = updateDiff(plan, [], COLLECTION_ID);

    expect(diff.missing).toEqual([
      "wall-theme",
      "clock-widget",
      "hwinfo-plugin",
    ]);
    expect(diff.dropped).toEqual([]);
  });
});

describe("planChange", () => {
  it("reports an id or a version that moved", () => {
    const fresh: CollectionPlan = {
      members: [
        member({ id: "wall-theme", version: "1.1.0" }),
        member({ id: "clock-widget", kind: "widget-pack" }),
        member({ id: "new-shape", kind: "widget-pack" }),
      ],
      missing: [],
      totalBytes: 3072,
    };

    const change = planChange(PLAN, fresh);

    expect(change.changed).toBe(true);
    expect(change.updated).toEqual(["wall-theme"]);
    expect(change.added).toEqual(["new-shape"]);
    expect(change.removed).toEqual(["hwinfo-plugin"]);
  });

  it("is unchanged for the same ids and versions", () => {
    expect(planChange(PLAN, PLAN).changed).toBe(false);
  });
});

describe("installCollection", () => {
  it("posts the chosen ids as the install's items", async () => {
    const bodies: unknown[] = [];
    const fakeFetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ ok: true, id: COLLECTION_ID }), {
          status: 200,
        });
      },
    );

    const outcome = await installCollection(
      collectionItem(),
      ["wall-theme", "hwinfo-plugin"],
      { fetch: fakeFetch as typeof fetch },
    );

    expect(outcome.ok).toBe(true);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      kind: "collection",
      items: ["wall-theme", "hwinfo-plugin"],
    });
  });
});

describe("grantCollectionConsent", () => {
  it("grants each code member its listing's fingerprint", async () => {
    const grants: { key: string; fingerprint: string }[] = [];
    const gateway: CollectionConsentGateway = {
      list: async () => [
        extension({ key: "acme/hwinfo", fingerprint: "fp-hwinfo" }),
      ],
      grant: async (key, fingerprint) => {
        grants.push({ key, fingerprint });
        return { ok: true };
      },
    };

    const result = await grantCollectionConsent(PLAN, gateway);

    expect(grants).toEqual([{ key: "acme/hwinfo", fingerprint: "fp-hwinfo" }]);
    expect(result).toEqual({
      granted: ["HWiNFO bridge"],
      notGranted: [],
    });
  });

  it("grants one POST per plugin key when two members share one", async () => {
    const shared: CollectionPlan = {
      ...PLAN,
      members: [
        member({ id: "a", kind: "plugin", consent: CONSENT }),
        member({ id: "b", kind: "plugin", consent: CONSENT }),
      ],
    };
    const grant = vi.fn(async () => ({ ok: true }));
    const gateway: CollectionConsentGateway = {
      list: async () => [
        extension({ key: "acme/hwinfo", fingerprint: "fp-hwinfo" }),
      ],
      grant,
    };

    await grantCollectionConsent(shared, gateway);

    expect(grant).toHaveBeenCalledTimes(1);
  });

  it("reports a code member the installed listing does not name", async () => {
    const grant = vi.fn(async () => ({ ok: true }));
    const gateway: CollectionConsentGateway = {
      list: async () => [],
      grant,
    };

    const result = await grantCollectionConsent(PLAN, gateway);

    expect(grant).not.toHaveBeenCalled();
    expect(result).toEqual({ granted: [], notGranted: ["HWiNFO bridge"] });
  });

  it("reports a refused grant rather than counting it granted", async () => {
    const gateway: CollectionConsentGateway = {
      list: async () => [
        extension({ key: "acme/hwinfo", fingerprint: "fp-hwinfo" }),
      ],
      grant: async () => ({ ok: false, message: "no" }),
    };

    const result = await grantCollectionConsent(PLAN, gateway);

    expect(result).toEqual({ granted: [], notGranted: ["HWiNFO bridge"] });
  });
});

const PLUGIN_A = { ...CONSENT, name: "Plugin A" };
const PLUGIN_B = { ...CONSENT, key: "acme/clock", name: "Plugin B" };
/** Two plugin members, one written before a later hold and one carried into an
 *  approval press. */
const TWO_PLUGIN_PLAN: CollectionPlan = {
  members: [
    member({ id: "plugin-a", kind: "plugin", consent: PLUGIN_A }),
    member({ id: "plugin-b", kind: "plugin", consent: PLUGIN_B }),
  ],
  missing: [],
  totalBytes: 2048,
};

describe("pressCollection", () => {
  const readPlan = async (): Promise<CollectionPlan> => PLAN;

  it("installs the chosen set, then grants consent", async () => {
    const install = vi.fn(async () => ({
      ok: true as const,
      members: [
        { id: "wall-theme", ok: true },
        { id: "hwinfo-plugin", ok: true },
      ],
    }));
    const grant = vi.fn(async () => ({ ok: true }));
    const gateway: CollectionConsentGateway = {
      list: async () => [
        extension({ key: "acme/hwinfo", fingerprint: "fp-hwinfo" }),
      ],
      grant,
    };

    const outcome = await pressCollection(
      collectionItem(),
      ["wall-theme", "hwinfo-plugin"],
      PLAN,
      { readPlan, install, consent: gateway },
    );

    expect(install).toHaveBeenCalledWith(
      collectionItem(),
      ["wall-theme", "hwinfo-plugin"],
      undefined,
    );
    expect(grant).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      kind: "installed",
      consent: { granted: ["HWiNFO bridge"], notGranted: [] },
    });
  });

  it("grants nothing when the install wrote nothing", async () => {
    const install = vi.fn(async () => ({
      ok: false as const,
      message: "member refused",
    }));
    const list = vi.fn(async () => []);
    const grant = vi.fn(async () => ({ ok: true }));

    const outcome = await pressCollection(
      collectionItem(),
      ["wall-theme"],
      PLAN,
      { readPlan, install, consent: { list, grant } },
    );

    expect(outcome).toEqual({ kind: "refused", message: "member refused" });
    expect(list).not.toHaveBeenCalled();
    expect(grant).not.toHaveBeenCalled();
  });

  it("reports code consent when the answer carried no member outcomes", async () => {
    const install = vi.fn(async () => ({ ok: true as const }));
    const list = vi.fn(async () => []);
    const grant = vi.fn(async () => ({ ok: true }));

    const outcome = await pressCollection(
      collectionItem(),
      ["wall-theme", "hwinfo-plugin"],
      PLAN,
      { readPlan, install, consent: { list, grant } },
    );

    expect(list).not.toHaveBeenCalled();
    expect(grant).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      kind: "installed",
      consent: { granted: [], notGranted: ["HWiNFO bridge"] },
    });
  });

  it("grants nothing when every member was already installed", async () => {
    const install = vi.fn(async () => ({
      ok: true as const,
      members: [
        { id: "wall-theme", ok: true, reason: "Already installed." },
        { id: "hwinfo-plugin", ok: true, reason: "Already installed." },
      ],
    }));
    const list = vi.fn(async () => [
      extension({ key: "acme/hwinfo", fingerprint: "fp-hwinfo" }),
    ]);
    const grant = vi.fn(async () => ({ ok: true }));

    const outcome = await pressCollection(
      collectionItem(),
      ["wall-theme", "hwinfo-plugin"],
      PLAN,
      { readPlan, install, consent: { list, grant } },
    );

    expect(list).not.toHaveBeenCalled();
    expect(grant).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      kind: "installed",
      consent: { granted: [], notGranted: [] },
    });
  });

  it("grants nothing for an optional code member the person unticked", async () => {
    const install = vi.fn(async () => ({
      ok: true as const,
      members: [{ id: "wall-theme", ok: true }],
    }));
    const list = vi.fn(async () => []);
    const grant = vi.fn(async () => ({ ok: true }));

    const outcome = await pressCollection(
      collectionItem(),
      ["wall-theme"],
      PLAN,
      { readPlan, install, consent: { list, grant } },
    );

    expect(install).toHaveBeenCalledWith(
      collectionItem(),
      ["wall-theme"],
      undefined,
    );
    expect(list).not.toHaveBeenCalled();
    expect(grant).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      kind: "installed",
      consent: { granted: [], notGranted: [] },
    });
  });

  it("replaces the sheet when the plan moved instead of installing", async () => {
    const install = vi.fn(async () => ({ ok: true as const }));
    const fresh: CollectionPlan = {
      members: [member({ id: "wall-theme", version: "1.1.0" })],
      missing: [],
      totalBytes: 1024,
    };

    const outcome = await pressCollection(
      collectionItem(),
      ["wall-theme"],
      PLAN,
      {
        readPlan: async () => fresh,
        install,
        consent: { list: vi.fn(), grant: vi.fn() },
      },
    );

    expect(outcome).toMatchObject({ kind: "replanned", plan: fresh });
    expect(install).not.toHaveBeenCalled();
  });

  it("refuses a direct call that left out a required member", async () => {
    const install = vi.fn(async () => ({ ok: true as const }));

    const outcome = await pressCollection(
      collectionItem(),
      ["clock-widget"],
      PLAN,
      { readPlan, install, consent: { list: vi.fn(), grant: vi.fn() } },
    );

    expect(outcome).toEqual({
      kind: "refused",
      message: uiCopy.store.collectionSheet.requiredMissing(["wall-theme"]),
    });
    expect(install).not.toHaveBeenCalled();
  });

  /** **A press that wrote a member before a later hold still owes that member
   *  its consent.** The retry skips an already-registered member, so without the
   *  grant on the refused arm the plugin is written, registered, and unloadable
   *  while the sheet says installed. */
  it("grants the member a stopped press wrote, and not the held one", async () => {
    const heldB = {
      key: "acme/clock",
      name: "Plugin B",
      publisher: "acme",
      reasons: ["adds usb:device"],
    };
    const install = vi.fn(
      async (): Promise<InstallOutcome> => ({
        ok: false as const,
        held: heldB,
        memberId: "plugin-b",
        members: [
          { id: "plugin-a", ok: true },
          { id: "plugin-b", ok: false, reason: "A review is needed." },
        ],
      }),
    );
    const list = vi.fn(async () => [
      extension({ key: "acme/hwinfo", fingerprint: "fp-a" }),
      extension({ key: "acme/clock", fingerprint: "fp-b" }),
    ]);
    const grant = vi.fn(async () => ({ ok: true }));

    const first = await pressCollection(
      collectionItem(),
      ["plugin-a", "plugin-b"],
      TWO_PLUGIN_PLAN,
      {
        readPlan: async () => TWO_PLUGIN_PLAN,
        install,
        consent: { list, grant },
      },
    );

    expect(first).toMatchObject({
      kind: "refused",
      held: heldB,
      memberId: "plugin-b",
      written: ["plugin-a"],
      consent: { granted: ["Plugin A"], notGranted: [] },
    });
    // B was held, not written, so its consent is never granted by this press.
    expect(grant).toHaveBeenCalledTimes(1);
    expect(grant).toHaveBeenCalledWith("acme/hwinfo", "fp-a");

    // The approval press writes B; A is already registered and stays ungranted
    // by the retry because this press wrote none of its bytes. The sheet carries
    // A's id forward, and the listing now shows its consent, so it is not
    // granted a second time.
    list.mockResolvedValueOnce([
      extension({
        key: "acme/hwinfo",
        fingerprint: "fp-a",
        consent: "granted",
      }),
      extension({ key: "acme/clock", fingerprint: "fp-b" }),
    ]);
    install.mockResolvedValueOnce({
      ok: true,
      members: [
        { id: "plugin-a", ok: true, reason: "Already installed." },
        { id: "plugin-b", ok: true },
      ],
    });
    const approveGrant = vi.fn(async () => ({ ok: true }));
    const second = await pressCollection(
      collectionItem(),
      ["plugin-a", "plugin-b"],
      TWO_PLUGIN_PLAN,
      {
        readPlan: async () => TWO_PLUGIN_PLAN,
        install,
        approveMember: "plugin-b",
        carried: ["plugin-a"],
        consent: { list, grant: approveGrant },
      },
    );

    expect(second).toEqual({
      kind: "installed",
      consent: { granted: ["Plugin B"], notGranted: [] },
    });
    expect(approveGrant).toHaveBeenCalledTimes(1);
    expect(approveGrant).toHaveBeenCalledWith("acme/clock", "fp-b");
  });

  /** **The sheet's carried ids survive the refusal being cleared.** A grant
   *  that failed on the stopped press is retried on the approval press, over the
   *  union of what that press wrote and what the sheet carried. */
  it("grants a carried member whose grant failed, plus the one this press wrote", async () => {
    const install = vi.fn(async () => ({
      ok: true as const,
      members: [
        { id: "plugin-a", ok: true, reason: "Already installed." },
        { id: "plugin-b", ok: true },
      ],
    }));
    const list = vi.fn(async () => [
      extension({ key: "acme/hwinfo", fingerprint: "fp-a" }),
      extension({ key: "acme/clock", fingerprint: "fp-b" }),
    ]);
    const grant = vi.fn(async () => ({ ok: true }));

    const outcome = await pressCollection(
      collectionItem(),
      ["plugin-a", "plugin-b"],
      TWO_PLUGIN_PLAN,
      {
        readPlan: async () => TWO_PLUGIN_PLAN,
        install,
        approveMember: "plugin-b",
        carried: ["plugin-a"],
        consent: { list, grant },
      },
    );

    expect(grant).toHaveBeenCalledTimes(2);
    expect(grant).toHaveBeenCalledWith("acme/hwinfo", "fp-a");
    expect(grant).toHaveBeenCalledWith("acme/clock", "fp-b");
    expect(outcome).toEqual({
      kind: "installed",
      consent: { granted: ["Plugin A", "Plugin B"], notGranted: [] },
    });
  });

  it("does not grant a carried id the current plan no longer names", async () => {
    const install = vi.fn(async () => ({
      ok: true as const,
      members: [{ id: "hwinfo-plugin", ok: true }],
    }));
    const list = vi.fn(async () => [
      extension({ key: "acme/hwinfo", fingerprint: "fp-hwinfo" }),
    ]);
    const grant = vi.fn(async () => ({ ok: true }));

    const outcome = await pressCollection(
      collectionItem(),
      ["wall-theme", "clock-widget", "hwinfo-plugin"],
      PLAN,
      {
        readPlan,
        install,
        carried: ["retired-plugin"],
        consent: { list, grant },
      },
    );

    expect(grant).toHaveBeenCalledTimes(1);
    expect(grant).toHaveBeenCalledWith("acme/hwinfo", "fp-hwinfo");
    expect(outcome).toEqual({
      kind: "installed",
      consent: { granted: ["HWiNFO bridge"], notGranted: [] },
    });
  });

  it("does not re-grant a carried member whose consent already succeeded", async () => {
    const install = vi.fn(async () => ({
      ok: true as const,
      members: [
        { id: "plugin-a", ok: true, reason: "Already installed." },
        { id: "plugin-b", ok: true },
      ],
    }));
    const list = vi.fn(async () => [
      extension({
        key: "acme/hwinfo",
        fingerprint: "fp-a",
        consent: "granted",
      }),
      extension({ key: "acme/clock", fingerprint: "fp-b" }),
    ]);
    const grant = vi.fn(async () => ({ ok: true }));

    const outcome = await pressCollection(
      collectionItem(),
      ["plugin-a", "plugin-b"],
      TWO_PLUGIN_PLAN,
      {
        readPlan: async () => TWO_PLUGIN_PLAN,
        install,
        carried: ["plugin-a"],
        consent: { list, grant },
      },
    );

    expect(grant).toHaveBeenCalledTimes(1);
    expect(grant).toHaveBeenCalledWith("acme/clock", "fp-b");
    expect(outcome).toEqual({
      kind: "installed",
      consent: { granted: ["Plugin B"], notGranted: [] },
    });
  });

  /** A refused answer whose members all carry a reason wrote nothing, so the
   *  gateway is never touched and nothing is claimed granted. */
  it("grants nothing when a refused answer wrote no member", async () => {
    const install = vi.fn(async () => ({
      ok: false as const,
      held: {
        key: "acme/hwinfo",
        name: "HWiNFO bridge",
        publisher: "acme",
        reasons: ["adds usb:device"],
      },
      memberId: "hwinfo-plugin",
      members: [
        { id: "wall-theme", ok: true, reason: "Already installed." },
        { id: "hwinfo-plugin", ok: false, reason: "A review is needed." },
      ],
    }));
    const list = vi.fn(async () => []);
    const grant = vi.fn(async () => ({ ok: true }));

    const outcome = await pressCollection(
      collectionItem(),
      ["wall-theme", "hwinfo-plugin"],
      PLAN,
      { readPlan, install, consent: { list, grant } },
    );

    expect(outcome).toMatchObject({
      kind: "refused",
      consent: { granted: [], notGranted: [] },
    });
    expect(list).not.toHaveBeenCalled();
    expect(grant).not.toHaveBeenCalled();
  });

  /** **A held member is an answer, not a lost press.** The outcome carries the
   *  growth and the member it belongs to, so the sheet can render it and its
   *  approval names exactly that member. */
  it("carries a held member and forwards its id as the approval", async () => {
    const held = {
      key: "acme/hwinfo",
      name: "HWiNFO bridge",
      publisher: "acme",
      reasons: ["adds usb:device"],
    };
    const install = vi.fn(async () => ({
      ok: false as const,
      held,
      memberId: "hwinfo-plugin",
    }));

    const outcome = await pressCollection(
      collectionItem(),
      ["wall-theme", "hwinfo-plugin"],
      PLAN,
      {
        readPlan,
        install,
        approveMember: "hwinfo-plugin",
        consent: { list: vi.fn(), grant: vi.fn() },
      },
    );

    expect(install).toHaveBeenCalledWith(
      collectionItem(),
      ["wall-theme", "hwinfo-plugin"],
      "hwinfo-plugin",
    );
    expect(outcome).toEqual({
      kind: "refused",
      message: uiCopy.store.install.reviewHeading,
      held,
      memberId: "hwinfo-plugin",
    });
  });
});
