import type {
  CreateDraftInput,
  Draft,
  DraftStore,
  OpenedThemeContent,
  ThemeCredits,
  ThemeMetadata,
} from "./types.js";

function copiedAssets(
  assets: Readonly<Record<string, Uint8Array>> | undefined,
): Record<string, Uint8Array> {
  const copy: Record<string, Uint8Array> = {};
  for (const [path, bytes] of Object.entries(assets ?? {})) {
    copy[path] = bytes;
  }
  return copy;
}

/**
 * Drafts are process memory keyed by theme id, and nothing here touches the
 * host. Every mutation is local; `save_theme` and `preview_theme` are the only
 * calls that reach the host, which is what lets an agent work freely before a
 * deliberate write.
 */
export class InMemoryDraftStore implements DraftStore {
  private readonly drafts = new Map<string, Draft>();

  create(input: CreateDraftInput): Draft {
    if (this.drafts.has(input.id)) {
      throw new Error(`A draft "${input.id}" is already open.`);
    }

    const draft: Draft = {
      id: input.id,
      envelope: input.envelope,
      assets: copiedAssets(input.assets),
      ...(input.credits === undefined ? {} : { credits: input.credits }),
      origin: "new",
    };
    this.drafts.set(draft.id, draft);
    return draft;
  }

  open(id: string, content: OpenedThemeContent): Draft {
    if (this.drafts.has(id)) {
      throw new Error(`A draft "${id}" is already open.`);
    }

    const draft: Draft = {
      id,
      envelope: content.envelope,
      assets: copiedAssets(content.assets),
      ...(content.credits === undefined ? {} : { credits: content.credits }),
      ...(content.base === undefined ? {} : { base: content.base }),
      origin: "opened",
    };
    this.drafts.set(id, draft);
    return draft;
  }

  read(id: string): Draft {
    const draft = this.drafts.get(id);
    if (draft === undefined) {
      throw new Error(`No draft "${id}" is open.`);
    }
    return draft;
  }

  current(): Draft {
    if (this.drafts.size === 0) {
      throw new Error(
        "No draft is open. Call create_theme or open_theme first.",
      );
    }
    if (this.drafts.size > 1) {
      const ids = [...this.drafts.keys()].join(", ");
      throw new Error(
        `More than one draft is open (${ids}); name the theme id.`,
      );
    }
    return [...this.drafts.values()][0] as Draft;
  }

  discard(id: string): boolean {
    return this.drafts.delete(id);
  }

  setMetadata(id: string, metadata: ThemeMetadata): Draft {
    const draft = this.read(id);
    draft.envelope = { ...draft.envelope, metadata };
    return draft;
  }

  setAsset(id: string, path: string, bytes: Uint8Array): Draft {
    const draft = this.read(id);
    draft.assets[path] = bytes;
    return draft;
  }

  setCredits(id: string, credits: ThemeCredits | undefined): Draft {
    const draft = this.read(id);
    if (credits === undefined) {
      delete draft.credits;
    } else {
      draft.credits = credits;
    }
    return draft;
  }

  markSaved(id: string, base?: string): Draft {
    const draft = this.read(id);
    draft.saved = true;
    if (base !== undefined) draft.base = base;
    return draft;
  }
}
