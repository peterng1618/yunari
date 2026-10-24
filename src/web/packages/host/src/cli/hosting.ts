import type { HostingState } from "../server.js";
import { isLoopbackHost } from "./args.js";
import { type ListenableServer, lanAddress } from "./net.js";

/**
 * The one listener, and the two addresses it can be told to sit on.
 *
 * Moving it is a rebind rather than a second socket, because two servers cannot
 * share a port — `0.0.0.0` already includes `127.0.0.1` — and because §145 wants
 * one exposed thing, not two.
 *
 * **The port never moves.** `listenWithFallback` is right at startup and wrong
 * here: a rebind that landed on the next free port would change the editor's own
 * origin under the page that asked for it, and every display's URL with it. So a
 * refused interface is answered with a reason and the old binding is restored.
 */

export interface HostBinding {
  /** Whether the host is serving the LAN, without asking the OS for an address.
   *  A poll that only needs this must not pay `state()`'s route query. */
  readonly isLan: () => boolean;
  /** The state the host reports to the editor: what it is bound to now.
   *
   *  Async because the address is: ranking the adapters asks the OS which one
   *  carries the default route, and Node exposes that through no synchronous
   *  call (`vg-171`). */
  readonly state: () => Promise<HostingState>;
  /** Rebinds on the same port. Resolves false, with a reason, when the new
   *  interface will not take that port — the old binding is restored.
   *
   *  **Call it only once the answer that asked for the move is on the wire.**
   *  One server cannot rebind while the response that asked it to rebind is on
   *  its socket: `close()` waits for that connection, and that connection
   *  waits for the response. */
  setLan(
    on: boolean,
  ): Promise<
    { readonly ok: true } | { readonly ok: false; readonly reason: string }
  >;
  /** Resolves when no move is in flight, so a reader that follows a move sees
   *  where it landed rather than where it started. */
  idle(): Promise<void>;
}

export function createHostBinding(
  server: ListenableServer,
  initial: { readonly port: number; readonly host: string },
): HostBinding {
  const port = initial.port;
  let host = initial.host;
  /** The last move this binding refused, in its own words. A refusal cannot
   *  ride the answer that asked for the move — see `setLan` — so it is state
   *  the next read carries, cleared by the next move that lands. */
  let refusal: string | null = null;
  let moving: Promise<void> = Promise.resolve();

  const state = async (): Promise<HostingState> => ({
    lan: !isLoopbackHost(host),
    address: isLoopbackHost(host) ? null : ((await lanAddress()) ?? null),
    port,
    refusal,
  });

  const bind = (next: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const onError = (error: Error): void => {
        server.removeListener("listening", onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.removeListener("error", onError);
        resolve();
      };

      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, next);
    });

  async function move(
    next: string,
  ): Promise<
    { readonly ok: true } | { readonly ok: false; readonly reason: string }
  > {
    // **Every connection goes, not only the idle ones.** `close()` waits for
    // the connections that are still answering, and a request in flight cannot
    // end until this move does, so waiting on it is a deadlock rather than a
    // delay: the move never settles, the rebind never runs, and the host never
    // listens again (`vg-174`, ruled 2026-10-12 — destroy the remaining
    // connections rather than let `close` wait for them). What that spends is
    // what `vg-173` measured: whichever request was unlucky gets an empty
    // reply, and the editor's bounded re-read recovers. Streams a display is
    // holding are the host's to close, and it closes them before calling in.
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));

    try {
      await bind(next);
      host = next;
      refusal = null;
      return { ok: true };
    } catch (error) {
      // Put it back where it was, so a refusal is not also an outage.
      await bind(host);
      refusal = `Port ${port} is not free on ${next}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      return { ok: false, reason: refusal };
    }
  }

  return {
    isLan: () => !isLoopbackHost(host),

    state,

    idle: () => moving,

    setLan(on) {
      const next = on ? "0.0.0.0" : "127.0.0.1";
      if (next === host) return Promise.resolve({ ok: true });

      // `moving` is assigned in this tick, before the move's first await, so a
      // reader that arrives while the socket sits between bindings still waits
      // rather than reading the binding that is on its way out.
      const started = move(next);
      moving = started.then(
        () => undefined,
        () => undefined,
      );
      return started;
    },
  };
}
