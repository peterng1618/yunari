import { spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";
import { MAX_PORT_ATTEMPTS } from "./args.js";

/** Launch I/O: bind, probe, discover LAN address, and open the browser. */

/**
 * What this module binds. `node:http`'s server and `node:https`'s do not share
 * a type, and both carry what the callers need: `listen`, and the two ways a
 * connection can be dropped — `closeIdleConnections`, which spares one with a
 * response in flight (`vg-173`), and `closeAllConnections`, which is the one
 * the move takes (`vg-174`). A host serving both protocols on one port presents
 * a `net.Server` wearing the same methods, so the interface is stated rather
 * than spelled as a union.
 */
export interface ListenableServer extends net.Server {
  closeIdleConnections(): void;
  closeAllConnections(): void;
}

/** Retries only EADDRINUSE, bounded by `maxAttempts`; returns the actual port. */
export function listenWithFallback(
  server: ListenableServer,
  port: number,
  host: string,
  maxAttempts = MAX_PORT_ATTEMPTS,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let attempt = 0;

    const tryListen = (candidate: number): void => {
      const onError = (error: NodeJS.ErrnoException): void => {
        server.removeListener("listening", onListening);

        if (error.code !== "EADDRINUSE") {
          reject(error);
          return;
        }

        attempt += 1;

        if (attempt >= maxAttempts) {
          reject(
            new Error(
              `Ports ${port}–${port + maxAttempts - 1} are all in use. ` +
                "Free one, or pass --port.",
            ),
          );
          return;
        }

        tryListen(candidate + 1);
      };

      const onListening = (): void => {
        server.removeListener("error", onError);
        resolve(candidate);
      };

      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(candidate, host);
    };

    tryListen(port);
  });
}

/** Polls TCP reachability until success or timeout. */
export function waitUntilReachable(
  port: number,
  host: string,
  { timeoutMs = 15_000, intervalMs = 100 } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const target = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;

  return new Promise((resolve) => {
    const attempt = (): void => {
      const socket = net.connect({ host: target, port }, () => {
        socket.destroy();
        resolve(true);
      });

      socket.on("error", () => {
        socket.destroy();

        if (Date.now() >= deadline) {
          resolve(false);
          return;
        }

        setTimeout(attempt, intervalMs);
      });
    };

    attempt();
  });
}

/**
 * Adapter names a phone on the same Wi-Fi cannot reach, matched against the
 * interface name.
 *
 * **Data, not a heuristic** (`vg-171`): a Hyper-V switch, a WSL adapter, a
 * Docker bridge, a VM's host-only network and the tunnel a VPN installs all
 * carry a perfectly plausible dotted quad, and a phone that dials one of them
 * just fails to connect. A new virtual adapter is a line here rather than a new
 * rule inside `rankLanAddresses`.
 */
export const VIRTUAL_ADAPTER_PATTERNS: readonly RegExp[] = [
  /vEthernet/i, // Hyper-V's switch, and the WSL and Docker Desktop ones riding it
  /hyper-?v/i,
  /wsl/i,
  /docker/i,
  /^br-/i, // Docker's bridge on Linux
  /vbox|virtualbox/i,
  /vmware|vmnet/i,
  /loopback/i, // Npcap's and the other pseudo-adapters that are not `internal`
  /\b(vpn|wireguard|openvpn|tailscale|zerotier|nordlynx)\b/i,
  /\b(tun|tap|utun|ppp|wg)\d*\b/i,
  /wi-?fi direct|hosted network/i, // Windows' virtual Wi-Fi adapters (192.168.137.1 is one)
  /tunnel adapter|isatap|teredo/i, // Windows' ISATAP, Teredo and 6to4 pseudo-interfaces
  /\btunl\d*\b/i, // Linux's tunnel stub, which the tun/tap pattern above misses
  /^(sit|gre|gretap|erspan|ip6tnl|ip6gre)\d+$/i, // Linux's other kernel tunnel stubs
];

/** This machine's adapters, and the interface its default IPv4 route leaves by. */
export interface LanSource {
  readonly interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>;
  /** The interface carrying the default IPv4 route, or `undefined` when this
   *  platform will not say. */
  readonly defaultRouteInterface: string | undefined;
}

/** What a phone should dial, and what else was in the running. */
export interface LanChoice {
  readonly address: string | undefined;
  /** The candidates that survived beside the chosen one, when the default route
   *  did not decide the pick. Empty when the route decided it, or when only one
   *  candidate survived. */
  readonly alternatives: readonly string[];
}

/** Loopback, link-local and the unspecified address: nothing a phone can dial. */
function isUnreachableAddress(address: string): boolean {
  return (
    address.startsWith("127.") ||
    address.startsWith("169.254.") ||
    address === "0.0.0.0"
  );
}

/** The adapters to rank, and the default route to rank them by.
 *
 *  The route is read through `systeminformation` — the host's existing OS reader
 *  (`providers/library.ts`) — because Node exposes no routing table at all, and
 *  the installed dependency already answers this on every platform the host
 *  runs on.
 *
 *  **Its answer must not be read as "the route was read".** Measured with
 *  `execSync` blocked so the platform query cannot run at all: it still returns
 *  a name — this machine answers `"Npcap Loopback Adapter"` — because before
 *  the platform block it has already picked a fallback from the adapters
 *  themselves (the lowest IPv6 `scopeid`, else the first non-internal one), and
 *  its `catch` is `util.noop()`. `""` comes back only when there is no
 *  non-internal interface at all. A returned name that is also a surviving
 *  candidate therefore looks like "the route decided it", and `lanAddress`'s
 *  tie-break warning is suppressed on exactly the machine where a wrong pick is
 *  invisible. Detecting that fallback is a gap this function does not close.
 *
 *  **No path through here rejects.** A throw from either read — the adapter list
 *  or the route — leaves the interfaces empty or the route unknown, so the host
 *  answers `/api/hosting` with `address: null` rather than taking the process
 *  somewhere nobody is looking. */
export async function readLanSource(): Promise<LanSource> {
  let interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {};
  let defaultRouteInterface: string | undefined;

  try {
    interfaces = os.networkInterfaces();

    const imported = await import("systeminformation");
    const si = (imported.default ?? imported) as {
      networkInterfaceDefault(): Promise<string>;
    };
    const name = await si.networkInterfaceDefault();

    defaultRouteInterface = name === "" ? undefined : name;
  } catch {
    // Nothing to rank, or nothing to rank by: either way the caller gets an
    // answer rather than a rejection.
  }

  return { interfaces, defaultRouteInterface };
}

/** The ruling's order (`vg-171`), as a pure function so a case can carry a
 *  fixture rather than the adapters the machine running the test happens to
 *  have: drop loopback, link-local and internal; drop virtual adapters by name;
 *  prefer the interface carrying the default route; otherwise keep the choice
 *  deterministic and name the alternatives.
 *
 *  **Interface index is not something Node exposes.** `os.networkInterfaces()`
 *  returns adapters in the OS's own order and nothing else, so "lowest index"
 *  is read as **first enumerated** — the only ordering available on every
 *  platform the host runs on. */
export function rankLanAddresses(source: LanSource): LanChoice {
  const candidates: { readonly name: string; readonly address: string }[] = [];

  for (const [name, addresses] of Object.entries(source.interfaces)) {
    if (VIRTUAL_ADAPTER_PATTERNS.some((pattern) => pattern.test(name))) {
      continue;
    }

    const usable = (addresses ?? []).find(
      (candidate) =>
        candidate.family === "IPv4" &&
        !candidate.internal &&
        !isUnreachableAddress(candidate.address),
    );

    if (usable !== undefined) {
      candidates.push({ name, address: usable.address });
    }
  }

  const [first] = candidates;

  if (first === undefined) {
    return { address: undefined, alternatives: [] };
  }

  const routed = candidates.find(
    (candidate) => candidate.name === source.defaultRouteInterface,
  );

  if (routed !== undefined) {
    return { address: routed.address, alternatives: [] };
  }

  return {
    address: first.address,
    alternatives: candidates
      .slice(1)
      .map((candidate) => `${candidate.name} ${candidate.address}`),
  };
}

/** The address a phone on the same LAN should dial.
 *
 *  `source` is injectable so a case carries a fixture; the host reads the
 *  machine it is on. A pick made without a default route to go by is not
 *  silent: the row this exists for (`vg-171`) is invisible on the machine that
 *  makes it — the header renders a plausible dotted quad either way — so the
 *  alternatives go on the record where a wrong pick can be found without a
 *  phone. The host's logging surface is `console` (`main.ts` prints its whole
 *  banner through it) and there is no logger beside it to duplicate. */
export async function lanAddress(
  source?: LanSource,
): Promise<string | undefined> {
  const choice = rankLanAddresses(source ?? (await readLanSource()));

  if (choice.alternatives.length > 0) {
    console.warn(
      `LAN address ${choice.address} chosen without a default route to go by. ` +
        `Other candidates: ${choice.alternatives.join(", ")}.`,
    );
  }

  return choice.address;
}

/** The name this machine answers to over mDNS, as a display dials it.
 *
 *  **The name survives a DHCP lease; an address does not.** A browser scopes a
 *  display's cookie and storage to an origin, so a host whose address moved
 *  leaves a paired phone holding a credential for nobody — the defect
 * rules on. The name is not ours to publish: the OS
 *  responder already answers it, and `host-refind.ts` already prefers it.
 *
 *  Absent when the platform gives no hostname, because `.local` alone is a name
 *  no host answers to. */
export function stableName(): string | null {
  const host = os
    .hostname()
    .trim()
    .replace(/\.local$/i, "");

  return host === "" ? null : `${host}.local`;
}

/** Every address and name this machine answers to, for a certificate's SANs.
 *
 *  **All of them, not the one in use**, because the host can be moved onto the
 *  LAN after it has started (`createHostBinding`): a leaf covering only loopback
 *  would present a name mismatch to the first phone that connected, and the
 *  owner would have no way to tell that from a root they had not installed.
 *
 *  Read once, at start. That is the whole of what a changed DHCP lease costs: a
 *  restart re-reads this list and re-issues the leaf, and the root a display
 *  already installed stays valid, so nothing has to be installed again. */
export function localNames(): readonly string[] {
  const names = new Set<string>(["localhost", os.hostname()]);

  // The mDNS form the re-find ladder already prefers (`host-refind.ts`) and the
  // one the editor's QR dials. Without it here the leaf
  // covers the bare hostname but not `hostname.local`, so https by the name is
  // a mismatch the owner cannot tell from a root they had not installed.
  const stable = stableName();
  if (stable !== null) names.add(stable);

  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const candidate of interfaces ?? []) {
      // Internal entries are the loopback literals, added below by hand rather
      // than read: a browser at `https://127.0.0.1:5227` is the commonest
      // reader of all, and no interface has to be up for it to exist.
      if (!candidate.internal) names.add(candidate.address);
    }
  }

  names.add("127.0.0.1");
  names.add("::1");

  return [...names];
}

/** The program that opens a target, and its arguments. */
export interface OpenCommand {
  readonly file: string;
  readonly args: readonly string[];
}

export interface OpenTargetOptions {
  /** Overrides `process.platform`, so a case carries the platform it asserts. */
  readonly platform?: NodeJS.Platform;
  /** Opens the target as a folder rather than as a URL. */
  readonly directory?: boolean;
}

/**
 * The command that opens `target`, without running it.
 *
 * Windows URLs go through `rundll32`'s protocol handler rather than
 * `cmd /c start`: no console window is allocated, and the URL never reaches a
 * shell. A folder needs no protocol handler, so `explorer` opens it directly.
 */
export function openCommand(
  target: string,
  options: OpenTargetOptions = {},
): OpenCommand {
  const platform = options.platform ?? process.platform;

  if (platform === "win32") {
    return options.directory === true
      ? { file: "explorer.exe", args: [target] }
      : {
          file: "rundll32.exe",
          args: ["url.dll,FileProtocolHandler", target],
        };
  }

  return { file: platform === "darwin" ? "open" : "xdg-open", args: [target] };
}

/**
 * Opens a URL or folder without turning failure into a host startup failure.
 * Returns whether the opener was started, so a tray action can report a failed
 * open instead of claiming success in a hidden host.
 */
export function openTarget(
  target: string,
  options: OpenTargetOptions = {},
): boolean {
  const command = openCommand(target, options);

  try {
    const child = spawn(command.file, command.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });

    child.on("error", () => {
      /* The printed URL remains usable. */
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/** Opens the platform browser without turning failure into a host startup failure. */
export function openBrowser(url: string): boolean {
  return openTarget(url);
}
