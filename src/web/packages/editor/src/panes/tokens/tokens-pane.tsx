import { uiCopy } from "../../ui-copy.js";
import { PaintList, type PaintListProps } from "./paint-list.js";

/**
 * The Tokens pane's body: the paint library, under the pane's own chrome.
 *
 * **The pane's identity is not written here.** `Pane` is the one owner of
 * `data-yunari-panel` (`editor-shell/pane.tsx:43`), and this renders inside it;
 * a second element under that name is a strict-mode failure for every locator
 * that browses by it.
 *
 * The heading is the library's own word and a plain `<h2>`: `panel-labels.spec.ts`
 * reads every `section h2` and matches the panel's name against it, and the
 * disclosure chrome's `▾` would arrive in that text beside the title.
 *
 * Task 6's preset library is **not** a child of this tree. It is a sibling
 * section under the same pane host, built and owned by
 * `type-preset-manager/panel.ts` (R36); rendering it here would make this pane
 * reach into a section the palette panel owns — one concept with two owners.
 */
export function TokensPane(props: PaintListProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-[var(--space-8)]">
      <h2 className="text-xs font-semibold tracking-[0.11em] text-muted uppercase">
        {uiCopy.panels.paintTokens}
      </h2>
      <PaintList {...props} />
    </div>
  );
}
