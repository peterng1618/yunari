import type { ValidationIssue } from "@yunari/renderer-core";
import {
  type ThemeLibraryClient,
  type ThemeLibraryContent,
  type ThemeLibraryEntry,
  ThemeTooLargeError,
  ThemeValidationError,
} from "./theme-library-client.js";

/**
 * The theme a boot URL asks for, or the one the author left off, or nothing to
 * open.
 *
 * `?theme=<id>` is the same call the in-editor *Open library* dialog makes,
 * reached by URL instead. A saved theme with no way back to it is a
 * write-only surface: the editor could put one in the library and nothing
 * could ever read it again.
 *
 * **A URL that names a theme opens that theme or nothing.** A dead id is not
 * an error — a bookmark outlives the theme it points at — but it is not an
 * invitation to open a *different* document. The author asked for one
 * specific thing; answering with whatever ran last hands them a document they
 * did not choose, and the next Save writes over it. Falling back to the
 * template is the right size of answer: a visible blank document they can see
 * they were not given, rather than an invisible one they cannot.
 *
 * With no id in the URL the author's own most recent save is what opens,
 * because closing the tab and coming back to the theme they were working on is
 * the ordinary round trip and the template is not it. `New theme` and `New from
 * starter` are what a blank document means, and they stay where they were.
 *
 * **The store this assumes is single-author, and that is what makes the
 * fallback safe.** `~/.yunari/themes/` under `os.homedir()` (`cli/args.ts`),
 * with the host on loopback and no account, session or per-author scope
 * anywhere in it. So "the most recent save" is the person at the keyboard, not
 * a colleague's — which is why resuming is right here and would be wrong on a
 * shared store. If the store ever grows an author identity, this is the line
 * that has to change with it: scope the resume to the author rather than
 * dropping it, or the round trip and the safety go together.
 *
 * **The outcome is discriminated, not nullable.** A theme on disk that exists
 * and fails validation was answered with the same "nothing to open" a dead id
 * gets, so the editor mounted the template and reported success over a document
 * it never opened (`vg-110`); `Content | undefined` let every later reader drop
 * the report again. `invalid` carries the validator's own issues, and a caller
 * that ignores it will not compile (ADR-0043). `too-large` is the same defect
 * one trigger over — a stored document past the store's size bound — and it is
 * its own kind rather than `none` for the same reason (`vg-409`).
 */
export type BootThemeOutcome =
  | { readonly kind: "opened"; readonly content: ThemeLibraryContent }
  | { readonly kind: "none" }
  | { readonly kind: "invalid"; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: "too-large" };

export async function bootTheme(
  search: string,
  client: ThemeLibraryClient,
): Promise<BootThemeOutcome> {
  const id = new URLSearchParams(search).get("theme");
  if (id !== null && id !== "") {
    return openTheme(client, id);
  }
  return latestOwnTheme(client);
}

/**
 * An id that cannot be opened is nothing to open, not a boot failure — but a
 * theme the host holds and refuses is its own answer: `invalid`, carrying the
 * validator's reason, or `too-large`, so the caller can say why instead of
 * reporting a blank success.
 */
async function openTheme(
  client: ThemeLibraryClient,
  id: string,
): Promise<BootThemeOutcome> {
  try {
    return { kind: "opened", content: await client.open(id) };
  } catch (error) {
    if (error instanceof ThemeValidationError) {
      return { kind: "invalid", issues: error.issues };
    }
    if (error instanceof ThemeTooLargeError) {
      return { kind: "too-large" };
    }
    return { kind: "none" };
  }
}

/**
 * The author's own most recent save, or nothing.
 *
 * `updatedAt` is the host store's mtime as ISO-8601 UTC, which sorts as text,
 * and a template is not a stored file and has none — so the entry this picks is
 * the author's own work and never the composition the product ships. A host
 * with nothing saved answers with nothing, which is the right answer for
 * someone who has never saved: they get the reference composition.
 */
async function latestOwnTheme(
  client: ThemeLibraryClient,
): Promise<BootThemeOutcome> {
  let entries: readonly ThemeLibraryEntry[];
  try {
    entries = await client.list();
  } catch {
    return { kind: "none" };
  }
  const saved = entries.filter(
    (entry): entry is ThemeLibraryEntry & { readonly updatedAt: string } =>
      entry.updatedAt !== undefined,
  );
  const latest = saved.reduce<(typeof saved)[number] | undefined>(
    (best, entry) =>
      best === undefined || entry.updatedAt > best.updatedAt ? entry : best,
    undefined,
  );
  return latest === undefined ? { kind: "none" } : openTheme(client, latest.id);
}
