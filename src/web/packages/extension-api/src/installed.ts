import type { Capability } from "./capabilities";
import type { ExecutionProfile, PluginContributions } from "./manifest";

export type ConsentState = "not-required" | "granted" | "missing";

/** The wire shape the host serves and the editor reads. It carries the
 *  qualified key and the typed contribution set, never the raw manifest or a
 *  resolved handler. */
export interface InstalledExtension {
  readonly key: string;
  readonly name: string;
  /** The publisher segment of the key, from the store's catalogue rather than
   *  the manifest. A local install is published by `local`. */
  readonly publisher: string;
  readonly version: string;
  readonly execution: ExecutionProfile;
  readonly capabilities: readonly Capability[];
  readonly contributions: PluginContributions;
  /** Every device identity the manifest asks the host to reach. */
  readonly devices: readonly string[];
  readonly consent: ConsentState;
  readonly fingerprint: string;
  /** The frame entry this plugin's UI is served from, when it declares one. */
  readonly ui?: string;
  /** Present only when the store's kill list names this plugin. The advisory is
   *  an already-validated HTTPS URL, never a raw store field. */
  readonly revoked?: { readonly advisory?: string };
}
