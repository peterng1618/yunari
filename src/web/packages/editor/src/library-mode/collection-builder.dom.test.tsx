// @vitest-environment jsdom
/**
 * The collection builder and My submissions: the draft rules, the add control's
 * refusals, the submission's own refusal, and the author's listing beside it.
 *
 * **The transport is injected** so no case touches a network, and the builder is
 * mounted directly with the candidate listings a page would hand it.
 */
import { COLLECTION_PACKAGE_FORMAT } from "@yunari/theme-package";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { StoreItem } from "../store-mode/local-source.js";
import { uiCopy } from "../ui-copy.js";
import {
  CollectionBuilder,
  collectionManifest,
  parseCollectionDraft,
  readCollectionDraft,
  SubmissionsPage,
  selfIncludeRefusal,
} from "./collection-builder.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const FIRST_ID = "3f2a1c9e-8b7d-4c6a-9e0f-1a2b3c4d5e6f";
const SECOND_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const OWN_ID = "5d41402a-bc4b-4c8a-9d0e-2f1a3b4c5d6e";

const FACETS = {
  author: undefined,
  colourMode: "unclassified",
  sensors: [],
  tags: [],
  orientation: "landscape",
  aspect: "16:9",
  width: 1920,
  height: 1080,
} as const;

/** One published catalogue listing, as the builder receives it. */
function listing(
  id: string,
  name: string,
  overrides: Partial<StoreItem> = {},
): StoreItem {
  return {
    id,
    kind: "dashboard-theme",
    name,
    members: [{ id, kind: "dashboard-theme", name }],
    author: undefined,
    version: "1.0.0",
    updatedAt: undefined,
    thumbnailUrl: undefined,
    ground: undefined,
    origin: undefined,
    catalogue: undefined,
    facets: FACETS,
    ...overrides,
  };
}

const FIRST = listing(FIRST_ID, "Rainmeter wall");
const SECOND = listing(SECOND_ID, "Minimal clock");
const DRAFT = {
  name: "Acme Kit",
  description: "Two walls",
  includes: [{ id: FIRST_ID, optional: false }],
};

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
  vi.unstubAllGlobals();
});

async function mount(element: ReturnType<typeof createElement>): Promise<void> {
  await unmount();
  const container = document.createElement("div");
  document.body.append(container);
  host = container;
  root = createRoot(container);
  await act(async () => root?.render(element));
}

/** Four microtask turns: enough for a fetch promise chain to land. */
async function flush(): Promise<void> {
  for (let round = 0; round < 6; round += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function must<T extends Element>(found: T | null, what: string): T {
  if (found === null) throw new Error(`the surface rendered no ${what}`);
  return found;
}

function control(
  container: HTMLElement,
  name: string,
): HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement {
  return must(
    container.querySelector<
      HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement
    >(`[data-yunari-collection-${name}]`),
    name,
  );
}

async function press(button: HTMLButtonElement): Promise<void> {
  await act(async () => button.click());
  await flush();
}

async function type(
  field: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

it("serializes the format the package reader accepts", () => {
  expect(parseCollectionDraft(DRAFT)).toEqual(DRAFT);

  const bytes = collectionManifest({
    name: DRAFT.name,
    description: DRAFT.description,
    includes: DRAFT.includes,
  });
  const text = new TextDecoder().decode(bytes);
  const value = JSON.parse(text) as Record<string, unknown>;

  expect(value["format"]).toBe(COLLECTION_PACKAGE_FORMAT);
  expect(value["version"]).toBe(1);
  expect(value["includes"]).toEqual([{ id: FIRST_ID, optional: false }]);
});

it("refuses a draft with no includes or a duplicate include", () => {
  const empty = readCollectionDraft({
    name: "Kit",
    description: "",
    includes: [],
  });
  expect(empty.ok).toBe(false);
  if (!empty.ok) expect(empty.message).toMatch(/include/);

  const duplicate = readCollectionDraft({
    name: "Kit",
    description: "",
    includes: [{ id: FIRST_ID }, { id: FIRST_ID }],
  });
  expect(duplicate.ok).toBe(false);
  if (!duplicate.ok) expect(duplicate.message).toMatch(/twice/);
});

it("refuses a draft naming its own listing", () => {
  expect(selfIncludeRefusal(DRAFT, OWN_ID)).toBeUndefined();
  expect(selfIncludeRefusal(DRAFT, FIRST_ID)).toMatch(/itself/);
});

it("adds a published listing and marks it optional", async () => {
  await mount(
    createElement(CollectionBuilder, {
      listings: [FIRST, SECOND],
      listingId: OWN_ID,
    }),
  );

  const search = control(document.body, "search");
  expect(search.getAttribute("aria-label")).toBe(
    uiCopy.library.collectionBuilder.search,
  );

  await press(
    must(
      document.body.querySelector<HTMLButtonElement>(
        `[data-yunari-collection-add="${FIRST_ID}"]`,
      ),
      "add control",
    ),
  );

  const row = must(
    document.body.querySelector<HTMLElement>(
      `[data-yunari-collection-include="${FIRST_ID}"]`,
    ),
    "included row",
  );
  expect(row.textContent).toContain(FIRST.name);

  const optional = must(
    document.body.querySelector<HTMLButtonElement>(
      `[data-yunari-collection-optional="${FIRST_ID}"]`,
    ),
    "optional toggle",
  );
  expect(optional.getAttribute("aria-pressed")).toBe("false");
  expect(optional.getAttribute("aria-label")).toBe(
    uiCopy.library.collectionBuilder.optional(FIRST.name),
  );

  await press(optional);
  expect(optional.getAttribute("aria-pressed")).toBe("true");
});

it("says why an unpublished or already added listing cannot be added", async () => {
  const unpublished = listing(SECOND_ID, "Draft wall", {
    status: "unpublished",
  });
  await mount(
    createElement(CollectionBuilder, {
      listings: [FIRST, unpublished],
      listingId: OWN_ID,
    }),
  );

  await press(
    must(
      document.body.querySelector<HTMLButtonElement>(
        `[data-yunari-collection-add="${SECOND_ID}"]`,
      ),
      "unpublished add control",
    ),
  );
  expect(
    must(
      document.body.querySelector<HTMLElement>(
        "[data-yunari-collection-notice]",
      ),
      "notice",
    ).textContent,
  ).toBe(uiCopy.library.collectionBuilder.unpublished(unpublished.name));

  await press(
    must(
      document.body.querySelector<HTMLButtonElement>(
        `[data-yunari-collection-add="${FIRST_ID}"]`,
      ),
      "add control",
    ),
  );
  await press(
    must(
      document.body.querySelector<HTMLButtonElement>(
        `[data-yunari-collection-add="${FIRST_ID}"]`,
      ),
      "add control",
    ),
  );
  expect(
    must(
      document.body.querySelector<HTMLElement>(
        "[data-yunari-collection-notice]",
      ),
      "notice",
    ).textContent,
  ).toBe(uiCopy.library.collectionBuilder.alreadyAdded(FIRST.name));
});

it("reports the owner's refusal sentence beside the draft", async () => {
  const SENTENCE =
    'The collection includes "3f2a1c9e-8b7d-4c6a-9e0f-1a2b3c4d5e6f", which is not a published item.';
  const fetch = vi.fn(async () => json({ ok: false, message: SENTENCE }, 422));
  await mount(
    createElement(CollectionBuilder, {
      listings: [FIRST],
      listingId: OWN_ID,
      fetch: fetch as unknown as typeof fetch,
    }),
  );

  await type(control(document.body, "name") as HTMLInputElement, "Acme Kit");
  await press(
    must(
      document.body.querySelector<HTMLButtonElement>(
        `[data-yunari-collection-add="${FIRST_ID}"]`,
      ),
      "add control",
    ),
  );
  await press(control(document.body, "publish") as HTMLButtonElement);

  // The digest is async, so the host is asked a macrotask after the press.
  await vi.waitFor(() =>
    expect(
      document.body.querySelector<HTMLElement>(
        "[data-yunari-collection-refusal]",
      )?.textContent,
      "the owner's refusal was not drawn",
    ).toBe(SENTENCE),
  );
  expect(
    must(
      document.body.querySelector<HTMLElement>(
        "[data-yunari-collection-refusal]",
      ),
      "refusal",
    ).getAttribute("role"),
  ).toBe("status");
});

it("lists a submitted collection under My submissions", async () => {
  const collection = listing(SECOND_ID, "Acme Kit", {
    kind: "collection",
    members: [],
    includes: [FIRST_ID],
  });
  const entry = {
    id: collection.id,
    kind: collection.kind,
    name: collection.name,
    version: "1.0.0",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
    downloads: 0,
    favorites: 0,
    packageUrl: `https://store.test/catalogue/${collection.id}/1.0.0.zip`,
    thumbnail: `catalogue/${collection.id}/thumbnail.png`,
    members: [],
    includes: [FIRST_ID],
    facets: FACETS,
    status: "published",
  };
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/store/mine")) {
      return json({ entries: [entry] });
    }
    return json({ generatedAt: "2026-11-16T00:00:00.000Z", entries: [] });
  });

  await mount(
    createElement(SubmissionsPage, {
      fetch: fetch as unknown as typeof fetch,
    }),
  );
  await flush();

  const row = must(
    document.body.querySelector<HTMLElement>(
      `[data-yunari-submission="${collection.id}"]`,
    ),
    "submitted collection row",
  );
  expect(row.textContent).toContain("Acme Kit");
});

it("states a failed read instead of claiming nothing was submitted", async () => {
  const fetch = vi.fn(async () => new Response("", { status: 404 }));

  await mount(
    createElement(SubmissionsPage, {
      fetch: fetch as unknown as typeof fetch,
    }),
  );
  await flush();

  expect(document.body.textContent).toContain(
    uiCopy.library.submissionsUnreadable,
  );
  expect(document.body.textContent).not.toContain(uiCopy.store.mine.empty);
});
