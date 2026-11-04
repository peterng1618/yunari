# 0106 — The theme chooser overlays

- **Date:** 2026-11-04
- **Status:** accepted
- **Paths:** `src/web/packages/player/src/chrome.ts`,
  `src/web/packages/player/index.html`

## Problem

The theme chooser is a strip in the bottom chrome band. It began hiding with
the display controls (three seconds after the last tap), but opacity does not
remove a box from layout: the band keeps its height, so `#artboard` stays
shorter than the display and the display-bounded background media is fitted to
that shorter box. The chooser vanishes; the gap it took does not.

## Rung 1 — internal owner

Searched: `putStrip`, `chromeBand`, `placeOverlay`, `setChromeFrame`,
`createThemeChooser`, `mountDisplayControls`, `track`, `onStrip`,
`background-media.ts` `setBounds`, `scene.ts` `fit`.

Found: `chrome.ts` already owns overlay-versus-in-flow for every strip, and
`scene.ts` fits the composition, and the display-bounded media, to `#artboard`.
Only the chooser was built in flow. Its rationale — a persistent control whose
one re-fit happens at mount — ended when it was put on the display controls'
hide schedule (`main.ts` `onStrip`), leaving the layout behind.

## Rung 2 — installed dependencies

Searched: Fabric (canvas viewport only), Base UI (no chrome primitive).

Found: nothing owns DOM strip placement; the browser does.

## Rung 3 — native platform

Searched: CSS `position: fixed` and `opacity` in normal flow.

Found: `position: fixed` takes a box out of flow, so the band collapses to zero
height; `opacity: 0` leaves the box in flow, which is the reported defect. Safe
area insets and the fixed edge placement already exist in `placeOverlay`.

## Rung 4 — public solutions

Searched: the repo's own measurements and precedents — decision 0105,
`chrome.ts`'s vg-028 measurement, the e2e fixed ports for the display controls,
and video-player HUD practice (controls float over the picture; they never
resize it).

Found: the established rule for this display is that anything that appears and
disappears overlays. The display controls bar already does.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Make every strip an overlay (`putStrip` always fixed) | One owner, one rule; the band collapses and the artboard is whole | None | Chosen |
| Only the chooser opts into the existing `overlay` flag | Smallest diff | Leaves an in-flow branch no caller uses | Rejected |
| Collapse the band while the chooser is hidden | Recovers the room only while hidden | Re-fits the scene on every reveal/hide, the vg-028 defect | Rejected |
| Mount the media layer outside `#artboard` to cover the bands | Media reaches the screen edge | Display bounds is defined as the composition's box; media and composition disagree, and the artboard stays short | Rejected |
| Move the chooser into the display controls' bar | One fixed control group | Changes the chooser's corner and width, a UI change nobody asked for | Rejected |

## Rung 6 — smallest probe

`theme-chooser.dom.test.ts` mounts the chooser and asserts the strip's
`position: fixed`. It failed before the change (empty position) and passes
after. jsdom has no layout, so the style that removes the box from flow is the
pinned mechanism; the artboard height itself is the built player's to measure.

## Decision

`putStrip` always fixes a strip to the display's edge and marks it as an
overlay; the `overlay` option is gone because no caller wants the in-flow form.
`setChromeFrame` therefore re-places every strip. The bands remain as the DOM
anchors, and an empty band is zero tall, so the artboard — and the background
media fitted to it — spans the display with the chooser hidden or shown.
