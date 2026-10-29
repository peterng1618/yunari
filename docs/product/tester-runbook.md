# Tester runbook

Operating procedure for a **testing-as-human** session: driving the product as
an author would, in order to find what is wrong with it.

This is a role, not a workflow. Superpowers still owns design, planning,
execution and change lifecycle; this file only covers how to *find* things.
Companion: [`probe-notes.md`](probe-notes.md) (the traps, with evidence) and
[`tester-brief.md`](tester-brief.md) (what to file and what not to).

---

## 0. Set up — get out of each other's way

Another agent is usually draining the backlog at the same time. Two agents
sharing a host, a browser, or a theme library produce findings about *each
other*. Take all four of these before probing anything.

| Resource | How to get your own | Why |
|---|---|---|
| Host | `node packages/host/bin/yunari.js --no-browser --port <free> --app-dir <dir> --themes-dir <dir>` from `src/web/` | Two agents on one port see each other's documents. Six stale servers from dead sessions have already had to be killed. |
| Theme library | `--app-dir` and `--themes-dir` pointing at a scratch directory | You will rename, delete, group and re-colour the Starter. That must never touch the real library or the other agent's. |
| Browser | The Playwright MCP browser is shared and will refuse a second instance. Drive your own Chromium over CDP instead — see below. Do **not** edit `.mcp.json` to get an `--isolated` flag; the agent environment is user-owned. |
| Bundles | `npm run build` from `src/web/` before you look at anything | A stale bundle has already produced two wrong conclusions on this pass. |

Launching your own Chromium, on Windows, against a Playwright install:

```bash
"$LOCALAPPDATA/ms-playwright/chromium-<build>/chrome-win64/chrome.exe" \
  --remote-debugging-port=<free> --user-data-dir='D:\yunari-tester\chrome-profile' \
  --no-first-run --no-default-browser-check about:blank
```

Then drive it with a ~20-line script that `chromium.connectOverCDP()`s to that
port. **Put the dialog handler in the harness, not in each probe** — see §2, it
is the single highest-value line in this document.

Maximise the window. It is the intended editor size, and a 1024-wide viewport
is a genuine authoring condition worth testing — but do it deliberately, as a
finding, not as your default.

**Start the host as a managed background task**, not as a detached `(cmd &)`.
A detached one gets reaped and the failure mode is misleading: the next probe
fails with `ERR_CONNECTION_REFUSED` and you start debugging the editor when the
host is simply gone. If it does die, check `host.log` before assuming a crash —
an empty log after the banner means it was reaped, not that it faulted.

Keep scratch outside the repo. Nothing you write should appear in `git status`.

---

## 1. The loop

1. **Use the product.** Open the editor, the player, the settings page. Insert,
   select, type, resize, drag, hide, lock, rename, delete, group, save, reopen,
   play. At desktop and at 390 px.
2. **Suspect the reading before you believe it.** When something looks wrong,
   ask whether the *probe* is wrong first. See §2 and §3.
3. **Measure against ground truth**, not against the DOM you are testing. See §3.
4. **File it** into `docs/product/backlog.jsonl`, with the measurement in the
   row. See [`tester-brief.md`](tester-brief.md).
5. **Keep going.** The pass ends when a sweep finds nothing new, not when you
   have filed your first finding.

Re-run `node scripts/backlog-check.mjs` after every append, and commit each
batch. Stage `docs/product/backlog.jsonl` explicitly — never `git add -A`; the
draining agent's work is unstaged in the same tree and you do not own it.

### The id space is shared — allocate immediately before you append

Another agent files into the same file while you are still writing your row.
Reading the highest id at the start of a session, or picking ids while composing
prose, loses that race: on this pass I drafted four rows, and by the time I
appended them the draining agent had filed their own `vg-078`, so my append
produced a duplicate.

**Read the highest id and append in the same step.** Do not pick ids when you
start composing a row and write the file later. The gate catches the collision
rather than letting it through, so a duplicate is a recoverable moment — but only
if you commit the fix rather than leaving the file dirty.

Renumber yours, not theirs. Match by title, move only the rows that collided,
and then re-run the gate: a duplicate id is almost always the harmless kind, but
"almost always" is not a reason to skip the check.

### Recovering a crash

A crash mid-session leaves the working tree dirty and the register uncommitted.
The order that worked:

1. `git log --oneline -3` and `git status --short` — what actually landed.
2. `node scripts/backlog-check.mjs` — this is what tells you the register is
   malformed rather than merely incomplete. A duplicate id is the most likely
   damage and the gate names it exactly.
3. Decide what is yours by diffing, and stage only your files.
4. **Re-verify your measurements.** A crash does not invalidate a finding, but
   the pre-crash run is no longer fresh evidence — re-run the probe against the
   restored environment before you commit a claim that the world may have moved
   under. `grep` the source for the thing you measured (no `beforeunload` in the
   editor still meant the guard was absent after the crash).

Restarting after a power failure means the host **and** the browser: both die,
and the theme library survives because it is on disk. Re-check the library
before trusting anything you measure next.

---

## 2. Handle native dialogs, or you will file a working feature as dead

**This cost this pass a false finding that another agent had to refute.**

Playwright auto-dismisses `window.prompt`. A dismissed prompt returns `null`,
the handler returns early, and the command produces *no download, no toast, no
status text and no page error* — byte-for-byte the same signature as a button
with no handler wired to it. A native file chooser is worse: a script cannot
observe it at all.

Register this **once, in your CDP harness**, before any probe runs:

```js
page.on("dialog", async (d) => {
  try { await d.accept(d.type() === "prompt" ? d.defaultValue() : undefined); }
  catch {}
});
page.on("filechooser", async (fc) => { /* setFiles, or record and fail loudly */ });
```

Accepting `defaultValue()` matters: `accept()` with no argument submits an empty
string, which for a `prompt` reads as "the author typed nothing and cancelled"
and correctly produces no download.

If you already filed "this command does nothing", **re-run it under this handler
before anyone spends a fix on it.** And if you filed it without the handler and
the feature turned out to work, withdraw the row rather than leaving it — a
wrong row costs an agent's time and, worse, teaches the next pass to distrust
the register.

---

## 3. Ground truth, and what the editor will not tell you

**A canvas readback is a snapshot of a moment.** The standing rule on this pass,
earned repeatedly. Screenshot for what is visible; read the DOM for what is
true; when two probes disagree, find out which is wrong before believing either.

Two specific traps, both hit here:

**A reload is not a round trip.** The editor opens the *Starter*, not the saved
theme. Save, reload, and you are looking at the template again — so any probe
that saves, reloads, then asserts about "the saved document" is asserting about
the Starter, and the thing under test has silently reverted. Measure the saved
state through `GET /api/themes/<id>/document` **in the same session**.

**Values are drawn, not in the DOM.** The player's readings are canvas-painted.
`document.body.innerText` matching `/\d+%/` to decide whether numbers are on
screen measures nothing. Use a screenshot for that, and the API for what is
true.

The host's document endpoint is the strongest instrument available:

```
GET /api/themes            → the theme list, and the active one
GET /api/themes/active     → which theme the player shows
GET /api/themes/<id>/document  → the whole envelope: scene, bindings, artboard, palette
GET /api/devices           → which drives are available and which are assigned
GET /api/sensors           → what the host will stream
```

Compare that against what the UI shows. Most of the worst findings on this pass
were exactly that disagreement — the document said one thing and three surfaces
of the editor said another.

Restore the library between probes. Opening the editor and choosing
`File > Save to library` re-writes the pristine Starter, which is the cheapest
reset there is. Check you are back at the pristine Starter — 60 objects, being
eight card groups with their fifty parts and two loose labels — and the frost
token solid before you finish.

---

## 4. Check build freshness, and check landed work yourself

Another agent is committing while you probe. Before trusting any measurement
that depends on recent code:

- `git log --oneline -3` and `git status --short` — what landed, and what is
  still uncommitted.
- `npm run build` from `src/web/` after any commit that touches the editor.

**A passing agent report is not evidence.** When a row you filed closes, run it
yourself and say so in the commit that records the result. If only half of a
finding was fixed, say which half — that is how `vg-072` came to exist after
`vg-068` closed.

---

## 5. Where to look

Untested surface is worth more than re-testing known ground. Worked through on
this pass:

- **Editor:** every `Insert` item; double-click and type on a text object;
  the `Run text` field round trip; `W`/`H`; drag; arrow nudge (plain and
  Shift); duplicate; rename from the layer list; hide; lock; group from a
  canvas multi-select; `Ctrl+N`; `File > Open library` with and without an
  edit; the `DATA` and `STYLE` tabs; `Aspect ratio`; the palette's solid and
  gradient paints; `Apply trio`; the `+`/`Assets`/`Settings` rail panes.
- **Player:** first load with no theme; one theme; two themes (the chooser);
  with the host killed mid-stream; at 390, 844×390, 768×1024, 1280×800; the
  sensor strip; the off-artboard count.
- **Host/settings:** `/settings`; each drive dropdown; the active theme; the
  pairing link.
- **Packaging:** `Release package` (answer `patch`), `Save package`,
  `Import package`, and the export→import round trip.

Read [`probe-notes.md`](probe-notes.md) before trusting any "nothing happened".

---

## 6. When you are done

- Library restored, nothing left in `git status` that is yours but the backlog.
- `node scripts/backlog-check.mjs` green.
- Anything you found and then refuted is **withdrawn into the archive with the
  refutation in the detail**, not deleted — see `tester-brief.md`.
