# 0081 — Release a panel's old page before a save is published

- **Date:** 2026-11-02
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/server/theme-writes.ts`, `src/web/packages/host/src/server.test.ts`

## Problem

A theme saved while it is assigned to the TURZX panel shows the theme's new UI
overlay before the new clip has finished uploading, and the panel then loses its
video for the length of the upload. The host log around the save carries
`Panel turzx-5-panel: Page.captureScreenshot got no reply in 5000 ms`, with no
upload-start failure: the old runner captured the page as it reloaded.

`PUT /api/themes/:id` publishes the new revision first, then asks every running
panel to compare its clip. The page a panel's old runner is driving reloads as
soon as it sees the published revision. Until `refreshVideo` reaches that
display, every tick still captures that page and pushes the new UI as an
overlay over the device's old clip. When the clip has changed, the restart then
stops the clip and uploads the new one, so the early overlay sits over a panel
with no video until the upload completes. Reassigning the theme works around it
because that path releases the old page before the new one is shown.

## Rung 1 — internal owner

`theme-writes.ts` owns the save's order: `published.publish(rawId)` followed by
`options.panels.refreshVideo(displayId)` for each running panel.
`panel-manager.ts` owns the clip comparison and the stop/start, and
`panel-runner.ts` owns capture and overlay sends. The order belongs to the save
route; no new scheduling seam is needed.

## Rung 2 — installed dependencies

None. The publish store and the panel manager are this host's own modules.

## Rung 3 — native platform

None. Node's HTTP and promise ordering cannot make a page reload and a device
upload atomic; the host has to choose which happens first.

## Rung 4 — public solutions

The prior decisions own this integration: `0002-save-refreshes-panel-video.md`
establishes that a save re-reads a panel's clip, and
`0003-save-publishes-the-theme.md` establishes that a save is the publish
boundary. Neither fixes their relative order. A search for the symptom in the
repository and its issues found no other design: the observed save is the
evidence, and the page-capture timeout names the old runner as the sender of
the early overlay.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Publish, then refresh (current) | Save response unchanged | Old runner can capture the reloaded page before release | Reject |
| Refresh running panels, then publish | One reorder; the save still awaits the refresh it already awaited | Publish is delayed by the panel stop/start (the save already waits for it) | **Reuse** |
| Add a pause-overlay command | Targeted | A new manager/runner API and a second coordination path for one ordering bug | Reject |
| Keep the old clip playing through the upload | No visible gap | A separate upload-then-swap lifecycle in the device adapters | Reject: larger than the defect |

## Rung 6 — probe

A server test records what `/api/published` answers from inside a running
panel's `refreshVideo`: it must still name the previous revision. That test
fails on the current order and passes once the refresh runs first. The live
evidence is the save-time `Page.captureScreenshot` timeout above; the hardware
run is the report that prompted this note.

## Decision

A save releases running panels first and publishes second. A panel whose clip
changed has its old page and device stopped before the new revision can reach a
page; the new runner uploads the clip before it captures and sends an overlay.
A panel whose clip is unchanged keeps running, so its existing video continues
under the new UI. The save response still waits for the same panel work it
waited for before.
