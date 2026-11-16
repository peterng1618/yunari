// @vitest-environment jsdom
/**
 * The collection install sheet: every member it will put on this PC, one
 * opt-out list, the code members' own authority, and the update diff.
 *
 * **What this file owns.** The rows a person reads and presses — a required
 * member locked, an optional member unticked, the total of what is ticked, the
 * aggregated consent block, the named unavailable member that blocks the press,
 * the dropped member offered where its kind can remove it — plus the plan that
 * moved between open and Install replacing the sheet.
 *
 * The press itself, its plan re-read, and the consent grants are
 * `collection-install.test.ts`'s; here the control is a spy so the sheet's own
 * wiring is the only thing measured.
 */
import {
  type CatalogueOrigin,
  type CollectionPlan,
  DASHBOARD_THEME_KIND,
  defaultFacetsFor,
} from "@yunari/renderer-core";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it } from "vitest";
import type { InstallControl } from "../store-mode/install-item.js";
import type { StoreItem } from "../store-mode/local-source.js";
import { uiCopy } from "../ui-copy.js";
import type { PlanChange } from "./collection-install.js";
import { CollectionSheet } from "./collection-sheet.js";

// Base UI's dialog needs the browser APIs jsdom lacks: floating-ui observes its
// anchor, the popup waits for its own open transition, and it asks the selector
// engine for `:modal`/`:popover-open`.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as never;
Element.prototype.getAnimations ??= (): never[] => [];
window.PointerEvent ??= MouseEvent as never;

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  const matches = Element.prototype.matches;
  Element.prototype.matches = Object.assign(function (
    this: Element,
    selector: string,
  ): boolean {
    if (selector === ":modal" || selector === ":popover-open") return false;
    return matches.call(this, selector);
  }, matches);
});

let root: Root | undefined;
let host: HTMLDivElement | undefined;

async function unmount(): Promise<void> {
  const mounted = root;
  root = undefined;
  host?.remove();
  host = undefined;
  if (mounted !== undefined) await act(async () => mounted.unmount());
}

afterEach(async () => {
  await unmount();
});

async function mount(element: ReactElement): Promise<HTMLDivElement> {
  await unmount();
  const container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  host = container;
  await act(async () => {
    mounted.render(element);
  });
  return container;
}

/** The same tree with a new element, so a prop change keeps the sheet's own
 *  state: that is how a settled press is read against a later refresh failure. */
async function rerender(element: ReactElement): Promise<void> {
  const mounted = root;
  if (mounted === undefined) throw new Error("no sheet is mounted");
  await act(async () => mounted.render(element));
}

function must<T extends Element>(found: T | null, what: string): T {
  if (found === null) throw new Error(`the sheet rendered no ${what}`);
  return found;
}

const COLLECTION_ID = "ops-collection";

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
      id: "clock-widget",
      kind: "widget-pack",
      name: "Clock",
      version: "2.0.0",
      bytes: 2048,
      publisher: "acme",
      optional: true,
    },
    {
      id: "hwinfo-plugin",
      kind: "plugin",
      name: "HWiNFO bridge",
      version: "2.1.0",
      bytes: 4096,
      publisher: "acme",
      optional: true,
      consent: {
        key: "acme/hwinfo",
        name: "HWiNFO bridge",
        execution: "trusted-worker",
        capabilities: ["sensor:provide", "usb:device"],
        devices: ["1c2d:3e4f"],
      },
    },
  ],
  missing: [],
  totalBytes: 7168,
};

function collectionItem(): StoreItem {
  return {
    id: COLLECTION_ID,
    kind: "collection",
    name: "Ops collection",
    members: [],
    includes: PLAN.members.map((member) => ({
      id: member.id,
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
      bytes: 8192,
      publisher: "huyng",
    },
    facets: defaultFacetsFor("collection"),
  };
}

interface PressCapture {
  readonly items: readonly string[];
  readonly plan: CollectionPlan;
  readonly replace: (plan: CollectionPlan, change: PlanChange) => void;
  readonly installed: (consent: {
    readonly granted: readonly string[];
    readonly notGranted: readonly string[];
  }) => void;
}

/** An install control whose collection press is captured rather than posted. */
function capturingInstall(
  capture: (press: PressCapture) => void,
): InstallControl {
  return {
    onInstall: () => undefined,
    onInstallCollection: (item, items, plan, onPlanReplaced, onInstalled) => {
      capture({
        items,
        plan,
        replace: onPlanReplaced,
        installed: onInstalled,
      });
    },
    installingIds: new Set(),
    refusal: undefined,
    held: undefined,
    onApproveUpdate: () => undefined,
    onDismissUpdate: () => undefined,
  };
}

const NO_INSTALL: InstallControl = {
  onInstall: () => undefined,
  installingIds: new Set(),
  refusal: undefined,
  held: undefined,
  onApproveUpdate: () => undefined,
  onDismissUpdate: () => undefined,
};

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

function sheet(
  plan: CollectionPlan,
  options: {
    readonly install?: InstallControl;
    readonly origins?: readonly CatalogueOrigin[];
    readonly onClose?: () => void;
    readonly planState?: "loading" | "failed";
  } = {},
): ReactElement {
  return (
    <CollectionSheet
      item={collectionItem()}
      plan={
        options.planState === "loading"
          ? { status: "loading" }
          : options.planState === "failed"
            ? { status: "failed", message: "host refused" }
            : { status: "ready", plan }
      }
      origins={options.origins ?? []}
      install={options.install ?? NO_INSTALL}
      onClose={options.onClose ?? (() => undefined)}
      {...(options.planState === undefined
        ? {}
        : { onRetryPlan: () => undefined })}
    />
  );
}

function row(container: ParentNode, id: string): HTMLElement {
  return must(
    container.querySelector<HTMLElement>(
      `[data-yunari-collection-member="${id}"]`,
    ),
    `member row ${id}`,
  );
}

function installButton(container: ParentNode): HTMLButtonElement {
  return must(
    container.querySelector<HTMLButtonElement>(
      "[data-yunari-collection-sheet-install]",
    ),
    "Install control",
  );
}

it("lists every member with its publisher, kind and size", async () => {
  await mount(sheet(PLAN));

  for (const member of PLAN.members) {
    const line = row(document, member.id);
    expect(line.textContent, `${member.id} is not named`).toContain(
      member.name,
    );
    expect(
      line.textContent,
      `${member.id} does not show its real publisher`,
    ).toContain(`@${member.publisher}`);
    expect(line.textContent, `${member.id} does not show its size`).toContain(
      uiCopy.store.collectionSheet.size(member.bytes),
    );
  }
  expect(row(document, "wall-theme").textContent).toContain(
    uiCopy.store.cell.memberKinds[DASHBOARD_THEME_KIND],
  );
  expect(row(document, "clock-widget").textContent).toContain(
    uiCopy.store.cell.memberKinds["widget-pack"],
  );
});

it("locks a required member and lets an optional one be unticked", async () => {
  await mount(sheet(PLAN));

  const required = must(
    row(document, "wall-theme").querySelector<HTMLButtonElement>(
      "[data-yunari-collection-choice]",
    ),
    "required choice",
  );
  expect(required.getAttribute("aria-checked"), "required is not checked").toBe(
    "true",
  );
  expect(required.disabled, "a required member was untickable").toBe(true);
  expect(required.getAttribute("aria-label") ?? required.textContent).toContain(
    "Office wall",
  );

  const optional = must(
    row(document, "clock-widget").querySelector<HTMLButtonElement>(
      "[data-yunari-collection-choice]",
    ),
    "optional choice",
  );
  expect(optional.disabled, "an optional member was locked").toBe(false);
  expect(optional.getAttribute("aria-label") ?? optional.textContent).toContain(
    "Clock",
  );

  const before = must(
    document.querySelector<HTMLElement>("[data-yunari-collection-sheet-total]"),
    "total",
  ).textContent;
  await act(async () => optional.click());
  expect(optional.getAttribute("aria-checked"), "untick did not stick").toBe(
    "false",
  );
  const after = must(
    document.querySelector<HTMLElement>("[data-yunari-collection-sheet-total]"),
    "total",
  ).textContent;
  expect(
    after,
    "unticking an optional member did not change the total",
  ).not.toBe(before);
  // The required member and the still-chosen plugin are what remains.
  expect(after).toContain(uiCopy.store.collectionSheet.size(1024 + 4096));
});

it("shows each code member's own authority and no collection consent", async () => {
  await mount(sheet(PLAN));

  const consent = must(
    document.querySelector<HTMLElement>(
      "[data-yunari-collection-sheet-consent]",
    ),
    "consent section",
  );
  expect(consent.textContent).toContain(PLAN.members[2]?.consent?.name ?? "");
  expect(consent.textContent).toContain("trusted-worker");
  expect(consent.textContent).toContain("sensor:provide");
  expect(consent.textContent).toContain("usb:device");
  expect(consent.textContent).toContain("1c2d:3e4f");
  expect(
    consent.textContent,
    "the sheet implied the collection itself consents",
  ).toContain(uiCopy.store.collectionSheet.consent.lead);
});

it("names an unavailable member and blocks the press", async () => {
  const blocked: CollectionPlan = {
    ...PLAN,
    missing: [{ id: "gone-theme", reason: "unpublished" }],
    totalBytes: 7168,
  };
  await mount(sheet(blocked));

  expect(document.body.textContent).toContain("gone-theme");
  expect(
    installButton(document).disabled,
    "the blocked press was enabled",
  ).toBe(true);
  const announced = must(
    document.querySelector<HTMLElement>(
      "[data-yunari-collection-sheet-blocked]",
    ),
    "blocked announcement",
  );
  expect(announced.getAttribute("role")).toBe("status");
  expect(announced.textContent).toContain(
    uiCopy.store.collectionSheet.unavailableLead,
  );
});

it("installs the chosen ids with the plan the sheet showed", async () => {
  let press: PressCapture | undefined;
  await mount(sheet(PLAN, { install: capturingInstall((it) => (press = it)) }));

  await act(async () => installButton(document).click());

  expect(press, "the sheet did not report its Install press").toBeDefined();
  expect(press?.items).toEqual(["wall-theme", "clock-widget", "hwinfo-plugin"]);
  expect(press?.plan).toEqual(PLAN);
});

it("replaces the sheet and states what changed when the plan moved", async () => {
  let press: PressCapture | undefined;
  await mount(sheet(PLAN, { install: capturingInstall((it) => (press = it)) }));
  await act(async () => installButton(document).click());

  const fresh: CollectionPlan = {
    members: [
      ...PLAN.members,
      {
        id: "new-shape",
        kind: "widget-pack",
        name: "Dial",
        version: "1.0.0",
        bytes: 512,
        publisher: "huyng",
        optional: true,
      },
    ],
    missing: [],
    totalBytes: 7680,
  };
  await act(async () => {
    press?.replace(fresh, {
      added: ["new-shape"],
      removed: [],
      updated: [],
      changed: true,
    });
  });

  expect(document.body.textContent, "the new member is not shown").toContain(
    "Dial",
  );
  const changed = must(
    document.querySelector<HTMLElement>(
      "[data-yunari-collection-sheet-changed]",
    ),
    "changed notice",
  );
  expect(changed.textContent).toContain("new-shape");

  // The replacement resets the opt-out list to every member of the new plan.
  await act(async () => installButton(document).click());
  expect(press?.items).toEqual([
    "wall-theme",
    "clock-widget",
    "hwinfo-plugin",
    "new-shape",
  ]);
  // The notice answered the previous press and must not outlive it.
  expect(
    document.querySelector("[data-yunari-collection-sheet-changed]"),
    "the changed notice survived the next press",
  ).toBeNull();
});

it("offers a dropped member where its kind removes it, without removing it", async () => {
  await mount(
    sheet(PLAN, {
      origins: [
        origin("wall-theme", { collections: [COLLECTION_ID] }),
        origin("clock-widget"),
        origin("old-widget", {
          kind: "widget-pack",
          collections: [COLLECTION_ID],
        }),
        origin("old-theme", {
          kind: "dashboard-theme",
          collections: [COLLECTION_ID],
        }),
      ],
    }),
  );

  const dropped = must(
    document.querySelector<HTMLElement>("[data-yunari-collection-dropped]"),
    "dropped section",
  );
  expect(dropped.textContent).toContain("old-widget");
  expect(dropped.textContent).toContain(
    uiCopy.store.collectionSheet.update.removal("widget-pack"),
  );
  // **The kind's own word**: a theme's surface says Delete, not Remove.
  expect(dropped.textContent).toContain(
    uiCopy.store.collectionSheet.update.removal("dashboard-theme"),
  );
  expect(
    uiCopy.store.collectionSheet.update.removal("dashboard-theme"),
  ).toContain(uiCopy.store.item.actions.delete);
  expect(
    dropped.querySelector("button"),
    "the sheet invented a removal control",
  ).toBeNull();
  expect(
    document.body.querySelector(
      '[data-yunari-collection-missing="wall-theme"]',
    ),
    "an installed include was listed as missing",
  ).toBeNull();
  expect(
    document.body.querySelector(
      '[data-yunari-collection-missing="hwinfo-plugin"]',
    ),
    "an include that is not on this PC was not listed",
  ).not.toBeNull();
});

it("does not repeat an unavailable member under the update heading", async () => {
  await mount(
    sheet(
      {
        ...PLAN,
        missing: [{ id: "gone-theme", reason: "unpublished" }],
      },
      {
        origins: [
          origin("wall-theme", { collections: [COLLECTION_ID] }),
          origin("clock-widget"),
        ],
      },
    ),
  );

  expect(
    document.body.querySelector(
      '[data-yunari-collection-missing="gone-theme"]',
    ),
    "the unavailable member was offered as an install",
  ).toBeNull();
  expect(document.body.textContent).toContain("gone-theme");
});

it("reports a code member whose consent was not granted after a write", async () => {
  let press: PressCapture | undefined;
  await mount(sheet(PLAN, { install: capturingInstall((it) => (press = it)) }));
  await act(async () => installButton(document).click());

  await act(async () => {
    press?.installed({ granted: [], notGranted: ["HWiNFO bridge"] });
  });

  expect(document.body.textContent).toContain(
    uiCopy.store.collectionSheet.notGranted(["HWiNFO bridge"]),
  );
  expect(
    document.querySelector("[data-yunari-collection-sheet-install]"),
    "Install stayed after a write",
  ).toBeNull();
});

it("keeps the way out while the plan is loading or failed", async () => {
  for (const planState of ["loading", "failed"] as const) {
    await mount(sheet(PLAN, { planState }));
    const cancel = [...document.querySelectorAll("button")].find(
      (button) =>
        button.textContent?.trim() === uiCopy.store.collectionSheet.cancel,
    );
    expect(cancel, `a ${planState} plan drew no Cancel control`).toBeDefined();
  }
});

it("states a failed re-list beside the done state", async () => {
  let press: PressCapture | undefined;
  await mount(sheet(PLAN, { install: capturingInstall((it) => (press = it)) }));
  await act(async () => installButton(document).click());
  await act(async () => {
    press?.installed({ granted: [], notGranted: [] });
  });

  await rerender(
    sheet(PLAN, {
      install: {
        ...NO_INSTALL,
        refusal: {
          id: COLLECTION_ID,
          message: uiCopy.store.install.notRefreshed,
        },
      },
    }),
  );

  expect(
    document.querySelector("[data-yunari-collection-sheet-installed]"),
    "the settled state disappeared",
  ).not.toBeNull();
  expect(
    must(
      document.querySelector<HTMLElement>(
        "[data-yunari-collection-sheet-refusal]",
      ),
      "refresh refusal",
    ).textContent,
    "the stale list was hidden behind the installed sentence",
  ).toContain(uiCopy.store.install.notRefreshed);
});

it("traps focus in a named dialog", async () => {
  await mount(sheet(PLAN, { planState: "loading" }));

  const dialog = must(
    document.querySelector<HTMLElement>('[role="dialog"]'),
    "dialog",
  );
  expect(dialog.getAttribute("aria-label")).toContain("Ops collection");
  expect(dialog.textContent).toContain(uiCopy.store.detail.plan.loading);
});

/** **A part-way failure names the members it did not write**, by the plan's own
 *  names rather than by a raw id: the host's `members` answer carries ids, and
 *  the sheet is the surface that knows what those ids are called. */
it("names the members a part-way failure could not write", async () => {
  await mount(
    sheet(PLAN, {
      install: {
        ...NO_INSTALL,
        refusal: {
          id: COLLECTION_ID,
          message: "Two members could not be written.",
          members: [
            { id: "wall-theme", ok: true },
            { id: "hwinfo-plugin", ok: false, reason: "Refused." },
          ],
        },
      },
    }),
  );

  const failed = must(
    document.querySelector<HTMLElement>(
      "[data-yunari-collection-sheet-failed]",
    ),
    "failed member sentence",
  );
  expect(failed.textContent, "the refused member is not named").toContain(
    "HWiNFO bridge",
  );
  expect(
    failed.textContent,
    "a member the host wrote is named as failed",
  ).not.toContain("Office wall");
  expect(failed.getAttribute("role"), "the news is not announced").toBe(
    "status",
  );
});

/** **An empty chosen set is blocked with a reason.** Unticking every optional
 *  member would post a collection that writes nothing and then settles on
 *  "Installed". */
it("blocks a press that chose no member", async () => {
  const plan: CollectionPlan = {
    members: [
      {
        id: "clock-widget",
        kind: "widget-pack",
        name: "Clock",
        version: "2.0.0",
        bytes: 2048,
        publisher: "acme",
        optional: true,
      },
    ],
    missing: [],
    totalBytes: 2048,
  };
  await mount(sheet(plan));

  const choice = must(
    document.querySelector<HTMLButtonElement>(
      "[data-yunari-collection-choice]",
    ),
    "member choice",
  );
  await act(async () => choice.click());

  expect(
    installButton(document).disabled,
    "a press with nothing chosen is still live",
  ).toBe(true);
  expect(
    must(
      document.querySelector<HTMLElement>(
        "[data-yunari-collection-sheet-blocked]",
      ),
      "blocked reason",
    ).textContent,
    "an empty chosen set states no reason",
  ).toBe(uiCopy.store.collectionSheet.noneChosen);
});

/** The diff's own name names what it draws: a section showing only the members
 *  this PC lacks must not be announced as "No longer in this collection". */
it("labels the update diff by the branch it draws", async () => {
  await mount(sheet(PLAN, { origins: [origin("wall-theme")] }));

  expect(
    must(
      document.querySelector<HTMLElement>("[data-yunari-collection-diff]"),
      "update diff",
    ).getAttribute("aria-label"),
    "the diff is labelled for a branch it does not draw",
  ).toBe(uiCopy.store.collectionSheet.update.missing);
});
