import { Popover } from "@base-ui/react/popover";
import { useEffect, useState, useSyncExternalStore } from "react";
import { displayUrl } from "../hosting-client.js";
import type { PublishSwitch } from "../publish-client.js";
import { useActiveShortcuts } from "../shortcut-manager/bindings.js";
import {
  shortcutLabel,
  shortcutSpokenLabel,
} from "../shortcut-manager/display.js";
import { uiCopy } from "../ui-copy.js";
import { documentNameOf } from "./bridge.js";
import type { HostingStore } from "./hosting-store.js";
import { QrCode } from "./qr-symbol.js";
import type { EditorActionFacade } from "./session-facade.js";
import type { PublishSurfaceStore } from "./shell-stores.js";

/**
 * The editor's one filled accent button, and behind it everything publishing
 * has to say.
 *
 * **The button opens the surface; it is not the host switch.** §7.1 gives the
 * header one primary control and the facts live behind a press — but a control
 * that turned the LAN off when an author pressed it to read the phone address
 * would lose the fact the address exists to carry, mid-presentation. So the
 * press is free of side effects, and turning the host on and off is its own
 * control inside the popover, where the §145 warning is on screen beside it.
 *
 * Everything is read from the host. In the browser the editor's own URL is
 * `127.0.0.1`, so an address composed here would be an address no phone can
 * reach — and it would look right. The `HostingStore` owns the answer and this
 * control only reads it, so a second reader (Task 4's status bar) sees the same
 * one.
 */
/** The one control that carries the warning, so a fixed id is the whole address. */
const WARNING_ID = "yunari-publish-warning";

/** When the code stops being the answer, in the reader's own clock: the host
 *  answers an instant, and an instant is not what a person reads. A value the
 *  clock cannot parse is shown as it arrived rather than as a wrong time. */
function expiryOf(at: string): string {
  const when = new Date(at);

  return Number.isNaN(when.getTime())
    ? at
    : when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function PublishControl({
  session,
  publish,
  hosting,
  surface,
}: {
  /** The open document, asked what a display would be shown. */
  readonly session?: EditorActionFacade | undefined;
  /** The transport, owned by `editor-main`. The switch turns it on and off; it
   *  never has to hand over a document to do either. */
  readonly publish?: PublishSwitch | undefined;
  /** What the host is doing, owned by the shell so the status bar reads it too. */
  readonly hosting: HostingStore;
  /** Whether this popover is showing. The header's chord reaches it from
   *  outside React, so the control subscribes rather than holding the flag. */
  readonly surface: PublishSurfaceStore;
}): React.JSX.Element | null {
  const state = useSyncExternalStore(
    hosting.subscribe,
    hosting.get,
    hosting.get,
  );
  const surfaceOpen = useSyncExternalStore(
    surface.subscribe,
    surface.get,
    surface.get,
  );
  // The chord is printed beside the control, and it is printed from the live
  // binding table: the mark and the act the mark runs are one row of one table
  // (`publish.surface`), so a rebind reaches the header too.
  useActiveShortcuts();
  const chord = shortcutLabel("publish.surface");
  /** What a display is showing: the document that goes out, or nothing when the
   *  library does not hold this one. */
  const [showing, setShowing] = useState<{ readonly name: string } | undefined>(
    undefined,
  );

  useEffect(() => {
    if (session === undefined) return;

    const read = (): void => {
      const document = session.publishableDocument();
      setShowing(
        document === undefined
          ? undefined
          : {
              name: documentNameOf({
                name: document.envelope.metadata?.name,
                id: document.id,
              }),
            },
      );
    };
    read();
    return session.subscribeDocumentChange(read);
  }, [session]);

  // Publishing follows the LAN, because that is the whole of §145's opt-in: a
  // host serving loopback has nothing to publish to, and turning the LAN off
  // takes the document back.
  const known = state.kind === "known" ? state : undefined;
  const open = known?.answer.lan === true;

  useEffect(() => {
    if (!open || publish === undefined) return;

    publish.start();
    return () => {
      void publish.stop();
    };
  }, [open, publish]);

  // Unknown is a real state, not a blank: until the host has answered the editor
  // has nothing to say. No host at all says the same nothing, for its own
  // reason. Neither is drawn as "not publishing".
  if (known === undefined) return null;

  const { answer, reason, pending } = known;
  // **The address is the host's, not a credential's.** It exists only while the
  // LAN is on, so turning it off takes the URL off the screen rather than leaving
  // a stale one behind — and it is drawn whether or not a code has been read,
  // because the address is what a display has to reach.
  const shown =
    open && answer.address !== null && answer.port !== null
      ? { address: answer.address, port: answer.port }
      : undefined;
  const code = known.pairing;
  const label = open
    ? uiCopy.publish.stop
    : pending === true
      ? uiCopy.publish.starting
      : uiCopy.publish.start;

  return (
    <Popover.Root open={surfaceOpen} onOpenChange={(next) => surface.set(next)}>
      {/* One name, whatever the host is doing: the control opens a surface, and
          a bar that said `Stop publishing` would be promising to stop rather
          than to show. What the host is doing is the surface's own reading. */}
      <Popover.Trigger
        type="button"
        className="editor-shell-primary"
        data-yunari-publish=""
      >
        {uiCopy.publish.start}
        {/* §7.1's mark, and plan 2 left it off because there was nothing to
            run. It is the same action id the press answers to through the
            chord, so the mark and the act cannot disagree — a printed chord
            that ran nothing is the state this row exists to end. */}
        {chord === "" ? null : (
          <kbd
            className="editor-shell-primary-key"
            data-yunari-publish-chord=""
            aria-label={shortcutSpokenLabel("publish.surface")}
          >
            {chord}
          </kbd>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          sideOffset={6}
          align="end"
          // **Eight pixels of the window are never the popup's.** Base UI's
          // default avoids collisions against the nearest clipping container,
          // and the header's own content overflows a 390px window — so the
          // surface was clamped to the overrun rather than to the window and
          // ended a few pixels past it. Asking for the inset states the fact
          // this surface owes: it is reachable inside the window it was opened
          // in.
          collisionPadding={8}
          // **`side` is named even though the surface stays below the trigger.**
          // Base UI 1.8 only turns on alignment-axis shifting when the side
          // avoidance is `"shift"` (`crossAxisShiftEnabled` in
          // `useAnchorPositioning`); with the default `"flip"`, `align: "shift"`
          // alone left the popup at the trigger's own off-screen right edge —
          // why a 390px window still measured 403px. `side: "shift"` keeps the
          // popover under the header and still never flips it.
          collisionAvoidance={{ side: "shift", align: "shift" }}
          // **`sticky` is what lets the shift go all the way.** Without it
          // Base UI adds floating-ui's `limitShift`, which stops the popup once
          // it would stop overlapping the anchor — and a trigger that sits past
          // the window's right edge leaves the popup parked against that edge,
          // still outside. Sticky drops the limiter so the surface can reach the
          // window it was opened in; the popover still tracks the trigger.
          sticky
          // **The viewport is the boundary, not the nearest clipping ancestor.**
          // An empty list is floating-ui's own spelling for the viewport (Base
          // UI passes it through); the ancestor it would otherwise pick is the
          // document, whose box a header that overflows the window widens.
          collisionBoundary={[]}
          className="editor-shell-positioner"
        >
          <Popover.Popup
            className="editor-shell-publish-popup"
            aria-label={uiCopy.publish.surface}
          >
            {/* The choice the warning is about, so the warning is bound to the
                control that makes it rather than to the one that opens this. */}
            <button
              type="button"
              className="editor-shell-publish-toggle"
              data-yunari-host-switch=""
              aria-pressed={open}
              aria-describedby={WARNING_ID}
              disabled={pending !== undefined}
              onClick={() => {
                void hosting.toggle();
              }}
            >
              {label}
            </button>
            <span id={WARNING_ID} className="editor-shell-publish-warning">
              {uiCopy.publish.warning}
            </span>
            {reason === undefined ? null : (
              <span className="editor-shell-publish-reason" role="alert">
                {reason}
              </span>
            )}
            {/* Only once the shell has a document to read: a control drawn
                without one would say "save this theme" about no theme. */}
            {session === undefined || !open ? null : (
              <span className="editor-shell-publish-live">
                {showing === undefined
                  ? uiCopy.publish.unsaved
                  : uiCopy.publish.live(showing.name)}
              </span>
            )}
            {shown === undefined ? null : (
              <>
                <span className="editor-shell-publish-label">
                  {uiCopy.publish.address}
                </span>
                <code className="editor-shell-publish-url">{`https://${shown.address}:${shown.port}`}</code>
                {/* https is what makes the display a secure context — the wake
                    lock and fullscreen are gated on it — so it is the address
                    printed. The plain one is what a device that has not
                    installed the root certificate can still open
                    (`docs/decisions/0076`). */}
                <span className="editor-shell-publish-note">
                  {`Fallback http://${shown.address}:${shown.port}`}
                </span>
                {code === undefined ? null : (
                  <>
                    {/* The code in type, because the symbol beside it needs a
                        camera: one mint, two presentations. */}
                    <span className="editor-shell-publish-label">
                      {uiCopy.publish.code}
                    </span>
                    <span
                      className="editor-shell-publish-code"
                      data-yunari-pair-code=""
                    >
                      {code.code}
                    </span>
                    <span className="editor-shell-publish-expiry">
                      {uiCopy.publish.expires(expiryOf(code.expiresAt))}
                    </span>
                    {/* **The symbol, which now carries the code rather than a
                        credential.** The page it opens asks for nothing else,
                        so a phone with a camera pairs in one scan and the
                        credential never appears in a URL. */}
                    <QrCode
                      text={displayUrl(shown, code.code)}
                      modulePitch={5}
                    />
                  </>
                )}
                <span className="editor-shell-publish-note">
                  {uiCopy.publish.reserveAddress}
                </span>
              </>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
