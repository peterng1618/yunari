# Yunari status

Updated: 2026-10-24
Branch: `peterng1618/Color-and-gradient-picker-rebuild`

## Current objective

The **colour and gradient picker rebuild** ([`spec`](docs/superpowers/specs/2026-10-12-colour-and-gradient-rebuild-design.md), [`plan`](docs/superpowers/plans/archive/2026-10-23-colour-and-gradient-rebuild.md)) is complete; its plan is archived and no plan is active.

## Active work

- **Nothing is dispatched.** The rebuild's plan is closed; the queue waits on a named plan.

## Last completed change

- **The picker's focus boundary now exists and is measured**: `outline-none` poisoned Tailwind's `--tw-outline-style`, so the area and tracks drew no ring; the variant utilities alone now paint a 2px accent ring and the browser case asserts style, width and the drawn pixel before its 3:1 contrast.
- **The two evidence rows select their cases**: the capture cases are titled `picks a palette colour in the picker…` and `builds a gradient with a drag and a number…`, and the gradient case drags a stop and types `25` before capturing.
- **Five repaired browser cases were run**, not only the focused grep: both `editor.spec.ts` picker cases, the `keyboard.spec.ts` anchor case, `panel-labels.spec.ts`'s audit and the `glass-authoring.spec.ts` history case all pass.
- **`vg-709` is filed open** for a drag or typed offset crossing a neighbouring stop (issue #52), from Task 10's browser proof.

## Next

1. No plan is active until the controller names one; `2026-10-12-the-backlog-drain.md`, `2026-10-21-theme-store-origin-and-style.md` and `2026-10-23-r2-store-backend.md` are queued.

## Blockers / unverified

- **The picker popup is 630px tall with twelve seeded presets** (Task 5's deferred finding): it fits neither above nor below the Tokens well at 720px, so Base UI places it to the right, clamped inside the viewport; the capture shows no clipping, but the unbounded height is unchanged.
- **A gradient stop moved past its neighbour still writes descending offsets** and the validator refuses the document (`vg-709`, issue #52).
- **The gradient capture's fixed status footer overlaps the last preset row** in the scoped element screenshot; the track, the `25 %` position and the preset row are all visible.
