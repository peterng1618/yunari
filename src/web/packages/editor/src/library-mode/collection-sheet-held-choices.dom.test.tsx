// @vitest-environment jsdom
/**
 * The collection install sheet's choices while a held-update notice stands.
 *
 * **A hold locks the choices it was shown with.** A member ticked after the
 * notice appeared was never in the notice, so approving could write a growth the
 * person did not see. The optional row stays disabled until the hold is
 * answered, and the approval press names only the held member.
 */
import {
  type CollectionPlan,
  DASHBOARD_THEME_KIND,
  defaultFacetsFor,
} from "@yunari/renderer-core";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it } from "vitest";
import type { HeldUpdate } from "../components/held-update.js";
import type { InstallControl } from "../store-mode/install-item.js";
import type { StoreItem } from "../store-mode/local-source.js";
import { uiCopy } from "../ui-copy.js";
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
 *  state. The plan's identity must not change, or the sheet re-initializes the
 *  choices the person already made. */
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
      optional: member.optional,
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
  readonly approveMember: string | undefined;
}

/** An install control whose collection press is captured rather than posted. */
function capturingInstall(
  capture: (press: PressCapture) => void,
): InstallControl {
  return {
    onInstall: () => undefined,
    onInstallCollection: (
      item,
      items,
      plan,
      onPlanReplaced,
      onInstalled,
      approveMember,
    ) => {
      capture({ items, approveMember });
    },
    installingIds: new Set(),
    refusal: undefined,
    held: undefined,
    onApproveUpdate: () => undefined,
    onDismissUpdate: () => undefined,
  };
}

it("cannot add a member while a held notice is shown", async () => {
  const held: HeldUpdate = {
    key: "acme/hwinfo",
    name: "HWiNFO bridge",
    publisher: "acme",
    reasons: ["adds usb:device"],
  };
  let press: PressCapture | undefined;
  const base = capturingInstall((it) => {
    press = it;
  });
  const plan = { status: "ready" as const, plan: PLAN };
  const element = (install: InstallControl): ReactElement => (
    <CollectionSheet
      item={collectionItem()}
      plan={plan}
      origins={[]}
      install={install}
      onClose={() => undefined}
    />
  );
  await mount(element(base));

  // Untick the optional widget before the hold exists.
  await act(async () =>
    must(
      document.querySelector<HTMLButtonElement>(
        '[data-yunari-collection-member="clock-widget"] [data-yunari-collection-choice]',
      ),
      "clock choice",
    ).click(),
  );

  await rerender(
    element({
      ...base,
      refusal: {
        id: COLLECTION_ID,
        message: uiCopy.store.install.reviewHeading,
        held,
        memberId: "hwinfo-plugin",
      },
    }),
  );

  const clock = must(
    document.querySelector<HTMLButtonElement>(
      '[data-yunari-collection-member="clock-widget"] [data-yunari-collection-choice]',
    ),
    "clock choice",
  );
  expect(clock.disabled, "a held notice left the choices live").toBe(true);
  await act(async () => clock.click());

  await act(async () =>
    must(
      document.querySelector<HTMLButtonElement>("[data-yunari-held-approve]"),
      "approve control",
    ).click(),
  );
  expect(press?.items).toEqual(["wall-theme", "hwinfo-plugin"]);
  expect(press?.approveMember).toBe("hwinfo-plugin");
});
