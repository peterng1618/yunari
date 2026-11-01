import { useEffect, useState } from "react";
import {
  type CredentialResult,
  type CredentialRow,
  clearCredential,
  listCredentials,
  saveCredential,
  verifyCredential,
} from "../../asset-finder/credentials-client.js";
import { ControlWell } from "../../components/ui/control-well.js";
import { ACTION_BUTTON } from "../../components/ui/dialog.js";
import { uiCopy } from "../../ui-copy.js";
import { Page } from "../page.js";

/**
 * The Asset sources page: every provider key this host knows, and the one place
 * a key is entered.
 *
 * A stored value is never rendered again — the row shows the host's hint, and
 * the input only ever carries what this page is about to send. Save's answer is
 * the host's; the row is refreshed from the host rather than from the draft, so
 * a refused write cannot leave the page saying a key was stored.
 */
export function AssetSourcesPage(): React.JSX.Element {
  const [rows, setRows] = useState<readonly CredentialRow[]>([]);
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [messages, setMessages] = useState<Readonly<Record<string, string>>>(
    {},
  );
  const [busy, setBusy] = useState<string | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void listCredentials().then((next) => {
      if (live) setRows(next);
    });
    return () => {
      live = false;
    };
  }, []);

  const run = async (
    id: string,
    work: () => Promise<CredentialResult>,
  ): Promise<void> => {
    setBusy(id);
    const result = await work();
    setMessages((current) => {
      const next = { ...current };
      if (result.ok) delete next[id];
      else next[id] = result.message;
      return next;
    });
    setRows(await listCredentials());
    setBusy(undefined);
  };

  const save = (id: string): void => {
    void run(id, async () => {
      const result = await saveCredential(id, drafts[id] ?? "");
      if (result.ok) setDrafts((current) => ({ ...current, [id]: "" }));
      return result;
    });
  };

  return (
    <Page page="asset-sources">
      <div
        className="flex flex-col gap-[var(--space-8)]"
        data-yunari-connections=""
      >
        {rows.length === 0 ? (
          <p className="text-sm text-muted">{uiCopy.settings.connectionsEmpty}</p>
        ) : (
          <div className="grid gap-[var(--space-12)] xl:grid-cols-2">
            {rows.map((row) => (
              <div
                key={row.id}
                className="flex min-w-0 flex-col gap-[var(--space-8)] rounded-[var(--radius-lg)] border border-edge bg-[var(--panel-2)] p-[var(--space-10)]"
                data-yunari-credential-row={row.id}
              >
                <div className="flex items-center gap-[var(--space-8)]">
                  <span className="flex-1 font-medium">{row.label}</span>
                  <span className="text-sm text-muted">
                    {row.set
                      ? uiCopy.settings.connectionsSaved(row.hint)
                      : uiCopy.settings.connectionsNotSet}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-[var(--space-8)]">
                  <ControlWell
                    density="dialog"
                    widthClassName="min-w-[6rem] flex-1"
                  >
                    <input
                      type="password"
                      aria-label={`${row.label} ${uiCopy.settings.connectionsPlaceholder}`}
                      placeholder={uiCopy.settings.connectionsPlaceholder}
                      value={drafts[row.id] ?? ""}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [row.id]: event.target.value,
                        }))
                      }
                      data-yunari-credential-input={row.id}
                      className="h-full w-full min-w-0 bg-transparent font-mono text-sm text-text outline-none"
                    />
                  </ControlWell>
                  <button
                    type="button"
                    disabled={busy === row.id || (drafts[row.id] ?? "") === ""}
                    onClick={() => save(row.id)}
                    data-yunari-credential-save={row.id}
                    className={ACTION_BUTTON}
                  >
                    {uiCopy.settings.connectionsSave}
                  </button>
                  <button
                    type="button"
                    disabled={!row.set || busy === row.id}
                    onClick={() =>
                      void run(row.id, () => clearCredential(row.id))
                    }
                    data-yunari-credential-clear={row.id}
                    className={ACTION_BUTTON}
                  >
                    {uiCopy.settings.connectionsClear}
                  </button>
                  <button
                    type="button"
                    disabled={!row.set || !row.verify || busy === row.id}
                    onClick={() =>
                      void run(row.id, () => verifyCredential(row.id))
                    }
                    data-yunari-credential-verify={row.id}
                    className={ACTION_BUTTON}
                  >
                    {uiCopy.settings.connectionsVerify}
                  </button>
                </div>
                {row.helpText === null || row.helpUrl === null ? null : (
                  <p
                    className="text-sm text-muted"
                    data-yunari-credential-help={row.id}
                  >
                    {row.helpText}{" "}
                    <a
                      href={row.helpUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      {uiCopy.settings.connectionsWhereToGetKey}
                    </a>
                  </p>
                )}
                {messages[row.id] === undefined ? null : (
                  <p className="text-sm">{messages[row.id]}</p>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="text-sm text-muted">{uiCopy.settings.connectionsFooter}</p>
      </div>
    </Page>
  );
}
