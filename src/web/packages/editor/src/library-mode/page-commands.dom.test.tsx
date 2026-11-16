// @vitest-environment jsdom

/**
 * The Library's Dashboard themes page commands: the three stored-theme actions
 * the retired store region owned (Assign, Export, Delete), the submission the
 * gallery's Publish press posts, the commands a kind's table does not offer,
 * and the extension removal a code member's Remove runs.
 *
 * The page that replaced the retired region must keep them: these cases press
 * the cell's own controls and read the host call each one makes, so a page that
 * drew the controls but wired none of them fails here.
 */
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  answering,
  cells,
  commandClient,
  entry,
  FACETS,
  indexOf,
  json,
  LOCAL_THEME,
  localThemeServing,
  mountPage,
  must,
  submitServing,
  THEME_A,
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

it("assigns a Dashboard theme from its cell", async () => {
  vi.stubGlobal("fetch", answering(localThemeServing()));
  const commands = commandClient();
  const container = await mountPage("dashboard-themes", "all", commands.client);
  await waitForCells(container, ["Local theme"]);

  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-store-cell-action='assign']",
      ),
      "assign action",
    ).click(),
  );

  // The choice is the host's list, read when the dialog opens: the dialog is
  // the owner the retired region used, and it is the one that writes.
  await vi.waitFor(() =>
    expect(
      document.body.querySelector("[data-yunari-store-assign-form]"),
      "the assign press opened no display choice",
    ).not.toBeNull(),
  );
  expect(commands.listDisplays).toHaveBeenCalled();
});

it("exports a Dashboard theme through the host's own package writer", async () => {
  vi.stubGlobal("fetch", answering(localThemeServing()));
  const createObjectURL = vi.fn(() => "blob:theme");
  const revokeObjectURL = vi.fn();
  Object.assign(URL, { createObjectURL, revokeObjectURL });
  const downloaded = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => undefined);
  const commands = commandClient();
  const container = await mountPage("dashboard-themes", "all", commands.client);
  await waitForCells(container, ["Local theme"]);

  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-store-cell-action='export']",
      ),
      "export action",
    ).click(),
  );

  await vi.waitFor(() =>
    expect(commands.open).toHaveBeenCalledWith(LOCAL_THEME),
  );
  await vi.waitFor(() => expect(downloaded).toHaveBeenCalledTimes(1));
  expect(
    (downloaded.mock.instances[0] as unknown as HTMLAnchorElement).download,
    "the export did not name the package after the theme",
  ).toMatch(/\.yunari-theme$/);
});

it("publishes from the gallery's own Publish press", async () => {
  const serving = submitServing();
  vi.stubGlobal("fetch", serving.fetcher);
  const commands = commandClient();
  const container = await mountPage("dashboard-themes", "all", commands.client);
  await waitForCells(container, ["Local theme"]);

  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-store-cell-action='publish']",
      ),
      "publish action",
    ).click(),
  );

  await vi.waitFor(() =>
    expect(serving.submits, "the Publish press posted no submission").toEqual([
      { id: LOCAL_THEME },
    ]),
  );
});

it("announces a landed submission in the page's live region", async () => {
  const serving = submitServing();
  vi.stubGlobal("fetch", serving.fetcher);
  const commands = commandClient();
  const container = await mountPage("dashboard-themes", "all", commands.client);
  await waitForCells(container, ["Local theme"]);

  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-store-cell-action='publish']",
      ),
      "publish action",
    ).click(),
  );

  await vi.waitFor(() =>
    expect(
      must(
        container.querySelector("[data-yunari-library-install-announcement]"),
        "install announcement live region",
      ).textContent,
      "the landed submission never reached the live region",
    ).toContain("Local theme: Submitted and listed."),
  );
});

it("deletes a Dashboard theme only after the confirmation", async () => {
  vi.stubGlobal("fetch", answering(localThemeServing()));
  const commands = commandClient();
  const themeRemoved = vi.fn();
  const container = await mountPage(
    "dashboard-themes",
    "all",
    commands.client,
    themeRemoved,
  );
  await waitForCells(container, ["Local theme"]);

  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-store-cell-action='delete']",
      ),
      "delete action",
    ).click(),
  );
  const confirm = await vi.waitFor(() =>
    must(
      document.body.querySelector<HTMLButtonElement>(
        "[data-yunari-library-delete-confirm]",
      ),
      "delete confirmation",
    ),
  );
  expect(commands.remove).not.toHaveBeenCalled();

  await act(async () => confirm.click());

  await vi.waitFor(() =>
    expect(commands.remove).toHaveBeenCalledWith(LOCAL_THEME),
  );
  // The session hears it, so the open document's stored base is cleared and the
  // next save does not trust a folder the host trashed.
  expect(
    themeRemoved,
    "the removal did not reach the session",
  ).toHaveBeenCalledWith(LOCAL_THEME);
  await vi.waitFor(() =>
    expect(cells(container), "the deleted theme is still drawn").toEqual([]),
  );
});

/** **R27: a control with no route is drawn disabled and says why.** App themes
 *  live at `/api/editor-themes/:id` and a panel driver is not a theme at all, so
 *  neither may reach the dashboard-theme client — and neither may present a
 *  live button that falls to a notice. */
it("disables a kind's unrouted commands with a stated reason", async () => {
  const commands = commandClient();
  vi.stubGlobal("fetch", answering(localThemeServing()));
  const appThemes = await mountPage("app-themes", "all", commands.client);
  await waitForCells(appThemes, ["Office"]);

  for (const action of ["export", "delete"] as const) {
    const control = must(
      appThemes.querySelector<HTMLButtonElement>(
        `[data-yunari-store-cell-action='${action}']`,
      ),
      `${action} action`,
    );
    expect(
      control.disabled,
      `an app theme's ${action} is live, though the host has no route for it`,
    ).toBe(true);
    expect(
      document.body.querySelector(`#${control.id}-reason`)?.textContent?.trim(),
      `an app theme's ${action} states no reason`,
    ).not.toBe("");
  }
  expect(
    appThemes.querySelector(
      "[data-yunari-store-cell-action='open'], [data-yunari-store-cell-action='assign']",
    ),
    "an app theme draws an action its kind's table does not offer",
  ).toBeNull();
  expect(
    commands.open,
    "an editor theme's export called the dashboard-theme client",
  ).not.toHaveBeenCalled();
  expect(
    commands.remove,
    "an editor theme's delete called the dashboard-theme client",
  ).not.toHaveBeenCalled();
  expect(
    document.body.querySelector("[data-yunari-library-delete-dialog]"),
    "an editor theme's delete opened the dashboard-theme removal",
  ).toBeNull();

  // A panel driver is equipment, not a theme: it draws none of the four theme
  // commands, so Assign cannot reach the display register from its cell.
  const drivers = await mountPage("panel-drivers", "all");
  await waitForCells(drivers, ["Acme panels"]);
  expect(
    drivers.querySelector("[data-yunari-store-cell-action='assign']"),
    "a panel driver's cell draws a theme Assign",
  ).toBeNull();
  expect(
    commands.listDisplays,
    "a panel driver's cell read the display register",
  ).not.toHaveBeenCalled();
});

it("keeps the four theme commands on an installed catalogue theme", async () => {
  vi.stubGlobal(
    "fetch",
    answering([
      ["/index.json", () => indexOf([entry(THEME_A, "Catalogue theme")])],
      [
        "/api/themes",
        () =>
          json({
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
          }),
      ],
    ]),
  );
  const container = await mountPage("dashboard-themes", "all");
  await waitForCells(container, ["Catalogue theme"]);

  for (const action of ["open", "assign", "export", "delete"] as const) {
    expect(
      container.querySelector(
        `[data-yunari-store-cell='${THEME_A}'] [data-yunari-store-cell-action='${action}']`,
      ),
      `an installed catalogue theme lost its ${action} command`,
    ).not.toBeNull();
  }
});

/**
 * **A path-preset pack is removed by the pack id its stored rows name**, not by
 * the joined preset id. The pack card is drawn, but it carries no Remove of its
 * own: the pack's detail surface is where the press is made, and the route it
 * reaches must be the pack's.
 */
it("removes a path-preset pack through its pack id", async () => {
  const PACK_CATALOGUE = "77777777-7777-4777-8777-777777777777";
  const calls: { readonly url: string; readonly method: string }[] = [];
  const base = answering([
    [
      "/index.json",
      () =>
        indexOf([
          entry(PACK_CATALOGUE, "Rounded set", {
            kind: "path-preset-pack",
            members: [{ id: "pill", kind: "shape", name: "Pill" }],
          }),
        ]),
    ],
    [
      "/api/path-presets",
      () =>
        json({
          presets: [
            {
              id: "pack:pack-one:pill",
              label: "Pill",
              data: "M 0 0 L 10 10",
              paint: "stroke",
              origin: {
                kind: "path-preset-pack",
                catalogueId: PACK_CATALOGUE,
                version: "1.0.0",
                installedAt: "2026-10-01T00:00:00.000Z",
              },
            },
          ],
        }),
    ],
  ]);
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? "GET" });
      if (init?.method === "DELETE") return json({ ok: true });
      return base(input, init);
    },
  );
  vi.stubGlobal("fetch", fetcher as unknown as typeof fetch);

  const container = await mountPage("shapes", "all");
  await waitForCells(container, ["Rounded set"]);
  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-store-cell-name-press]",
      ),
      "card press",
    ).click(),
  );
  await act(async () =>
    must(
      document.body.querySelector<HTMLButtonElement>(
        '[data-yunari-store-item-action="remove"]',
      ),
      "footer Remove",
    ).click(),
  );

  await vi.waitFor(() =>
    expect(
      calls.find((call) => call.method === "DELETE")?.url,
      "Remove did not reach the pack's own route",
    ).toBe("/api/path-presets/packs/pack-one"),
  );
});

/**
 * **R27: a live per-kind command runs through its route.** A code member's
 *  Remove is the host's extension DELETE, named by the installed copy's own
 *  key; the press re-lists so the row leaves because the host no longer serves
 *  it. */
it("removes an installed extension through the route its kind owns", async () => {
  const calls: { readonly url: string; readonly method: string }[] = [];
  const base = answering(localThemeServing());
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
      });
      if (init?.method === "DELETE") return json({ ok: true });
      return base(input, init);
    },
  );
  vi.stubGlobal("fetch", fetcher as unknown as typeof fetch);

  const container = await mountPage("panel-drivers", "all");
  await waitForCells(container, ["Acme panels"]);
  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-store-cell-name-press]",
      ),
      "card press",
    ).click(),
  );

  // The member's own kind decides the commands: Assign and Device status have
  // no route this build runs, so only Remove is live.
  await act(async () =>
    must(
      document.body.querySelector<HTMLButtonElement>(
        '[data-yunari-store-item-action="remove"]',
      ),
      "footer Remove",
    ).click(),
  );

  await vi.waitFor(() =>
    expect(
      calls.find((call) => call.method === "DELETE")?.url,
      "Remove did not reach the host's extension route",
    ).toBe("/api/extensions/acme/panels"),
  );
});
