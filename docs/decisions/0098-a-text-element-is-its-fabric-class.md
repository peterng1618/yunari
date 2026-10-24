# 0098 — A text element's width mode is its Fabric class, not an authored flag

- **Date:** 2026-10-24
- **Status:** accepted
- **Paths:** `src/web/packages/scene-fabric/src/adapter.ts`,
  `src/web/packages/scene-fabric/src/persist.ts`,
  `src/web/packages/renderer-core/src/theme/document.ts`,
  `src/web/packages/renderer-core/src/theme/fabric-envelope-validate.ts`,
  `src/web/packages/editor/src/editor-session.ts`,
  `src/web/packages/editor/src/selection-inspector/view.ts`,
  `src/web/packages/editor/src/components/ui/control-number.tsx`,
  `src/web/packages/editor/src/components/ui/control-pair.tsx`

## The problem

One text element had two width modes — measured ink and a fixed wrap measure —
carried by an authored `wrap: true|false` inside `yunariText`, while the Fabric
object stayed whichever class the revival happened to give it. The flag was read
in four places with three different answers: `buildText` and `adapter.classFor`
converted it to a class, `authoredAlignment` let it override the class, and the
revival path ignored it. So the same document rendered as an `IText` on one path
and a `Textbox` on another, and an inspector control wrote a value that changed
no pixel until reload. The question is which owner should hold a fact that is
already persisted with the scene, and how the editor's class-dependent controls
read it without reintroducing a second source of truth.

## Rung 1 — Yunari

Searched: `rg -n "wrap: |layout.wrap|authored.wrap|Textbox|FabricText|IText"` over
`src/web/packages/{renderer-core,scene-fabric,editor,player}/src`;
`docs/decisions/0003-authored-text-box-outlives-the-text.md`;
`docs/architecture/ownership.md`; the four consumers named above; and every
`*.test.ts` spelling `wrap`.

Found:

- `renderer-core/src/theme/document.ts` owns `TextContent.wrap`, a second
  authored boolean beside the box it qualifies.
- `scene-fabric/src/fabric-text.ts`'s `authoredAlignment` was the only reader in
  the runtime: `wrap: authored.wrap ?? object instanceof Textbox`.
- `scene-fabric/src/adapter.ts`'s `classFor` and `fabric-text.ts`'s `buildText`
  each converted the same flag into a class, independently.
- `scene-fabric/src/persist.ts` revived the persisted class untouched, so the
  editor after a reload was a `Textbox` whatever the flag said.
- `editor/src/selection-inspector/{runs.tsx,run-edits.ts}` projected and wrote
  the flag, and `editor/src/new-fabric-theme-objects.ts` authored it as `true`
  for the starter's boxes.
- No single owner combined "which class is this" with "which layout does it
  have"; the class was known at both `classFor` and `authoredAlignment`, but the
  flag could overrule it, which is the defect.

## Rung 2 — dependencies

Searched: `src/web/packages/{scene-fabric,renderer-core,editor,player}/package.json`;
`node_modules/fabric/dist/index.mjs` for `FabricText`/`IText`/`Textbox`
definitions, `type` constants, `textLayoutProperties` and `classRegistry`
registrations.

Found: Fabric 7.4.0 only; no other text-shaping dependency. Fabric defines three
relevant classes, each already serialising a distinct `type`, and registers each
with `classRegistry` so `loadFromJSON` revives the class it names. `width` is in
`Textbox.textLayoutProperties` and in neither `FabricText`'s nor `IText`'s list —
Fabric itself treats the class, not a flag, as the owner of the width contract.

## Rung 3 — platform

Searched: Fabric's `classRegistry`, `loadFromJSON` reviver and the `type` static
on all three classes; the theme envelope schema's text recognition.

Found: the class name is already the platform's persisted scenario key. A
revived `Textbox` measures into its width; a revived `IText` measures its own.
Nothing new has to be stored. The only platform gap was the validator: its text
test named the developer-facing `"FabricText"`, which Fabric never serialises,
while `FabricText` itself serialises as `"Text"` (`index.mjs:16355`).

## Rung 4 — ecosystem

Searched: docs/decisions/0003's Fabric issue-tracker pass (#2376, #5911, #7981,
#3330, discussion #8628) and Figma / Penpot / GrapesJS / InDesign / Excalidraw
text-sizing models; Fabric's API for a per-object max width.

Found: every authoring tool treats sizing mode as a **mode** and the stored
dimension as a plain number, and none stores "does it wrap" as a per-document
boolean beside a fixed box. Figma exposes per-axis *Fixed / Hug contents / Fill*;
Penpot keeps the stored width and gets meaning from context; InDesign's
`autoSizingType` is an enum. The applications all make the mode part of the
element's identity. Fabric's two classes are that enum, already serialised, so
copying the ecosystem's shape means copying what Fabric already does — not adding
a fourth spelling of it.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Keep authored `wrap`, derive class on load | no — the flag and class already disagree after revival | a migration and a second truth | every path must agree forever | rejected |
| New authored `widthMode` enum | no — duplicates Fabric's class, needs schema + migration | type, validator, fixtures | pre-release format churn for no rendering change | rejected |
| Derive everything from `instanceof Textbox` | yes — class is persisted, revival is a no-op | docblock and inspector edits | legacy `"Text"` must validate | chosen |
| Convert old objects on load | not required — a `Textbox` with `wrap:false` already wrapped | migration machinery + data loss risk | rewrites author documents | rejected |

## Rung 6 — probe

`node --input-type=module -e 'import {FabricText, IText, Textbox} from
"fabric/es"; …'` printed:

```
{"FabricText":"Text","IText":"IText","Textbox":"Textbox",
 "textLayout":{"FabricText":[…],"IText":[…],"Textbox":[…,"width"]}}
```

So the three classes serialise three distinct `type` values and only `Textbox`
re-enters its layout on a width write — the behaviour the flag was trying to
express. Searching `rg -n 'wrap:' src/web/packages --glob '!**/dist/**'` before
the change found the starter authoring, the inspector control and its write, and
the test fixtures that spelled the key; no runtime site the class could not
answer.

## Decision

The Fabric class is the width-mode discriminator. `TextContent` loses `wrap`;
`authoredAlignment` derives `wrap`, `overflow` and `verticalAlign` from
`instanceof Textbox`; `buildText` and `classFor` build `IText` for auto and
`Textbox` for fixed; `PlanTextLayout.wrap` stays as a derived field set where the
class is known (`renderer-core` stays Fabric-free); the validator accepts the
serialised `"Text"`; legacy documents carrying `wrap` are read and the key is
ignored, with no migration and no version bump. The editor's inspector branches
on the live class through `RunsProjection.wraps` rather than on authored content,
and construction/placement stay with `text-manager` so this decision does not
spread a second constructor.
