import {
  type HostingAnswer,
  mintPairingCode,
  type PairingCode,
  readHosting,
  readPairingCode,
  setLan,
} from "../hosting-client.js";

/** What the shell knows about the host behind it, and the one place that answers
 *  "is this editor publishing".
 *
 *  `unknown` is the initial state and a real one: until the host has answered,
 *  the editor has nothing to say about publishing, and a reader that treated it
 *  as "not live" would be inventing a fact. `absent` is a build with no host at
 *  all — the same silence, for a different reason. */
export type HostingSnapshot =
  | { readonly kind: "unknown" }
  | { readonly kind: "absent" }
  | {
      readonly kind: "known";
      readonly answer: HostingAnswer;
      /** The one-time code a phone types, which is what the card prints beside
       *  the address and the symbol. Read from the host, never minted here: the
       *  host owns the window, and a read that arrives while the LAN is off
       *  would mint a code nobody can see. */
      readonly pairing: PairingCode | undefined;
      /** A refusal, in the host's own words. */
      readonly reason: string | undefined;
      /** The state a toggle is asking for, while the host is deciding. */
      readonly pending: boolean | undefined;
    };

/** The host's answer, owned outside React: the header's control and Task 4's
 *  status bar read one subscription rather than each asking the host. Unknown
 *  until the host answers, and it renders no claim until then.
 *
 *  **The editor is the session's only writer, by design, and this store never
 *  polls** (`vg-214`). The host is asked once, in the constructor, and again only
 *  where this store's own `toggle()` writes — so a change made outside the editor
 *  (the host CLI's `setLan`, or a restart) is not observed until the page reloads,
 *  and the live indicator renders a stale claim meanwhile. That is a boundary and
 *  not a gap: an editor polling the host would be a timer the host owns, which
 *  this repo's own rule places with the host (providers acquire; the host owns
 *  scheduling), and it would race the editor's own writes for no benefit.
 *
 *  When the staleness is judged worth fixing the direction is push, never poll:
 *  the host — the only process that can observe its own `setLan` or a restart —
 *  announces the change on a connection the editor already holds, and this store
 *  re-reads. That connection is the sample stream at `/ws`, which the editor
 *  opens only in `live` mode; in `preview` mode it holds none, so the fix would
 *  have to establish one before the host could push on it. */
export class HostingStore {
  #snapshot: HostingSnapshot = { kind: "unknown" };
  readonly #listeners = new Set<() => void>();

  /** The host is asked once, here, so every reader — the header's control and
   *  Task 4's status bar — shares one answer rather than each asking. */
  constructor() {
    void this.read();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly get = (): HostingSnapshot => this.#snapshot;

  #emit(next: HostingSnapshot): void {
    this.#snapshot = next;
    for (const listener of this.#listeners) listener();
  }

  /** The code, read only while the host is serving the LAN: that is the only
   *  state the card draws it in, and a host on loopback has no display to pair. */
  async #code(answer: HostingAnswer): Promise<PairingCode | undefined> {
    return answer.lan ? await readPairingCode() : undefined;
  }

  /** The host's first answer. An unread host is `absent`, not "not live". A
   *  build with no `fetch` at all reaches the same place, which is why this
   *  catches rather than letting the constructor's promise reject unhandled. */
  async read(): Promise<void> {
    try {
      const answer = await readHosting();
      if (answer === undefined) {
        this.#emit({ kind: "absent" });
        return;
      }
      this.#emit({
        kind: "known",
        answer,
        pairing: await this.#code(answer),
        reason: undefined,
        pending: undefined,
      });
    } catch {
      this.#emit({ kind: "absent" });
    }
  }

  /** Replaces the code the card shows with a fresh window.
   *
   *  The owner's action, not a read: the host mints only here, and the previous
   *  code stops being the answer. A refusal leaves the old code in place rather
   *  than blanking a window the host may still hold. */
  async renew(): Promise<void> {
    const current = this.#snapshot;
    if (current.kind !== "known" || !current.answer.lan) return;

    const pairing = await mintPairingCode();
    const latest = this.#snapshot;
    if (pairing === undefined || latest.kind !== "known") return;

    this.#emit({ ...latest, pairing });
  }

  /** Turns the LAN on or off, and reads where the host landed.
   *
   *  A `200` means the host accepted the request, not that it moved: it answers
   *  first and rebinds afterwards, so the state it asked for — and a refusal, if
   *  it made one — is on the read that follows rather than in the PUT's body. */
  async toggle(): Promise<void> {
    const current = this.#snapshot;
    if (current.kind !== "known") return;
    const wanted = !current.answer.lan;
    this.#emit({ ...current, pending: wanted, reason: undefined });

    const outcome = await setLan(wanted);
    if (!outcome.ok) {
      // The host is the only thing that knows where its binding ended up: a
      // refusal restores the old one, which is not necessarily where the button
      // was pointing.
      const now = await readHosting();
      const answer = now ?? current.answer;
      this.#emit({
        kind: "known",
        answer,
        pairing: await this.#code(answer),
        reason: outcome.reason,
        pending: undefined,
      });
      return;
    }

    const { answer } = outcome;
    this.#emit({
      kind: "known",
      answer,
      // Read after the move: a code fetched before the LAN came on is one the
      // host may have replaced, and the card shows this the moment it opens.
      pairing: await this.#code(answer),
      reason: answer.refusal ?? undefined,
      pending: undefined,
    });
  }
}
