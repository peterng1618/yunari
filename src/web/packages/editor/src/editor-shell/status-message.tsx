import {
  type StatusMessageStore,
  useStatusMessage,
} from "./shell-stores.js";

/**
 * The editor's one status message.
 *
 * The value is `editor-main`'s — the boot and the document's verbs publish
 * their reports through {@link StatusMessageStore} — so the footer renders the
 * message the same way it renders the counts, the diagnostic and the save
 * state, and nothing outside React owns the text. The `id` is the message's
 * address: a locator that means the message names it rather than the strip
 * around it.
 */
export function StatusMessage({
  store,
}: {
  readonly store: StatusMessageStore;
}): React.JSX.Element {
  const message = useStatusMessage(store);
  return <span id="status-message">{message}</span>;
}
