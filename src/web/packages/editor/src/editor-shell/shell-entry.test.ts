/**
 * The URL's say in which surface opens.
 *
 * The host's tray opens the editor's existing surfaces by URL, so the query is
 * the one place a mode and the publish surface can be asked for. **A URL that
 * names no mode opens the Themes page**: a session starts from the store, not
 * from a blank document. An unknown mode is the same as none, except that
 * `publish=1` still opens the editor — there is no document to publish from
 * anywhere else. The old `host` spelling is retired with the Host mode's rename.
 */
import { describe, expect, it } from "vitest";
import { parseShellEntry } from "./shell-entry.js";

describe("parseShellEntry", () => {
  it.each([
    ["", { mode: "themes", publish: false }],
    ["?mode=editor", { mode: "editor", publish: false }],
    ["?mode=themes", { mode: "themes", publish: false }],
    ["?mode=settings", { mode: "settings", publish: false }],
    ["?mode=host", { mode: "themes", publish: false }],
    ["?mode=this-pc", { mode: "themes", publish: false }],
    ["?mode=bogus", { mode: "themes", publish: false }],
    ["?publish=1", { mode: "editor", publish: true }],
    ["?mode=bogus&publish=1", { mode: "editor", publish: true }],
    ["?mode=themes&publish=1", { mode: "themes", publish: false }],
    ["?mode=settings&publish=1", { mode: "settings", publish: false }],
  ])("reads %s", (search, expected) => {
    expect(parseShellEntry(search)).toEqual(expected);
  });
});
