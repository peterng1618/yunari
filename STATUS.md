# Yunari status

Updated: 2026-10-24
Branch: `peterng1618/Color-and-gradient-picker-rebuild`

## Current objective

The **colour and gradient picker rebuild** ([`spec`](docs/superpowers/specs/2026-10-12-colour-and-gradient-rebuild-design.md), [`plan`](docs/superpowers/plans/archive/2026-10-23-colour-and-gradient-rebuild.md)) is complete; its plan is archived and no plan is active.

## Active work

- **Nothing is dispatched.** The rebuild's plan is closed; the queue waits on a named plan.

## Last completed change

- **Gradient stop and preset keys stop at their control**: propagation halts at the handler, so ArrowRight and Delete no longer also nudge or delete the selected object; a browser case proves both.
- **Palette and type commits are their own undo steps**: token rename, kind switch, add, delete-token and type-preset field edits record history, so a later undo cannot silently revert them.
- **The colour preset group hides when the library is empty**, and the channel tracks read the padding box their handles sit in.
- **`DESIGN.md` §5 states the built sizes**: the colour area's 128px height and the gradient track's 24px height with 16px stop marks.

## Next

1. No plan is active until the controller names one; `2026-10-12-the-backlog-drain.md`, `2026-10-21-theme-store-origin-and-style.md` and `2026-10-23-r2-store-backend.md` are queued.

## Blockers / unverified

- **The picker popup is 630px tall with twelve seeded presets** (Task 5's deferred finding): it fits neither above nor below the Tokens well at 720px, so Base UI places it to the right, clamped inside the viewport; the capture shows no clipping, but the unbounded height is unchanged.
- **A gradient stop moved past its neighbour still writes descending offsets** and the validator refuses the document (`vg-709`, issue #52).
- **The gradient capture's fixed status footer overlaps the last preset row** in the scoped element screenshot; the track, the `25 %` position and the preset row are all visible.
