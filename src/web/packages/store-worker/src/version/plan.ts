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
