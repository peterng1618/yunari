import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { captureVisualReview } from "./editor-canvas.js";
import {
  choosePalette,
  EDITOR,
  openAppearance,
  PALETTES,
} from "./shell-palette.js";
import {
  backgroundAlpha,
  CHROME_NOT_YET_OPAQUE,
  openEditor,
  shellColours,
} from "./shell-palette-readers.js";
import { isDesktopSurface } from "./surface.js";

/** Responsibility: What the chrome looks like under a palette — its flatness, its shadow and its scale — and which palette wins on boot, outlasts the OS and is captured. */
test.describe("shell palettes", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "measured through getComputedStyle; the custom-property cascade is what is under test",
  );

  test("chrome is flat and opaque, and a canvas cluster is lifted by its shadow alone", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await openEditor(page);

    // Membership is **derived from the stylesheet**, not named here, so a
    // surface added later is read with the rule that paints it: a rule whose
    // fill is `--panel`/`--shell-surface` is a **lifted cluster** when it
    // declares a shadow and **chrome** when it does not.
    //
    // The authored file, not the loaded stylesheet: the discriminator is the
    // authored `box-shadow` declaration, and the built rule is that same
    // declaration after a minifier has been through it.
    const css = readFileSync(
      new URL(
        "../../packages/editor/src/editor-shell/editor-shell.css",
        import.meta.url,
      ),
      "utf8",
    );
    const membership = await page.evaluate((source) => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(source);
      const rules: CSSStyleRule[] = [];
      const visit = (list: CSSRuleList): void => {
        for (const rule of list) {
          if (rule instanceof CSSStyleRule) rules.push(rule);
          if ("cssRules" in rule) visit((rule as CSSGroupingRule).cssRules);
        }
      };
      visit(sheet.cssRules);
      const chrome = new Set<Element>();
      const clusters = new Set<Element>();
      for (const rule of rules) {
        const fill = rule.style.getPropertyValue("background");
        if (!/var\(--(?:panel|shell-surface)\)/.test(fill)) continue;
        // **Elevation is the discriminator**, because it is the whole of the
        // difference between the two rows. It used to be `backdrop-filter`,
        // and that read was already dead before it was removed: Lightning CSS
        // emits the blur as the prefixed property alone, this Chromium has
        // dropped the alias, and so every cluster computed `none` (`vg-311`).
        // Row 1 is `--elev-1` by name, not "any shadow": elevation 2 and 3 are
        // menus and dialogs, which are opaque overlays rather than clusters.
        const lifted = rule.style
          .getPropertyValue("box-shadow")
          .includes("--elev-1");
        const flat =
          rule.style.getPropertyValue("box-shadow") === "none" ||
          rule.style.getPropertyValue("border-top") !== "" ||
          rule.style.getPropertyValue("border-bottom") !== "";
        for (const selector of rule.selectorText.split(",")) {
          for (const element of document.querySelectorAll(selector.trim())) {
            if (lifted) clusters.add(element);
            else if (flat) chrome.add(element);
          }
        }
      }
      // A surface that is lifted is not chrome, whichever rule reached it first:
      // `.editor-glass` is the chrome default and the two clusters opt into the
      // elevation by name.
      for (const element of clusters) chrome.delete(element);
      const probe = new Map<Element, string>();
      [...new Set([...chrome, ...clusters])].forEach((element, index) => {
        // The probe value is the handle **and** the name a failure prints, so a
        // failure names the surface rather than a probe index.
        const value = `${index}:.${[...element.classList].join(".")}`;
        element.setAttribute("data-treatment-probe", value);
        probe.set(element, value);
      });
      const handles = (elements: Set<Element>): string[] =>
        [...elements].map(
          (element) => `[data-treatment-probe="${probe.get(element)}"]`,
        );
      // **Every declaration, prefix included, on the authored text.** CSSOM
      // drops the prefixed form, and the prefixed form is the one the build
      // emits (`vg-311`, `vg-430`), so a rule read through `CSSStyleSheet` would
      // miss precisely the declaration that used to blur.
      const blurred = source
        .split("\n")
        .flatMap((line, index) =>
          /backdrop-filter\s*:/.test(line)
            ? [`${index + 1}: ${line.trim()}`]
            : [],
        );
      return {
        chrome: handles(chrome),
        clusters: handles(clusters),
        blurred,
      };
    }, css);
    // Each of these three is a positive control on an empty read: an empty set
    // makes the arm that consumes it vacuous, which is the one way a green run
    // could say nothing.
    expect(
      membership.chrome.length,
      "no stylesheet rule classified chrome",
    ).toBeGreaterThan(0);
    expect(
      membership.clusters.length,
      "no stylesheet rule classified a lifted cluster",
    ).toBeGreaterThan(0);
    const CHROME = membership.chrome;
    const CLUSTERS = membership.clusters;

    expect(
      membership.blurred,
      "`editor-shell.css` still authorises a backdrop blur, and the spacing scale and the stage rule say a cluster does not blur its backdrop — the count is the declarations, prefixed forms included",
    ).toEqual([]);

    const read = (selector: string) =>
      page.evaluate((sel) => {
        const node = document.querySelector(sel);
        if (node === null) throw new Error(`no element matches \`${sel}\``);
        const style = getComputedStyle(node);
        return {
          background: style.backgroundColor,
          image: style.backgroundImage,
          blur: style.backdropFilter,
          shadow: style.boxShadow,
        };
      }, selector);

    /** The **whole rendered fill** the palette's own chrome declares. `--panel`
     *  is what every chrome surface paints, so this is what a rendered chrome
     *  background is held against — through a probe element rather than the
     *  token's text, so a fill in any form this browser serialises reads the
     *  same way. Read as the colour and not only its alpha: the boundary is that
     *  the chrome paints `--panel` and **nothing over it**, and a surface
     *  painting `var(--shell-backdrop)` — a different colour that can carry the
     *  same alpha — kept an alpha-only reading green. */
    const declaredFill = async (): Promise<string | null> => {
      const declared = await page.evaluate(() => {
        const probe = document.createElement("div");
        probe.style.backgroundColor = "var(--panel)";
        document.body.append(probe);
        const value = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return value;
      });
      return declared.trim() === "" ? null : declared;
    };

    const failures: string[] = [];
    for (const palette of PALETTES) {
      await choosePalette(page, palette);
      const exempt = CHROME_NOT_YET_OPAQUE.has(palette);
      const fill = await declaredFill();
      const declared = fill === null ? null : backgroundAlpha(fill);

      // The exemption is a value, not a direction: a palette still listed whose
      // fill now declares opaque is a stale row, and one that declares less than
      // opaque without being listed is a new gap. Either way the set and the
      // declarations disagree.
      if (declared === null || exempt !== declared < 1) {
        failures.push(
          `${palette}: its \`--panel\` declares alpha ${
            declared ?? "a form this assertion cannot read"
          }, and CHROME_NOT_YET_OPAQUE ${
            exempt ? "lists it" : "does not list it"
          } — the exemption and the declaration disagree (vg-310)`,
        );
      }

      for (const selector of CHROME) {
        const chrome = await read(selector);
        const alpha = backgroundAlpha(chrome.background);
        if (alpha === null || fill === null) {
          failures.push(
            `${palette} ${selector}: its background reads "${chrome.background}", which this assertion cannot read against the palette's own fill`,
          );
        } else if (chrome.background !== fill) {
          failures.push(
            `${palette} ${selector}: its background is ${chrome.background}, and the chrome paints the palette's own \`--panel\` (${fill}) and nothing over it`,
          );
        }
        if (chrome.image !== "none") {
          failures.push(
            `${palette} ${selector}: the chrome carries a gradient (${chrome.image}) — the sheen is the cluster's, per the elevation 1`,
          );
        }
        if (chrome.blur !== "none") {
          failures.push(
            `${palette} ${selector}: the chrome blurs its backdrop (${chrome.blur})`,
          );
        }
        if (chrome.shadow !== "none") {
          failures.push(
            `${palette} ${selector}: the chrome carries a shadow (${chrome.shadow}) — elevation 0 is flat`,
          );
        }
      }

      for (const selector of CLUSTERS) {
        const cluster = await read(selector);
        const clusterAlpha = backgroundAlpha(cluster.background);
        if (clusterAlpha === null || clusterAlpha >= 1) {
          failures.push(
            `${palette} ${selector}: the cluster's fill is ${cluster.background}, and the spacing scale has a floating cluster never fully opaque`,
          );
        }
        // A cluster is the chrome's own fill plus a shadow, and nothing else:
        // no blur and no sheen, which is what the clusters have always painted.
        if (cluster.blur !== "none") {
          failures.push(
            `${palette} ${selector}: the cluster blurs its backdrop (${cluster.blur})`,
          );
        }
        if (cluster.image !== "none") {
          failures.push(
            `${palette} ${selector}: the cluster carries a gradient (${cluster.image})`,
          );
        }
        if (cluster.shadow === "none") {
          failures.push(
            `${palette} ${selector}: the cluster has no elevation shadow, so it does not read as lifted over the canvas`,
          );
        }
      }
    }

    expect(
      failures,
      "the treatment boundary — chrome flat and opaque, a floating cluster lifted by its shadow alone — does not hold",
    ).toEqual([]);
  });

  test("a fresh profile with no stored palette renders light", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    // With no emulation Playwright's `colorScheme` is light, so the shell
    // resolves `light`. The assertion exists because moving the `--yunari-*`
    // block onto `:root` could have broken the fresh-profile first paint: a
    // base that carries neither the resolved palette's values nor the
    // attribute renders the wrong palette before anything applies. Each test
    // gets its own storage, so this one arrives with nothing stored and only
    // this one depends on that.
    await openEditor(page);

    await expect(page.locator("html")).toHaveAttribute(
      "data-shell-palette",
      "light",
    );
    // And the tab agrees with the attribute rather than holding a default of
    // its own: the row that reads as chosen is the one the shell applied.
    const dialog = await openAppearance(page);
    await expect(
      dialog.getByRole("radio", { name: "light", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");

    const colours = await shellColours(page);
    expect(colours.header).not.toBe("rgba(0, 0, 0, 0)");
  });

  /** The frame **before** React writes the palette attribute (`vg-351`, and
   *  `vg-357` for the three tokens the dark base first left out).
   *
   *  Every other assertion in this file reads `data-shell-palette`, which is
   *  exactly why none of them could see this: the attribute *is* the settled
   *  state, and the defect lives in the frame before it exists. Two base paints
   *  disagreed with `systemShellPalette` there — the stylesheet's bare `:root`
   *  block resolved editorial, and this document's own pre-shell `<style>` drew
   *  editorial cream with a `#0b1419` under its dark media query that matched no
   *  palette in the set — so a fresh profile flashed cream and then snapped to
   *  graphite. `vg-357` was the same frame painted with the right palette and
   *  three of its tokens coming from somewhere else: the dark base carried
   *  graphite's colours and left `--shell-display` and `--yunari-control-bg`
   *  to the bare root, so a dark OS's first frame took
   *  the editorial display face and control paper.
   *
   *  The bundle is blocked rather than raced: with no script the attribute is
   *  never written, so what is measured is the pre-JS frame by construction
   *  rather than by timing. The expected value is read out of the stylesheet's
   *  own palette block through a probe carrying the attribute, so no colour is
   *  copied into this file — what is named here is the palette
   *  `systemShellPalette` picks, which `palette.ts` owns. */
  test("the frame before the palette attribute is the palette the OS resolves", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    // Both halves of the first frame are read: the document's own pre-shell
    // style, and the stylesheet's base block. `#app` stays empty without the
    // bundle, so the body is the surface that paints.
    await page.route("**/*.js", (route) => route.abort());

    for (const [colorScheme, palette] of [
      ["light", "light"],
      ["dark", "graphite"],
    ] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto(EDITOR);

      const frame = await page.evaluate((named) => {
        const painted = (element: Element): string => {
          const style = getComputedStyle(element);
          return `${style.backgroundColor} ${style.backgroundImage} ${style.color}`;
        };
        const token = (element: Element, name: string): string =>
          getComputedStyle(element).getPropertyValue(name).trim();
        // `vg-357`: the two tokens beyond graphite's colours are read with
        // the two that paint. A dark base that omits one resolves it from a
        // `:root` block instead, which is the base frame's value and not the
        // palette the OS resolved — the pre-attribute frame took the editorial
        // display face and control paper there.
        const reading = (element: Element): string =>
          `${painted(element)} | ` +
          [
            "--shell-backdrop",
            "--shell-text",
            "--shell-display",
            "--yunari-control-bg",
          ]
            .map((name) => token(element, name))
            .join(" ");

        const probe = document.createElement("div");
        probe.setAttribute("data-shell-palette", named);
        probe.style.background = "var(--shell-backdrop)";
        probe.style.color = "var(--shell-text)";
        document.documentElement.append(probe);
        const wanted = reading(probe);
        probe.remove();

        return {
          attribute:
            document.documentElement.getAttribute("data-shell-palette"),
          wanted,
          base: reading(document.body),
        };
      }, palette);

      expect(
        frame.attribute,
        "the bundle ran, so this measured the settled frame and not the one before it",
      ).toBeNull();
      expect(
        frame.base,
        `a ${colorScheme}-reporting OS paints its first frame in a palette ` +
          "systemShellPalette does not name",
      ).toBe(frame.wanted);
    }
  });

  /** The OS is a fallback, and a choice outranks it.
   *
   *  `emulateMedia` is the only way to move the OS under the shell's feet, and
   *  it is why this is a browser test: jsdom has no `matchMedia`, so the pure
   *  half in `palette.test.ts` can only check the resolve, never that a live
   *  `change` event reaches it. Each test gets its own storage, so this one
   *  arrives with nothing stored — which is the state the OS is allowed to
   *  speak in. */
  test("the OS is the fallback and the author's choice outlasts it", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.emulateMedia({ colorScheme: "dark" });
    await openEditor(page);
    await expect(page.locator("html")).toHaveAttribute(
      "data-shell-palette",
      "graphite",
    );

    // Nothing is stored, so the shell follows the OS when it changes.
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute(
      "data-shell-palette",
      "light",
    );

    // The author chooses, and from here the OS has no vote — including when it
    // changes back to the value it held first.
    await choosePalette(page, "plum");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute(
      "data-shell-palette",
      "plum",
    );
  });

  /** The six palettes, as six pictures.
   *
   *  The computed comparison above is necessary and not sufficient: it can tell
   *  two surfaces apart but cannot say whether either is a surface an author
   *  would recognise, and the acceptance item asks for the eye. Deliberately
   *  NOT a golden file — a screenshot here is read by a person once, beside the
   *  change that made it. `choosePalette` closes the popup and asserts the
   *  attribute, so each frame is the editor in one palette rather than the menu
   *  that selected it. */
  test("captures each palette's own surface", async ({ page }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    test.setTimeout(120_000);

    await openEditor(page);
    for (const palette of PALETTES) {
      await choosePalette(page, palette);
      // The modal hands focus back to the gear when it closes, so the gear's
      // tooltip is open over the rail's foot — a popup left by how the frame was
      // driven, and the same artefact `editor-shell-add` parks the pointer to
      // avoid. The gear and the tooltip are the shell's; it is the palette the
      // capture is of.
      await page.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.blur(),
      );
      const stage = await page.locator(".editor-shell-stage").boundingBox();
      if (stage !== null) {
        await page.mouse.move(
          stage.x + stage.width / 2,
          stage.y + stage.height / 2,
        );
      }
      await captureVisualReview(page, testInfo, `shell-palette-${palette}`);
    }
  });
});
