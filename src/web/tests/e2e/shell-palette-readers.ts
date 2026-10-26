import { type Page } from "@playwright/test";
import { openPane } from "./editor-rail.js";
import { openShell, PALETTES } from "./shell-palette.js";

/** Responsibility: the four readers both shell-palette specs share — the editor opened with a pane, the shell's resolved colours, a fill's alpha, and the palettes whose chrome is not yet opaque. */
export async function openEditor(page: Page): Promise<void> {
  await openShell(page);
  await openPane(page, "Document");
}

/**
 * The computed colours of the surfaces a `--yunari-*` token paints.
 *
 * `documentSelect` is the **control set's** select — a `role="combobox"`
 * trigger. Measured: the first match in the panel is the Tokens pane's
 * paint-library chooser (`data-yunari-palette-token`); the Add pane's asset-list
 * trigger held that place until the asset library moved to the Assets pane and
 * became a card button rather than a select. It is named by the control set's
 * own role rather than by that hook because the panes are hidden rather than
 * unmounted, so a pane-specific selector would say "document" about whichever
 * pane happens to mount first. It reads a control-set well, so it resolves
 * through `--panel-2` and not through `--yunari-control-bg`: the legacy
 * `.editor-shell-panel button` rule that used to paint it was removed by plan 7
 * Task 8, and the hook itself is targeted by no rule at all.
 *
 * There is deliberately **no** entry for `.editor-shell-panel input`. The first
 * match is Base UI's hidden value-carrier — measured at `f31b000b` as
 * `id="base-ui-…-hidden-input"`, `aria-hidden="true"`, `tabindex="-1"`,
 * `clip-path: inset(50%)` — which is not a surface at all, so requiring it to
 * be opaque asserts nothing about the palette. It passed before Task 8 only
 * because the legacy rule painted every input indiscriminately. A real
 * control-set well would be a surface, but one painted by `--panel-2`, so it
 * would not restore what this entry used to cover. The consequence is stated
 * rather than hidden: `--yunari-control-bg` now paints only conditional
 * surfaces — the Assets pane's import buttons, the crop row, the modal's own
 * buttons, the keyboard sheet's chips — so this sweep no longer verifies that
 * token on a surface that is always mounted, and
 * `editor-shell.tokens.test.ts` is what covers its declaration per palette.
 *
 * `header` is the shell chrome the palette paints, and it is named for the
 * surface rather than for the control that used to sit on it: the palette chip
 * left the header for §7's Appearance tab, so the chip is no longer a surface
 * that is on screen for a reader to measure.
 */
export async function shellColours(
  page: Page,
): Promise<Record<string, string>> {
  return page.evaluate(() => {
    // The paint a surface shows, not only its background colour: a palette
    // ground may be a gradient (`--stage` under `light`, and the stage texture
    // every palette now carries), whose colour resolves to transparent. A
    // surface that paints nothing is still the empty string or transparent.
    const read = (selector: string): string => {
      const node = document.querySelector(selector);
      if (node === null) return "";
      const style = getComputedStyle(node);
      if (
        style.backgroundColor !== "" &&
        style.backgroundColor !== "rgba(0, 0, 0, 0)"
      ) {
        return style.backgroundColor;
      }
      return style.backgroundImage === "none"
        ? style.backgroundColor
        : style.backgroundImage;
    };
    return {
      header: read(".editor-shell-header"),
      documentSelect: read('.editor-shell-panel [role="combobox"]'),
      stage: read(".editor-shell-stage"),
    };
  });
}

/** The alpha of a computed `background-color`, in whichever of the three forms
 *  this browser serialises: `rgb(r, g, b)` (opaque), `rgba(r, g, b, a)`, and
 *  the `color(srgb r g b / a)` a `color-mix` resolves to. `null` for a form
 *  this does not read, so a change of serialisation reds here rather than
 *  passing as opaque. */
export function backgroundAlpha(colour: string): number | null {
  const value = colour.trim();
  const rgb = /^rgba?\(([^)]+)\)$/.exec(value);
  if (rgb !== null) {
    const parts = (rgb[1] ?? "").split(/[\s,/]+/).filter(Boolean);
    return parts.length > 3 ? Number(parts[3]) : 1;
  }
  const srgb = /^color\(srgb\s+([^)]+)\)$/.exec(value);
  if (srgb !== null) {
    const alpha = (srgb[1] ?? "").split("/")[1];
    return alpha === undefined ? 1 : Number(alpha.trim());
  }
  return null;
}

/** `light` is the one palette whose chrome is not yet opaque, and it is named
 *  rather than skipped so the exception is visible in the reading it exempts.
 *
 *  `light` declares `--shell-surface: #eff9f2bf` — 75% alpha, the residue of
 *  the glass chrome — and every other surface role it declares is alpha too, so
 *  the derivation plan 7 Task 4 wrote produces no opaque value for it. A value
 *  invented here would be a seventh palette tuned by hand, which is the move
 *  the derivation exists to replace, so the fill stays where it is and `vg-310`
 *  owns the gap.
 *
 *  The waiver names a **value, not a direction** (review round 1): the case
 *  asserts that a palette's rendered chrome alpha equals the alpha its own
 *  `--panel` declares, and this set against what that declaration says. The
 *  exemption therefore reds whichever way the fill moves — a value that lands
 *  (declared opaque) makes the row stale, and any treatment added on top of
 *  light's fill breaks the equality — instead of only in the opaque direction,
 *  which is all an `alpha >= 1` reading of "exempt" could catch. */
export const CHROME_NOT_YET_OPAQUE: ReadonlySet<(typeof PALETTES)[number]> =
  new Set(["light"]);
