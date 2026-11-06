import type { Capability } from "./capabilities";
import {
  type ExtensionSurface,
  type HostApiMethod,
  hostApiMethod,
} from "./host-api";

export interface CallContext {
  readonly method: string;
  readonly surface: ExtensionSurface;
  readonly consent: { readonly fingerprint: string } | null;
  readonly granted: readonly Capability[];
}

export type GateReason =
  | "unknown-method"
  | "wrong-surface"
  | "no-consent"
  | "missing-capability";

export type GateDecision =
  | { readonly ok: true; readonly method: HostApiMethod }
  | {
      readonly ok: false;
      readonly reason: GateReason;
      readonly capability?: Capability;
    };

/** Deny by default: a method exists, is offered on this surface, the plugin is
 *  consented, and the capability is granted. A null-capability method still
 *  needs consent, so `init` cannot run before the user has seen the plugin. */
export function gateExtensionCall(context: CallContext): GateDecision {
  const method = hostApiMethod(context.method);
  if (method === undefined) return { ok: false, reason: "unknown-method" };
  if (!method.surfaces.includes(context.surface))
    return { ok: false, reason: "wrong-surface" };
  if (context.consent === null) return { ok: false, reason: "no-consent" };
  const capability = method.capability;
  if (capability !== null && !context.granted.includes(capability))
    return { ok: false, reason: "missing-capability", capability };
  return { ok: true, method };
}
