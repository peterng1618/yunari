# 0100 — The picker's live/settled state is one hook, not per-surface state

- **Date:** 2026-10-23
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/components/ui/use-colour-picker.ts`

## The problem

The rebuilt picker reports two callbacks: a live one during a gesture (a drag may
write the scene freely) and a settled one when the gesture ends (one undo entry
per settled change, `DESIGN.md` §5). It also owns a `text` field whose draft must
survive rejection: `ControlText` clears its own draft before calling `onCommit`,
so a refused input has nowhere to live unless the owner of the colour keeps it.
The shape is a small state machine — live `Hsva`, shown text, a refusal that
outlives an outside write, and a "last emitted" value a settle must read without
a stale closure — and every consumer (the popover now, the gradient stop rows
later) must answer it the same way.

The risk is duplication: a popover that keeps `hsva` in its own `useState`, an
exact-value field with its own parse-and-refuse, and an eyedropper that emits
through a third path. Each is short; their disagreements only appear when one
settles twice or drops a refusal.

## Rung 1 — Yunari

Searched: `export function use` under `packages/editor/src` and
`packages/renderer-core/src`; `onValueChange` / `onValueCommitted`; `parseColor`
call sites; `useDraftCommit`.

Found: `control-slider.tsx` already splits live (`onValueChange`) from settled
(`onValueCommitted`), but its state is Base UI's slider value and it owns no
colour, text or refusal. `useDraftCommit` (`control-well.tsx`) owns only the
Enter/IME/Escape keys and deliberately leaves draft meaning to its caller.
`usePresetLibrary` is a `useSyncExternalStore` reader of editor-local data, not a
colour state. `renderer-core/src/color.ts` owns parse/format/convert but holds no
React state. Nothing owns "live colour + shown text + refusal + last emitted".

## Rung 2 — dependencies

Searched: every `package.json` under `src/web/packages`, plus
`node_modules` for `react-colorful`, `@uiw/react-color`, `colord`,
`@reui/color-picker` (task-4 probe output).

Found: `culori@4.0.2` (pure conversion, used by `renderer-core`),
`@base-ui/react@1.8.0` (primitives, no colour state). No picker library is
installed; the task forbids adding a dependency. The already-installed pieces
give the conversions and the text/keyboard primitives, which is everything the
state machine itself needs.

## Rung 3 — platform

Searched: `EyeDropper` in the TypeScript DOM lib and in the editor source;
`<input type="color">` behaviour.

Found: `EyeDropper` is not in the DOM lib this workspace typechecks against, so
the shape is declared locally and feature-detected (`"EyeDropper" in window`);
its `open()` rejects on dismissal, which is a cancel. `<input type="color">` is
a native picker but cannot host this channel set, presets or a two-callback
contract, so it is not the surface. React itself provides no live/settled
primitive beyond `useState`/`useRef`.

## Rung 4 — ecosystem

Searched: npm registry metadata for `react-colorful@5.8.1`,
`@uiw/react-color@2.10.3`, `colord@2.10.0`, `culori@4.0.2`; the ReUI picker this
work follows (`decisions/0098`); and the installed set above.

Found: every colour picker in this set that offers live/settled does so as a
**component** — `react-colorful` and `@uiw/react-color` own their DOM and keep
the state internal, so consuming them means adopting their surface and losing
`ControlRow`/`ControlWell`/`ControlText`. ReUI's block is the interaction model
and already splits `onValueChange`/`onValueCommit`, but the spec (ruling 7)
keeps its source out, and it keeps its state per component with no text-refusal
story in this repo's `ControlText` terms. `colord` converts only. Nobody
publishes the extracted shape — "colour state + shown text + refusal + last
emitted" as a hook — which is exactly this task's shape.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Per-surface `useState` in the popover | Fits one consumer | None today | Second consumer (gradient stop) grows a second copy; live/settled drifts | Rejected |
| `react-colorful` / `@uiw/react-color` | Complete picker + state | New dependency, own DOM | Replaces the agreed surface; state not extractable | Rejected |
| ReUI block copied in | Interaction model | Vendored source, no tests | Ruled against (spec ruling 4/7); no text refusal | Rejected |
| **One hook over `renderer-core` + `colour-picker-model`** | Exact shape: live emit, one settle, text refusal, eyedropper | ~150 lines + DOM tests | Small; pure enough to test | **Accepted** |

## Rung 6 — probe

`node -e` over `node_modules` on this worktree: `react-colorful`,
`@uiw/react-color`, `colord`, `@reui/color-picker` all **absent**;
`culori@4.0.2` and `@base-ui/react@1.8.0` installed. So rung 4's alternatives
would all be a new dependency, and none of the installed packages carries
colour state. A grep of `EyeDropper` across `packages/` and the DOM lib found no
declaration, confirming the local type is required.

The hook's own refusal convention is probed by its DOM tests: `setChannel` with
a non-finite value leaves the state untouched (no emit), `commitText("nope")`
keeps the text and sets `invalid`, and `areaFromPoint`'s `RangeError` convention
is not used here because no area point enters the hook.

## Decision

`components/ui/use-colour-picker.ts` owns the live/settled machine: one `Hsva`,
the shown `text`, the refusal that survives an outside write, and a `latest` ref
so `commit()` settles on the last emitted hex rather than a render's snapshot.
It sits beside `colour-picker-model.ts` (channel maths) and `renderer-core`
(parsing and conversion) rather than replacing either, and it declares the
`EyeDropper` shape locally because the platform type is not available to
typecheck.
