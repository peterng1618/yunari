# Wallpaper Engine mobile export — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a subscribed scene into an importable video with one click left to the author: the host unpacks the project, drives Wallpaper Engine's own UI to its mobile export dialog, the author saves the package, and the host reads `wallpaper.mp4` out of it into the export folder the finder already watches.

**Architecture:** The host owns the automation. One module builds a PowerShell UI-Automation script, runs it against the running `Wallpaper UI` window, and the host watches Documents for the package the author saves and extracts the MP4 with the existing `PKGM`/`PKGV` table walk. The MP4 is written into `<install>/projects/temp/` so the existing `exportsSince` / `exportBytes` / `importWallpaperExport` chain is unchanged. The editor gains one trigger.

**Tech Stack:** TypeScript, Node `child_process`, Windows UI Automation via `powershell.exe`, React 19, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-21-wallpaper-engine-import-design.md` §8 (corrected by this plan)
**Decision:** `docs/decisions/0118-a-scene-is-exported-by-driving-the-engine-ui.md`

## Global Constraints

- The automation presses the shipped controls only. No injection, no patching, no CEF debugging, no writing Wallpaper Engine's `config.json`.
- Every route that spawns a process or writes a directory keeps the loopback + same-origin checks the `/project` route already has.
- The tile is named by the unpacked project's own `title`; a title the UI does not show is `no-tile`, never a guess at another item.
- Failure reasons are returned, not thrown: `no-install`, `refused`, `agreement`, `no-window`, `no-tile`, `no-modal`, `no-save`, `failed`.
- The Save click is the author's: the Save dialog's controls are not reachable from the host's child process (decision 0118, Rung 3). The host watches Documents, the dialog's own default folder.
- One export per item at a time; the flag clears when the harvest ends, not when the script returns.
- No new dependency.
- Tests never start Wallpaper Engine; the PowerShell runner is injected.

## Review Focus

- A still-at-rest scene is exported as MP4; the sheet must not advertise a PNG that no shipped build can produce.
- A refusal from the agreement modal must reach the sheet with its own sentence, not a generic failure.
- A reused project directory (`EEXIST`) must still get its preview copied, or the thumbnail stays blank.
- Driving the UI must not run while another export is in flight; the per-item flag covers the wait for the author's Save too.
- The package the author saves is left where they saved it; only the extracted video is written into `projects/temp`.

---

### Task 1: Read a `PKGM` package

**Outcome:** `readPackage` accepts both magics; `mobileVideo` returns `wallpaper.mp4`.

**Files:**
- Modify: `src/web/packages/host/src/wallpaper-engine/pkg.ts`
- Modify: `src/web/packages/host/src/wallpaper-engine/pkg.test.ts`

**Constraints:** keep `readScenePackage` behaviour identical for malformed tables; a `PKGM` with no `wallpaper.mp4` is `undefined`.

**Verification:** unit tests for a `PKGM0014` fixture and for a `PKGM` missing the member.

---

### Task 2: Drive the UI to the export modal

**Outcome:** `requestMobileExport({title})` runs the UIA script, sets both export choices, confirms the modal and resolves `ok` once the Save dialog is open, or a named reason.

**Files:**
- Create: `src/web/packages/host/src/wallpaper-engine/export-mobile.ts`
- Create: `src/web/packages/host/src/wallpaper-engine/export-mobile.test.ts`

**Constraints:** the script is a string constant in the module; `powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand` runs it; the last `YUNARI_WE:{json}` line on stdout is the result; a run exceeding the timeout is killed; the script never types into the Save dialog.

**Verification:** the runner is injected in tests; cases cover ok, each failure reason, an unknown reason, a timeout, and a Windows `[ScriptBlock]::Create` parse of the generated script.

---

### Task 3: Wire the host and the fixes it exposed

**Outcome:** `mobileExport(workshopId)` unpacks, drives the UI, and a background harvest turns the package the author saves into `yunari-<id>-<startedAt>.mp4` under `projects/temp`; the unpack copies the preview; `launchEditor` opens the main UI instead of the refused `-project` launch; web items are not listed.

**Files:**
- Modify: `src/web/packages/host/src/wallpaper-engine/unpack.ts`
- Modify: `src/web/packages/host/src/wallpaper-engine/library.ts`
- Modify: `src/web/packages/host/src/wallpaper-engine/source.ts`
- Modify: `src/web/packages/host/src/server.ts`
- Modify: their tests

**Constraints:** one in-flight export per item, held until the harvest ends; the route mirrors `/project`'s loopback and origin refusals; the harvest only reads a package whose size held across one poll, because the engine writes it as it encodes; the author's package is not moved or deleted.

**Verification:** `unpack.test.ts` asserts the preview copy on both the new and reused paths; `library.test.ts` asserts a web item is neither listed nor counted as refused; `source.test.ts` asserts the title the engine is given, the refused-id path, and that the saved package's video reaches `exportsSince`; server route tests cover 405 and no-install.

---

### Task 4: The sheet and the client

**Outcome:** the export sheet offers "Export with Wallpaper Engine", says where to save, imports the MP4 the watcher finds, and explains the agreement refusal.

**Files:**
- Modify: `src/web/packages/editor/src/wallpaper-engine/client.ts`
- Modify: `src/web/packages/editor/src/wallpaper-engine/export-sheet.tsx`
- Modify: `src/web/packages/editor/src/ui-copy.ts`
- Modify: their tests

**Constraints:** no PNG format claim; the watcher is unchanged; the "Open in Wallpaper Engine" route stays as the manual fallback.

**Verification:** DOM tests for the step text, the ok answer, the agreement sentence, another reason, the project route, and the offer/import cycle.

---

### Task 5: Correct the spec and close out

**Outcome:** §8 describes the shipped route; `STATUS.md` names this plan while it runs.

**Files:**
- Modify: `docs/superpowers/specs/2026-10-21-wallpaper-engine-import-design.md`
- Modify: `STATUS.md`

**Verification:** `npm run docs:check`, `npm run status:check`.
