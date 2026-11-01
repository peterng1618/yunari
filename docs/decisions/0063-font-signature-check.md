# 0063 — a font is its bytes, not the media type the browser guessed

- **Date:** 2026-11-01
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/asset-manager/index.ts`

## Problem

`AssetManager.import()` refused an asset whose `File.type` did not equal the
extension's MIME, and `importFont()` reaches that check. Windows browsers
report no type at all for a `.woff2` in the file dialog, so a valid font was
refused with "File MIME type does not match its extension" — the fixture case
in issue #254 (`vg-776`).

## Rung 1 — internal owner

`packages/editor/src/asset-manager/index.ts` owns the check: it appears in both
`import()` and `replace()`, and `importFont()` calls `import()`. The type table
(`KIND_OF`, `FONT_ASSET_FORMATS`) lives in the same module, and `replaceBytes`
is the only other consumer of the bytes. No second validation site exists.

## Rung 2 — installed dependencies

The four font containers have fixed leading bytes: `wOF2`, `wOFF`,
`\0\1\0\0` or `true`, `OTTO`. The editor already parses fonts through
`FontFace` (`loadWithFontFace`), but `FontFace` cannot classify a container
before it exists, and the refusal has to happen before the bytes are stored.
No dependency is needed for a signature table.

## Rung 3 — native platform

`File.type` is the platform's *hint*, filled from the OS association, and is
allowed to be empty. `File.arrayBuffer()` is the bytes themselves — the thing
the package will carry and its readers will parse. There is no native
`FileType` sniffer in the browser.

## Rung 4 — public solutions

A magic-byte table is the standard answer for container identity (`file-type`,
libmagic, and the font vendors' own format specs define these signatures). The
table here is four entries, so a package was not earned; the branch that reads
the same bytes already exists in this module.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Signature table for the font extensions; keep the MIME check for every other kind | Refuses a renamed PNG, accepts a Windows font with no type | One helper, used by `import()` and `replace()` | Chosen |
| Keep trusting `File.type` for fonts | No change | The Windows refusal stands | Rejected by the ruling |
| Accept any file whose extension is a font | Simple | A PNG named `.woff2` is written into a theme package | Rejected |

Widening the signature check to the image and video kinds is not done here:
the issue and the ruling name fonts, and those kinds' MIME check has not been
observed to fail.

## Rung 6 — smallest probe

The new cases were written first and failed against the old code: an empty
`File.type` on a real `wOF2` was refused, and PNG bytes named `.woff2` with
`font/woff2` were accepted. They pass after the change
(`asset-manager/index.dom.test.ts`).

## Decision

`assertFileFormat` checks a font's leading bytes against `FONT_SIGNATURES` and
refuses a mismatch with "The file's bytes do not match its extension."; every
other kind keeps the media-type check and its copy. Both `import()` and
`replace()` use the one helper.
