# Yunari status

Updated: 2026-10-25
Branch: `main`

## Current objective

Fix every finding in the 2026-10-25 performance and security audit, plus anything found while implementing: 30 security and 23 performance findings across the host, player, editor, Worker and release path.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-25-performance-security-hardening.md` — Phases 0–4 complete; Phase 5 is next.
- **Spec:** [`2026-10-25-performance-security-hardening-design.md`](docs/superpowers/specs/2026-10-25-performance-security-hardening-design.md) is approved and all findings are marked Fix.
- **Decision notes 0116–0120 are landed** for the request boundary, chart repaint, store upload, provenance checks and secrets at rest.
- **Backlog drain is queued behind this plan:** [`spec`](docs/superpowers/specs/2026-10-12-the-backlog-drain-design.md) and [`plan`](docs/superpowers/plans/2026-10-12-the-backlog-drain.md) start after this closes.
- **No finding is filed to the backlog:** the user's ruling is fix all, file none.

## Last completed change

- **Phase 4 is complete:** the published poll asks `exists` and the asset route reads one file, never the whole theme.
- **A sensor family is read only when a bound key needs it,** once per tick per family, with failures attributed to the read that failed.
- **Ticks single-flight:** a stalled provider drops its next fire instead of queueing it, and one device read serves every display.
- **Weather settings, SSE frames and the LHM probe are paid for once:** a stat-keyed parse cache, one frame per batch, a one-byte probe.
- **Phase gate:** `npm run gate` exit 0 — 413 files / 6135 passed (1 skipped), Worker 12 / 73.

## Next

1. Run Phase 5 (editor): coalesced change notifications, bounded history, idle publish, off-path image decode.
2. Run Phase 6 (store uploads and Worker) and Phase 7 (secrets, sessions, TLS).
3. Run Phase 8 (supply chain and close), then the final whole-branch review on the most capable model.
4. Finish the branch with `superpowers:finishing-a-development-branch`.

## Blockers / unverified

- **The store upload proxy is unverified live:** the Worker tests and the host client are the evidence until a real upload runs.
- **No Linux secret-store probe:** `secret-tool` is absent on this Windows host; the protector must refuse rather than fall back.
- **The CA fingerprint and cookie flow are unit-tested only:** a real phone pairing needs a live run after Phase 7.
- **Phases 1–2 visible behaviour has no browser proof:** their suites assert objects and geometry; rebuild and inspect before the final review.
