import type { Artboard, ThemeMetadata } from "@yunari/renderer-core";
import type { SceneBox } from "@yunari/scene-fabric";
import { InspectorSection } from "../../components/ui/inspector-section.js";
import { uiCopy } from "../../ui-copy.js";
import { ArtboardFields } from "./artboard-fields.js";
import { MetadataFields } from "./metadata-fields.js";

/**
 * The Document pane's body: the theme's own metadata, and the artboard it is
 * drawn on.
 *
 * **The pane's identity is not written here.** `Pane` is the one owner of
 * `data-yunari-panel` (`editor-shell/pane.tsx:43`), and this renders inside it;
 * a second element under that name is a strict-mode failure for every locator
 * that browses by it. This tree is the pane's whole body: the References
 * sub-panel that used to be appended to the same host as a sibling of these
 * sections went with item 17 (`vg-474`), and what is left is what this file
 * returns.
 *
 * The heading is the panel's own word and a plain `<h2>`: `panel-labels.spec.ts`
 * reads every `section h2` and matches the panel's name against it, and the
 * disclosure chrome's `▾` would arrive in that text beside the title.
 *
 * §8's ordering, most likely first: what the theme is, then the board it is
 * drawn on — the size and the presets that set it. The board's paint and the
 * media behind it are the background layer's, authored in the selection
 * inspector's column rather than here.
 */
interface DocumentPaneProps {
  readonly artboard: Artboard;
  readonly metadata: ThemeMetadata | undefined;
  /** The scene as `sceneBoxes` last read it, or `undefined` when the panel has
   *  none to read. */
  readonly boxes: readonly SceneBox[] | undefined;
  readonly onArtboard: (next: Artboard) => void;
  readonly onMetadata: (next: ThemeMetadata) => void;
}

export function DocumentPane(props: DocumentPaneProps): React.JSX.Element {
  const { artboard, metadata, boxes } = props;
  return (
    <div className="flex flex-col gap-[var(--space-8)]">
      <h2 className="text-xs font-semibold tracking-[0.11em] text-muted uppercase">
        {uiCopy.panels.themeSettings}
      </h2>
      <InspectorSection id="theme" title={uiCopy.panels.themeMetadata}>
        <MetadataFields metadata={metadata} onCommit={props.onMetadata} />
      </InspectorSection>
      <InspectorSection id="artboard" title={uiCopy.panels.artboard}>
        <ArtboardFields
          artboard={artboard}
          boxes={boxes}
          onCommit={props.onArtboard}
        />
      </InspectorSection>
    </div>
  );
}
