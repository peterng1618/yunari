import { useState } from "react";
import type { ProductShortcutId } from "../../shortcut-manager/index.js";
import type { ShortcutOverrides } from "../../shortcut-manager/bindings.js";
import { SettingsKeyboard } from "../../editor-shell/settings-keyboard.js";
import { Page } from "../page.js";

/**
 * The Keyboard page. The armed row lives here rather than in the region, so
 * leaving the page is what disarms it: a capture cannot outlive the surface
 * that asked for a chord.
 */
export function KeyboardPage(props: {
  readonly storage: Storage | undefined;
  readonly overrides: ShortcutOverrides;
  readonly onOverrides: (next: ShortcutOverrides) => void;
}): React.JSX.Element {
  const [armed, setArmed] = useState<ProductShortcutId | undefined>(undefined);

  return (
    <Page page="keyboard">
      <SettingsKeyboard
        storage={props.storage}
        overrides={props.overrides}
        armed={armed}
        onArmed={setArmed}
        onOverrides={props.onOverrides}
      />
    </Page>
  );
}
