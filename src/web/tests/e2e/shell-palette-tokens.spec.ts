import { expect, type Page, test } from "@playwright/test";
import { PANE_BODY } from "./editor-rail.js";
import {
  choosePalette,
  openAppearance,
  openShell,
  PALETTES,
} from "./shell-palette.js";
import {
  openEditor,
  shellColours,
  stagePaint,
} from "./shell-palette-readers.js";
import { themeToken, typeStep } from "./shell-tokens.js";
import { isDesktopSurface } from "./surface.js";

/** Responsibility: How each palette's `--yunari-*` tokens resolve and reach the surfaces that consume them, in the chrome and through the portal. */
test.describe("shell palettes", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "measured through getComputedStyle; the custom-property cascade is what is under test",
  );

  test("every palette paints the surfaces its --yunari-* tokens name", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    // Today five of the six resolve to nothing: `--yunari-*` was declared only
    // under `[data-shell-palette="editorial"]`, so under the others the
    // declaration that referenced it was dropped and the element rendered
    // transparent.
    const empty = "rgba(0, 0, 0, 0)";
    const unresolved: string[] = [];

    await openEditor(page);
    for (const palette of PALETTES) {
      await choosePalette(page, palette);
      const colours = await shellColours(page);

      for (const [surface, colour] of Object.entries(colours)) {
        // `getComputedStyle` answers `rgba(0, 0, 0, 0)` for a dropped
        // declaration, which is indistinguishable from a deliberately
        // transparent surface — so the check is against a surface that is
        // required to be opaque.
        if (colour === "" || colour === empty) {
          unresolved.push(`${palette}/${surface} = ${colour || "(absent)"}`);
        }
      }

      // The stage's ground is the palette's `--stage`: a colour in five
      // palettes, and a gradient under `light`, where the colour is transparent
      // and the image layers are what paints. Both halves are read, because a
      // stage that paints neither is the unresolved case this sweep is for. An
      // empty colour is the reader's missing-element answer and fails too.
      const stage = await stagePaint(page);
      if (
        stage.colour === "" ||
        (stage.colour === empty && stage.image === "none")
      ) {
        unresolved.push(
          `${palette}/stage = ${stage.colour === "" ? "(absent)" : "nothing painted"}`,
        );
      }
    }

    expect(
      unresolved,
      "a --yunari-* reference with no declaration in scope is invalid at " +
        "computed-value time, and the declaration using it is dropped whole",
    ).toEqual([]);
  });

  /** `vg-458` (item 1): the `--yunari-scrollbar-*` tokens were declared for
   *  the shell's own scrollers and read by nothing, so the pane's column and the
   *  inspector painted the OS default.
   *
   *  **`vg-208` moved the pane's scroller off the column.** §7.7 puts the scroll
   *  on the pane's *body*, so the shell's two scrollers are that body and the
   *  inspector, and the column is read no more: a computed style on a box with no
   *  scrollbar to paint is a reading that would pass whatever the pane drew.
   *
   *  `vg-480`: two more scrollers are **portalled out of `.editor-shell`** — the
   *  menu popup and the settings sheet — so the rule names them and this case
   *  reads them too. They are read **open**, and by the attribute Base UI sets
   *  when they are, because a closed one is still in the DOM (`display-switch`
   *  keeps its menu mounted) and a class query would measure that one.
   *
   *  **The computed values, not the declarations.** The row's defect was a
   *  declaration nothing consumed, so a case that read the stylesheet text
   *  would have passed before the fix; read through the cascade, an
   *  unconsumed property is its initial `auto` and the fix is the token pair.
   *  `vg-491` removed the `::-webkit-scrollbar*` family on a measurement that it
   *  paints nothing beside this pair, so the pair is now the whole styling and
   *  this case is the whole rendered proof of it.
   *
   *  `--hide-scrollbars` — Playwright's headless default, and the flag
   *  `composition-panel.spec.ts:83` lifts — hides the *painted* scrollbar and
   *  leaves the computed value alone, which is what this reads, so the flag
   *  stays on. The ceiling is deliberate and named: this proves the scrollers
   *  are styled by the tokens, **not** that a thumb is painted from them.
   *  Reading the painted thumb would have to lift that flag. */
  test("every shell scroller, portalled or not, carries the scrollbar tokens", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await openShell(page);

    const columns = await scrollbarReading(page, [
      PANE_BODY,
      ".editor-shell-inspector",
    ]);
    expectScrollbarTokens(columns, {
      [PANE_BODY]: "the pane's body, which is what scrolls",
      ".editor-shell-inspector": "the inspector scroller",
    });

    // The menubar's popup, which Base UI portals to `body`: a descendant
    // selector on the shell never reached it.
    await page.locator(".editor-shell-menubar button").first().click();
    await expect(
      page.locator(".editor-shell-menu-popup[data-open]"),
    ).toBeVisible();
    const popup = await scrollbarReading(page, [
      ".editor-shell-menu-popup[data-open]",
    ]);
    expectScrollbarTokens(popup, {
      ".editor-shell-menu-popup[data-open]": "the menu popup",
    });
    await page.keyboard.press("Escape");

    // §7's modal, portalled the same way and asserted to be by the case above
    // ("a portalled surface carries the palette in force").
    await openAppearance(page);
    const sheet = await scrollbarReading(page, [".editor-shell-dialog"]);
    expectScrollbarTokens(sheet, {
      ".editor-shell-dialog": "the settings sheet",
    });

    // The reading is the evidence, and it is attached rather than only
    // asserted so a reader can check the values without a trace.
    testInfo.annotations.push({
      type: "scrollbar",
      description: [columns, popup, sheet]
        .map(
          (reading) =>
            `tokens ${reading.expected.width} / ${reading.expected.colour} | ` +
            Object.entries(reading.scrollers)
              .map(
                ([selector, scroller]) =>
                  `${selector}: ${scroller?.width ?? "unmounted"} / ${scroller?.colour ?? "unmounted"}`,
              )
              .join(" | "),
        )
        .join(" || "),
    });

    await page.keyboard.press("Escape");
  });

  /** `vg-479`: the thumb was a `:root` literal, so every palette that is not a
   *  light one painted the light thumb — a graphite shell read `#c9c2b1`
   *  against its own dark ground. Derived from `--shell-text`, which every
   *  palette declares, it moves with the palette.
   *
   *  Two palettes rather than a value: what the row says is *unreachable* is
   *  "a thumb the palette cannot change", so the reading that falsifies it is
   *  one thumb differing from another. A single expected value here would be a
   *  second copy of the stylesheet's own derivation. */
  test("the scrollbar thumb follows the palette in force", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await openShell(page);

    const read = (): Promise<{ palette: string | null; thumb: string }> =>
      page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        return {
          palette: document.documentElement.getAttribute("data-shell-palette"),
          thumb: style.getPropertyValue("--yunari-scrollbar-thumb").trim(),
        };
      });

    await choosePalette(page, "editorial");
    const editorial = await read();
    await choosePalette(page, "graphite");
    const graphite = await read();

    testInfo.annotations.push({
      type: "scrollbar-token",
      description: `editorial ${editorial.thumb} | graphite ${graphite.thumb}`,
    });

    expect(editorial.palette, "the editorial palette was not in force").toBe(
      "editorial",
    );
    expect(graphite.palette, "the graphite palette was not in force").toBe(
      "graphite",
    );
    // An unresolved `var()` makes the whole declaration invalid at
    // computed-value time, and both readings would then be "" and equal.
    expect(editorial.thumb, "the editorial thumb resolved to nothing").not.toBe(
      "",
    );
    expect(graphite.thumb, "the graphite thumb resolved to nothing").not.toBe(
      "",
    );
    expect(
      graphite.thumb,
      "the thumb is the same under both palettes, so it is a literal no palette reaches",
    ).not.toBe(editorial.thumb);
  });

  test("a portalled surface carries the palette in force", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    // Six palettes, each opening and dismissing the modal, is past the 30s
    // default here. The other sweeps stay inside it.
    test.setTimeout(90_000);

    await openEditor(page);
    for (const palette of PALETTES) {
      await choosePalette(page, palette);
      const dialog = await openAppearance(page);

      // The modal is a sibling of `#app`, not a descendant — the reason this
      // failed under every non-editorial palette while the chrome beside it was
      // correct. Asserted rather than assumed, so the check keeps meaning what
      // it says if the portal target ever changes.
      const portalled = await dialog.evaluate(
        (node) => document.getElementById("app")?.contains(node) === false,
      );
      expect(portalled, "the modal left #app, which is the whole case").toBe(
        true,
      );

      const [dialogBackground, headerBackground] = await Promise.all([
        dialog.evaluate((node) => getComputedStyle(node).backgroundColor),
        page
          .locator(".editor-shell-header")
          .evaluate((node) => getComputedStyle(node).backgroundColor),
      ]);
      expect(
        dialogBackground,
        `the ${palette} modal does not match its chrome`,
      ).toBe(headerBackground);

      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
  });

  test("every preview shows the palette it names, not the one in force", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    // A preview names a palette it may not be rendering under. `ember`, `moss`
    // and `plum` declared only an accent, so under graphite a preview naming one
    // inherited the live palette's surface and painted graphite's dark ground
    // behind a peach accent.
    await openEditor(page);
    await choosePalette(page, "graphite");
    const dialog = await openAppearance(page);
    const group = dialog.getByRole("radiogroup");
    await expect(group).toBeVisible();

    /** **Both bars of every card**, because the preview is two of them (plan 8
     * Task 5): the ground
     *  bar carries the class the parity table's height row addresses and the
     *  accent bar is its next sibling, each with its own `data-shell-palette`.
     *  Reading the ground alone would call two palettes identical where only
     *  their accents differ, which is what the ring this replaces used to read.
     *  The ground is read as `backgroundColor` **and** `backgroundImage`:
     *  `light`'s ground is a gradient stack, so its colour resolves to
     *  transparent and the image is what the eye gets. */
    const previews = await group.evaluate((node) =>
      [...node.querySelectorAll(".editor-shell-palette-swatch")].map((bar) => {
        const ground = getComputedStyle(bar);
        const accent = bar.nextElementSibling;
        return {
          palette: bar.getAttribute("data-shell-palette"),
          background: ground.backgroundColor,
          image: ground.backgroundImage,
          accent:
            accent === null ? "" : getComputedStyle(accent).backgroundColor,
        };
      }),
    );

    expect(previews.map((preview) => preview.palette)).toEqual([...PALETTES]);
    expect(
      previews
        .filter((preview) => preview.accent === "")
        .map((preview) => preview.palette),
      "these previews have no accent bar, so the card is not the two-bar preview the drawing draws",
    ).toEqual([]);

    // No preview shows the *live* palette's ground or accent while naming a
    // different one, which is the defect this test was written for.
    const live = previews.find((preview) => preview.palette === "graphite");
    const ground = (preview: (typeof previews)[number]): string =>
      `${preview.background}|${preview.image}`;
    const borrowed = previews.filter(
      (preview) =>
        preview.palette !== "graphite" &&
        live !== undefined &&
        (ground(preview) === ground(live) || preview.accent === live.accent),
    );
    expect(
      borrowed.map((preview) => preview.palette),
      "these previews are showing graphite, the palette in force, not their own",
    ).toEqual([]);

    // And all six are surfaces of their own, which is what the picker is for.
    // `ember`, `moss` and `plum` declared only an accent, so four of the six
    // were byte-identical cream — a computed-value assertion cannot see that as
    // wrong, because editorial's value is a legitimate value; only the eye
    // catches a picker offering four options that look alike. Hence this is the
    // assertion *and* the six screenshots beside it.
    const surfaces = previews.map(
      (preview) => `${ground(preview)}|${preview.accent}`,
    );
    expect(
      surfaces.filter((surface, i) => surfaces.indexOf(surface) !== i),
      "two palettes render the same preview, so the picker offers a duplicate",
    ).toEqual([]);
    // The accent bar is what the chip's own ring used to be for: `--accent` is
    // the one colour each palette is named by, so two palettes sharing one is a
    // picker offering a duplicate even where their grounds differ.
    const accents = previews.map((preview) => preview.accent);
    expect(
      accents.filter((accent, i) => accents.indexOf(accent) !== i),
      "two palettes render the same accent",
    ).toEqual([]);

    await page.keyboard.press("Escape");
  });

  /** A utility resolves the palette of the SUBTREE it is written in.
   *
   *  Injected rather than written into a component: the shell has no
   *  `bg-shell-surface` yet, and this is the property that decides whether the
   *  first one is safe to write. The probe goes inside the ember preview bar
   *  while graphite is in force, which is the exact case a non-inline `@theme`
   *  loses — it compiles to `var(--color-shell-surface)`, resolved at `:root`,
   *  so the bar's own declaration is never consulted. */
  test("a shell colour utility resolves the palette of its own subtree", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await openEditor(page);
    await choosePalette(page, "graphite");
    const dialog = await openAppearance(page);

    const [inside, declared, live] = await dialog.evaluate((node) => {
      const ember = node.querySelector<HTMLElement>(
        '[data-shell-palette="ember"]',
      );
      // A missing bar would leave the probe detached, where `getComputedStyle`
      // answers "" for everything and the comparison below passes vacuously.
      // Fail loudly instead.
      if (ember === null) {
        throw new Error("no ember preview bar in the palette popup");
      }
      const probe = document.createElement("span");
      probe.className = "bg-shell-surface";
      ember.appendChild(probe);
      /** The reference is a second element in the same subtree painted from the
       *  same token by a plain declaration. It used to be the bar's own
       *  background, which stopped being the token this probe is about when the
       *  bar took the palette's ground (plan 8 Task 5) — a comparison against
       *  the bar would now hold the utility to the wrong role. */
      const reference = document.createElement("span");
      reference.style.background = "var(--shell-surface)";
      ember.appendChild(reference);
      const header = document.querySelector(".editor-shell-header");
      return [
        getComputedStyle(probe).backgroundColor,
        getComputedStyle(reference).backgroundColor,
        header === null ? "" : getComputedStyle(header).backgroundColor,
      ];
    });

    expect(
      inside,
      "the utility did not resolve the palette of its own subtree",
    ).toBe(declared);
    expect(inside, "and it must not be the live palette").not.toBe(live);
    expect(
      inside,
      "the live palette was not measured, so nothing was proved",
    ).not.toBe("");

    await page.keyboard.press("Escape");
  });

  /** The scale, as the built bundle actually resolves it.
   *
   *  `--text-sm`, `--text-xs` and `--radius-md` were declared on an unlayered
   *  `:root`, which beats `@layer theme` whatever its specificity — so
   *  Tailwind's defaults lost globally, and `text-sm` shipped as 12px on
   *  Tailwind's own 14px line height. Nothing errors when that happens and
   *  nothing reaches a jsdom assertion either, so it is measured here: a probe
   *  carrying the class names resolves through exactly the cascade the live
   *  components resolve through, which is the claim.
   *
   *  The four unused tokens are read as variables rather than as utilities —
   *  `@theme static` emits them, but Tailwind only generates a rule for a class
   *  some source file uses, and `rounded-lg` is not one yet. */
  test("the scale resolves to the editor's density", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await openEditor(page);

    const probe = await page.evaluate(() => {
      // Attached: `getComputedStyle` on a detached node answers "" for
      // everything, which would make every assertion here pass vacuously.
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;top:0;left:0;visibility:hidden";
      document.body.appendChild(host);
      // Each probe reads only the property its utility owns. Reading all three
      // would pin the inherited body font here too, which is not what this
      // test is about and would break on an unrelated change.
      const measure = (
        className: string,
        properties: readonly string[],
      ): Record<string, string> => {
        const node = document.createElement("div");
        node.className = className;
        host.appendChild(node);
        const style = getComputedStyle(node);
        const read = Object.fromEntries(
          properties.map((name) => [name, style.getPropertyValue(name)]),
        );
        node.remove();
        return read;
      };
      const root = getComputedStyle(document.documentElement);
      const theme = Object.fromEntries(
        ["--spacing", "--text-md", "--radius-lg"].map((name) => [
          name,
          root.getPropertyValue(name).trim(),
        ]),
      );
      const utilities = {
        "text-xs": measure("text-xs", ["font-size", "line-height"]),
        "text-sm": measure("text-sm", ["font-size", "line-height"]),
        "rounded-sm": measure("rounded-sm", ["border-radius"]),
        "rounded-md": measure("rounded-md", ["border-radius"]),
      };
      // The shell's own rules, not only the utility. A rule writing
      // `font-size: var(--text-sm)` used to take the size alone and leave the
      // element on preflight's `1.5`; the source contract is in
      // `editor-shell.tokens.test.ts`, and this is the half that proves the
      // declaration reaches the element as the resolved value.
      const rules = Object.fromEntries(
        [
          "editor-shell-status",
          "editor-shell-view-readout",
          "editor-shell-keyboard-reason",
          "editor-shell-pane-count",
          "editor-shell-dialog",
          "editor-shell-dialog-lead",
        ].map((name) => [name, measure(name, ["font-size", "line-height"])]),
      );
      host.remove();
      return { utilities, rules, theme };
    });

    // The expected values are the stylesheet's own `@theme` declarations, read
    // rather than transcribed: the claim is that the **bundle resolves what the
    // source declares**, so a second copy of each number here would let the two
    // drift while this row kept passing.
    expect(probe.utilities).toEqual({
      "text-xs": typeStep("--text-xs"),
      "text-sm": typeStep("--text-sm"),
      "rounded-sm": { "border-radius": themeToken("--radius-sm") },
      "rounded-md": { "border-radius": themeToken("--radius-md") },
    });
    // §2's ratio for each token, resolved on the rule that states it.
    expect(probe.rules).toEqual({
      "editor-shell-status": typeStep("--text-xs"),
      "editor-shell-view-readout": typeStep("--text-sm"),
      "editor-shell-keyboard-reason": typeStep("--text-xs"),
      "editor-shell-pane-count": typeStep("--text-2xs"),
      "editor-shell-dialog": typeStep("--text-sm"),
      "editor-shell-dialog-lead": typeStep("--text-lg"),
    });
    expect(probe.theme).toEqual({
      // `.25rem`, not `0.25rem`: the bundle is minified, and this reads what
      // the browser resolved rather than what the source says, so this one
      // value stays spelled the way the minifier writes it.
      "--spacing": ".25rem",
      "--text-md": themeToken("--text-md"),
      "--radius-lg": themeToken("--radius-lg"),
    });
  });

  /** The one treatment boundary: chrome is flat and opaque, and a floating
   *  cluster over the canvas is that same fill lifted by §3's elevation-1 shadow.
   *
   *  **This assertion changed shape twice, deliberately**, and the shapes it had
   *  are why they are named here rather than quietly rewritten. It first read
   *  "editorial is flat and the other five are glass" — a `flat` describing a
   *  whole *palette* rather than an element, which is not the boundary §3 draws.
   *  Task 5 moved the gradient and the blur onto the clusters by name and gave the
   *  chrome the palette's own `--panel`. The clusters' glass was then removed
   *  outright: the drawing never blurred anything and filled a cluster from the
   *  same charcoal at 95%, so the gradient, the two inner highlights and the blur
   *  were the product's own invention. **Elevation is now the whole difference**
   *  between §3's two rows, and it is what this assertion discriminates on.
   *
   *  Both halves are read as a **set, not a sample** (review round 1): a boundary
   *  stated per element is not held by one element a side, and the two surfaces
   *  that were missing from the first reading — the status bar and two of the
   *  three clusters — are exactly where a regression could have hidden. On the
   *  built bundle, in all six palettes:
   *
   *  - **chrome** — every surface that declares its own fill: the rail, the pane,
   *    the inspector, and §3's two elevation-0 strips, the header and the status
   *    bar. Each paints the palette's own `--panel` and nothing on top of it, so
   *    the **whole colour** it renders equals the fill that token declares — not
   *    only its alpha, because a hover-tint or a second surface under the same
   *    alpha is what "paints `--panel`" is meant to rule out — and it carries no
   *    gradient, no blur and no shadow.
   *  - a **floating cluster** — §7.5's three: the dock, the view cluster and the
   *    identity chip. Each is translucent and lifted, and **none of them blurs or
   *    paints a gradient**.
   *
   *  `backdrop-filter` is deliberately **not** the discriminator, and the reason
   *  is measured rather than assumed: the built stylesheet carried only the
   *  prefixed `-webkit-backdrop-filter`, this Chromium does not support that form,
   *  so every cluster computed `backdropFilter: none` under every palette — the
   *  dead blur `vg-311` records, which this change retired by deleting the
   *  declarations rather than by asserting them.
   *
   *  **The authored declarations are asserted absent all the same, and the
   *  computed read is why that is not redundant.** Retirement by deletion left
   *  one declaration behind — the identity chip's own `backdrop-filter`, which
   *  no cluster renders because the build prefixes it away (`vg-430`) — so
   *  "every cluster computes `none`" was green over a stylesheet that still
   *  asked to blur. A computed read cannot see a declaration the toolchain
   *  drops, which is exactly the state `vg-311` was filed from; the source scan
   *  below is what holds §3's "floating clusters do not blur their backdrop"
   *  against the rule text rather than against the build's treatment of it. */
});

/** One set of scrollers' computed `scrollbar-width`/`scrollbar-color`, with the
 *  reference they are compared against.
 *
 *  The reference declares the same tokens by the same `var()` expressions, so
 *  the comparison is token-to-token: a scroller painting a literal of its own
 *  reds here rather than matching whatever the tokens happen to hold. */
async function scrollbarReading(
  page: Page,
  selectors: readonly string[],
): Promise<{
  expected: { width: string; colour: string };
  scrollers: Record<string, { width: string; colour: string } | null>;
}> {
  return page.evaluate((list) => {
    const reference = document.createElement("div");
    reference.style.scrollbarWidth = "thin";
    reference.style.scrollbarColor =
      "var(--yunari-scrollbar-thumb) var(--yunari-scrollbar-track)";
    document.body.append(reference);
    const declared = getComputedStyle(reference);
    const expected = {
      width: declared.scrollbarWidth,
      colour: declared.scrollbarColor,
    };
    reference.remove();

    const scrollers: Record<string, { width: string; colour: string } | null> =
      {};
    for (const selector of list) {
      const node = document.querySelector(selector);
      if (node === null) {
        scrollers[selector] = null;
        continue;
      }
      const style = getComputedStyle(node);
      scrollers[selector] = {
        width: style.scrollbarWidth,
        colour: style.scrollbarColor,
      };
    }
    return { expected, scrollers };
  }, selectors as string[]);
}

/** The guards and the equality, so every scroller is held to the same reading.
 *
 *  A declaration whose `var()` resolves to nothing is dropped at computed-value
 *  time and answers `auto` — the same `auto` an unstyled scroller answers.
 *  Without the two guards the equality below would hold with the tokens missing
 *  entirely and the case would prove nothing. */
function expectScrollbarTokens(
  reading: Awaited<ReturnType<typeof scrollbarReading>>,
  labels: Record<string, string>,
): void {
  expect(
    reading.expected.width,
    "the reference's own scrollbar-width did not resolve",
  ).toBe("thin");
  expect(
    reading.expected.colour,
    "the reference's own scrollbar-color did not resolve to the tokens",
  ).not.toBe("auto");

  for (const [selector, name] of Object.entries(labels)) {
    const scroller = reading.scrollers[selector] ?? null;
    expect(scroller, `${name} is not mounted`).not.toBeNull();
    if (scroller === null) continue;
    expect(
      scroller.width,
      `${name} is not styled thin (${scroller.width})`,
    ).toBe(reading.expected.width);
    expect(
      scroller.colour,
      `${name} is not painted by the --yunari-scrollbar-* tokens (${scroller.colour})`,
    ).toBe(reading.expected.colour);
  }
}
