import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import {
  ImportVideoModal,
  type VideoImportStep,
} from "../panes/assets/import-video-modal.js";
import { uiCopy } from "../ui-copy.js";
import {
  fetchWallpaperEngine,
  type StartProjectAnswer,
  type WallpaperEngineAnswer,
  type WallpaperEngineClientOptions,
  type WallpaperEngineItem,
} from "../wallpaper-engine/client.js";
import type { ImportOutcome } from "./actions.js";
import { FinderSkeleton } from "./skeleton.js";
import {
  WallpaperEngineCard,
  type WallpaperEngineCardState,
} from "./wallpaper-engine-card.js";
import { WallpaperEngineGuide } from "./wallpaper-engine-guide.js";

interface CardStatus {
  readonly state: WallpaperEngineCardState;
  readonly message?: string;
}

/** The finder's Wallpaper Engine body: this PC's library as a card grid.
 *
 * The writes are the session's — this body only says which item. Each card's
 * action state lives here, so a running import is never silent: one status line
 * at the modal's bottom carries every card's outcome. The listing itself is a
 * fetch, because this is a library rather than a search. */
export function WallpaperEngineBody(props: {
  readonly onSetBackground: (
    item: WallpaperEngineItem,
  ) => Promise<ImportOutcome>;
  readonly onConvert: (
    item: WallpaperEngineItem,
  ) => Promise<StartProjectAnswer>;
  readonly onImportPackage: (
    file: File,
    onStep: (step: VideoImportStep) => void,
  ) => Promise<ImportOutcome>;
  readonly client?: WallpaperEngineClientOptions;
}): React.JSX.Element {
  const { onSetBackground, onConvert, onImportPackage, client } = props;
  const [answer, setAnswer] = useState<WallpaperEngineAnswer | undefined>();
  const [cards, setCards] = useState<ReadonlyMap<string, CardStatus>>(
    new Map(),
  );
  const [status, setStatus] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [packageFile, setPackageFile] = useState<File | undefined>();
  /** §5.3's title search and kind filter. The listing is already in memory, so
   *  narrowing it is this body's own decision and no new route. */
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<WallpaperEngineItem["kind"] | "all">("all");
  const packageInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    void fetchWallpaperEngine(client).then((next) => {
      if (live) setAnswer(next);
    });
    return () => {
      live = false;
    };
  }, [client]);

  const copy = uiCopy.assets.wallpaperEngine;

  /** The modal's run, wrapped so a success reaches the one status line as well
   *  as the surface that is about to close. */
  const importPackage = async (
    file: File,
    onStep: (step: VideoImportStep) => void,
  ): Promise<ImportOutcome> => {
    setStatus("");
    const outcome = await onImportPackage(file, onStep);
    if (outcome.ok) setStatus(copy.packageImported);
    return outcome;
  };

  /** The two controls that need no listing: the workflow guide, and the `.mpkg`
   *  a scene exported on another machine already produced. Both stay reachable
   *  when this PC has no library of its own.
   *
   *  **One root, one fixed position.** React reconciles by position, so a modal
   *  drawn under the loaded listing but beside the skeleton under load would
   *  unmount when the listing lands — resetting `started` and running the
   *  import a second time. Only the listing region below varies. */
  const guideAndPackage = (
    <>
      <div className="flex flex-wrap items-center gap-[var(--space-8)]">
        <button
          type="button"
          data-yunari-wallpaper-engine-guide=""
          onClick={() => {
            setGuideOpen(true);
          }}
          className="rounded-[var(--radius-sm)] border border-edge px-[var(--space-10)] py-[var(--space-6)] text-xs"
        >
          {copy.guide}
        </button>
        <button
          type="button"
          data-yunari-wallpaper-engine-import-package=""
          onClick={() => {
            packageInput.current?.click();
          }}
          className="rounded-[var(--radius-sm)] border border-edge px-[var(--space-10)] py-[var(--space-6)] text-xs"
        >
          {copy.importPackage}
        </button>
        <input
          ref={packageInput}
          type="file"
          accept=".mpkg"
          data-yunari-wallpaper-engine-package-input=""
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file !== undefined) setPackageFile(file);
          }}
        />
      </div>
      <WallpaperEngineGuide
        open={guideOpen}
        onOpenChange={(next) => {
          setGuideOpen(next);
        }}
      />
      {packageFile === undefined ? null : (
        <ImportVideoModal
          file={packageFile}
          package
          onRun={(onStep) => importPackage(packageFile, onStep)}
          onClose={() => {
            setPackageFile(undefined);
          }}
        />
      )}
    </>
  );

  const setCard = (
    item: WallpaperEngineItem,
    state: WallpaperEngineCardState,
    message?: string,
  ): void => {
    setCards((current) => {
      const next = new Map(current);
      next.set(item.workshopId, {
        state,
        ...(message === undefined ? {} : { message }),
      });
      return next;
    });
  };

  /** A refusal stays on the card as its tooltip and on the status line; the
   *  card is still pressable, so a retry runs the action again. */
  const setBackground = async (item: WallpaperEngineItem): Promise<void> => {
    setStatus("");
    setCard(item, "running");
    const outcome = await onSetBackground(item);
    if (outcome.ok) {
      setCard(item, "done");
      setStatus(copy.backgroundSet(item.title));
      return;
    }
    setCard(item, "failed", outcome.message);
    setStatus(outcome.message);
  };

  const convert = async (item: WallpaperEngineItem): Promise<void> => {
    setStatus("");
    setCard(item, "running");
    const project = await onConvert(item);
    if (project.ok) {
      setCard(item, "done");
      setStatus(
        project.reused
          ? copy.projectReused(project.name)
          : copy.projectReady(project.name),
      );
      return;
    }
    const failure = copy.projectFailed(project.reason);
    setCard(item, "failed", failure);
    setStatus(failure);
  };

  const act = (item: WallpaperEngineItem): void => {
    void (item.kind === "video" ? setBackground(item) : convert(item));
  };

  const needle = query.trim().toLowerCase();

  let listing: React.JSX.Element;
  if (answer === undefined) {
    // The wait is the grid that is coming; the guide and the `.mpkg` import
    // need no library, so they stay reachable while the host answers.
    listing = <FinderSkeleton />;
  } else if (answer.available === false) {
    listing = (
      <p
        data-yunari-wallpaper-engine-unavailable=""
        className="text-sm text-muted"
      >
        {copy.reason[answer.reason]}
      </p>
    );
  } else if (answer.items.length === 0) {
    listing = <p className="text-sm text-muted">{copy.empty}</p>;
  } else {
    const shown = answer.items.filter(
      (item) =>
        (kind === "all" || item.kind === kind) &&
        (needle === "" || item.title.toLowerCase().includes(needle)),
    );
    listing = (
      <>
        <input
          type="text"
          data-yunari-wallpaper-engine-search=""
          aria-label={copy.search}
          placeholder={copy.search}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          className="rounded-[var(--radius-sm)] border border-edge bg-[var(--panel-2)] px-[var(--space-8)] py-[var(--space-6)] text-sm"
        />
        <div
          role="group"
          aria-label={copy.filterKind}
          className="flex flex-wrap gap-[var(--space-6)]"
        >
          {(["all", "video", "scene"] as const).map((option) => (
            <button
              key={option}
              type="button"
              data-yunari-wallpaper-engine-kind-filter={option}
              aria-pressed={kind === option}
              onClick={() => {
                setKind(option);
              }}
              className="rounded-[var(--radius-sm)] border border-edge px-[var(--space-10)] py-[var(--space-6)] text-xs aria-pressed:border-accent aria-pressed:text-accent"
            >
              {option === "all" ? copy.filterAll : copy.kind[option]}
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p
            data-yunari-wallpaper-engine-no-matches=""
            className="text-sm text-muted"
          >
            {copy.noMatches}
          </p>
        ) : (
          <div
            data-yunari-asset-grid=""
            className="grid content-start grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-[var(--space-8)]"
          >
            {shown.map((item) => {
              const card = cards.get(item.workshopId);
              return (
                <WallpaperEngineCard
                  key={item.workshopId}
                  item={item}
                  state={card?.state ?? "idle"}
                  {...(card === undefined || card.message === undefined
                    ? {}
                    : { message: card.message })}
                  onAction={() => {
                    act(item);
                  }}
                />
              );
            })}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-[var(--space-8)]">
      {guideAndPackage}
      {listing}
      <p
        role="status"
        data-yunari-wallpaper-engine-status=""
        className="min-h-[1em] text-xs text-muted"
      >
        {status}
      </p>
    </div>
  );
}
