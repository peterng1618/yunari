import type { Capability } from "./capabilities";
import type { ExecutionProfile, PluginContributions } from "./manifest";

export type ConsentState = "not-required" | "granted" | "missing";

/** The wire shape the host serves and the editor reads. It carries the
 *  qualified key and the typed contribution set, never the raw manifest or a
 *  resolved handler. */
export interface InstalledExtension {
  readonly key: string;
  readonly name: string;
  readonly version: string;
  readonly execution: ExecutionProfile;
  readonly capabilities: readonly Capability[];
  readonly contributions: PluginContributions;
  /** Every device identity the manifest asks the host to reach. */
  readonly devices: readonly string[];
  readonly consent: ConsentState;
  readonly fingerprint: string;
}
