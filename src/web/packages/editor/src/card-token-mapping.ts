import type { FabricGlobals } from "@yunari/renderer-core";
import { starterTypeTokens } from "./new-fabric-theme-globals.js";
import { paletteTokenRole } from "./new-object-defaults.js";

/**
 * What a card asks for, and what the document it is inserted into actually has.
 *
 * A card is authored against the starter's vocabulary — `palette.frost`,
 * `typeTokens.90-600` — and a document is free to name its tokens anything
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
 * 2. **By role.** A palette is a *typed* vocabulary, not a bag of names: a
 *    document that names a surface and a content ink has both, whatever it
 *    calls them. `surface` and `content` are the two roles a card asks for, and
 *    they are the roles `new-object-defaults.ts` already asks the same question
 *    with — this module does not invent a taxonomy beside them.
 * 3. **A literal**, where the document format has a place for one and nothing
 *    else will resolve. See `resolveCardToken`'s return.
 *
 * **A same-named token is never assumed to mean the same thing** (§77). Step 1
 * is the only step that trusts a name, and only when the document declares that
 * name.
 */

/**
 * One reference, resolved.
 *
 * `ref` is a reference this document can paint. `literal` is `true` when the
 * format has somewhere to put the card's own value and no token can answer —
 * a text run's `typeToken`, where the object already carries the size, weight
 * and face as plain Fabric fields and dropping the reference leaves exactly
 * the typography the card was authored with. Neither being set means this
 * document cannot express the reference at all, and the card is refused.
 */
interface TokenResolution {
  readonly ref: string | undefined;
  readonly literal: boolean;
  /** What the author is told was swapped, or `undefined` if nothing was. */
  readonly substitutedFor: string | undefined;
}

/** A substitution, as the author is told about it. */
export interface TokenSubstitution {
  /** What the card asked for, e.g. `palette.frost`. */
  readonly from: string;
  /** What it got instead: a reference, or the card's own value inlined. */
  readonly to: string;
  readonly reason: "role" | "literal";
}

/**
 * Resolves one card reference against the document it is being inserted into.
 *
 * Pure, so the whole copy — including every substitution — is inspectable
 * without a canvas, and a caller can ask "did anything get mapped?" without
 * having built one.
 *
 * **`literal` is about the reference, not the value.** It is offered only where
 * the format admits one; `yunariPaint` and chart settings both require a
 * palette token by validation (`fabric-envelope-validate.ts`), so a document
 * with no palette at all still refuses the card. That is the same refusal the
 * Add pane already makes for a theme with nothing to build from, and it is the
 * only case where the third step cannot stand in.
 */
export function resolveCardToken(
  ref: string,
  globals: FabricGlobals | undefined,
): TokenResolution {
  const at = ref.indexOf(".");
  if (at < 0) return { ref, literal: false, substitutedFor: undefined };
  const group = ref.slice(0, at);
  const entry = ref.slice(at + 1);
  if (carries(group, entry, globals)) {
    return { ref, literal: false, substitutedFor: undefined };
  }
  if (group === "palette") {
    const chosen = paletteRoleMatch(entry, globals);
    return chosen === undefined
      ? { ref: undefined, literal: false, substitutedFor: undefined }
      : {
          ref: `palette.${chosen}`,
          literal: false,
          substitutedFor: `palette.${entry}`,
        };
  }
  if (group !== "typeTokens") {
    return { ref: undefined, literal: false, substitutedFor: undefined };
  }
  const preset = presetRoleMatch(entry, globals);
  if (preset !== undefined) {
    return {
      ref: `typeTokens.${preset}`,
      literal: false,
      substitutedFor: `typeTokens.${entry}`,
    };
  }
  // A text run's preset is the one reference with a literal home: the object
  // already carries `fontFamily`/`fontSize`/`fontWeight` as authored Fabric
  // fields, and `validateTypeTokenReference` passes a run that declares none.
  return {
    ref: undefined,
    literal: true,
    substitutedFor: `typeTokens.${entry}`,
  };
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

/**
 * The document's preset for a starter preset's role.
 *
 * Presets are typed by `trioRole` (`heading` / `body` / `mono`), which is the
 * only role a preset itself declares, so a card's 90-unit reading is answered
 * by the document's heading preset and never by its caption.
 */
function presetRoleMatch(
  entry: string,
  globals: FabricGlobals | undefined,
): string | undefined {
  const candidates = Object.keys(globals?.typeTokens ?? {});
  const role = trioRoleOf(entry);
  return (
    candidates.find((id) => trioRoleOf(id) === role && role !== undefined) ??
    candidates[0]
  );
}

/**
 * A starter preset's own declared role — the same key the document's presets
 * are matched on, so this is one rule for both sides rather than two that could
 * disagree.
 */
function trioRoleOf(id: string): string | undefined {
  const value = starterTypeTokens[id as keyof typeof starterTypeTokens] as
    | { readonly trioRole?: string }
    | undefined;
  return value?.trioRole;
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
