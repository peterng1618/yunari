// @vitest-environment jsdom
/**
 * The chooser's React entry: the display column, the theme rows and the two
 * writes a consumer makes.
 *
 * **What this file owns.** That the rows are the ones the host's own map
 * describes, that the chosen theme is marked and named, that a press writes the
 * display and theme the row stands for and reloads, and that a refusal or a
 * failed removal reaches the person in the host's own words. The layout and the
 * picture are not measured here: jsdom paints nothing.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it } from "vitest";
import { Chooser } from "./chooser.js";
import type { ChooserClient, ChooserData } from "./client.js";
import { costWarning } from "./theme-row.js";

beforeAll(() => {
  // React 19 reads this global in a test environment; without it every `act`
  // warns and the render is reported as untracked.
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no modal dialog. The component falls back to the `open`
  // attribute, which is enough to press its buttons.
  const proto = window.HTMLDialogElement?.prototype;
  if (proto !== undefined && typeof proto.showModal !== "function") {
    proto.showModal = function showModal(this: HTMLDialogElement): void {
      this.setAttribute("open", "");
    };
  }
});

const DATA: ChooserData = {
  default: "living-room",
  displays: [{ id: "this-pc", label: "Host", kind: "local", theme: null }],
  templates: [{ id: "starter", name: "Starter" }],
  themes: [
    { id: "living-room", name: "Living Room", thumbnail: true },
    {
      id: "attic-wall",
      name: "Attic Wall",
      costs: ["video-background"],
    },
  ],
};

interface Calls {
  readonly chosen: [string, string][];
  readonly removed: string[];
  reloaded: number;
}

function fake(
  overrides: Partial<ChooserClient> & { data?: ChooserData } = {},
): { client: ChooserClient; calls: Calls } {
  const calls: Calls = { chosen: [], removed: [], reloaded: 0 };
  return {
    calls,
    client: {
      read: async () => overrides.data ?? DATA,
      choose: async (display, id) => {
        calls.chosen.push([display, id]);
      },
      remove: async (id) => {
        calls.removed.push(id);
      },
      ...overrides,
    },
  };
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function mount(
  client: ChooserClient,
  reload = (): void => undefined,
): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const mounted = container;
  await act(async () => {
    root?.render(<Chooser client={client} reload={reload} />);
  });
  return mounted;
}

afterEach(async () => {
  if (root !== undefined) {
    const current = root;
    await act(async () => current.unmount());
  }
  root = undefined;
  container?.remove();
  container = undefined;
});

it("draws the default first, then every display the host holds", async () => {
  const { client } = fake();
  const page = await mount(client);

  const rows = page.querySelectorAll<HTMLElement>("#themes [data-display]");
  expect(rows).toHaveLength(2);
  expect(rows[0]?.dataset["display"]).toBe("default");
  expect(rows[0]?.getAttribute("aria-pressed")).toBe("true");
  expect(rows[0]?.textContent).toContain("Living Room");
  expect(rows[1]?.dataset["display"]).toBe("this-pc");
  expect(rows[1]?.textContent).toContain("Host");
  expect(rows[1]?.textContent).toContain("Uses the default");
});

it("marks and names the theme the chosen display shows", async () => {
  const { client } = fake();
  const page = await mount(client);

  const current = page.querySelector<HTMLElement>(
    'button.theme-option[data-theme="living-room"]',
  );
  expect(current?.getAttribute("aria-pressed")).toBe("true");
  expect(current?.querySelector(".current")?.textContent).toBe("Showing");

  const editor = page.querySelector<HTMLAnchorElement>("#editor-link");
  expect(editor?.getAttribute("href")).toBe("/editor/?theme=living-room");
});

it("chooses for the display row that was pressed and reloads", async () => {
  const { client, calls } = fake();
  let reloaded = 0;
  const page = await mount(client, () => {
    reloaded += 1;
  });

  await act(async () => {
    page
      .querySelector<HTMLElement>('#themes [data-display="this-pc"]')
      ?.click();
  });
  await act(async () => {
    page
      .querySelector<HTMLElement>(
        'button.theme-option[data-theme="attic-wall"]',
      )
      ?.click();
  });

  expect(calls.chosen).toEqual([["this-pc", "attic-wall"]]);
  expect(reloaded).toBe(1);
});

it("reports a refused write and does not reload", async () => {
  const { client } = fake({
    choose: async () => {
      throw new Error("This display is not paired with the host.");
    },
  });
  let reloaded = 0;
  const page = await mount(client, () => {
    reloaded += 1;
  });

  await act(async () => {
    page
      .querySelector<HTMLElement>(
        'button.theme-option[data-theme="attic-wall"]',
      )
      ?.click();
  });

  expect(page.querySelector("#status")?.textContent).toBe(
    "Could not save: This display is not paired with the host.",
  );
  expect(reloaded).toBe(0);
});

it("removes a theme only after the confirmation, and drops its row", async () => {
  const { client, calls } = fake();
  const page = await mount(client);

  await act(async () => {
    page
      .querySelector<HTMLElement>(
        'button.theme-delete[aria-label="Delete Living Room — moved to the recycle bin"]',
      )
      ?.click();
  });

  const confirm = page.querySelector<HTMLDialogElement>("dialog.theme-confirm");
  expect(confirm).not.toBeNull();
  expect(confirm?.getAttribute("aria-label")).toContain("recycle bin");

  await act(async () => {
    page.querySelector<HTMLElement>("[data-theme-delete-yes]")?.click();
  });

  expect(calls.removed).toEqual(["living-room"]);
  expect(
    page.querySelector('button.theme-option[data-theme="living-room"]'),
  ).toBeNull();
});

it("keeps the row and says why a removal was refused", async () => {
  const { client } = fake({
    remove: async () => {
      throw new Error("No trash command is available on this PC.");
    },
  });
  const page = await mount(client);

  await act(async () => {
    page.querySelector<HTMLElement>("button.theme-delete")?.click();
  });
  await act(async () => {
    page.querySelector<HTMLElement>("[data-theme-delete-yes]")?.click();
  });

  expect(
    page.querySelector('button.theme-option[data-theme="living-room"]'),
  ).not.toBeNull();
  expect(page.querySelector(".theme-delete-note")?.textContent).toBe(
    "No trash command is available on this PC.",
  );
  expect(
    page
      .querySelector<HTMLButtonElement>("button.theme-delete")
      ?.getAttribute("data-yunari-control-state"),
    "a refused removal does not carry the shared failure state",
  ).toBe("failure");
});

it("says what a theme costs the display it is being given to", () => {
  // A video background costs a host monitor, and a paired display is told
  // nothing: a phone showing video is doing what a phone does.
  expect(costWarning("paired", ["video-background"])).toBeUndefined();
  expect(costWarning("local", ["video-background"])).toContain(
    "never lets a host monitor idle",
  );
});
