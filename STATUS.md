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

- **Phase 8 landed:** staged npm versions are exact and `THIRD-PARTY-NOTICES.md` is checked against the lockfile, the manifests and each licence.
- **The publish workflow is least privilege and pinned:** install and publish are separate jobs, every action is a 40-hex SHA, and a non-dry dispatch off a tag runs a tested pure-function guard.
- **Advisories are covered:** zod is overridden with a named `@google/design.md` exception, the allowlist reasons were checked against the code, and the `npm ls` invariant is a CI step.
- **ffmpeg is verified before every spawn** against five recorded digests, and the rule is typechecked from its own `tsconfig.checkjs.json`.
- **Close found one regression of ours and fixed it:** a display URL carrying `data=live` never exchanged `?session=` for the cookie and got a 403; the exchange now runs and `host-pwa` is 3/3.

## Next

1. Start the backlog-drain plan with a reproduction pass, not a fix pass.
2. Triage the browser reds recorded below on `main`: walkthrough field, publish-loop in `own-host`, host-player round-trip.

## Blockers / unverified

- **Browser reds, all pre-existing:** `host-walkthrough`'s field case, publish-loop's edit-in-`own-host` run and host-player's round-trip reproduce identically at merge-base `a32b7728`; no branch regression is established.
- **No live GitHub Actions run:** `publish.yml`'s artifact hand-off and the `npm ls` step are syntax-checked only.
- **`src/web/tests/scripts/*.test.ts` is outside every tsconfig** — pre-existing, so those files are transpiled without typechecking.
- **`scripts/oversize-files.mjs` exits 1** on 31 pre-existing `src/web` files over the 800 stop; its live run is in neither the gate nor `ci.yml`.
- **No real phone, Linux or macOS host** was exercised; the PWA, keyring and 32-bit refusals are read or mocked rather than measured.
