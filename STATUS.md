# Yunari status

Updated: 2026-10-25
Branch: `main`

## Current objective

Fix every finding in the 2026-10-25 performance and security audit, plus anything found while implementing: 30 security and 23 performance findings across the host, player, editor, Worker and release path.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-25-performance-security-hardening.md` — Phases 0–3 complete; Phase 4 is next.
- **Spec:** [`2026-10-25-performance-security-hardening-design.md`](docs/superpowers/specs/2026-10-25-performance-security-hardening-design.md) is approved and all findings are marked Fix.
- **Decision notes 0116–0120 are landed** for the request boundary, chart repaint, store upload, provenance checks and secrets at rest.
- **Backlog drain is queued behind this plan:** [`spec`](docs/superpowers/specs/2026-10-12-the-backlog-drain-design.md) and [`plan`](docs/superpowers/plans/2026-10-12-the-backlog-drain.md) start after this closes.
- **No finding is filed to the backlog:** the user's ruling is fix all, file none.

## Last completed change

- **Phase 3 is complete:** a sample revision gates chart repaint, lines rebuild their series with `replaceMerge`, and the cadence re-anchors only after a whole missed interval.
- **A hidden display stops both loops and pauses its video;** a restored page reloads and a page opened hidden starts paused.
- **Media frames are followed only under a glass surface,** and a resize that changes nothing no longer re-fits — pixel ratio included.
- **The publish poll keeps one request in flight** and stops on a refusal or a missing theme.
- **Phase gate:** `npm run gate` exit 0 — 412 files / 6091 passed (1 skipped), Worker 12 / 73.

## Next

1. Run Phase 4 (host IO): scoped theme reads, key-gated library sampling, single-flight ticks.
2. Run Phase 5 (editor) and Phase 6 (store uploads and Worker).
3. Run Phase 7 (secrets, sessions, TLS) and Phase 8 (supply chain and close).
4. Then the final whole-branch review on the most capable model.

## Blockers / unverified

- **The store upload proxy is unverified live:** the Worker tests and the host client are the evidence until a real upload runs.
- **No Linux secret-store probe:** `secret-tool` is absent on this Windows host; the protector must refuse rather than fall back.
- **The CA fingerprint and cookie flow are unit-tested only:** a real phone pairing needs a live run after Phase 7.
- **Phases 1–2 visible behaviour has no browser proof:** their suites assert objects and geometry; rebuild and inspect before the final review.
