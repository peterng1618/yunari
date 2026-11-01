// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EDITOR_THEME_TOKENS } from "@yunari/theme-package";
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyEditorThemeTokens,
  clearEditorTheme,
  editorThemeFileName,
  readShellThemeTokens,
} from "./editor-theme.js";

// `import.meta.dirname` rather than a `file:` URL: the jsdom environment this
// file needs does not always hand the test a file-scheme `import.meta.url`.
const css = readFileSync(join(import.meta.dirname, "editor-shell.css"), "utf8");
const design = readFileSync(
  join(import.meta.dirname, "../../../../../../DESIGN.md"),
  "utf8",
);

const tokens = Object.fromEntries(
  EDITOR_THEME_TOKENS.map((token, index) => [
    token,
    `#${(0x112233 + index).toString(16).padStart(6, "0")}`,
  ]),
) as Record<(typeof EDITOR_THEME_TOKENS)[number], string>;

describe("editor theme token vocabulary", () => {
  /** DESIGN.md's Colors table is the normative list of role names; the package's
   *  vocabulary is the machine-readable half. One list, checked against the
   *  other, rather than a second copy drifting. */
  it("is exactly the role names DESIGN.md declares", () => {
    const colors = design.slice(
      design.indexOf("## Colors"),
      design.indexOf("## Typography"),
    );
    const named = new Set(colors.match(/--[a-z0-9][a-z0-9-]*/g) ?? []);
    expect([...named].sort()).toEqual([...EDITOR_THEME_TOKENS].sort());
  });

  /** Applying a theme writes the palette sources too, so every role a theme can
   *  name must be declared by every palette block or one of the layers the
   *  apply writes resolves to nothing. */
  it("declares every token in every palette block", () => {
    for (const palette of [
      "editorial",
      "graphite",
      "ember",
      "moss",
      "plum",
      "light",
    ]) {
      const at =
        palette === "editorial"
          ? css.indexOf('[data-shell-palette="editorial"],')
          : css.indexOf(`[data-shell-palette="${palette}"] {`);
      expect(at, `no block for ${palette}`).toBeGreaterThan(-1);
      const block = css.slice(at, css.indexOf("}", at));
      for (const token of EDITOR_THEME_TOKENS)
        expect(block, `${palette} does not declare ${token}`).toContain(
          `${token}:`,
        );
    }
  });
});

describe("applying an editor theme", () => {
  beforeEach(() => clearEditorTheme());

  it("writes the roles and the shell sources they alias", () => {
    applyEditorThemeTokens(tokens);
    expect(document.documentElement.style.getPropertyValue("--panel")).toBe(
      tokens["--panel"],
    );
    expect(
      document.documentElement.style.getPropertyValue("--shell-surface"),
    ).toBe(tokens["--panel"]);
    // A role with no source is still written.
    expect(
      document.documentElement.style.getPropertyValue("--yunari-control-bg"),
    ).toBe(tokens["--yunari-control-bg"]);
  });

  it("reads back a full token set, then removes it", () => {
    applyEditorThemeTokens(tokens);
    expect(readShellThemeTokens()).toEqual({ ok: true, tokens });
    clearEditorTheme();
    expect(readShellThemeTokens()).toMatchObject({
      ok: false,
      message: "The shell palette does not declare --bg.",
    });
  });

  it("names a package after the theme's slug", () => {
    expect(editorThemeFileName("Warm Paper")).toBe("warm-paper.yunari-theme");
    expect(editorThemeFileName("!!!")).toBe("editor-theme.yunari-theme");
  });
});
