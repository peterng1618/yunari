import { useRef } from "react";
import { confirmOutputBake } from "../components/output-bake-dialog.js";
import { bakeStoredThemeCrops } from "../crop-manager/bake-stored.js";
import type { SubmitControl } from "../store-mode/use-submit.js";
import { useSubmit } from "../store-mode/use-submit.js";
import type {
  ThemeLibraryClient,
  ThemeLibraryContent,
} from "../theme-library-client.js";
import { uiCopy } from "../ui-copy.js";

/**
 * A listing page's submission flow.
 *
 * **A submission is this page's own flow.** The Library replaced the old store
 * region, so the theme a person publishes is the stored copy the host holds:
 * the crop pass writes the baked copy before the host reads it, and a landed
 * press restores the author's un-baked library copy beside advancing the open
 * document's base.
 */
export function usePageSubmit(options: {
  readonly client: ThemeLibraryClient;
  readonly onSubmitted: () => void;
  /** Tells the session a submission landed, so the open document's base is
   *  advanced past the version the host published. */
  readonly onPublished?: ((id: string) => void) | undefined;
}): {
  readonly control: SubmitControl;
  readonly announcement: string;
} {
  const { client } = options;
  const publishedBackup = useRef<
    { readonly id: string; readonly content: ThemeLibraryContent } | undefined
  >(undefined);
  const submit = useSubmit({
    // A landed submission re-reads both halves, so the card draws the version
    // the host just wrote rather than the one this page read at mount; the
    // modal's foot is refreshed from the same join (`relist`).
    onSubmitted: options.onSubmitted,
    beforeSubmit: async (id) => {
      try {
        const content = await client.open(id);
        const baked = await bakeStoredThemeCrops({
          envelope: content.envelope,
          assets: content.assets,
        });
        if (baked.baked === 0) return undefined;
        if (
          !(await confirmOutputBake({
            title: uiCopy.store.submit.label,
            crops: baked.baked,
          }))
        ) {
          return uiCopy.store.submit.cancelled;
        }
        await client.save(id, {
          ...content,
          envelope: baked.envelope,
          assets: baked.assets,
        });
        publishedBackup.current = { id, content };
        return undefined;
      } catch {
        return uiCopy.store.submit.prepareFailed;
      }
    },
    afterSubmit: async (version) => {
      const backup = publishedBackup.current;
      publishedBackup.current = undefined;
      if (backup === undefined) return;
      const envelope =
        version === undefined
          ? backup.content.envelope
          : {
              ...backup.content.envelope,
              metadata: { ...backup.content.envelope.metadata, version },
            };
      try {
        // An overwrite, because the host advanced the base while it published
        // the baked copy; the bytes being restored are the author's own.
        await client.save(
          backup.id,
          { ...backup.content, envelope },
          { overwrite: true },
        );
      } catch {
        // The submission already happened. Retrying here would be a second
        // write the author did not ask for.
      }
      options.onPublished?.(backup.id);
    },
  });
  return { control: submit.control, announcement: submit.announcement };
}
