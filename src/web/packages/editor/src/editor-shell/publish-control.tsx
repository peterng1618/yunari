import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { controlStateAttributes } from "../components/ui/control-state.js";
import { Dialog } from "../components/ui/dialog.js";
import { displayUrl } from "../hosting-client.js";
import { useActiveShortcuts } from "../shortcut-manager/bindings.js";
import {
  shortcutLabel,
  shortcutSpokenLabel,
} from "../shortcut-manager/display.js";
import { AssignChoice } from "../store-mode/assign-display.js";
import { uiCopy } from "../ui-copy.js";
import type { HostingStore } from "./hosting-store.js";
import { QrCode } from "./qr-symbol.js";
import type { EditorActionFacade } from "./session-facade.js";
import type { PublishSurfaceStore } from "./shell-stores.js";

/**
 * The editor's one filled accent button, and behind it everything publishing
 * has to say.
 *
 * **The button opens the surface; it is not the host switch.** The header rule
 * gives the header one primary control and the facts live behind a press — but
 * a control that turned the LAN off when an author pressed it to read the phone
 * address would lose the fact the address exists to carry, mid-presentation. So
 * the press is free of side effects, and turning the host on and off is its own
 * control inside the surface, where the §145 warning is on screen beside it.
 *
 * **The surface is the assign dialog, with publishing below the choice.** The
 * display dropdown is the same choice a theme card opens, so a display can be
 * assigned from either place and the pair-new row is at the end of both lists.
 *
 * Everything is read from the host. In the browser the editor's own URL is
 * `127.0.0.1`, so an address composed here would be an address no phone can
 * reach — and it would look right. The `HostingStore` owns the answer and this
 * control only reads it, so a second reader (Task 4's status bar) sees the same
 * one.
 */

/** The one control that carries the warning, so a fixed id is the whole address. */
const WARNING_ID = "yunari-publish-warning";

/** What is left of the window, as mm:ss in the reader's own clock. The host
 *  answers an instant; a countdown is what a person can watch run out. An
 *  instant the clock cannot parse, or one that has passed, answers nothing and
 *  the card says the code has expired rather than printing a wrong duration. */
export function remainingOf(at: string, now: number): string {
  const when = Date.parse(at);
  if (Number.isNaN(when)) return "";

  const seconds = Math.max(0, Math.ceil((when - now) / 1000));
  if (seconds === 0) return "";

  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function PublishControl({
  hosting,
  surface,
  session,
}: {
  /** What the host is doing, owned by the shell so the status bar reads it too. */
  readonly hosting: HostingStore;
  /** Whether this surface is showing. The header's chord reaches it from
   *  outside React, so the control subscribes rather than holding the flag. */
  readonly surface: PublishSurfaceStore;
  /** The open theme's own session: the display list and the assignment are the
   *  document's, and the surface only asks. Absent with no document, and the
   *  choice is then not drawn. */
  readonly session?: EditorActionFacade | undefined;
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
  const known = state.kind === "known" ? state : undefined;
  const answer = known?.answer;
  const open = answer?.lan === true;

  // **A countdown only while the surface is on screen and a window is live.**
  // The host owns the deadline; this only reads the clock, so a closed surface
  // costs no timer and a stale one catches up the moment it opens again.
  const [clock, setClock] = useState<number>(() => Date.now());
  const [minting, setMinting] = useState(false);
  const shownCode = known?.pairing;
  const expiresAt = shownCode?.expiresAt;

  useEffect(() => {
    if (!surfaceOpen || expiresAt === undefined) return;

    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [surfaceOpen, expiresAt]);

  // **The address is what a display pairs on.** The name is offered beside it
  // where the host answers one, because it survives a change of IP — but only
  // a device that resolves it can use it, and nothing on this host advertises
  // the name over mDNS, so preferring it made the symbol and the printed URL
  // fail on a phone that had no such resolver. A display stores the host's name
  // from `/api/host` when it pairs, so the re-find ladder still has it.
  const shown =
    answer !== undefined &&
    open &&
    answer.address !== null &&
    answer.port !== null
      ? {
          host: answer.address,
          address: answer.address,
          name: answer.name ?? undefined,
          port: answer.port,
        }
      : undefined;
  const themeId = session?.publishableDocument()?.id;
  const listDisplays = session?.listDisplays;
  const assignThemeTo = session?.assignThemeTo;
  // **Memoised because `AssignChoice` reads the list when its client changes.**
  // This control re-renders once a second while its countdown runs, and a fresh
  // client each render would re-read the host's displays every second.
  const assignClient = useMemo(
    () =>
      listDisplays === undefined || assignThemeTo === undefined
        ? undefined
        : {
            listDisplays: () => listDisplays(),
            assign: (display: string) => assignThemeTo(display),
          },
    [listDisplays, assignThemeTo],
  );
  const pairNew = useMemo(() => {
    const host = shown?.host;
    const port = shown?.port;
    return assignClient === undefined
      ? undefined
      : {
          url: async (): Promise<string | undefined> =>
            host === undefined || port === undefined
              ? undefined
              : `https://${host}:${port}/pair`,
          unavailable: uiCopy.publish.pairUnavailable,
        };
  }, [assignClient, shown?.host, shown?.port]);

  // Unknown is a real state, not a blank: until the host has answered the editor
  // has nothing to say. No host at all says the same nothing, for its own
  // reason. Neither is drawn as "not publishing".
  if (known === undefined) return null;

  const { reason, pending } = known;
  const code = known.pairing;
  const left = code === undefined ? "" : remainingOf(code.expiresAt, clock);
  const label = open
    ? uiCopy.publish.stop
    : pending === true
      ? uiCopy.publish.starting
      : uiCopy.publish.start;

  return (
    <>
      {/* The chord is not printed in the header. The control's own title and
          spoken label carry it, so the bar stays one word and the caps are not
          a second, detached label beside the button. */}
      {/* One name, whatever the host is doing: the control opens a surface, and
          a bar that said `Stop publishing` would be promising to stop rather
          than to show. What the host is doing is the surface's own reading.
          The press is synchronous (it opens this dialog), so it has no busy or
          outcome state of its own. */}
      <button
        type="button"
        className="editor-shell-primary"
        data-yunari-publish=""
        aria-haspopup="dialog"
        aria-expanded={surfaceOpen}
        title={
          chord === ""
            ? uiCopy.publish.assign
            : `${uiCopy.publish.assign} (${chord})`
        }
        aria-label={
          chord === ""
            ? undefined
            : `${uiCopy.publish.assign} (${shortcutSpokenLabel("publish.surface")})`
        }
        onClick={() => surface.set(true)}
      >
        {uiCopy.publish.assign}
      </button>
      <Dialog
        open={surfaceOpen}
        onOpenChange={(next) => surface.set(next)}
        label={uiCopy.publish.assign}
        closeLabel={uiCopy.store.assign.close}
        className="editor-shell-publish-dialog"
      >
        <p className="editor-shell-dialog-lead">{uiCopy.publish.assign}</p>
        {/* The theme's destination, above the surface's own switch: assigning
            is why the control is pressed, and the list carries the route for a
            display that has not paired yet. */}
        {assignClient === undefined || themeId === undefined ? null : (
          <AssignChoice
            themeId={themeId}
            client={assignClient}
            onAssigned={() => undefined}
            {...(pairNew === undefined ? {} : { pairNew })}
          />
        )}
        {/* The choice the warning is about, so the warning is bound to the
            control that makes it rather than to the one that opens this.
            A successful start is the pressed state itself, so there is no
            separate success outcome to keep. */}
        <button
          type="button"
          className="editor-shell-publish-toggle"
          data-yunari-host-switch=""
          aria-pressed={open}
          aria-describedby={WARNING_ID}
          disabled={pending !== undefined}
          {...controlStateAttributes(
            pending !== undefined
              ? "busy"
              : reason === undefined
                ? undefined
                : "failure",
          )}
          onClick={() => {
            void hosting.toggle();
          }}
        >
          {label}
        </button>
        <span
          id={WARNING_ID}
          className="editor-shell-publish-warning"
          data-yunari-copy=""
        >
          {uiCopy.publish.warning}
        </span>
        {reason === undefined ? null : (
          <span className="editor-shell-publish-reason" role="alert">
            {reason}
          </span>
        )}
        {shown === undefined ? null : (
          <>
            <span className="editor-shell-publish-label">
              {uiCopy.publish.address}
            </span>
            <code className="editor-shell-publish-url">{`https://${shown.host}:${shown.port}`}</code>
            {/* https is what makes the display a secure context — the wake
                lock and fullscreen are gated on it — so it is the address
                printed. The plain one is what a device that has not
                installed the root certificate can still open. */}
            <span className="editor-shell-publish-note">
              {uiCopy.publish.fallback(shown.address, shown.port)}
            </span>
            {shown.name === undefined ? null : (
              <span className="editor-shell-publish-note">
                {uiCopy.publish.stableName(shown.name, shown.port)}
              </span>
            )}
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
                  {left === ""
                    ? uiCopy.publish.expired
                    : uiCopy.publish.expiresIn(left)}
                </span>
                {/* The renewed code appearing is the success answer, and a
                    refusal is the dialog's own reason line; this control keeps
                    only the busy state it can show. */}
                <button
                  type="button"
                  className="editor-shell-publish-mint"
                  data-yunari-new-code=""
                  disabled={minting}
                  {...controlStateAttributes(minting ? "busy" : undefined)}
                  onClick={() => {
                    setMinting(true);
                    void hosting.renew().finally(() => setMinting(false));
                  }}
                >
                  {uiCopy.publish.newCode}
                </button>
                {/* **The symbol, which now carries the code rather than a
                    credential.** The page it opens asks for nothing else,
                    so a phone with a camera pairs in one scan and the
                    credential never appears in a URL. */}
                <QrCode
                  text={displayUrl(shown.host, shown.port, code.code)}
                  modulePitch={5}
                />
              </>
            )}
            <span className="editor-shell-publish-note">
              {uiCopy.publish.reserveAddress}
            </span>
          </>
        )}
      </Dialog>
    </>
  );
}
