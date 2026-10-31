# 0021 — One quarter-turn rule, owned by renderer-core

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/renderer-core/src/artboard.ts`, `src/web/packages/host/src/server.ts`, `src/web/packages/host/public/rotation.js`, `src/web/packages/host/public/pair.html`, `src/web/packages/host/src/settings/display-presentation.ts`, `src/web/packages/player/src/publish-follower.ts`, `src/web/packages/editor/src/host-settings-mode/display-presentation-section.tsx`

## Problem

The rule that a rectangular display turns in 90-degree steps was written in six
places (#240): `renderer-core`'s scene reader, the host's store (a snap and a
refusal), the player's publish follower, the editor's presentation controls, and
the pairing page's own script. A change to the rule had to find all six, and the
page's copy could only be exercised through a browser.

## Rung 1 — internal owner

Searched: each cited site plus callers (`snapRotation`, `normalizePresentation`,
`quarterTurn`, `rotationAllowed`), and the transform that consumes the angle.

Found: `renderer-core/src/artboard.ts` already reads an angle's legality in
`readRotation` for the transform, so it is the seam the rest already agree with.
The host's `display-presentation.ts` is the right *write* owner but re-spelled the
set; the player and the editor re-spelled it again. The pairing page is served
with no build step, so it cannot import the TypeScript module.

## Rung 2 — installed dependencies

Searched: nothing new to reuse — the rule is three comparisons and one rounding.

## Rung 3 — native platform

Searched: served static assets and the existing `/pair` route.

Found: the admin bundle is LAN-blocked under `/settings`, and `/pair` is the one
page served before the credential gates because an unpaired device has none. A
sibling fixed-path asset can ride the same decision without exposing the settings
root.

## Rung 4 — public solutions

Searched: how single-source-of-truth rules are shared into buildless pages —
inline copies pinned by a test, versus a served module, versus duplicating the
generator.

Found: the pinned-copy pattern is only safe with a test that compares behaviour;
a served module removes the copy for anything that can `import`. The pairing page
can use a module, so the copy moves out of the page and the test now compares
the served module to the owner.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Leave six copies | Drifts | none | rejected: the defect |
| Export from renderer-core, keep the page's inline copy | TS sites agree; page drifts | a page-only test | rejected: the page is the one a change forgets |
| Export from renderer-core + a served browser module + a comparison test | One rule; page imports | one fixed-path route | chosen |
| Generate the browser module from the TS source | No copy at all | a build step for one function | rejected: not worth a generator |

## Rung 6 — smallest probe

`packages/host/src/rotation.test.ts` compares the served module's answer to
`snapRotation("rect", …)` for a table of angles around every boundary and wrap.
The existing host, player and editor suites exercise the imported predicate.

## Decision

`renderer-core` exports `rotationAllowed(shape, rotation)` and
`snapRotation(shape, rotation)`. `readRotation`, the host's `snapRotation` and
`normalizePresentation` refusal, the player's follower condition and the editor's
`snapQuarterTurn` all ask them. The pairing page imports `snapQuarterTurn` from
`/rotation.js`, served from the admin bundle as one fixed path beside `/pair`,
and a test pins that file to the owner.
