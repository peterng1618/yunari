# Yunari status

Updated: 2026-10-28
Branch: `peterng1618/lian-li-9.2-monitor-support` (worktree `lian-li-9.2-monitor-support`)

## Current objective

USB panel support: a Lian Li 9.2" LCD (`1CBE:A092`) driven by the host from the product's own player page, behind a `PanelDevice` port so another panel is a table row (decision `0130`).

## Active work

- **Panel support lands in this worktree, not on `main`:** the protocol, `usb` transport, devtools rasteriser, frame runner and panel manager live in `host/src/panels/`, plus a `"panel"` display kind.
- **Proven on the real device:** the host's own runtime opened `1CBE:A092` and logged `sent a 464x1920 frame`, and a second claimant is refused while it holds the interface.
- **Geometry settled at 464×1920 portrait**, not the product page's 1920×462: two hardware-tested drivers agree, and rendered geometry measures to the authored pixel.
- **The renderer is the real player**, not a second scene tree: a hidden Chrome screenshots the player page over the devtools protocol with no added dependency.
- **Only the glass is untested:** the frame was sent, never seen, because L-Connect was stopped for the probe and the panel is not a desktop display.

## Last completed change

- **Panels are a third display kind driven behind a device port:** `PanelDevice`, the TUR USB protocol, the `usb` transport, a devtools rasteriser, a runner that skips identical frames, and a manager owning one interval per panel.
- **The record owns the hardware identity:** `createPanel` refuses a second record for the same serial or USB ids, and the reader drops a panel record with no usable hardware and hardware smuggled onto another kind.
- **Protocol measured, not assumed:** `getVersion` answered `lianli92_0001_2026041401`, and DES-CBC runs through `node-forge` at 504 bytes because `node:crypto` refuses it.
- **Recording:** decision `0130`, and `usb` 3.2.1 (MIT) in the notices and dependency docs.
- **Proof:** `npm run gate` exit 0 — 64 panel and display tests pass, and the host suite is 129 files / 2191 passed.

## Next

1. Look at the panel and confirm the picture appears, and in which orientation.
2. Add the Host settings surface for choosing an attached panel.
3. Resume the backlog-drain plan at Phase 0.

## Blockers / unverified

- **The frame on the glass is unverified:** frames were sent and acked, but no eye confirmed the picture, and orientation is the one thing a driver table cannot prove.
- **Panel cost is unmeasured:** one frame is ~10 KB and one capture ~45 ms, but no sustained run was profiled.
- **L-Connect holds the panel:** it must be closed, or its services stopped, before the host can claim the device.
