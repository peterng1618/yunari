import {
  type EditorThemeTokens,
  readEditorThemePackage,
  writeEditorThemePackage,
} from "@yunari/theme-package";
import { useEffect, useState } from "react";
import { ControlWell } from "../components/ui/control-well.js";
import { ACTION_BUTTON } from "../components/ui/dialog.js";
import { uiCopy } from "../ui-copy.js";
import {
  applyEditorThemeTokens,
  editorThemeFileName,
  readShellThemeTokens,
} from "./editor-theme.js";
import type { ShellPalette } from "./palette.js";

interface EditorThemeDraft {
  readonly name: string;
  readonly tokens: EditorThemeTokens;
}

interface Message {
  readonly kind: "status" | "alert";
  readonly text: string;
}

/** The same download the document's package export uses: one blob, one anchor,
 *  and the URL released before a second click can leak it. */
function download(name: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes as unknown as BlobPart], {
    type: "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** The Appearance tab's editor-theme section: capture the palette in force as a
 *  draft, export it as a package, and apply an imported package.
 *
 *  A draft is a snapshot, not the live palette: saving takes the tokens once,
 *  and moving the palette afterwards clears it, because an export naming a
 *  palette that is no longer in force would be a package nobody authored. */
export function EditorThemeSettings({
  palette,
}: {
  readonly palette: ShellPalette;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<EditorThemeDraft | undefined>(undefined);
  const [message, setMessage] = useState<Message | undefined>(undefined);

  // Choosing a palette clears the applied overrides in the parent; the draft
  // captured from the previous palette goes with it.
  useEffect(() => {
    setDraft(undefined);
  }, [palette]);

  const capture = (): EditorThemeDraft | undefined => {
    const trimmed = name.trim();
    if (trimmed === "") {
      setMessage({
        kind: "alert",
        text: uiCopy.settings.editorThemeNameRequired,
      });
      return undefined;
    }
    const read = readShellThemeTokens();
    if (!read.ok) {
      setMessage({ kind: "alert", text: read.message });
      return undefined;
    }
    return { name: trimmed, tokens: read.tokens };
  };

  const saveDraft = (): void => {
    const captured = capture();
    if (captured === undefined) return;
    setDraft(captured);
    setMessage({
      kind: "status",
      text: uiCopy.settings.editorThemeDraftSaved(captured.name),
    });
  };

  const exportPackage = (): void => {
    const captured = draft ?? capture();
    if (captured === undefined) return;
    setDraft(captured);
    const written = writeEditorThemePackage(captured);
    if (!written.ok) {
      setMessage({ kind: "alert", text: written.message });
      return;
    }
    download(editorThemeFileName(captured.name), written.bytes);
    setMessage({
      kind: "status",
      text: uiCopy.settings.editorThemeExported(captured.name),
    });
  };

  const importPackage = async (file: File): Promise<void> => {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      setMessage({
        kind: "alert",
        text: uiCopy.settings.editorThemeUnreadableFile,
      });
      return;
    }
    const read = readEditorThemePackage(bytes);
    if (!read.ok) {
      setMessage({ kind: "alert", text: read.message });
      return;
    }
    applyEditorThemeTokens(read.document.tokens);
    setName(read.document.name);
    setDraft({
      name: read.document.name,
      tokens: read.document.tokens,
    });
    setMessage({
      kind: "status",
      text: uiCopy.settings.editorThemeApplied(read.document.name),
    });
  };

  return (
    <div className="mt-[var(--space-14)] flex flex-col gap-[var(--space-8)]">
      <h3 data-yunari-editor-theme-heading="">
        {uiCopy.settings.editorThemeHeading}
      </h3>
      <p className="text-sm text-muted">{uiCopy.settings.editorThemeHint}</p>
      <div className="flex flex-wrap items-center gap-[var(--space-8)]">
        <ControlWell density="dialog" widthClassName="min-w-[6rem] flex-1">
          <input
            type="text"
            aria-label={uiCopy.settings.editorThemeName}
            placeholder={uiCopy.settings.editorThemeName}
            value={name}
            onChange={(event) => setName(event.target.value)}
            data-yunari-editor-theme-name=""
            className="h-full w-full min-w-0 bg-transparent text-sm text-text outline-none"
          />
        </ControlWell>
        <button
          type="button"
          onClick={saveDraft}
          data-yunari-editor-theme-save=""
          className={ACTION_BUTTON}
        >
          {uiCopy.settings.editorThemeSave}
        </button>
        <button
          type="button"
          onClick={exportPackage}
          data-yunari-editor-theme-export=""
          className={ACTION_BUTTON}
        >
          {uiCopy.settings.editorThemeExport}
        </button>
      </div>
      <input
        type="file"
        accept=".yunari-theme,application/zip"
        aria-label={uiCopy.settings.editorThemeImport}
        data-yunari-editor-theme-import=""
        className="text-sm text-muted"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file !== undefined) void importPackage(file);
        }}
      />
      {message === undefined ? null : (
        <p
          className="text-sm"
          role={message.kind}
          data-yunari-editor-theme-message=""
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
