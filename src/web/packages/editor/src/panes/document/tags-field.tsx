import { MAX_TAGS, TAG_PATTERN } from "@yunari/renderer-core";
import type * as React from "react";
import { useState } from "react";
import {
  ControlReason,
  ControlRow,
  ControlWell,
  describedBy,
  hitTargetClasses,
  plainButtonClasses,
  useControlIds,
  useDraftCommit,
} from "../../components/ui/control-well.js";
import { uiCopy } from "../../ui-copy.js";

/**
 * The style tags a theme declares: **picked from the vocabulary, proposed only
 * when nothing in it fits.**
 *
 * That ordering is the whole mechanism. Free text as the *first* affordance puts
 * `sci-fi`, `scifi` and `science fiction` into the catalogue as three tags with
 * one theme each, so the vocabulary is a row of toggle buttons and the propose
 * field below it is the only path to a word the vocabulary does not hold. A word
 * that arrives that way is drawn as a proposal rather than as a picked tag (a
 * dashed `retro-diner · proposed`), so a reader can tell a new word from a facet
 * that failed to match.
 *
 * **A refusal never commits.** The value is checked against the same rule the
 * validator applies — `TAG_PATTERN` and `MAX_TAGS`, imported rather than
 * restated — so the document cannot hold a tag a reload would refuse; a refused
 * word leaves the list untouched and says why beside the field.
 *
 * The pills are drawn in the **value's order first**, then the vocabulary's
 * remaining entries: the tags a theme carries are what an author reads, and the
 * offer is what they are added from.
 *
 * **The draft's keyboard contract is `useDraftCommit`'s, not this field's** —
 * Escape, the Enter/IME guard and the composing ref are the one owner's
 * (`vg-203`), which is what the guard in `control.dom.test.tsx` requires of
 * every file that holds an input.
 */
interface TagsFieldProps {
  readonly value: readonly string[];
  readonly onCommit: (next: readonly string[]) => void;
  /** The words on offer. The catalogue's own tags when one is reachable, the
   *  shipped seed when it is not — the field is told, never asks. */
  readonly vocabulary: readonly string[];
}

export function TagsField(props: TagsFieldProps): React.JSX.Element {
  const { value, onCommit, vocabulary } = props;
  const ids = useControlIds(undefined);
  // `null` is not editing: the proposal box is empty and nothing else may fill
  // it. Any other string is the person's own draft.
  const [draft, setDraft] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);

  const held = new Set(value);

  /** Why this theme may not take `tag`, or `undefined` when it may. Shape
   *  first, then the list, then the count: a word the format does not take is
   *  the fault the author can act on, and a full list is only the reason once
   *  the word itself is one. */
  const refusalFor = (tag: string): string | undefined => {
    if (!TAG_PATTERN.test(tag))
      return uiCopy.panels.tagRefusedShape(tag, TAG_PATTERN.source);
    if (held.has(tag)) return uiCopy.panels.tagRefusedDuplicate(tag);
    if (value.length >= MAX_TAGS) return uiCopy.panels.tagRefusedFull(MAX_TAGS);
    return undefined;
  };

  /** The one writer: a tag is committed only when nothing refuses it, and a
   *  refused one is never written. */
  const offer = (tag: string): boolean => {
    const refused = refusalFor(tag);
    setRefusal(refused);
    if (refused !== undefined) return false;
    onCommit([...value, tag]);
    return true;
  };

  const toggle = (tag: string): void => {
    if (!held.has(tag)) {
      offer(tag);
      return;
    }
    setRefusal(undefined);
    onCommit(value.filter((entry) => entry !== tag));
  };

  /** What a draft becomes. **Only a draft commits**, which is what makes the
   *  Enter's own blur a no-op rather than a second write: a successful commit
   *  empties the box, and a refused one keeps its word to be corrected (§5).
   *  A word the author never typed is not a proposal, so there is nothing to
   *  refuse and nothing to say. */
  const commit = (): void => {
    const tag = draft ?? "";
    if (tag === "") {
      setRefusal(undefined);
      return;
    }
    if (offer(tag)) setDraft(null);
  };

  const keys = useDraftCommit({
    draft,
    setDraft,
    commit,
    // Escape drops the draft *and* the refusal that draft earned: the words
    // beside the field are about a value that is no longer there.
    reset: () => setRefusal(undefined),
  });

  // Deduped for the list's own keys: a hand-edited document may declare the same
  // tag twice, and the facet is what collapses duplicates, not this field.
  const drawn = [...new Set(value)];
  const offered = [...drawn, ...vocabulary.filter((tag) => !held.has(tag))];

  return (
    <ControlRow
      ids={ids}
      label={uiCopy.panels.styleTags}
      labelFor={ids.control}
    >
      <div className="flex w-full flex-col gap-[var(--space-6)]">
        <div className="flex flex-wrap gap-[var(--space-4)]">
          {offered.map((tag) => {
            const picked = held.has(tag);
            // A word the vocabulary does not hold is a proposal, and it is drawn
            // as one whether or not it is this build's own.
            const proposed = !vocabulary.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                data-yunari-tag={tag}
                aria-pressed={picked}
                onClick={() => toggle(tag)}
                // `hitTargetClasses` carries §5's 24×24 target the way it does
                // for a segment: a pill is a button, so it can take the
                // `::before` a replaced element cannot, and its own box stays
                // the 22px the drawing gives it.
                className={`${hitTargetClasses} rounded-full border px-[var(--space-10)] py-[var(--space-4)] text-2xs ${
                  picked
                    ? // `--stage` through the shorthand: `bg-stage` is the
                      // utility the theme block deliberately does not declare
                      // (light makes `--stage` a gradient stack, which a colour
                      // utility would set to a colour and fail silent).
                      "border-accent text-text [background:var(--stage)]"
                    : "border-edge bg-panel-2 text-muted hover:border-muted"
                } ${proposed ? "border-dashed" : ""}`}
              >
                {/* The pill's words are a value, not copy, so the element that
                    prints it carries `data-yunari-value` — the same hook a
                    select's trigger uses, and the same reason. */}
                <span data-yunari-value={tag}>
                  {proposed ? uiCopy.panels.tagsProposed(tag) : tag}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-[var(--space-6)]">
          <ControlWell>
            <input
              {...keys}
              id={ids.control}
              type="text"
              data-yunari-tag-proposal=""
              value={draft ?? ""}
              placeholder={uiCopy.panels.tagProposePlaceholder}
              aria-describedby={describedBy(
                refusal === undefined ? undefined : ids.invalid,
              )}
              onChange={(event) => setDraft(event.target.value)}
              className="h-full w-full bg-transparent text-sm text-text outline-none"
            />
          </ControlWell>
          <button type="button" onClick={commit} className={plainButtonClasses}>
            {uiCopy.panels.tagAdd}
          </button>
        </div>
        {refusal === undefined ? null : (
          <ControlReason id={ids.invalid}>{refusal}</ControlReason>
        )}
      </div>
    </ControlRow>
  );
}
