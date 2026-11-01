# 0076 — The serialiser owns the derived-property answer

- **Date:** 2026-11-01
- **Status:** accepted
- **Paths:** `src/web/packages/scene-fabric/src/persist.ts`, `src/web/packages/editor/src/persistence-manager/index.ts`

## Problem

The dirty guard compared the document against itself and disagreed with nothing
touched: a live preview repaint rewrote `text`/`styles` on bound objects, and
group entry wrote `subTargetCheck`/`interactive`, so Ctrl+N prompted about work
nobody did and a save made inside a group persisted editor reachability flags.

`SCENE_PERSISTED_PROPERTIES` already names what Fabric must be asked to include,
but nothing named what comes back out: six independent `remove*` walks did, and
`documentKey` carried a seventh, narrower copy of the text rule. A seventh Fabric
key would have arrived unclassified.

## Rung 1 — internal owner

Searched: `Grep` for `toObject`, `propertiesToInclude`, `isDirty`, `documentKey`
across `packages/`; `codegraph_explore` was not used for this change because the
owner is a single module with three call sites.

Found: `scene-fabric/src/persist.ts` is already documented and tested as the one
owner of scene serialisation (`persist.dom.test.ts` fails the exact key sets per
class, and scans the package for a second `toObject` caller). Its six strip
functions each own one key. `editor/src/persistence-manager/index.ts` computes
the dirty key, and `editor-document.ts` feeds it only what `snapshot()` produced,
which is `serialiseThemeEnvelope(canvas, input)` — already stripped.

Unsolved: `documentKey`'s `authoredOnly` was a second, narrower strip applied to
an already-serialised document. It hid the fact that the serialiser was the real
owner, and a future derived key would have needed classifying twice.

## Rung 2 — installed dependencies

Searched: `node_modules/fabric/src/shapes/Object/Object.ts:1756-1760` and the
`custom-properties` docs the package ships.

Found: `toObject(propertiesToInclude)` is **additive** — it concatenates the
argument with `customProperties` and the type's own `stateProperties`, then
serialises the type's full surface. There is no "only these keys" mode. A strict
allowlist therefore cannot be enforced by passing a shorter array; the derived
keys have to be removed after the fact. `excludeFromExport` exists per object,
not per property, and would drop the whole object.

## Rung 3 — native platform

Searched: `JSON.stringify`/`JSON.parse` canonicalisation already used in
`serialiseScene`.

Found: the native round trip gives a canonical, comparable document, but it
cannot classify a key as authored or derived. No platform API answers that.

## Rung 4 — public solutions

Searched: Context7, `/fabricjs/fabric.js`, "toObject propertiesToInclude
serialization custom properties and stripping non-serialized state"; Fabric wiki
"How to set additional properties in all fabric.Objects"; `custom-properties.mdx`.

Found: every documented approach extends or replaces `toObject` to **include**
more; none provides a declared exclusion set or a compact serialisation mode.
The comparable implementations (tldraw, Excalidraw) own their serialisers
outright; Fabric does not, so exclusion is the integrating layer's job. No
existing solution discharged it.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Pass only `SCENE_PERSISTED_PROPERTIES` to `toObject` | none | drops geometry, type, fill, everything the format needs (`concat`, above) | rejected |
| Set `FabricObject.customProperties` globally | none | additive; adds, never removes; leaks into chart/editor objects | rejected |
| Per-object `excludeFromExport` | none | drops whole objects | rejected |
| Keep delete walks, one declared list + one walk | fits the existing single-owner module and its tests | none beyond classifying a future key, which the list forces | chosen |

## Rung 6 — smallest probe

Not needed: Fabric's additive behaviour is read directly in the installed source
(`toObject` line 1757 `propertiesToInclude.concat(...)`), and the existing exact
key-set tests already fail if a new key reaches the document. The change is a
consolidation of behaviour those tests lock.

## Decision

`persist.ts` gains one `SCENE_DERIVED_PROPERTIES` list and one `stripDerivedState`
walk; the six per-key functions are deleted. Properties whose authored and
derived halves share a key (`text` beside `yunariText.runs`, `clipPath`/`height`
beside `yunariText.box`, `src` beside `yunariAsset`) carry their conditions in
that same walk, so the file still answers "what is derived" in one place.

`documentKey` stops re-stripping: the document it compares is the one
`serialiseThemeEnvelope` produced, so the serialiser's answer is the only answer.

One consequence is deliberate: a package the product did not author whose text
carries Fabric's per-character `styles` keeps it on the canvas but loses it at
the next save. Yunari's text model is `yunariText.runs`; `styles` has no reader
and no allowlist entry, so it is derived wherever it appears. The previous split
answer — stripped by the serialiser, kept by the dirty key on run-less objects —
was the contradiction, not the loss.
