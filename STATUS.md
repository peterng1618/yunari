# Yunari status

Updated: 2026-10-26
Branch: `main`

## Current objective

The 2026-10-25 performance and security audit is implemented and closed; the next objective is the queued backlog drain.

## Active work

- **No plan is running:** the hardening plan is closed and archived, and the backlog-drain plan is queued next rather than started.
- **Nothing was filed:** the ruling held — every audit finding and everything found while implementing it was fixed inside the plan.
- **Unverified paths:** no live GitHub run of `publish.yml`, and no real phone, Linux or macOS host in this session.

## Last completed change

- **The final whole-branch review passed:** host and app slices approve, and the supply-chain slice's findings are fixed rather than filed.
- **The publish check now reads `on:`:** only `release: published` and `workflow_dispatch` may trigger it, and publish permissions are exactly `contents` and `id-token`.
- **Admin write failures answer fixed messages,** optional dependencies enter the notices check, and the LAN can no longer read the whole theme library.
- **The ffmpeg unlisted-platform doc matches the package table,** and the editor reads the shared asset media-type owner instead of a second table.
- **Gate exit 0:** biome 1066 files; 421 files / 6339 passed, 1 skipped; Worker 13 / 130 — and `host-pwa` is 3/3.

## Next

1. Start the backlog-drain plan with a reproduction pass, not a fix pass.
2. Triage the browser reds recorded below on `main`: walkthrough field, publish-loop in `own-host`, host-player round-trip.

## Blockers / unverified

- **Browser reds, all pre-existing:** `host-walkthrough`'s field case, publish-loop's edit-in-`own-host` run and host-player's round-trip reproduce identically at merge-base `a32b7728`.
- **`store-worker/src/auth/return-page.ts` hands a one-time token to any loopback port** — pre-existing, and closing it needs a nonce or pinned-port binding, so it is a design decision.
- **No live GitHub Actions run:** `publish.yml`'s triggers, artifact hand-off and the `npm ls` step are syntax-checked only.
- **Two pre-existing tooling gaps:** `src/web/tests/scripts/*.test.ts` sits outside every tsconfig, and `scripts/oversize-files.mjs` exits 1 on 31 `src/web` files over the 800 stop.
- **No real phone, Linux or macOS host** was exercised; PWA, keyring and ffmpeg pairs are read or mocked rather than measured.
