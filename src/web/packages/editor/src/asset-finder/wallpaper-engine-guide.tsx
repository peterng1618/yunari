import type * as React from "react";
import { Dialog } from "../components/ui/dialog.js";
import { uiCopy } from "../ui-copy.js";

/** The Wallpaper Engine guide: the two things an author cannot discover from
 *  the cards alone, in the order they are needed — why a scene is converted,
 *  then the engine's own export sequence that follows it. */
export function WallpaperEngineGuide(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const copy = uiCopy.assets.wallpaperEngine;
  const sections = copy.guideSections;

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      label={copy.guideTitle}
      closeLabel={copy.close}
      closeIcon
    >
      <div
        data-yunari-wallpaper-engine-guide-dialog=""
        className="flex w-[var(--guide-dialog-width)] max-w-full flex-col gap-[var(--space-12)]"
      >
        {[sections.convert, sections.export].map((section) => (
          <section
            key={section.heading}
            className="flex flex-col gap-[var(--space-4)]"
          >
            <h2 className="text-sm font-medium">{section.heading}</h2>
            <p className="text-xs text-muted">{section.body}</p>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
