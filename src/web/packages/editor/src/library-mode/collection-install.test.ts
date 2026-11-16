import type { InstalledExtension } from "@yunari/extension-api";
import {
  type CatalogueOrigin,
  type CollectionPlan,
  type CollectionPlanMember,
  DASHBOARD_THEME_KIND,
  defaultFacetsFor,
} from "@yunari/renderer-core";
import { describe, expect, it, vi } from "vitest";
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
    includes: ["wall-theme", "clock-widget", "hwinfo-plugin"],
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
    consent: "granted",
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

    expect(install).toHaveBeenCalledWith(collectionItem(), [
      "wall-theme",
      "hwinfo-plugin",
    ]);
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

    expect(install).toHaveBeenCalledWith(collectionItem(), ["wall-theme"]);
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
});
