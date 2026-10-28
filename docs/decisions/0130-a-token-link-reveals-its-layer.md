# 0130 — A token's layer link reveals its layer, and an empty select states that nothing is chosen

- **Date:** 2026-10-28
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/components/ui/control-select.tsx`
  `src/web/packages/editor/src/editor-shell/shell-layout.tsx`
  `src/web/packages/editor/src/editor-session.ts`

## The problem

The token inspector lists the layers a paint or type token is used by. Those
entries became links: pressing one must select the layer on canvas **and** show
the Composition pane, while the object column returns by itself. The token
inspector is an imperative React root mounted by the session, and the pane slot
is `Shell`'s own `useState` — so the gesture has to cross into React from
outside it, which is the same boundary `showFinder` and `showShortcuts` already
cross.

The same change needed the delete row to open with **nothing** chosen: press
Delete, a "Reassign to" list appears with no entry selected, and the delete is
refused until the author picks one. Every existing select in this editor opens
on a real value; the only "nothing" spellings are real options — the reserved
`none` palette token and `background-column`'s `{ id: "", name: "None" }`.

## Rung 1 — Yunari

Searched: `placeholder` across `components/ui` and `panes/`; `panels.none` and
`data-yunari-palette-replacement`; `setSlot`/`choosePane`; `selectLayer`.

Found:

- `ControlSelect` renders a Base UI `Select.Value` with no placeholder support;
  the only placeholder in the editor is `tags-field.tsx`'s text input.
- `background-column.tsx:71` and `font-metadata-form.tsx:93` model "none" as a
  **real option** (`{ id: "", name: "None" }`, `{ id: "none", … }`). The paint
  delete row's default came from the same habit: `options[0]?.id`, and the
  palette's first entry is the reserved `none` token, which is why the control
  read "None" before the author had chosen anything.
- Pane choice is `Shell`'s `[slot, collapsed]` state; `choosePane` owns the
  scroll save, the refit and the open/collapse toggle. Nothing outside React can
  drive it. The three other external doors (`showShortcuts`, `showFinder`,
  `showPublishing`) all go through a store the component subscribes to, plus
  `flushSync`.
- `bridge.selectLayer(id)` exists and is the one owner of canvas selection; no
  new Fabric route is needed.

## Rung 2 — dependencies

Searched: every `@base-ui/react` import in the editor; the installed version.

Found: `@base-ui/react` 1.9.0 is already the one primitive library the spec
rules on (`0032`). `Select.Value` accepts `placeholder`, and `SelectRoot`
computes `hasSelectedValue = value != null && serializedValue !== ''`
(`node_modules/@base-ui/react/select/root/SelectRoot.js:231`) — so an empty
string is "nothing selected". No new dependency.

## Rung 3 — platform

Searched: Base UI's `Select.Value` implementation and types.

Found: the primitive renders `placeholder` when no value is selected and
publishes `data-placeholder` on the trigger for styling. What it does **not**
give is a way to clear a chosen value from the select itself, which the docs
state plainly ("With placeholders, users cannot clear selected values using the
select itself").

## Rung 4 — ecosystem

Searched: Base UI select docs (placeholder, null value); Radix Select
`SelectValue` source; the HTML `<option value="" disabled>` idiom.

Found:

- Radix implements the same rule — `shouldShowPlaceholder(value) { return value
  === '' || value === undefined }` — with a `placeholder` prop on
  `Select.Value`. Neither library asks for a synthetic "empty" item.
- The native `<select required>` idiom is a disabled placeholder option. It
  works, but it puts a non-choice into the option list, where some assistive
  technology announces it as a choice and the repo already conflates it with a
  real value (`none`).
- Base UI's one-way placeholder is a fit, not a limitation, here: the delete
  reveal is deliberately one-way — pick a target, press again, done.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Disabled "Choose a token…" option with `value=""` | works today | none in the control | the "no choice" state is an item, announced as a choice; repeats the `None` confusion | rejected |
| `placeholder` on `Select.Value`, value stays `""` | the primitive's own state; empty already means unselected | one optional prop | none | **chosen** |
| Placeholder text drawn over the trigger | no control change | second owner of the trigger's content; breaks the control set's one-DOM rule | high | rejected |
| Lift `slot`/`collapsed` into a store | one owner | rewrites `choosePane`'s scroll/refit bookkeeping | high for a link | rejected |
| `PaneRequestStore` with a nonce, consumed by `Shell` | keeps the gesture in `Shell`, adds no new owner of the state | ~15 lines + one effect | an extra render before the pane swaps | **chosen** |
| Clicking the rail's DOM button | no code | depends on a control's markup and its toggle semantics | brittle | rejected |

## Rung 6 — probe

`control.dom.test.tsx` renders the control with `value=""` and
`placeholder="Choose a token"`, then with a real value:

- `""` → the trigger prints "Choose a token" and carries `data-placeholder`.
- `"accent"` → it prints the option's name and carries no `data-placeholder`.

The probe is the regression test; it fails if Base UI ever stops treating `""`
as unselected, which would silently make the delete row look chosen.

## Decision

Use Base UI's native placeholder: `ControlSelect` gains an optional
`placeholder` passed to `Select.Value`, and the delete row keeps `value=""`
until the author picks a target — no synthetic option, because the "nothing
chosen" state is not a value and the repo has already paid for confusing the
two.

For the pane, add `PaneRequestStore` (a nonce-carrying request, the shape
`FinderStore` uses) and have `Shell` consume it into `setSlot`/`setCollapsed`;
`ShellLayout.showLayers()` writes the request, and `editor-main` wires it with
`bridge.selectLayer(id)` as one `onRevealLayer` port. The alternative — lifting
the slot into a store — would move `choosePane`'s scroll, refit and
toggle-versus-show logic away from the component that owns it, to save one
effect.
