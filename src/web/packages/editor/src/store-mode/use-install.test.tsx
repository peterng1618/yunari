// @vitest-environment jsdom
/**
 * The install hook's collection press.
 *
 * **Why this file exists.** The sheet's DOM test hands the hook a spy, so the
 * press itself — the in-flight guard, the re-read, the install post, the
 * per-member consent grant, the refusal, the announcement and the re-list —
 * had no case of its own. Here the hook runs against a stubbed fetch and a
 * stubbed source, so a failure in that path is not hidden behind a surface.
 */
import type { InstalledExtension } from "@yunari/extension-api";
import {
  type CollectionPlan,
  DASHBOARD_THEME_KIND,
  defaultFacetsFor,
} from "@yunari/renderer-core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type {
  ClientAnswer,
  ExtensionClient,
} from "../plugin-manager/use-extensions.js";
import { uiCopy } from "../ui-copy.js";
import type { InstallControl } from "./install-item.js";
import type { ItemSource, StoreItem } from "./local-source.js";
import { useInstall } from "./use-install.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const COLLECTION_ID = "ops-collection";
const ITEM_ID = "hwinfo-plugin";
const CONSENT = {
  key: "acme/hwinfo",
  name: "HWiNFO bridge",
  execution: "trusted-worker",
  capabilities: ["sensor:provide"],
  devices: [],
} as const;

const PLAN: CollectionPlan = {
  members: [
    {
      id: "wall-theme",
      kind: DASHBOARD_THEME_KIND,
      name: "Office wall",
      version: "1.3.0",
      bytes: 1024,
      publisher: "huyng",
      optional: false,
    },
    {
      id: ITEM_ID,
      kind: "plugin",
      name: "HWiNFO bridge",
      version: "2.1.0",
      bytes: 2048,
      publisher: "acme",
      optional: true,
      consent: CONSENT,
    },
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
    includes: PLAN.members.map((member) => member.id),
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

const EXTENSION: InstalledExtension = {
  key: CONSENT.key,
  name: CONSENT.name,
  publisher: "acme",
  version: "2.1.0",
  execution: "trusted-worker",
  capabilities: [],
  contributions: {},
  devices: [],
  consent: "missing",
  fingerprint: "fp-hwinfo",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function source(list: () => Promise<readonly StoreItem[]>): ItemSource {
  return { kind: "collection", list };
}

interface HarnessOptions {
  readonly list?: () => Promise<readonly StoreItem[]>;
  readonly readPlan?: (item: StoreItem) => Promise<CollectionPlan>;
  readonly extensions?: Pick<ExtensionClient, "list" | "grant">;
  readonly onPlanReplaced?: (plan: CollectionPlan) => void;
}

/** A grant the host accepts, typed the way the client answers. */
const granted = async (): Promise<ClientAnswer> => ({ ok: true });

let control: InstallControl | undefined;
let announcement = "";
let root: Root | undefined;
let host: HTMLDivElement | undefined;

function Harness(props: HarnessOptions): null {
  const install = useInstall({
    source: source(props.list ?? (async () => [])),
    onListed: () => undefined,
    ...(props.readPlan === undefined ? {} : { readPlan: props.readPlan }),
    ...(props.extensions === undefined ? {} : { extensions: props.extensions }),
  });
  control = install.control;
  announcement = install.announcement;
  return null;
}

async function unmount(): Promise<void> {
  const mounted = root;
  root = undefined;
  host?.remove();
  host = undefined;
  control = undefined;
  if (mounted !== undefined) await act(async () => mounted.unmount());
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await unmount();
});

async function mount(options: HarnessOptions = {}): Promise<void> {
  await unmount();
  const container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  host = container;
  await act(async () => mounted.render(<Harness {...options} />));
}

function pressWith(options: HarnessOptions, items: readonly string[]): void {
  const install = control;
  if (install?.onInstallCollection === undefined) {
    throw new Error("the hook returned no collection press");
  }
  install.onInstallCollection(
    collectionItem(),
    items,
    PLAN,
    (plan) => options.onPlanReplaced?.(plan),
    () => undefined,
  );
}

it("posts the chosen ids and grants only the members it wrote", async () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    jsonResponse({
      ok: true,
      id: COLLECTION_ID,
      members: [
        { id: "wall-theme", ok: true },
        { id: ITEM_ID, ok: true },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const grant = vi.fn(granted);
  const listed = vi.fn(async () => []);
  const harness: HarnessOptions = {
    list: listed,
    extensions: { list: async () => [EXTENSION], grant },
    readPlan: async () => PLAN,
  };
  await mount(harness);

  await act(async () => pressWith(harness, ["wall-theme", ITEM_ID]));
  await vi.waitFor(() => expect(grant).toHaveBeenCalledTimes(1));

  const body = JSON.parse(
    String((fetch.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
  ) as { kind: string; items: readonly string[] };
  expect(body.kind).toBe("collection");
  expect(body.items).toEqual(["wall-theme", ITEM_ID]);
  expect(grant).toHaveBeenCalledWith(CONSENT.key, EXTENSION.fingerprint);
  expect(listed).toHaveBeenCalledTimes(1);
  expect(announcement).toBe(uiCopy.store.install.installed("Ops collection"));
});

it("grants nothing when every member was already installed", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      jsonResponse({
        ok: true,
        id: COLLECTION_ID,
        members: [
          { id: "wall-theme", ok: true, reason: "Already installed." },
          { id: ITEM_ID, ok: true, reason: "Already installed." },
        ],
      }),
    ),
  );
  const listExtensions = vi.fn(async () => [EXTENSION]);
  const grant = vi.fn(granted);
  const harness: HarnessOptions = {
    extensions: { list: listExtensions, grant },
    readPlan: async () => PLAN,
  };
  await mount(harness);

  await act(async () => pressWith(harness, ["wall-theme", ITEM_ID]));
  await vi.waitFor(() =>
    expect(announcement).toBe(uiCopy.store.install.installed("Ops collection")),
  );

  expect(listExtensions).not.toHaveBeenCalled();
  expect(grant).not.toHaveBeenCalled();
});

it("refuses a second press in one flight", async () => {
  const fetch = vi.fn(() => new Promise<Response>(() => undefined));
  vi.stubGlobal("fetch", fetch);
  const harness: HarnessOptions = { readPlan: async () => PLAN };
  await mount(harness);

  await act(async () => {
    pressWith(harness, ["wall-theme"]);
    pressWith(harness, ["wall-theme"]);
  });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(control?.installingIds.has(COLLECTION_ID)).toBe(true);
});

it("states the host's refusal and grants nothing", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("a member refused", { status: 400 })),
  );
  const grant = vi.fn(granted);
  const harness: HarnessOptions = {
    extensions: { list: async () => [], grant },
    readPlan: async () => PLAN,
  };
  await mount(harness);

  await act(async () => pressWith(harness, ["wall-theme"]));
  await vi.waitFor(() => expect(announcement).toBe("a member refused"));
  expect(grant).not.toHaveBeenCalled();
});

it("states a stale list after a successful write", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      jsonResponse({
        ok: true,
        id: COLLECTION_ID,
        members: [{ id: "wall-theme", ok: true }],
      }),
    ),
  );
  const harness: HarnessOptions = {
    list: async () => {
      throw new Error("no listing");
    },
    extensions: { list: async () => [], grant: granted },
    readPlan: async () => PLAN,
  };
  await mount(harness);

  await act(async () => pressWith(harness, ["wall-theme"]));
  await vi.waitFor(() =>
    expect(control?.refusal?.message).toBe(uiCopy.store.install.notRefreshed),
  );
});

it("replaces a moved plan without posting an install", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const replaced: CollectionPlan[] = [];
  const fresh: CollectionPlan = {
    ...PLAN,
    members: [PLAN.members[0] as CollectionPlan["members"][number]],
  };
  const harness: HarnessOptions = {
    readPlan: async () => fresh,
    onPlanReplaced: (plan) => replaced.push(plan),
  };
  await mount(harness);

  await act(async () => pressWith(harness, ["wall-theme"]));
  await vi.waitFor(() => expect(replaced).toEqual([fresh]));
  expect(fetch).not.toHaveBeenCalled();
});
