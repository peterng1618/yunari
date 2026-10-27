import type { FabricGlobals } from "@yunari/renderer-core";
import { paletteTokenRole } from "./new-object-defaults.js";

/**
 * What a card asks for, and what the document it is inserted into actually has.
 *
 * A card is authored against the starter's vocabulary — `palette.frost`,
 * `typeTokens.heading` — and a document is free to name its tokens anything
 * (`vg-128`). The answer used to be a refusal, because an unresolved reference
 * reaches `snapshot`, which validates and throws: an author gets a canvas that
 * looks right and a save that fails for the rest of the session, told nothing.
 * Refusing was the safe half of that decision and the unusable half too — **on
 * the host's default two-token palette every card refuses, and on a blank theme
 * seven of the eight do**, so the library was dead exactly where an author meets
 * it first.
 *
 * So a reference resolves in this order, and the author is told which step
 * answered:
 *
 * 1. **Exact token id.** The card wants `palette.cpu` and the document has
 *    `palette.cpu`. Nothing is substituted and nothing is reported.
 * 2. **By role** (palette only). A palette is a *typed* vocabulary, not a bag of
 *    names: a document that names a surface and a content ink has both, whatever
 *    it calls them. `surface` and `content` are the two roles a card asks for, and
 *    they are the roles `new-object-defaults.ts` already asks the same question
 *    with — this module does not invent a taxonomy beside them.
 * 3. **The document's own type token** (`typeTokens` only). Every theme carries
 *    `heading`/`body`/`mono`, so step 1 is the normal answer; a theme older than
 *    that vocabulary still has *some* face, and a card in the wrong face is
 *    recoverable where a card that refuses to save is not.
 *
 * **A same-named token is never assumed to mean the same thing** (§77). Step 1
 * is the only step that trusts a name, and only when the document declares that
 * name.
 */

/**
 * One reference, resolved.
 *
 * `ref` is a reference this document can paint. `undefined` means this document
 * cannot express the reference at all, and the card is refused.
 */
interface TokenResolution {
  readonly ref: string | undefined;
  /** What the author is told was swapped, or `undefined` if nothing was. */
  readonly substitutedFor: string | undefined;
}

/** A substitution, as the author is told about it. */
export interface TokenSubstitution {
  /** What the card asked for, e.g. `palette.frost`. */
  readonly from: string;
  /** What it got instead: a token id this document declares. */
  readonly to: string;
}

/**
 * Resolves one card reference against the document it is being inserted into.
 *
 * Pure, so the whole copy — including every substitution — is inspectable
 * without a canvas, and a caller can ask "did anything get mapped?" without
 * having built one.
 *
 * There is no literal home for either group: `yunariPaint`, chart settings and
 * every text run require a palette or type token by validation
 * (`fabric-envelope-validate.ts`), so a document with none refuses the card.
 * That is the same refusal the Add pane already makes for a theme with nothing
 * to build from.
 */
export function resolveCardToken(
  ref: string,
  globals: FabricGlobals | undefined,
): TokenResolution {
  const at = ref.indexOf(".");
  if (at < 0) return { ref, substitutedFor: undefined };
  const group = ref.slice(0, at);
  const entry = ref.slice(at + 1);
  if (carries(group, entry, globals)) {
    return { ref, substitutedFor: undefined };
  }
  if (group === "palette") {
    const chosen = paletteRoleMatch(entry, globals);
    return chosen === undefined
      ? { ref: undefined, substitutedFor: undefined }
      : { ref: `palette.${chosen}`, substitutedFor: `palette.${entry}` };
  }
  if (group !== "typeTokens") {
    return { ref: undefined, substitutedFor: undefined };
  }
  const preset = Object.keys(globals?.typeTokens ?? {})[0];
  return preset === undefined
    ? { ref: undefined, substitutedFor: undefined }
    : { ref: `typeTokens.${preset}`, substitutedFor: `typeTokens.${entry}` };
}

/**
 * The document's token for a starter token's job.
 *
 * Both sides are read with the same predicate (`paletteTokenRole`), which is
 * what makes this a *role* match rather than a name match: the card wants a
 * surface, the document has one, and neither has to call it the same thing.
 *
 * `none` is excluded because a card mapped onto "transparent" is a card an
 * author cannot see or select — the same reason `surfacePalette` skips it. The
 * role match beats "the first token this document happens to have", because
 * that fallback is exactly the invisible-content failure `firstPalette` exists
 * to prevent. It is still the last resort, because a token outside the
 * vocabulary — a document whose ids name nothing this repo recognises — has no
 * role to match, and a card in the wrong colour is recoverable where a card
 * that refuses to save is not.
 */
function paletteRoleMatch(
  entry: string,
  globals: FabricGlobals | undefined,
): string | undefined {
  const wanted = paletteTokenRole(entry);
  const candidates = Object.keys(globals?.palette ?? {}).filter(
    (id) => id !== "none",
  );
  return (
    candidates.find((id) => paletteTokenRole(id) === wanted) ?? candidates[0]
  );
}

function carries(
  group: string,
  entry: string,
  globals: FabricGlobals | undefined,
): boolean {
  if (group === "palette") return globals?.palette?.[entry] !== undefined;
  if (group === "typeTokens") return globals?.typeTokens?.[entry] !== undefined;
  return false;
}
