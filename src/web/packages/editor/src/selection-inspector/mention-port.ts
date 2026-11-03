import type { SemanticKeyDescriptor } from "@yunari/renderer-core";
import type { EditorDocument } from "../editor-document.js";
import type { TextMentionPort } from "../text-manager/index.js";
import { insertReading, type RunTarget, writeTypedText } from "./run-edits.js";

/**
 * The inline `@` port: the document owns the node's bindings, so the writes
 * that insert and settle a reading are built here rather than inside the text
 * manager. The bound set is the theme's, the same one the run picker marks, so
 * both surfaces call a key the host does not answer "bound but unavailable".
 */
export function createMentionPort(
  document: EditorDocument,
  descriptors: () => readonly SemanticKeyDescriptor[],
  measured: () => ReadonlySet<string> | undefined,
): TextMentionPort {
  const runTarget = (object: RunTarget["object"]): RunTarget | undefined => {
    const nodeId = object.get("id");
    if (typeof nodeId !== "string" || nodeId === "") return undefined;
    return {
      object,
      nodeId,
      bindings: () => document.envelope.bindings?.[nodeId] ?? [],
      setBindings: (next) => document.setBindings(nodeId, next),
    };
  };

  return {
    descriptors,
    measured,
    bound: () => document.boundKeys(),
    insert: (object, range) => {
      const target = runTarget(object);
      return target === undefined ? false : insertReading(target, range);
    },
    settle: (object, text) => {
      const target = runTarget(object);
      return target === undefined ? false : writeTypedText(target, text);
    },
  };
}
