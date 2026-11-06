import type { FabricThemeEnvelope } from "@yunari/renderer-core";
import {
  classifyThemeChange,
  type ThemeCredits,
  type VersionLevel,
  versionFor,
} from "@yunari/theme-package";

/**
 * The version a submission is allowed to publish, computed from the stored
 * envelope rather than trusted from the client — the host runs the same ladder,
 * and a client that edits the version it writes is refused here.
 *
 * `now` is the caller's single instant for the rows it will write; nothing in
 * this decision depends on time.
 */
export function planVersion(input: {
  readonly previous:
    | {
        readonly version: string;
        readonly envelope: FabricThemeEnvelope;
        readonly credits?: ThemeCredits;
      }
    | undefined;
  readonly candidate: FabricThemeEnvelope;
  /** The attribution the submitted package carries, compared with the stored
   *  version's. Absent means the submission carries none. */
  readonly credits?: ThemeCredits;
  readonly now: string;
}):
  | {
      readonly ok: true;
      readonly version: string;
      readonly level: VersionLevel;
    }
  | { readonly ok: false; readonly message: string } {
  const change = classifyThemeChange(
    input.previous?.envelope,
    input.candidate,
    {
      previous: input.previous?.credits,
      next: input.credits,
    },
  );
  if (change.level === "none" && input.previous !== undefined) {
    return {
      ok: false,
      message: `Version ${input.previous.version} is published and this theme has not changed since it.`,
    };
  }

  const expected = versionFor(input.previous?.version, change);
  if (expected === undefined) {
    // `initial` always mints a version, so only a stored version the ladder
    // cannot bump reaches this.
    return {
      ok: false,
      message:
        input.previous === undefined
          ? "This theme could not be given a version."
          : `The store's copy of this theme records version "${input.previous.version}", which cannot be bumped.`,
    };
  }

  const claimed = input.candidate.metadata?.version;
  if (claimed === undefined) {
    return {
      ok: false,
      message: `The theme records no metadata.version; the ladder computes ${expected}.`,
    };
  }
  if (claimed !== expected) {
    return {
      ok: false,
      message: `The submitted theme claims version "${claimed}" but the ladder computes "${expected}".`,
    };
  }

  return {
    ok: true,
    version: expected,
    level: change.level,
  };
}

/** Semver's own grammar: three dot-separated integers and an optional
 *  prerelease/build suffix. A theme version is narrower (`isSemanticVersion`);
 *  a plugin's is not, so the pack ladder reads the wider shape. */
const PACK_VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

interface ParsedVersion {
  readonly numbers: readonly [number, number, number];
  readonly prerelease: readonly string[];
}

export function isPackVersion(text: string): boolean {
  return PACK_VERSION.test(text);
}

function parseVersion(text: string): ParsedVersion | undefined {
  const match = PACK_VERSION.exec(text);
  if (match === null) return undefined;
  const numbers = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ] as const;
  if (!numbers.every(Number.isSafeInteger)) return undefined;
  return {
    numbers,
    prerelease: match[4] === undefined ? [] : match[4].split("."),
  };
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  for (let index = 0; index < 3; index += 1) {
    const difference =
      (left.numbers[index] as number) - (right.numbers[index] as number);
    if (difference !== 0) return difference;
  }
  // A release outranks any prerelease of the same numbers.
  if (left.prerelease.length === 0 || right.prerelease.length === 0)
    return right.prerelease.length - left.prerelease.length;

  const shared = Math.min(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < shared; index += 1) {
    const a = left.prerelease[index] as string;
    const b = right.prerelease[index] as string;
    const numericA = /^\d+$/.test(a);
    const numericB = /^\d+$/.test(b);
    if (numericA && numericB) {
      const difference = Number(a) - Number(b);
      if (difference !== 0) return difference;
    } else if (numericA !== numericB) {
      // Numeric identifiers have lower precedence than alphanumeric ones.
      return numericA ? -1 : 1;
    } else if (a !== b) {
      return a < b ? -1 : 1;
    }
  }
  return left.prerelease.length - right.prerelease.length;
}

/**
 * The version a pack submission may publish: its own semver, strictly greater
 * than the stored one. A first publication mints what the author wrote, exactly
 * as a pack carries its own manifest version; every later one must advance.
 */
export function planPackVersion(
  previous: string | undefined,
  candidate: string,
):
  | { readonly ok: true; readonly version: string }
  | { readonly ok: false; readonly message: string } {
  const next = parseVersion(candidate);
  if (next === undefined)
    return { ok: false, message: 'A pack version must be semver "x.y.z".' };
  if (previous === undefined) return { ok: true, version: candidate };

  const stored = parseVersion(previous);
  if (stored === undefined)
    return {
      ok: false,
      message: `The store's copy records version "${previous}", which is not a semver this build can compare.`,
    };
  if (compareVersions(next, stored) <= 0)
    return {
      ok: false,
      message: `Version ${candidate} must be greater than the published ${previous}.`,
    };
  return { ok: true, version: candidate };
}
