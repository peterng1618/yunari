# Yunari status

Updated: 2026-10-28
Branch: `peterng1618/lian-li-9.2-monitor-support` (worktree `lian-li-9.2-monitor-support`)

## Current objective

USB panel support: a Lian Li 9.2" LCD (`1CBE:A092`) driven by the host from the product's own player page, behind a `PanelDevice` port so another panel is a table row (decision `0130`).

## Active work

- **Panel support lands in this worktree, not on `main`:** the protocol, `usb` transport, devtools rasteriser, frame runner and panel manager live in `host/src/panels/`, plus a `"panel"` display kind.
- **The panel record is live in the real app folder:** `lian-li-9-2` on `1CBE:A092` with `rotation: 90`, showing the starter theme `27c605ef`, written through the host's own API.
- **Rotation 90 is the reading orientation**, chosen from a rendered A/B: the starter is 16:9 and the wire is 1:4 portrait, so upright fills ~92% of the glass and 0 fills 14%.
- **The renderer is the real player**, not a second scene tree: a hidden Chrome screenshots the player page over the devtools protocol with no added dependency.
- **The panel is live again after the reboot:** with L-Connect stopped the interface was claimed and 32 frames went out in ~35s with zero `Cancelled` lines, so the wedge cleared (`vg-773` still records the unexplained cause).
- **The glass is still unverified:** the expected picture is `C:\tmp\yunari-render\expected-panel.jpg`, the rotation-90 render at exactly 464×1920.

## Last completed change

- **The panel routes are tested:** `GET/POST /api/displays/panels` — attached list, add-and-start, unknown model refused before the write, duplicate hardware 409, delete stops the runner, and 404 on a host with no manager.
- **A host with no panel manager refuses the route:** it would otherwise write a record nothing can drive, and `attachedPanels` is injectable so a case holds a fixture rather than this machine's USB.

## Next

1. Look at the glass and confirm the picture and its orientation.
2. Add the Host settings surface for choosing an attached panel.
3. Resume the backlog-drain plan at Phase 0.

## Blockers / unverified

- **The glass is unverified:** frames flow, but no eye has confirmed the picture or that rotation 90 reads upright on the physical strip.
- **Panel cost is unmeasured:** one frame is ~10 KB and one capture ~45 ms, but no sustained run was profiled.
- **L-Connect must stay stopped:** it relaunches on boot and holds the interface; the host reports the "another program holding it" message when it wins the race.
