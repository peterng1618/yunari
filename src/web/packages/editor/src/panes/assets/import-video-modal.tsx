import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import type { ImportOutcome } from "../../asset-finder/actions.js";
import { Dialog } from "../../components/ui/dialog.js";
import { uiCopy } from "../../ui-copy.js";

/** The two halves of the one run: the host prepares the video, then the
 *  document declares it. */
export type VideoImportStep = "preparing" | "importing";

export interface ImportVideoModalProps {
  readonly file: File;
  /** A package is extracted as well as normalized, so its sentence says so. */
  readonly package: boolean;
  readonly onRun: (
    onStep: (step: VideoImportStep) => void,
  ) => Promise<ImportOutcome>;
  readonly onClose: () => void;
}

/**
 * The one modal a picked `.mpkg` or video runs.
 *
 * **It starts on mount, and nothing else starts it.** A pick is already the
 * author's answer, so there is no second press; the run reports its step here
 * and a success closes the surface. A refusal stays open with the host's own
 * sentence, because it names which rule the file broke.
 */
export function ImportVideoModal({
  file,
  package: isPackage,
  onRun,
  onClose,
}: ImportVideoModalProps): React.JSX.Element {
  const copy = uiCopy.panels.importVideo;
  const [step, setStep] = useState<VideoImportStep>("preparing");
  const [running, setRunning] = useState(true);
  const [message, setMessage] = useState<string>();
  const started = useRef(false);
  const closed = useRef(false);

  const close = (): void => {
    if (closed.current) return;
    closed.current = true;
    onClose();
  };

  // Once, at mount: `started` keeps a parent re-render from launching a second
  // host call, and `close` keeps a run that lands after a dismissal from
  // closing twice.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void onRun(setStep).then(
      (outcome) => {
        if (outcome.ok) {
          close();
          return;
        }
        setRunning(false);
        setMessage(outcome.message);
      },
      (error: unknown) => {
        setRunning(false);
        setMessage(error instanceof Error ? error.message : String(error));
      },
    );
  }, []);

  const preparing = isPackage ? copy.preparingPackage : copy.preparingVideo;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) close();
      }}
      label={copy.title}
      closeLabel={copy.close}
      closeIcon
    >
      <div
        data-yunari-import-video-modal=""
        className="flex w-[var(--import-dialog-width)] flex-col gap-[var(--space-8)]"
      >
        <span className="truncate text-xs text-muted">{file.name}</span>
        {/* A settled run has no step: on failure the host sentence below is the
            only status, so the stale "preparing" line cannot sit beside it. */}
        {running ? (
          <p
            role="status"
            data-yunari-import-video-step=""
            className="text-sm text-text"
          >
            {step === "preparing" ? preparing : copy.importing}
          </p>
        ) : null}
        {running ? (
          <div
            data-yunari-import-video-progress=""
            aria-hidden="true"
            className="h-24 animate-pulse rounded-[var(--radius-md)] border border-edge-2 bg-panel-2"
          />
        ) : null}
        {message === undefined ? null : (
          <p
            role="alert"
            data-yunari-import-video-message=""
            className="text-sm text-text"
          >
            {message}
          </p>
        )}
      </div>
    </Dialog>
  );
}
