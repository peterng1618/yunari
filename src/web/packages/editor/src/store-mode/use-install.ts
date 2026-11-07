import { useRef, useState } from "react";
import type { HeldUpdate } from "../components/held-update.js";
import { uiCopy } from "../ui-copy.js";
import { type InstallControl, installItem } from "./install-item.js";
import type { ItemSource, StoreItem } from "./local-source.js";

/**
 * The online half's Install and Update, and the sentence a screen reader hears
 * for the last install: a refusal's reason, or the news that it finished.
 *
 * It lives beside the region rather than in it because the region is a surface
 * at its line stop, and this is a fact the surface renders: the in-flight set,
 * the press, the refusal and the announcement string.
 *
 * **Success re-lists the library, and nothing here writes "installed".** The
 * host records the origin and the join reads it, so the listing is the one
 * source of what is installed; a flag set here would be a second answer that a
 * restart or a second window could not see.
 */
export function useInstall(options: {
  readonly source: ItemSource;
  readonly onListed: (items: readonly StoreItem[]) => void;
}): { readonly control: InstallControl; readonly announcement: string } {
  /** The items a press is in flight for: each control disables itself on its
   *  own id, so two items install at once and neither loses the other's busy
   *  state. */
  const [installingIds, setInstallingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  /** The same set for the guard, because a second press in one tick reads the
   *  render before the first press committed; the state alone cannot refuse it. */
  const inFlight = useRef<Set<string>>(new Set());
  /** The host's own reason for a refused install, and the item it names:
   *  another item's refusal is not drawn beside this one's control. */
  const [refusal, setRefusal] = useState<
    { readonly id: string; readonly message: string } | undefined
  >(undefined);
  /** What the live region says when a press succeeded: the cell redraws as
   *  *Installed*, which a screen reader cannot see. A refusal outranks it. */
  const [installed, setInstalled] = useState<string | undefined>(undefined);
  /** The update the host held for review, with the item its approval press
   *  names. A hold writes nothing, so the listing is unchanged. */
  const [held, setHeld] = useState<
    | {
        readonly id: string;
        readonly item: StoreItem;
        readonly held: HeldUpdate;
      }
    | undefined
  >(undefined);

  /**
   * **A refusal changes nothing but its reason**: the control's state stays the
   * listing's, and the host's own sentence is kept for the item it names. A
   * re-list the host could not serve is stated too — the theme is installed
   * even when this surface could not read the library back.
   */
  const press = (item: StoreItem, approveUpdate: boolean): void => {
    if (inFlight.current.has(item.id)) return;
    inFlight.current.add(item.id);
    setInstallingIds(new Set(inFlight.current));
    setRefusal(undefined);
    // A new press clears the last success and the last hold: the region must
    // not still be saying the previous item landed while this one installs.
    setInstalled(undefined);
    setHeld(undefined);
    void installItem(item, approveUpdate ? { approveUpdate: true } : undefined)
      .then(async (outcome) => {
        if (!outcome.ok && "held" in outcome) {
          // Nothing was written: keep the item so its approval press can be
          // sent again, and draw the review notice in the region.
          setHeld({ id: item.id, item, held: outcome.held });
          return;
        }
        if (outcome.ok) {
          setInstalled(uiCopy.store.install.installed(item.name));
          const listed = await options.source.list().catch(() => undefined);
          if (listed !== undefined) {
            options.onListed(listed);
          } else {
            setRefusal({
              id: item.id,
              message: uiCopy.store.install.notRefreshed,
            });
          }
        } else {
          setRefusal({ id: item.id, message: outcome.message });
        }
      })
      // A press that rejects rather than answering — the one path that leaves
      // this hook before `installItem`'s own catch — must still release its
      // control: a busy flag nobody clears disables that cell for the session.
      .catch((error: unknown) => {
        setRefusal({
          id: item.id,
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        inFlight.current.delete(item.id);
        setInstallingIds(new Set(inFlight.current));
      });
  };

  const onInstall = (item: StoreItem): void => press(item, false);
  const onApproveUpdate = (): void => {
    if (held === undefined) return;
    press(held.item, true);
  };
  const onDismissUpdate = (): void => setHeld(undefined);

  return {
    control: {
      onInstall,
      installingIds,
      refusal,
      held: held === undefined ? undefined : { id: held.id, held: held.held },
      onApproveUpdate,
      onDismissUpdate,
    },
    announcement: refusal?.message ?? installed ?? "",
  };
}
