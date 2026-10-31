// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { costWarning, deleteTheme, themeList } from "../public/theme-list.js";

/** The chooser at `/` and the settings page both list saved themes, so the row
 * is drawn once here. A chooser that drew its own would be the second copy of
 * the thumbnail, the hatched stand-in and the duplicated-name disambiguation. */

/** Both carry a picture, which is what the listing says when one exists. */
const THEMES = [
  { id: "living-room", name: "Living Room", thumbnail: true },
  { id: "studio", name: "Studio", thumbnail: true },
];

/** Every row is choosable, so the tests pass a handler they never call. */
const onChoose = (): void => undefined;

function mount(frag: DocumentFragment): HTMLElement {
  const host = document.createElement("div");
  host.append(frag);
  document.body.replaceChildren(host);
  return host;
}

/** The shape the removal reads off a response: the status, and the host's
 *  own words when it refused. */
const jsonResponse = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

const realFetch = globalThis.fetch;

/** jsdom has no `<dialog>`, so this stands in for the two methods the code
    calls. `close` is guarded so a real browser's close, which fires the event
    the code also listens for, cannot re-enter. */
function showModal(): void {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: {
    open: boolean;
    setAttribute(name: string, value: string): void;
  }) {
    this.open = true;
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function close(
    this: { returnValue: string; dispatchEvent(event: Event): boolean },
    returnValue = "",
  ) {
    if (this.returnValue === returnValue) return;
    this.returnValue = returnValue;
    this.dispatchEvent(new Event("close"));
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("a saved theme as one row", () => {
  it("asks for each theme's picture", () => {
    const host = mount(themeList(THEMES, { onChoose }));
    const shots = [
      ...host.querySelectorAll<HTMLImageElement>("img.theme-shot"),
    ];

    expect(shots.map((shot) => shot.getAttribute("src"))).toEqual([
      "/api/themes/living-room/thumbnail",
      "/api/themes/studio/thumbnail",
    ]);
    // The name beside it is the theme's; the picture adds nothing for a reader.
    expect(shots.every((shot) => shot.alt === "")).toBe(true);
  });

  it("draws the stand-in without asking when the listing has no picture", () => {
    // A theme saved before pictures existed has none, and the listing says so:
    // asking anyway logged a 404 per theme on every clean load, which is the
    // noise that hides a real missing asset.
    const host = mount(
      themeList([{ id: "studio", name: "Studio" }], { onChoose }),
    );

    expect(host.querySelectorAll("img.theme-shot")).toHaveLength(0);
    expect(host.querySelector("[data-placeholder]")).not.toBeNull();
  });

  it("tells two themes that share a name apart by their id", () => {
    const host = mount(
      themeList(
        [
          { id: "studio", name: "Studio" },
          { id: "studio-annexe", name: "Studio" },
        ],
        { onChoose },
      ),
    );
    // Scoped to the theme rows: the display column is drawn from the same
    // name-and-note element, so an unscoped read would collect its rows too.
    const names = [...host.querySelectorAll("[data-theme] .theme-text")].map(
      (text) => text.textContent,
    );

    expect(names).toEqual(["Studio (studio)", "Studio (studio-annexe)"]);
  });

  it("states the chosen theme in words, not by a border alone", () => {
    const host = mount(themeList(THEMES, { default: "studio", onChoose }));
    const rows = [...host.querySelectorAll("button[data-theme]")];

    expect(rows.map((row) => row.getAttribute("aria-pressed"))).toEqual([
      "false",
      "true",
    ]);
    expect(rows[1]?.querySelector(".current")?.textContent).toBe("Showing");
  });

  it("names each row only once, so a screen reader reads a theme once", () => {
    const host = mount(themeList(THEMES, { onChoose }));
    const labels = [...host.querySelectorAll("button[data-theme]")].map(
      (row) => row.textContent,
    );

    expect(labels).toEqual(["Living Room", "Studio"]);
  });

  /** Changing a saved theme was impossible: the row chose which theme the
   * displays show, and nothing anywhere else opened one for editing. A save
   * was a place a theme could be put and never read back from. */
  describe("editing a theme, beside the control that displays it", () => {
    it("offers an edit link carrying that theme's id", () => {
      const host = mount(themeList(THEMES, { onChoose }));
      const edits = [
        ...host.querySelectorAll<HTMLAnchorElement>(".theme-edit"),
      ];

      expect(edits.map((edit) => edit.getAttribute("href"))).toEqual([
        "/editor/?theme=living-room",
        "/editor/?theme=studio",
      ]);
    });

    it("names the theme each link edits, because the word alone does not", () => {
      const host = mount(themeList(THEMES, { onChoose }));
      const names = [...host.querySelectorAll(".theme-edit")].map((edit) =>
        edit.getAttribute("aria-label"),
      );

      // Read in a list of links, six identical "Edit"s name nothing; the
      // visible "Edit" stays inside the name so the two agree.
      expect(names).toEqual([
        "Edit Living Room in the editor",
        "Edit Studio in the editor",
      ]);
      expect(
        [...host.querySelectorAll(".theme-edit")].every((edit) =>
          (edit.getAttribute("aria-label") ?? "").startsWith(
            edit.textContent ?? "",
          ),
        ),
      ).toBe(true);
    });

    it("keeps the edit link outside the button, so it is a link and not a label", () => {
      const host = mount(themeList(THEMES, { onChoose }));
      const row = host.querySelector("[data-theme='living-room']");

      // A link nested in a button cannot be focused or followed on its own:
      // the pointer goes to the button, and the keyboard has one stop that
      // chooses the theme rather than editing it.
      expect(row?.closest(".theme-edit")).toBeNull();
      expect(
        host.querySelector(".theme-row [data-theme] + .theme-edit"),
      ).not.toBeNull();
    });

    it("leaves the consumer's choice working, beside the new link", () => {
      const chosen = vi.fn();
      const host = mount(themeList(THEMES, { onChoose: chosen }));
      host
        .querySelector<HTMLButtonElement>("[data-theme='studio']")
        ?.dispatchEvent(new Event("click"));

      // The display comes first: a theme is given *to* a display, and the
      // default is what the page opens on.
      expect(chosen).toHaveBeenCalledWith("default", "studio");
    });
  });

  describe("the display column above the rows", () => {
    const DISPLAYS = [
      { id: "this-pc", label: "This PC", kind: "local", theme: "studio" },
      {
        id: "kitchen-tablet",
        label: "Kitchen tablet",
        kind: "paired",
        theme: null,
      },
    ];

    const column = (): HTMLElement =>
      mount(
        themeList(THEMES, {
          displays: DISPLAYS,
          default: "living-room",
          onChoose,
        }),
      );

    it("leads with the default, then one row per display", () => {
      const rows = [...column().querySelectorAll("[data-display]")];

      expect(rows.map((row) => row.getAttribute("data-display"))).toEqual([
        "default",
        "this-pc",
        "kitchen-tablet",
      ]);
      expect(rows.map((row) => row.textContent)).toEqual([
        "DefaultLiving Room",
        "This PCStudio",
        "Kitchen tabletUses the default",
      ]);
    });

    it("marks the display the rows are being chosen for, and no other", () => {
      const host = mount(
        themeList(THEMES, {
          displays: DISPLAYS,
          default: "living-room",
          selected: "this-pc",
          onChoose,
        }),
      );

      // A display with no entry of its own is served the default, so the theme
      // rows are marked for what the chosen display actually shows.
      expect(
        [...host.querySelectorAll<HTMLElement>("[data-display]")].map((row) =>
          row.getAttribute("aria-pressed"),
        ),
      ).toEqual(["false", "true", "false"]);
      expect(
        host
          .querySelector("[data-theme='studio']")
          ?.getAttribute("aria-pressed"),
      ).toBe("true");
    });

    it("reports the row that was pressed, so the page can re-render for it", () => {
      const pressed = vi.fn();
      const host = mount(
        themeList(THEMES, {
          displays: DISPLAYS,
          default: "living-room",
          onSelect: pressed,
          onChoose,
        }),
      );
      host
        .querySelector<HTMLButtonElement>("[data-display='kitchen-tablet']")
        ?.dispatchEvent(new Event("click"));

      expect(pressed).toHaveBeenCalledWith("kitchen-tablet");
    });
  });
});

const TEMPLATES = [
  { id: "yunari-starter-template", name: "Starter — System dashboard" },
];

/** A template is not a stored theme, so it is offered beside the stored ones
 *  and never inside the count of what this PC has saved. */
describe("a template the product ships, beside the saved themes", () => {
  const withTemplate = (): HTMLElement =>
    mount(themeList(THEMES, { onChoose, templates: TEMPLATES }));

  it("lists the template, and says which kind of row it is", () => {
    const host = withTemplate();
    const groups = [...host.querySelectorAll(".theme-group-label")].map(
      (label) => label.textContent,
    );

    expect(groups).toEqual(["Displays", "Templates", "Your themes"]);
    // Two kinds of thing in one list, so the row says which it is rather than
    // letting a template read as a theme the author saved.
    expect(host.querySelector("[data-template]")?.textContent).toContain(
      "Starter — System dashboard",
    );
  });

  it("takes the consumer to the editor, because that is where a template lives", () => {
    const row = withTemplate().querySelector("[data-template]");

    // A template is not stored, so it cannot be chosen as the active theme;
    // the only honest action is to open it. An anchor is focusable and follows
    // the link, so the row needs no key handler of its own.
    expect(row?.tagName).toBe("A");
    expect(row?.getAttribute("href")).toBe("/editor/");
    // A screen reader reads the link's purpose from its name, not from where
    // the pointer is, so the row has to say where it goes.
    expect(row?.textContent).toContain("Opens in the editor");
  });

  it("asks for no picture, because a template has none to serve", () => {
    const host = withTemplate();

    // A thumbnail route is keyed by theme id and a template is not stored, so
    // asking for one is a 404 — a console error on a clean page load, which is
    // the failure a favicon link exists to remove. The reserved space is drawn
    // directly instead.
    expect(host.querySelectorAll("img")).toHaveLength(THEMES.length);
    expect(
      host.querySelector("[data-template] [data-placeholder]"),
    ).not.toBeNull();
  });

  it("draws no template group when the product ships none", () => {
    const host = mount(themeList(THEMES, { onChoose }));
    const groups = [...host.querySelectorAll(".theme-group-label")].map(
      (label) => label.textContent,
    );

    // The column's own heading stays: it separates the displays from the
    // choices below them whatever the product ships.
    expect(groups).toEqual(["Displays", "Your themes"]);
    expect(host.querySelector("[data-template]")).toBeNull();
  });

  /** The starter is the product's, not the author's, so there is nothing of
   *  theirs behind it to remove — and offering a Delete that moves nothing
   *  would be a control that lies. */
  it("takes no Delete, because it is not the author's to remove", () => {
    // Built with a removal available, so a Delete on the starter row would be
    // a control that appears and moves nothing.
    const host = mount(
      themeList(THEMES, {
        onChoose,
        onDelete: deleteTheme,
        templates: TEMPLATES,
      }),
    );

    expect(
      host.querySelector("[data-template]")?.closest(".theme-row"),
    ).toBeNull();
    // One per saved theme, and none on the template.
    expect(host.querySelectorAll(".theme-delete")).toHaveLength(THEMES.length);
  });
});

/** Deleting a saved theme was impossible from either host page: the rows
 *  offered "choose this" and "edit this" and nothing else, so an author who
 *  had been iterating kept every experiment they had ever made. The mechanism
 *  exists (`DELETE /api/themes/:id`, loopback only, moves the folder to the OS
 *  trash); no surface called it. */
describe("removing a saved theme from a host page", () => {
  const deleting = (): HTMLElement =>
    mount(themeList(THEMES, { onChoose, onDelete: deleteTheme }));

  const confirmOf = (): HTMLDialogElement => {
    const dialog = [...document.querySelectorAll("dialog")].at(-1);
    if (dialog === undefined) throw new Error("no confirmation appeared");
    return dialog;
  };

  /** Press Delete on a row and answer the confirmation, the way a person
   *  does: the dialog opens, then one of its two buttons is pressed. */
  const confirm = async (id: string, answer: "yes" | "no"): Promise<void> => {
    const row = document.querySelector(`[data-theme='${id}']`);
    row
      ?.closest(".theme-row")
      ?.querySelector<HTMLButtonElement>(".theme-delete")
      ?.click();
    await Promise.resolve();
    confirmOf()
      .querySelector<HTMLButtonElement>(
        answer === "yes" ? "[data-theme-delete-yes]" : "[data-theme-delete-no]",
      )
      ?.click();
    // The request the confirmation gates is awaited before the row is touched.
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  };

  beforeEach(() => {
    showModal();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("offers a Delete beside the row, beside Edit rather than instead of it", () => {
    const host = deleting();
    const wrapper = host
      .querySelector("[data-theme='living-room']")
      ?.closest(".theme-row");

    // Sitting beside Open and Edit: a row a person cannot get rid of is an
    // experiment they can never clear away, and the row itself still chooses.
    expect(
      wrapper?.querySelector<HTMLButtonElement>(".theme-delete")?.textContent,
    ).toBe("Delete");
    expect(wrapper?.querySelector(".theme-edit")).not.toBeNull();
    expect(wrapper?.querySelector("[data-theme]")).not.toBeNull();
  });

  it("names the theme it would remove, because the word alone does not", () => {
    const host = deleting();
    const labels = [...host.querySelectorAll(".theme-delete")].map((remove) =>
      remove.getAttribute("aria-label"),
    );

    // Read in a list of controls, two identical "Delete"s name nothing.
    expect(labels).toEqual([
      "Delete Living Room — moved to the recycle bin",
      "Delete Studio — moved to the recycle bin",
    ]);
  });

  it("keeps the Delete outside the choosing button, so both are reachable", () => {
    const host = deleting();
    const row = host.querySelector("[data-theme='living-room']");

    // A button nested in a button is not focusable and cannot be pressed on
    // its own: the keyboard gets one stop, and it chooses the theme.
    expect(row?.closest(".theme-delete")).toBeNull();
  });

  it("asks first, naming the theme and saying where it goes", async () => {
    const host = deleting();
    const wrapper = host
      .querySelector("[data-theme='living-room']")
      ?.closest(".theme-row");
    wrapper?.querySelector<HTMLButtonElement>(".theme-delete")?.click();
    await Promise.resolve();

    const text = confirmOf().textContent ?? "";
    // The act is recoverable, so the author learns that before confirming
    // rather than after. "delete" and "remove" both read as permanent.
    expect(text).toContain("Living Room");
    expect(text).toMatch(/recycle bin/i);
    expect(text).not.toMatch(/^\s*Delete\?\s*$/);
  });

  it("names the whole question to a screen reader, not the lead line", () => {
    const host = deleting();
    host.querySelector<HTMLButtonElement>(".theme-delete")?.click();
    const dialog = confirmOf();

    // A screen reader announces the accessible name when the dialog opens, so
    // it has to carry which theme as well as the question — the same shape the
    // editor's dialog uses.
    const label = dialog.getAttribute("aria-label") ?? "";
    expect(label).toContain("Living Room");
    expect(label).toMatch(/recycle bin/i);
    // And the buttons are not part of the name, which a screen reader reads as
    // the title of the thing rather than as its answer choices.
    expect(label).not.toContain("Cancel");
  });

  it("moves the folder to the recycle bin through the host's route", async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (input: string, init?: RequestInit) => {
      seen.push(`${init?.method ?? "GET"} ${input}`);
      return jsonResponse({ ok: true });
    }) as unknown as typeof globalThis.fetch;
    deleting();

    await confirm("living-room", "yes");

    // The route already exists (`server.ts`, loopback only) and this calls it
    // rather than adding another: one host, one answer to "where did it go".
    expect(seen).toEqual(["DELETE /api/themes/living-room"]);
  });

  it("takes the row off the listing once the host has moved it", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ ok: true })) as unknown as typeof globalThis.fetch;
    const host = deleting();

    await confirm("living-room", "yes");

    expect(
      [...host.querySelectorAll<HTMLButtonElement>("button[data-theme]")].map(
        (row) => row.dataset.theme,
      ),
    ).toEqual(["studio"]);
  });

  it("removes nothing when the answer is no", async () => {
    const sent: string[] = [];
    globalThis.fetch = (async (input: string) => {
      sent.push(input);
      return jsonResponse({ ok: true });
    }) as unknown as typeof globalThis.fetch;
    const host = deleting();

    await confirm("living-room", "no");

    expect(sent).toEqual([]);
    expect(host.querySelector("[data-theme='living-room']")).not.toBeNull();
  });

  it("keeps the row and shows the host's own reason when the trash refuses", async () => {
    // What `host/src/themes/trash.ts` sends on a machine with no trash
    // command — the only way an author learns their Linux box has no `gio`.
    const refusal =
      "This PC has no trash command (gio, trash-put), so the theme was left " +
      "alone rather than deleted permanently.";
    globalThis.fetch = (async () => ({
      ok: false,
      status: 500,
      text: async () => refusal,
    })) as unknown as typeof globalThis.fetch;
    const host = deleting();

    await confirm("living-room", "yes");

    // Nothing was lost, so the row stays and the reason is on screen: a
    // silent failure here is indistinguishable from a delete that worked.
    expect(host.querySelector("[data-theme='living-room']")).not.toBeNull();
    expect(host.textContent).toContain(refusal);
  });

  it("opens as a modal `<dialog>`, which is what traps and restores focus", async () => {
    const host = deleting();
    const remove = host
      .querySelector("[data-theme='living-room']")
      ?.closest(".theme-row")
      ?.querySelector<HTMLButtonElement>(".theme-delete");
    remove?.focus();
    remove?.click();
    await Promise.resolve();

    // A hand-rolled panel has to implement the trap, the inert background and
    // the restore itself; `showModal` is the platform's, which is why the row
    // uses it rather than a `<div>` that has to be kept correct by hand.
    const dialog = confirmOf();
    expect(dialog.tagName).toBe("DIALOG");
    expect(dialog.hasAttribute("open")).toBe(true);
    // The Delete that opened it is what the browser hands the focus back to
    // when the dialog closes, and the row stays on screen to receive it.
    expect(remove?.isConnected).toBe(true);
  });

  it("offers no Delete when the page cannot remove one", () => {
    const host = mount(themeList(THEMES, { onChoose }));

    // The editor's rule, for the same reason: a control that appears and does
    // nothing is worse than no control.
    expect(host.querySelector(".theme-delete")).toBeNull();
  });
});

/** Assigning a theme said nothing about what it would cost the screen it was
 *  being given to: glass over a video repaints on every decoded frame, and a
 *  video background keeps a host monitor out of its low-power states. */
describe("what a theme costs the display it is given to", () => {
  it("warns about glass over video for every kind of row", () => {
    for (const kind of ["local", "paired", "default"] as const) {
      expect(costWarning(kind, ["glass-over-video"])).toMatch(/repaint/i);
    }
  });

  it("warns about a video background only for a host monitor, and for the default", () => {
    // Matched on the one word the prose names, not an alternation: a sentence
    // containing "never" without naming the idle is not this warning.
    expect(costWarning("local", ["video-background"])).toMatch(/idle/i);
    expect(costWarning("paired", ["video-background"])).toBeUndefined();
    // The default has no kind and may land on a host monitor, so it is told.
    expect(costWarning("default", ["video-background"])).toMatch(/idle/i);
  });

  it("says nothing for a theme with no cost", () => {
    // `undefined` is the assertion, not a weak match on one word: a theme with
    // no cost has no sentence at all, so there is nothing for a reader to
    // dismiss.
    expect(costWarning("local", [])).toBeUndefined();
    expect(costWarning("default", [])).toBeUndefined();
  });

  const COSTED = [
    { id: "loop", name: "Loop", costs: ["video-background"] },
    { id: "studio", name: "Studio", costs: [] },
  ];
  const DISPLAYS = [
    { id: "this-pc", label: "This PC", kind: "local", theme: null },
    {
      id: "kitchen-tablet",
      label: "Kitchen tablet",
      kind: "paired",
      theme: null,
    },
  ];

  const noteFor = (host: HTMLElement, id: string): HTMLElement | undefined =>
    host
      .querySelector(`[data-theme='${id}']`)
      ?.closest(".theme-row")
      ?.querySelector<HTMLElement>(".theme-cost-note") ?? undefined;

  it("puts the note on the row for the display the rows are being chosen for", () => {
    const host = mount(
      themeList(COSTED, { displays: DISPLAYS, selected: "this-pc", onChoose }),
    );

    // The note describes the pair the press would commit, so it is on screen
    // before the press rather than added when the row is.
    expect(noteFor(host, "loop")?.hidden).toBe(false);
    expect(noteFor(host, "loop")?.textContent).toMatch(/idle/i);
    // A theme with no cost has no sentence to dismiss.
    expect(noteFor(host, "studio")?.hidden).toBe(true);
    expect(noteFor(host, "studio")?.textContent).toBe("");
  });

  it("leaves the note off a row for a remote display, which pays nothing", () => {
    const host = mount(
      themeList(COSTED, {
        displays: DISPLAYS,
        selected: "kitchen-tablet",
        onChoose,
      }),
    );

    // A phone showing video is doing what a phone does, and warning there is
    // how a warning stops being read.
    expect(noteFor(host, "loop")?.hidden).toBe(true);
  });

  it("warns for every cost when the chosen row is one the list does not name", () => {
    // `selected` opens on the default, which is not a display in the list, so
    // this is the page's own first state rather than a contrived one. Reading
    // that fallback as "paired" would silence the warning on the one row that
    // cannot be asked which display it is — and a default may land on a host
    // monitor.
    const host = mount(themeList(COSTED, { displays: DISPLAYS, onChoose }));

    expect(noteFor(host, "loop")?.hidden).toBe(false);
    expect(noteFor(host, "loop")?.textContent).toMatch(/idle/i);
  });
});
