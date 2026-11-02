import type { VersionLevel } from "@yunari/theme-package";
import { useEffect, useRef, useState } from "react";
import { uiCopy } from "../ui-copy.js";
import type { StoreItem } from "./local-source.js";

const SUBMIT_PATH = "/api/themes/submit";
const START_PATH = "/api/store/auth/start";
const SESSION_PATH = "/api/store/session";

/** How often the host is asked whether the sign-in landed. */
const POLL_INTERVAL_MS = 1000;
/** Five minutes' worth of polls, after which the author is told to try again. */
const POLL_ATTEMPTS = 300;

export type SubmitState =
  | "idle"
  | "authorising"
  | "submitting"
  | "submitted"
  | "refused";

/** What the store did with a landed submission: a new author's first items
 *  wait for the owner, and a published one is already listed. */
export type SubmitStatus = "pending" | "published";

/** What the host published, as the author is told it: the version bumped from
 *  (`null` on a first release), the one written, and the ladder's word for it. */
export interface SubmittedVersion {
  readonly from: string | null;
  readonly to: string;
  readonly level: VersionLevel;
}

const VERSION_LEVELS: readonly VersionLevel[] = [
  "initial",
  "none",
  "patch",
  "minor",
  "major",
];

/**
 * What the modal's Submit control needs from the region that owns the press:
 * the action, the state it is in, the sign-in window's address while one is
 * open, and the status, version or refusal the host answered.
 */
export interface SubmitControl {
  readonly onSubmit: (item: StoreItem) => void;
  /** The item every other field belongs to. A surface draws this state only
   *  when the id is the item it is showing: another theme's window or refusal is
   *  not this one's answer. */
  readonly itemId: string | undefined;
  readonly state: SubmitState;
  /** Whether any submission is in flight, whichever item it belongs to. A
   *  control for another item is drawn busy and disabled, because its press
   *  would meet the one-flow guard and do nothing. */
  readonly inFlight: boolean;
  /** The sign-in popup's address while the host's window is open. */
  readonly url: string | undefined;
  readonly version: SubmittedVersion | undefined;
  readonly refusal: string | undefined;
  readonly status: SubmitStatus | undefined;
}

/** The window a sign-in is opened in, and the only thing this hook needs from
 *  it: the flow closes it once the host holds the session. */
export interface SignInWindow {
  close(): void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The answer as an object, or nothing where it is not one. */
function jsonOf(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** The host's sentence, or the answer's own body where it wrote none. */
function refusalOf(text: string): string {
  const message = jsonOf(text)?.["message"];
  return typeof message === "string" && message !== "" ? message : text;
}

/**
 * The three version facts, or nothing. **A malformed answer refuses the
 * claim**: a footer naming a version the host did not publish would be a lie,
 * and `from` is `null` on the wire rather than an absent key.
 */
function versionOf(value: unknown): SubmittedVersion | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const { from, to, level } = value as Record<string, unknown>;
  if (from !== null && typeof from !== "string") return undefined;
  if (typeof to !== "string" || to === "") return undefined;
  if (
    typeof level !== "string" ||
    !VERSION_LEVELS.includes(level as VersionLevel)
  )
    return undefined;
  return { from, to, level: level as VersionLevel };
}

/** The state the store landed the item in, or nothing where the answer names
 *  one this footer cannot draw. */
function statusOf(value: unknown): SubmitStatus | undefined {
  return value === "pending" || value === "published" ? value : undefined;
}

function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

const defaultOpen = (url: string): SignInWindow | null =>
  window.open(url, "_blank", "popup,width=520,height=720");

/**
 * The library half's submission, and the sentence a screen reader hears for it.
 *
 * It posts the theme's id and nothing else: the host reads the theme, builds the
 * package and stores it as the author's account. **The browser never receives a
 * token** — a missing identity starts the host's sign-in in a popup, and this
 * hook learns only whether the session landed.
 *
 * **The popup is not the truth**: the poll on `/api/store/session` is. The
 * Worker's return page may close the window before the host has read the
 * session, so a closed popup is not a cancellation.
 *
 * **Every timer is cleared on a terminal state and on unmount**, and every
 * continuation checks that the hook is still mounted: a poll that fires after
 * the modal closed has no surface to answer.
 */
export function useSubmit(options: {
  readonly fetch?: typeof fetch;
  /** How a sign-in window is made, so a test can watch the address it was given
   *  and a browser that blocks it can be answered without a real popup. */
  readonly openWindow?: (url: string) => SignInWindow | null;
  /** Runs once per press before the host reads the theme. The store publishes
   *  the saved library document, so a crop must be baked there first; a
   *  sentence returned here is the refusal the modal shows. */
  readonly beforeSubmit?:
    | ((id: string) => Promise<string | undefined>)
    | undefined;
  /** Runs once when this press ends, whether it landed or was refused. The
   *  region uses it to put the un-baked library copy back; the published
   *  version is passed when one landed. */
  readonly afterSubmit?: ((version?: string) => Promise<void>) | undefined;
  /** Called once when a submission lands: the region re-reads the library so
   *  the listing carries the version the host just wrote. */
  readonly onSubmitted?: () => void;
}): {
  readonly control: SubmitControl;
  readonly announcement: string;
} {
  const [itemId, setItemId] = useState<string | undefined>(undefined);
  /** The item's own name, kept beside its id so the live region can name the
   *  item an answer belongs to. */
  const [itemLabel, setItemLabel] = useState<string | undefined>(undefined);
  const [state, setState] = useState<SubmitState>("idle");
  const [url, setUrl] = useState<string | undefined>(undefined);
  const [version, setVersion] = useState<SubmittedVersion | undefined>(
    undefined,
  );
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<SubmitStatus | undefined>(undefined);

  /** The guard a second press meets before any state has committed. */
  const busy = useRef(false);
  const alive = useRef(true);
  /** Whether this press already baked its theme. A sign-in retry re-enters
   *  `attempt` and must not crop the same library theme twice. */
  const prepared = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** The open sign-in window, and how many polls this flow has spent. */
  const signInWindow = useRef<SignInWindow | undefined>(undefined);
  const polls = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current !== undefined) clearTimeout(timer.current);
      timer.current = undefined;
      // An editor torn down mid-sign-in must not orphan the store's window,
      // and a publish that replaced the library copy must put it back.
      closeWindow();
      void options.afterSubmit?.().catch(() => undefined);
    };
  }, []);

  function clearTimer(): void {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  }

  function closeWindow(): void {
    const opened = signInWindow.current;
    signInWindow.current = undefined;
    try {
      opened?.close();
    } catch {
      // The window is already gone, which is what the close wanted.
    }
  }

  function post(path: string, body: unknown): Promise<Response> {
    // Bound at press time rather than at mount, so a case that replaces the
    // transport sees this press. A host with no `fetch` rejects into the same
    // refusal path as a network failure.
    const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    return fetcher(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function read(path: string): Promise<Response> {
    const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    return fetcher(path, { method: "GET" });
  }

  /** The host's sentence, or the one sentence that is this surface's own: a
   *  refusal leaves the control pressable so the author can act on it. */
  function refuse(message: string): void {
    clearTimer();
    closeWindow();
    busy.current = false;
    prepared.current = false;
    polls.current = 0;
    void options.afterSubmit?.().catch(() => undefined);
    setState("refused");
    setRefusal(message);
    setUrl(undefined);
    setVersion(undefined);
    setStatus(undefined);
  }

  function schedulePoll(id: string): void {
    if (!alive.current) return;
    clearTimer();
    timer.current = setTimeout(() => void poll(id), POLL_INTERVAL_MS);
  }

  /** One question to the host: does it hold the session yet? The poll is the
   *  flow's truth, and the fifth minute's answer is its last chance. */
  async function poll(id: string): Promise<void> {
    if (!alive.current) return;
    polls.current += 1;
    let answered: Response;
    try {
      answered = await read(SESSION_PATH);
    } catch (error) {
      refuse(messageOf(error));
      return;
    }
    const text = await answered.text().catch(() => "");
    if (!alive.current) return;
    if (!answered.ok) {
      refuse(refusalOf(text));
      return;
    }
    if (jsonOf(text)?.["signedIn"] === true) {
      closeWindow();
      // The identity is stored; the submission it was missing is retried once.
      await attempt(id, true);
      return;
    }
    if (polls.current >= POLL_ATTEMPTS) {
      refuse(uiCopy.store.submit.noSignIn);
      return;
    }
    schedulePoll(id);
  }

  /** Ask the host for a sign-in address, open it, and start asking whether the
   *  session landed. **The address is the host's**, never one composed here. */
  async function authorise(id: string): Promise<void> {
    if (!alive.current) return;
    setState("authorising");
    setRefusal(undefined);
    let answered: Response;
    try {
      answered = await post(START_PATH, {});
    } catch (error) {
      refuse(messageOf(error));
      return;
    }
    const text = await answered.text().catch(() => "");
    if (!alive.current) return;
    if (!answered.ok) {
      refuse(refusalOf(text));
      return;
    }
    const target = jsonOf(text)?.["url"];
    if (typeof target !== "string" || !isHttps(target)) {
      refuse(refusalOf(text));
      return;
    }
    const opened = (options.openWindow ?? defaultOpen)(target);
    if (opened === null) {
      // A blocked popup is not a sign-in the author can finish.
      refuse(uiCopy.store.submit.blocked);
      return;
    }
    signInWindow.current = opened;
    setUrl(target);
    polls.current = 0;
    schedulePoll(id);
  }

  async function attempt(id: string, retried: boolean): Promise<void> {
    if (!alive.current) return;
    clearTimer();
    setState("submitting");
    if (!prepared.current) {
      prepared.current = true;
      try {
        const refusal = await options.beforeSubmit?.(id);
        if (!alive.current) return;
        if (refusal !== undefined) {
          refuse(refusal);
          return;
        }
      } catch {
        refuse(uiCopy.store.submit.prepareFailed);
        return;
      }
    }
    let answered: Response;
    try {
      answered = await post(SUBMIT_PATH, { id });
    } catch (error) {
      refuse(messageOf(error));
      return;
    }
    const text = await answered.text().catch(() => "");
    if (!alive.current) return;
    // **`401` is the one status that is not a refusal**: it says the host has
    // no identity, which the sign-in window can supply. A retry that meets it
    // again cannot loop: the second 401 is the flow's last word.
    if (answered.status === 401) {
      if (retried) {
        refuse(uiCopy.store.submit.noSignIn);
        return;
      }
      await authorise(id);
      return;
    }
    if (!answered.ok) {
      refuse(refusalOf(text));
      return;
    }
    const answer = jsonOf(text);
    // A landed submission names the state and the version it published; an
    // answer without those facts is not one this surface can report.
    const published = versionOf(answer?.["version"]);
    if (published === undefined) {
      refuse(refusalOf(text));
      return;
    }
    const rawStatus = answer?.["status"];
    const word = statusOf(rawStatus);
    if (word === undefined) {
      // A state no footer draws is named rather than leaving the answer's JSON
      // on screen.
      refuse(uiCopy.store.submit.unexpectedState(String(rawStatus)));
      return;
    }
    clearTimer();
    busy.current = false;
    prepared.current = false;
    void options.afterSubmit?.(published.to).catch(() => undefined);
    setState("submitted");
    setStatus(word);
    setVersion(published);
    setRefusal(undefined);
    setUrl(undefined);
    options.onSubmitted?.();
  }

  const onSubmit = (item: StoreItem): void => {
    if (busy.current) return;
    busy.current = true;
    prepared.current = false;
    clearTimer();
    // The whole outcome belongs to this item from the press onward.
    setItemId(item.id);
    setItemLabel(item.name === "" ? item.id : item.name);
    setState("submitting");
    setRefusal(undefined);
    setUrl(undefined);
    setVersion(undefined);
    setStatus(undefined);
    void attempt(item.id, false);
  };

  const announcement =
    state === "refused"
      ? (refusal ?? "")
      : state === "authorising"
        ? uiCopy.store.submit.authorising
        : state === "submitted" && status !== undefined
          ? uiCopy.store.submit.submitted(status)
          : "";
  const inFlight = state === "submitting" || state === "authorising";

  return {
    control: {
      onSubmit,
      itemId,
      state,
      inFlight,
      url,
      version,
      refusal,
      status,
    },
    // **The item is named in the live region**, because the region outlives
    // the modal: an answer belonging to A must not be attributed to the item B
    // whose surface happens to be open when it arrives.
    announcement:
      announcement === ""
        ? ""
        : uiCopy.store.submit.announcement(
            itemLabel ?? itemId ?? "",
            announcement,
          ),
  };
}
