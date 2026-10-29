import { type ThemeLoadCode, ThemeLoadError } from "./theme-loader.js";

/** Typed package-local visible player copy (§35). Authored theme text, telemetry
 * values and developer errors stay outside this module. */
export const uiCopy = {
  /** A theme that fails to load is the one user-visible failure the player
   *  owns, and it is the only one that replaces the whole display. It is
   *  written as a page rather than as a line, because the reader here is
   *  looking at a wall or a phone and not at a log: two ways on from here, and
   *  the host's own reason kept beside them.
   *
   *  It must not read like `connection` or `cropped` below, which describe a
   *  *part* of a display that is otherwise working. A gap says "3 of 40
   *  sensors have no reading" and leaves a chart on screen; this says the
   *  screen is empty, because it is (§97's instinct, same shape). */
  loadFailure: {
    title: "This display has nothing to show",
    lede: "Yunari could not load the theme this display was pointed at.",
    /** Labels the host's own words as the diagnostic they are, so the sentence
     *  above is what a reader takes and this is what an owner is given. */
    reasonLabel: "Reason",
    retry: "Try again",
    /** `/` on a host is its theme chooser, or whichever theme it holds — either
     *  way the one place a reader can change what this display shows. */
    host: "Go to the host",
    /** A tab is how a reader with several displays open tells which one broke. */
    documentTitle: "Yunari — nothing to display",
    /**
     * The reason line, one sentence per cause the load boundary can name.
     *
     * A display is read at arm's length by someone who is not a developer, so
     * this says what happened rather than what threw. Keyed by `ThemeLoadCode`
     * rather than free-written per call site, so a new cause cannot reach the
     * screen without a sentence existing for it: the mapping below is a
     * lookup, and a code with no entry here does not compile.
     *
     * `detail` is the one token a sentence may name — an HTTP status a reader
     * can quote to an owner, a validator code they can look up. A third
     * party's words are never one of them.
     */
    reason: {
      "missing-id": (): string => "A theme id is required.",
      "invalid-id": (): string =>
        "The theme id in this address is not one the host can be asked for.",
      "not-found": withDetail("The host has no theme with that id"),
      "host-failed": withDetail("The host could not produce that theme"),
      // The measured defect: the host was not running, and V8's parse error
      // said the theme file was corrupt. It names what actually arrived.
      "not-a-theme": (): string =>
        "The host did not answer with a theme — it may not be running.",
      "invalid-theme": withDetail(
        "The host answered with a theme this display cannot show",
      ),
      "font-unavailable": withDetail(
        "The host could not supply this theme's font files",
      ),
    } satisfies Readonly<
      Record<ThemeLoadCode, (detail: string | undefined) => string>
    >,
    /** A cause this build does not recognise — a bug here, or a browser that
     *  refused something. A sentence is still owed to the reader, and what
     *  actually happened is in the console, not here. */
    unknown: "This display could not start, and the reason is not known.",
  },
  connection: {
    connecting: (keyCount: number): string =>
      `Connecting to the host — ${keyCount} sensors requested`,
    reconnecting:
      "Lost the host. Values shown are the last received, not current.",
    refused: (detail: string | undefined): string =>
      `The host is not compatible with this display${detail === undefined ? "" : `: ${detail}`}`,
  },
  /** Why sensors on this display have no reading. `groups` is already ordered
   *  and bounded by the caller: one entry per distinct cause, carrying how
   *  many sensors share it, so a cause said four times is said once. */
  availability: {
    notice: (
      unread: number,
      total: number,
      groups: readonly { readonly count: number; readonly reason: string }[],
      hiddenReasons: number,
    ): string =>
      `${unread} of ${total} sensors have no reading — ` +
      [
        ...groups.map((group) => `${group.count}× ${group.reason}`),
        ...(hiddenReasons > 0 ? [`+${hiddenReasons} more reasons`] : []),
      ].join(", "),
    /** Stands in for the transport address a provider named in its reason. */
    address: "its configured address",
  },
  /**
   * The three controls a reader operates, and what a control says when it
   * cannot do its job (`display-controls.ts`).
   *
   * A refusal is written where the control is, so it names the thing the reader
   * can act on rather than a mechanism: the wake lock's sentence names the
   * *origin* the display was served from, because that is what a phone at
   * `http://<lan-ip>:<port>` lacks and no setting on the phone can change it.
   * The host now serves https beside http on the same port, from a certificate
   * it issues itself (`vg-580`), so a reader has two
   * things to act on — the scheme and the root — and both are named.
   * The dimmer's label names the overlay and says outright that it is not the
   * screen's own brightness — a browser cannot set that, and a control that
   * implied otherwise would be lying to the reader in front of it.
   */
  controls: {
    /** Names the bar itself, for a reader who arrives at it by keyboard. */
    group: "Display controls",
    fullscreen: {
      label: "Fullscreen",
      /** iPhone Safari has no `Element.requestFullscreen`; Task 25.6's
       *  standalone mode is what that client gets instead, so it is named. */
      unavailable:
        "This browser cannot show a page fullscreen. Adding the display to the home screen is how the browser's own chrome is hidden here.",
      refused: "Fullscreen was refused. Try again.",
    },
    keepAwake: {
      label: "Awake",
      /** The origin, not the phone: this is the half a reader can act on, and
       *  the host prints both the address to install its certificate from and
       *  the `https` origin to reload. */
      unavailable:
        "This browser has no wake lock. This display is not a secure origin: it was opened over http, or the host's certificate is not installed on this phone. Use the host's https address, install its certificate, then reload.",
      /** The API exists and the client said no — a policy, a battery saver, a
       *  request with no user activation left. The reader has to be told the
       *  lock is not held, because the button's own state is the only place
       *  that could be said and "pressed" would be untrue. */
      refused:
        "This browser would not hold the screen awake, so it is not being held. This display's own screen-off setting still applies.",
    },
    dim: {
      label:
        "Dim the display — an overlay over the picture, not the screen's own brightness",
    },
  },
  /**
   * The display's own theme chooser (`theme-chooser.ts`). A refusal is the
   * host's sentence wherever it has one; these are the two cases where the
   * answer did not arrive at all.
   */
  chooser: {
    label: "Theme",
    listFailed: "Could not list this host's themes.",
    chooseFailed: "Could not change this display's theme.",
    idRequired: "A theme id is required.",
  },
} as const;

/** A sentence, plus the one token that identifies which case it was. */
function withDetail(sentence: string): (detail: string | undefined) => string {
  return (detail) =>
    detail === undefined ? sentence : `${sentence} (${detail}).`;
}

/**
 * The sentence a reader is given, for a cause the player can name.
 *
 * Every failure on the load-failure page arrives as a `ThemeLoadError`, so
 * this is a lookup rather than a judgement. Anything else is `unknown`'s
 * sentence: this ran as `error.message` and printed V8's parse error on a wall
 * for a host that was simply not running, and a display that shows a raw
 * exception string has stopped being a display.
 */
export function loadFailureReason(error: unknown): string {
  if (!(error instanceof ThemeLoadError)) {
    return uiCopy.loadFailure.unknown;
  }
  return uiCopy.loadFailure.reason[error.code](error.detail);
}
