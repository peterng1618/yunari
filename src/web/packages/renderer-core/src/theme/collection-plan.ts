import type { StoreItemKind } from "./catalogue-index.js";

/**
 * The verified member list a collection install answers before it writes.
 *
 * One shape for the host that resolves it and the install sheet that shows it,
 * so a member's size, availability, installed version and consent are read from
 * one place. Types only: the host derives every field, and this module owns no
 * listing and performs no read.
 */
export interface CollectionPlanMember {
  /** The catalogue id of the included listing. */
  readonly id: string;
  readonly kind: StoreItemKind;
  readonly name: string;
  readonly version: string;
  readonly bytes: number;
  readonly publisher: string;
  /** The collection author's default, not a promise: an unticked optional
   *  member may be skipped by the install. */
  readonly optional: boolean;
  /** The version this machine already holds of the same catalogue item. */
  readonly installedVersion?: string;
  readonly consent?: {
    /** The qualified plugin key the install will record. */
    readonly key: string;
    readonly name: string;
    /**
     * The manifest's own execution profile as a string, not the plugin
     * vocabulary's union: a listing written by a newer store may name a profile
     * this build does not run, and the editor narrows where it acts.
     */
    readonly execution: string;
    readonly capabilities: readonly string[];
    readonly devices: readonly string[];
  };
}

export interface CollectionPlanMissing {
  readonly id: string;
  readonly reason: string;
}

export interface CollectionPlan {
  /** Every chosen member that verified, in the collection's order. */
  readonly members: readonly CollectionPlanMember[];
  /** Chosen members that could not be resolved: unpublished, undownloadable,
   *  refused by their reader, or unknown to this host. */
  readonly missing: readonly CollectionPlanMissing[];
  readonly totalBytes: number;
}
