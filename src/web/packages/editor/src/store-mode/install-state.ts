import type { StoreItem } from "./local-source.js";

/**
 * What the online half's action slot draws for one item.
 *
 * `none` means the item carries no catalogue facts — a library item, which
 * draws the local half's four actions instead — so it is not a state the online
 * slot ever draws.
 */
export type InstallState = "none" | "installed" | "update" | "install";

/**
 * The dotted numeric core of a version, or nothing when it does not have one.
 *
 * One leading `v` is dropped and each segment's leading digits are read, so
 * `1.4.0-beta` is `1.4.0`. A segment that starts with no digit, or an empty
 * version, is not orderable at all.
 */
function versionCore(version: string): number[] | undefined {
  const bare = version.startsWith("v") ? version.slice(1) : version;
  if (bare === "") return undefined;

  const core: number[] = [];
  for (const segment of bare.split(".")) {
    const digits = /^(\d+)/.exec(segment);
    if (digits === null) return undefined;
    core.push(Number(digits[1]));
  }
  return core;
}

/** `held` against `offered`, or nothing when either is not a version this file
 *  can order. Missing segments count as zero, so `1.4` and `1.4.0` are equal. */
function compareVersions(held: string, offered: string): number | undefined {
  const left = versionCore(held);
  const right = versionCore(offered);
  if (left === undefined || right === undefined) return undefined;

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

/**
 * The one owner of the install decision.
 *
 * **Update is offered only when the catalogue is newer.** A held copy at or
 * past the catalogue's version is `installed`, because the press overwrites the
 * person's copy with no undo.
 *
 * **An incomparable pair is also `installed`.** A version this file cannot order
 * must not authorise that overwrite: no ordering is invented for strings we
 * cannot read, and the silent direction is the one that keeps the copy.
 */
export function installStateOf(item: StoreItem): InstallState {
  const catalogue = item.catalogue;
  if (catalogue === undefined) return "none";
  const installedVersion = catalogue.installedVersion;
  if (installedVersion === undefined) return "install";
  if (installedVersion === item.version) return "installed";

  const order =
    item.version === undefined
      ? undefined
      : compareVersions(installedVersion, item.version);
  return order === -1 ? "update" : "installed";
}

/**
 * The catalogue's items, each carrying what this PC installed for it.
 *
 * **The version comes off the library item's origin record, not off the
 * document.** An origin says which catalogue version this copy was installed
 * from; the document's own version moves as the author edits it, so reading the
 * document would call an edited copy *Installed* against a catalogue that had
 * moved on. **No comparison happens here** — `installStateOf` owns it, and a
 * second one would be the two owners this file exists to prevent.
 *
 * No local match, or no local listing at all, leaves `installedVersion` absent:
 * `undefined` is the truth this PC installed nothing. **The joined row also
 * carries the local copy's own id**, because the four theme commands act on the
 * library copy while the catalogue row is keyed by the catalogue's id.
 */
export function withInstalledVersions(
  online: readonly StoreItem[],
  local: readonly StoreItem[] | undefined,
): readonly StoreItem[] {
  const installed = new Map<
    string,
    { readonly version: string; readonly id: string }
  >();
  for (const item of local ?? []) {
    const origin = item.origin;
    if (origin !== undefined) {
      installed.set(origin.catalogueId, {
        version: origin.version,
        id: item.id,
      });
    }
  }

  return online.map((item) => {
    const held = installed.get(item.id);
    if (held === undefined || item.catalogue === undefined) return item;
    return {
      ...item,
      installedId: held.id,
      catalogue: { ...item.catalogue, installedVersion: held.version },
    };
  });
}
