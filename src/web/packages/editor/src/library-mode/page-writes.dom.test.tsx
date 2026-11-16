// @vitest-environment jsdom

/**
 * The Library's writes and the re-list each one causes: a collection's install
 * sheet, a held update's approval, the refusals a re-listing answers, the open
 * modal's foot once an install lands, and the origin register a detail open
 * re-reads.
 *
 * The listing itself is `page-listing.dom.test.tsx`'s and the stored-theme
 * commands are `page-commands.dom.test.tsx`'s; each mounts the same harness.
 */
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { uiCopy } from "../ui-copy.js";
import {
  collectionEntry,
  entry,
  FACETS,
  indexOf,
  json,
  LOCAL_THEME,
  mountPage,
  must,
  PLUGIN_ID,
  THEME_A,
  THEME_B,
  unmount,
  waitForCells,
} from "./page-listing-harness.js";

afterEach(async () => {
  await unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

function planMember(id: string, name: string): Record<string, unknown> {
  return {
    id,
    kind: "dashboard-theme",
    name,
    version: "1.0.0",
    bytes: 10,
    publisher: "mira-k",
    optional: false,
  };
}

it("opens a collection's sheet from its card instead of installing it", async () => {
  const installs: unknown[] = [];
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/index.json")) return indexOf([collectionEntry()]);
      if (url.includes("/api/store/origins")) return json({ origins: [] });
      if (url.includes("/api/store/collection/plan")) {
        return json({
          plan: {
            members: [
              planMember(THEME_A, "Catalogue theme"),
              planMember(THEME_B, "Other theme"),
            ],
            missing: [],
            totalBytes: 20,
          },
        });
      }
      if (url.includes("/api/store/install")) {
        installs.push(JSON.parse(String(init?.body)));
        return json({ ok: true, members: [] });
      }
      if (url.includes("/api/themes")) return json({ themes: [] });
      return new Response("", { status: 404 });
    },
  );
  vi.stubGlobal("fetch", fetcher);

  const container = await mountPage("collections", "all");
  await waitForCells(container, ["Ops kit"]);
  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-store-cell-install='install']",
      ),
      "collection install press",
    ).click(),
  );

  // The card asks for the sheet; it never posts an install with no choices.
  expect(installs, "the collection card installed without the sheet").toEqual(
    [],
  );
  const sheet = await vi.waitFor(() =>
    must(
      document.body.querySelector<HTMLElement>(
        "[data-yunari-collection-sheet]",
      ),
      "collection sheet",
    ),
  );
  expect(
    shallMemberCount(sheet),
    "the sheet does not list the collection's members",
  ).toBe(2);

  await act(async () =>
    must(
      document.body.querySelector<HTMLButtonElement>(
        "[data-yunari-collection-sheet-install]",
      ),
      "sheet install press",
    ).click(),
  );

  await vi.waitFor(() => expect(installs).toHaveLength(1));
  expect(
    (installs[0] as { readonly items?: readonly string[] }).items,
    "the sheet posted no chosen ids",
  ).toEqual([THEME_A, THEME_B]);
});

function shallMemberCount(sheet: HTMLElement): number {
  return sheet.querySelectorAll("[data-yunari-collection-member]").length;
}

/** **A held update is not a silent no-op.** The host answers the press with
 *  409 and the growth it held the update for; the page draws that answer, the
 *  approval press re-posts the same item with `approveUpdate`, and a dismissal
 *  leaves the notice standing on nothing. */
it("draws a held update, approves it, and dismisses it", async () => {
  const posts: Record<string, unknown>[] = [];
  const held = {
    key: "acme/panels",
    name: "Acme panels",
    publisher: "acme",
    reasons: ["adds the sensor-provider capability"],
  };
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/index.json")) {
        return indexOf([
          entry(PLUGIN_ID, "Acme panels", {
            kind: "plugin",
            members: [
              { id: "acme-panel", kind: "panel-driver", name: "Acme panel" },
            ],
            facets: { ...FACETS, author: "acme" },
          }),
        ]);
      }
      if (url.includes("/api/extensions")) return json({ extensions: [] });
      if (url.includes("/api/store/install")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        posts.push(body);
        if (body["approveUpdate"] !== true) {
          return new Response(JSON.stringify({ ok: false, held }), {
            status: 409,
          });
        }
        return json({ ok: true });
      }
      return new Response("", { status: 404 });
    },
  );
  vi.stubGlobal("fetch", fetcher);

  const container = await mountPage("panel-drivers", "all");
  await waitForCells(container, ["Acme panels"]);

  const press = (): void =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-store-cell-install='install']",
      ),
      "plugin install press",
    ).click();
  const notice = (): Element | null =>
    container.querySelector("[data-yunari-held-update]");

  await act(async () => press());
  await vi.waitFor(() =>
    expect(notice(), "a held update drew no notice").not.toBeNull(),
  );
  expect(
    notice()?.textContent,
    "the notice does not name the growth that held the update",
  ).toContain("sensor-provider capability");
  expect(
    posts[0]?.["approveUpdate"],
    "the first press already asked for approval",
  ).toBeUndefined();

  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>("[data-yunari-held-dismiss]"),
      "held dismiss",
    ).click(),
  );
  expect(notice(), "dismissing the notice left it standing").toBeNull();

  await act(async () => press());
  await vi.waitFor(() => expect(notice()).not.toBeNull());
  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>("[data-yunari-held-approve]"),
      "held approve",
    ).click(),
  );

  await vi.waitFor(() => expect(posts).toHaveLength(3));
  expect(
    posts[2]?.["approveUpdate"],
    "the approval press did not ask the host to approve",
  ).toBe(true);
  await vi.waitFor(() =>
    expect(notice(), "the notice stayed after the update landed").toBeNull(),
  );
});

it("states the refusals a re-listing answered instead of clearing them", async () => {
  let indexReads = 0;
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/index.json")) {
      indexReads += 1;
      return indexReads === 1
        ? indexOf([entry(THEME_A, "Catalogue theme")])
        : indexOf([
            entry(THEME_A, "Catalogue theme"),
            { id: THEME_B, kind: "future-thing", name: "Future" },
          ]);
    }
    if (url.includes("/api/store/install")) return json({ ok: true });
    if (url.includes("/api/themes")) return json({ themes: [] });
    return new Response("", { status: 404 });
  });
  vi.stubGlobal("fetch", fetcher);

  const container = await mountPage("dashboard-themes", "all");
  await waitForCells(container, ["Catalogue theme"]);
  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-store-cell-install='install']",
      ),
      "install press",
    ).click(),
  );

  await vi.waitFor(() =>
    expect(
      [...container.querySelectorAll("[data-yunari-library-refusal]")].map(
        (line) => line.textContent?.trim(),
      ),
      "the re-listing's refusal was cleared with the old rows",
    ).toEqual([uiCopy.store.catalogueRefused("future-thing", 1)]),
  );
});

it("redraws an open modal's foot once an install lands", async () => {
  let themeReads = 0;
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/index.json")) {
      return indexOf([entry(THEME_A, "Catalogue theme")]);
    }
    if (url.includes("/api/store/install")) return json({ ok: true });
    if (url.includes("/api/themes")) {
      themeReads += 1;
      return themeReads === 1
        ? json({ themes: [] })
        : json({
            themes: [
              {
                id: "installed-copy",
                name: "Installed copy",
                origin: {
                  kind: "dashboard-theme",
                  catalogueId: THEME_A,
                  version: "1.0.0",
                  installedAt: "2026-10-01T00:00:00.000Z",
                },
                facets: FACETS,
              },
            ],
          });
    }
    return new Response("", { status: 404 });
  });
  vi.stubGlobal("fetch", fetcher);

  const container = await mountPage("dashboard-themes", "all");
  await waitForCells(container, ["Catalogue theme"]);
  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-store-cell-name-press]",
      ),
      "card press",
    ).click(),
  );
  await vi.waitFor(() =>
    must(
      document.body.querySelector<HTMLButtonElement>(
        "#yunari-store-item-install",
      ),
      "modal install press",
    ),
  );
  await act(async () =>
    must(
      document.body.querySelector<HTMLButtonElement>(
        "#yunari-store-item-install",
      ),
      "modal install press",
    ).click(),
  );

  await vi.waitFor(() =>
    expect(
      document.body
        .querySelector("[data-yunari-store-item-install]")
        ?.getAttribute("data-yunari-store-item-install"),
      "the open modal still reads Install after the install landed",
    ).toBe("installed"),
  );
  expect(
    document.body.querySelector("#yunari-store-item-install"),
    "the modal kept a live Install control, so a second press could write again",
  ).toBeNull();
});

/** **The register is re-read on every detail open.** A collection reached from
 *  another page is classified against it, and an install made since the last
 *  open would otherwise leave the old count on screen. */
it("re-reads the origin register on every detail open", async () => {
  let originReads = 0;
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/index.json")) return indexOf([]);
    if (url.includes("/api/store/origins")) {
      originReads += 1;
      return json({ origins: [] });
    }
    if (url.includes("/api/themes")) {
      return json({
        themes: [{ id: LOCAL_THEME, name: "Local theme", facets: FACETS }],
      });
    }
    return new Response("", { status: 404 });
  });
  vi.stubGlobal("fetch", fetcher);

  const container = await mountPage("dashboard-themes", "all");
  await waitForCells(container, ["Local theme"]);

  for (let open = 1; open <= 2; open += 1) {
    await act(async () =>
      must(
        container.querySelector<HTMLButtonElement>(
          "[data-yunari-store-cell-name-press]",
        ),
        "card press",
      ).click(),
    );
    await vi.waitFor(() =>
      expect(
        document.body.querySelector("[data-yunari-store-item]"),
      ).not.toBeNull(),
    );
    await act(async () =>
      must(
        document.body.querySelector<HTMLButtonElement>(
          "[data-yunari-store-item-close]",
        ),
        "close control",
      ).click(),
    );
    await vi.waitFor(() =>
      expect(
        document.body.querySelector("[data-yunari-store-item]"),
      ).toBeNull(),
    );
  }

  expect(
    originReads,
    "a second detail open reused the stale register",
  ).toBeGreaterThanOrEqual(2);
});
