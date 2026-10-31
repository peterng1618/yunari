# 0033 — Assignable device groups have one shared owner

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/renderer-core/src/theme/device-groups.ts`, `src/web/packages/renderer-core/src/index.ts`, `src/web/packages/host/src/settings/devices.ts`, `src/web/packages/host/src/settings/required-devices.ts`, `src/web/packages/host/src/settings/theme-settings.ts`, `src/web/packages/host/src/server.ts`, `src/web/packages/host/src/server.test.ts`, `src/web/packages/editor/src/host-settings-mode/client.ts`

## Problem

The host's device settings own `ASSIGNABLE_GROUPS = ["gpu", "system-disk",
"data-disk"]`; the editor declares its own copy to filter the host's `required`
list (#175). A fourth group added by the host is silently dropped by the editor,
and nothing fails. The editor cannot depend on the host package.

## Rung 1 — internal owner

Searched: `host/src/settings/devices.ts` (`ASSIGNABLE_GROUPS`,
`normalizeDeviceSettings`), `host/src/settings/required-devices.ts`
(`GROUP_FAMILIES`, `requiredDeviceGroups`), `settings/theme-settings.ts`, the
host server's route that reads the list, `editor/src/host-settings-mode/client.ts`
and its tests, and `ui-copy.ts`'s group labels.

Found: the group list is used by four host modules and re-spelled by the editor.
No package both depend on except `renderer-core`, which already owns the
semantic-key vocabulary (`describeSemanticKey`) the groups map onto.

## Rung 2 — installed dependencies

Searched: `renderer-core`'s theme exports and its no-Fabric/no-DOM constraint,
plus the editor and host manifests.

Found: both packages already depend on `renderer-core`; adding one pure constant
and type keeps the package Fabric/DOM-free. No dependency edge is added.

## Rung 3 — native platform

Not applicable: this is a vocabulary constant, not a platform capability.

## Rung 4 — public solutions

Searched: the repository's precedent recorded for `vg-189` (one owner for the
host's own settings vocabulary) and #175's own evidence.

Found: the precedent is to give the shared vocabulary a package owner rather
than duplicate a literal. `renderer-core` is the package both sides already
import for theme semantics.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Move the list and type to `renderer-core` | both sides already depend on it; one owner; host routes keep their types | update five import sites | chosen |
| Editor imports the host package | removes duplication | creates an editor → host dependency the platform forbids | rejected |
| Editor derives the list from each host response | no shared constant | the editor still cannot type the groups, and an absent group is still dropped | rejected |
| Keep the copy with a comment | smallest diff | the next added group still vanishes silently | rejected |

## Rung 6 — smallest probe

The host's admin route tests already enumerate `ASSIGNABLE_GROUPS`, and the
editor client's test asserts a fourth group is filtered. In the new shape both
read the same module, so adding a fourth group to the constant must change both
without a second edit; the existing tests are re-pointed at the shared import.

## Rung 7 — decision

`ASSIGNABLE_GROUPS` and `AssignableGroup` live in
`renderer-core/src/theme/device-groups.ts` and are exported from the barrel.
The host's `settings/devices.ts` imports them instead of defining them, and its
other modules import them from `@yunari/renderer-core` directly. The editor's
`host-settings-mode/client.ts` deletes its copy and imports the shared
definition.

No host-side re-export wrapper is kept; every import moves in this change.
