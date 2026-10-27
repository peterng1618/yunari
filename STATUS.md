# Yunari status

Updated: 2026-10-27
Branch: `main`

## Current objective

The display animates on its own motion: the per-display chart rate setting goes
away and every chart's transition is blitted while it runs.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-27-the-display-animates-without-a-rate-setting.md`, implementing the spec of the same name; seven tasks in three phases.
- **Backlog drain is queued:** `docs/superpowers/plans/2026-10-12-the-backlog-drain.md` resumes only after this plan closes.
- **Preview lens landed:** scene-anchored display box, shell stage, theme letterbox, guide frame, circle lens, ratio catalogue and Previews settings tab.
- **Display presentation landed:** per-record shape and rotation, rotated/inscribed playback, pair-page choice and Host controls.
- **The live line is placed by its data:** axis at its newest reading, no delay or hold, missing readings skipped, and sample frames queued at the transport (0124).

## Last completed change

- **A clock paints on its own granularity:** `refreshBoundText` skips the set, the layout and the render request when the resolved string is identical, so a minutes clock repaints once a minute and a date once a day.
- **Proof:** the unchanged-reading test failed first (1 of 21), 21 pass in the text suite and 603 across `scene-fabric` and `player`; typecheck and biome exit 0.

## Next

1. Execute the display-animation plan, Task 1 first: the family-only animation rule and decision note 0128.
2. Read Task 2's pump and Task 3's clock skip together; they share the 30 fps loop's assumptions.
3. Check the preview source against every `SEMANTIC_KEYS` entry (Task 4's invariant test).
4. Run `npm run gate` at the plan's merge boundary, then merge locally to `main`.

## Blockers / unverified

- **Browser reds, all pre-existing:** `host-walkthrough`'s field case, publish-loop's edit-in-`own-host` run and host-player's round-trip reproduce identically at merge-base `a32b7728`; host-player's theme-chooser case is `vg-758`.
- **`store-worker/src/auth/return-page.ts` hands a one-time token to any loopback port** — closing it needs a nonce or pinned-port binding, a design decision.
- **The 30 fps browser arm is unmeasured:** `this-pc` is 1 fps by kind and cannot hold a rate; only the unit cadence case covers rate-independence.
- **No live GitHub Actions run and no real device:** `publish.yml`'s triggers, artifact hand-off and `npm ls` step are syntax-checked only, and no real phone, Linux or macOS host was exercised.
- **Playwright alpha shadows the runner (`vg-756`) and the importer's save-wire residual is `vg-761`:** run specs through `node node_modules/@playwright/test/cli.js`, and keep a video under about 72 MiB until the save route's base64 bound is fixed.
