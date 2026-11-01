/**
 * The URL's say in which surface opens.
 *
 * The host's tray opens the editor's existing surfaces by URL, so the query is
 * the one place a mode and the publish surface can be asked for. The rule is
 * narrow on purpose: only the two named modes count, everything else is the
 * editor, and `publish=1` opens the surface only where there is a document to
 * publish. The old `host` spelling is retired with the Host mode's rename.
 */
import { describe, expect, it } from "vitest";
import { parseShellEntry } from "./shell-entry.js";

describe("parseShellEntry", () => {
  it.each([
    ["", { mode: "editor", publish: false }],
    ["?mode=themes", { mode: "themes", publish: false }],
    ["?mode=settings", { mode: "settings", publish: false }],
    ["?mode=host", { mode: "editor", publish: false }],
    ["?mode=this-pc", { mode: "editor", publish: false }],
    ["?mode=bogus", { mode: "editor", publish: false }],
    ["?publish=1", { mode: "editor", publish: true }],
    ["?mode=themes&publish=1", { mode: "themes", publish: false }],
    ["?mode=settings&publish=1", { mode: "settings", publish: false }],
  ])("reads %s", (search, expected) => {
    expect(parseShellEntry(search)).toEqual(expected);
  });
});
